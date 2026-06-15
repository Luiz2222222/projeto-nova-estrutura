import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
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
    private readonly email: EmailService,
  ) {}

  // Notificações por e-mail (helpers; nunca quebram o fluxo).
  private async notificar(evento: string, usuarioId: string | null | undefined, assunto: string, texto: string) {
    if (!usuarioId) return;
    const p = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, email: true, nomeCompleto: true } });
    if (p) await this.email.enviarEvento(evento, p, assunto, texto);
  }

  private async notificarCoordenadores(evento: string, assunto: string, texto: string) {
    const coords = await this.prisma.usuario.findMany({ where: { papel: 'COORDENADOR' }, select: { id: true, email: true, nomeCompleto: true } });
    for (const c of coords) await this.email.enviarEvento(evento, c, assunto, texto);
  }

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

  // Coordenador forma a banca da Fase I (2 avaliadores). A da Fase II é montada
  // automaticamente ao validar a Fase I (orientador + os 2 avaliadores da Fase I).
  async formarBanca(tccId: string, avaliadorIds: string[]) {
    const tcc = await this.prisma.tcc.findUnique({ where: { id: tccId } });
    if (!tcc) throw new NotFoundException();

    if (tcc.faseAtual !== 'FORMACAO_BANCA_FASE_1') {
      throw new BadRequestException({ mensagem: 'O TCC não está aguardando formação da banca da Fase I.' });
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

    await this.prisma.$transaction([
      this.prisma.banca.create({
        data: { tccId, fase, membros: { create: ids.map((id) => ({ avaliadorId: id })) } },
      }),
      this.prisma.tcc.update({ where: { id: tccId }, data: { faseAtual: proxima } }),
    ]);
    await this.notificar('aluno_banca_fase1_formada', tcc.alunoId, 'Banca da Fase I formada', `A banca da Fase I do seu TCC "${tcc.titulo}" foi formada.`);
    for (const id of ids) {
      await this.notificar('avaliador_adicionado_fase1', id, 'Você foi adicionado a uma banca (Fase I)', `Você foi adicionado à banca da Fase I do TCC "${tcc.titulo}".`);
      await this.notificar('avaliador_fase1_liberada', id, 'Avaliação da Fase I liberada', `A avaliação da Fase I do TCC "${tcc.titulo}" está liberada na sua área de bancas.`);
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

  // Avaliador pontua os 5 critérios da fase (cada nota capada no peso do critério).
  // A nota total do membro = soma dos critérios. Quando todos avaliarem → VALIDACAO.
  async avaliar(avaliadorId: string, bancaId: string, notas: Record<string, number>, parecer?: string) {
    // Tudo numa transação: lê o membro, valida e grava sem janela de corrida entre
    // duas requisições simultâneas do mesmo avaliador.
    const res = await this.prisma.$transaction(async (tx) => {
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

      // Pesos: do Calendário do semestre; se não houver, usa os defaults dos critérios.
      const criterios = membro.banca.fase === 'FASE_1' ? CRITERIOS_FASE1 : CRITERIOS_FASE2;
      const calendario: any = await tx.calendario.findUnique({ where: { semestre: tcc.semestre } });
      const data: Record<string, number | string | Date | null> = {};
      const valores: number[] = [];
      for (const c of criterios) {
        const peso = calendario?.[colunaPeso(c.chave)] ?? c.pesoPadrao;
        const nota = Number(notas?.[c.chave]);
        if (!Number.isFinite(nota) || nota < 0 || nota > peso) {
          throw new BadRequestException({
            mensagem: `Nota de "${c.rotulo}" deve estar entre 0 e ${peso}.`,
          });
        }
        data[colunaNota(c.chave)] = nota;
        valores.push(nota);
      }
      data.nota = soma(valores); // total do membro (0–10)
      data.parecer = parecer ?? null;
      data.avaliadoEm = new Date();

      // Update CONDICIONAL (só se a nota ainda for null) + checagem de 1 linha: barra a corrida
      // mesmo em bancos com isolamento mais frouxo (ex.: Postgres em produção).
      const atualizado = await tx.membroBanca.updateMany({
        where: { id: membro.id, nota: null },
        data,
      });
      if (atualizado.count !== 1) {
        throw new BadRequestException({ mensagem: 'Você já avaliou este TCC.' });
      }
      const membros = await tx.membroBanca.findMany({ where: { bancaId } });
      let completou = false;
      if (membros.every((m) => m.nota !== null)) {
        const proxima = membro.banca.fase === 'FASE_1' ? 'VALIDACAO_FASE_1' : 'VALIDACAO_FASE_2';
        await tx.tcc.update({ where: { id: tcc.id }, data: { faseAtual: proxima } });
        completou = true;
      }
      return { completou, fase: membro.banca.fase, titulo: tcc.titulo };
    });

    // Quando a fase fecha (todos avaliaram), avisa a coordenação para validar.
    if (res.completou) {
      const faseNome = res.fase === 'FASE_1' ? 'Fase I' : 'Fase II';
      const evento = res.fase === 'FASE_1' ? 'coord_validar_fase1' : 'coord_validar_fase2';
      await this.notificarCoordenadores(evento, `Avaliações da ${faseNome} completas`, `Todas as avaliações da ${faseNome} do TCC "${res.titulo}" foram enviadas — é preciso validar.`);
    }
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
    const media = mediaNotas(banca.membros.map((m) => m.nota ?? 0));

    if (fase === 'FASE_1') {
      const aprovado = aprovadoFase1(media);
      if (!aprovado) {
        await this.prisma.tcc.update({
          where: { id: tccId },
          data: { nf1: media, faseAtual: 'REPROVADO_FASE_1', resultado: 'REPROVADO' },
        });
        await this.notificar('aluno_resultado_fase1', tcc.alunoId, 'Resultado da Fase I', `A Fase I do seu TCC "${tcc.titulo}" foi validada. Resultado: reprovado (NF1 ${media.toFixed(2)}).`);
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
      await this.notificar('aluno_resultado_fase1', tcc.alunoId, 'Resultado da Fase I', `A Fase I do seu TCC "${tcc.titulo}" foi validada (NF1 ${media.toFixed(2)}). Aprovado — segue para a Fase II.`);
      // Banca da Fase II = orientador + os 2 avaliadores da Fase I (já existentes).
      for (const id of membrosFase2) {
        await this.notificar('avaliador_adicionado_fase2', id, 'Você está na banca da Fase II', `Você integra a banca da Fase II do TCC "${tcc.titulo}".`);
        await this.notificar('avaliador_fase2_liberada', id, 'Avaliação da Fase II liberada', `A avaliação da Fase II do TCC "${tcc.titulo}" está liberada na sua área de bancas.`);
      }
      await this.notificar('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC avançou para a Fase II', `O TCC "${tcc.titulo}" (no qual você é coorientador) avançou para a Fase II.`);
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
    await this.notificar('aluno_resultado_fase2', tcc.alunoId, 'Resultado da Fase II', `A Fase II do seu TCC "${tcc.titulo}" foi validada (NF ${nf.toFixed(2)}). ${aprovado ? 'Aprovado na defesa!' : 'Resultado: reprovado.'}`);
    if (aprovado) {
      await this.notificar('aluno_versao_final_solicitada', tcc.alunoId, 'Envie a versão final', `Seu TCC "${tcc.titulo}" foi aprovado na banca. Agora envie a versão final corrigida para o orientador validar.`);
      await this.notificar('coorientador_mudanca_fase', tcc.coorientadorId, 'TCC em ajustes finais', `O TCC "${tcc.titulo}" (no qual você é coorientador) foi aprovado na Fase II e está na etapa de ajustes finais / versão final.`);
    }
    return { ok: true, fase, nf2, nf, aprovado };
  }
}
