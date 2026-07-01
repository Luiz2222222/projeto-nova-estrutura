import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolverSemestreAtivo } from '../comum/semestre';
import {
  CAMPO_CALENDARIO_ETAPA,
  ETAPAS_PRAZO,
  ROTULO_ETAPA_PRAZO,
  type EtapaPrazo,
} from '@tcc/compartilhado';

// Escopo de uma liberação/consulta: por TCC (etapas com TCC) ou por aluno+semestre
// (ENVIO_DOCUMENTOS, que pode ocorrer antes de o TCC existir).
export interface EscopoPrazo {
  etapa: EtapaPrazo;
  semestre: string;
  tccId?: string | null;
  alunoId?: string | null;
}

@Injectable()
export class PrazosService {
  constructor(private readonly prisma: PrismaService) {}

  // Prazo encerrado = existe a data e ela JÁ passou. Comparação inclusiva: o próprio
  // dia do prazo ainda vale (hoje === prazo → dentro). Sem data → nunca encerra.
  private prazoEncerrado(prazo?: Date | null): boolean {
    if (!prazo) return false;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dia = new Date(prazo.getUTCFullYear(), prazo.getUTCMonth(), prazo.getUTCDate());
    return hoje > dia;
  }

  private async dataMarco(semestre: string, etapa: EtapaPrazo): Promise<Date | null> {
    const cal: any = await this.prisma.calendario.findUnique({ where: { semestre } });
    return cal ? (cal[CAMPO_CALENDARIO_ETAPA[etapa]] as Date | null) : null;
  }

  // Existe liberação individual ativa para esta etapa/escopo? ENVIO_DOCUMENTOS é sempre
  // por aluno+semestre; as demais, por TCC.
  async liberacaoAtiva(e: EscopoPrazo): Promise<boolean> {
    if (e.etapa === 'ENVIO_DOCUMENTOS') {
      if (!e.alunoId) return false;
      const r = await this.prisma.liberacaoPrazo.findUnique({
        where: { alunoId_semestre_etapa: { alunoId: e.alunoId, semestre: e.semestre, etapa: e.etapa } },
      });
      return !!r;
    }
    if (!e.tccId) return false;
    const r = await this.prisma.liberacaoPrazo.findUnique({
      where: { tccId_etapa: { tccId: e.tccId, etapa: e.etapa } },
    });
    return !!r;
  }

  // Regra central: a ação está bloqueada por prazo?
  // - sem data definida → não bloqueia;
  // - dentro do prazo (inclusive hoje === prazo) → não bloqueia;
  // - vencido + sem liberação individual → BLOQUEIA;
  // - vencido + com liberação individual → não bloqueia.
  async prazoBloqueado(e: EscopoPrazo): Promise<boolean> {
    const data = await this.dataMarco(e.semestre, e.etapa);
    if (!this.prazoEncerrado(data)) return false;
    return !(await this.liberacaoAtiva(e));
  }

  // Lança 403 com mensagem clara quando a etapa está bloqueada por prazo. Usar no início
  // das ações de fluxo (o backend é a fonte real da regra).
  async exigirEtapaLiberada(e: EscopoPrazo): Promise<void> {
    if (await this.prazoBloqueado(e)) {
      throw new ForbiddenException({
        mensagem: `O prazo de "${ROTULO_ETAPA_PRAZO[e.etapa]}" venceu. É preciso uma liberação individual da coordenação para continuar.`,
      });
    }
  }

  // Estado de todas as etapas restritivas de um TCC (para a tela do coordenador e para
  // desabilitar botões nas telas de aluno/orientador/avaliador).
  async estadoDoTcc(tcc: { id: string; alunoId: string; semestre: string }) {
    const cal: any = await this.prisma.calendario.findUnique({ where: { semestre: tcc.semestre } });
    const out: Record<string, { liberado: boolean; vencido: boolean; bloqueado: boolean; prazo: string | null }> = {};
    for (const etapa of ETAPAS_PRAZO) {
      const data: Date | null = cal ? cal[CAMPO_CALENDARIO_ETAPA[etapa]] : null;
      const vencido = this.prazoEncerrado(data);
      const liberado = await this.liberacaoAtiva({ etapa, semestre: tcc.semestre, tccId: tcc.id, alunoId: tcc.alunoId });
      out[etapa] = { liberado, vencido, bloqueado: vencido && !liberado, prazo: data ? data.toISOString() : null };
    }
    return out;
  }

  // Só as etapas que importam para a fase atual do TCC, como mapa simples etapa->bloqueado
  // (usado para desabilitar botões nas telas de papel).
  async bloqueiosDoTcc(tcc: { id: string; alunoId: string; semestre: string }) {
    const estado = await this.estadoDoTcc(tcc);
    const out: Record<string, boolean> = {};
    for (const etapa of ETAPAS_PRAZO) out[etapa] = estado[etapa].bloqueado;
    return out;
  }

