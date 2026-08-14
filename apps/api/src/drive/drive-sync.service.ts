import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { DriveService } from './drive.service';
import { sanitizarNome } from './cripto-drive';
import { montarResumo, montarSnapshot } from './snapshot-tcc';
import { ErroDrive, atualizarConteudo, buscarPorNome, criarPasta, enviarArquivo } from './drive-api';

// Backoff por tentativa (minutos). Depois do último, repete no maior intervalo — a varredura
// diária ainda reenfileira, então nada fica parado para sempre.
const BACKOFF_MIN = [1, 5, 15, 60, 240, 1440];
const LOTE = 10; // itens por rodada, para não segurar o worker
// Item PROCESSANDO parado além disso é considerado travado (API reiniciou no meio do envio)
// e volta a ser reservável. Folgado o bastante para não roubar um upload grande em curso.
const TEMPO_TRAVADO_MS = 15 * 60 * 1000;

const MIME_POR_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const ROTULO_DOC: Record<string, string> = {
  PLANO_DESENVOLVIMENTO: 'Plano de desenvolvimento',
  TERMO_ACEITE: 'Termo de aceite',
  MONOGRAFIA: 'Monografia',
  VERSAO_FINAL: 'Versão final',
  AVALIACAO_BANCA: 'Documento da banca',
};

// Documentos que sobem para o Drive. AVALIACAO_BANCA fica FORA de propósito: é material
// interno/anônimo da banca, não peça do arquivo acadêmico.
const TIPOS_INICIAIS = ['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE'];
const TIPOS_VERSIONADOS = ['MONOGRAFIA', 'VERSAO_FINAL'];
const STATUS_VALIDOS = ['PENDENTE', 'EM_ANALISE', 'APROVADO'];

