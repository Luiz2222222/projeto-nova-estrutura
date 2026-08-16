// @vitest-environment jsdom
// O campo "Código de cadastro" aparece SEMPRE. O que muda conforme a configuração da
// coordenação é ser obrigatório ou opcional — e quem decide de verdade é o backend.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

let enviado: Record<string, unknown> | null = null;
const cadastrar = vi.fn(async (dados: Record<string, unknown>) => {
  enviado = dados;
});
vi.mock('../autenticacao/contexto', () => ({ useAuth: () => ({ cadastrar }) }));

const apiGet = vi.fn();
vi.mock('../api', () => ({ apiGet: (...a: unknown[]) => apiGet(...a) }));

import { ModalCadastro } from './ModalCadastro';

function abrir() {
  return render(<ModalCadastro aoFechar={() => {}} aoSucesso={() => {}} />);
}

// Passo 1 do modal é escolher a categoria; o formulário só aparece depois.
function escolher(papel: string) {
  fireEvent.click(screen.getByText(papel));
}

const preencher = (rotulo: string | RegExp, valor: string) =>
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });

// A dica ("Opcional: …") e a mensagem de erro moram dentro do <label>, como nos demais
// campos do formulário — então o nome acessível cresce e a busca precisa ser por trecho.
const CODIGO = /Código de cadastro/;
const campoCodigo = () => screen.getByLabelText(CODIGO);

beforeEach(() => {
  enviado = null;
  cadastrar.mockClear();
  apiGet.mockReset();
  // Só professor e avaliador estão protegidos por código nesta configuração.
  apiGet.mockResolvedValue({ ALUNO: false, PROFESSOR: true, AVALIADOR: true });
});

// Preenche tudo menos o código (que cada teste decide se informa).
function preencherAluno() {
  preencher('Nome completo', 'Fulano de Tal');
  preencher('E-mail', 'fulano@exemplo.com');
  preencher('Curso', 'ENGENHARIA_ELETRICA');
  preencher('Senha', 'senha123');
  preencher('Confirmar senha', 'senha123');
}

describe('Perfil SEM código configurado', () => {
  it('o campo continua visível, marcado como opcional', async () => {
    abrir();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/autenticacao/codigos-exigidos'));
    escolher('Aluno');

    const campo = campoCodigo();
    expect(campo).toBeInTheDocument();
    expect(campo).toHaveAttribute('aria-required', 'false'); // sem cara de obrigatório
    expect(screen.getByText('Opcional: não há código exigido para este perfil.')).toBeInTheDocument();
  });

  it('cadastra com o campo vazio, sem erro', async () => {
    abrir();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    escolher('Aluno');
    preencherAluno();

    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrar).toHaveBeenCalled());
    expect(enviado).toMatchObject({ papel: 'ALUNO', email: 'fulano@exemplo.com' });
    expect(screen.queryByText('Informe o código de cadastro')).toBeNull();
  });

  it('se a pessoa digitar algo mesmo assim, o valor vai junto', async () => {
    abrir();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    escolher('Aluno');
    preencherAluno();
    preencher(CODIGO, 'codigo-antigo');

    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrar).toHaveBeenCalled());
    expect(enviado).toMatchObject({ codigo: 'codigo-antigo' });
  });

  // O backend é a fonte da verdade: se a coordenação criar um código com o modal aberto,
  // a recusa precisa aparecer no campo — que já está lá.
  it('erro de código vindo do backend aparece no campo', async () => {
    cadastrar.mockRejectedValueOnce({
      mensagem: 'Código de cadastro inválido',
      erros: [{ campo: 'codigo', mensagem: 'Código incorreto para este tipo de usuário' }],
    });
    abrir();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    escolher('Aluno');
    preencherAluno();

    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(await screen.findByText('Código incorreto para este tipo de usuário')).toBeInTheDocument();
    // E o campo passa a se apresentar como obrigatório daí em diante.
    expect(campoCodigo()).toHaveAttribute('aria-required', 'true');
    expect(screen.queryByText('Opcional: não há código exigido para este perfil.')).toBeNull();
  });
});

describe('Perfil COM código configurado', () => {
  it('mostra o campo e continua exigindo o código', async () => {
    abrir();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    escolher('Professor');

    const campo = campoCodigo();
    expect(campo).toBeInTheDocument();
    expect(campo).toHaveAttribute('aria-required', 'true');
    expect(screen.queryByText('Opcional: não há código exigido para este perfil.')).toBeNull();

    preencher('Nome completo', 'Prof Um');
    preencher('E-mail', 'prof@exemplo.com');
    preencher('Titulação', 'Dr.');
    preencher('Senha', 'senha123');
    preencher('Confirmar senha', 'senha123');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(await screen.findByText('Informe o código de cadastro')).toBeInTheDocument();
    expect(cadastrar).not.toHaveBeenCalled();
  });

  it('com o código certo, cadastra normalmente', async () => {
    abrir();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    escolher('Professor');

    preencher('Nome completo', 'Prof Um');
    preencher('E-mail', 'prof@exemplo.com');
    preencher('Titulação', 'Dr.');
    preencher(CODIGO, 'prof-2026');
    preencher('Senha', 'senha123');
    preencher('Confirmar senha', 'senha123');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrar).toHaveBeenCalled());
    expect(enviado).toMatchObject({ papel: 'PROFESSOR', codigo: 'prof-2026' });
  });
});

// A tela não pode inventar uma exigência que o servidor não tem: sem saber, trata como
// opcional e deixa o backend recusar se realmente houver código configurado.
describe('Sem resposta da rota de códigos', () => {
  it('a consulta falhou: campo visível e opcional', async () => {
    apiGet.mockRejectedValue(new Error('offline'));
    abrir();
    escolher('Aluno');

    const campo = await screen.findByLabelText(CODIGO);
    expect(campo).toBeInTheDocument();
    expect(campo).toHaveAttribute('aria-required', 'false');
    expect(screen.getByText('Opcional: não há código exigido para este perfil.')).toBeInTheDocument();
  });

  it('a consulta falhou: dá para cadastrar sem código (o backend é quem barra)', async () => {
    apiGet.mockRejectedValue(new Error('offline'));
    abrir();
    escolher('Aluno');
    preencherAluno();

    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrar).toHaveBeenCalled());
    expect(screen.queryByText('Informe o código de cadastro')).toBeNull();
  });

  it('ainda carregando: campo visível e opcional, sem travar o formulário', async () => {
    apiGet.mockReturnValue(new Promise(() => {})); // nunca resolve
    abrir();
    escolher('Aluno');

    expect(screen.getByLabelText(CODIGO)).toHaveAttribute('aria-required', 'false');

    preencherAluno();
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrar).toHaveBeenCalled());
  });

  // Mesmo sem a consulta, o backend continua protegendo o que tem código.
  it('a consulta falhou, mas havia código: o erro do backend aparece e o campo vira obrigatório', async () => {
    apiGet.mockRejectedValue(new Error('offline'));
    cadastrar.mockRejectedValueOnce({
      mensagem: 'Código de cadastro inválido',
      erros: [{ campo: 'codigo', mensagem: 'Código incorreto para este tipo de usuário' }],
    });
    abrir();
    escolher('Aluno');
    preencherAluno();

    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(await screen.findByText('Código incorreto para este tipo de usuário')).toBeInTheDocument();
    expect(campoCodigo()).toHaveAttribute('aria-required', 'true');
  });
});
