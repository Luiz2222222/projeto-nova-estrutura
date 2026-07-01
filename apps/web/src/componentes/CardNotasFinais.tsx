// Card "Notas Finais" no topo da página interna do TCC (espelha o card do projeto antigo,
// com nota normal + nota ponderada). Quatro blocos: Fase I, Fase II, Nota Final e Status.
//
// Permissão: o card é DIRIGIDO PELOS DADOS já sanitizados pelo backend. Para aluno/orientador/
// coorientador, nf1/nf2/nf/resultado só chegam depois da confirmação da nota final da Fase II
// (senão vêm nulos e o card nem aparece). O coordenador recebe as notas assim que existem.
//
// Cálculo: nada novo — usa os pesos e a nota final do domínio (PESO_NF1/PESO_NF2, notaFinal,
// mediaNotas). "Normal" da nota final = média simples; "Ponderada" = NF (0,6·NF1 + 0,4·NF2).
import { ROTULO_FASE } from '../utils/fases';
import { PESO_NF1, PESO_NF2, notaFinal, mediaNotas } from '@tcc/compartilhado';

const ic = (d: string) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => <path key={i} d={p} />)}
  </svg>
);
// Troféu/medalha, para casar com "Notas Finais".
const icoNotas = ic('M8 21h8|M12 17v4|M7 4h10v5a5 5 0 0 1-10 0V4z|M17 5h3v2a3 3 0 0 1-3 3|M7 5H4v2a3 3 0 0 0 3 3');

const num = (v: any): number | null => (v == null ? null : Number(v));
const fmt = (v: number | null): string => (v == null ? '—' : v.toFixed(2).replace('.', ','));

// Um bloco com duas linhas rotuladas (ex.: normal + ponderada).
function BlocoNotas({ titulo, destaque, linhas }: { titulo: string; destaque?: boolean; linhas: { rot: string; valor: number | null; forte?: boolean }[] }) {
  return (
    <div className={`nota-bloco${destaque ? ' nota-bloco-final' : ''}`}>
      <span className="nota-bloco-titulo">{titulo}</span>
      {linhas.map((l) => (
        <div key={l.rot} className="nota-bloco-linha">
          <span className="nota-bloco-rot">{l.rot}</span>
          {l.valor == null
            ? <span className="nota-bloco-val aguardando">Aguardando</span>
            : <span className={`nota-bloco-val${l.forte ? ' final' : ' pond'}`}>{fmt(l.valor)}</span>}
        </div>
      ))}
    </div>
  );
}

export function CardNotasFinais({ tcc }: { tcc: any }) {
  const nf1 = num(tcc?.nf1);
  const nf2 = num(tcc?.nf2);
  const nf = num(tcc?.nf);
  const resultado: string | null = tcc?.resultado ?? null;

  // Só mostra quando há algo real. Como os campos já vêm sanitizados por perfil, isso também
  // garante a permissão (não-coordenador só vê depois da confirmação da nota final).
  if (nf1 == null && nf2 == null && nf == null && resultado == null) return null;

  const pondF1 = nf1 == null ? null : PESO_NF1 * nf1;
  const pondF2 = nf2 == null ? null : PESO_NF2 * nf2;
  const finalNormal = nf1 != null && nf2 != null ? mediaNotas([nf1, nf2]) : null;
  const finalPond = nf != null ? nf : nf1 != null && nf2 != null ? notaFinal(nf1, nf2) : null;

  const corResultado = resultado === 'APROVADO' ? 'var(--aprovado)' : resultado === 'REPROVADO' ? 'var(--reprovado)' : undefined;
  const bgResultado = resultado === 'APROVADO' ? 'var(--aprovado-suave)' : 'var(--reprovado-suave)';

  return (
    <section className="cartao-secao bloco">
      <h2>{icoNotas} Notas Finais</h2>
      <div className="notas-finais-grid">
        <BlocoNotas titulo="Fase I" linhas={[
          { rot: 'Média normal', valor: nf1, forte: true },
          { rot: `Ponderada (${Math.round(PESO_NF1 * 100)}%)`, valor: pondF1 },
        ]} />
        <BlocoNotas titulo="Fase II" linhas={[
          { rot: 'Média normal', valor: nf2, forte: true },
          { rot: `Ponderada (${Math.round(PESO_NF2 * 100)}%)`, valor: pondF2 },
        ]} />
        <BlocoNotas titulo="Nota Final" destaque linhas={[
          { rot: 'Normal', valor: finalNormal },
          { rot: 'Ponderada', valor: finalPond, forte: true },
        ]} />

        <div className="nota-bloco">
          <span className="nota-bloco-titulo">Status</span>
          <span className="selo" style={{ background: 'var(--azul-suave)', color: 'var(--azul-escuro)' }}>
            {ROTULO_FASE[tcc?.faseAtual] ?? tcc?.faseAtual ?? '—'}
          </span>
          {resultado && (
            <span className="selo" style={{ background: bgResultado, color: corResultado }}>{resultado}</span>
          )}
        </div>
      </div>
    </section>
  );
}
