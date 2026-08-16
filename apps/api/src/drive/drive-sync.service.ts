import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { DriveService } from './drive.service';
import { sanitizarNome } from './cripto-drive';
import { montarResumo, montarSnapshot } from './snapshot-tcc';
import { createHash } from 'crypto';
import {
  ErroDrive,
  MIME_PASTA,
  atualizarConteudo,
  buscarPastaPorMarca,
  buscarPorNome,
  conferirRemoto,
  criarPasta,
  enviarArquivo,
  listarFilhos,
  metadadosArquivo,
  moverParaLixeira,
  moverParaPasta,
  renomearArquivo,
} from './drive-api';

// Plano e Termo ficam numa chave por TIPO (não por documento): o Drive guarda só a cópia
// VÁLIDA ATUAL de cada um, atualizada no lugar, em vez de acumular v1/v2/v3.
const chaveInicial = (tipo: string) => `INICIAL:${tipo}`;

// md5 do conteúdo local, para comparar com o md5Checksum que o Google devolve. Igual =
// não sobe nada; diferente = atualiza o conteúdo do MESMO arquivo remoto.
const md5De = (conteudo: Buffer) => createHash('md5').update(conteudo).digest('hex');

// Marcas privadas (appProperties) gravadas nas pastas que o sistema cria. São a identidade
// DURÁVEL da pasta: sobrevivem a reinício da API e permitem reencontrar uma pasta criada no
// Google mas ainda não mapeada no banco — a janela exata que duplicou pasta em produção.
const MARCA_TCC = 'sistemaTccId';
const MARCA_SEMESTRE = 'sistemaTccSemestre';

// Limpeza de pasta duplicada por corrida. Vira item da MESMA fila (SyncDrive) em vez de
// timer ou Map: assim sobrevive a reinício da API e herda backoff, reserva e a tela de
// pendências que já existem. A chave carrega o id da pasta, então o unique (tccId, chave)
// garante uma limpeza por pasta duplicada.
const TIPO_LIMPEZA = 'LIMPAR_PASTA_DUPLICADA';
const PREFIXO_LIMPEZA = 'LIXEIRA:';

