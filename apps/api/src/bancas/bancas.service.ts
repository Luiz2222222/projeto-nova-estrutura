import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventosTccService } from '../eventos-tcc/eventos-tcc.service';
import { PrazosService } from '../prazos/prazos.service';
import { corrigirNomeArquivo } from '../comum/nome-arquivo';
import {
  mediaNotas,
  notaFinal,
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
        return { ...m, pesos: porSemestre.get(m.banca.tcc.semestre) ?? null, bloqueado };
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
      const faseValid = ehF1 ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2';
      const emAvaliacao = tcc.faseAtual === faseAval;
      const emValidacao = tcc.faseAtual === faseValid;
      if (!emAvaliacao && !emValidacao) {
        throw new BadRequestException({ mensagem: 'Esta banca não está em fase de avaliação.' });
      }
      if (!finalizar && !emAvaliacao) {
        throw new BadRequestException({ mensagem: 'A avaliação já foi enviada por todos; não é possível voltar para rascunho.' });
      }

      // Pesos: do Calendário do semestre; se não houver, usa os defaults dos critérios.
      const criterios = ehF1 ? CRITERIOS_FASE1 : CRITERIOS_FASE2;
      const calendario: any = await tx.calendario.findUnique({ where: { semestre: tcc.semestre } });
      const data: Record<string, number | string | Date | null> = {};
      const valores: number[] = [];
      let faltam = false;
      for (const c of criterios) {
        const peso = calendario?.[colunaPeso(c.chave)] ?? c.pesoPadrao;
        const bruto = notas?.[c.chave];
        if (bruto === undefined || bruto === null || Number.isNaN(Number(bruto))) {
          data[colunaNota(c.chave)] = null; // ausente: ok no rascunho; erro no envio (abaixo)
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
      data.parecer = parecer ?? null;

      if (finalizar) {
        if (faltam) throw new BadRequestException({ mensagem: 'Para enviar, preencha todas as notas dos critérios.' });
        data.nota = soma(valores); // total do membro (0–10)
        data.status = 'ENVIADO';
        data.avaliadoEm = new Date();
      } else {
        data.nota = null; // rascunho NÃO conta como avaliação final
        data.status = 'PENDENTE';
        data.avaliadoEm = null;
      }

      // Update CONDICIONAL: só se ainda editável (barra corrida e edição de travada).
      const atualizado = await tx.membroBanca.updateMany({
        where: { id: membro.id, status: { notIn: ['BLOQUEADO', 'CONCLUIDO'] } },
        data,
      });
      if (atualizado.count !== 1) {
        throw new BadRequestException({ mensagem: 'Não foi possível salvar — a avaliação foi bloqueada.' });
      }

      // A fase só avança quando TODOS enviaram (ENVIADO ou superior). Rascunho não conta.
      let completou = false;
      if (finalizar && emAvaliacao) {
        const membros = await tx.membroBanca.findMany({ where: { bancaId } });
        if (membros.every((mm) => ['ENVIADO', 'BLOQUEADO', 'CONCLUIDO'].includes(mm.status))) {
          await tx.tcc.update({ where: { id: tcc.id }, data: { faseAtual: faseValid } });
          completou = true;
        }
      }
      return { completou, fase: membro.banca.fase, titulo: tcc.titulo, finalizar, tccId: tcc.id };
    });

    // Quando a fase fecha (todos avaliaram), avisa a coordenação para validar (link direto).
    if (res.completou) {
      const faseNome = res.fase === 'FASE_1' ? 'Fase I' : 'Fase II';
      const evento = res.fase === 'FASE_1' ? 'coord_validar_fase1' : 'coord_validar_fase2';
      await this.eventos.emitirParaCoordenadores(evento, `Avaliações da ${faseNome} completas`, `Todas as avaliações da ${faseNome} do TCC "${res.titulo}" foram enviadas — é preciso validar.`, `/coordenador/tccs/${res.tccId}#validacao`);
    }
    return { ok: true, status: res.finalizar ? 'ENVIADO' : 'PENDENTE' };
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
      const faseValid = ehF1 ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2';
      if (tcc.faseAtual !== faseAval && tcc.faseAtual !== faseValid) {
        throw new BadRequestException({ mensagem: 'Esta fase não está mais aberta para edição.' });
      }
      const atualizado = await tx.membroBanca.updateMany({
        where: { id: membro.id, status: 'ENVIADO' },
        data: { status: 'PENDENTE', nota: null, avaliadoEm: null },
      });
      if (atualizado.count !== 1) throw new BadRequestException({ mensagem: 'Não foi possível reabrir a avaliação.' });
      // Banca estava completa (em validação) → volta para avaliação.
      if (tcc.faseAtual === faseValid) {
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
    const faseValid = ehF1 ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2';
    if (tcc.faseAtual !== faseAval && tcc.faseAtual !== faseValid) return;
    const membros = await tx.membroBanca.findMany({ where: { bancaId: banca.id } });
    if (membros.length === 0) return;
    const todosEnviaram = membros.every((m) => ['ENVIADO', 'BLOQUEADO', 'CONCLUIDO'].includes(m.status));
    if (tcc.faseAtual === faseAval && todosEnviaram) {
      await tx.tcc.update({ where: { id: tcc.id }, data: { faseAtual: faseValid } });
    } else if (tcc.faseAtual === faseValid && !todosEnviaram) {
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
      // Só permite editar enquanto a fase NÃO foi validada/concluída — senão mexer nas
      // notas deixaria NF1/NF2/NF/resultado inconsistentes (recálculo não é feito aqui).
      const ehF1banca = membro.banca.fase === 'FASE_1';
      const fasesEditaveis = ehF1banca ? ['AVALIACAO_FASE_1', 'VALIDACAO_FASE_1'] : ['AVALIACAO_FASE_2', 'VALIDACAO_FASE_2'];
      if (!fasesEditaveis.includes(tcc.faseAtual)) {
        throw new BadRequestException({
          mensagem: ehF1banca
            ? 'A Fase I já foi validada — editar a avaliação exigiria recalcular NF1/NF2/NF. Edição administrativa bloqueada.'
            : 'A Fase II já foi validada — editar a avaliação exigiria recalcular NF2/NF e o resultado. Edição administrativa bloqueada.',
        });
      }
      const criterios = membro.banca.fase === 'FASE_1' ? CRITERIOS_FASE1 : CRITERIOS_FASE2;
      const calendario: any = await tx.calendario.findUnique({ where: { semestre: tcc.semestre } });
      const exigeCompleto = status === 'ENVIADO' || status === 'BLOQUEADO' || status === 'CONCLUIDO';

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

      await tx.membroBanca.update({ where: { id: membroId }, data });
      await this.ajustarFasePorBanca(tx, membro.banca, { id: tcc.id, faseAtual: tcc.faseAtual });
    });
    return { ok: true };
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
      if (!['FORMACAO_BANCA_FASE_1', 'AVALIACAO_FASE_1', 'VALIDACAO_FASE_1'].includes(tcc.faseAtual)) {
        throw new BadRequestException({
          mensagem: 'A Fase I já foi validada — não é possível trocar os avaliadores depois que a NF1 foi calculada.',
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
    if (!banca || banca.membros.length === 0 || banca.membros.some((m) => m.nota === null)) {
      throw new BadRequestException({ mensagem: 'Ainda faltam avaliações da banca.' });
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
        return { ok: true, fase, nf1: media, aprovado };
      }
      // Banca da Fase II NÃO é formada do zero: orientador + os 2 avaliadores da Fase I.
      // O TCC NÃO entra direto em avaliação: vai para AGENDAMENTO_DEFESA_FASE_2, e só o
      // orientador (na página do orientando) libera a defesa → aí sim AVALIACAO_FASE_2.
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
      await this.eventos.emitirParaUsuario('aluno_resultado_fase1', tcc.alunoId, 'Fase I validada', `A Fase I do seu TCC "${tcc.titulo}" foi validada pela coordenação. Aguarde o orientador agendar a defesa da Fase II. A nota final ainda não foi confirmada.`);
      // Só o ORIENTADOR é avisado agora — para agendar/liberar a defesa. Os avaliadores
      // só recebem ação/notificação depois que a defesa for liberada.
      await this.eventos.emitirParaUsuario('orientador_agendar_defesa', tcc.orientadorId, 'Agendar a defesa (Fase II)', `O TCC "${tcc.titulo}" foi aprovado na Fase I. Agende/libere a defesa da Fase II na página do orientando para liberar a avaliação da banca.`, `/professor/orientandos/${tccId}#acao-fase2`);
      await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC aprovado na Fase I', `O TCC "${tcc.titulo}" (no qual você é coorientador) foi aprovado na Fase I e aguarda o agendamento da defesa.`);
      return { ok: true, fase, nf1: media, aprovado };
    }

    if (tcc.nf1 == null) {
      throw new BadRequestException({ mensagem: 'NF1 ausente — a Fase I precisa ter sido validada antes.' });
    }
    const nf2 = media;
    const nf = notaFinal(tcc.nf1, nf2);
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
    return { ok: true, fase, nf2, nf, aprovado };
  }

  // Orientador agenda/libera a defesa da Fase II: AGENDAMENTO_DEFESA_FASE_2 → AVALIACAO_FASE_2.
  // Só o orientador do TCC. A partir daqui os AVALIADORES (não o orientador) recebem a ação.
  async liberarDefesa(profId: string, tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    if (tcc.orientadorId !== profId) throw new ForbiddenException();
    if (tcc.faseAtual !== 'AGENDAMENTO_DEFESA_FASE_2') {
      throw new BadRequestException({ mensagem: 'A defesa só pode ser liberada após a Fase I ser validada e antes de iniciar a avaliação.' });
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
      await this.eventos.emitirParaUsuario('avaliador_fase2_liberada', m.avaliadorId, 'Avaliação da Fase II liberada', `A defesa do TCC "${tcc.titulo}" foi liberada — você já pode avaliar a Fase II.`, `${base}/${m.id}`);
    }
    return { ok: true };
  }
}
