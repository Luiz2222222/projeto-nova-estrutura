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

// A versão final só entra depois da Fase II aprovada (TCC vai para AGUARDANDO_AJUSTES_FINAIS),
// segue para validação do orientador e conclusão. Antes disso ela não deve aparecer.
export const FASES_VERSAO_FINAL = ['AGUARDANDO_AJUSTES_FINAIS', 'VALIDACAO_VERSAO_FINAL', 'CONCLUIDO'];

// Mostra a versão final quando o TCC já está numa dessas fases OU já existe um doc VERSAO_FINAL.
export function mostrarVersaoFinal(faseAtual?: string | null, temDocVersaoFinal = false): boolean {
  return temDocVersaoFinal || (!!faseAtual && FASES_VERSAO_FINAL.includes(faseAtual));
}
