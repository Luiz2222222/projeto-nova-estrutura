// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ModalConfirmacao } from './ModalConfirmacao';

function montar(extra: Partial<Parameters<typeof ModalConfirmacao>[0]> = {}) {
  const aoConfirmar = vi.fn();
  const aoCancelar = vi.fn();
  render(
    <ModalConfirmacao
      titulo="Excluir TCC"
      mensagem="Essa ação não pode ser desfeita."
      textoConfirmar="Excluir"
      aoConfirmar={aoConfirmar}
      aoCancelar={aoCancelar}
      {...extra}
    />,
  );
  return { aoConfirmar, aoCancelar };
}

describe('ModalConfirmacao (interação)', () => {
  it('mostra título e mensagem', () => {
    montar();
    expect(screen.getByText('Excluir TCC')).toBeInTheDocument();
    expect(screen.getByText('Essa ação não pode ser desfeita.')).toBeInTheDocument();
  });

  it('clicar em confirmar chama aoConfirmar (e não aoCancelar)', () => {
    const { aoConfirmar, aoCancelar } = montar();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(aoCancelar).not.toHaveBeenCalled();
  });

  it('clicar em cancelar chama aoCancelar (e não aoConfirmar)', () => {
    const { aoConfirmar, aoCancelar } = montar();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(aoCancelar).toHaveBeenCalledTimes(1);
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  it('processando desabilita os dois botões e troca o rótulo', () => {
    const { aoConfirmar } = montar({ processando: true, textoProcessando: 'Excluindo…' });
    const confirmar = screen.getByRole('button', { name: 'Excluindo…' });
    expect(confirmar).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    fireEvent.click(confirmar);
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  it('erro inline aparece quando informado', () => {
    montar({ erro: 'Não foi possível excluir.' });
    expect(screen.getByText('Não foi possível excluir.')).toBeInTheDocument();
  });
});
