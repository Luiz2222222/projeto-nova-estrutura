// @vitest-environment jsdom
// Cenário: a exclusão do TCC deu certo no banco, mas o servidor não conseguiu apagar um ou
// mais arquivos do disco. Sem esta tela, o coordenador veria "sucesso" e os órfãos ficariam
// só no log — por isso o aviso precisa listar os caminhos e ser explícito sobre o que
// aconteceu (TCC excluído) e o que falta (limpeza manual).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ModalArquivosNaoRemovidos } from './ModalArquivosNaoRemovidos';

describe('ModalArquivosNaoRemovidos', () => {
  it('lista cada arquivo pendente para limpeza manual', () => {
    render(<ModalArquivosNaoRemovidos arquivos={['uploads/a.pdf', 'uploads/b.docx']} aoFechar={vi.fn()} />);
    expect(screen.getByText('uploads/a.pdf')).toBeInTheDocument();
    expect(screen.getByText('uploads/b.docx')).toBeInTheDocument();
  });

  it('deixa claro que o TCC FOI excluído (a falha é só dos arquivos)', () => {
    render(<ModalArquivosNaoRemovidos arquivos={['uploads/a.pdf']} aoFechar={vi.fn()} />);
    expect(screen.getByText(/excluídos do banco/i)).toBeInTheDocument();
    expect(screen.getByText(/1 arquivo não pôde ser removido/i)).toBeInTheDocument();
  });

  it('concorda em número quando há vários arquivos', () => {
    render(<ModalArquivosNaoRemovidos arquivos={['a', 'b', 'c']} aoFechar={vi.fn()} />);
    expect(screen.getByText(/3 arquivos não puderam ser removidos/i)).toBeInTheDocument();
  });

  it('"Entendi" fecha (é quem dispara o redirecionamento na página)', () => {
    const aoFechar = vi.fn();
    render(<ModalArquivosNaoRemovidos arquivos={['uploads/a.pdf']} aoFechar={aoFechar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });
});
