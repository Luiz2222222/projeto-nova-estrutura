// @vitest-environment jsdom
// Campo "Código de cadastro" só existe quando a coordenação configurou um código para o
// perfil escolhido. Sem código configurado, a pessoa se cadastra sem ele.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const cadastrar = vi.fn(async () => {});
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

beforeEach(() => {
  cadastrar.mockClear();
  apiGet.mockReset();
  // Só professor e avaliador estão protegidos por código nesta configuração.
  apiGet.mockResolvedValue({ ALUNO: false, PROFESSOR: true, AVALIADOR: true });
});

describe('Perfil SEM código configurado', () => {
  it('não mostra o campo de código', async () => {
    abrir();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/autenticacao/codigos-exigidos'));
    escolher('Aluno');

    expect(screen.queryByLabelText('Código de cadastro')).toBeNull();
  });

  it('cadastra sem código', async () => {
    abrir();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    escolher('Aluno');

    preencher('Nome completo', 'Fulano de Tal');
    preencher('E-mail', 'fulano@exemplo.com');
    preencher('Curso', 'ENGENHARIA_ELETRICA');
    preencher('Senha', 'senha123');
    preencher('Confirmar senha', 'senha123');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(cadastrar).toHaveBeenCalled());
    expect(cadastrar.mock.calls[0][0]).toMatchObject({ papel: 'ALUNO', email: 'fulano@exemplo.com' });
  });
});

describe('Perfil COM código configurado', () => {
  it('mostra o campo e continua exigindo o código', async () => {
    abrir();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    escolher('Professor');

    expect(screen.getByLabelText('Código de cadastro')).toBeInTheDocument();

    preencher('Nome completo', 'Prof Um');
    preencher('E-mail', 'prof@exemplo.com');
    preencher('Titulação', 'Dr.');
    preencher('Senha', 'senha123');
    preencher('Confirmar senha', 'senha123');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(await screen.findByText('Informe o código de cadastro')).toBeInTheDocument();
    expect(cadastrar).not.toHaveBeenCalled();
  });
});

describe('Sem resposta da rota de códigos', () => {
  it('mantém o campo visível (o backend continua decidindo)', async () => {
    apiGet.mockRejectedValue(new Error('offline'));
    abrir();
    escolher('Aluno');

    expect(await screen.findByLabelText('Código de cadastro')).toBeInTheDocument();
  });
});
