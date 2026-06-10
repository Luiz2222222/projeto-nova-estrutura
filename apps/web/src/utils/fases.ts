// Mapeia a fase do TCC para o índice da trilha macro (Início, Desenvolvimento, Fase I, Fase II, Concluído).
// Índices na trilha: 0=Solicitação, 1=Desenvolvimento, 2=Fase I, 3=Fase II, 4=Concluído
const MAPA: Record<string, number> = {
  INICIALIZACAO: 0, // "Solicitação" (aguardando aprovação)
  DESENVOLVIMENTO: 1,
  FORMACAO_BANCA_FASE_1: 2,
  AVALIACAO_FASE_1: 2,
  VALIDACAO_FASE_1: 2,
  FORMACAO_BANCA_FASE_2: 3,
  AGENDAMENTO_APRESENTACAO: 3,
  APRESENTACAO_FASE_2: 3,
  ANALISE_FINAL_COORDENADOR: 4,
  AGUARDANDO_AJUSTES_FINAIS: 4,
  CONCLUIDO: 4,
};

export const faseParaIndice = (fase: string): number | null =>
  fase in MAPA ? MAPA[fase] : null;

export const ROTULO_FASE: Record<string, string> = {
  INICIALIZACAO: 'Solicitação — aguardando aprovação',
  DESENVOLVIMENTO: 'Em desenvolvimento',
  FORMACAO_BANCA_FASE_1: 'Formação da banca (Fase I)',
  AVALIACAO_FASE_1: 'Avaliação — Fase I',
  VALIDACAO_FASE_1: 'Validação — Fase I',
  FORMACAO_BANCA_FASE_2: 'Formação da banca (Fase II)',
  AGENDAMENTO_APRESENTACAO: 'Agendamento da defesa',
  APRESENTACAO_FASE_2: 'Apresentação — Fase II',
  ANALISE_FINAL_COORDENADOR: 'Análise final',
  AGUARDANDO_AJUSTES_FINAIS: 'Ajustes finais',
  CONCLUIDO: 'Concluído',
  DESCONTINUADO: 'Descontinuado',
  REPROVADO_FASE_1: 'Reprovado (Fase I)',
  REPROVADO_FASE_2: 'Reprovado (Fase II)',
};

export const ROTULO_STATUS_SOLIC: Record<string, string> = {
  PENDENTE: 'Aguardando aprovação do coordenador',
  ACEITA: 'Abertura aprovada',
  RECUSADA: 'Abertura recusada',
  CANCELADA: 'Cancelada',
};

export const ROTULO_TIPO_DOC: Record<string, string> = {
  PLANO_DESENVOLVIMENTO: 'Plano de Desenvolvimento',
  TERMO_ACEITE: 'Termo de Aceite',
  MONOGRAFIA: 'Monografia',
  VERSAO_FINAL: 'Versão final',
};
