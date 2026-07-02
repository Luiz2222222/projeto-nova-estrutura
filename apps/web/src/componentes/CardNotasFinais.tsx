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

// Média da banca de uma fase SÓ quando todos os membros já enviaram (nota != null). Usada
// para estimar a nota que ficará antes da confirmação da coordenação (visão do coordenador).
function mediaBancaCompleta(tcc: any, fase: string): number | null {
  const banca = (tcc?.bancas ?? []).find((b: any) => b.fase === fase);
  const membros = banca?.membros ?? [];
  if (membros.length === 0) return null;
  const notas = membros.map((m: any) => m.nota).filter((n: any) => n != null).map(Number);
  if (notas.length !== membros.length) return null; // ainda faltam avaliações enviadas
  return mediaNotas(notas);
}

// Um bloco com duas linhas rotuladas (ex.: normal + ponderada). `pendente` = nota estimada
// ainda não confirmada pela coordenação.
function BlocoNotas({ titulo, pendente, destaque, linhas }: { titulo: string; pendente?: boolean; destaque?: boolean; linhas: { rot: string; valor: number | null; forte?: boolean }[] }) {
  return (
    <div className={`nota-bloco${destaque ? ' nota-bloco-final' : ''}`}>
      <span className="nota-bloco-titulo">{titulo}{pendente && <span className="nota-bloco-pend"> (Aguardando confirmação)</span>}</span>
      {linhas.map((l) => (
        <div key={l.rot} className="nota-bloco-linha">
          <span className="nota-bloco-rot">{l.rot}</span>
          {l.valor == null
            ? <span className="nota-bloco-val aguardando">Aguardando</span>
            : <span className={`nota-bloco-val${l.forte ? ' final' : ' pond'}${pendente ? ' estimada' : ''}`}>{fmt(l.valor)}</span>}
        </div>
      ))}
    </div>
  );
}

export function CardNotasFinais({ tcc, coordenador = false }: { tcc: any; coordenador?: boolean }) {
  const nf1 = num(tcc?.nf1);
  const nf2 = num(tcc?.nf2);
  const nf = num(tcc?.nf);
  const resultado: string | null = tcc?.resultado ?? null;

  // Estimativa (SÓ coordenador): quando a nota oficial ainda não existe, mas a banca da fase
  // já enviou todas as avaliações — para o coordenador ver a nota que ficará se ele confirmar.
  // Para os demais perfis, coordenador=false (e o backend já sanitiza as notas dos membros).
  const est1 = coordenador && nf1 == null ? mediaBancaCompleta(tcc, 'FASE_1') : null;
  const est2 = coordenador && nf2 == null ? mediaBancaCompleta(tcc, 'FASE_2') : null;
  const nf1Eff = nf1 ?? est1;
  const nf2Eff = nf2 ?? est2;
  const nf1Pend = nf1 == null && est1 != null;
  const nf2Pend = nf2 == null && est2 != null;

  const pondF1 = nf1Eff == null ? null : PESO_NF1 * nf1Eff;
  const pondF2 = nf2Eff == null ? null : PESO_NF2 * nf2Eff;
  const finalNormal = nf1Eff != null && nf2Eff != null ? mediaNotas([nf1Eff, nf2Eff]) : null;
  const finalPond = nf != null ? nf : nf1Eff != null && nf2Eff != null ? notaFinal(nf1Eff, nf2Eff) : null;
  const nfPend = nf == null && finalPond != null;

  // Mostra quando há nota oficial OU estimativa (coordenador) OU resultado.
  if (nf1Eff == null && nf2Eff == null && finalPond == null && resultado == null) return null;

  const corResultado = resultado === 'APROVADO' ? 'var(--aprovado)' : resultado === 'REPROVADO' ? 'var(--reprovado)' : undefined;
  const bgResultado = resultado === 'APROVADO' ? 'var(--aprovado-suave)' : 'var(--reprovado-suave)';

  return (
    <section className="cartao-secao bloco">
      <h2>{icoNotas} Notas Finais</h2>
      <div className="notas-finais-grid">
        <BlocoNotas titulo="Fase I" pendente={nf1Pend} linhas={[
          { rot: 'Média normal', valor: nf1Eff, forte: true },
          { rot: `Ponderada (${Math.round(PESO_NF1 * 100)}%)`, valor: pondF1 },
        ]} />
        <BlocoNotas titulo="Fase II" pendente={nf2Pend} linhas={[
          { rot: 'Média normal', valor: nf2Eff, forte: true },
          { rot: `Ponderada (${Math.round(PESO_NF2 * 100)}%)`, valor: pondF2 },
        ]} />
        <BlocoNotas titulo="Nota Final" destaque pendente={nfPend} linhas={[
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
