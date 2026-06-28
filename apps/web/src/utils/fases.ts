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
  PLANO_DESENVOLVIMENTO: 'Plano de desenvolvimento',
  TERMO_ACEITE: 'Termo de aceite',
  MONOGRAFIA: 'Monografia',
  VERSAO_FINAL: 'Versão final',
  AVALIACAO_BANCA: 'Documento para avaliação (banca)',
};

// A versão final só entra depois da Fase II aprovada (TCC vai para AGUARDANDO_AJUSTES_FINAIS),
// segue para validação do orientador e conclusão. Antes disso ela não deve aparecer.
export const FASES_VERSAO_FINAL = ['AGUARDANDO_AJUSTES_FINAIS', 'VALIDACAO_VERSAO_FINAL', 'CONCLUIDO'];

// Mostra a versão final quando o TCC já está numa dessas fases OU já existe um doc VERSAO_FINAL.
export function mostrarVersaoFinal(faseAtual?: string | null, temDocVersaoFinal = false): boolean {
  return temDocVersaoFinal || (!!faseAtual && FASES_VERSAO_FINAL.includes(faseAtual));
}

// Chip de status paralelo (usado no Desenvolvimento: monografia + continuidade).
export type EstadoChip = 'ok' | 'pendente' | 'alerta';
export interface Chip { texto: string; estado: EstadoChip }

// Última monografia enviada (maior versão).
function ultimaMono(tcc: any): any | null {
  return [...(tcc?.documentos ?? [])]
    .filter((d: any) => d.tipo === 'MONOGRAFIA')
    .sort((a: any, b: any) => b.versao - a.versao)[0] ?? null;
}

// Estado da monografia dentro do Desenvolvimento (chip).
function chipMonografia(tcc: any): Chip {
  const mono = ultimaMono(tcc);
  if (tcc?.monografiaAprovada) return { texto: 'Monografia aprovada', estado: 'ok' };
  if (mono?.status === 'PENDENTE') return { texto: 'Monografia em análise', estado: 'pendente' };
  if (mono?.status === 'REJEITADO') return { texto: 'Ajustes na monografia', estado: 'alerta' };
  return { texto: 'Monografia pendente', estado: 'pendente' };
}

// Status/subfase do TCC para a timeline horizontal (fase + status, como no antigo).
// Mesmo texto usado no card "Fase atual" do dashboard do aluno.
// No Desenvolvimento o status é COMPOSTO: monografia e continuidade são trilhas
// paralelas; o TCC só avança quando as duas concluem (regra do backend, intocada).
export function subfaseTcc(tcc: any): string {
  const f = tcc?.faseAtual;
  const solic = tcc?.solicitacoes?.[0];
  switch (f) {
    case 'INICIALIZACAO':
      return solic?.status === 'RECUSADA' ? 'Abertura recusada'
        : solic?.status === 'PENDENTE' ? 'Aguardando aprovação do coordenador'
        : 'Aguardando aceite/aprovação';
    case 'DESENVOLVIMENTO': {
      const aprov = !!tcc?.monografiaAprovada;
      const cont = !!tcc?.continuidadeConfirmada;
      if (aprov && cont) return 'Pronto para a Fase I';
      if (aprov && !cont) return 'Aguardando confirmação de continuidade';
      if (cont && !aprov) return 'Aguardando aprovação da monografia';
      return 'Aguardando monografia e continuidade';
    }
    case 'FORMACAO_BANCA_FASE_1': return 'Formação da banca';
    case 'AVALIACAO_FASE_1': return 'Avaliação da banca';
    case 'VALIDACAO_FASE_1': return 'Validação da Fase I';
    case 'AVALIACAO_FASE_2': return 'Avaliação da banca';
    case 'VALIDACAO_FASE_2': return 'Validação da Fase II';
    case 'AGUARDANDO_AJUSTES_FINAIS': return 'Envio da versão final';
    case 'VALIDACAO_VERSAO_FINAL': return 'Versão final aguardando orientador';
    case 'CONCLUIDO': return 'Aprovado';
    case 'REPROVADO_FASE_1': return 'Reprovado na Fase I';
    case 'REPROVADO_FASE_2': return 'Reprovado na Fase II';
    case 'DESCONTINUADO': return 'Descontinuado';
    default: return '';
  }
}

// Chips de status paralelos do TCC. Hoje só o Desenvolvimento tem trilhas
// paralelas (monografia + continuidade); nas demais fases não há chips.
export function chipsTrilha(tcc: any): Chip[] {
  if (tcc?.faseAtual !== 'DESENVOLVIMENTO') return [];
  const continuidade: Chip = tcc?.continuidadeConfirmada
    ? { texto: 'Continuidade confirmada', estado: 'ok' }
    : { texto: 'Continuidade pendente', estado: 'pendente' };
  return [chipMonografia(tcc), continuidade];
}

export interface NotasTrilha { fase1?: number | null; fase2?: number | null; final?: number | null }

// Notas exibidas na timeline horizontal, respeitando a visibilidade:
//  - coordenador vê NF1/NF2 assim que existem (antes mesmo da nota final);
//  - aluno/orientador/coorientador só veem as notas DEPOIS da nota final confirmada (nf != null).
export function notasTrilhaTcc(tcc: any, ehCoordenador: boolean): NotasTrilha {
  const nf1 = tcc?.nf1 ?? null;
  const nf2 = tcc?.nf2 ?? null;
  const nf = tcc?.nf ?? null;
  if (ehCoordenador) return { fase1: nf1, fase2: nf2, final: nf };
  if (nf == null) return {}; // nota final ainda não confirmada → nada para os demais papéis
  return { fase1: nf1, fase2: nf2, final: nf };
}
