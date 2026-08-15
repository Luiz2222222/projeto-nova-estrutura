// Regras de visibilidade do histórico de períodos ENCERRADOS, num lugar só.
//
// O registro arquivado é servido por dois caminhos (a lista unificada em
// HistoricoTccsService e as rotas próprias em HistoricoArquivadoService). Se cada um
// aplicasse a sua regra, bastaria pedir pelo caminho mais frouxo para furar o outro — por
// isso a decisão mora aqui e os dois importam daqui.
//
// A CONDIÇÃO de liberação de notas é a MESMA do histórico vivo (`sanitizar-notas.ts`); o que
// muda é só o formato do dado (snapshot em JSON x registro do Prisma).
import { FASES_NOTAS_LIBERADAS } from './sanitizar-notas';

// Documento gerado pela banca: material interno da coordenação, como no histórico vivo
// (que já filtra `tipo != AVALIACAO_BANCA` para o professor).
export const TIPO_AVALIACAO_BANCA = 'AVALIACAO_BANCA';

export function podeVerDocumentoArquivado(tipo: string | null | undefined, papel: string): boolean {
  return papel === 'COORDENADOR' || tipo !== TIPO_AVALIACAO_BANCA;
}

// DUPLO-CEGO: quem participou SÓ como avaliador da Fase I de um TCC reprovado nela nunca
// chegou à defesa pública e não pode descobrir de quem era o trabalho no período seguinte.
//
// Decide pelos participantes gravados no arquivamento: um professor que também tenha sido
// orientador ou coorientador fica registrado com esse papel (que tem precedência sobre
// BANCA), então "todos os papéis deste usuário são BANCA" é exatamente o caso cego.
export function ehCegoNoArquivado(
  faseFinal: string | null | undefined,
  participantes: { usuarioId: string; papel: string }[] | null | undefined,
  usuarioId: string,
): boolean {
  if (faseFinal !== 'REPROVADO_FASE_1') return false;
  const meus = (participantes ?? []).filter((p) => p.usuarioId === usuarioId).map((p) => p.papel);
  return meus.length > 0 && meus.every((p) => p === 'BANCA');
}

// Campos de identificação que somem para quem está cego. Mesma lista do histórico vivo.
export const CAMPOS_IDENTIDADE_ARQUIVADO = [
  'alunoNome',
  'alunoEmail',
  'alunoCurso',
  'orientadorNome',
  'coorientadorNome',
] as const;

// Mesma condição de `sanitizarNotasTcc`: nota final confirmada OU fase terminal (resultado
// definitivo). O registro arquivado guarda a fase em `faseFinal`.
export function notasLiberadasNoArquivado(registro: { nf?: number | null; faseFinal?: string | null }): boolean {
  return registro.nf != null || FASES_NOTAS_LIBERADAS.includes(registro.faseFinal ?? '');
}

// Zera as notas/pareceres DENTRO do snapshot (formato `dados.json`), espelhando o que
// `limparMembro` faz no registro do Prisma: nota total, todas as notas por critério e o
// parecer. Não mexe em nada fora disso.
export function sanitizarNotasSnapshot(snap: any): any {
  if (!snap || typeof snap !== 'object') return snap;
  const out: any = { ...snap };
  if (out.notas) out.notas = { ...out.notas, nf1: null, nf2: null, nf: null, resultado: null };
  if (Array.isArray(out.bancas)) {
    out.bancas = out.bancas.map((b: any) => ({
      ...b,
      membros: Array.isArray(b?.membros)
        ? b.membros.map((m: any) => ({ ...m, notasPorCriterio: {}, notaTotal: null, parecer: null }))
        : b?.membros,
    }));
  }
  return out;
}

// Tira do snapshot tudo que identifica o autor do trabalho (para o avaliador cego).
export function anonimizarSnapshot(snap: any): any {
  if (!snap || typeof snap !== 'object') return snap;
  const { aluno: _a, orientador: _o, coorientador: _c, documentos: _d, ...resto } = snap;
  return resto;
}
