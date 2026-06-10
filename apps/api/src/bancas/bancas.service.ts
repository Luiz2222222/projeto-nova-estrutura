import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BancasService {
  constructor(private readonly prisma: PrismaService) {}

  // Candidatos a avaliador (professores e avaliadores externos), exceto o aluno e o orientador.
  async candidatos(tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    const excluir = [tcc.alunoId, tcc.orientadorId].filter((x): x is string => !!x);
    return this.prisma.usuario.findMany({
      where: { papel: { in: ['PROFESSOR', 'AVALIADOR'] }, id: { notIn: excluir } },
      select: { id: true, nomeCompleto: true, tratamento: true, papel: true, afiliacao: true },
      orderBy: { nomeCompleto: 'asc' },
    });
  }

  // Coordenador forma a banca da Fase I (2 avaliadores). FORMACAO_BANCA_FASE_1 → AVALIACAO_FASE_1.
  async formarBancaFase1(tccId: string, avaliadorIds: string[]) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    if (tcc.faseAtual !== 'FORMACAO_BANCA_FASE_1') {
      throw new BadRequestException({ mensagem: 'O TCC não está aguardando formação de banca (Fase I).' });
    }
    const ids = [...new Set(avaliadorIds)];
    if (ids.length !== 2) {
      throw new BadRequestException({ mensagem: 'A banca da Fase I deve ter exatamente 2 avaliadores distintos.' });
    }
    if (ids.includes(tcc.alunoId) || (tcc.orientadorId && ids.includes(tcc.orientadorId))) {
      throw new BadRequestException({ mensagem: 'O aluno e o orientador não podem ser avaliadores.' });
    }
    const validos = await this.prisma.usuario.count({
      where: { id: { in: ids }, papel: { in: ['PROFESSOR', 'AVALIADOR'] } },
    });
    if (validos !== 2) throw new BadRequestException({ mensagem: 'Avaliador inválido.' });

    await this.prisma.$transaction([
      this.prisma.banca.create({
        data: { tccId, fase: 'FASE_1', membros: { create: ids.map((id) => ({ avaliadorId: id })) } },
      }),
      this.prisma.tcc.update({ where: { id: tccId }, data: { faseAtual: 'AVALIACAO_FASE_1' } }),
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
    const membro = await this.prisma.membroBanca.findFirst({
      where: { bancaId, avaliadorId },
      include: { banca: { include: { tcc: true } } },
    });
    if (!membro) throw new ForbiddenException();
    const tcc = membro.banca.tcc;
    const faseEsperada = membro.banca.fase === 'FASE_1' ? 'AVALIACAO_FASE_1' : 'AVALIACAO_FASE_2';
    if (tcc.faseAtual !== faseEsperada) {
      throw new BadRequestException({ mensagem: 'Esta banca não está em fase de avaliação.' });
    }
    await this.prisma.membroBanca.update({
      where: { id: membro.id },
      data: { nota, parecer: parecer ?? null, avaliadoEm: new Date() },
    });
    const membros = await this.prisma.membroBanca.findMany({ where: { bancaId } });
    if (membros.every((m) => m.nota !== null)) {
      const proxima = membro.banca.fase === 'FASE_1' ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2';
      await this.prisma.tcc.update({ where: { id: tcc.id }, data: { faseAtual: proxima } });
    }
    return { ok: true };
  }

  // Coordenador valida a Fase I: NF1 = média das notas; ≥6 segue p/ Fase II, <6 reprovado.
  async validarFase1(tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();
    if (tcc.faseAtual !== 'VALIDACAO_FASE_1') {
      throw new BadRequestException({ mensagem: 'O TCC não está aguardando validação da Fase I.' });
    }
    const banca = await this.prisma.banca.findUnique({
      where: { tccId_fase: { tccId, fase: 'FASE_1' } },
      include: { membros: true },
    });
    if (!banca || banca.membros.length === 0 || banca.membros.some((m) => m.nota === null)) {
      throw new BadRequestException({ mensagem: 'Ainda faltam avaliações da banca.' });
    }
    const nf1 = banca.membros.reduce((s, m) => s + (m.nota ?? 0), 0) / banca.membros.length;
    const aprovado = nf1 >= 6;
    await this.prisma.tcc.update({
      where: { id: tccId },
      data: {
        nf1,
        faseAtual: aprovado ? 'FORMACAO_BANCA_FASE_2' : 'REPROVADO_FASE_1',
        resultado: aprovado ? null : 'REPROVADO',
      },
    });
    return { ok: true, nf1, aprovado };
  }
}
