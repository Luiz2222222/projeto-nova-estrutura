import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventosTccService } from '../eventos-tcc/eventos-tcc.service';
import { PrazosService } from '../prazos/prazos.service';
import { corrigirNomeArquivo } from '../comum/nome-arquivo';
import { sanitizarNotasTcc } from '../comum/sanitizar-notas';
import {
  mediaNotas,
  notaFinal,
  PESO_NF1,
  PESO_NF2,
  aprovadoFase1,
  aprovadoFinal,
  CRITERIOS_FASE1,
  CRITERIOS_FASE2,
  colunaPeso,
  colunaNota,
  soma,
  arquivoPermitidoParaTipo,
  formatoDoTipoDoc,
} from '@tcc/compartilhado';

@Injectable()
export class BancasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosTccService,
    private readonly prazos: PrazosService,
  ) {}

  // Candidatos a avaliador (professores e avaliadores externos), exceto o aluno e o orientador.
  async candidatos(tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    const excluir = [tcc.alunoId, tcc.orientadorId, tcc.coorientadorId].filter((x): x is string => !!x);
    return this.prisma.usuario.findMany({
      where: { papel: { in: ['PROFESSOR', 'AVALIADOR'] }, id: { notIn: excluir } },
      select: { id: true, nomeCompleto: true, tratamento: true, papel: true, afiliacao: true },
      orderBy: { nomeCompleto: 'asc' },
    });
  }

  // Grava um arquivo no disco e devolve {nomeArquivo, caminho, tamanho}. Mesmo padrão
  // seguro dos uploads de TCC: nome interno aleatório (sem path traversal); o nome
  // enviado vira só metadado (com acentos corrigidos).
  private async gravarArquivo(arquivo: any) {
    const dir = join(process.cwd(), 'uploads');
    await fs.mkdir(dir, { recursive: true });
    const ext = extname(arquivo.originalname || '').replace(/[^.a-zA-Z0-9]/g, '').slice(0, 10);
    const nome = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    await fs.writeFile(join(dir, nome), arquivo.buffer);
    return { nomeArquivo: corrigirNomeArquivo(arquivo.originalname), caminho: join('uploads', nome), tamanho: arquivo.size };
  }

  // Coordenador forma a banca da Fase I (2 avaliadores) e ENVIA o documento que a
  // banca deve avaliar. A da Fase II é montada automaticamente ao validar a Fase I
  // (orientador + os 2 avaliadores da Fase I).
  async formarBanca(tccId: string, avaliadorIds: string[], arquivo: any) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();

    if (tcc.faseAtual !== 'FORMACAO_BANCA_FASE_1') {
      throw new BadRequestException({ mensagem: 'O TCC não está aguardando formação da banca da Fase I.' });
    }
    if (!arquivo) {
      throw new BadRequestException({ mensagem: 'Envie o documento para avaliação da banca.' });
    }
    if (!arquivoPermitidoParaTipo('AVALIACAO_BANCA', arquivo.originalname ?? '')) {
      throw new BadRequestException({ mensagem: `Para o documento da banca, envie ${formatoDoTipoDoc('AVALIACAO_BANCA').rotulo}.` });
    }
    const fase = 'FASE_1' as const;
    const qtd = 2;
    const proxima = 'AVALIACAO_FASE_1';

    const ids = [...new Set(avaliadorIds)];
    if (ids.length !== qtd) {
      throw new BadRequestException({ mensagem: `A banca da Fase I deve ter exatamente ${qtd} avaliadores distintos.` });
    }
    const proibidos = [tcc.alunoId, tcc.orientadorId, tcc.coorientadorId].filter((x): x is string => !!x);
    if (ids.some((id) => proibidos.includes(id))) {
      throw new BadRequestException({ mensagem: 'Aluno, orientador e coorientador não podem ser avaliadores.' });
    }
    const validos = await this.prisma.usuario.count({
      where: { id: { in: ids }, papel: { in: ['PROFESSOR', 'AVALIADOR'] } },
    });
    if (validos !== qtd) throw new BadRequestException({ mensagem: 'Avaliador inválido.' });

    // Grava o arquivo primeiro; se a transação falhar, remove o órfão.
    const meta = await this.gravarArquivo(arquivo);
    try {
      await this.prisma.$transaction(async (tx) => {
        const doc = await tx.documentoTcc.create({
          data: { tccId, tipo: 'AVALIACAO_BANCA', status: 'APROVADO', ...meta },
        });
        await tx.banca.create({
          data: {
            tccId,
            fase,
            documentoAvaliacaoId: doc.id,
            membros: { create: ids.map((id) => ({ avaliadorId: id })) },
          },
        });
        await tx.tcc.update({ where: { id: tccId }, data: { faseAtual: proxima } });
      });
    } catch (e) {
      await fs.unlink(join(process.cwd(), meta.caminho)).catch(() => undefined);
      throw e;
    }
    await this.eventos.emitirParaUsuario('aluno_banca_fase1_formada', tcc.alunoId, 'Banca da Fase I formada', `A banca da Fase I do seu TCC "${tcc.titulo}" foi formada.`);
    const bancaCriada = await this.prisma.banca.findUnique({
      where: { tccId_fase: { tccId, fase: 'FASE_1' } },
      include: { membros: { include: { avaliador: { select: { papel: true } } } } },
    });
    for (const m of bancaCriada?.membros ?? []) {
      const base = m.avaliador.papel === 'AVALIADOR' ? '/avaliador/bancas' : '/professor/bancas';
      await this.eventos.emitirParaUsuario('avaliador_adicionado_fase1', m.avaliadorId, 'Você foi adicionado a uma banca (Fase I)', `Você foi adicionado à banca da Fase I do TCC "${tcc.titulo}".`, `${base}/${m.id}`);
      await this.eventos.emitirParaUsuario('avaliador_fase1_liberada', m.avaliadorId, 'Avaliação da Fase I liberada', `A avaliação da Fase I do TCC "${tcc.titulo}" está liberada — você já pode avaliar.`, `${base}/${m.id}`);
    }
    return { ok: true };
  }

  // Bancas em que o usuário é avaliador (com o TCC, a própria nota e os pesos do semestre do TCC).
  async minhasBancas(avaliadorId: string) {
    const membros = await this.prisma.membroBanca.findMany({
      where: { avaliadorId },
      include: {
        banca: {
          include: {
            tcc: { include: { aluno: { select: { nomeCompleto: true } }, documentos: true } },
            documentoAvaliacao: true,
          },
        },
      },
      orderBy: { banca: { criadoEm: 'desc' } },
    });
    // Anexa os pesos do calendário do SEMESTRE de cada TCC (e não do semestre atual),
    // para o formulário de avaliação bater com o que o backend usa ao validar.
    const semestres = [...new Set(membros.map((m) => m.banca.tcc.semestre))];
    const cals = await this.prisma.calendario.findMany({ where: { semestre: { in: semestres } } });
    const porSemestre = new Map(cals.map((c) => [c.semestre, c]));
    // bloqueado = prazo da avaliação da fase vencido sem liberação (para desabilitar o envio).
    return Promise.all(
      membros.map(async (m) => {
        const etapa = m.banca.fase === 'FASE_1' ? 'AVALIACAO_FASE_1' : 'APRESENTACAO_FASE_2';
        const bloqueado = await this.prazos.prazoBloqueado({
          etapa,
          semestre: m.banca.tcc.semestre,
          tccId: m.banca.tcc.id,
          alunoId: m.banca.tcc.alunoId,
        });
        // O avaliador vê a PRÓPRIA avaliação (m.nota*/m.parecer) — necessário para editar.
        // Mas o TCC embutido não pode vazar NF1/NF2/NF/resultado antes da confirmação final.
        const banca = { ...m.banca, tcc: sanitizarNotasTcc(m.banca.tcc) };
        return { ...m, banca, pesos: porSemestre.get(m.banca.tcc.semestre) ?? null, bloqueado };
      }),
    );
  }

  // Avaliador pontua os critérios da fase. finalizar=false → salva RASCUNHO (notas
  // parciais; status PENDENTE; não conta como avaliação final). finalizar=true → ENVIA
  // (exige todas as notas; status ENVIADO). Edição liberada enquanto status ∈ {PENDENTE,
  // ENVIADO}; BLOQUEADO/CONCLUIDO travam. A fase só avança para VALIDACAO quando TODOS
  // os membros estão ENVIADO+ (rascunho não dispara). Rascunho só durante AVALIACAO_*.
  async avaliar(avaliadorId: string, bancaId: string, notas: Record<string, number>, parecer?: string, finalizar = true) {
    // Gate de prazo (fonte real da regra): Fase I usa "Avaliação — Fase I"; Fase II usa
    // "Apresentação dos trabalhos — Fase II". Vencido sem liberação bloqueia salvar/enviar.
    const info = await this.prisma.membroBanca.findFirst({
      where: { bancaId, avaliadorId },
      include: { banca: { include: { tcc: { select: { id: true, alunoId: true, semestre: true } } } } },
    });
    if (info) {
      const etapa = info.banca.fase === 'FASE_1' ? 'AVALIACAO_FASE_1' : 'APRESENTACAO_FASE_2';
      await this.prazos.exigirEtapaLiberada({
        etapa,
        semestre: info.banca.tcc.semestre,
        tccId: info.banca.tcc.id,
        alunoId: info.banca.tcc.alunoId,
      });
    }

    const res = await this.prisma.$transaction(async (tx) => {
      const membro = await tx.membroBanca.findFirst({
        where: { bancaId, avaliadorId },
        include: { banca: { include: { tcc: true } } },
      });
      if (!membro) throw new ForbiddenException();
      if (membro.status === 'BLOQUEADO' || membro.status === 'CONCLUIDO') {
        throw new BadRequestException({ mensagem: 'Esta avaliação foi bloqueada/concluída e não pode mais ser editada.' });
      }
      const tcc = membro.banca.tcc;
      const ehF1 = membro.banca.fase === 'FASE_1';
      const faseAval = ehF1 ? 'AVALIACAO_FASE_1' : 'AVALIACAO_FASE_2';
      const faseAguardando = ehF1 ? 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1' : 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2';
      const faseValid = ehF1 ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2';
      const emAvaliacao = tcc.faseAtual === faseAval;
      const emAguardando = tcc.faseAtual === faseAguardando;
      const emValidacao = tcc.faseAtual === faseValid;
      // Durante a VALIDAÇÃO a banca está travada: só o membro com AJUSTE_SOLICITADO reenviar
      // (exceção controlada pela coordenação). Nas outras fases, edição normal.
      if (emValidacao) {
        if (membro.status !== 'AJUSTE_SOLICITADO') {
          throw new BadRequestException({ mensagem: 'A coordenação já iniciou a análise. Você só pode editar se houver um ajuste solicitado para você.' });
        }
        // AJUSTE_SOLICITADO: pode salvar rascunho (mantém status e motivo) ou enviar (finaliza).
      } else if (!emAvaliacao && !emAguardando) {
        throw new BadRequestException({ mensagem: 'Esta banca não está em fase de avaliação.' });
      } else if (!finalizar && !emAvaliacao) {
        throw new BadRequestException({ mensagem: 'A avaliação já foi enviada por todos; reabra antes de salvar rascunho.' });
      }

      // Pesos: do Calendário do semestre; se não houver, usa os defaults dos critérios.
      // Valida cada nota (0..peso). Ausentes são OK no rascunho; no envio, exige todas.
      const criterios = ehF1 ? CRITERIOS_FASE1 : CRITERIOS_FASE2;
      const calendario: any = await tx.calendario.findUnique({ where: { semestre: tcc.semestre } });
      const notasLimpas: Record<string, number | null> = {};
      const valores: number[] = [];
      let faltam = false;
      for (const c of criterios) {
        const peso = calendario?.[colunaPeso(c.chave)] ?? c.pesoPadrao;
        const bruto = notas?.[c.chave];
        if (bruto === undefined || bruto === null || Number.isNaN(Number(bruto))) {
          notasLimpas[c.chave] = null;
          faltam = true;
          continue;
        }
        const nota = Number(bruto);
        if (!Number.isFinite(nota) || nota < 0 || nota > peso) {
          throw new BadRequestException({ mensagem: `Nota de "${c.rotulo}" deve estar entre 0 e ${peso}.` });
        }
        notasLimpas[c.chave] = nota;
        valores.push(nota);
      }

      const data: Record<string, number | string | Date | null> = {};
      if (finalizar) {
        if (faltam) throw new BadRequestException({ mensagem: 'Para enviar, preencha todas as notas dos critérios.' });
        // ENVIO: grava as colunas OFICIAIS (visíveis ao coordenador) e limpa o rascunho.
        for (const c of criterios) data[colunaNota(c.chave)] = notasLimpas[c.chave];
        data.parecer = parecer ?? null;
        data.nota = soma(valores); // total do membro (0–10)
        data.status = 'ENVIADO';
        data.avaliadoEm = new Date();
        data.rascunho = null;
        if (emValidacao) data.ajusteMotivo = null; // reenvio após ajuste: limpa o motivo
      } else {
        // RASCUNHO PRIVADO: guarda em coluna separada; NÃO toca nas colunas oficiais nem no
        // total/status de envio — assim o coordenador não vê o rascunho antes do envio final.
        data.rascunho = JSON.stringify({ notas: notasLimpas, parecer: parecer ?? '' });
        // Mantém o status: PENDENTE (avaliação normal) ou AJUSTE_SOLICITADO (em ajuste — não
        // muda o status nem limpa o motivo; só o ENVIAR final faz isso).
        data.status = emValidacao ? 'AJUSTE_SOLICITADO' : 'PENDENTE';
      }

      // Update CONDICIONAL: em VALIDACAO só reenvia quem está AJUSTE_SOLICITADO; fora dela,
      // apenas rascunho/enviado (barra corrida contra o travamento pela coordenação).
      const statusEditaveis = emValidacao ? ['AJUSTE_SOLICITADO'] : ['PENDENTE', 'ENVIADO'];
      const atualizado = await tx.membroBanca.updateMany({
        where: { id: membro.id, status: { in: statusEditaveis } },
        data,
      });
      if (atualizado.count !== 1) {
        throw new BadRequestException({ mensagem: 'Não foi possível salvar — a avaliação foi travada pela coordenação. Atualize a página.' });
      }

      // Quando TODOS enviam (durante a avaliação), a fase vai para "aguardando análise da
      // coordenação" — NÃO direto para validação (que exige o coordenador iniciar a análise).
      let completou = false;
      let reenvioAjuste = false;
      if (finalizar && emAvaliacao) {
        const membros = await tx.membroBanca.findMany({ where: { bancaId } });
        if (membros.every((mm) => ['ENVIADO', 'BLOQUEADO', 'CONCLUIDO'].includes(mm.status))) {
          await tx.tcc.update({ where: { id: tcc.id }, data: { faseAtual: faseAguardando } });
          completou = true;
        }
      } else if (finalizar && emValidacao) {
        reenvioAjuste = true; // reenvio de um ajuste solicitado → avisa a coordenação
      }
      return { completou, reenvioAjuste, fase: membro.banca.fase as 'FASE_1' | 'FASE_2', titulo: tcc.titulo, finalizar, tccId: tcc.id, statusSalvo: data.status as string };
    });

    // Todos enviaram → fase "aguardando análise". Notifica coordenação, aluno, orientador e
    // banca (sem vazar notas).
    if (res.completou) {
      await this.notificarAvaliacoesConcluidas(res.tccId, res.fase);
    } else if (res.reenvioAjuste) {
      // Reenvio de um ajuste: só a coordenação é avisada.
      const faseNome = this.faseNomePt(res.fase);
      await this.eventos.emitirParaCoordenadores('coord_avaliacao_reenviada', `Avaliação reenviada (${faseNome})`, `Um avaliador reenviou a avaliação da ${faseNome} do TCC "${res.titulo}" após o ajuste solicitado.`, `/coordenador/tccs/${res.tccId}#validacao`);
    }
    // Devolve o status REAL salvo: ENVIADO (finalizar), AJUSTE_SOLICITADO (rascunho durante
    // ajuste) ou PENDENTE (rascunho normal).
    return { ok: true, status: res.statusSalvo };
  }

  // Reabre a própria avaliação ENVIADO → PENDENTE (preserva notas/parecer; a nota total
  // volta a null). Se a fase já estava em VALIDACAO_* (todos enviaram), volta para
  // AVALIACAO_* para o coordenador não validar com avaliação pendente. Só enquanto a
  // avaliação não estiver BLOQUEADO/CONCLUIDO.
  async reabrir(avaliadorId: string, bancaId: string) {
    // Mesmo gate de prazo do envio: reabrir uma avaliação ENVIADA só vale dentro do prazo
    // (ou com liberação). Senão o professor zeraria a nota sem poder reenviar — travando o TCC.
    const info = await this.prisma.membroBanca.findFirst({
      where: { bancaId, avaliadorId },
      include: { banca: { include: { tcc: { select: { id: true, alunoId: true, semestre: true } } } } },
    });
    if (info) {
      const etapa = info.banca.fase === 'FASE_1' ? 'AVALIACAO_FASE_1' : 'APRESENTACAO_FASE_2';
      await this.prazos.exigirEtapaLiberada({
        etapa,
        semestre: info.banca.tcc.semestre,
        tccId: info.banca.tcc.id,
        alunoId: info.banca.tcc.alunoId,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const membro = await tx.membroBanca.findFirst({
        where: { bancaId, avaliadorId },
        include: { banca: { include: { tcc: true } } },
      });
      if (!membro) throw new ForbiddenException();
      if (membro.status !== 'ENVIADO') {
        throw new BadRequestException({ mensagem: 'Só é possível reabrir uma avaliação enviada.' });
      }
      const tcc = membro.banca.tcc;
      const ehF1 = membro.banca.fase === 'FASE_1';
      const faseAval = ehF1 ? 'AVALIACAO_FASE_1' : 'AVALIACAO_FASE_2';
      const faseAguardando = ehF1 ? 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1' : 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2';
      // O avaliador só reabre por conta própria enquanto está em AVALIACAO ou AGUARDANDO
      // (antes de o coordenador iniciar a análise). Em VALIDACAO a banca está travada.
      if (tcc.faseAtual !== faseAval && tcc.faseAtual !== faseAguardando) {
        throw new BadRequestException({ mensagem: 'A coordenação já iniciou a análise; não é possível reabrir a avaliação por conta própria.' });
      }
      // Reabrir volta a avaliação a ser um RASCUNHO PRIVADO do avaliador: move as notas/parecer
      // enviados para a coluna `rascunho` e LIMPA as colunas oficiais, para o coordenador deixar
      // de ver essa avaliação (ela não está mais "recebida").
      const criterios = ehF1 ? CRITERIOS_FASE1 : CRITERIOS_FASE2;
      const notasRasc: Record<string, number | null> = {};
      const limparColunas: Record<string, null> = {};
      for (const c of criterios) {
        notasRasc[c.chave] = (membro as any)[colunaNota(c.chave)] ?? null;
        limparColunas[colunaNota(c.chave)] = null;
      }
      const rascunho = JSON.stringify({ notas: notasRasc, parecer: membro.parecer ?? '' });
      const atualizado = await tx.membroBanca.updateMany({
        where: { id: membro.id, status: 'ENVIADO' },
        data: { status: 'PENDENTE', nota: null, avaliadoEm: null, parecer: null, rascunho, ...limparColunas },
      });
      if (atualizado.count !== 1) throw new BadRequestException({ mensagem: 'Não foi possível reabrir a avaliação.' });
      // Estava aguardando análise (todos enviaram) → deixa de estar pronta: volta para avaliação.
      if (tcc.faseAtual === faseAguardando) {
        await tx.tcc.update({ where: { id: tcc.id }, data: { faseAtual: faseAval } });
      }
    });
    return { ok: true, status: 'PENDENTE' };
  }

  // ----- Edição administrativa da banca pelo coordenador -----

  // Pesos do calendário do SEMESTRE do TCC (ou null → o front usa os defaults dos critérios).
  async pesosDaBanca(tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    return this.prisma.calendario.findUnique({ where: { semestre: tcc.semestre } });
  }

  // Ajusta a fase entre AVALIACAO_* e VALIDACAO_* conforme os status dos membros da banca.
  // Não mexe em fases terminais/concluídas (só atua quando o TCC está na própria fase).
  private async ajustarFasePorBanca(
    tx: Prisma.TransactionClient,
    banca: { id: string; fase: string },
    tcc: { id: string; faseAtual: string },
  ) {
    const ehF1 = banca.fase === 'FASE_1';
    const faseAval = ehF1 ? 'AVALIACAO_FASE_1' : 'AVALIACAO_FASE_2';
    const faseAguardando = ehF1 ? 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1' : 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2';
    const faseValid = ehF1 ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2';
    if (![faseAval, faseAguardando, faseValid].includes(tcc.faseAtual)) return;
    const membros = await tx.membroBanca.findMany({ where: { bancaId: banca.id } });
    if (membros.length === 0) return;
    const todosEnviaram = membros.every((m) => ['ENVIADO', 'EM_ANALISE', 'APROVADO', 'BLOQUEADO', 'CONCLUIDO'].includes(m.status));
    if (tcc.faseAtual === faseAval && todosEnviaram) {
      // Todos enviaram → aguarda a análise da coordenação (não entra em validação sozinho).
      await tx.tcc.update({ where: { id: tcc.id }, data: { faseAtual: faseAguardando } });
    } else if ((tcc.faseAtual === faseAguardando || tcc.faseAtual === faseValid) && !todosEnviaram) {
      // Alguém deixou de ter avaliação enviada (ex.: novo avaliador) → volta para avaliação.
      await tx.tcc.update({ where: { id: tcc.id }, data: { faseAtual: faseAval } });
    }
  }

  // Coordenador edita a avaliação de um membro: notas por critério (capadas no peso),
  // parecer e status. Status ENVIADO/BLOQUEADO/CONCLUIDO exige todas as notas; PENDENTE
  // aceita parcial (nota total null se incompleto). Ajusta a fase ao final. Não recalcula
  // NF1/NF2/NF (isso é feito na validação da coordenação).
  async editarAvaliacaoMembro(membroId: string, notas: Record<string, number>, parecer: string | undefined, status: string) {
    await this.prisma.$transaction(async (tx) => {
      const membro = await tx.membroBanca.findUnique({
        where: { id: membroId },
        include: { banca: { include: { tcc: true } } },
      });
      if (!membro) throw new NotFoundException();
      const tcc = membro.banca.tcc;
      // Edição administrativa do COORDENADOR (endpoint @Papeis('COORDENADOR')) é permitida em
      // QUALQUER fase, inclusive já validada/concluída. As notas apuradas (NF1/NF2/NF/resultado)
      // são recalculadas ao final para manter a consistência com as notas atuais da banca.
      const criterios = membro.banca.fase === 'FASE_1' ? CRITERIOS_FASE1 : CRITERIOS_FASE2;
      const calendario: any = await tx.calendario.findUnique({ where: { semestre: tcc.semestre } });
      const exigeCompleto = ['ENVIADO', 'EM_ANALISE', 'APROVADO', 'BLOQUEADO', 'CONCLUIDO'].includes(status);

      const data: Record<string, number | string | Date | null> = {};
      const valores: number[] = [];
      let faltam = false;
      for (const c of criterios) {
        const peso = calendario?.[colunaPeso(c.chave)] ?? c.pesoPadrao;
        const bruto = notas?.[c.chave];
        if (bruto === undefined || bruto === null || Number.isNaN(Number(bruto))) {
          data[colunaNota(c.chave)] = null;
          faltam = true;
          continue;
        }
        const nota = Number(bruto);
        if (!Number.isFinite(nota) || nota < 0 || nota > peso) {
          throw new BadRequestException({ mensagem: `Nota de "${c.rotulo}" deve estar entre 0 e ${peso}.` });
        }
        data[colunaNota(c.chave)] = nota;
        valores.push(nota);
      }
      if (exigeCompleto && faltam) {
        throw new BadRequestException({ mensagem: 'Para este status, preencha todas as notas dos critérios.' });
      }
      data.parecer = parecer ?? null;
      data.status = status;
      data.nota = faltam ? null : soma(valores);
      data.avaliadoEm = exigeCompleto ? new Date() : null;
      // Edição administrativa grava as colunas OFICIAIS: descarta qualquer rascunho privado
      // stale para não sobrescrever/esconder visualmente a edição do coordenador.
      data.rascunho = null;

      await tx.membroBanca.update({ where: { id: membroId }, data });
      await this.ajustarFasePorBanca(tx, membro.banca, { id: tcc.id, faseAtual: tcc.faseAtual });
      await this.recalcularNotasApuradas(tx, tcc.id);
    });
    return { ok: true };
  }

  // Após uma edição administrativa do coordenador, recalcula NF1/NF2/NF/resultado que JÁ
  // haviam sido apurados, mantendo-os consistentes com as notas atuais da banca. NÃO mexe na
  // fase/fluxo — só nos números já existentes (fases ainda não validadas têm NF null e são
  // ignoradas aqui; a apuração inicial continua sendo feita na validação da coordenação).
  private async recalcularNotasApuradas(tx: Prisma.TransactionClient, tccId: string) {
    const tcc = await tx.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) return;
    const mediaDaBanca = async (fase: 'FASE_1' | 'FASE_2'): Promise<number | null> => {
      const banca = await tx.banca.findUnique({ where: { tccId_fase: { tccId, fase } }, include: { membros: true } });
      const membros = banca?.membros ?? [];
      if (membros.length === 0 || membros.some((m) => m.nota == null)) return null;
      return mediaNotas(membros.map((m) => m.nota ?? 0));
    };
    const data: Record<string, number | string | null> = {};
    if (tcc.nf1 != null) {
      const m = await mediaDaBanca('FASE_1');
      if (m != null) data.nf1 = m;
    }
    if (tcc.nf2 != null) {
      const m = await mediaDaBanca('FASE_2');
      if (m != null) data.nf2 = m;
    }
    const nf1n = (data.nf1 as number | undefined) ?? tcc.nf1;
    const nf2n = (data.nf2 as number | undefined) ?? tcc.nf2;
    if (tcc.nf != null && nf1n != null && nf2n != null) {
      const cal: any = await tx.calendario.findUnique({ where: { semestre: tcc.semestre } });
      const nf = notaFinal(nf1n, nf2n, cal?.pesoFase1 ?? PESO_NF1, cal?.pesoFase2 ?? PESO_NF2);
      data.nf = nf;
      // Só recomputa o resultado FINAL já definido (aprovado/reprovado na Fase II).
      if (tcc.resultado === 'APROVADO' || tcc.resultado === 'REPROVADO') {
        data.resultado = aprovadoFinal(nf) ? 'APROVADO' : 'REPROVADO';
      }
    }
    if (Object.keys(data).length > 0) await tx.tcc.update({ where: { id: tccId }, data });
  }

  // Coordenador troca os 2 avaliadores da banca da Fase I. Preserva os que continuarem;
  // remove quem saiu; novos entram PENDENTE/sem notas. Sincroniza a Fase II (se existir)
  // para continuar sendo orientador + os 2 avaliadores atuais da Fase I.
  async editarAvaliadoresFase1(tccId: string, avaliadorIds: string[]) {
    const ids = [...new Set(avaliadorIds)];
    if (ids.length !== 2) {
      throw new BadRequestException({ mensagem: 'A banca da Fase I deve ter exatamente 2 avaliadores distintos.' });
    }
    await this.prisma.$transaction(async (tx) => {
      const tcc = await tx.tcc.findUnique({ where: { id: tccId } });
      if (!tcc) throw new NotFoundException();
      // Só dá para trocar os avaliadores da Fase I ANTES de a Fase I ser validada — depois
      // disso a NF1 já foi calculada e trocar avaliadores deixaria histórico/nota inconsistentes.
      if (!['FORMACAO_BANCA_FASE_1', 'AVALIACAO_FASE_1', 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1'].includes(tcc.faseAtual)) {
        throw new BadRequestException({
          mensagem: 'A coordenação já iniciou a análise da Fase I — não é possível trocar os avaliadores a partir daqui.',
        });
      }
      const bancaF1 = await tx.banca.findUnique({ where: { tccId_fase: { tccId, fase: 'FASE_1' } }, include: { membros: true } });
      if (!bancaF1) throw new BadRequestException({ mensagem: 'A banca da Fase I ainda não foi formada.' });

      const proibidos = [tcc.alunoId, tcc.orientadorId, tcc.coorientadorId].filter((x): x is string => !!x);
      if (ids.some((id) => proibidos.includes(id))) {
        throw new BadRequestException({ mensagem: 'Aluno, orientador e coorientador não podem ser avaliadores.' });
      }
      const validos = await tx.usuario.count({ where: { id: { in: ids }, papel: { in: ['PROFESSOR', 'AVALIADOR'] } } });
      if (validos !== ids.length) throw new BadRequestException({ mensagem: 'Avaliador inválido.' });

      // Fase I: remove quem saiu, adiciona quem entrou (PENDENTE), mantém quem ficou.
      const atuaisF1 = bancaF1.membros.map((m) => m.avaliadorId);
      const removerF1 = bancaF1.membros.filter((m) => !ids.includes(m.avaliadorId)).map((m) => m.id);
      const adicionarF1 = ids.filter((id) => !atuaisF1.includes(id));
      if (removerF1.length) await tx.membroBanca.deleteMany({ where: { id: { in: removerF1 } } });
      for (const id of adicionarF1) await tx.membroBanca.create({ data: { bancaId: bancaF1.id, avaliadorId: id } });

      // Fase II (se já existe) = orientador + os 2 avaliadores da Fase I.
      const bancaF2 = await tx.banca.findUnique({ where: { tccId_fase: { tccId, fase: 'FASE_2' } }, include: { membros: true } });
      if (bancaF2) {
        const desejadosF2 = [tcc.orientadorId, ...ids].filter((x): x is string => !!x);
        const atuaisF2 = bancaF2.membros.map((m) => m.avaliadorId);
        const removerF2 = bancaF2.membros.filter((m) => !desejadosF2.includes(m.avaliadorId)).map((m) => m.id);
        const adicionarF2 = desejadosF2.filter((id) => !atuaisF2.includes(id));
        if (removerF2.length) await tx.membroBanca.deleteMany({ where: { id: { in: removerF2 } } });
        for (const id of adicionarF2) await tx.membroBanca.create({ data: { bancaId: bancaF2.id, avaliadorId: id } });
      }

      // Reavalia a transição de fase (um novo membro PENDENTE pode reverter VALIDACAO→AVALIACAO).
      const atual = await tx.tcc.findUnique({ where: { id: tccId } });
      if (atual) {
        await this.ajustarFasePorBanca(tx, { id: bancaF1.id, fase: 'FASE_1' }, { id: tccId, faseAtual: atual.faseAtual });
        if (bancaF2) {
          const atual2 = await tx.tcc.findUnique({ where: { id: tccId } });
          if (atual2) await this.ajustarFasePorBanca(tx, { id: bancaF2.id, fase: 'FASE_2' }, { id: tccId, faseAtual: atual2.faseAtual });
        }
      }
    });
    return { ok: true };
  }

  // ----- Análise da coordenação (estado intermediário entre avaliação e validação) -----

  private faseNomePt(fase: 'FASE_1' | 'FASE_2') {
    return fase === 'FASE_1' ? 'Fase I' : 'Fase II';
  }

  private async carregarBancaParaAviso(tccId: string, fase: 'FASE_1' | 'FASE_2') {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    const banca = await this.prisma.banca.findUnique({
      where: { tccId_fase: { tccId, fase } },
      include: { membros: { select: { avaliadorId: true } } },
    });
    return { tcc, membros: banca?.membros ?? [] };
  }

  // Todos enviaram → coordenação, aluno, orientador e banca (sem vazar notas).
  private async notificarAvaliacoesConcluidas(tccId: string, fase: 'FASE_1' | 'FASE_2') {
    const { tcc, membros } = await this.carregarBancaParaAviso(tccId, fase);
    if (!tcc) return;
    const faseNome = this.faseNomePt(fase);
    const eventoCoord = fase === 'FASE_1' ? 'coord_validar_fase1' : 'coord_validar_fase2';
    await this.eventos.emitirParaCoordenadores(eventoCoord, `Avaliações da ${faseNome} concluídas`, `Avaliações da ${faseNome} concluídas: aguardando análise da coordenação — TCC "${tcc.titulo}".`, `/coordenador/tccs/${tccId}#validacao`);
    const msg = `As avaliações da ${faseNome} do TCC "${tcc.titulo}" foram concluídas; as análises seguem para avaliação da coordenação.`;
    const alvos = new Set<string>();
    if (tcc.alunoId) alvos.add(tcc.alunoId);
    if (tcc.orientadorId) alvos.add(tcc.orientadorId);
    membros.forEach((m) => m.avaliadorId && alvos.add(m.avaliadorId));
    for (const uid of alvos) {
      await this.eventos.emitirParaUsuario('fase_avaliacoes_concluidas', uid, `Avaliações da ${faseNome} concluídas`, msg);
    }
  }

  // Coordenação iniciou a análise → banca, orientador e aluno (sem vazar notas).
  private async notificarAnaliseIniciada(tccId: string, fase: 'FASE_1' | 'FASE_2') {
    const { tcc, membros } = await this.carregarBancaParaAviso(tccId, fase);
    if (!tcc) return;
    const faseNome = this.faseNomePt(fase);
    const msg = `A coordenação iniciou a análise das avaliações da ${faseNome} do TCC "${tcc.titulo}".`;
    const alvos = new Set<string>();
    if (tcc.alunoId) alvos.add(tcc.alunoId);
    if (tcc.orientadorId) alvos.add(tcc.orientadorId);
    membros.forEach((m) => m.avaliadorId && alvos.add(m.avaliadorId));
    for (const uid of alvos) {
      await this.eventos.emitirParaUsuario('fase_analise_iniciada', uid, `Análise iniciada — ${faseNome}`, msg);
    }
  }

  // Fase validada → orientador e banca (aluno recebe o evento próprio de resultado). Sem notas.
  private async notificarFaseValidada(tccId: string, fase: 'FASE_1' | 'FASE_2', titulo: string, orientadorId: string | null) {
    const { membros } = await this.carregarBancaParaAviso(tccId, fase);
    const faseNome = this.faseNomePt(fase);
    const msg = `A coordenação validou a ${faseNome} do TCC "${titulo}".`;
    const alvos = new Set<string>();
    if (orientadorId) alvos.add(orientadorId);
    membros.forEach((m) => m.avaliadorId && alvos.add(m.avaliadorId));
    for (const uid of alvos) {
      await this.eventos.emitirParaUsuario('fase_validada', uid, `${faseNome} validada`, msg);
    }
  }

  private faseFromAguardando(faseAtual: string): 'FASE_1' | 'FASE_2' | null {
    if (faseAtual === 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1') return 'FASE_1';
    if (faseAtual === 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2') return 'FASE_2';
    return null;
  }

  // Coordenador inicia a análise: AGUARDANDO_ANALISE_* → VALIDACAO_*, travando as avaliações
  // (EM_ANALISE). Só funciona se, no momento, TODOS os membros ainda estiverem ENVIADO — se
  // alguém reabriu, a fase já saiu de AGUARDANDO e retorna erro amigável.
  async iniciarAnalise(tccId: string) {
    const fase = await this.prisma.$transaction(async (tx) => {
      const tcc = await tx.tcc.findUnique({ where: { id: tccId } });
      if (!tcc) throw new NotFoundException();
      const fase = this.faseFromAguardando(tcc.faseAtual);
      if (!fase) {
        throw new BadRequestException({ mensagem: 'Uma avaliação foi reaberta. Atualize a página antes de iniciar a análise.' });
      }
      const banca = await tx.banca.findUnique({ where: { tccId_fase: { tccId, fase } }, include: { membros: true } });
      if (!banca || banca.membros.length === 0) {
        throw new BadRequestException({ mensagem: 'Não há avaliações para analisar.' });
      }
      if (!banca.membros.every((m) => m.status === 'ENVIADO')) {
        throw new BadRequestException({ mensagem: 'Uma avaliação foi reaberta. Atualize a página antes de iniciar a análise.' });
      }
      // Trava só o que ainda está ENVIADO (barra corrida contra uma reabertura simultânea).
      const travadas = await tx.membroBanca.updateMany({ where: { bancaId: banca.id, status: 'ENVIADO' }, data: { status: 'EM_ANALISE' } });
      if (travadas.count !== banca.membros.length) {
        throw new BadRequestException({ mensagem: 'Uma avaliação foi reaberta. Atualize a página antes de iniciar a análise.' });
      }
      const faseValid = fase === 'FASE_1' ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2';
      await tx.tcc.update({ where: { id: tccId }, data: { faseAtual: faseValid } });
      return fase;
    });
    await this.notificarAnaliseIniciada(tccId, fase);
    return { ok: true };
  }

  // Guard comum das ações individuais da análise: exige o TCC em VALIDACAO_* da fase do membro.
  private async carregarMembroEmValidacao(membroId: string) {
    const membro = await this.prisma.membroBanca.findUnique({
      where: { id: membroId },
      include: { banca: { include: { tcc: true } }, avaliador: { select: { papel: true } } },
    });
    // Mensagem clara (com `mensagem`, não o "Not Found" padrão) para quando a avaliação/
    // solicitação não existe mais — ex.: o coordenador tenta agir sobre dados já mudados.
    if (!membro) throw new NotFoundException({ mensagem: 'Avaliação não encontrada — os dados podem ter mudado. Atualize a página.' });
    const ehF1 = membro.banca.fase === 'FASE_1';
    const faseValid = ehF1 ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2';
    if (membro.banca.tcc.faseAtual !== faseValid) {
      throw new BadRequestException({ mensagem: 'A análise da coordenação ainda não foi iniciada nesta fase.' });
    }
    return { membro, ehF1 };
  }

  // Coordenador aprova a avaliação de um membro (sem notificação, conforme regra).
  async aprovarAvaliacaoMembro(membroId: string) {
    const { membro } = await this.carregarMembroEmValidacao(membroId);
    if (membro.nota == null) throw new BadRequestException({ mensagem: 'Não é possível aprovar uma avaliação sem nota.' });
    await this.prisma.membroBanca.update({ where: { id: membroId }, data: { status: 'APROVADO', ajusteMotivo: null } });
    return { ok: true };
  }

  // Link para o membro editar/ver a própria avaliação. O ORIENTADOR na banca da Fase II avalia
  // na página do orientando (#acao-fase2), não em "Participações em bancas".
  private linkDaAvaliacao(membro: {
    id: string;
    avaliadorId: string;
    avaliador: { papel: string };
    banca: { fase: string; tcc: { id: string; orientadorId: string | null } };
  }): string {
    if (membro.banca.fase === 'FASE_2' && membro.banca.tcc.orientadorId === membro.avaliadorId) {
      return `/professor/orientandos/${membro.banca.tcc.id}#acao-fase2`;
    }
    const base = membro.avaliador.papel === 'AVALIADOR' ? '/avaliador/bancas' : '/professor/bancas';
    return `${base}/${membro.id}`;
  }

  // Coordenador solicita ajuste a um membro (motivo obrigatório). Só aquele avaliador pode
  // reenviar; a fase continua em VALIDACAO_*. Notifica somente o avaliador (interno + e-mail).
  async solicitarAjuste(membroId: string, motivo: string) {
    // Motivo é OPCIONAL: o coordenador pode solicitar ajuste sem escrever nada.
    const texto = (motivo ?? '').trim();
    const { membro, ehF1 } = await this.carregarMembroEmValidacao(membroId);
    await this.prisma.membroBanca.update({ where: { id: membroId }, data: { status: 'AJUSTE_SOLICITADO', ajusteMotivo: texto || null } });
    const faseNome = this.faseNomePt(ehF1 ? 'FASE_1' : 'FASE_2');
    const base = `A coordenação solicitou um ajuste na sua avaliação da ${faseNome} do TCC "${membro.banca.tcc.titulo}".`;
    await this.eventos.emitirParaUsuario('avaliador_ajuste_solicitado', membro.avaliadorId, `Ajuste solicitado — ${faseNome}`, texto ? `${base} Motivo: ${texto}` : base, this.linkDaAvaliacao(membro));
    return { ok: true };
  }

  // Coordenador cancela/desfaz a solicitação de ajuste: o membro volta a ficar travado
  // (EM_ANALISE), sem poder reenviar por conta própria. Notifica somente o avaliador.
  async cancelarAjuste(membroId: string) {
    const { membro, ehF1 } = await this.carregarMembroEmValidacao(membroId);
    if (membro.status !== 'AJUSTE_SOLICITADO') {
      throw new BadRequestException({ mensagem: 'Não há solicitação de ajuste para cancelar neste avaliador.' });
    }
    // Descarta o rascunho privado do ajuste em andamento: a avaliação volta ao que estava
    // ENVIADO (colunas oficiais), travada, sem o rascunho cancelado.
    await this.prisma.membroBanca.update({ where: { id: membroId }, data: { status: 'EM_ANALISE', ajusteMotivo: null, rascunho: null } });
    const faseNome = this.faseNomePt(ehF1 ? 'FASE_1' : 'FASE_2');
    await this.eventos.emitirParaUsuario('avaliador_ajuste_cancelado', membro.avaliadorId, `Solicitação de ajuste cancelada — ${faseNome}`, `A solicitação de ajuste da sua avaliação foi cancelada pela coordenação.`, this.linkDaAvaliacao(membro));
    return { ok: true };
  }

  // Coordenador valida a fase. Fase I: NF1 = média, ≥6 segue p/ Fase II. Fase II: NF2 = média,
  // depois a nota final NF = 0,6·NF1 + 0,4·NF2, ≥7 → concluído.
  async validar(tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();

    let fase: 'FASE_1' | 'FASE_2';
    if (tcc.faseAtual === 'VALIDACAO_FASE_1') fase = 'FASE_1';
    else if (tcc.faseAtual === 'VALIDACAO_FASE_2') fase = 'FASE_2';
    else throw new BadRequestException({ mensagem: 'O TCC não está aguardando validação.' });

    const banca = await this.prisma.banca.findUnique({
      where: { tccId_fase: { tccId, fase } },
      include: { membros: true },
    });
    if (!banca || banca.membros.length === 0) {
      throw new BadRequestException({ mensagem: 'Ainda faltam avaliações da banca.' });
    }
    // Só valida quando TODAS as avaliações foram aprovadas individualmente na análise.
    if (!banca.membros.every((m) => m.status === 'APROVADO')) {
      throw new BadRequestException({ mensagem: 'Aprove todas as avaliações da banca antes de validar a fase.' });
    }
    if (banca.membros.some((m) => m.nota === null)) {
      throw new BadRequestException({ mensagem: 'Ainda faltam notas na banca.' });
    }
    // Ao validar, trava as avaliações desta banca (não podem mais ser editadas).
    await this.prisma.membroBanca.updateMany({ where: { bancaId: banca.id }, data: { status: 'CONCLUIDO' } });
    const media = mediaNotas(banca.membros.map((m) => m.nota ?? 0));

    if (fase === 'FASE_1') {
      const aprovado = aprovadoFase1(media);
      if (!aprovado) {
        await this.prisma.tcc.update({
          where: { id: tccId },
          data: { nf1: media, faseAtual: 'REPROVADO_FASE_1', resultado: 'REPROVADO', fase1ValidadaEm: new Date() },
        });
        // Sem número (NF1): aluno não vê nota antes da confirmação da nota final da Fase II.
        await this.eventos.emitirParaUsuario('aluno_resultado_fase1', tcc.alunoId, 'Resultado da Fase I', `A Fase I do seu TCC "${tcc.titulo}" foi avaliada e validada pela coordenação. Resultado: reprovado.`);
        await this.notificarFaseValidada(tccId, fase, tcc.titulo, tcc.orientadorId);
        return { ok: true, fase, nf1: media, aprovado };
      }
      // Banca da Fase II NÃO é formada do zero: orientador + os 2 avaliadores da Fase I.
      // O TCC NÃO entra direto em avaliação: vai para AGENDAMENTO_DEFESA_FASE_2, e só o
      // orientador (na página do orientando) libera a avaliação → aí sim AVALIACAO_FASE_2.
      const membrosFase2 = [tcc.orientadorId, ...banca.membros.map((m) => m.avaliadorId)].filter(
        (x): x is string => !!x,
      );
      await this.prisma.$transaction([
        this.prisma.tcc.update({
          where: { id: tccId },
          data: { nf1: media, faseAtual: 'AGENDAMENTO_DEFESA_FASE_2', resultado: null, fase1ValidadaEm: new Date() },
        }),
        this.prisma.banca.create({
          data: { tccId, fase: 'FASE_2', membros: { create: membrosFase2.map((id) => ({ avaliadorId: id })) } },
        }),
      ]);
      // Sem NF1 e sem revelar resultado numérico: a nota final ainda não foi confirmada.
      await this.eventos.emitirParaUsuario('aluno_resultado_fase1', tcc.alunoId, 'Fase I validada', `A Fase I do seu TCC "${tcc.titulo}" foi validada pela coordenação. Aguarde o orientador liberar a avaliação da Fase II. A nota final ainda não foi confirmada.`);
      // Só o ORIENTADOR é avisado agora — para preparar as bancas / liberar a avaliação. Os
      // avaliadores só recebem ação/notificação depois que a avaliação for liberada.
      await this.eventos.emitirParaUsuario('orientador_agendar_defesa', tcc.orientadorId, 'Preparar as bancas (Fase II)', `O TCC "${tcc.titulo}" foi aprovado na Fase I. Prepare as bancas / libere a avaliação da Fase II na página do orientando para habilitar a avaliação da banca.`, `/professor/orientandos/${tccId}#acao-fase2`);
      await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC aprovado na Fase I', `O TCC "${tcc.titulo}" (no qual você é coorientador) foi aprovado na Fase I e aguarda a preparação das bancas da Fase II.`);
      await this.notificarFaseValidada(tccId, fase, tcc.titulo, tcc.orientadorId);
      return { ok: true, fase, nf1: media, aprovado };
    }

    if (tcc.nf1 == null) {
      throw new BadRequestException({ mensagem: 'NF1 ausente — a Fase I precisa ter sido validada antes.' });
    }
    const nf2 = media;
    // Pesos das fases configuráveis pela coordenação (calendário do semestre); default 60/40.
    const calFase: any = await this.prisma.calendario.findUnique({ where: { semestre: tcc.semestre } });
    const nf = notaFinal(tcc.nf1, nf2, calFase?.pesoFase1 ?? PESO_NF1, calFase?.pesoFase2 ?? PESO_NF2);
    const aprovado = aprovadoFinal(nf);
    // Aprovado na defesa ainda NÃO conclui: vai pra ajustes finais (aluno sobe a versão final).
    await this.prisma.tcc.update({
      where: { id: tccId },
      data: {
        nf2,
        nf,
        faseAtual: aprovado ? 'AGUARDANDO_AJUSTES_FINAIS' : 'REPROVADO_FASE_2',
        resultado: aprovado ? null : 'REPROVADO',
        fase2ValidadaEm: new Date(),
      },
    });
    // Esta validação É a confirmação da nota final da Fase II; ainda assim a notificação
    // traz só o resultado qualitativo (a nota fica visível na página do TCC, não no texto).
    await this.eventos.emitirParaUsuario('aluno_resultado_fase2', tcc.alunoId, 'Resultado da Fase II', `A Fase II do seu TCC "${tcc.titulo}" foi validada pela coordenação. ${aprovado ? 'Você foi aprovado na defesa!' : 'Resultado: reprovado.'}`);
    if (aprovado) {
      await this.eventos.emitirParaUsuario('aluno_versao_final_solicitada', tcc.alunoId, 'Envie a versão final', `Seu TCC "${tcc.titulo}" foi aprovado na banca. Agora envie a versão final corrigida para o orientador validar.`);
      await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC em ajustes finais', `O TCC "${tcc.titulo}" (no qual você é coorientador) foi aprovado na Fase II e está na etapa de ajustes finais / versão final.`);
    }
    await this.notificarFaseValidada(tccId, fase, tcc.titulo, tcc.orientadorId);
    return { ok: true, fase, nf2, nf, aprovado };
  }

  // Orientador libera a avaliação da Fase II: AGENDAMENTO_DEFESA_FASE_2 → AVALIACAO_FASE_2.
  // Só o orientador do TCC. A partir daqui os AVALIADORES (não o orientador) recebem a ação.
  async liberarDefesa(profId: string, tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    if (tcc.orientadorId !== profId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'AGENDAMENTO_DEFESA_FASE_2') {
      throw new BadRequestException({ mensagem: 'A avaliação da Fase II só pode ser liberada após a Fase I ser validada e antes de iniciar a avaliação.' });
    }
    const banca = await this.prisma.banca.findUnique({
      where: { tccId_fase: { tccId, fase: 'FASE_2' } },
      include: { membros: { include: { avaliador: { select: { id: true, papel: true } } } } },
    });
    await this.prisma.tcc.update({ where: { id: tccId }, data: { faseAtual: 'AVALIACAO_FASE_2' } });
    // Notifica os avaliadores (exceto o orientador) com link DIRETO para a avaliação.
    for (const m of banca?.membros ?? []) {
      if (m.avaliadorId === tcc.orientadorId) continue;
      const base = m.avaliador.papel === 'AVALIADOR' ? '/avaliador/bancas' : '/professor/bancas';
      await this.eventos.emitirParaUsuario('avaliador_adicionado_fase2', m.avaliadorId, 'Você está na banca da Fase II', `Você integra a banca da Fase II do TCC "${tcc.titulo}".`, `${base}/${m.id}`);
      await this.eventos.emitirParaUsuario('avaliador_fase2_liberada', m.avaliadorId, 'Avaliação da Fase II liberada', `A avaliação da Fase II do TCC "${tcc.titulo}" foi liberada — você já pode avaliar.`, `${base}/${m.id}`);
    }
    return { ok: true };
  }
}
