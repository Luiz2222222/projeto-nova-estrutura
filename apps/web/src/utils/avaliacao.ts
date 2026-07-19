// Helpers da avaliação de banca (reaproveitados na tela do avaliador e na edição
// administrativa do coordenador): máscara/clamp de nota, parecer estruturado e pesos.
import { colunaNota, colunaPeso, type Criterio } from '@tcc/compartilhado';
import type { MembroBanca, PesosCalendario } from '../tipos';

export const parseBR = (v: string): number | null => {
  if (!v.trim()) return null;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// Máscara/clamp da nota: só dígitos e uma vírgula, ponto vira vírgula, até 2 casas,
// mantém estado intermediário ("1,") e mantém entre 0 e o peso do critério.
export function clampScore(raw: string, max: number, atual: string): string {
  if (raw === '') return '';
  const limpo = raw.replace(/[^\d,.]/g, '').replace(/\./g, ',');
  if ((limpo.match(/,/g) || []).length > 1) return atual;
  if (!/^\d{0,2}(,\d{0,2})?$/.test(limpo)) return atual;
  const num = parseBR(limpo);
  if (num !== null && !limpo.endsWith(',')) return String(Math.max(0, Math.min(num, max))).replace('.', ',');
  return limpo;
}

export const numToStr = (v: unknown) => (v == null ? '' : String(v).replace('.', ','));
export const fmtNum = (n: number) => String(n).replace('.', ',');
export const fmtNota = (v: unknown) => (v == null ? '—' : String(Number(v)).replace('.', ','));

const stripHeader = (t: string) => t.replace(/^===\s*.+?\s*===\s*/i, '').trim();

// Lê uma seção "=== Rótulo ===\n..." do parecer estruturado.
export function extrairSecao(parecer: string, secao: string): string {
  const re = new RegExp(`===\\s*${secao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*===\\s*([\\s\\S]*?)(?=\\n===|$)`, 'i');
  const m = (parecer || '').match(re);
  return m ? m[1].trim() : '';
}

// Monta o parecer estruturado a partir dos comentários por critério + parecer geral.
export function construirParecer(criterios: Criterio[], comentarios: Record<string, string>, parecerGeral: string): string {
  const partes: string[] = [];
  for (const c of criterios) {
    const t = stripHeader((comentarios[c.chave] ?? '').trim());
    if (t) partes.push(`=== ${c.rotulo} ===\n${t}`);
  }
  const g = stripHeader(parecerGeral.trim());
  if (g) partes.push(`=== Parecer geral ===\n${g}`);
  return partes.join('\n\n');
}

export const pesoDe = (criterio: Criterio, pesos: PesosCalendario | null | undefined) => Number(pesos?.[colunaPeso(criterio.chave)] ?? criterio.pesoPadrao);
export const notaSalva = (membro: MembroBanca | null | undefined, criterio: Criterio) => membro?.[colunaNota(criterio.chave)];

// Status em que a avaliação está efetivamente ENTREGUE/analisável. PENDENTE e
// AJUSTE_SOLICITADO nunca contam como enviada — mesmo que carreguem nota antiga
// (o ajuste solicitado preserva a nota anterior) ou nota lançada administrativamente.
export const STATUS_ENTREGUES = ['ENVIADO', 'EM_ANALISE', 'APROVADO', 'BLOQUEADO', 'CONCLUIDO'] as const;
export function avaliacaoEntregue(m: { nota?: number | null; status?: string }): boolean {
  return m.nota != null && (STATUS_ENTREGUES as readonly string[]).includes(m.status ?? '');
}

// Resumo da banca de uma fase para os cards: a média só é OFICIAL quando TODOS os
// membros reais da banca ENTREGARAM (F1 = 2, F2 = 3 — vale o tamanho real no banco).
// Antes disso a média das entregues é apenas PARCIAL/informativa: nunca vira nota com
// peso, NF nem resultado Aprovado/Reprovado.
export interface ResumoBanca {
  enviadas: number; // avaliações efetivamente entregues (nota + status entregue)
  esperadas: number; // membros reais da banca
  completa: boolean;
  media: number | null; // média das entregues (parcial quando !completa; null com 0 entregues)
}
export function resumoBanca(membros: Array<{ nota?: number | null; status?: string }>): ResumoBanca {
  const notas = membros.filter(avaliacaoEntregue).map((m) => Number(m.nota));
  const esperadas = membros.length;
  const completa = esperadas > 0 && notas.length === esperadas;
  // PREVISÃO do coordenador: a soma é dividida pelo TOTAL esperado da banca (quem ainda
  // não entregou entra como zero). Com a banca completa isso É a média normal. Nunca é
  // gravado como NF1/NF2/NF nem decide aprovação — só projeção visual.
  const media = esperadas > 0 && notas.length > 0 ? notas.reduce((s, n) => s + n, 0) / esperadas : null;
  return { enviadas: notas.length, esperadas, completa, media };
}

export const STATUS_AVAL: Record<string, { rotulo: string; classe: string }> = {
  PENDENTE: { rotulo: 'Pendente', classe: 'status-atencao' },
  ENVIADO: { rotulo: 'Enviado', classe: 'status-normal' },
  EM_ANALISE: { rotulo: 'Em análise', classe: 'status-atencao' },
  AJUSTE_SOLICITADO: { rotulo: 'Ajuste solicitado', classe: 'status-urgente' },
  APROVADO: { rotulo: 'Aprovado pela coordenação', classe: 'status-normal' },
  BLOQUEADO: { rotulo: 'Bloqueado', classe: 'status-urgente' },
  CONCLUIDO: { rotulo: 'Concluído', classe: 'status-normal' },
};
