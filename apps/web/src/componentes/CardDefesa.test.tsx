// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CardDefesa } from './CardDefesa';

const base = {
  defesaAgendadaPara: '2026-07-17T05:04:00.000Z', // 02:04 em Fortaleza
  defesaLocal: 'Auditório do DEE',
  defesaComentario: null as string | null,
};

describe('CardDefesa (renderização)', () => {
  it('local https vira LINK seguro (target _blank + noopener noreferrer)', () => {
    render(<CardDefesa tcc={{ ...base, defesaLocal: 'https://meet.google.com/abc' }} />);
    const link = screen.getByRole('link', { name: 'https://meet.google.com/abc' });
    expect(link).toHaveAttribute('href', 'https://meet.google.com/abc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('local em texto NÃO vira link (nem HTML) — aparece como texto puro', () => {
    render(<CardDefesa tcc={{ ...base, defesaLocal: 'Sala <b>A-204</b>' }} />);
    expect(screen.queryByRole('link')).toBeNull();
    // O markup dentro do texto não é interpretado: aparece literal.
    expect(screen.getByText('Sala <b>A-204</b>')).toBeInTheDocument();
  });

  it('mostra data/hora no fuso de Fortaleza e o comentário quando existe', () => {
    render(<CardDefesa tcc={{ ...base, defesaComentario: 'Levar projetor' }} />);
    expect(screen.getByText('17/07/2026 às 02:04')).toBeInTheDocument();
    expect(screen.getByText('Comentário')).toBeInTheDocument();
    expect(screen.getByText('Levar projetor')).toBeInTheDocument();
  });

  it('sem comentário, a linha de comentário não aparece', () => {
    render(<CardDefesa tcc={base} />);
    expect(screen.queryByText('Comentário')).toBeNull();
  });

  it('sem defesa agendada, não renderiza nada', () => {
    const { container } = render(<CardDefesa tcc={{ defesaAgendadaPara: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
