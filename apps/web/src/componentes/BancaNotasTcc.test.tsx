// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { BancaNotasTcc } from './BancaNotasTcc';
import type { Tcc } from '../tipos';

// TCC com banca da Fase I e um membro com avaliação enviada (nota 9).
function tccCom(fase: string, nf: number | null, statusMembro = 'ENVIADO', nota: number | null = 9): Tcc {
  return {
    id: 't1',
    titulo: 'TCC teste',
    faseAtual: fase,
    nf,
    orientadorId: 'ori1',
    bancas: [
      {
        id: 'b1',
        fase: 'FASE_1',
        membros: [
          {
            id: 'm1',
            avaliadorId: 'av1',
            status: statusMembro,
            nota,
            parecer: '=== Parecer geral ===\nTrabalho excelente',
            avaliador: { id: 'av1', nomeCompleto: 'Maria Avaliadora', tratamento: 'Prof. Dr.' },
          },
        ],
      },
    ],
  };
}

describe('BancaNotasTcc (renderização) — visibilidade das notas', () => {
  it('sem banca formada mostra o aviso e nada de notas', () => {
    render(<BancaNotasTcc tcc={{ id: 't1', titulo: 'X', faseAtual: 'DESENVOLVIMENTO' }} />);
    expect(screen.getByText('Banca ainda não formada.')).toBeInTheDocument();
  });

  it('ANTES da nota final: mostra só o status ("Avaliação registrada"), sem nota nem parecer', () => {
    render(<BancaNotasTcc tcc={tccCom('AGUARDANDO_ANALISE_COORDENACAO_FASE_1', null)} />);
    expect(screen.getByText('Avaliação registrada')).toBeInTheDocument();
    expect(screen.queryByText(/Nota total:/)).toBeNull();
    expect(screen.queryByText(/Trabalho excelente/)).toBeNull();
  });

  it('membro pendente antes da liberação mostra "Aguardando avaliação"', () => {
    render(<BancaNotasTcc tcc={tccCom('AVALIACAO_FASE_1', null, 'PENDENTE', null)} />);
    expect(screen.getByText('Aguardando avaliação')).toBeInTheDocument();
  });

  it('DEPOIS da nota final confirmada: mostra nota total e parecer geral', () => {
    render(<BancaNotasTcc tcc={tccCom('CONCLUIDO', 8.5)} />);
    expect(screen.getByText(/Nota total:/)).toBeInTheDocument();
    expect(screen.getByText('9,00')).toBeInTheDocument();
    expect(screen.getByText(/Trabalho excelente/)).toBeInTheDocument();
    expect(screen.getByText(/Maria Avaliadora/)).toBeInTheDocument();
  });

  it('reprovação terminal libera as notas mesmo sem nota final (critério do backend)', () => {
    render(<BancaNotasTcc tcc={tccCom('REPROVADO_FASE_1', null)} />);
    expect(screen.getByText(/Nota total:/)).toBeInTheDocument();
  });

  it('notas liberadas mas membro sem avaliação enviada: "Avaliação ainda não enviada."', () => {
    render(<BancaNotasTcc tcc={tccCom('CONCLUIDO', 8.5, 'PENDENTE', null)} />);
    expect(screen.getByText('Avaliação ainda não enviada.')).toBeInTheDocument();
  });
});
