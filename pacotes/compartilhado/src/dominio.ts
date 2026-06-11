// Domínio do TCC — fonte ÚNICA de fases, rótulos, índices da trilha e cálculo de notas.
// Usado pela API e pela tela. Mantém back e front em sincronia (e é coberto por testes).

// Todas as fases que a API pode atribuir a um TCC.
export const FASES = [
  'INICIALIZACAO',
  'DESENVOLVIMENTO',
  'FORMACAO_BANCA_FASE_1',
  'AVALIACAO_FASE_1',
  'VALIDACAO_FASE_1',
  'FORMACAO_BANCA_FASE_2',
  'AVALIACAO_FASE_2',
  'VALIDACAO_FASE_2',
  'AGUARDANDO_AJUSTES_FINAIS',
  'ANALISE_FINAL_COORDENADOR',
  'CONCLUIDO',
  'DESCONTINUADO',
  'REPROVADO_FASE_1',
  'REPROVADO_FASE_2',
] as const;
export type Fase = (typeof FASES)[number];

// Estados terminais "ruins": não aparecem na trilha de progresso (viram badge de status).
export const FASES_TERMINAIS_RUINS: Fase[] = ['DESCONTINUADO', 'REPROVADO_FASE_1', 'REPROVADO_FASE_2'];

// Índice na trilha macro: 0=Solicitação · 1=Desenvolvimento · 2=Fase I · 3=Fase II · 4=Concluído.
// (Os terminais ruins ficam de fora → indiceFase devolve null e a tela mostra um selo de status.)
export const INDICE_FASE: Record<string, number> = {
  INICIALIZACAO: 0,
  DESENVOLVIMENTO: 1,
  FORMACAO_BANCA_FASE_1: 2,
  AVALIACAO_FASE_1: 2,
  VALIDACAO_FASE_1: 2,
  FORMACAO_BANCA_FASE_2: 3,
  AVALIACAO_FASE_2: 3,
  VALIDACAO_FASE_2: 3,
  AGUARDANDO_AJUSTES_FINAIS: 4,
  ANALISE_FINAL_COORDENADOR: 4,
  CONCLUIDO: 4,
};

export const ROTULO_FASE: Record<string, string> = {
  INICIALIZACAO: 'Solicitação — aguardando aprovação',
  DESENVOLVIMENTO: 'Em desenvolvimento',
  FORMACAO_BANCA_FASE_1: 'Formação da banca (Fase I)',
  AVALIACAO_FASE_1: 'Avaliação — Fase I',
  VALIDACAO_FASE_1: 'Validação — Fase I',
  FORMACAO_BANCA_FASE_2: 'Formação da banca (Fase II)',
  AVALIACAO_FASE_2: 'Avaliação — Fase II',
  VALIDACAO_FASE_2: 'Validação — Fase II',
  AGUARDANDO_AJUSTES_FINAIS: 'Ajustes finais — versão final',
  ANALISE_FINAL_COORDENADOR: 'Análise final do coordenador',
  CONCLUIDO: 'Concluído',
  DESCONTINUADO: 'Descontinuado',
  REPROVADO_FASE_1: 'Reprovado (Fase I)',
  REPROVADO_FASE_2: 'Reprovado (Fase II)',
};

export function indiceFase(fase: string): number | null {
  return fase in INDICE_FASE ? INDICE_FASE[fase] : null;
}

// ---------- Notas ----------

export function mediaNotas(notas: number[]): number {
  if (notas.length === 0) return 0;
  return notas.reduce((soma, n) => soma + n, 0) / notas.length;
}

// Nota final ponderada: NF = 0,6·NF1 + 0,4·NF2.
export function notaFinal(nf1: number, nf2: number): number {
  return 0.6 * nf1 + 0.4 * nf2;
}

export const aprovadoFase1 = (nf1: number): boolean => nf1 >= 6;
export const aprovadoFinal = (nf: number): boolean => nf >= 7;
