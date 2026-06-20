import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { EventosTccService } from '../eventos-tcc/eventos-tcc.service';
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
} from '@tcc/compartilhado';

@Injectable()
export class BancasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosTccService,
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
    for (const id of ids) {
      await this.eventos.emitirParaUsuario('avaliador_adicionado_fase1', id, 'Você foi adicionado a uma banca (Fase I)', `Você foi adicionado à banca da Fase I do TCC "${tcc.titulo}".`);
      await this.eventos.emitirParaUsuario('avaliador_fase1_liberada', id, 'Avaliação da Fase I liberada', `A avaliação da Fase I do TCC "${tcc.titulo}" está liberada na sua área de bancas.`);
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
    return membros.map((m) => ({ ...m, pesos: porSemestre.get(m.banca.tcc.semestre) ?? null }));
  }

  // Avaliador pontua os critérios da fase. finalizar=false → salva RASCUNHO (notas
  // parciais; status PENDENTE; não conta como avaliação final). finalizar=true → ENVIA
  // (exige todas as notas; status ENVIADO). Edição liberada enquanto status ∈ {PENDENTE,
  // ENVIADO}; BLOQUEADO/CONCLUIDO travam. A fase só avança para VALIDACAO quando TODOS
  // os membros estão ENVIADO+ (rascunho não dispara). Rascunho só durante AVALIACAO_*.
  async avaliar(avaliadorId: string, bancaId: string, notas: Record<string, number>, parecer?: string, finalizar = true) {
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
      return { completou, fase: membro.banca.fase, titulo: tcc.titulo, finalizar };
    });

    // Quando a fase fecha (todos avaliaram), avisa a coordenação para validar.
    if (res.completou) {
      const faseNome = res.fase === 'FASE_1' ? 'Fase I' : 'Fase II';
      const evento = res.fase === 'FASE_1' ? 'coord_validar_fase1' : 'coord_validar_fase2';
      await this.eventos.emitirParaCoordenadores(evento, `Avaliações da ${faseNome} completas`, `Todas as avaliações da ${faseNome} do TCC "${res.titulo}" foram enviadas — é preciso validar.`);
    }
    return { ok: true, status: res.finalizar ? 'ENVIADO' : 'PENDENTE' };
  }

  // Reabre a própria avaliação ENVIADO → PENDENTE (preserva notas/parecer; a nota total
  // volta a null). Se a fase já estava em VALIDACAO_* (todos enviaram), volta para
  // AVALIACAO_* para o coordenador não validar com avaliação pendente. Só enquanto a
  // avaliação não estiver BLOQUEADO/CONCLUIDO.
  async reabrir(avaliadorId: string, bancaId: string) {
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
          data: { nf1: media, faseAtual: 'REPROVADO_FASE_1', resultado: 'REPROVADO' },
        });
        await this.eventos.emitirParaUsuario('aluno_resultado_fase1', tcc.alunoId, 'Resultado da Fase I', `A Fase I do seu TCC "${tcc.titulo}" foi validada. Resultado: reprovado (NF1 ${media.toFixed(2)}).`);
        return { ok: true, fase, nf1: media, aprovado };
      }
      // Banca da Fase II NÃO é formada do zero: orientador + os 2 avaliadores da Fase I.
      const membrosFase2 = [tcc.orientadorId, ...banca.membros.map((m) => m.avaliadorId)].filter(
        (x): x is string => !!x,
      );
      await this.prisma.$transaction([
        this.prisma.tcc.update({
          where: { id: tccId },
          data: { nf1: media, faseAtual: 'AVALIACAO_FASE_2', resultado: null },
        }),
        this.prisma.banca.create({
          data: { tccId, fase: 'FASE_2', membros: { create: membrosFase2.map((id) => ({ avaliadorId: id })) } },
        }),
      ]);
      await this.eventos.emitirParaUsuario('aluno_resultado_fase1', tcc.alunoId, 'Resultado da Fase I', `A Fase I do seu TCC "${tcc.titulo}" foi validada (NF1 ${media.toFixed(2)}). Aprovado — segue para a Fase II.`);
      // Banca da Fase II = orientador + os 2 avaliadores da Fase I (já existentes).
      for (const id of membrosFase2) {
        await this.eventos.emitirParaUsuario('avaliador_adicionado_fase2', id, 'Você está na banca da Fase II', `Você integra a banca da Fase II do TCC "${tcc.titulo}".`);
        await this.eventos.emitirParaUsuario('avaliador_fase2_liberada', id, 'Avaliação da Fase II liberada', `A avaliação da Fase II do TCC "${tcc.titulo}" está liberada na sua área de bancas.`);
      }
      await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC avançou para a Fase II', `O TCC "${tcc.titulo}" (no qual você é coorientador) avançou para a Fase II.`);
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
      },
    });
    await this.eventos.emitirParaUsuario('aluno_resultado_fase2', tcc.alunoId, 'Resultado da Fase II', `A Fase II do seu TCC "${tcc.titulo}" foi validada (NF ${nf.toFixed(2)}). ${aprovado ? 'Aprovado na defesa!' : 'Resultado: reprovado.'}`);
    if (aprovado) {
      await this.eventos.emitirParaUsuario('aluno_versao_final_solicitada', tcc.alunoId, 'Envie a versão final', `Seu TCC "${tcc.titulo}" foi aprovado na banca. Agora envie a versão final corrigida para o orientador validar.`);
      await this.eventos.emitirParaUsuario('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC em ajustes finais', `O TCC "${tcc.titulo}" (no qual você é coorientador) foi aprovado na Fase II e está na etapa de ajustes finais / versão final.`);
    }
    return { ok: true, fase, nf2, nf, aprovado };
  }
}
