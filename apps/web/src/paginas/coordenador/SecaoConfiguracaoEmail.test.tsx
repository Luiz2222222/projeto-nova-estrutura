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
const apiPost = vi.fn();
vi.mock('../../api', () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPut: (...a: unknown[]) => apiPut(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
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
  apiPost.mockReset();
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

const MASCARA = '••••••••••••';
const salvar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar configuração' }));
const corpoEnviado = () => apiPut.mock.calls[0][1] as Record<string, unknown>;

describe('Campo mascarado: manter, substituir ou remover', () => {
  it('com senha salva, o campo aparece mascarado (nunca vazio)', async () => {
    await montar();
    expect(campoSenha()).toHaveValue(MASCARA);
  });

  it('sem senha salva, o campo fica realmente vazio', async () => {
    await montar({ ...config, temSenha: false });
    expect(campoSenha()).toHaveValue('');
  });

  it('não tocar no campo = MANTER, e a máscara NÃO é enviada', async () => {
    await montar();
    fireEvent.change(screen.getByLabelText('E-mail remetente'), { target: { value: 'novo@ufpe.br' } });
    salvar();

    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const corpo = corpoEnviado();
    expect(corpo).toEqual({ smtpUsuario: 'novo@ufpe.br', acaoSenha: 'MANTER' });
    expect(corpo).not.toHaveProperty('smtpSenha');
    expect(JSON.stringify(corpo)).not.toContain('•');
  });

  // Focar NÃO pode esvaziar o campo: se esvaziasse, apertar Delete não geraria onChange e
  // o pedido de remoção se perderia (virava MANTER). A máscara fica e é selecionada.
  it('focar mantém a máscara no campo (selecionada), não esvazia', async () => {
    await montar();
    fireEvent.focus(campoSenha());
    expect(campoSenha()).toHaveValue(MASCARA);
  });

  it('só focar e sair (sem alterar) volta a máscara e mantém a senha', async () => {
    await montar();
    fireEvent.focus(campoSenha());
    fireEvent.blur(campoSenha());
    expect(campoSenha()).toHaveValue(MASCARA);

    salvar();
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(corpoEnviado().acaoSenha).toBe('MANTER');
  });

  // O caminho natural do usuário: clicar no campo e apagar, SEM digitar nada antes.
  it('focar + Delete + salvar = REMOVER', async () => {
    await montar();
    const campo = campoSenha();
    fireEvent.focus(campo);
    fireEvent.keyDown(campo, { key: 'Delete' });
    fireEvent.change(campo, { target: { value: '' } }); // apagou a máscara selecionada
    salvar();

    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(corpoEnviado()).toEqual({ smtpUsuario: 'coordenacaodee@ufpe.br', acaoSenha: 'REMOVER' });
  });

  it('focar + Backspace + salvar = REMOVER', async () => {
    await montar();
    const campo = campoSenha();
    fireEvent.focus(campo);
    fireEvent.keyDown(campo, { key: 'Backspace' });
    fireEvent.change(campo, { target: { value: '' } });
    salvar();

    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(corpoEnviado().acaoSenha).toBe('REMOVER');
  });

  it('focar + Ctrl+A + Delete + salvar = REMOVER', async () => {
    await montar();
    const campo = campoSenha();
    fireEvent.focus(campo);
    fireEvent.keyDown(campo, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(campo, { key: 'Delete' });
    fireEvent.change(campo, { target: { value: '' } });
    salvar();

    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(corpoEnviado().acaoSenha).toBe('REMOVER');
  });

  it('mesmo alterando, a máscara em si nunca vira senha', async () => {
    await montar();
    const campo = campoSenha();
    fireEvent.focus(campo);
    // Situação limite: o valor volta a ser exatamente a máscara.
    fireEvent.change(campo, { target: { value: MASCARA } });
    salvar();

    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(corpoEnviado().acaoSenha).toBe('MANTER');
    expect(corpoEnviado()).not.toHaveProperty('smtpSenha');
  });

  it('digitar uma senha nova envia SUBSTITUIR com a senha', async () => {
    await montar();
    fireEvent.focus(campoSenha());
    fireEvent.change(campoSenha(), { target: { value: 'senha-app-ficticia' } });
    salvar();

    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(corpoEnviado()).toEqual({
      smtpUsuario: 'coordenacaodee@ufpe.br',
      acaoSenha: 'SUBSTITUIR',
      smtpSenha: 'senha-app-ficticia',
    });
  });

  it('apagar o conteúdo e salvar envia REMOVER, sem senha', async () => {
    await montar();
    fireEvent.focus(campoSenha());
    fireEvent.change(campoSenha(), { target: { value: 'algo' } });
    fireEvent.change(campoSenha(), { target: { value: '' } }); // apagou de propósito
    salvar();

    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(corpoEnviado()).toEqual({ smtpUsuario: 'coordenacaodee@ufpe.br', acaoSenha: 'REMOVER' });
    expect(corpoEnviado()).not.toHaveProperty('smtpSenha');
  });

  it('depois de salvar, o campo volta a ficar mascarado — não vazio', async () => {
    await montar();
    fireEvent.focus(campoSenha());
    fireEvent.change(campoSenha(), { target: { value: 'senha-app-ficticia' } });
    salvar();

    await waitFor(() => expect(campoSenha()).toHaveValue(MASCARA));
  });

  it('após remover, a resposta sem senha deixa o campo vazio', async () => {
    await montar();
    apiPut.mockResolvedValue({ ...config, temSenha: false }); // backend confirmou a remoção
    fireEvent.focus(campoSenha());
    fireEvent.change(campoSenha(), { target: { value: 'x' } });
    fireEvent.change(campoSenha(), { target: { value: '' } });
    salvar();

    await waitFor(() => expect(campoSenha()).toHaveValue(''));
    expect(screen.queryByRole('button', { name: /Mostrar senha/i })).not.toBeInTheDocument();
  });

  it('nunca envia host, porta, TLS ou remetente', async () => {
    await montar();
    salvar();
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const corpo = corpoEnviado();
    for (const proibido of ['smtpHost', 'smtpPort', 'smtpSecure', 'smtpRemetente']) {
      expect(corpo).not.toHaveProperty(proibido);
    }
  });
});

describe('Revelar a senha de app pelo olho (sem modal)', () => {
  it('clicar no olho mostra a senha no próprio campo, sem pedir nada', async () => {
    apiPost.mockResolvedValue({ senha: 'senha-ficticia-de-teste' });
    await montar();

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha de app' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/email-config/revelar-senha', {}));
    expect(await screen.findByDisplayValue('senha-ficticia-de-teste')).toBeInTheDocument();
    expect(campoSenha()).toHaveAttribute('type', 'text');
    // Nada de modal nem de senha do coordenador.
    expect(screen.queryByLabelText('Sua senha')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('clicar de novo oculta e volta para a máscara', async () => {
    apiPost.mockResolvedValue({ senha: 'senha-ficticia-de-teste' });
    await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha de app' }));
    await screen.findByDisplayValue('senha-ficticia-de-teste');

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha de app' }));

    expect(campoSenha()).toHaveValue(MASCARA);
    expect(campoSenha()).toHaveAttribute('type', 'password');
  });

  it('o corpo do pedido não leva senha do coordenador', async () => {
    apiPost.mockResolvedValue({ senha: 'x' });
    await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha de app' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][1]).toEqual({});
  });

  it('sem senha salva, não há olho', async () => {
    await montar({ ...config, temSenha: false });
    expect(screen.queryByRole('button', { name: /senha de app/i })).not.toBeInTheDocument();
  });

  it('focar para editar descarta a senha revelada', async () => {
    apiPost.mockResolvedValue({ senha: 'senha-ficticia-de-teste' });
    await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha de app' }));
    await screen.findByDisplayValue('senha-ficticia-de-teste');

    fireEvent.focus(campoSenha());

    expect(screen.queryByDisplayValue('senha-ficticia-de-teste')).not.toBeInTheDocument();
    expect(campoSenha()).toHaveValue(MASCARA);
  });
});


describe('Senha nunca reaparece', () => {
  it('a senha REAL nunca aparece no campo — só a máscara', async () => {
    await montar();
    expect(campoSenha()).toHaveValue(MASCARA);
    // A máscara é enfeite: o GET não trouxe senha nenhuma para preencher isso.
    expect(apiGet.mock.results[0]).toBeDefined();
    expect(JSON.stringify(config)).not.toContain('smtpSenha');
  });

  it('o campo mascarado orienta como trocar ou remover', async () => {
    await montar();
    expect(campoSenha()).toHaveAttribute('placeholder', 'Digite a nova senha ou apague para remover');
  });

  it('sem senha salva, o placeholder orienta a usar senha de app do Google', async () => {
    await montar({ ...config, temSenha: false });
    expect(campoSenha()).toHaveAttribute('placeholder', 'Senha de app do Google');
  });
});
