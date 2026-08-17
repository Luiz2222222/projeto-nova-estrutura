// @vitest-environment jsdom
// Depois de pedir a recuperação, a tela tinha DOIS controles levando ao login: o botão
// "Voltar ao login" e o link "Lembrou a senha? Entrar". Sobra um caminho só por estado.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

const apiPost = vi.fn();
vi.mock('../api', () => ({ apiPost: (...a: unknown[]) => apiPost(...a), mensagemErro: (_e: any, p: string) => p }));

const navegar = vi.fn();
vi.mock('react-router-dom', async () => {
  const real = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...real, useNavigate: () => navegar };
});

vi.mock('../componentes/LogoDee', () => ({ LogoDee: () => null }));

import { RecuperarSenha } from './RecuperarSenha';

function abrir() {
  return render(
    <MemoryRouter>
      <RecuperarSenha />
    </MemoryRouter>,
  );
}

// Todo controle que leva de volta ao login, em qualquer estado da tela.
const caminhosDeVolta = () =>
  screen.queryAllByRole('button').filter((b) => /voltar ao login|entrar/i.test(b.textContent ?? ''));

async function pedirRecuperacao() {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'fulano@exemplo.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
  await screen.findByText(/enviamos um link para redefinir a senha/i);
}

beforeEach(() => {
  apiPost.mockReset().mockResolvedValue({ ok: true });
  navegar.mockReset();
});

describe('Depois de solicitar a recuperação', () => {
  it('há UM único caminho de volta ao login', async () => {
    abrir();
    await pedirRecuperacao();

    expect(caminhosDeVolta()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Voltar ao login' })).toBeInTheDocument();
  });

  it('o link redundante "Lembrou a senha? Entrar" não aparece', async () => {
    abrir();
    await pedirRecuperacao();

    expect(screen.queryByText(/lembrou a senha/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Entrar' })).toBeNull();
  });

  // O defeito relatado era exatamente este: os DOIS visíveis ao mesmo tempo.
  it('os dois controles NUNCA coexistem no estado pós-envio', async () => {
    const { container } = abrir();
    await pedirRecuperacao();

    const temBotaoGrande = !!screen.queryByRole('button', { name: 'Voltar ao login' });
    const temLink = !!screen.queryByRole('button', { name: 'Entrar' });

    expect(temBotaoGrande && temLink).toBe(false);
    expect(temBotaoGrande).toBe(true);
    // Nem escondido no DOM: o rodapé some de verdade, não fica só invisível.
    expect(container.innerHTML).not.toContain('Lembrou a senha');
    expect(container.querySelectorAll('.link-inline')).toHaveLength(0);
  });

  it('a mensagem verde aparece junto do botão', async () => {
    abrir();
    await pedirRecuperacao();

    expect(screen.getByText(/enviamos um link para redefinir a senha/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar ao login' })).toBeInTheDocument();
  });

  it('o botão leva para /login', async () => {
    abrir();
    await pedirRecuperacao();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao login' }));

    expect(navegar).toHaveBeenCalledWith('/login');
  });
});

describe('Antes de solicitar (formulário à mostra)', () => {
  it('tem só o link menor — o botão grande não existe neste estado', () => {
    abrir();

    expect(caminhosDeVolta()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByText(/lembrou a senha/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar ao login' })).toBeNull();
  });

  it('o formulário continua à mostra', () => {
    abrir();

    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar link' })).toBeInTheDocument();
  });

  it('a mensagem de segurança e o prazo de 1 hora continuam iguais', async () => {
    abrir();
    await pedirRecuperacao();

    expect(
      screen.getByText('Se houver uma conta com esse e-mail, enviamos um link para redefinir a senha. O link vale por 1 hora.'),
    ).toBeInTheDocument();
  });

  it('o envio continua chamando o mesmo endpoint', async () => {
    abrir();
    await pedirRecuperacao();

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost.mock.calls[0][0]).toBe('/autenticacao/recuperar-senha');
  });
});
