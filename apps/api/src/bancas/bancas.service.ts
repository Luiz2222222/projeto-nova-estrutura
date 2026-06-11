import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mediaNotas, notaFinal, aprovadoFase1, aprovadoFinal } from '@tcc/compartilhado';

@Injectable()
export class BancasService {
  constructor(private readonly prisma: PrismaService) {}

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

  // Coordenador forma a banca (Fase I = 2 avaliadores; Fase II = 3). A fase é inferida do TCC.
  async formarBanca(tccId: string, avaliadorIds: string[]) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();

    let fase: 'FASE_1' | 'FASE_2';
    let qtd: number;
    let proxima: string;
    if (tcc.faseAtual === 'FORMACAO_BANCA_FASE_1') {
      fase = 'FASE_1';
      qtd = 2;
      proxima = 'AVALIACAO_FASE_1';
    } else if (tcc.faseAtual === 'FORMACAO_BANCA_FASE_2') {
      fase = 'FASE_2';
      qtd = 3;
      proxima = 'AVALIACAO_FASE_2';
    } else {
      throw new BadRequestException({ mensagem: 'O TCC não está aguardando formação de banca.' });
    }

    const ids = [...new Set(avaliadorIds)];
    if (ids.length !== qtd) {
      const rotulo = fase === 'FASE_1' ? 'Fase I' : 'Fase II';
      throw new BadRequestException({ mensagem: `A banca da ${rotulo} deve ter exatamente ${qtd} avaliadores distintos.` });
    }
    const proibidos = [tcc.alunoId, tcc.orientadorId, tcc.coorientadorId].filter((x): x is string => !!x);
    if (ids.some((id) => proibidos.includes(id))) {
      throw new BadRequestException({ mensagem: 'Aluno, orientador e coorientador não podem ser avaliadores.' });
    }
    const validos = await this.prisma.usuario.count({
      where: { id: { in: ids }, papel: { in: ['PROFESSOR', 'AVALIADOR'] } },
    });
    if (validos !== qtd) throw new BadRequestException({ mensagem: 'Avaliador inválido.' });

    await this.prisma.$transaction([
      this.prisma.banca.create({
        data: { tccId, fase, membros: { create: ids.map((id) => ({ avaliadorId: id })) } },
      }),
      this.prisma.tcc.update({ where: { id: tccId }, data: { faseAtual: proxima } }),
    ]);
    return { ok: true };
  }

  // Bancas em que o usuário é avaliador (com o TCC e a própria nota).
  minhasBancas(avaliadorId: string) {
    return this.prisma.membroBanca.findMany({
      where: { avaliadorId },
      include: {
        banca: {
          include: {
            tcc: { include: { aluno: { select: { nomeCompleto: true } }, documentos: true } },
          },
        },
      },
      orderBy: { banca: { criadoEm: 'desc' } },
    });
  }

  // Avaliador dá a sua nota. Quando todos avaliarem → AVALIACAO_FASE_1 → VALIDACAO_FASE_1.
  async avaliar(avaliadorId: string, bancaId: string, nota: number, parecer?: string) {
    // Tudo numa transação: lê o membro, valida e grava sem janela de corrida entre
    // duas requisições simultâneas do mesmo avaliador.
    return this.prisma.$transaction(async (tx) => {
      const membro = await tx.membroBanca.findFirst({
        where: { bancaId, avaliadorId },
        include: { banca: { include: { tcc: true } } },
      });
      if (!membro) throw new ForbiddenException();
      if (membro.nota !== null) {
        throw new BadRequestException({ mensagem: 'Você já avaliou este TCC.' });
      }
      const tcc = membro.banca.tcc;
      const faseEsperada = membro.banca.fase === 'FASE_1' ? 'AVALIACAO_FASE_1' : 'AVALIACAO_FASE_2';
      if (tcc.faseAtual !== faseEsperada) {
        throw new BadRequestException({ mensagem: 'Esta banca não está em fase de avaliação.' });
      }
      // Update CONDICIONAL (só se a nota ainda for null) + checagem de 1 linha: barra a corrida
      // mesmo em bancos com isolamento mais frouxo (ex.: Postgres em produção).
      const atualizado = await tx.membroBanca.updateMany({
        where: { id: membro.id, nota: null },
        data: { nota, parecer: parecer ?? null, avaliadoEm: new Date() },
      });
      if (atualizado.count !== 1) {
        throw new BadRequestException({ mensagem: 'Você já avaliou este TCC.' });
      }
      const membros = await tx.membroBanca.findMany({ where: { bancaId } });
      if (membros.every((m) => m.nota !== null)) {
        const proxima = membro.banca.fase === 'FASE_1' ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2';
        await tx.tcc.update({ where: { id: tcc.id }, data: { faseAtual: proxima } });
      }
      return { ok: true };
    });
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
    const media = mediaNotas(banca.membros.map((m) => m.nota ?? 0));

    if (fase === 'FASE_1') {
      const aprovado = aprovadoFase1(media);
      await this.prisma.tcc.update({
        where: { id: tccId },
        data: {
          nf1: media,
          faseAtual: aprovado ? 'FORMACAO_BANCA_FASE_2' : 'REPROVADO_FASE_1',
          resultado: aprovado ? null : 'REPROVADO',
        },
      });
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
    return { ok: true, fase, nf2, nf, aprovado };
  }
}
