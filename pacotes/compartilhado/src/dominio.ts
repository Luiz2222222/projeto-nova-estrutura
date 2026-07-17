// Domínio do TCC — fonte ÚNICA de fases, rótulos, índices da trilha e cálculo de notas.
// Usado pela API e pela tela. Mantém back e front em sincronia (e é coberto por testes).

// Todas as fases que a API pode atribuir a um TCC.
export const FASES = [
  'INICIALIZACAO',
  'DESENVOLVIMENTO',
  'FORMACAO_BANCA_FASE_1',
  'AVALIACAO_FASE_1',
  'AGUARDANDO_ANALISE_COORDENACAO_FASE_1',
  'VALIDACAO_FASE_1',
  'AGENDAMENTO_DEFESA_FASE_2',
  'AVALIACAO_FASE_2',
  'AGUARDANDO_ANALISE_COORDENACAO_FASE_2',
  'VALIDACAO_FASE_2',
  'AGUARDANDO_AJUSTES_FINAIS',
  'VALIDACAO_VERSAO_FINAL',
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
  AGUARDANDO_ANALISE_COORDENACAO_FASE_1: 2,
  VALIDACAO_FASE_1: 2,
  AGENDAMENTO_DEFESA_FASE_2: 3,
  AVALIACAO_FASE_2: 3,
  AGUARDANDO_ANALISE_COORDENACAO_FASE_2: 3,
  VALIDACAO_FASE_2: 3,
  AGUARDANDO_AJUSTES_FINAIS: 4,
  VALIDACAO_VERSAO_FINAL: 4,
  CONCLUIDO: 4,
};

export const ROTULO_FASE: Record<string, string> = {
  INICIALIZACAO: 'Solicitação — aguardando aprovação',
  DESENVOLVIMENTO: 'Em desenvolvimento',
  FORMACAO_BANCA_FASE_1: 'Formação da banca (Fase I)',
  AVALIACAO_FASE_1: 'Avaliação — Fase I',
  AGUARDANDO_ANALISE_COORDENACAO_FASE_1: 'Aguardando análise da coordenação — Fase I',
  VALIDACAO_FASE_1: 'Validação — Fase I',
  AGENDAMENTO_DEFESA_FASE_2: 'Agendamento da defesa (Fase II)',
  AVALIACAO_FASE_2: 'Avaliação — Fase II',
  AGUARDANDO_ANALISE_COORDENACAO_FASE_2: 'Aguardando análise da coordenação — Fase II',
  VALIDACAO_FASE_2: 'Validação — Fase II',
  AGUARDANDO_AJUSTES_FINAIS: 'Ajustes finais — versão final',
  VALIDACAO_VERSAO_FINAL: 'Versão final — validação do orientador',
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

// Pesos PADRÃO da nota final (usados quando o calendário do semestre não define outros).
export const PESO_NF1 = 0.6;
export const PESO_NF2 = 0.4;

// Nota final ponderada: NF = pesoNf1·NF1 + pesoNf2·NF2. Os pesos podem vir do calendário do
// semestre (configuráveis pela coordenação); se não informados, usa os defaults 60/40.
export function notaFinal(nf1: number, nf2: number, pesoNf1: number = PESO_NF1, pesoNf2: number = PESO_NF2): number {
  return pesoNf1 * nf1 + pesoNf2 * nf2;
}

export const aprovadoFase1 = (nf1: number): boolean => nf1 >= 6;
export const aprovadoFinal = (nf: number): boolean => nf >= 7;

// ---------- Critérios de avaliação (pesos por critério, somando 10) ----------
// Cada critério é pontuado de 0 até o seu peso; a nota do avaliador = soma dos 5 critérios
// (0–10). O NF da fase = média das notas dos avaliadores. Pesos definidos no Planejamento.

export interface Criterio {
  chave: string; // sufixo das colunas: 'resumo' → pesoResumo (Calendario) e notaResumo (MembroBanca)
  rotulo: string;
  descricao: string;
  pesoPadrao: number;
}

export const CRITERIOS_FASE1: Criterio[] = [
  { chave: 'resumo', rotulo: 'Resumo', descricao: 'Apresentação concisa dos pontos relevantes do trabalho.', pesoPadrao: 1.0 },
  { chave: 'introducao', rotulo: 'Introdução/Relevância', descricao: 'Contextualização, justificativa, objetivos e estrutura do TCC.', pesoPadrao: 2.0 },
  { chave: 'revisao', rotulo: 'Revisão Bibliográfica', descricao: 'Fontes relacionadas ao tema, sintetizadas de forma lógica.', pesoPadrao: 2.0 },
  { chave: 'desenvolvimento', rotulo: 'Desenvolvimento', descricao: 'Apresentação lógica e coesa, com aprofundamento condizente com os objetivos.', pesoPadrao: 3.5 },
  { chave: 'conclusoes', rotulo: 'Conclusões', descricao: 'Implicações, limitações, contribuições e sugestões para continuidade.', pesoPadrao: 1.5 },
];

export const CRITERIOS_FASE2: Criterio[] = [
  { chave: 'coerencia', rotulo: 'Coerência do conteúdo', descricao: 'Coerência e consistência do conteúdo apresentado.', pesoPadrao: 2.0 },
  { chave: 'qualidade', rotulo: 'Qualidade e estrutura da apresentação', descricao: 'Organização e qualidade da apresentação.', pesoPadrao: 2.0 },
  { chave: 'dominio', rotulo: 'Domínio do tema', descricao: 'Domínio e conhecimento demonstrado sobre o tema.', pesoPadrao: 2.5 },
  { chave: 'clareza', rotulo: 'Clareza e fluência verbal', descricao: 'Clareza, fluência e comunicação durante a apresentação.', pesoPadrao: 2.5 },
  { chave: 'observancia', rotulo: 'Observância do tempo', descricao: 'Cumprimento do tempo previsto para a apresentação.', pesoPadrao: 1.0 },
];

// Nome das colunas (Calendario.pesoX / MembroBanca.notaX) a partir da chave do critério.
export const colunaPeso = (chave: string): string => 'peso' + chave.charAt(0).toUpperCase() + chave.slice(1);
export const colunaNota = (chave: string): string => 'nota' + chave.charAt(0).toUpperCase() + chave.slice(1);

export const PESOS_PADRAO_FASE1: Record<string, number> = Object.fromEntries(CRITERIOS_FASE1.map((c) => [c.chave, c.pesoPadrao]));
export const PESOS_PADRAO_FASE2: Record<string, number> = Object.fromEntries(CRITERIOS_FASE2.map((c) => [c.chave, c.pesoPadrao]));

export function soma(valores: number[]): number {
  return valores.reduce((s, n) => s + n, 0);
}

// Cada conjunto de pesos (Fase I e Fase II) deve somar 10 (tolerância para ponto flutuante).
export function pesosSomam10(valores: number[]): boolean {
  return Math.abs(soma(valores) - 10) < 0.01;
}
