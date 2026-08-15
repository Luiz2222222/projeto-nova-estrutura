// @vitest-environment jsdom
// Card do Drive: SÓ integração (situação, conta, pasta raiz, sincronização, desconectar).
// O encerramento de período saiu daqui — ele mora em "Dados do período", com teste próprio.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('mostra conta, pasta e última atualização como texto, nessa ordem', async () => {
    responder();
    const { container } = render(<SecaoDrive />);
    expect(await screen.findByText('coordenacaodee@ufpe.br')).toBeInTheDocument();
    expect(screen.getByText('Sistema de TCC - DEE')).toBeInTheDocument();

    const rotulos = [...container.querySelectorAll('dt')].map((e) => e.textContent);
    expect(rotulos).toEqual(['Conta:', 'Pasta:', 'Última atualização:']);
  });

  it('a data usa dd/mm/aaaa HH:mm:ss no fuso de Fortaleza', async () => {
    // 13/08/2026 12:00 UTC = 09:00:00 em Fortaleza (UTC-3).
    responder({ ...statusBase, ultimoSyncEm: '2026-08-13T12:00:00Z' });
    render(<SecaoDrive />);

    expect(await screen.findByText('13/08/2026 09:00:00')).toBeInTheDocument();
  });

  it('o selo de status fica ao lado do título, no padrão dos status de documento', async () => {
    responder();
    const { container } = render(<SecaoDrive />);
    await screen.findByText('Conectado');

    const selo = container.querySelector('.status-pill')!;
    expect(selo).toHaveTextContent('Conectado');
    expect(selo.className).toContain('status-normal'); // verde
  });

  it('desconectado e não configurado têm selo próprio', async () => {
    responder({ ...statusBase, conectado: false });
    const { container, unmount } = render(<SecaoDrive />);
    expect(await screen.findByText('Não conectado')).toBeInTheDocument();
    expect(container.querySelector('.status-pill')!.className).toContain('status-atencao');
    unmount();

    responder({ ...statusBase, configurado: false, conectado: false });
    const r2 = render(<SecaoDrive />);
    expect(await screen.findByText('Não configurado')).toBeInTheDocument();
    expect(r2.container.querySelector('.status-pill')!.className).toContain('pilula-neutra');
  });

  it('o card NÃO tem campos com aparência de formulário', async () => {
    responder();
    const { container } = render(<SecaoDrive />);
    await screen.findByText('Conectado');

    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('textarea')).toHaveLength(0);
    expect(container.querySelectorAll('select')).toHaveLength(0);
  });

  it('a linha de "Pendências" não existe mais', async () => {
    responder({ ...statusBase, pendentes: 3, comErro: 2, ultimoErro: 'quota excedida' });
    render(<SecaoDrive />);
    await screen.findByText('Conectado');

    expect(screen.queryByText(/Pendências/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/na fila/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/quota excedida/)).not.toBeInTheDocument();
  });

  it('avisa quando o servidor não tem as credenciais configuradas, sem botões', async () => {
    responder({ ...statusBase, configurado: false, conectado: false });
    render(<SecaoDrive />);
    expect(await screen.findByText(/não configurada no servidor/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Conectar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desconectar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atualizar' })).not.toBeInTheDocument();
  });
});

describe('Ações do card', () => {
  it('conectado: Atualizar e Desconectar (nunca Conectar)', async () => {
    responder();
    render(<SecaoDrive />);
    await screen.findByText('Conectado');

    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Conectar Google Drive/i })).not.toBeInTheDocument();
  });

  it('desconectado: Conectar Google Drive em verde (nunca Desconectar)', async () => {
    responder({ ...statusBase, conectado: false });
    render(<SecaoDrive />);

    const conectar = await screen.findByRole('button', { name: 'Conectar Google Drive' });
    expect(conectar).toBeInTheDocument();
    expect(conectar).toHaveStyle({ background: '#15803d' });
    expect(screen.queryByRole('button', { name: 'Desconectar' })).not.toBeInTheDocument();
  });

  // Os dois botões formam UM grupo à direita, com "Atualizar" imediatamente antes da ação
  // de conectar/desconectar — nada de "Atualizar" jogado na outra ponta do card.
  it.each([
    ['conectado', true, 'Desconectar'],
    ['desconectado', false, 'Conectar Google Drive'],
  ])('%s: Atualizar fica colado à esquerda de "%s", no mesmo grupo à direita', async (_nome, conectado, acao) => {
    responder({ ...statusBase, conectado: conectado as boolean });
    const { container } = render(<SecaoDrive />);
    const botaoAcao = await screen.findByRole('button', { name: acao as string });
    const atualizar = screen.getByRole('button', { name: 'Atualizar' });

    // Mesmo container, e nessa ordem (vale também quando empilham em tela estreita).
    const grupo = container.querySelector('.acoes')!;
    expect(atualizar.parentElement).toBe(grupo);
    expect(botaoAcao.parentElement).toBe(grupo);
    expect([...grupo.children].map((b) => b.textContent)).toEqual(['Atualizar', acao]);

    // O grupo inteiro encosta na direita; nenhum botão é empurrado para a outra ponta.
    expect(grupo).toHaveStyle({ flexWrap: 'wrap' });
    expect(atualizar.style.marginRight).toBe('');
    expect(botaoAcao.style.marginLeft).toBe('');
  });

  it('"Atualizar" só relê o status — não sincroniza, não enfileira, não apaga', async () => {
    responder();
    render(<SecaoDrive />);
    await screen.findByText('Conectado');
    const antes = apiGet.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(apiGet.mock.calls.length).toBe(antes + 1));

    // Recarregou o MESMO status, e nada além disso saiu da tela.
    expect(apiGet.mock.calls.every((c) => c[0] === '/drive/status')).toBe(true);
    expect(apiPost).not.toHaveBeenCalled();
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