  // Liga/desliga a liberação individual. Presença da linha = liberado.
  async alternarTcc(tcc: { id: string; alunoId: string; semestre: string }, etapa: EtapaPrazo): Promise<boolean> {
    if (etapa === 'ENVIO_DOCUMENTOS') return this.alternarAbertura(tcc.alunoId, tcc.semestre);
    const existente = await this.prisma.liberacaoPrazo.findUnique({ where: { tccId_etapa: { tccId: tcc.id, etapa } } });
    if (existente) {
      await this.prisma.liberacaoPrazo.delete({ where: { id: existente.id } });
      return false;
    }
    await this.prisma.liberacaoPrazo.create({ data: { etapa, tccId: tcc.id } });
    return true;
  }

  // Liberação de abertura (ENVIO_DOCUMENTOS) por aluno+semestre — funciona antes de existir TCC.
  async alternarAbertura(alunoId: string, semestre: string): Promise<boolean> {
    const where = { alunoId_semestre_etapa: { alunoId, semestre, etapa: 'ENVIO_DOCUMENTOS' } };
    const existente = await this.prisma.liberacaoPrazo.findUnique({ where });
    if (existente) {
      await this.prisma.liberacaoPrazo.delete({ where: { id: existente.id } });
      return false;
    }
    await this.prisma.liberacaoPrazo.create({ data: { etapa: 'ENVIO_DOCUMENTOS', alunoId, semestre } });
    return true;
  }

  // ----- Wrappers usados pelo controller (buscam o TCC e validam a etapa) -----

  private async tccBasico(tccId: string) {
    const tcc = await this.prisma.tcc.findUnique({
      where: { id: tccId },
      select: { id: true, alunoId: true, semestre: true },
    });
    if (!tcc) throw new NotFoundException();
    return tcc;
  }

  async estadoPorTccId(tccId: string) {
    return this.estadoDoTcc(await this.tccBasico(tccId));
  }

  async alternarPorTccId(tccId: string, etapa: string) {
    if (!(ETAPAS_PRAZO as readonly string[]).includes(etapa)) {
      throw new BadRequestException({ mensagem: 'Etapa de prazo inválida.' });
    }
    const liberado = await this.alternarTcc(await this.tccBasico(tccId), etapa as EtapaPrazo);
    return { etapa, liberado };
  }

  // Lista os alunos com o estado da liberação de ABERTURA (ENVIO_DOCUMENTOS) no semestre
  // atual — permite liberar antes de o TCC existir.
  async listaAlunosAbertura() {
    const semestre = await resolverSemestreAtivo(this.prisma);
    const alunos = await this.prisma.usuario.findMany({
      where: { papel: 'ALUNO' },
      select: { id: true, nomeCompleto: true, email: true, curso: true },
      orderBy: { nomeCompleto: 'asc' },
    });
    const libs = await this.prisma.liberacaoPrazo.findMany({ where: { etapa: 'ENVIO_DOCUMENTOS', semestre } });
    const liberados = new Set(libs.map((l) => l.alunoId));
    const data = await this.dataMarco(semestre, 'ENVIO_DOCUMENTOS');
    return {
      semestre,
      prazo: data ? data.toISOString() : null,
      vencido: this.prazoEncerrado(data),
      alunos: alunos.map((a) => ({ ...a, liberado: liberados.has(a.id) })),
    };
  }

  // Estado da ABERTURA (ENVIO_DOCUMENTOS) para o próprio aluno consultar no semestre atual.
  async aberturaParaAluno(alunoId: string) {
    const semestre = await resolverSemestreAtivo(this.prisma);
    const data = await this.dataMarco(semestre, 'ENVIO_DOCUMENTOS');
    const vencido = this.prazoEncerrado(data);
    const liberado = await this.liberacaoAtiva({ etapa: 'ENVIO_DOCUMENTOS', semestre, alunoId });
    return { semestre, prazo: data ? data.toISOString() : null, vencido, liberado, bloqueado: vencido && !liberado };
  }

  async alternarAberturaAluno(alunoId: string) {
    const semestre = await resolverSemestreAtivo(this.prisma);
    const aluno = await this.prisma.usuario.findUnique({ where: { id: alunoId }, select: { papel: true } });
    if (!aluno || aluno.papel !== 'ALUNO') throw new BadRequestException({ mensagem: 'Aluno inválido.' });
    const liberado = await this.alternarAbertura(alunoId, semestre);
    return { alunoId, semestre, liberado };
  }
}
