// Sanitização de notas do TCC para perfis NÃO coordenadores.
//
// Regra: antes da confirmação da nota final da Fase II (tcc.nf == null), apenas o
// COORDENADOR pode ver notas. Para aluno, orientador, coorientador, professor e avaliador,
// a API não deve devolver NF1, NF2, NF, resultado, nota total do membro, notas por critério
// nem o parecer da avaliação da banca.
//
// Depois da confirmação (tcc.nf != null) tudo é liberado e o objeto volta intacto.
//
// IMPORTANTE: NÃO usar isto em /bancas/minhas para a PRÓPRIA avaliação do avaliador — ele
// precisa ver/editar as próprias notas/parecer ali. Para esse endpoint, sanitize apenas o
// TCC embutido (escalares), não o registro do membro do próprio usuário.

const CAMPOS_NOTA_TCC = ['nf1', 'nf2', 'nf', 'resultado'] as const;

// Zera, num registro de membro de banca, a nota total, todas as notas por critério
// (colunas que começam com "nota") e o parecer da avaliação.
function limparMembro(m: any): any {
  if (!m || typeof m !== 'object') return m;
  const out: any = { ...m };
  for (const k of Object.keys(out)) {
    if (k === 'nota' || k.startsWith('nota')) out[k] = null;
  }
  if ('parecer' in out) out.parecer = null;
  return out;
}

// Sanitiza um TCC (com ou sem bancas/membros inclusos). Devolve o mesmo objeto quando a
// nota final já foi confirmada (nf != null) ou quando não há TCC.
export function sanitizarNotasTcc<T extends Record<string, any> | null | undefined>(tcc: T): T {
  if (!tcc || (tcc as any).nf != null) return tcc;
  const limpo: any = { ...tcc };
  for (const c of CAMPOS_NOTA_TCC) if (c in limpo) limpo[c] = null;
  if (Array.isArray(limpo.bancas)) {
    limpo.bancas = limpo.bancas.map((b: any) => ({
      ...b,
      membros: Array.isArray(b?.membros) ? b.membros.map(limparMembro) : b?.membros,
    }));
  }
  return limpo as T;
}
