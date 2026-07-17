// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

// Mock do contexto de autenticação: os guards leem useAuth(); aqui controlamos o
// usuário logado por teste (sem rede, sem Provedor real).
const estado: { usuario: { papel: string } | null; carregando: boolean } = { usuario: null, carregando: false };
vi.mock('./autenticacao/contexto', () => ({
  useAuth: () => ({ usuario: estado.usuario, carregando: estado.carregando }),
  ProvedorAuth: ({ children }: { children: unknown }) => children,
}));

import { ExigePapel, Protegido } from './App';

function renderComGuardaPapel(papel: string | null) {
  estado.usuario = papel ? { papel } : null;
  estado.carregando = false;
  return render(
    <MemoryRouter initialEntries={['/aluno']}>
      <Routes>
        <Route element={<ExigePapel papeis={['ALUNO']} />}>
          <Route path="/aluno" element={<p>conteúdo do aluno</p>} />
        </Route>
        <Route path="/" element={<p>home neutra</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ExigePapel (guard de papel)', () => {
  it('papel correto vê o conteúdo da rota', () => {
    renderComGuardaPapel('ALUNO');
    expect(screen.getByText('conteúdo do aluno')).toBeInTheDocument();
  });

  it('papel errado é redirecionado para a home (não vê o conteúdo)', () => {
    renderComGuardaPapel('PROFESSOR');
    expect(screen.queryByText('conteúdo do aluno')).toBeNull();
    expect(screen.getByText('home neutra')).toBeInTheDocument();
  });
});

describe('Protegido (guard de sessão)', () => {
  function renderProtegido() {
    return render(
      <MemoryRouter initialEntries={['/privada']}>
        <Routes>
          <Route path="/privada" element={<Protegido><p>área privada</p></Protegido>} />
          <Route path="/login" element={<p>tela de login</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('sem usuário logado redireciona para /login', () => {
    estado.usuario = null;
    estado.carregando = false;
    renderProtegido();
    expect(screen.queryByText('área privada')).toBeNull();
    expect(screen.getByText('tela de login')).toBeInTheDocument();
  });

  it('com sessão carregando mostra o estado de carregamento', () => {
    estado.usuario = null;
    estado.carregando = true;
    renderProtegido();
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
  });

  it('logado vê a área privada', () => {
    estado.usuario = { papel: 'ALUNO' };
    estado.carregando = false;
    renderProtegido();
    expect(screen.getByText('área privada')).toBeInTheDocument();
  });
});
