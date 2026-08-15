// @vitest-environment jsdom
// Card do Drive: SÓ integração (situação, conta, pasta raiz, sincronização, desconectar).
// O encerramento de período saiu daqui — ele mora em "Dados do período", com teste próprio.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SecaoDrive } from './SecaoDrive';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../api', () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  mensagemErro: (e: any, padrao: string) => e?.mensagem || padrao,
  URL_API: '/api',
}));

const statusBase = {
  conectado: true,
  configurado: true,
  contaEmail: 'coordenacaodee@ufpe.br',
  pastaRaizNome: 'Sistema de TCC - DEE',
  conectadoEm: '2026-08-01T12:00:00Z',
  ultimoSyncEm: '2026-08-13T12:00:00Z',
  ultimoErro: null as string | null,
  pendentes: 0,
  comErro: 0,
};

function responder(status = statusBase) {
  apiGet.mockResolvedValue(status);
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

describe('Painel informativo (nada editável)', () => {
  it('mostra situação, conta, pasta raiz e última sincronização como texto', async () => {
    responder();
    render(<SecaoDrive />);
    expect(await screen.findByText('coordenacaodee@ufpe.br')).toBeInTheDocument();
    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.getByText('Sistema de TCC - DEE')).toBeInTheDocument();
    for (const rotulo of ['Situação', 'Conta autorizada', 'Pasta raiz', 'Última sincronização', 'Pendências']) {
      expect(screen.getByText(rotulo)).toBeInTheDocument();
    }
  });

  it('o card NÃO tem campos com aparência de formulário', async () => {
    responder();
    const { container } = render(<SecaoDrive />);
    await screen.findByText('Conectado');

    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('textarea')).toHaveLength(0);
    expect(container.querySelectorAll('select')).toHaveLength(0);
  });

  it('mostra as pendências da fila e o último erro', async () => {
    responder({ ...statusBase, pendentes: 3, comErro: 2, ultimoErro: 'quota excedida' });
    render(<SecaoDrive />);
    expect(await screen.findByText(/3 na fila · 2 com erro/)).toBeInTheDocument();
    expect(screen.getByText(/quota excedida/)).toBeInTheDocument();
  });

  it('avisa quando o servidor não tem as credenciais configuradas, sem botões', async () => {
    responder({ ...statusBase, configurado: false, conectado: false });
    render(<SecaoDrive />);
    expect(await screen.findByText(/não configurada no servidor/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Conectar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desconectar' })).not.toBeInTheDocument();
  });
});

describe('Ações do card', () => {
  it('conectado: SOMENTE Desconectar', async () => {
    responder();
    render(<SecaoDrive />);
    await screen.findByText('Conectado');

    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Conectar Google Drive/i })).not.toBeInTheDocument();
  });

  it('desconectado: SOMENTE Conectar Google Drive', async () => {
    responder({ ...statusBase, conectado: false });
    render(<SecaoDrive />);

    expect(await screen.findByRole('button', { name: 'Conectar Google Drive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desconectar' })).not.toBeInTheDocument();
  });

  // O retry manual saiu da tela; o worker do servidor continua tentando sozinho.
  it('não existe mais "Tentar novamente"', async () => {
    responder();
    const { unmount } = render(<SecaoDrive />);
    await screen.findByText('Conectado');
    expect(screen.queryByRole('button', { name: /Tentar novamente/i })).not.toBeInTheDocument();
    unmount();

    responder({ ...statusBase, conectado: false });
    render(<SecaoDrive />);
    await screen.findByRole('button', { name: 'Conectar Google Drive' });
    expect(screen.queryByRole('button', { name: /Tentar novamente/i })).not.toBeInTheDocument();
  });

  it('a tela não dispara sincronização manual', async () => {
    responder();
    render(<SecaoDrive />);
    await screen.findByText('Conectado');
    expect(apiPost).not.toHaveBeenCalledWith('/drive/sincronizar', expect.anything());
  });
});

// Uma ação destrutiva não pode ter dois caminhos: aqui não existe nenhum.
describe('Nenhum caminho de encerramento neste card', () => {
  it('não tem botão nem título de encerrar período', async () => {
    responder();
    render(<SecaoDrive />);
    await screen.findByText('Conectado');

    expect(screen.queryByRole('button', { name: /Encerrar período/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver impacto do encerramento/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Encerrar período/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Digite ENCERRAR para confirmar')).not.toBeInTheDocument();
  });

  it('nem quando a integração está desconfigurada', async () => {
    responder({ ...statusBase, configurado: false, conectado: false });
    render(<SecaoDrive />);
    await screen.findByText(/não configurada no servidor/i);

    expect(screen.queryByRole('button', { name: /Encerrar período/i })).not.toBeInTheDocument();
    // Mas aponta onde o encerramento está, para o coordenador não se perder.
    expect(screen.getByText(/Dados do período/i)).toBeInTheDocument();
  });

  it('não chama os endpoints de encerramento', async () => {
    responder();
    render(<SecaoDrive />);
    await screen.findByText('Conectado');

    const rotas = apiGet.mock.calls.map((c) => c[0]);
    expect(rotas).not.toContain('/periodo/encerrar/previa');
    expect(apiPost).not.toHaveBeenCalled();
  });
});
