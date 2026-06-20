// Assinatura do produto: a jornada do TCC pelas fases, como uma "trilha de circuito".
// Nós alcançados acendem em cobre. `atual = null` mostra o mapa (sem progresso).
// No modo horizontal pode mostrar o status/subfase sob o nó atual e as notas
// (Fase I / Fase II / final) sob os nós correspondentes, como no projeto antigo.
import type { NotasTrilha } from '../utils/fases';

export const FASES_MACRO = ['Solicitação', 'Desenvolvimento', 'Fase I', 'Fase II', 'Concluído'];

type Estado = 'concluida' | 'atual' | 'futura' | 'mapa';

interface Props {
  fases?: string[];
  atual?: number | null;
  orientacao?: 'horizontal' | 'vertical';
  sub?: string; // status/subfase mostrado sob o nó atual (só horizontal)
  notas?: NotasTrilha; // notas sob os nós de Fase I (2), Fase II (3) e Concluído (4)
}

const fmtNota = (v?: number | null) =>
  v == null ? null : Number(v).toFixed(1).replace('.', ',');

export function TrilhaFases({ fases = FASES_MACRO, atual = null, orientacao = 'horizontal', sub, notas }: Props) {
  function estado(i: number): Estado {
    if (atual === null) return 'mapa';
    if (i < atual) return 'concluida';
    if (i === atual) return 'atual';
    return 'futura';
  }

  // Nota posicionada por índice de nó: 2 = Fase I, 3 = Fase II, 4 = Concluído.
  function notaDoNo(i: number): string | null {
    if (!notas) return null;
    if (i === 2) return fmtNota(notas.fase1);
    if (i === 3) return fmtNota(notas.fase2);
    if (i === 4) return fmtNota(notas.final);
    return null;
  }

  const horizontal = orientacao === 'horizontal';

  return (
    <ol className={`trilha trilha-${orientacao}`}>
      {fases.map((f, i) => {
        const nota = horizontal ? notaDoNo(i) : null;
        return (
          <li key={f} className={`fase fase-${estado(i)}`}>
            <span className="no" aria-hidden="true" />
            <span className="rotulo">{f}</span>
            {horizontal && sub && i === atual && <span className="fase-sub-trilha">{sub}</span>}
            {nota && <span className="trilha-nota">Nota {nota}</span>}
          </li>
        );
      })}
    </ol>
  );
}