// Backoff por tentativa (minutos). Depois do último, repete no maior intervalo — a varredura
// diária ainda reenfileira, então nada fica parado para sempre.
const BACKOFF_MIN = [1, 5, 15, 60, 240, 1440];
const LOTE = 10; // itens por lote
// Teto de lotes numa sincronização (diária ou botão): 10 × 200 = 2000 itens por rodada.
const MAX_RODADAS = 200;
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
  // Uma fila por chave lógica ("pasta do TCC X", "pasta do semestre Y"). A reserva do
  // SyncDrive protege a mesma LINHA da fila; isto aqui protege o mesmo RECURSO no Drive,
  // que é o que PASTA, DOC_INICIAL, DOCUMENTO e DADOS disputavam ao chamar
  // garantirPastaTcc() em paralelo.
  private filaPorChave = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: DriveService,
  ) {}

  // Serializa, dentro do processo, tudo que roda sob a mesma chave. Encadeia no que já
  // estiver na fila — inclusive se aquilo falhar (`.then(fn, fn)`), senão um erro travaria
  // a chave para sempre.
  private comExclusividade<T>(chave: string, fn: () => Promise<T>): Promise<T> {
    const anterior = this.filaPorChave.get(chave) ?? Promise.resolve();
    const resultado = anterior.then(fn, fn);
    // A fila guarda uma versão neutralizada: a falha de um não pode rejeitar o próximo.
    const naFila = resultado.then(
      () => undefined,
      () => undefined,
    );
    this.filaPorChave.set(chave, naFila);
    void naFila.then(() => {
      if (this.filaPorChave.get(chave) === naFila) this.filaPorChave.delete(chave);
    });
    return resultado;
  }

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

    // DRENA a fila, em vez de processar um lote só. Antes o worker de 60s ia consumindo aos
    // poucos; agora as rodadas são a diária e o botão "Atualizar", então cada uma precisa
    // levar o trabalho até o fim. O teto evita rodar para sempre se algo reenfileirar em
    // laço — o que sobrar volta na próxima rodada.
    let processados = 0;
    let falhas = 0;
    for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
      const r = await this.processarPendentes();
      processados += r.processados;
      falhas += r.falhas;
      if (r.processados + r.falhas === 0) break; // fila vazia
    }
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

  private async processarItem(item: { tccId: string; tipo: string; chave: string; documentoId: string | null }): Promise<void> {
    switch (item.tipo) {
      case 'PASTA':
        await this.sincronizarPastaTcc(item.tccId);
        return;
      case TIPO_LIMPEZA:
        await this.limparPastaDuplicada(item.tccId, item.chave.slice(PREFIXO_LIMPEZA.length));
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

  // Uma pasta por semestre, mesmo com dois TCCs abrindo ao mesmo tempo: a fila por chave
  // serializa no processo e a marca privada reencontra a pasta depois de um reinício.
  private async pastaDoSemestre(semestre: string): Promise<string> {
    const cache = this.pastasSemestre.get(semestre);
    if (cache) return cache;

    return this.comExclusividade(`semestre:${semestre}`, async () => {
      // Quem esperou na fila já encontra o cache preenchido por quem passou antes.
      const jaResolvido = this.pastasSemestre.get(semestre);
      if (jaResolvido) return jaResolvido;

      const token = await this.drive.accessToken();
      const raiz = await this.drive.pastaRaizId();
      const nome = sanitizarNome(semestre, 'sem-semestre');
      const marcada = await buscarPastaPorMarca(token, MARCA_SEMESTRE, semestre, raiz);
      const id =
        marcada?.id ??
        // Compatibilidade: pastas criadas antes das marcas só têm o nome.
        (await buscarPorNome(token, nome, raiz, true)) ??
        (await criarPasta(token, nome, raiz, { [MARCA_SEMESTRE]: semestre }));
      this.pastasSemestre.set(semestre, id);
      return id;
    });
  }

  // Uma pasta por TCC. Idempotente em três camadas, nesta ordem:
  //   1. mapeamento no banco (caso normal, sem custo de rede);
  //   2. fila por chave, que impede PASTA/DOC_INICIAL/DADOS de criarem em paralelo;
  //   3. marca privada no Drive, que reencontra a pasta se a API caiu entre o Google criar
  //      e o banco gravar — e, se ainda assim duas forem criadas, a sobrando vai para a
  //      lixeira em vez de virar órfã.
  async garantirPastaTcc(tccId: string): Promise<string> {
    return this.comExclusividade(`pasta:${tccId}`, () => this.resolverPastaTcc(tccId));
  }

  private async resolverPastaTcc(tccId: string): Promise<string> {
    const jaTem = await this.prisma.driveArquivo.findUnique({ where: { tccId_chave: { tccId, chave: 'PASTA' } } });
    if (jaTem) {
      // O ID mapeado é a identidade. Só ele decide — nunca o nome, nunca a conta.
      const token = await this.drive.accessToken();
      const estado = await conferirRemoto(token, jaTem.driveId); // exceção = instabilidade: sobe e tenta depois
      if (estado.estado === 'ACESSIVEL' && estado.meta.mimeType === MIME_PASTA) return jaTem.driveId;

      // O Google confirmou que essa pasta não serve mais para a conta de agora: refaz a
      // cópia DESTE TCC do zero. Os ponteiros locais são descartados (nada é apagado lá).
      this.logger.warn(
        `Pasta ${jaTem.driveId} do TCC ${tccId} inacessível (${estado.estado === 'AUSENTE' ? estado.motivo : 'não é pasta'}): recriando a cópia deste TCC.`,
      );
      await this.prisma.driveArquivo.deleteMany({ where: { tccId } });
      await this.enfileirarReconstrucao(tccId);
    }

    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId }, include: { aluno: true } });
    if (!tcc) throw new ErroDrive('TCC não encontrado para sincronizar.', undefined, true);

    const token = await this.drive.accessToken();

    // Pasta já criada no Google numa tentativa anterior que não chegou a gravar no banco.
    const marcada = await buscarPastaPorMarca(token, MARCA_TCC, tccId);
    if (marcada) return this.mapearPastaTcc(tccId, marcada.id, marcada.nome, token);

    const pai = await this.pastaDoSemestre(tcc.semestre);
    const base = sanitizarNome(`${tcc.aluno?.nomeCompleto ?? 'Aluno'} - ${tcc.titulo}`, 'TCC');

    // Colisão de nome: outro TCC com mesmo aluno+título no semestre. Acrescenta sufixo até
    // achar um nome livre (limite baixo — na prática nunca passa de 2).
    let nome = base;
    for (let i = 2; i <= 20 && (await buscarPorNome(token, nome, pai, true)); i++) {
      nome = `${base} (${i})`;
    }

    const driveId = await criarPasta(token, nome, pai, { [MARCA_TCC]: tccId });
    return this.mapearPastaTcc(tccId, driveId, nome, token);
  }

  // Grava o mapeamento. Se outro processo chegou primeiro (unique em tccId+chave), fica com
  // a pasta DELE e manda a nossa para a lixeira — capturar o erro e seguir era justamente o
  // que deixava pasta órfã no Drive.
  private async mapearPastaTcc(tccId: string, driveId: string, nome: string, token: string): Promise<string> {
    try {
      await this.prisma.driveArquivo.create({ data: { tccId, chave: 'PASTA', driveId, nome } });
      return driveId;
    } catch (e) {
      const dono = await this.prisma.driveArquivo.findUnique({
        where: { tccId_chave: { tccId, chave: 'PASTA' } },
      });
      if (!dono) throw e; // não era corrida: o erro é outro e precisa subir
      if (dono.driveId !== driveId) {
        try {
          await moverParaLixeira(token, driveId);
          this.logger.warn(`Corrida na pasta do TCC ${tccId}: ${driveId} foi para a lixeira; vale ${dono.driveId}.`);
        } catch {
          // O mapeamento correto JÁ existe e não pode ser desfeito por causa da limpeza.
          // A pasta sobrando vira item de fila: o worker tenta de novo no backoff normal e
          // a pendência sobrevive a reinício da API.
          await this.enfileirarLimpeza(tccId, driveId);
        }
      }
      return dono.driveId;
    }
  }

  // Nome padronizado da pasta do TCC. É rótulo, não identidade — serve para renomear.
  private nomeDaPasta(tcc: { titulo: string; aluno?: { nomeCompleto: string } | null }): string {
    return sanitizarNome(`${tcc.aluno?.nomeCompleto ?? 'Aluno'} - ${tcc.titulo}`, 'TCC');
  }

  // Recoloca na fila tudo que compõe a cópia de UM TCC (usado quando a pasta dele sumiu).
  private async enfileirarReconstrucao(tccId: string): Promise<void> {
    await this.enfileirar(tccId, 'DOC_INICIAL', 'DOC_INICIAL');
    await this.enfileirar(tccId, 'DADOS', 'DADOS');
    const docs = await this.prisma.documentoTcc.findMany({
      where: { tccId, tipo: { in: TIPOS_VERSIONADOS } },
      select: { id: true },
    });
    for (const d of docs) await this.enfileirar(tccId, 'DOCUMENTO', `DOC:${d.id}`, d.id);
  }

  // Item PASTA da fila: garante a pasta e mantém nome e semestre em dia. Renomear e mover
  // NUNCA criam pasta nova — é sempre o mesmo id.
  private async sincronizarPastaTcc(tccId: string): Promise<void> {
    const driveId = await this.garantirPastaTcc(tccId);
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId }, include: { aluno: true } });
    if (!tcc) return;

    const token = await this.drive.accessToken();
    const estado = await conferirRemoto(token, driveId);
    if (estado.estado !== 'ACESSIVEL') return; // acabou de ser recriada: já está no lugar certo

    // Aluno ou título mudaram: mesma pasta, nome novo.
    const nomeEsperado = this.nomeDaPasta(tcc);
    const nomeAtual = estado.meta.nome;
    // Respeita o sufixo de desempate "(2)" dado na criação: só renomeia se a base mudou.
    const semSufixo = nomeAtual.replace(/ \(\d+\)$/, '');
    if (semSufixo !== nomeEsperado) {
      const novo = nomeAtual === semSufixo ? nomeEsperado : `${nomeEsperado}${nomeAtual.slice(semSufixo.length)}`;
      await renomearArquivo(token, driveId, novo);
      await this.prisma.driveArquivo.updateMany({ where: { tccId, chave: 'PASTA' }, data: { nome: novo } });
      this.logger.log(`Pasta do TCC ${tccId} renomeada para "${novo}".`);
    }

    // Semestre mudou por edição da coordenação: move a MESMA pasta, sem copiar.
    const paiCerto = await this.pastaDoSemestre(tcc.semestre);
    if (!estado.meta.pais.includes(paiCerto)) {
      await moverParaPasta(token, driveId, paiCerto, estado.meta.pais);
      this.logger.log(`Pasta do TCC ${tccId} movida para o semestre ${tcc.semestre}.`);
    }
  }

  // Registra a limpeza pendente. Nunca deixa a exceção escapar: quem chama já garantiu a
  // pasta correta e não pode falhar por causa da faxina.
  private async enfileirarLimpeza(tccId: string, driveId: string): Promise<void> {
    try {
      await this.enfileirar(tccId, TIPO_LIMPEZA, `${PREFIXO_LIMPEZA}${driveId}`);
      this.logger.warn(
        `Pasta duplicada ${driveId} do TCC ${tccId} não pôde ir para a lixeira agora: limpeza enfileirada.`,
      );
    } catch (e) {
      this.logger.error(
        `Não foi possível enfileirar a limpeza da pasta duplicada ${driveId} do TCC ${tccId}: ${(e as Error).message}`,
      );
    }
  }

  // Faxina de uma pasta duplicada. Move para a LIXEIRA (recuperável) e só depois de provar,
  // uma a uma, que a candidata é mesmo descartável. Na dúvida NÃO mexe: preferimos uma pasta
  // sobrando no Drive a qualquer risco de tocar na pasta que está valendo.
  private async limparPastaDuplicada(tccId: string, driveId: string): Promise<void> {
    if (!driveId) throw new ErroDrive('Limpeza sem id de pasta.', undefined, true);

    // 1) A pasta que vale NUNCA pode ser candidata — nem por outra chave qualquer.
    const emUso = await this.prisma.driveArquivo.findFirst({ where: { driveId } });
    if (emUso) {
      this.logger.log(`Limpeza cancelada: ${driveId} está mapeada (${emUso.chave}) no TCC ${emUso.tccId}.`);
      return;
    }

    const token = await this.drive.accessToken();
    let meta;
    try {
      meta = await metadadosArquivo(token, driveId);
    } catch (e) {
      const erro = e as ErroDrive;
      // Sumiu do Drive: não há o que limpar. Qualquer outra falha (rede, 5xx) volta pelo
      // backoff normal em vez de virar "concluído" sem ter conferido nada.
      if (erro.status === 404) {
        this.logger.log(`Limpeza concluída: pasta ${driveId} não existe mais.`);
        return;
      }
      throw erro;
    }

    // 2) Já na lixeira: objetivo atingido, conclui sem erro.
    if (meta.trashed) {
      this.logger.log(`Limpeza concluída: pasta ${driveId} já estava na lixeira.`);
      return;
    }

    // 3) Precisa ser uma pasta E carregar a marca privada DESTE TCC. Sem a marca não dá para
    //    afirmar que foi o sistema que criou por corrida — vira análise manual.
    if (meta.mimeType !== MIME_PASTA) {
      throw new ErroDrive(`Limpeza recusada: ${driveId} não é uma pasta (${meta.mimeType}).`, undefined, true);
    }
    if (meta.marcas[MARCA_TCC] !== tccId) {
      throw new ErroDrive(
        `Limpeza recusada: a pasta ${driveId} não tem a marca do TCC ${tccId}. Verifique manualmente.`,
        undefined,
        true,
      );
    }

    // 4) Vazia. Com conteúdo, nada é movido automaticamente: alguém pode ter posto algo lá.
    const filhos = await listarFilhos(token, driveId);
    if (filhos.length > 0) {
      throw new ErroDrive(
        `Limpeza recusada: a pasta duplicada ${driveId} do TCC ${tccId} tem ${filhos.length} item(ns) ` +
          `(${filhos.map((f) => f.nome).slice(0, 5).join(', ')}). Nada foi movido — confira manualmente.`,
        undefined,
        true,
      );
    }

    await moverParaLixeira(token, driveId);
    this.logger.log(`Pasta duplicada ${driveId} do TCC ${tccId} movida para a lixeira.`);
  }

  // Coração da cópia de UM arquivo. O local é a verdade; o remoto é espelho:
  //   sem mapeamento          -> envia e mapeia;
  //   mapeado e AUSENTE       -> reenvia e REAPROVEITA a linha do mapeamento;
  //   mapeado e igual (md5)   -> não faz nada (nem upload, nem escrita);
  //   mapeado e diferente     -> atualiza o CONTEÚDO do mesmo arquivo remoto;
  //   instabilidade           -> exceção, para tentar de novo depois.
  private async espelharArquivo(
    tccId: string,
    chave: string,
    alvo: { nome: string; mime: string; conteudo: Buffer },
  ): Promise<void> {
    const token = await this.drive.accessToken();
    const mapeado = await this.prisma.driveArquivo.findUnique({ where: { tccId_chave: { tccId, chave } } });

    if (mapeado) {
      const estado = await conferirRemoto(token, mapeado.driveId);
      if (estado.estado === 'ACESSIVEL') {
        const igual =
          estado.meta.md5 != null
            ? estado.meta.md5 === md5De(alvo.conteudo)
            : estado.meta.tamanho === alvo.conteudo.length;
        if (igual) return; // já espelhado: não reenvia nem sobrescreve
        await atualizarConteudo(token, mapeado.driveId, alvo.mime, alvo.conteudo);
        if (estado.meta.nome !== alvo.nome) await renomearArquivo(token, mapeado.driveId, alvo.nome);
        await this.prisma.driveArquivo.update({ where: { id: mapeado.id }, data: { nome: alvo.nome } });
        return;
      }
      // Sumiu lá: refaz só este arquivo e reaproveita a linha (o unique é tccId+chave).
      const pasta = await this.garantirPastaTcc(tccId);
      const driveId = await enviarArquivo(token, { nome: alvo.nome, mimeType: alvo.mime, conteudo: alvo.conteudo, paiId: pasta });
      await this.prisma.driveArquivo.update({ where: { id: mapeado.id }, data: { driveId, nome: alvo.nome } });
      this.logger.log(`Arquivo "${alvo.nome}" do TCC ${tccId} não estava mais no Drive: reenviado.`);
      return;
    }

    const pasta = await this.garantirPastaTcc(tccId);
    const driveId = await enviarArquivo(token, { nome: alvo.nome, mimeType: alvo.mime, conteudo: alvo.conteudo, paiId: pasta });
    await this.prisma.driveArquivo.create({ data: { tccId, chave, driveId, nome: alvo.nome } });
  }

  private async lerArquivoLocal(caminho: string): Promise<Buffer> {
    try {
      return await fs.readFile(join(process.cwd(), caminho));
    } catch {
      // Arquivo sumiu do disco: repetir não resolve.
      throw new ErroDrive(`Arquivo local não encontrado: ${caminho}`, undefined, true);
    }
  }

  // Plano e Termo: SÓ a cópia válida atual, numa chave por TIPO. Quando o aluno reenvia, o
  // mesmo arquivo do Drive é atualizado no lugar — nada de "Plano v1", "Plano v2"...
  private async enviarDocumentosIniciais(tccId: string): Promise<void> {
    const docs = await this.prisma.documentoTcc.findMany({
      where: { tccId, tipo: { in: TIPOS_INICIAIS }, status: { in: STATUS_VALIDOS } },
      orderBy: [{ versao: 'desc' }, { criadoEm: 'desc' }],
    });
    const maisRecentePorTipo = new Map<string, (typeof docs)[number]>();
    for (const d of docs) if (!maisRecentePorTipo.has(d.tipo)) maisRecentePorTipo.set(d.tipo, d);

    for (const doc of maisRecentePorTipo.values()) {
      const chave = chaveInicial(doc.tipo);
      await this.adotarMapeamentoLegado(tccId, doc.id, chave);
      const ext = extname(doc.nomeArquivo || '').toLowerCase();
      const nome = sanitizarNome(`${ROTULO_DOC[doc.tipo] ?? doc.tipo}${ext}`, `documento${ext}`);
      const conteudo = await this.lerArquivoLocal(doc.caminho);
      await this.comExclusividade(`doc:${tccId}:${chave}`, () =>
        this.espelharArquivo(tccId, chave, { nome, mime: MIME_POR_EXT[ext] ?? 'application/octet-stream', conteudo }),
      );
    }
  }

  // Instalações antigas mapeavam Plano/Termo por documento (`DOC:<id>`). Migra a linha para
  // a chave por tipo REAPROVEITANDO o mesmo arquivo do Drive — sem isso, a primeira
  // sincronização depois desta mudança criaria um segundo arquivo com o mesmo nome.
  private async adotarMapeamentoLegado(tccId: string, documentoId: string, chaveNova: string): Promise<void> {
    const jaMigrado = await this.prisma.driveArquivo.findUnique({ where: { tccId_chave: { tccId, chave: chaveNova } } });
    if (jaMigrado) return;
    const legado = await this.prisma.driveArquivo.findUnique({
      where: { tccId_chave: { tccId, chave: `DOC:${documentoId}` } },
    });
    if (!legado) return;
    await this.prisma.driveArquivo.update({ where: { id: legado.id }, data: { chave: chaveNova } });
  }

  // Monografia e versão final: cada versão é um arquivo próprio, preservado.
  private enviarDocumento(tccId: string, documentoId: string): Promise<void> {
    // Mesmo cuidado da pasta: dois itens da fila mirando o mesmo documento não podem subir
    // duas cópias e deixar uma sem mapeamento.
    return this.comExclusividade(`doc:${tccId}:${documentoId}`, () => this.enviarDocumentoExclusivo(tccId, documentoId));
  }

  private async enviarDocumentoExclusivo(tccId: string, documentoId: string): Promise<void> {
    const doc = await this.prisma.documentoTcc.findUnique({ where: { id: documentoId } });
    if (!doc || doc.tccId !== tccId) throw new ErroDrive('Documento não encontrado.', undefined, true);
    if (doc.tipo === 'AVALIACAO_BANCA') return; // material interno da banca não vai ao Drive

    const ext = extname(doc.nomeArquivo || '').toLowerCase();
    const nome = sanitizarNome(`${ROTULO_DOC[doc.tipo] ?? doc.tipo} v${doc.versao}${ext}`, `documento${ext}`);
    await this.espelharArquivo(tccId, `DOC:${documentoId}`, {
      nome,
      mime: MIME_POR_EXT[ext] ?? 'application/octet-stream',
      conteudo: await this.lerArquivoLocal(doc.caminho),
    });
  }

  // dados.json + resumo.txt: um arquivo cada, atualizado só quando o conteúdo muda de fato.
  gravarDados(tccId: string): Promise<void> {
    return this.comExclusividade(`dados:${tccId}`, () => this.gravarDadosExclusivo(tccId));
  }

  private async gravarDadosExclusivo(tccId: string): Promise<void> {
    const { dados, resumo } = await this.montarConteudo(tccId);
    const alvos = [
      { chave: 'DADOS_JSON', nome: 'dados.json', mime: 'application/json', conteudo: Buffer.from(JSON.stringify(dados, null, 2), 'utf8') },
      { chave: 'RESUMO_TXT', nome: 'resumo.txt', mime: 'text/plain', conteudo: Buffer.from(resumo, 'utf8') },
    ];
    for (const alvo of alvos) {
      await this.espelharArquivo(tccId, alvo.chave, { nome: alvo.nome, mime: alvo.mime, conteudo: alvo.conteudo });
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
