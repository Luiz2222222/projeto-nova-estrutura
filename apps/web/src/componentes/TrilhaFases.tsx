// Assinatura do produto: a jornada do TCC pelas fases, como uma "trilha de circuito".
// Nós alcançados acendem em cobre. `atual = null` mostra o mapa (sem progresso).

export const FASES_MACRO = ['Solicitação', 'Desenvolvimento', 'Fase I', 'Fase II', 'Concluído'];

type Estado = 'concluida' | 'atual' | 'futura' | 'mapa';

interface Props {
  fases?: string[];
  atual?: number | null;
  orientacao?: 'horizontal' | 'vertical';
}

export function TrilhaFases({ fases = FASES_MACRO, atual = null, orientacao = 'horizontal' }: Props) {
  function estado(i: number): Estado {
    if (atual === null) return 'mapa';
    if (i < atual) return 'concluida';
    if (i === atual) return 'atual';
    return 'futura';
  }

  return (
    <ol className={`trilha trilha-${orientacao}`}>
      {fases.map((f, i) => (
        <li key={f} className={`fase fase-${estado(i)}`}>
          <span className="no" aria-hidden="true" />
          <span className="rotulo">{f}</span>
        </li>
      ))}
    </ol>
  );
}
