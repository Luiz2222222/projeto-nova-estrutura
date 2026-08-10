import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizarNotasTcc, ocultarRascunho } from '../comum/sanitizar-notas';
import { resolverSemestreAtivo } from '../comum/semestre';
import { PESO_NF1, PESO_NF2 } from '@tcc/compartilhado';

// Histórico de períodos ANTERIORES + ocultação individual — extraído do TccsService por
// coesão: aqui vivem só consultas de leitura (histórico do professor/coordenador) e a
// preferência HistoricoTccOculto. O fluxo do TCC segue no TccsService; nada de regra,
// sanitização ou duplo-cego mudou nesta extração.
@Injectable()
export class HistoricoTccsService {
  constructor(private readonly prisma: PrismaService) {}

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

  // TCCs que o PRÓPRIO usuário ocultou do histórico, para a tela listar e permitir reexibir
  // (sem isso a ocultação seria um beco sem saída visível). Só dados de identificação — as
  // notas/detalhes continuam vindo das rotas normais de histórico depois de reexibir.
  async listarOcultosDoHistorico(usuario: { sub: string }) {
    const ocultos = await this.prisma.historicoTccOculto.findMany({
      where: { usuarioId: usuario.sub },
      orderBy: { criadoEm: 'desc' },
    });
    if (ocultos.length === 0) return [];
    const tccs = await this.prisma.tcc.findMany({
      where: { id: { in: ocultos.map((o) => o.tccId) } },
      select: { id: true, titulo: true, semestre: true, faseAtual: true, aluno: { select: { nomeCompleto: true } } },
      orderBy: [{ semestre: 'desc' }, { criadoEm: 'desc' }],
    });
    return tccs;
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
}
