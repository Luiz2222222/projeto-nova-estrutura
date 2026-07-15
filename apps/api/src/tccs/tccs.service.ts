import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { EventosTccService } from '../eventos-tcc/eventos-tcc.service';
import { PrazosService } from '../prazos/prazos.service';
import { corrigirNomeArquivo } from '../comum/nome-arquivo';
import { sanitizarNotasTcc, ocultarRascunho, FASES_NOTAS_LIBERADAS } from '../comum/sanitizar-notas';
import { resolverSemestreAtivo } from '../comum/semestre';
import { buscarTccAtivoOuFalhar } from '../comum/tcc-ativo';
import { conteudoCompativel } from '../comum/assinatura-arquivo';
import { FASES, arquivoPermitidoParaTipo, formatoDoTipoDoc, PESO_NF1, PESO_NF2 } from '@tcc/compartilhado';
import type { DadosAbrirTcc, DadosEditarTcc, DadosEditarDocumento } from '@tcc/compartilhado';

@Injectable()
export class TccsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosTccService,
    private readonly prazos: PrazosService,
  ) {}

  professoresDisponiveis() {
    return this.prisma.usuario.findMany({
      where: { papel: 'PROFESSOR', disponivelParaOrientar: true },
      select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true },
      orderBy: { nomeCompleto: 'asc' },
    });
  }

  coorientadores() {
    return this.prisma.usuario.findMany({
      where: { papel: { in: ['PROFESSOR', 'AVALIADOR', 'COORDENADOR'] } },
      select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true, papel: true },
      orderBy: { nomeCompleto: 'asc' },
    });
  }

  // Edição administrativa do TCC pelo coordenador (atualização parcial). Valida papéis
  // dos usuários e a unique (alunoId, semestre). NÃO mexe em bancas, documentos,
  // solicitações ou avaliações; salva a fase escolhida sem criar/apagar banca.
  async editarTcc(tccId: string, dados: DadosEditarTcc) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);

    const data: Record<string, unknown> = {};
    if (dados.titulo !== undefined) data.titulo = dados.titulo;
    if (dados.semestre !== undefined) data.semestre = dados.semestre;
    if (dados.faseAtual !== undefined) {
      if (!(FASES as readonly string[]).includes(dados.faseAtual)) {
        throw new BadRequestException({ mensagem: 'Fase inválida.' });
      }
      data.faseAtual = dados.faseAtual;
      // Ao DESCONTINUAR, guarda a fase em que o TCC estava (para restaurar depois); ao sair de
      // DESCONTINUADO, limpa a fase preservada.
      if (dados.faseAtual === 'DESCONTINUADO') {
        if (tcc.faseAtual !== 'DESCONTINUADO') data.faseAnteriorDescontinuacao = tcc.faseAtual;
      } else {
        data.faseAnteriorDescontinuacao = null;
      }
    }
    if (dados.monografiaAprovada !== undefined) data.monografiaAprovada = dados.monografiaAprovada;
    if (dados.continuidadeConfirmada !== undefined) data.continuidadeConfirmada = dados.continuidadeConfirmada;
    if (dados.parecerContinuidade !== undefined) data.parecerContinuidade = dados.parecerContinuidade || null;
    if (dados.nf1 !== undefined) data.nf1 = dados.nf1;
    if (dados.nf2 !== undefined) data.nf2 = dados.nf2;
    if (dados.nf !== undefined) data.nf = dados.nf;
    if (dados.resultado !== undefined) {
      const r = dados.resultado || null;
      if (r && !['APROVADO', 'REPROVADO'].includes(r)) {
        throw new BadRequestException({ mensagem: 'Resultado inválido.' });
      }
      data.resultado = r;
    }

    if (dados.alunoId !== undefined) {
      const aluno = await this.prisma.usuario.findUnique({ where: { id: dados.alunoId } });
      if (!aluno || aluno.papel !== 'ALUNO') {
        throw new BadRequestException({ mensagem: 'Aluno inválido (precisa ser um usuário do tipo aluno).' });
      }
      data.alunoId = dados.alunoId;
    }
    if (dados.orientadorId !== undefined) {
      if (!dados.orientadorId) {
        // Sem orientador o fluxo trava: é ele quem aprova monografia/continuidade, libera a
        // defesa e compõe a banca da Fase II. Todo TCC ativo precisa ter um orientador.
        throw new BadRequestException({ mensagem: 'O TCC precisa ter um orientador — escolha outro em vez de remover.' });
      }
      const o = await this.prisma.usuario.findUnique({ where: { id: dados.orientadorId } });
      if (!o || !['PROFESSOR', 'COORDENADOR'].includes(o.papel)) {
        throw new BadRequestException({ mensagem: 'Orientador inválido (precisa ser professor ou coordenador).' });
      }
      data.orientadorId = dados.orientadorId;
    }
    if (dados.coorientadorId !== undefined) {
      if (!dados.coorientadorId) data.coorientadorId = null;
      else {
        const co = await this.prisma.usuario.findUnique({ where: { id: dados.coorientadorId } });
        if (!co || !['PROFESSOR', 'AVALIADOR', 'COORDENADOR'].includes(co.papel)) {
          throw new BadRequestException({ mensagem: 'Coorientador inválido.' });
        }
        data.coorientadorId = dados.coorientadorId;
      }
    }
    for (const k of ['coorientadorNome', 'coorientadorTitulacao', 'coorientadorAfiliacao', 'coorientadorLattes'] as const) {
      if (dados[k] !== undefined) data[k] = dados[k] || null;
    }

    // Orientador e coorientador interno não podem ser a mesma pessoa.
    const novoOrient = data.orientadorId !== undefined ? (data.orientadorId as string | null) : tcc.orientadorId;
    const novoCoor = data.coorientadorId !== undefined ? (data.coorientadorId as string | null) : tcc.coorientadorId;
    if (novoOrient && novoCoor && novoOrient === novoCoor) {
      throw new BadRequestException({ mensagem: 'O coorientador deve ser diferente do orientador.' });
    }

    // Respeita a unique (alunoId, semestre).
    const novoAluno = (data.alunoId as string) ?? tcc.alunoId;
    const novoSem = (data.semestre as string) ?? tcc.semestre;
    if (novoAluno !== tcc.alunoId || novoSem !== tcc.semestre) {
      const conflito = await this.prisma.tcc.findFirst({
        where: { alunoId: novoAluno, semestre: novoSem, NOT: { id: tccId } },
      });
      if (conflito) throw new BadRequestException({ mensagem: 'Já existe um TCC para este aluno neste semestre.' });
    }

    // ----- Coerência com as bancas (mesma transação da gravação) -----
    return this.prisma.$transaction(async (tx) => {
      const bancas = await tx.banca.findMany({ where: { tccId }, include: { membros: true } });
      const trocouOrientador = data.orientadorId !== undefined && data.orientadorId !== tcc.orientadorId;

      // Ninguém pode ser juiz e parte: o novo orientador/coorientador não pode já ser
      // avaliador em banca deste TCC (a vaga do orientador na Fase II é criada pela
      // sincronização abaixo — o orientador ATUAL, membro legítimo da F2, não conta).
      const ehAvaliadorDoTcc = (userId: string | null) =>
        !!userId && bancas.some((b) => b.membros.some((m) => m.avaliadorId === userId && m.avaliadorId !== tcc.orientadorId));
      if (trocouOrientador && ehAvaliadorDoTcc(novoOrient)) {
        throw new BadRequestException({ mensagem: 'O novo orientador já é avaliador na banca deste TCC — escolha outra pessoa ou troque antes os avaliadores.' });
      }
      if (data.coorientadorId !== undefined && ehAvaliadorDoTcc(novoCoor)) {
        throw new BadRequestException({ mensagem: 'O novo coorientador já é avaliador na banca deste TCC.' });
      }

      // Troca de orientador com banca da Fase II existente → sincroniza a composição
      // (a F2 é sempre orientador + os 2 avaliadores da Fase I). Antes, o antigo continuava
      // avaliador da defesa e o novo ficava de fora — estado impossível.
      if (trocouOrientador) {
        const bancaF2 = bancas.find((b) => b.fase === 'FASE_2');
        const membroAntigo = bancaF2?.membros.find((m) => m.avaliadorId === tcc.orientadorId);
        if (membroAntigo) {
          const jaAvaliou = membroAntigo.nota != null || membroAntigo.status !== 'PENDENTE';
          if (jaAvaliou) {
            // Não descartamos silenciosamente uma avaliação oficial já registrada: o
            // coordenador decide o destino dela primeiro (zerar/editar) e então troca.
            throw new BadRequestException({
              mensagem: 'O orientador atual já registrou avaliação na banca da Fase II. ' +
                'Edite/zere essa avaliação (em Bancas → editar avaliação, status "Pendente") antes de trocar o orientador.',
            });
          }
          await tx.membroBanca.delete({ where: { id: membroAntigo.id } });
        }
        if (bancaF2) {
          await tx.membroBanca.create({ data: { bancaId: bancaF2.id, avaliadorId: data.orientadorId as string } });
        }
      }

      return tx.tcc.update({ where: { id: tccId }, data });
    });
  }

  // Edita metadados de um documento do TCC (não substitui o arquivo). Coordenador.
  async editarDocumento(docId: string, dados: DadosEditarDocumento) {
    const doc = await this.prisma.documentoTcc.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException();
    await buscarTccAtivoOuFalhar(this.prisma, doc.tccId); // bloqueia edição em TCC excluído
    const TIPOS_DOC = ['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE', 'MONOGRAFIA', 'VERSAO_FINAL', 'AVALIACAO_BANCA'];
    const STATUS_DOC = ['PENDENTE', 'EM_ANALISE', 'APROVADO', 'REJEITADO', 'SUBSTITUIDA'];
    if (dados.tipo !== undefined && !TIPOS_DOC.includes(dados.tipo)) {
      throw new BadRequestException({ mensagem: 'Tipo de documento inválido.' });
    }
    if (dados.status !== undefined && !STATUS_DOC.includes(dados.status)) {
      throw new BadRequestException({ mensagem: 'Status de documento inválido.' });
    }
    const data: Record<string, unknown> = {};
    if (dados.tipo !== undefined) data.tipo = dados.tipo;
    if (dados.status !== undefined) data.status = dados.status;
    if (dados.parecer !== undefined) data.parecer = dados.parecer || null;
    if (dados.versao !== undefined) data.versao = dados.versao;
    if (dados.nomeArquivo !== undefined) data.nomeArquivo = dados.nomeArquivo;
    return this.prisma.documentoTcc.update({ where: { id: docId }, data });
  }

  private static readonly TIPOS_DOC = ['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE', 'MONOGRAFIA', 'VERSAO_FINAL', 'AVALIACAO_BANCA'];
  private static readonly STATUS_DOC = ['PENDENTE', 'EM_ANALISE', 'APROVADO', 'REJEITADO', 'SUBSTITUIDA'];

  // Próxima versão de um tipo de documento dentro do TCC (versionamento automático).
  private async proximaVersao(tccId: string, tipo: string) {
    return (await this.prisma.documentoTcc.count({ where: { tccId, tipo } })) + 1;
  }

  // Coordenador adiciona administrativamente um documento ao TCC (upload). Versão automática.
  // Reaproveita o mesmo padrão seguro de gravação (nome interno aleatório, original como metadado).
  async adicionarDocumentoAdmin(tccId: string, tipo: string, status: string | undefined, parecer: string | undefined, arquivo: any) {
    await buscarTccAtivoOuFalhar(this.prisma, tccId); // 404 se TCC inexistente ou excluído
    if (!TccsService.TIPOS_DOC.includes(tipo)) {
      throw new BadRequestException({ mensagem: 'Tipo de documento inválido.' });
    }
    const st = status || 'PENDENTE';
    if (!TccsService.STATUS_DOC.includes(st)) {
      throw new BadRequestException({ mensagem: 'Status de documento inválido.' });
    }
    this.validarFormato(tipo, arquivo); // valida pelo tipo selecionado
    const arq = await this.gravarArquivo(arquivo);
    try {
      const versao = await this.proximaVersao(tccId, tipo);
      return await this.prisma.documentoTcc.create({
        data: { tccId, tipo, status: st, parecer: parecer || null, versao, ...arq },
      });
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }

  // Coordenador substitui o ARQUIVO de um documento existente: o antigo vira SUBSTITUIDA e
  // cria-se uma nova versão (mesmo tipo) que passa a ser a mais recente. Não apaga o arquivo
  // físico antigo. O status do novo é o escolhido no formulário, herdando o do antigo por padrão.
  async substituirArquivoDocumento(docId: string, status: string | undefined, arquivo: any) {
    const antigo = await this.prisma.documentoTcc.findUnique({ where: { id: docId } });
    if (!antigo) throw new NotFoundException();
    await buscarTccAtivoOuFalhar(this.prisma, antigo.tccId); // bloqueia substituição em TCC excluído
    const st = status || antigo.status;
    if (!TccsService.STATUS_DOC.includes(st)) {
      throw new BadRequestException({ mensagem: 'Status de documento inválido.' });
    }
    this.validarFormato(antigo.tipo, arquivo); // valida pelo tipo original do documento
    const arq = await this.gravarArquivo(arquivo);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.documentoTcc.update({ where: { id: docId }, data: { status: 'SUBSTITUIDA' } });
        const versao = (await tx.documentoTcc.count({ where: { tccId: antigo.tccId, tipo: antigo.tipo } })) + 1;
        return tx.documentoTcc.create({
          data: { tccId: antigo.tccId, tipo: antigo.tipo, status: st, parecer: antigo.parecer, versao, ...arq },
        });
      });
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }

  // Estado do prazo de abertura para o próprio aluno (Dashboard / tela de abrir TCC).
  aberturaPrazo(alunoId: string) {
    return this.prazos.aberturaParaAluno(alunoId);
  }

  async abrir(alunoId: string, dados: DadosAbrirTcc) {
    const semestre = await resolverSemestreAtivo(this.prisma);

    const jaTem = await this.prisma.tcc.findUnique({
      where: { alunoId_semestre: { alunoId, semestre } },
      include: { solicitacoes: { orderBy: { criadoEm: 'desc' }, take: 1 } },
    });
    // Recomeço: se já existe um TCC deste semestre, só dá para abrir outro quando o anterior
    // foi RECUSADO/CANCELADO e ainda está na abertura. NÃO apagamos nada aqui — a exclusão do
    // TCC antigo (e dos arquivos) só acontece DEPOIS de toda a validação passar e DENTRO de uma
    // transação, para que qualquer falha na nova solicitação deixe a anterior 100% íntegra.
    let recomeco: { tccId: string } | null = null;
    if (jaTem) {
      // TCC do semestre EXCLUÍDO logicamente pela coordenação/orientador: a vaga única
      // (aluno, semestre) continua ocupada — não dá para abrir outro sem intervenção. Mensagem
      // clara em vez do genérico "já tem um TCC" (o aluno nem vê o TCC excluído nas telas).
      if (jaTem.excluidoEm) {
        throw new BadRequestException({
          mensagem: 'Seu TCC deste semestre foi excluído pela coordenação. Fale com a coordenação para regularizar antes de abrir uma nova solicitação.',
        });
      }
      const ult = jaTem.solicitacoes[0];
      // Só dá pra recomeçar se o TCC anterior ainda está na abertura E foi recusado/cancelado.
      const podeRecomecar = jaTem.faseAtual === 'INICIALIZACAO' && (ult?.status === 'RECUSADA' || ult?.status === 'CANCELADA');
      if (!podeRecomecar) throw new BadRequestException({ mensagem: 'Você já tem um TCC neste semestre.' });
      recomeco = { tccId: jaTem.id };
    }

    // ----- Validações ANTES de qualquer exclusão/gravação (item 1) -----
    // Prazo de envio de documentos iniciais (calendário da coordenação). Se vencido e SEM
    // liberação individual para este aluno+semestre, bloqueia a abertura. hoje===prazo ainda
    // vale; sem data, não bloqueia. A liberação é por aluno+semestre (não depende de TCC).
    await this.prazos.exigirEtapaLiberada({ etapa: 'ENVIO_DOCUMENTOS', semestre, alunoId });

    const orientador = await this.prisma.usuario.findUnique({ where: { id: dados.orientadorId } });
    if (!orientador || orientador.papel !== 'PROFESSOR') {
      throw new BadRequestException({ mensagem: 'Orientador inválido.' });
    }
    // Orientador escolhido pelo aluno precisa estar DISPONÍVEL para orientar — regra no backend
    // (não só na tela): a lista some quando o professor se marca indisponível (item 5).
    if (!orientador.disponivelParaOrientar) {
      throw new BadRequestException({ mensagem: 'Este orientador não está disponível para novas orientações. Escolha outro.' });
    }
    if (dados.coorientadorId) {
      if (dados.coorientadorId === dados.orientadorId) {
        throw new BadRequestException({ mensagem: 'O coorientador deve ser diferente do orientador.' });
      }
      const co = await this.prisma.usuario.findUnique({ where: { id: dados.coorientadorId } });
      // Coorientador precisa ser um docente/avaliador — não pode ser um aluno.
      if (!co || !['PROFESSOR', 'AVALIADOR', 'COORDENADOR'].includes(co.papel)) {
        throw new BadRequestException({ mensagem: 'Coorientador inválido.' });
      }
      // Mesma exigência de disponibilidade para o coorientador indicado pelo aluno (item 5).
      if (!co.disponivelParaOrientar) {
        throw new BadRequestException({ mensagem: 'Este coorientador não está disponível para novas orientações. Escolha outro.' });
      }
    }

    // ----- Troca transacional (item 1) -----
    // Com tudo validado, criamos a nova solicitação. No recomeço, a exclusão do TCC antigo e a
    // criação da nova ficam na MESMA transação (a unique aluno+semestre é respeitada); se
    // qualquer passo falhar, o rollback preserva a solicitação anterior intacta.
    let caminhosAntigos: string[] = [];
    const tcc = await this.prisma.$transaction(async (tx) => {
      if (recomeco) {
        const docs = await tx.documentoTcc.findMany({ where: { tccId: recomeco.tccId }, select: { caminho: true } });
        caminhosAntigos = docs.map((d) => d.caminho);
        await tx.tcc.delete({ where: { id: recomeco.tccId } });
      }
      return tx.tcc.create({
        data: {
          titulo: dados.titulo,
          semestre,
          faseAtual: 'INICIALIZACAO',
          alunoId,
          orientadorId: dados.orientadorId,
          coorientadorId: dados.coorientadorId || null,
          coorientadorNome: dados.coorientadorNome || null,
          coorientadorTitulacao: dados.coorientadorTitulacao || null,
          coorientadorAfiliacao: dados.coorientadorAfiliacao || null,
          coorientadorLattes: dados.coorientadorLattes || null,
          solicitacoes: { create: { mensagem: dados.mensagem || null, status: 'PENDENTE' } },
        },
        include: { solicitacoes: true },
      });
    });

    // A nova solicitação já existe com sucesso: só AGORA removemos os arquivos físicos do TCC
    // anterior (item 1). Uma falha ao apagar arquivo não afeta o novo registro.
    for (const c of caminhosAntigos) await fs.rm(join(process.cwd(), c), { force: true }).catch(() => {});

    // Na abertura SÓ o coordenador é avisado. Orientador e coorientador só ficam sabendo
    // quando a solicitação for APROVADA (a indicação pode nem se concretizar).
    await this.eventos.emitirParaCoordenadores('coord_nova_solicitacao', 'Nova solicitação de TCC', `Há uma nova solicitação de abertura aguardando análise: "${tcc.titulo}".`, `/coordenador/solicitacoes?tccId=${tcc.id}`);
    return tcc;
  }

  // Pesos das FASES na nota final (NF = pesoFase1·NF1 + pesoFase2·NF2), do calendário do
  // semestre do TCC. Sem calendário salvo → defaults do domínio (60/40). Anexado aos TCCs
  // devolvidos para aluno/orientador/coorientador para que o card de notas use o peso vigente
  // (em vez de hardcode 60/40 no front).
  private async pesosFasesDoSemestre(semestre: string) {
    const cal: any = await this.prisma.calendario.findUnique({ where: { semestre } });
    return { pesoFase1: cal?.pesoFase1 ?? PESO_NF1, pesoFase2: cal?.pesoFase2 ?? PESO_NF2 };
  }

  // Mesmo que pesosFasesDoSemestre, mas para uma lista de TCCs de vários semestres:
  // busca um calendário por semestre distinto e devolve um mapa semestre → pesos.
  private async pesosFasesPorSemestre(semestres: string[]) {
    const distintos = [...new Set(semestres)];
    const cals: any[] = await this.prisma.calendario.findMany({ where: { semestre: { in: distintos } } });
    const mapa = new Map<string, any>(cals.map((c) => [c.semestre, c]));
    const out: Record<string, { pesoFase1: number; pesoFase2: number }> = {};
    for (const s of distintos) {
      const cal = mapa.get(s);
      out[s] = { pesoFase1: cal?.pesoFase1 ?? PESO_NF1, pesoFase2: cal?.pesoFase2 ?? PESO_NF2 };
    }
    return out;
  }

  async meu(alunoId: string) {
    const tcc = await this.prisma.tcc.findFirst({
      where: { alunoId, excluidoEm: null },
      orderBy: { criadoEm: 'desc' },
      include: {
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        coorientador: { select: { id: true, nomeCompleto: true } },
        solicitacoes: { orderBy: { criadoEm: 'desc' } },
        // Banca só para as DATAS da timeline (sem expor notas/avaliadores ao aluno).
        bancas: { select: { fase: true, criadoEm: true, membros: { select: { avaliadoEm: true } } } },
        // O documento interno da banca (AVALIACAO_BANCA) não aparece para o aluno.
        documentos: { where: { tipo: { not: 'AVALIACAO_BANCA' } } },
      },
    });
    if (!tcc) return null;
    // bloqueios[etapa] = ação bloqueada por prazo vencido sem liberação (para desabilitar botões).
    // Aluno não é coordenador: esconde notas/resultado até a confirmação da nota final (tcc.nf).
    const base = {
      ...sanitizarNotasTcc(tcc),
      ...(await this.pesosFasesDoSemestre(tcc.semestre)),
      bloqueios: await this.prazos.bloqueiosDoTcc(tcc),
    };
    // Notas/avaliações da banca SÓ depois da confirmação da nota final da Fase II (nf != null)
    // OU em reprovação terminal (REPROVADO_FASE_1/2 — resultado definitivo; mesmo critério do
    // sanitizarNotasTcc). Antes disso, o payload traz apenas as DATAS da banca (para a
    // timeline) — nada de notas, parecer ou avaliadores. Depois da liberação, anexa as bancas
    // completas (avaliadores, notas por critério, total e parecer), sempre SEM o rascunho
    // privado do avaliador, e os pesos do calendário do semestre para os cards de notas.
    if (tcc.nf != null || FASES_NOTAS_LIBERADAS.includes(tcc.faseAtual)) {
      const bancas = await this.prisma.banca.findMany({
        where: { tccId: tcc.id },
        orderBy: { fase: 'asc' },
        include: { membros: { include: { avaliador: { select: { id: true, nomeCompleto: true, tratamento: true } } } } },
      });
      const cal = await this.prisma.calendario.findUnique({ where: { semestre: tcc.semestre } });
      return ocultarRascunho({ ...base, bancas, pesos: cal ?? null });
    }
    return base;
  }

  async cancelar(alunoId: string, tccId: string) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (tcc.alunoId !== alunoId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'INICIALIZACAO') {
      throw new BadRequestException({ mensagem: 'Só é possível cancelar enquanto aguarda aprovação.' });
    }
    // Cancelar apaga o TCC de vez (cascade em solicitações/documentos). Os arquivos físicos
    // precisam sair junto — senão viram órfãos no disco (item 4). Coletamos os caminhos DESTE
    // TCC antes de excluir; só removemos os arquivos DEPOIS de a exclusão dar certo (se o delete
    // falhar, nada é apagado do disco). O filtro por tccId garante não tocar em arquivo de outro TCC.
    const docs = await this.prisma.documentoTcc.findMany({ where: { tccId }, select: { caminho: true } });
    await this.prisma.tcc.delete({ where: { id: tccId } });
    for (const d of docs) await fs.rm(join(process.cwd(), d.caminho), { force: true }).catch(() => {});
    return { ok: true };
  }

  // Exclusão LÓGICA (soft delete) por COORDENADOR (qualquer TCC) ou pelo PROFESSOR ORIENTADOR
  // (só o TCC dele). Não apaga nada fisicamente: apenas marca excluidoEm/excluidoPorId/
  // motivoExclusao. Documentos, bancas, avaliações, notas e arquivos permanecem no banco/disco.
  async excluir(usuario: { sub: string; papel: string }, tccId: string, motivo?: string) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException({ mensagem: 'TCC não encontrado.' });
    if (tcc.excluidoEm) return { ok: true }; // já excluído: idempotente
    const ehCoordenador = usuario.papel === 'COORDENADOR';
    const ehOrientador = usuario.papel === 'PROFESSOR' && tcc.orientadorId === usuario.sub;
    if (!ehCoordenador && !ehOrientador) {
      throw new ForbiddenException({ mensagem: 'Você não tem permissão para excluir este TCC.' });
    }
    await this.prisma.tcc.update({
      where: { id: tccId },
      data: { excluidoEm: new Date(), excluidoPorId: usuario.sub, motivoExclusao: (motivo ?? '').trim() || null },
    });
    return { ok: true };
  }

  // TCCs do período atual (visão do coordenador), com dados pra gerir banca/fase
  // e abrir o detalhe (aluno, orientador, coorientador, documentos, banca + notas).
  async todos() {
    const semestre = await resolverSemestreAtivo(this.prisma);
    const tccs = await this.prisma.tcc.findMany({
      where: { semestre, excluidoEm: null },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        coorientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        bancas: { include: { membros: { include: { avaliador: { select: { nomeCompleto: true, tratamento: true } } } } } },
        documentos: { orderBy: { criadoEm: 'desc' } },
        solicitacoes: { orderBy: { criadoEm: 'desc' } },
      },
      orderBy: { criadoEm: 'desc' },
    });
    // Coordenador vê as notas oficiais, mas NUNCA o rascunho privado do avaliador.
    return tccs.map((t) => ocultarRascunho(t));
  }

  pendentes() {
    return this.prisma.tcc.findMany({
      where: { faseAtual: 'INICIALIZACAO', excluidoEm: null, solicitacoes: { some: { status: 'PENDENTE' } } },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true } },
        coorientador: { select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true } },
        solicitacoes: { orderBy: { criadoEm: 'desc' }, take: 1 },
        documentos: true,
      },
      orderBy: { criadoEm: 'asc' },
    });
  }

  async aprovar(tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({
      where: { id: tccId },
      include: { solicitacoes: { where: { status: 'PENDENTE' } }, documentos: true },
    });
    if (!tcc || tcc.excluidoEm) throw new NotFoundException({ mensagem: 'TCC não encontrado.' });
    if (tcc.faseAtual !== 'INICIALIZACAO' || tcc.solicitacoes.length === 0) {
      throw new BadRequestException({ mensagem: 'Este TCC não está aguardando aprovação de abertura.' });
    }
    // Não aprova sem os dois documentos obrigatórios da abertura VÁLIDOS: um plano/termo
    // REJEITADO (ou substituído) não conta — o aluno precisa reenviar antes da aprovação.
    const validos = tcc.documentos.filter((d) => ['PENDENTE', 'EM_ANALISE', 'APROVADO'].includes(d.status));
    const tipos = new Set(validos.map((d) => d.tipo));
    if (!tipos.has('PLANO_DESENVOLVIMENTO') || !tipos.has('TERMO_ACEITE')) {
      throw new BadRequestException({
        mensagem: 'A solicitação precisa do Plano de Desenvolvimento e do Termo de Aceite válidos (documento rejeitado não conta — peça o reenvio ao aluno).',
      });
    }
    // Reserva ATÔMICA da decisão dentro de UMA transação: a solicitação PENDENTE→ACEITA E a fase
    // INICIALIZACAO→DESENVOLVIMENTO precisam casar exatamente 1 linha CADA. Se qualquer uma falhar
    // — outra decisão concorrente venceu, ou a coordenação moveu a fase por edição no mesmo
    // instante — a transação é revertida (throw dentro do callback faz rollback). Assim nunca fica
    // solicitação ACEITA + documentos aprovados com o TCC parado em outra fase (item 2).
    await this.prisma.$transaction(async (tx) => {
      const reserva = await tx.solicitacaoOrientacao.updateMany({
        where: { tccId, status: 'PENDENTE' },
        data: { status: 'ACEITA', respondidoEm: new Date() },
      });
      if (reserva.count !== 1) {
        throw new ConflictException({ mensagem: 'Esta solicitação já foi decidida por outra pessoa. Atualize a página.' });
      }
      const transicao = await tx.tcc.updateMany({
        where: { id: tccId, faseAtual: 'INICIALIZACAO' },
        data: { faseAtual: 'DESENVOLVIMENTO' },
      });
      if (transicao.count !== 1) {
        throw new ConflictException({ mensagem: 'A fase deste TCC mudou durante a aprovação. Atualize a página e tente novamente.' });
      }
      // Ao aprovar a abertura, os documentos iniciais deixam de estar "em análise" e ficam
      // APROVADO (limpa parecer). Não toca em MONOGRAFIA/VERSAO_FINAL/AVALIACAO_BANCA nem
      // em versões SUBSTITUIDA (filtro por tipo e status).
      await tx.documentoTcc.updateMany({
        where: {
          tccId,
          tipo: { in: ['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE'] },
          status: { in: ['PENDENTE', 'EM_ANALISE'] },
        },
        data: { status: 'APROVADO', parecer: null },
      });
    });
    await this.eventos.emitirParaUsuario('aluno_solicitacao_aprovada', tcc.alunoId, 'Solicitação de TCC aprovada', `Sua solicitação do TCC "${tcc.titulo}" foi aprovada. O TCC entrou na fase de desenvolvimento.`);
    await this.eventos.emitirParaUsuario('orientador_definido', tcc.orientadorId, 'Você é orientador de um novo TCC', `Você foi confirmado como orientador do TCC "${tcc.titulo}".`);
    await this.eventos.emitirParaUsuario('orientador_confirmar_continuidade', tcc.orientadorId, 'Confirmar continuidade do TCC', `Quando puder, confirme a continuidade do TCC "${tcc.titulo}" na sua área de orientandos.`, `/professor/orientandos/${tcc.id}#acao`);
    await this.eventos.emitirParaUsuario('coorientador_indicado', tcc.coorientadorId, 'Você foi indicado como coorientador', `Você foi indicado como coorientador do TCC "${tcc.titulo}". A solicitação foi aprovada e o TCC entrou na fase de desenvolvimento.`);
    return { ok: true };
  }

  async recusar(tccId: string, parecer: string) {
    const tcc = await this.prisma.tcc.findUnique({
      where: { id: tccId },
      include: { solicitacoes: { where: { status: 'PENDENTE' } } },
    });
    if (!tcc || tcc.excluidoEm) throw new NotFoundException({ mensagem: 'TCC não encontrado.' });
    if (tcc.faseAtual !== 'INICIALIZACAO' || tcc.solicitacoes.length === 0) {
      throw new BadRequestException({ mensagem: 'Este TCC não está aguardando aprovação de abertura.' });
    }
    // Reserva ATÔMICA (item 2) dentro de uma transação: move a solicitação PENDENTE→RECUSADA e
    // confirma que o TCC AINDA está aguardando abertura (INICIALIZACAO). Se outro coordenador já
    // decidiu (casa 0 linhas) ou a coordenação moveu a fase por edição no mesmo instante, reverte —
    // a solicitação não é recusada isoladamente sobre um TCC que já saiu da inicialização.
    await this.prisma.$transaction(async (tx) => {
      const reserva = await tx.solicitacaoOrientacao.updateMany({
        where: { tccId, status: 'PENDENTE' },
        data: { status: 'RECUSADA', parecer, respondidoEm: new Date() },
      });
      if (reserva.count !== 1) {
        throw new ConflictException({ mensagem: 'Esta solicitação já foi decidida por outra pessoa. Atualize a página.' });
      }
      const atual = await tx.tcc.findUnique({ where: { id: tccId }, select: { faseAtual: true, excluidoEm: true } });
      if (!atual || atual.excluidoEm || atual.faseAtual !== 'INICIALIZACAO') {
        throw new ConflictException({ mensagem: 'A fase deste TCC mudou durante a recusa. Atualize a página e tente novamente.' });
      }
    });
    await this.eventos.emitirParaUsuario('aluno_solicitacao_recusada', tcc.alunoId, 'Solicitação de TCC recusada', `Sua solicitação do TCC "${tcc.titulo}" foi recusada.${parecer ? ' Parecer: ' + parecer : ''} Você pode corrigir os documentos e reenviar.`);
    return { ok: true };
  }

  // Só devolve o documento se o usuário tiver acesso a ele (coordenador, ou o aluno dono,
  // ou o orientador/coorientador do TCC). Senão devolve null (tratado como 404, sem vazar existência).
  async documentoParaUsuario(docId: string, usuario: { sub: string; papel: string }) {
    const doc = await this.prisma.documentoTcc.findUnique({
      where: { id: docId },
      include: {
        tcc: {
          select: {
            excluidoEm: true,
            alunoId: true,
            orientadorId: true,
            coorientadorId: true,
            bancas: { select: { fase: true, documentoAvaliacaoId: true, membros: { select: { avaliadorId: true } } } },
          },
        },
      },
    });
    if (!doc) return null;
    // TCC excluído logicamente: ninguém baixa/visualiza documentos dele (nem o coordenador).
    // Vem ANTES do atalho do coordenador para o soft delete valer também aqui (404 na rota).
    if (doc.tcc.excluidoEm) return null;
    if (usuario.papel === 'COORDENADOR') return doc;
    const t = doc.tcc;

    // Documento interno da banca: só o coordenador (acima) e os membros da banca que
    // avalia este documento. Nem o aluno dono, nem orientador/coorientador acessam por
    // serem "donos" do TCC — apenas por serem membros da banca correspondente.
    if (doc.tipo === 'AVALIACAO_BANCA') {
      const banca = t.bancas.find((b) => b.documentoAvaliacaoId === doc.id);
      if (!banca || !banca.membros.some((m) => m.avaliadorId === usuario.sub)) return null;
      // DUPLO-CEGO (item 6): o avaliador da Fase I recebe o documento da banca, mas NUNCA o nome
      // ORIGINAL do arquivo — um "Avaliacao_JoaoSilva.docx" entregaria o aluno. Devolve um nome
      // genérico no lugar (o caminho real no disco é preservado, só o rótulo muda). O coordenador
      // já retornou acima com o nome real; AVALIACAO_BANCA só existe na Fase I, então todo acesso
      // que chega aqui é de um avaliador cego.
      return { ...doc, nomeArquivo: 'Documento para avaliação' };
    }

    const ehDono =
      t.alunoId === usuario.sub ||
      t.orientadorId === usuario.sub ||
      t.coorientadorId === usuario.sub;
    // Membro de banca acessa a monografia/versão final — mas SÓ o da banca da FASE II.
    // Na Fase I a avaliação é às cegas: o membro só acessa o documento anônimo da banca
    // (AVALIACAO_BANCA, tratado acima); a monografia original carrega o nome do aluno
    // (no arquivo e no conteúdo) e entregaria a identidade.
    const ehMembroBancaF2 = t.bancas.some(
      (b) => b.fase === 'FASE_2' && b.membros.some((m) => m.avaliadorId === usuario.sub),
    );
    const acessoBanca = ehMembroBancaF2 && ['MONOGRAFIA', 'VERSAO_FINAL'].includes(doc.tipo);
    return ehDono || acessoBanca ? doc : null;
  }

  // ---------- Fase de Desenvolvimento (monografia + continuidade) ----------

  // Validação REAL do formato pelo tipo de documento: EXTENSÃO do nome + ASSINATURA do
  // conteúdo (magic bytes). Vale para qualquer rota; é a fonte de verdade independente do
  // filtro do multer. Um .pdf/.docx com conteúdo falso é rejeitado com 400.
  private validarFormato(tipo: string, arquivo: any) {
    const formato = formatoDoTipoDoc(tipo);
    if (!arquivoPermitidoParaTipo(tipo, arquivo?.originalname ?? '')) {
      throw new BadRequestException({ mensagem: `Para este documento, envie ${formato.rotulo}.` });
    }
    if (!conteudoCompativel(arquivo?.buffer, formato.exts)) {
      throw new BadRequestException({ mensagem: `O arquivo não é um ${formato.rotulo} válido — o conteúdo não corresponde à extensão.` });
    }
  }

  // Grava um arquivo no disco e devolve {nomeArquivo, caminho, tamanho}. Storage local (dev).
  private async gravarArquivo(arquivo: any) {
    const dir = join(process.cwd(), 'uploads');
    await fs.mkdir(dir, { recursive: true });
    // Nome interno seguro (sem usar o nome enviado → evita path traversal); original vira só metadado.
    const ext = extname(arquivo.originalname || '').replace(/[^.a-zA-Z0-9]/g, '').slice(0, 10);
    const nome = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    await fs.writeFile(join(dir, nome), arquivo.buffer);
    // Corrige acentos do nome enviado (latin1->UTF-8), de forma segura/condicional.
    const nomeArquivo = corrigirNomeArquivo(arquivo.originalname);
    return { nomeArquivo, caminho: join('uploads', nome), tamanho: arquivo.size };
  }

  // Teto de documentos por TCC nos envios do ALUNO. O fluxo normal usa ~10–15 registros
  // mesmo com reenvios; sem teto, um usuário autenticado poderia subir arquivos de 10 MB
  // sem parar e encher o disco. Ações administrativas do coordenador não passam por aqui.
  // Recebe o client (prisma OU tx): chamado DENTRO da mesma transação que cria o documento,
  // para a contagem e a gravação serem atômicas (sem corrida entre uploads paralelos).
  private static readonly LIMITE_DOCUMENTOS_POR_TCC = 40;
  private async exigirEspacoParaDocumento(db: { documentoTcc: { count: (args: any) => Promise<number> } }, tccId: string) {
    const total = await db.documentoTcc.count({ where: { tccId } });
    if (total >= TccsService.LIMITE_DOCUMENTOS_POR_TCC) {
      throw new BadRequestException({
        mensagem: 'Este TCC atingiu o limite de documentos enviados. Fale com a coordenação para remover versões antigas antes de enviar de novo.',
      });
    }
  }

  // Aluno envia (ou reenvia) a monografia. Substitui versões pendentes antigas e cria a nova
  // (PENDENTE) numa transação; se algo falhar, remove o arquivo recém-gravado (sem órfão).
  async enviarMonografia(alunoId: string, tccId: string, arquivo: any) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (tcc.alunoId !== alunoId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'DESENVOLVIMENTO') {
      throw new BadRequestException({ mensagem: 'O TCC não está na fase de desenvolvimento.' });
    }
    if (tcc.monografiaAprovada) {
      throw new BadRequestException({ mensagem: 'Sua monografia já foi aprovada pelo orientador.' });
    }
    await this.prazos.exigirEtapaLiberada({ etapa: 'SUBMISSAO_MONOGRAFIA', semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
    this.validarFormato('MONOGRAFIA', arquivo);
    const arq = await this.gravarArquivo(arquivo);
    try {
      const doc = await this.prisma.$transaction(async (tx) => {
        await this.exigirEspacoParaDocumento(tx, tccId); // dentro da tx: contagem+criação atômicas
        // Versões pendentes anteriores deixam de valer (evita várias PENDENTE soltas).
        await tx.documentoTcc.updateMany({
          where: { tccId, tipo: 'MONOGRAFIA', status: 'PENDENTE' },
          data: { status: 'SUBSTITUIDA' },
        });
        const versoes = await tx.documentoTcc.count({ where: { tccId, tipo: 'MONOGRAFIA' } });
        return tx.documentoTcc.create({
          data: { tccId, tipo: 'MONOGRAFIA', status: 'PENDENTE', versao: versoes + 1, ...arq },
        });
      });
      await this.eventos.emitirParaUsuario('orientador_monografia_enviada', tcc.orientadorId, 'Monografia enviada para avaliação', `O aluno enviou/reenviou a monografia do TCC "${tcc.titulo}" para sua avaliação.`, `/professor/orientandos/${tcc.id}#acao`);
      await this.eventos.emitirParaUsuario('coorientador_documentos', tcc.coorientadorId, 'Monografia enviada', `O aluno enviou/reenviou a monografia do TCC "${tcc.titulo}" (no qual você é coorientador).`);
      return doc;
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }

  // Lista os TCCs em que o usuário é orientador (com aluno, documentos e flags das trilhas).
  async orientandos(professorId: string) {
    const tccs = await this.prisma.tcc.findMany({
      where: { orientadorId: professorId, excluidoEm: null },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        coorientador: { select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true, email: true } },
        bancas: { include: { membros: { include: { avaliador: { select: { nomeCompleto: true, tratamento: true } } } } } },
        // Documento interno da banca não aparece como metadado para o orientador.
        documentos: { where: { tipo: { not: 'AVALIACAO_BANCA' } }, orderBy: { criadoEm: 'desc' } },
        solicitacoes: { orderBy: { criadoEm: 'desc' } },
      },
      orderBy: { criadoEm: 'desc' },
    });
    // Orientador não é coordenador: esconde NF1/NF2/NF, resultado e as notas/parecer dos
    // membros da banca até a confirmação da nota final da Fase II (tcc.nf).
    const pesos = await this.pesosFasesPorSemestre(tccs.map((t) => t.semestre));
    return Promise.all(
      tccs.map(async (t) => ({
        ...ocultarRascunho(sanitizarNotasTcc(t)),
        ...pesos[t.semestre],
        bloqueios: await this.prazos.bloqueiosDoTcc(t),
      })),
    );
  }

  // Lista os TCCs em que o usuário é coorientador (visão de leitura: aluno, orientador e docs).
  async coorientacoes(usuarioId: string) {
    const tccs = await this.prisma.tcc.findMany({
      where: { coorientadorId: usuarioId, excluidoEm: null },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        // Documento interno da banca não aparece como metadado para o coorientador.
        documentos: { where: { tipo: { not: 'AVALIACAO_BANCA' } }, orderBy: { criadoEm: 'desc' } },
      },
      orderBy: { criadoEm: 'desc' },
    });
    // Coorientador não é coordenador: esconde NF1/NF2/NF e resultado até a confirmação final.
    const pesos = await this.pesosFasesPorSemestre(tccs.map((t) => t.semestre));
    return tccs.map((t) => ({ ...sanitizarNotasTcc(t), ...pesos[t.semestre] }));
  }

  // Histórico do professor: TCCs de períodos ANTERIORES (semestre != atual) em que ele teve
  // vínculo real — orientador, coorientador OU membro de banca (avaliador). Só leitura.
  // Usa SEMPRE o id do JWT (nunca aceita id do front). Exclui TCCs com soft delete.
  async historicoProfessor(profId: string) {
    const semestre = await resolverSemestreAtivo(this.prisma);
    const ocultos = await this.tccsOcultosDoUsuario(profId); // ocultações individuais do professor
    const tccs = await this.prisma.tcc.findMany({
      where: {
        excluidoEm: null,
        semestre: { not: semestre }, // "antigo" = período diferente do atual configurado
        id: { notIn: ocultos }, // fora os que ESTE professor ocultou do próprio histórico
        OR: [
          { orientadorId: profId },
          { coorientadorId: profId },
          { bancas: { some: { membros: { some: { avaliadorId: profId } } } } },
        ],
      },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        coorientador: { select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true, email: true } },
        documentos: { where: { tipo: { not: 'AVALIACAO_BANCA' } }, orderBy: { criadoEm: 'desc' } },
        bancas: { include: { membros: { include: { avaliador: { select: { id: true, nomeCompleto: true, tratamento: true } } } } } },
        solicitacoes: { orderBy: { criadoEm: 'desc' } },
      },
      orderBy: [{ semestre: 'desc' }, { criadoEm: 'desc' }], // semestre mais recente primeiro
    });
    // Pesos do calendário de cada SEMESTRE do TCC (para os cards de notas usarem o peso real do
    // período antigo, não o padrão). `pesos` = a linha do calendário (pesos por critério +
    // pesoFase1/pesoFase2); pesoFase1/pesoFase2 já com o fallback do domínio.
    const cals: any[] = await this.prisma.calendario.findMany({
      where: { semestre: { in: [...new Set(tccs.map((t) => t.semestre))] } },
    });
    const calPorSemestre = new Map<string, any>(cals.map((c) => [c.semestre, c]));
    // Anota o(s) vínculo(s) do professor com cada TCC (para o filtro no front) e sanitiza:
    // esconde notas/parecer até a liberação (nf) e nunca expõe o rascunho privado do avaliador.
    return tccs.map((t) => {
      const vinculos: string[] = [];
      if (t.orientadorId === profId) vinculos.push('ORIENTADOR');
      if (t.coorientadorId === profId) vinculos.push('COORIENTADOR');
      if ((t.bancas ?? []).some((b) => (b.membros ?? []).some((m) => m.avaliadorId === profId))) vinculos.push('AVALIADOR');
      const cal = calPorSemestre.get(t.semestre) ?? null;
      const base: any = {
        ...ocultarRascunho(sanitizarNotasTcc(t)),
        vinculos,
        pesos: cal, // pesos por critério (para BancaNotasTcc)
        pesoFase1: cal?.pesoFase1 ?? PESO_NF1,
        pesoFase2: cal?.pesoFase2 ?? PESO_NF2,
      };
      // DUPLO-CEGO também no histórico: se o único vínculo do professor é ter sido AVALIADOR
      // da Fase I e o TCC foi REPROVADO na Fase I (nunca chegou à defesa pública da Fase II),
      // a identidade do aluno/orientador e os metadados de documentos continuam anônimos —
      // senão o avaliador cego descobriria o autor no período seguinte. TCCs que passaram da
      // Fase I tiveram defesa pública (a banca da F2 vê o aluno), então abrem normalmente.
      const soAvaliador = vinculos.length === 1 && vinculos[0] === 'AVALIADOR';
      if (soAvaliador && t.faseAtual === 'REPROVADO_FASE_1') {
        for (const k of [
          'aluno', 'alunoId', 'orientador', 'orientadorId', 'coorientador', 'coorientadorId',
          'coorientadorNome', 'coorientadorTitulacao', 'coorientadorAfiliacao', 'coorientadorLattes',
        ]) {
          if (k in base) base[k] = null;
        }
        base.documentos = []; // nomes de arquivo entregariam o aluno
      }
      return base;
    });
  }

  // ----- Ocultação INDIVIDUAL do histórico (preferência por usuário) -----
  // NÃO confundir com exclusão: ocultar só esconde o TCC do histórico DESTE usuário; não mexe
  // no TCC, não toca em `excluidoEm`, não apaga nada. A exclusão administrativa global continua
  // sendo o soft delete (`Tcc.excluidoEm`). Hard delete definitivo não existe (etapa futura).

  // Ids dos TCCs que o usuário ocultou do próprio histórico (para filtrar as listagens).
  private async tccsOcultosDoUsuario(usuarioId: string): Promise<string[]> {
    const linhas = await this.prisma.historicoTccOculto.findMany({ where: { usuarioId }, select: { tccId: true } });
    return linhas.map((l) => l.tccId);
  }

  // Oculta um TCC do histórico do PRÓPRIO usuário logado (id do JWT). Só aceita TCC que
  // realmente APARECE no histórico: ativo (excluidoEm null) e de período ANTERIOR (semestre !=
  // atual). Coordenador pode ocultar qualquer TCC histórico; professor só os que tem vínculo
  // (orientador, coorientador ou membro de banca). Idempotente (se já oculto, retorna ok).
  async ocultarDoHistorico(usuario: { sub: string; papel: string }, tccId: string) {
    const semestre = await resolverSemestreAtivo(this.prisma);
    const where: any = { id: tccId, excluidoEm: null, semestre: { not: semestre } };
    if (usuario.papel !== 'COORDENADOR') {
      where.OR = [
        { orientadorId: usuario.sub },
        { coorientadorId: usuario.sub },
        { bancas: { some: { membros: { some: { avaliadorId: usuario.sub } } } } },
      ];
    }
    const tcc = await this.prisma.tcc.findFirst({ where, select: { id: true } });
    if (!tcc) throw new NotFoundException({ mensagem: 'TCC não encontrado no histórico.' });
    await this.prisma.historicoTccOculto.upsert({
      where: { usuarioId_tccId: { usuarioId: usuario.sub, tccId } },
      update: {},
      create: { usuarioId: usuario.sub, tccId },
    });
    return { ok: true };
  }

  // Desfaz a ocultação do próprio usuário (o TCC volta a aparecer no histórico dele).
  async desocultarDoHistorico(usuario: { sub: string }, tccId: string) {
    await this.prisma.historicoTccOculto.deleteMany({ where: { usuarioId: usuario.sub, tccId } });
    return { ok: true };
  }

  // Histórico do COORDENADOR: TCCs de períodos ANTERIORES (semestre != atual). Visão
  // administrativa — o coordenador vê TUDO (não sanitiza notas), só nunca o rascunho privado
  // do avaliador. Exclui soft delete (excluidoEm) e os TCCs que ESTE coordenador ocultou do
  // próprio histórico. Usa SEMPRE o id do JWT (nunca do front).
  async historicoCoordenador(coordId: string) {
    const semestre = await resolverSemestreAtivo(this.prisma);
    const ocultos = await this.tccsOcultosDoUsuario(coordId);
    const tccs = await this.prisma.tcc.findMany({
      where: {
        excluidoEm: null,
        semestre: { not: semestre }, // "antigo" = período diferente do atual configurado
        id: { notIn: ocultos }, // fora os que ESTE coordenador ocultou
      },
      include: {
        aluno: { select: { id: true, nomeCompleto: true, email: true, curso: true } },
        orientador: { select: { id: true, nomeCompleto: true, tratamento: true } },
        coorientador: { select: { id: true, nomeCompleto: true, tratamento: true, afiliacao: true, email: true } },
        documentos: { orderBy: { criadoEm: 'desc' } }, // coordenador vê todos (inclui doc da banca)
        bancas: { include: { membros: { include: { avaliador: { select: { id: true, nomeCompleto: true, tratamento: true } } } } } },
        solicitacoes: { orderBy: { criadoEm: 'desc' } },
      },
      orderBy: [{ semestre: 'desc' }, { criadoEm: 'desc' }], // semestre mais recente primeiro
    });
    // Pesos do calendário de cada SEMESTRE (para os cards de notas usarem o peso real do período).
    const cals: any[] = await this.prisma.calendario.findMany({
      where: { semestre: { in: [...new Set(tccs.map((t) => t.semestre))] } },
    });
    const calPorSemestre = new Map<string, any>(cals.map((c) => [c.semestre, c]));
    // Coordenador NÃO sanitiza notas (vê tudo), mas nunca recebe o rascunho privado do avaliador.
    return tccs.map((t) => {
      const cal = calPorSemestre.get(t.semestre) ?? null;
      return {
        ...ocultarRascunho(t),
        pesos: cal, // linha completa do calendário (pesos por critério) p/ BancaNotasTcc
        pesoFase1: cal?.pesoFase1 ?? PESO_NF1,
        pesoFase2: cal?.pesoFase2 ?? PESO_NF2,
      };
    });
  }

  private async exigirOrientadorEmDesenvolvimento(profId: string, tccId: string) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (tcc.orientadorId !== profId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'DESENVOLVIMENTO') {
      throw new BadRequestException({ mensagem: 'O TCC não está na fase de desenvolvimento.' });
    }
    return tcc;
  }

  // Orientador aprova ou rejeita a monografia enviada (Trilha A).
  async avaliarMonografia(profId: string, tccId: string, decisao: 'APROVAR' | 'REJEITAR', parecer?: string) {
    const tcc = await this.exigirOrientadorEmDesenvolvimento(profId, tccId);
    // Mesmo prazo da submissão da monografia bloqueia a decisão do orientador (aprovar/rejeitar).
    await this.prazos.exigirEtapaLiberada({ etapa: 'SUBMISSAO_MONOGRAFIA', semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
    const mono = await this.prisma.documentoTcc.findFirst({
      where: { tccId, tipo: 'MONOGRAFIA' },
      orderBy: { versao: 'desc' },
    });
    if (!mono || mono.status !== 'PENDENTE') {
      throw new BadRequestException({ mensagem: 'Não há monografia aguardando avaliação.' });
    }
    if (decisao === 'APROVAR') {
      // Junção "E" ATÔMICA: liga a flag e, na MESMA transação, tenta a transição com um
      // update condicional que só casa se AS DUAS trilhas estiverem concluídas NO BANCO
      // (não no snapshot lido antes). Isso elimina a corrida em que monografia e
      // continuidade são decididas quase ao mesmo tempo e nenhuma das duas vê a outra —
      // o que deixava o TCC preso em DESENVOLVIMENTO com as duas flags ligadas.
      // A transição do DOCUMENTO é condicional a PENDENTE (item 3): se uma decisão concorrente
      // (aprovar/rejeitar) já mudou o status, casa 0 linhas → conflito, sem gravar estado
      // parcial — nunca fica "monografia aprovada (flag) com documento rejeitado".
      const vaiPraBanca = await this.prisma.$transaction(async (tx) => {
        const reserva = await tx.documentoTcc.updateMany({
          where: { id: mono.id, status: 'PENDENTE' },
          data: { status: 'APROVADO', parecer: null },
        });
        if (reserva.count !== 1) {
          throw new ConflictException({ mensagem: 'A monografia já foi avaliada — atualize a página.' });
        }
        // A flag monografiaAprovada SÓ é gravada se o TCC AINDA está em DESENVOLVIMENTO (item 3):
        // um update por id apenas gravaria a flag mesmo que a coordenação tivesse descontinuado ou
        // movido a fase neste instante. Com updateMany condicional, esse caso casa 0 linhas →
        // rollback (não liga a flag nem dispara notificação sobre um TCC que já saiu da fase).
        const flag = await tx.tcc.updateMany({
          where: { id: tccId, faseAtual: 'DESENVOLVIMENTO' },
          data: { monografiaAprovada: true, monografiaAprovadaEm: new Date() },
        });
        if (flag.count !== 1) {
          throw new ConflictException({ mensagem: 'A fase do TCC mudou durante a avaliação da monografia — atualize a página.' });
        }
        const transicao = await tx.tcc.updateMany({
          where: { id: tccId, faseAtual: 'DESENVOLVIMENTO', monografiaAprovada: true, continuidadeConfirmada: true },
          data: { faseAtual: 'FORMACAO_BANCA_FASE_1' },
        });
        return transicao.count === 1;
      });
      await this.eventos.emitirParaUsuario('aluno_monografia_aprovada', tcc.alunoId, 'Monografia aprovada', `Sua monografia do TCC "${tcc.titulo}" foi aprovada pelo orientador.${vaiPraBanca ? ' Com a continuidade confirmada, seu TCC avançou para a formação da banca da Fase I.' : ''}`);
      // Coorientador recebe pelo evento de documentos (a mensagem já carrega o avanço de fase,
      // então não dispara também o coorientador_mudanca_fase — seria e-mail dobrado).
      await this.eventos.emitirParaUsuario('coorientador_documentos', tcc.coorientadorId, 'Monografia aprovada', `A monografia do TCC "${tcc.titulo}" (no qual você é coorientador) foi aprovada pelo orientador.${vaiPraBanca ? ' Com a continuidade confirmada, o TCC avançou para a formação da banca da Fase I.' : ''}`);
      if (vaiPraBanca) {
        await this.eventos.emitirParaCoordenadores('coord_formar_banca_fase1', 'Formar banca da Fase I', `O TCC "${tcc.titulo}" teve monografia aprovada e continuidade confirmada — é preciso formar a banca da Fase I.`, `/coordenador/tccs/${tcc.id}`);
      }
    } else {
      // Rejeição também condicional a PENDENTE (item 3): se uma aprovação concorrente já venceu,
      // casa 0 linhas → conflito, sem sobrescrever a decisão que já valeu.
      const reserva = await this.prisma.documentoTcc.updateMany({
        where: { id: mono.id, status: 'PENDENTE' },
        data: { status: 'REJEITADO', parecer: parecer ?? null },
      });
      if (reserva.count !== 1) {
        throw new ConflictException({ mensagem: 'A monografia já foi avaliada — atualize a página.' });
      }
      await this.eventos.emitirParaUsuario('aluno_monografia_rejeitada', tcc.alunoId, 'Monografia precisa de ajustes', `O orientador pediu ajustes na sua monografia do TCC "${tcc.titulo}".${parecer ? ' Devolutiva: ' + parecer : ''}`);
      await this.eventos.emitirParaUsuario('coorientador_documentos', tcc.coorientadorId, 'Monografia precisa de ajustes', `O orientador pediu ajustes na monografia do TCC "${tcc.titulo}" (no qual você é coorientador).`);
    }
    return { ok: true };
  }

  // Orientador confirma ou rejeita a continuidade (Trilha B). Rejeição → Descontinuado.
  async avaliarContinuidade(profId: string, tccId: string, decisao: 'CONFIRMAR' | 'REJEITAR', parecer?: string) {
    const tcc = await this.exigirOrientadorEmDesenvolvimento(profId, tccId);
    // Prazo de avaliação de continuidade bloqueia AS DUAS decisões (confirmar e descontinuar).
    await this.prazos.exigirEtapaLiberada({ etapa: 'AVALIACAO_CONTINUIDADE', semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
    if (decisao === 'CONFIRMAR') {
      if (tcc.continuidadeConfirmada) {
        throw new BadRequestException({ mensagem: 'A continuidade já foi confirmada.' });
      }
      // Junção "E" ATÔMICA (espelha avaliarMonografia): liga a flag e tenta a transição
      // com update condicional na MESMA transação, olhando o estado real do banco.
      // A confirmação é RESERVADA condicionalmente (item 3): só casa se o TCC ainda está em
      // DESENVOLVIMENTO e a continuidade ainda NÃO foi decidida — impede a corrida com uma
      // rejeição simultânea (não vira DESCONTINUADO + continuidade=true, nem sobrescreve um
      // TCC que já avançou).
      const resultado = await this.prisma.$transaction(async (tx) => {
        const reserva = await tx.tcc.updateMany({
          where: { id: tccId, faseAtual: 'DESENVOLVIMENTO', continuidadeConfirmada: false },
          data: { continuidadeConfirmada: true, continuidadeAvaliadaEm: new Date() },
        });
        if (reserva.count !== 1) return { conflito: true, vaiPraBanca: false };
        const transicao = await tx.tcc.updateMany({
          where: { id: tccId, faseAtual: 'DESENVOLVIMENTO', monografiaAprovada: true, continuidadeConfirmada: true },
          data: { faseAtual: 'FORMACAO_BANCA_FASE_1' },
        });
        return { conflito: false, vaiPraBanca: transicao.count === 1 };
      });
      if (resultado.conflito) {
        throw new ConflictException({ mensagem: 'A continuidade deste TCC já foi decidida — atualize a página.' });
      }
      const vaiPraBanca = resultado.vaiPraBanca;
      await this.eventos.emitirParaUsuario('aluno_continuidade_confirmada', tcc.alunoId, 'Continuidade confirmada', `O orientador confirmou a continuidade do seu TCC "${tcc.titulo}".${vaiPraBanca ? ' Com a monografia aprovada, seu TCC avançou para a formação da banca da Fase I.' : ''}`);
      if (vaiPraBanca) {
        await this.eventos.emitirParaCoordenadores('coord_formar_banca_fase1', 'Formar banca da Fase I', `O TCC "${tcc.titulo}" teve monografia aprovada e continuidade confirmada — é preciso formar a banca da Fase I.`, `/coordenador/tccs/${tcc.id}`);
        await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC avançou para a Fase I', `O TCC "${tcc.titulo}" (no qual você é coorientador) avançou para a Fase I.`);
      } else {
        await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'Continuidade confirmada', `O orientador confirmou a continuidade do TCC "${tcc.titulo}" (no qual você é coorientador).`);
        // Quando vaiPraBanca o coordenador já recebe o "formar banca" (que implica a
        // continuidade confirmada); aqui avisa só quando a monografia ainda está pendente.
        await this.eventos.emitirParaCoordenadores('coord_continuidade', 'Continuidade confirmada', `O orientador confirmou a continuidade do TCC "${tcc.titulo}".`, `/coordenador/tccs/${tcc.id}`);
      }
    } else {
      // Descontinuar também é CONDICIONAL (item 3): só a partir de DESENVOLVIMENTO com a
      // continuidade ainda não confirmada. Se uma confirmação concorrente já venceu (o TCC pode
      // até ter avançado de fase), casa 0 linhas → conflito, sem "puxar" o TCC de volta para
      // DESCONTINUADO nem apagar um avanço legítimo.
      const reserva = await this.prisma.tcc.updateMany({
        where: { id: tccId, faseAtual: 'DESENVOLVIMENTO', continuidadeConfirmada: false },
        data: { faseAtual: 'DESCONTINUADO', parecerContinuidade: parecer ?? null, continuidadeAvaliadaEm: new Date() },
      });
      if (reserva.count !== 1) {
        throw new ConflictException({ mensagem: 'A continuidade deste TCC já foi decidida — atualize a página.' });
      }
      await this.eventos.emitirParaUsuario('aluno_continuidade_rejeitada', tcc.alunoId, 'TCC descontinuado', `O orientador não confirmou a continuidade do TCC "${tcc.titulo}".${parecer ? ' Motivo: ' + parecer : ''}`);
      await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC descontinuado', `O TCC "${tcc.titulo}" (no qual você é coorientador) foi descontinuado — o orientador não confirmou a continuidade.`);
      await this.eventos.emitirParaCoordenadores('coord_continuidade', 'TCC descontinuado', `O TCC "${tcc.titulo}" foi descontinuado — o orientador não confirmou a continuidade.`, `/coordenador/tccs/${tcc.id}`);
    }
    return { ok: true };
  }

  // ---------- Conclusão (versão final + validação do orientador) ----------

  // Aluno envia a versão final corrigida (após aprovado na defesa). → VALIDACAO_VERSAO_FINAL.
  async enviarVersaoFinal(alunoId: string, tccId: string, arquivo: any) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (tcc.alunoId !== alunoId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'AGUARDANDO_AJUSTES_FINAIS') {
      throw new BadRequestException({ mensagem: 'O TCC não está aguardando a versão final.' });
    }
    await this.prazos.exigirEtapaLiberada({ etapa: 'VERSAO_FINAL', semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
    const reenvio = (await this.prisma.documentoTcc.count({ where: { tccId, tipo: 'VERSAO_FINAL' } })) > 0;
    this.validarFormato('VERSAO_FINAL', arquivo);
    const arq = await this.gravarArquivo(arquivo);
    try {
      const doc = await this.prisma.$transaction(async (tx) => {
        await this.exigirEspacoParaDocumento(tx, tccId); // dentro da tx: contagem+criação atômicas
        await tx.documentoTcc.updateMany({
          where: { tccId, tipo: 'VERSAO_FINAL', status: 'PENDENTE' },
          data: { status: 'SUBSTITUIDA' },
        });
        const versoes = await tx.documentoTcc.count({ where: { tccId, tipo: 'VERSAO_FINAL' } });
        const novo = await tx.documentoTcc.create({
          data: { tccId, tipo: 'VERSAO_FINAL', status: 'PENDENTE', versao: versoes + 1, ...arq },
        });
        await tx.tcc.update({ where: { id: tccId }, data: { faseAtual: 'VALIDACAO_VERSAO_FINAL' } });
        return novo;
      });
      const evento = reenvio ? 'orientador_versao_final_reenviada' : 'orientador_versao_final_enviada';
      await this.eventos.emitirParaUsuario(evento, tcc.orientadorId, 'Versão final enviada', `O aluno ${reenvio ? 'reenviou' : 'enviou'} a versão final do TCC "${tcc.titulo}" para sua validação.`, `/professor/orientandos/${tccId}#acao`);
      await this.eventos.emitirParaUsuario('coorientador_documentos', tcc.coorientadorId, 'Versão final enviada', `O aluno ${reenvio ? 'reenviou' : 'enviou'} a versão final do TCC "${tcc.titulo}" (no qual você é coorientador).`);
      return doc;
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }

  // Orientador valida a versão final: conclui (→ CONCLUIDO/APROVADO) ou pede ajustes (volta).
  async validarVersaoFinal(profId: string, tccId: string, decisao: 'CONCLUIR' | 'AJUSTES', parecer?: string) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (tcc.orientadorId !== profId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'VALIDACAO_VERSAO_FINAL') {
      throw new BadRequestException({ mensagem: 'O TCC não está aguardando validação da versão final.' });
    }
    // Mesmo prazo da versão final bloqueia a validação do ORIENTADOR (concluir/pedir ajustes).
    await this.prazos.exigirEtapaLiberada({ etapa: 'VERSAO_FINAL', semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
    if (decisao === 'CONCLUIR') {
      const agora = new Date(); // mesma marca para "validação do orientador" e "concluído"
      // Transição de fase CONDICIONAL a VALIDACAO_VERSAO_FINAL (item 3): a mudança de fase é o
      // guarda de vencedor único — duas decisões simultâneas (concluir/ajustes) nunca deixam a
      // fase CONCLUIDO com o documento REJEITADO (ou vice-versa). E EXIGE uma versão final PENDENTE
      // na MESMA transação (item 4): sem ela — ex.: a fase foi movida à mão pela coordenação sem
      // envio de versão — o throw reverte tudo e o TCC não é concluído sem versão final.
      await this.prisma.$transaction(async (tx) => {
        const reserva = await tx.tcc.updateMany({
          where: { id: tccId, faseAtual: 'VALIDACAO_VERSAO_FINAL' },
          data: { faseAtual: 'CONCLUIDO', resultado: 'APROVADO', versaoFinalValidadaEm: agora, concluidoEm: agora },
        });
        if (reserva.count !== 1) {
          throw new ConflictException({ mensagem: 'A versão final já foi avaliada — atualize a página.' });
        }
        const aprovaDoc = await tx.documentoTcc.updateMany({
          where: { tccId, tipo: 'VERSAO_FINAL', status: 'PENDENTE' },
          data: { status: 'APROVADO', parecer: null },
        });
        if (aprovaDoc.count < 1) {
          throw new BadRequestException({ mensagem: 'Não há versão final aguardando validação.' });
        }
      });
      await this.eventos.emitirParaUsuario('aluno_tcc_concluido', tcc.alunoId, 'TCC concluído 🎉', `Parabéns! Seu TCC "${tcc.titulo}" foi aprovado e concluído.`);
      await this.eventos.emitirParaCoordenadores('coord_tcc_concluido', 'TCC concluído', `O TCC "${tcc.titulo}" foi concluído — versão final validada pelo orientador.`, `/coordenador/tccs/${tccId}`);
      await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC concluído', `O TCC "${tcc.titulo}" (no qual você é coorientador) foi concluído.`);
    } else {
      // Pedido de ajustes também é CONDICIONAL a VALIDACAO_VERSAO_FINAL (item 3): a fase é o
      // guarda de vencedor único; e EXIGE a versão final PENDENTE na MESMA transação (item 4) —
      // sem uma versão em avaliação não há o que devolver para ajustes, então reverte.
      await this.prisma.$transaction(async (tx) => {
        const reserva = await tx.tcc.updateMany({
          where: { id: tccId, faseAtual: 'VALIDACAO_VERSAO_FINAL' },
          data: { faseAtual: 'AGUARDANDO_AJUSTES_FINAIS' },
        });
        if (reserva.count !== 1) {
          throw new ConflictException({ mensagem: 'A versão final já foi avaliada — atualize a página.' });
        }
        const rejeitaDoc = await tx.documentoTcc.updateMany({
          where: { tccId, tipo: 'VERSAO_FINAL', status: 'PENDENTE' },
          data: { status: 'REJEITADO', parecer: parecer ?? null },
        });
        if (rejeitaDoc.count < 1) {
          throw new BadRequestException({ mensagem: 'Não há versão final aguardando validação.' });
        }
      });
      await this.eventos.emitirParaUsuario('aluno_versao_final_rejeitada', tcc.alunoId, 'Versão final precisa de ajustes', `O orientador pediu ajustes na versão final do TCC "${tcc.titulo}".${parecer ? ' Devolutiva: ' + parecer : ''}`);
      await this.eventos.emitirParaUsuario('coorientador_documentos', tcc.coorientadorId, 'Versão final precisa de ajustes', `O orientador pediu ajustes na versão final do TCC "${tcc.titulo}" (no qual você é coorientador).`);
    }
    return { ok: true };
  }

  // Documentos da ABERTURA (plano + termo). Só na fase de solicitação e só esses dois tipos.
  async adicionarDocumento(alunoId: string, tccId: string, tipo: string, arquivo: any) {
    const tcc = await buscarTccAtivoOuFalhar(this.prisma, tccId);
    if (tcc.alunoId !== alunoId) throw new ForbiddenException();
    if (!['PLANO_DESENVOLVIMENTO', 'TERMO_ACEITE'].includes(tipo)) {
      throw new BadRequestException({ mensagem: 'Tipo de documento inválido.' });
    }
    if (tcc.faseAtual !== 'INICIALIZACAO') {
      throw new BadRequestException({ mensagem: 'Os documentos de abertura só podem ser enviados na solicitação.' });
    }
    // Mesmo prazo da abertura (ENVIO_DOCUMENTOS) bloqueia subir PLANO/TERMO fora do prazo sem
    // liberação individual — fecha o caminho de chamar a API direto. Escopo aluno+semestre.
    await this.prazos.exigirEtapaLiberada({ etapa: 'ENVIO_DOCUMENTOS', semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
    this.validarFormato(tipo, arquivo);
    const arq = await this.gravarArquivo(arquivo);
    try {
      // Transação: teto de documentos + criação atômicos (sem corrida entre uploads paralelos).
      return await this.prisma.$transaction(async (tx) => {
        await this.exigirEspacoParaDocumento(tx, tccId);
        return tx.documentoTcc.create({
          data: { tccId, tipo, status: 'PENDENTE', ...arq },
        });
      });
    } catch (e) {
      await fs.rm(join(process.cwd(), arq.caminho), { force: true }).catch(() => {});
      throw e;
    }
  }
}
