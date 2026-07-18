// Fases: rótulos e índice da trilha vêm do domínio compartilhado (fonte única, com testes).
import { FASES, indiceFase } from '@tcc/compartilhado';
import type { DocumentoTcc, TccResumo } from '../tipos';

export { ROTULO_FASE, INDICE_FASE } from '@tcc/compartilhado';

export const faseParaIndice = indiceFase;

// Ordem CANÔNICA das fases para listas/cards (ex.: distribuição por etapa): a ordem do
// fluxo definida no domínio (FASES) — solicitação → desenvolvimento → Fase I → Fase II →
// versão final → concluído, com terminais ruins ao fim. Fase desconhecida vai pro final.
export function indiceCanonicoFase(fase?: string | null): number {
  const i = (FASES as readonly string[]).indexOf(fase ?? '');
  return i === -1 ? FASES.length : i;
}

// Agrupador de etapa dos DASHBOARDS (contagem/badges por lista). Parte do índice da
// trilha do domínio (indiceFase) e, ao contrário dele, coloca os terminais "ruins" no
// grupo da etapa em que o TCC parou: DESCONTINUADO→Desenvolvimento, REPROVADO_FASE_1→
// Fase I, REPROVADO_FASE_2→Fase II. Fase desconhecida → -1 (fora de todos os grupos).
// Era um switch idêntico copiado em 4 dashboards — regra única, coberta por teste.
export function bucketEtapaFase(fase?: string | null): number {
  switch (fase) {
    case 'DESCONTINUADO': return 1;
    case 'REPROVADO_FASE_1': return 2;
    case 'REPROVADO_FASE_2': return 3;
    default: return (fase ? indiceFase(fase) : null) ?? -1;
  }
}

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

// Data/hora da defesa em pt-BR no fuso oficial do curso (America/Fortaleza); o backend
// armazena em UTC. Usada nos status, cards e timeline.
export function formatarDefesa(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${data} às ${hora}`;
}

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
function ultimaMono(tcc: TccResumo | null | undefined): DocumentoTcc | null {
  return [...(tcc?.documentos ?? [])]
    .filter((d) => d.tipo === 'MONOGRAFIA')
    .sort((a, b) => b.versao - a.versao)[0] ?? null;
}

// Estado da monografia dentro do Desenvolvimento (chip).
function chipMonografia(tcc: TccResumo | null | undefined): Chip {
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
export function subfaseTcc(tcc: TccResumo | null | undefined): string {
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
    case 'AGUARDANDO_ANALISE_COORDENACAO_FASE_1': return 'Aguardando análise da coordenação';
    case 'VALIDACAO_FASE_1': return 'Validação da Fase I';
    case 'AGENDAMENTO_DEFESA_FASE_2':
      return tcc?.defesaAgendadaPara
        ? `Defesa agendada para ${formatarDefesa(tcc.defesaAgendadaPara)}`
        : 'Aguardando agendamento da defesa';
    case 'AVALIACAO_FASE_2': return 'Avaliação da banca';
    case 'AGUARDANDO_ANALISE_COORDENACAO_FASE_2': return 'Aguardando análise da coordenação';
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
export function chipsTrilha(tcc: TccResumo | null | undefined): Chip[] {
  if (tcc?.faseAtual !== 'DESENVOLVIMENTO') return [];
  const continuidade: Chip = tcc?.continuidadeConfirmada
    ? { texto: 'Continuidade confirmada', estado: 'ok' }
    : { texto: 'Continuidade pendente', estado: 'pendente' };
  return [chipMonografia(tcc), continuidade];
}

export interface NotasTrilha { fase1?: number | null; fase2?: number | null; final?: number | null }

// Notas exibidas na timeline horizontal, respeitando a visibilidade:
//  - coordenador vê NF1/NF2 assim que existem (antes mesmo da nota final);
//  - aluno/orientador/coorientador veem as notas DEPOIS da nota final confirmada (nf != null)
//    OU em reprovação terminal (mesmo critério do backend, que já libera as notas nesses casos).
export function notasTrilhaTcc(tcc: TccResumo | null | undefined, ehCoordenador: boolean): NotasTrilha {
  const nf1 = tcc?.nf1 ?? null;
  const nf2 = tcc?.nf2 ?? null;
  const nf = tcc?.nf ?? null;
  if (ehCoordenador) return { fase1: nf1, fase2: nf2, final: nf };
  const terminal = ['REPROVADO_FASE_1', 'REPROVADO_FASE_2'].includes(tcc?.faseAtual ?? '');
  if (nf == null && !terminal) return {}; // nota ainda não liberada para os demais papéis
  return { fase1: nf1, fase2: nf2, final: nf };
}
