// @vitest-environment jsdom
// A seção "Configuração de e-mails" deve pedir SÓ e-mail remetente e senha de app.
// Host, porta e TLS saíram da tela (são fixos no backend).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SecaoConfiguracaoEmail } from './SecaoConfiguracaoEmail';

const config = {
  recuperacaoSenhaAtiva: true,
  fluxoTccAtivo: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpSecure: false,
  smtpUsuario: 'coordenacaodee@ufpe.br',
  smtpRemetente: 'coordenacaodee@ufpe.br',
  temSenha: true,
};

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock('../../api', () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPut: (...a: unknown[]) => apiPut(...a),
}));

async function montar(cfg: Record<string, unknown> = config) {
  apiGet.mockResolvedValue(cfg);
  apiPut.mockResolvedValue(cfg);
  render(<SecaoConfiguracaoEmail />);
  await screen.findByText('Conta que envia os e-mails');
}

// O <label> da senha embrulha também a legenda de ajuda, então o nome acessível é
// "Senha de app" + o texto da legenda — daí o matcher por trecho.
const campoSenha = () => screen.getByLabelText(/Senha de app/);

beforeEach(() => {
  apiGet.mockReset();
  apiPut.mockReset();
});

describe('Campos visíveis', () => {
  it('mostra apenas e-mail remetente e senha de app', async () => {
    await montar();
    expect(screen.getByLabelText('E-mail remetente')).toBeInTheDocument();
    expect(campoSenha()).toBeInTheDocument();
  });

  it('NÃO mostra servidor (host), porta nem conexão segura (TLS/SSL)', async () => {
    await montar();
    expect(screen.queryByLabelText('Servidor (host)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Porta')).not.toBeInTheDocument();
    expect(screen.queryByText('Conexão segura (TLS/SSL)')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Conexão segura (TLS/SSL)' })).not.toBeInTheDocument();
    // Nem o valor do host aparece em algum canto da tela.
    expect(screen.queryByDisplayValue('smtp.gmail.com')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('587')).not.toBeInTheDocument();
  });

  it('mantém os dois interruptores globais', async () => {
    await montar();
    expect(screen.getByRole('switch', { name: 'Enviar e-mails de recuperação de senha' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enviar e-mails do fluxo do TCC' })).toBeInTheDocument();
  });

  it('avisa que a configuração é global e compartilhada', async () => {
    await montar();
    expect(screen.getByText(/global compartilhada entre os coordenadores/i)).toBeInTheDocument();
  });

  it('o botão salva a configuração', async () => {
    await montar();
    expect(screen.getByRole('button', { name: 'Salvar configuração' })).toBeInTheDocument();
  });
});

describe('Envio ao backend', () => {
  it('manda SÓ smtpUsuario e smtpSenha', async () => {
    await montar();
    fireEvent.change(screen.getByLabelText('E-mail remetente'), { target: { value: 'novo@ufpe.br' } });
    fireEvent.change(campoSenha(), { target: { value: 'senha-app-ficticia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar configuração' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const [rota, corpo] = apiPut.mock.calls[0];
    expect(rota).toBe('/email-config');
    expect(Object.keys(corpo as object).sort()).toEqual(['smtpSenha', 'smtpUsuario']);
    expect(corpo).not.toHaveProperty('smtpHost');
    expect(corpo).not.toHaveProperty('smtpPort');
    expect(corpo).not.toHaveProperty('smtpSecure');
    expect(corpo).not.toHaveProperty('smtpRemetente');
  });
});

describe('Senha nunca reaparece', () => {
  it('o campo de senha começa vazio mesmo com senha salva', async () => {
    await montar();
    expect(campoSenha()).toHaveValue('');
    expect(campoSenha()).toHaveAttribute('placeholder', expect.stringContaining('manter'));
  });

  it('após salvar, o campo de senha é limpo de novo', async () => {
    await montar();
    fireEvent.change(campoSenha(), { target: { value: 'senha-app-ficticia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar configuração' }));

    await waitFor(() => expect(campoSenha()).toHaveValue(''));
  });

  it('sem senha salva, o placeholder orienta a usar senha de app do Google', async () => {
    await montar({ ...config, temSenha: false });
    expect(campoSenha()).toHaveAttribute('placeholder', 'Senha de app do Google');
  });
});
