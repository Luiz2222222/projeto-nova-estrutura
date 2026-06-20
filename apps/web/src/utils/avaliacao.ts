// Helpers da avaliação de banca (reaproveitados na tela do avaliador e na edição
// administrativa do coordenador): máscara/clamp de nota, parecer estruturado e pesos.
import { colunaNota, colunaPeso, type Criterio } from '@tcc/compartilhado';

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

export const numToStr = (v: any) => (v == null ? '' : String(v).replace('.', ','));
export const fmtNum = (n: number) => String(n).replace('.', ',');
export const fmtNota = (v: any) => (v == null ? '—' : String(Number(v)).replace('.', ','));

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

export const pesoDe = (criterio: Criterio, pesos: any) => Number(pesos?.[colunaPeso(criterio.chave)] ?? criterio.pesoPadrao);
export const notaSalva = (membro: any, criterio: Criterio) => membro?.[colunaNota(criterio.chave)];

export const STATUS_AVAL: Record<string, { rotulo: string; classe: string }> = {
  PENDENTE: { rotulo: 'Pendente', classe: 'status-atencao' },
  ENVIADO: { rotulo: 'Enviado', classe: 'status-normal' },
  BLOQUEADO: { rotulo: 'Bloqueado', classe: 'status-urgente' },
  CONCLUIDO: { rotulo: 'Concluído', classe: 'status-normal' },
};
