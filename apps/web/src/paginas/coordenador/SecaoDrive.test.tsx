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

describe('Status da integração', () => {
  it('mostra a conta autorizada, a pasta raiz e o último sync', async () => {
    responder();
    render(<SecaoDrive />);
    expect(await screen.findByDisplayValue('coordenacaodee@ufpe.br')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Conectado')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sistema de TCC - DEE')).toBeInTheDocument();
  });

  it('avisa quando o servidor não tem as credenciais configuradas', async () => {
    responder({ ...statusBase, configurado: false, conectado: false });
    render(<SecaoDrive />);
    expect(await screen.findByText(/não configurada no servidor/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Conectar conta/i })).not.toBeInTheDocument();
  });

  it('desconectado oferece conectar; conectado oferece tentar novamente e desconectar', async () => {
    responder({ ...statusBase, conectado: false });
    const { unmount } = render(<SecaoDrive />);
    expect(await screen.findByRole('button', { name: /Conectar conta do Google/i })).toBeInTheDocument();
    unmount();

    responder();
    render(<SecaoDrive />);
    expect(await screen.findByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeInTheDocument();
  });

  it('mostra as pendências da fila', async () => {
    responder({ ...statusBase, pendentes: 3, comErro: 2, ultimoErro: 'quota excedida' });
    render(<SecaoDrive />);
    expect(await screen.findByText(/quota excedida/)).toBeInTheDocument();
  });
});

// Uma ação destrutiva não pode ter dois caminhos: aqui não existe nenhum.
describe('Nenhum caminho de encerramento neste card', () => {
  it('não tem botão nem título de encerrar período', async () => {
    responder();
    render(<SecaoDrive />);
    await screen.findByDisplayValue('Conectado');

    expect(screen.queryByRole('button', { name: /Encerrar e arquivar período/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver impacto do encerramento/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Encerrar e arquivar período/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Digite ENCERRAR para confirmar')).not.toBeInTheDocument();
  });

  it('nem quando a integração está desconfigurada', async () => {
    responder({ ...statusBase, configurado: false, conectado: false });
    render(<SecaoDrive />);
    await screen.findByText(/não configurada no servidor/i);

    expect(screen.queryByRole('button', { name: /Encerrar e arquivar período/i })).not.toBeInTheDocument();
    // Mas aponta onde o encerramento está, para o coordenador não se perder.
    expect(screen.getByText(/Dados do período/i)).toBeInTheDocument();
  });

  it('não chama os endpoints de encerramento', async () => {
    responder();
    render(<SecaoDrive />);
    await screen.findByDisplayValue('Conectado');

    const rotas = apiGet.mock.calls.map((c) => c[0]);
    expect(rotas).not.toContain('/periodo/encerrar/previa');
    expect(apiPost).not.toHaveBeenCalled();
  });
});
