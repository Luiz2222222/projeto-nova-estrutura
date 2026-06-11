// Fases: rótulos e índice da trilha vêm do domínio compartilhado (fonte única, com testes).
import { indiceFase } from '@tcc/compartilhado';

export { ROTULO_FASE, INDICE_FASE } from '@tcc/compartilhado';

export const faseParaIndice = indiceFase;

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
