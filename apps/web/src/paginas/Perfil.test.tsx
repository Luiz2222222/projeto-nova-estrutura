// @vitest-environment jsdom
// Card "Criar coordenador" em "Meu perfil": só aparece para COORDENADOR e envia
// exatamente os campos do formulário (sem `papel`, sem código de cadastro).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Papel, UsuarioPublico } from '@tcc/compartilhado';
import { Perfil } from './Perfil';

const apiPost = vi.fn().mockResolvedValue({});
const apiPut = vi.fn().mockResolvedValue({});
vi.mock('../api', () => ({
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPut: (...a: unknown[]) => apiPut(...a),
}));

let usuarioAtual: UsuarioPublico | null = null;
vi.mock('../autenticacao/contexto', () => ({ useAuth: () => ({ usuario: usuarioAtual }) }));

function usuario(papel: Papel): UsuarioPublico {
  return {
    id: 'u1',
    nomeCompleto: 'Fulano de Tal',
    email: 'fulano@exemplo.com',
    papel,
    curso: null,
    tratamento: null,
    afiliacao: null,
    disponivelParaOrientar: false,
  };
}

function montar(papel: Papel) {
  usuarioAtual = usuario(papel);
  render(<Perfil />);
  const titulo = screen.queryByRole('heading', { name: 'Criar coordenador' });
  return titulo?.closest('section') ?? null;
}

beforeEach(() => {
  apiPost.mockClear();
  apiPut.mockClear();
});

describe('Visibilidade do card', () => {
  it('COORDENADOR vê o card "Criar coordenador"', () => {
    expect(montar('COORDENADOR')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Criar coordenador' })).toBeInTheDocument();
  });

  it.each<Papel>(['ALUNO', 'PROFESSOR', 'AVALIADOR'])('%s NÃO vê o card', (papel) => {
    expect(montar(papel)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Criar coordenador' })).not.toBeInTheDocument();
    // O card de troca de senha continua lá para todo mundo.
    expect(screen.getByRole('button', { name: 'Alterar senha' })).toBeInTheDocument();
  });

  it('fica logo abaixo do card "Alterar senha"', () => {
    const card = montar('COORDENADOR')!;
    const anterior = card.previousElementSibling;
    expect(anterior).not.toBeNull();
    expect(within(anterior as HTMLElement).getByRole('heading', { name: 'Alterar senha' })).toBeInTheDocument();
  });
});

describe('Envio do formulário', () => {
  function preencher(card: HTMLElement, senha = 'senhaForte1', confirmar = 'senhaForte1') {
    fireEvent.change(within(card).getByLabelText('Nome completo'), { target: { value: 'Maria Coordenadora' } });
    fireEvent.change(within(card).getByLabelText('E-mail'), { target: { value: 'maria@exemplo.com' } });
    fireEvent.change(within(card).getByLabelText('Senha'), { target: { value: senha } });
    fireEvent.change(within(card).getByLabelText('Confirmar senha'), { target: { value: confirmar } });
  }

  it('envia só nome, e-mail e senha para a rota protegida', async () => {
    const card = montar('COORDENADOR')!;
    preencher(card);
    fireEvent.click(within(card).getByRole('button', { name: 'Criar coordenador' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith('/autenticacao/coordenadores', {
      nomeCompleto: 'Maria Coordenadora',
      email: 'maria@exemplo.com',
      senha: 'senhaForte1',
    });
    // Nada de papel/código indo no corpo.
    expect(apiPost.mock.calls[0][1]).not.toHaveProperty('papel');
    expect(apiPost.mock.calls[0][1]).not.toHaveProperty('codigo');
  });

  it('em caso de sucesso mostra confirmação e limpa as senhas', async () => {
    const card = montar('COORDENADOR')!;
    preencher(card);
    fireEvent.click(within(card).getByRole('button', { name: 'Criar coordenador' }));

    await waitFor(() => expect(within(card).getByText(/criado com sucesso/i)).toBeInTheDocument());
    expect(within(card).getByLabelText('Senha')).toHaveValue('');
    expect(within(card).getByLabelText('Confirmar senha')).toHaveValue('');
  });

  it('senhas diferentes: erro na tela e nenhuma chamada à API', async () => {
    const card = montar('COORDENADOR')!;
    preencher(card, 'senhaForte1', 'outraSenha2');
    fireEvent.click(within(card).getByRole('button', { name: 'Criar coordenador' }));

    expect(await within(card).findByText('As senhas não coincidem')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('e-mail duplicado: mostra a mensagem da API no campo', async () => {
    apiPost.mockRejectedValueOnce({
      status: 400,
      mensagem: 'E-mail já cadastrado',
      erros: [{ campo: 'email', mensagem: 'Este e-mail já está em uso' }],
    });
    const card = montar('COORDENADOR')!;
    preencher(card);
    fireEvent.click(within(card).getByRole('button', { name: 'Criar coordenador' }));

    expect(await within(card).findByText('Este e-mail já está em uso')).toBeInTheDocument();
    // Senhas não ficam paradas na tela nem depois de erro.
    expect(within(card).getByLabelText('Senha')).toHaveValue('');
  });
});
