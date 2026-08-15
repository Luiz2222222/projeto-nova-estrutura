// @vitest-environment jsdom
// "Dados do período": backup à esquerda e encerramento à direita, no MESMO card. O reset
// antigo continua fora, e o encerramento nunca acontece direto — sempre pela confirmação.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SecaoDados } from './SecaoDados';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../api', () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  mensagemErro: (e: any, padrao: string) => e?.mensagem || padrao,
  URL_API: '/api',
}));
vi.mock('../../componentes/ModalBaixarDados', () => ({
  ModalBaixarDados: () => <div>modal de download</div>,
}));

const previa = {
  semestre: '2026.2',
  conectadoAoDrive: false,
  tccs: 5,
  pendenciasSincronizacao: 0,
  podeEncerrar: true,
  contasParaApagar: [{ nome: 'Lucas', email: 'lucas@ufpe.br', papel: 'ALUNO' }],
  contasPreservadas: [],
};

beforeEach(() => {
  apiGet.mockReset().mockImplementation(async (rota: string) =>
    rota === '/semestre-ativo' ? { semestre: '2026.2' } : previa,
  );
  apiPost.mockReset();
});

describe('Ações do card', () => {
  it('tem os dois botões no mesmo card, backup e encerramento', async () => {
    render(<SecaoDados />);
    expect(await screen.findByRole('button', { name: 'Baixar dados' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encerrar período' })).toBeInTheDocument();
  });

  it('ficam na mesma linha, nas pontas (space-between) e podem empilhar', async () => {
    render(<SecaoDados />);
    const baixar = await screen.findByRole('button', { name: 'Baixar dados' });
    const linha = baixar.parentElement as HTMLElement;

    expect(linha).toHaveStyle({ justifyContent: 'space-between' });
    expect(linha).toHaveStyle({ flexWrap: 'wrap' }); // em tela estreita, empilha
    // Baixar à esquerda, encerrar à direita: ordem no DOM.
    const botoes = Array.from(linha.querySelectorAll('button')).map((b) => b.textContent);
    expect(botoes[0]).toBe('Baixar dados');
    expect(botoes[botoes.length - 1]).toBe('Encerrar período');
  });

  it('não instrui mais a ir na seção do Google Drive para encerrar', async () => {
    render(<SecaoDados />);
    await screen.findByRole('button', { name: 'Baixar dados' });
    expect(screen.queryByText(/seção do Google Drive/i)).not.toBeInTheDocument();
  });

  it('o reset antigo continua fora', async () => {
    render(<SecaoDados />);
    await screen.findByRole('button', { name: 'Baixar dados' });
    expect(screen.queryByRole('button', { name: /Resetar período/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/APAGAR/)).not.toBeInTheDocument();
  });
});

describe('Encerramento sempre passa pela confirmação', () => {
  it('clicar no botão abre a prévia — não encerra direto', async () => {
    render(<SecaoDados />);
    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar período' }));

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/periodo/encerrar/previa'));
    expect(apiPost).not.toHaveBeenCalled(); // nada foi encerrado
    expect(await screen.findByText(/Contas que serão apagadas/i)).toBeInTheDocument();
  });

  it('exige senha e a palavra ENCERRAR antes de habilitar', async () => {
    render(<SecaoDados />);
    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar período' }));
    await screen.findByText(/Contas que serão apagadas/i);

    // Dentro do modal, o botão de confirmar é o último com esse nome.
    const confirmar = () => {
      const todos = screen.getAllByRole('button', { name: 'Encerrar período' });
      return todos[todos.length - 1];
    };
    expect(confirmar()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'minha-senha' } });
    expect(confirmar()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Digite ENCERRAR para confirmar'), { target: { value: 'ENCERRAR' } });
    expect(confirmar()).toBeEnabled();
  });

  it('confirmado, chama o endpoint existente com senha e confirmação', async () => {
    apiPost.mockResolvedValue({
      semestre: '2026.2',
      tccsArquivados: 5,
      tccsApagados: 5,
      arquivosLocaisRemovidos: 10,
      contasApagadas: ['Lucas'],
      contasPreservadas: [],
      driveConectado: false,
      snapshotEnviadoAoDrive: 0,
    });
    render(<SecaoDados />);
    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar período' }));
    await screen.findByText(/Contas que serão apagadas/i);
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'minha-senha' } });
    fireEvent.change(screen.getByLabelText('Digite ENCERRAR para confirmar'), { target: { value: 'ENCERRAR' } });

    const todos = screen.getAllByRole('button', { name: 'Encerrar período' });
    fireEvent.click(todos[todos.length - 1]);

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/periodo/encerrar', { senha: 'minha-senha', confirmacao: 'ENCERRAR' }),
    );
    expect(await screen.findByText(/arquivado localmente/i)).toBeInTheDocument();
  });

  it('cancelar fecha sem encerrar', async () => {
    render(<SecaoDados />);
    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar período' }));
    await screen.findByText(/Contas que serão apagadas/i);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByLabelText('Sua senha')).not.toBeInTheDocument());
    expect(apiPost).not.toHaveBeenCalled();
  });
});
