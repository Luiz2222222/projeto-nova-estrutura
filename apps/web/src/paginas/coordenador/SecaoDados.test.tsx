// @vitest-environment jsdom
// A seção "Dados do período" não pode mais oferecer o reset destrutivo: o único caminho de
// encerramento passa a ser "Encerrar e arquivar período", na seção do Drive.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SecaoDados } from './SecaoDados';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../api', () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  URL_API: '/api',
}));
vi.mock('../../componentes/ModalBaixarDados', () => ({
  ModalBaixarDados: () => <div>modal de download</div>,
}));

beforeEach(() => {
  apiGet.mockReset().mockResolvedValue({ semestre: '2026.2' });
  apiPost.mockReset();
});

describe('Reset antigo removido da interface', () => {
  it('não mostra o botão "Resetar período"', async () => {
    render(<SecaoDados />);
    expect(await screen.findByRole('button', { name: 'Baixar dados' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resetar período/i })).not.toBeInTheDocument();
  });

  it('não pede mais a palavra APAGAR em lugar nenhum', () => {
    render(<SecaoDados />);
    expect(screen.queryByText(/APAGAR/)).not.toBeInTheDocument();
  });

  it('aponta o usuário para o encerramento com arquivamento', async () => {
    render(<SecaoDados />);
    expect(await screen.findByText(/Encerrar e arquivar período/i)).toBeInTheDocument();
  });

  it('mantém o backup (Baixar dados) funcionando', async () => {
    render(<SecaoDados />);
    expect(await screen.findByRole('button', { name: 'Baixar dados' })).toBeEnabled();
  });
});
