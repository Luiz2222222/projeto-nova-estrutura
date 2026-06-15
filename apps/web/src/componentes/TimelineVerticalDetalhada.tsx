import { useState } from 'react';

// Timeline vertical detalhada (espelha o projeto antigo): 5 grupos numerados e
// expansíveis, cada um com seus subestados. Adaptada às regras NOVAS do fluxo:
//  - Fase II não forma banca nova (é orientador + 2 avaliadores da Fase I): só
//    Avaliação da banca + Validação da Fase II.
//  - Finalização: envio da versão final -> validação do ORIENTADOR -> concluído
//    (sem "Análise do coordenador final").

type Status = 'concluido' | 'atual' | 'futuro' | 'problema';

const GRUPOS: { num: number; label: string; subs: { i: number; label: string }[] }[] = [
  { num: 1, label: 'Orientação', subs: [
    { i: 0, label: 'Envio da solicitação' },
    { i: 1, label: 'Aceite da solicitação' },
  ] },
  { num: 2, label: 'Desenvolvimento', subs: [
    { i: 2, label: 'Envio da monografia' },
    { i: 3, label: 'Monografia aprovada' },
    { i: 4, label: 'Confirmação de continuidade' },
  ] },
  { num: 3, label: 'Fase I', subs: [
    { i: 5, label: 'Formação da banca' },
    { i: 6, label: 'Avaliação da banca' },
    { i: 7, label: 'Validação da Fase I' },
  ] },
  { num: 4, label: 'Fase II', subs: [
    { i: 8, label: 'Avaliação da banca' },
    { i: 9, label: 'Validação da Fase II' },
  ] },
  { num: 5, label: 'Finalização', subs: [
    { i: 10, label: 'Envio da versão final' },
    { i: 11, label: 'Validação do orientador' },
    { i: 12, label: 'Concluído' },
  ] },
];

// Estado atual do TCC -> índice linear do subestado + se é um estado-problema.
function estadoAtual(tcc: any): { indice: number; problema: boolean; concluido: boolean } {
  const f = tcc?.faseAtual;
  const solic = tcc?.solicitacoes?.[0];
  if (f === 'INICIALIZACAO') {
    if (solic?.status === 'RECUSADA') return { indice: 1, problema: true, concluido: false };
    return { indice: 1, problema: false, concluido: false }; // envio feito, aguardando aceite
  }
  if (f === 'DESENVOLVIMENTO') {
    if (!tcc.monografiaAprovada) return { indice: 2, problema: false, concluido: false };
    return { indice: 4, problema: false, concluido: false };
  }
  const mapa: Record<string, number> = {
    FORMACAO_BANCA_FASE_1: 5, AVALIACAO_FASE_1: 6, VALIDACAO_FASE_1: 7,
    AVALIACAO_FASE_2: 8, VALIDACAO_FASE_2: 9,
    AGUARDANDO_AJUSTES_FINAIS: 10, VALIDACAO_VERSAO_FINAL: 11,
  };
  if (f in mapa) return { indice: mapa[f], problema: false, concluido: false };
  if (f === 'CONCLUIDO') return { indice: 12, problema: false, concluido: true };
  if (f === 'REPROVADO_FASE_1') return { indice: 7, problema: true, concluido: false };
  if (f === 'REPROVADO_FASE_2') return { indice: 9, problema: true, concluido: false };
  if (f === 'DESCONTINUADO') return { indice: 4, problema: true, concluido: false };
  return { indice: 0, problema: false, concluido: false };
}

const ROTULO_STATUS: Record<Status, string> = {
  concluido: 'Concluído',
  atual: 'Em andamento',
  futuro: 'A iniciar',
  problema: 'Interrompido',
};

const icoChevron = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18l6-6-6-6" />
  </svg>
);
const icoCheck = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="14" height="14" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export function TimelineVerticalDetalhada({ tcc }: { tcc: any }) {
  const { indice, problema, concluido } = estadoAtual(tcc);

  // Grupo que contém o subestado atual (expandido por padrão).
  const grupoAtual = GRUPOS.find((g) => g.subs.some((s) => s.i === indice)) ?? GRUPOS[0];
  const [aberto, setAberto] = useState<number>(grupoAtual.num);

  function statusSub(i: number): Status {
    if (concluido) return 'concluido';
    if (problema && i === indice) return 'problema';
    if (i < indice) return 'concluido';
    if (i === indice) return 'atual';
    return 'futuro';
  }

  function statusGrupo(g: (typeof GRUPOS)[number]): Status {
    const primeiro = g.subs[0].i;
    const ultimo = g.subs[g.subs.length - 1].i;
    if (concluido) return 'concluido';
    if (indice > ultimo) return 'concluido';
    if (indice >= primeiro && indice <= ultimo) return problema ? 'problema' : 'atual';
    return 'futuro';
  }

  return (
    <div className="tl-vert">
      {GRUPOS.map((g) => {
        const sg = statusGrupo(g);
        const expandido = aberto === g.num;
        return (
          <div key={g.num} className="tl-grupo">
            <button className="tl-cab" onClick={() => setAberto(expandido ? -1 : g.num)} aria-expanded={expandido}>
              <span className={`tl-num ${sg}`}>{sg === 'concluido' ? icoCheck : g.num}</span>
              <span className="tl-cab-texto">
                <span className="tl-cab-label">{g.label}</span>
                <span className="tl-cab-status">{ROTULO_STATUS[sg]}</span>
              </span>
              <span className={`tl-chevron${expandido ? ' aberto' : ''}`}>{icoChevron}</span>
            </button>
            {expandido && (
              <div className="tl-subs">
                {g.subs.map((s) => {
                  const ss = statusSub(s.i);
                  return (
                    <div key={s.i} className={`tl-sub${ss === 'atual' ? ' atual' : ''}`}>
                      <span className={`tl-dot ${ss}`} />
                      <span>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
