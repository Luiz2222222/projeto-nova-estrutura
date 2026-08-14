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

describe('Revelar a senha de app (reautenticada)', () => {
  // Uma entrada só: o olho do campo. Nada de botão textual duplicado embaixo.
  it('não existe botão textual "Mostrar senha de app" (só o olho)', async () => {
    await montar();
    expect(screen.queryByRole('button', { name: 'Mostrar senha de app' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mostrar senha de app salva' })).toBeInTheDocument();
  });

  it('com o campo vazio, o olho abre o modal seguro em vez de revelar direto', async () => {
    await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha de app salva' }));

    expect(await screen.findByLabelText('Sua senha')).toBeInTheDocument();
    // O formulário principal continua vazio: a senha salva nunca é preenchida ali.
    expect(campoSenha()).toHaveValue('');
  });

  it('digitando, o MESMO olho vira mostrar/ocultar local', async () => {
    await montar();
    fireEvent.change(campoSenha(), { target: { value: 'nova' } });

    const olho = screen.getByRole('button', { name: 'Mostrar senha digitada' });
    fireEvent.click(olho);
    expect(campoSenha()).toHaveAttribute('type', 'text'); // mostrou o que foi digitado
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha digitada' }));
    expect(campoSenha()).toHaveAttribute('type', 'password');
    // E não abriu modal nenhum.
    expect(screen.queryByLabelText('Sua senha')).not.toBeInTheDocument();
  });

  it('sem senha salva e campo vazio, não há olho nenhum', async () => {
    await montar({ ...config, temSenha: false });
    expect(screen.queryByRole('button', { name: /Mostrar senha/i })).not.toBeInTheDocument();
  });

  it('o campo de senha bloqueia autopreenchimento do navegador', async () => {
    await montar();
    expect(campoSenha()).toHaveAttribute('autocomplete', 'new-password');
  });

  it('o modal exige senha do coordenador E confirmação antes de revelar', async () => {
    await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha de app salva' }));

    const revelar = await screen.findByRole('button', { name: 'Mostrar senha' });
    expect(revelar).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'minha-senha' } });
    expect(revelar).toBeDisabled(); // falta a confirmação explícita

    fireEvent.click(screen.getByRole('checkbox'));
    expect(revelar).toBeEnabled();
  });

  it('revela pela rota protegida e limpa tudo ao fechar', async () => {
    apiPost.mockResolvedValue({ senha: 'senha-ficticia-de-teste' });
    await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha de app salva' }));
    fireEvent.change(await screen.findByLabelText('Sua senha'), { target: { value: 'minha-senha' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/email-config/revelar-senha', { senha: 'minha-senha' }),
    );
    expect(await screen.findByDisplayValue('senha-ficticia-de-teste')).toBeInTheDocument();

    // O Modal já tem seu próprio "Fechar" (X); o do rodapé é o último.
    const fechar = screen.getAllByRole('button', { name: 'Fechar' });
    fireEvent.click(fechar[fechar.length - 1]);
    await waitFor(() => expect(screen.queryByDisplayValue('senha-ficticia-de-teste')).not.toBeInTheDocument());
  });

  it('senha do coordenador errada mostra o erro e não revela', async () => {
    apiPost.mockRejectedValue({ status: 400, mensagem: 'Senha incorreta.' });
    await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha de app salva' }));
    fireEvent.change(await screen.findByLabelText('Sua senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));

    expect(await screen.findByText('Senha incorreta.')).toBeInTheDocument();
  });
});

describe('Senha nunca reaparece', () => {
  it('o campo de senha começa vazio mesmo com senha salva', async () => {
    await montar();
    expect(campoSenha()).toHaveValue('');
    expect(campoSenha()).toHaveAttribute('placeholder', 'Digite uma nova senha para substituir');
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