@Injectable()
export class DriveSyncService {
  private readonly logger = new Logger('DriveSync');
  // Cache das pastas de semestre no processo (evita um files.list por item da fila).
  private pastasSemestre = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: DriveService,
  ) {}

  // ---------- Enfileiramento (chamado pelo fluxo acadêmico) ----------

  // Upsert na chave única (tccId, chave): duas ações simultâneas sobre o mesmo alvo
  // reaproveitam a MESMA linha — nunca criam fila duplicada. Um item já CONCLUIDO volta
  // para PENDENTE (é o caso de "os dados mudaram de novo").
  async enfileirar(tccId: string, tipo: string, chave: string, documentoId?: string): Promise<void> {
    await this.prisma.syncDrive.upsert({
      where: { tccId_chave: { tccId, chave } },
      create: { tccId, tipo, chave, documentoId: documentoId ?? null },
      // Zera a reserva de propósito: se um worker estiver enviando a versão anterior deste
      // mesmo alvo, ele perde a dona da reserva e NÃO conseguirá marcar CONCLUIDO — a
      // atualização nova continua pendente e será processada depois.
      update: {
        tipo,
        documentoId: documentoId ?? null,
        status: 'PENDENTE',
        proximaTentativaEm: new Date(),
        ultimoErro: null,
        reservaId: null,
        reservadoEm: null,
      },
    });
  }

  // Chamado DEPOIS que a coordenação aprova a abertura. É o único ponto que cria pasta:
  // solicitação pendente ou recusada nunca chega aqui.
  async aoAprovarAbertura(tccId: string): Promise<void> {
    await this.enfileirar(tccId, 'PASTA', 'PASTA');
    await this.enfileirar(tccId, 'DOC_INICIAL', 'DOC_INICIAL');
    await this.enfileirar(tccId, 'DADOS', 'DADOS');
  }

  // Novo envio de monografia/versão final: sobe SÓ o arquivo novo (versões antigas ficam).
  async aoEnviarDocumento(tccId: string, documentoId: string, tipo: string): Promise<void> {
    if (!TIPOS_VERSIONADOS.includes(tipo)) return;
    if (!(await this.temPasta(tccId))) return; // antes da aprovação, nada vai para o Drive
    await this.enfileirar(tccId, 'DOCUMENTO', `DOC:${documentoId}`, documentoId);
    await this.enfileirar(tccId, 'DADOS', 'DADOS');
  }

  // Qualquer alteração relevante do TCC (notas, fase, banca, defesa...).
  async aoAlterarTcc(tccId: string): Promise<void> {
    if (!(await this.temPasta(tccId))) return;
    await this.enfileirar(tccId, 'DADOS', 'DADOS');
  }

  private async temPasta(tccId: string): Promise<boolean> {
    const p = await this.prisma.driveArquivo.findUnique({ where: { tccId_chave: { tccId, chave: 'PASTA' } } });
    if (p) return true;
    // Ainda não criada, mas já enfileirada (aprovação recente): também conta.
    const naFila = await this.prisma.syncDrive.findFirst({ where: { tccId, chave: 'PASTA' } });
    return !!naFila;
  }

  // ---------- Worker ----------

  // Tenta RESERVAR o item: updateMany condicional que só casa se ele ainda está livre
  // (PENDENTE/ERRO no prazo) ou travado há muito tempo (API reiniciou no meio do envio).
  // Quem casa exatamente 1 linha é o dono; qualquer outro worker recebe count 0 e pula.
  private async reservar(id: string, reservaId: string): Promise<boolean> {
    const agora = new Date();
    const limiteTravado = new Date(agora.getTime() - TEMPO_TRAVADO_MS);
    const r = await this.prisma.syncDrive.updateMany({
      where: {
        id,
        OR: [
          { status: { in: ['PENDENTE', 'ERRO'] }, proximaTentativaEm: { lte: agora } },
          // Recuperação: PROCESSANDO parado além do tempo limite volta a ser reservável.
          { status: 'PROCESSANDO', reservadoEm: { lt: limiteTravado } },
        ],
      },
      data: { status: 'PROCESSANDO', reservaId, reservadoEm: agora },
    });
    return r.count === 1;
  }

  async processarPendentes(): Promise<{ processados: number; falhas: number }> {
    if (!(await this.drive.conectado())) return { processados: 0, falhas: 0 };

    const agora = new Date();
    const limiteTravado = new Date(agora.getTime() - TEMPO_TRAVADO_MS);
    const itens = await this.prisma.syncDrive.findMany({
      where: {
        OR: [
          { status: { in: ['PENDENTE', 'ERRO'] }, proximaTentativaEm: { lte: agora } },
          { status: 'PROCESSANDO', reservadoEm: { lt: limiteTravado } },
        ],
      },
      orderBy: { proximaTentativaEm: 'asc' },
      take: LOTE,
    });

    let processados = 0;
    let falhas = 0;
    for (const item of itens) {
      const reservaId = randomUUID();
      if (!(await this.reservar(item.id, reservaId))) continue; // outro worker pegou

      try {
        await this.processarItem(item);
        // Só conclui se a reserva ainda é NOSSA. Se uma alteração nova chegou durante o
        // envio, o upsert do enfileirar já zerou a reserva e devolveu o item a PENDENTE —
        // marcá-lo CONCLUIDO aqui apagaria essa atualização.
        const concluiu = await this.prisma.syncDrive.updateMany({
          where: { id: item.id, reservaId },
          data: { status: 'CONCLUIDO', ultimoErro: null, tentativas: item.tentativas + 1, reservaId: null, reservadoEm: null },
        });
        // count 0 = a reserva foi invalidada por uma atualização nova: o item segue PENDENTE
        // e NÃO conta como processado (o envio recém-feito já está obsoleto).
        if (concluiu.count === 1) processados++;
      } catch (e) {
        falhas++;
        const erro = e as ErroDrive;
        const tentativas = item.tentativas + 1;
        const minutos = BACKOFF_MIN[Math.min(tentativas - 1, BACKOFF_MIN.length - 1)];
        await this.prisma.syncDrive.updateMany({
          where: { id: item.id, reservaId },
          data: {
            status: 'ERRO',
            tentativas,
            ultimoErro: erro.message?.slice(0, 500) ?? 'erro desconhecido',
            // Erro permanente também reprograma (no maior intervalo): o coordenador vê a
            // pendência na tela e pode corrigir a causa e mandar tentar de novo.
            proximaTentativaEm: new Date(Date.now() + (erro.permanente ? 1440 : minutos) * 60_000),
            reservaId: null,
            reservadoEm: null,
          },
        });
        this.logger.warn(`Sync ${item.tipo} do TCC ${item.tccId} falhou: ${erro.message}`);
      }
    }
    if (itens.length) await this.drive.registrarSync(falhas ? `${falhas} item(ns) com erro` : undefined);
    return { processados, falhas };
  }

  // Sincronização SOB DEMANDA (ao conectar o Drive e no botão "tentar de novo"):
  // reenfileira erros -> reconcilia o que existe -> processa a fila resultante. É isso que
  // faz um sistema com TCCs antigos começar a subir na hora, sem esperar a varredura diária.
  async sincronizarAgora(): Promise<{ reenfileirados: number; tccs: number; documentos: number; processados: number; falhas: number }> {
    const reenfileirados = await this.reenfileirarErros();
    const { tccs, documentos } = await this.reconciliar();
    const { processados, falhas } = await this.processarPendentes();
    return { reenfileirados, tccs, documentos, processados, falhas };
  }

  // Reconciliação diária dos TCCs ativos já aprovados: não depende de nenhum gancho ter sido
  // lembrado. Para cada TCC que já passou da aprovação da abertura, garante pasta, reenfileira
  // dados.json/resumo.txt e procura MONOGRAFIA/VERSAO_FINAL que ainda não têm DriveArquivo.
  async reconciliar(): Promise<{ tccs: number; documentos: number }> {
    if (!(await this.drive.conectado())) return { tccs: 0, documentos: 0 };

    // "Aprovado" = saiu da INICIALIZACAO. TCC excluído logicamente fica de fora.
    const tccs = await this.prisma.tcc.findMany({
      where: { excluidoEm: null, faseAtual: { not: 'INICIALIZACAO' } },
      select: { id: true },
    });

    let documentos = 0;
    for (const t of tccs) {
      await this.enfileirar(t.id, 'PASTA', 'PASTA');
      await this.enfileirar(t.id, 'DOC_INICIAL', 'DOC_INICIAL');
      await this.enfileirar(t.id, 'DADOS', 'DADOS');

      const docs = await this.prisma.documentoTcc.findMany({
        where: { tccId: t.id, tipo: { in: TIPOS_VERSIONADOS } },
        select: { id: true },
      });
      for (const d of docs) {
        const jaMapeado = await this.prisma.driveArquivo.findUnique({
          where: { tccId_chave: { tccId: t.id, chave: `DOC:${d.id}` } },
        });
        if (jaMapeado) continue;
        await this.enfileirar(t.id, 'DOCUMENTO', `DOC:${d.id}`, d.id);
        documentos++;
      }
    }
    return { tccs: tccs.length, documentos };
  }

  // Traz de volta tudo que está em ERRO (varredura diária e botão "tentar de novo").
  async reenfileirarErros(): Promise<number> {
    const { count } = await this.prisma.syncDrive.updateMany({
      where: { status: 'ERRO' },
      data: { status: 'PENDENTE', proximaTentativaEm: new Date() },
    });
    return count;
  }

  // Pendências para a tela do coordenador (sem vazar caminho de arquivo do servidor).
  async pendencias() {
    const itens = await this.prisma.syncDrive.findMany({
      where: { status: { in: ['PENDENTE', 'PROCESSANDO', 'ERRO'] } },
      orderBy: [{ status: 'asc' }, { atualizadoEm: 'desc' }],
      take: 50,
      include: { tcc: { select: { titulo: true, semestre: true, aluno: { select: { nomeCompleto: true } } } } },
    });
    return itens.map((i) => ({
      id: i.id,
      tipo: i.tipo,
      status: i.status,
      tentativas: i.tentativas,
      ultimoErro: i.ultimoErro,
      proximaTentativaEm: i.proximaTentativaEm,
      tcc: { titulo: i.tcc.titulo, semestre: i.tcc.semestre, aluno: i.tcc.aluno?.nomeCompleto ?? null },
    }));
  }

  private async processarItem(item: { tccId: string; tipo: string; documentoId: string | null }): Promise<void> {
    switch (item.tipo) {
      case 'PASTA':
        await this.garantirPastaTcc(item.tccId);
        return;
      case 'DOC_INICIAL':
        await this.enviarDocumentosIniciais(item.tccId);
        return;
      case 'DOCUMENTO':
        if (item.documentoId) await this.enviarDocumento(item.tccId, item.documentoId);
        return;
      case 'DADOS':
        await this.gravarDados(item.tccId);
        return;
      default:
        throw new ErroDrive(`Tipo de sincronização desconhecido: ${item.tipo}`, undefined, true);
    }
  }

  // ---------- Operações no Drive ----------

  private async pastaDoSemestre(semestre: string): Promise<string> {
    const cache = this.pastasSemestre.get(semestre);
    if (cache) return cache;
    const token = await this.drive.accessToken();
    const raiz = await this.drive.pastaRaizId();
    const nome = sanitizarNome(semestre, 'sem-semestre');
    const id = (await buscarPorNome(token, nome, raiz, true)) ?? (await criarPasta(token, nome, raiz));
    this.pastasSemestre.set(semestre, id);
    return id;
  }

  async garantirPastaTcc(tccId: string): Promise<string> {
    const jaTem = await this.prisma.driveArquivo.findUnique({ where: { tccId_chave: { tccId, chave: 'PASTA' } } });
    if (jaTem) return jaTem.driveId;

    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId }, include: { aluno: true } });
    if (!tcc) throw new ErroDrive('TCC não encontrado para sincronizar.', undefined, true);

    const token = await this.drive.accessToken();
    const pai = await this.pastaDoSemestre(tcc.semestre);
    const base = sanitizarNome(`${tcc.aluno?.nomeCompleto ?? 'Aluno'} - ${tcc.titulo}`, 'TCC');

    // Colisão de nome: outro TCC com mesmo aluno+título no semestre. Acrescenta sufixo até
    // achar um nome livre (limite baixo — na prática nunca passa de 2).
    let nome = base;
    for (let i = 2; i <= 20 && (await buscarPorNome(token, nome, pai, true)); i++) {
      nome = `${base} (${i})`;
    }

    const driveId = await criarPasta(token, nome, pai);
    await this.prisma.driveArquivo.create({ data: { tccId, chave: 'PASTA', driveId, nome } });
    return driveId;
  }

  // Só o Plano e o Termo VÁLIDOS MAIS RECENTES — nada de v1/v2/v3 dos iniciais.
  private async enviarDocumentosIniciais(tccId: string): Promise<void> {
    const docs = await this.prisma.documentoTcc.findMany({
      where: { tccId, tipo: { in: TIPOS_INICIAIS }, status: { in: STATUS_VALIDOS } },
      orderBy: [{ versao: 'desc' }, { criadoEm: 'desc' }],
    });
    const maisRecentePorTipo = new Map<string, (typeof docs)[number]>();
    for (const d of docs) if (!maisRecentePorTipo.has(d.tipo)) maisRecentePorTipo.set(d.tipo, d);

    for (const doc of maisRecentePorTipo.values()) {
      await this.enviarDocumento(tccId, doc.id, false);
    }
  }

  // `comVersao` = true para monografia/versão final (o nome carrega a versão, preservando
  // cada envio); false para os iniciais (nome limpo, um por tipo).
  private async enviarDocumento(tccId: string, documentoId: string, comVersao = true): Promise<void> {
    const chave = `DOC:${documentoId}`;
    const jaEnviado = await this.prisma.driveArquivo.findUnique({ where: { tccId_chave: { tccId, chave } } });
    if (jaEnviado) return; // idempotente: não reenvia o mesmo documento

    const doc = await this.prisma.documentoTcc.findUnique({ where: { id: documentoId } });
    if (!doc || doc.tccId !== tccId) throw new ErroDrive('Documento não encontrado.', undefined, true);
    if (doc.tipo === 'AVALIACAO_BANCA') return; // material interno da banca não vai ao Drive

    const caminho = join(process.cwd(), doc.caminho);
    let conteudo: Buffer;
    try {
      conteudo = await fs.readFile(caminho);
    } catch {
      // Arquivo sumiu do disco: repetir não resolve.
      throw new ErroDrive(`Arquivo local não encontrado: ${doc.caminho}`, undefined, true);
    }

    const ext = extname(doc.nomeArquivo || '').toLowerCase();
    const rotulo = ROTULO_DOC[doc.tipo] ?? doc.tipo;
    const nome = sanitizarNome(`${rotulo}${comVersao ? ` v${doc.versao}` : ''}${ext}`, `documento${ext}`);

    const token = await this.drive.accessToken();
    const pasta = await this.garantirPastaTcc(tccId);
    const driveId = await enviarArquivo(token, {
      nome,
      mimeType: MIME_POR_EXT[ext] ?? 'application/octet-stream',
      conteudo,
      paiId: pasta,
    });
    await this.prisma.driveArquivo.create({ data: { tccId, chave, driveId, nome } });
  }

  // dados.json + resumo.txt: criados na primeira vez, SOBRESCRITOS depois (não viram cópias).
  async gravarDados(tccId: string): Promise<void> {
    const { dados, resumo } = await this.montarConteudo(tccId);
    const token = await this.drive.accessToken();
    const pasta = await this.garantirPastaTcc(tccId);

    const alvos = [
      { chave: 'DADOS_JSON', nome: 'dados.json', mime: 'application/json', corpo: Buffer.from(JSON.stringify(dados, null, 2), 'utf8') },
      { chave: 'RESUMO_TXT', nome: 'resumo.txt', mime: 'text/plain', corpo: Buffer.from(resumo, 'utf8') },
    ];
    for (const alvo of alvos) {
      const existente = await this.prisma.driveArquivo.findUnique({
        where: { tccId_chave: { tccId, chave: alvo.chave } },
      });
      if (existente) {
        await atualizarConteudo(token, existente.driveId, alvo.mime, alvo.corpo);
      } else {
        const driveId = await enviarArquivo(token, { nome: alvo.nome, mimeType: alvo.mime, conteudo: alvo.corpo, paiId: pasta });
        await this.prisma.driveArquivo.create({ data: { tccId, chave: alvo.chave, driveId, nome: alvo.nome } });
      }
    }
  }

  // Monta o snapshot a partir do banco (reaproveitado pelo encerramento do período).
  async montarConteudo(tccId: string): Promise<{ dados: any; resumo: string }> {
    const tcc = await this.prisma.tcc.findUnique({
      where: { id: tccId },
      include: {
        aluno: { select: { nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        coorientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        documentos: { orderBy: [{ criadoEm: 'asc' }] },
        solicitacoes: { orderBy: { criadoEm: 'asc' } },
        bancas: {
          include: {
            membros: {
              include: {
                avaliador: { select: { id: true, nomeCompleto: true, tratamento: true, papel: true, afiliacao: true } },
              },
            },
          },
        },
      },
    });
    if (!tcc) throw new ErroDrive('TCC não encontrado para gerar o snapshot.', undefined, true);
    const calendario = await this.prisma.calendario.findFirst({ where: { semestre: tcc.semestre } });
    const dados = montarSnapshot(tcc, calendario);
    return { dados, resumo: montarResumo(dados) };
  }
}
