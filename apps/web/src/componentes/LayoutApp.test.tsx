// @vitest-environment jsdom
// Existe UM "Histórico" só. O antigo "Histórico arquivado" deixou de ser item de menu:
// período encerrado aparece dentro do mesmo Histórico.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

const usuarioAtual: { papel: string; nomeCompleto: string } = { papel: 'COORDENADOR', nomeCompleto: 'Fulano de Tal' };
vi.mock('../autenticacao/contexto', () => ({
  useAuth: () => ({ usuario: usuarioAtual, sair: vi.fn() }),
}));
vi.mock('./Sino', () => ({ Sino: () => null }));
// A logo depende do ProvedorTema, que não faz parte do que está sendo testado aqui.
vi.mock('./LogoDee', () => ({ LogoDee: () => null }));

import { LayoutApp } from './LayoutApp';

function abrirMenuDoUsuario(papel: string) {
  usuarioAtual.papel = papel;
  render(
    <MemoryRouter>
      <LayoutApp />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Fulano de Tal/ }));
}

beforeEach(() => {
  usuarioAtual.papel = 'COORDENADOR';
});

describe('Menu do usuário', () => {
  for (const papel of ['COORDENADOR', 'PROFESSOR']) {
    it(`${papel}: um único item "Histórico", sem "Histórico arquivado"`, () => {
      abrirMenuDoUsuario(papel);

      expect(screen.getAllByRole('menuitem', { name: /Histórico/ })).toHaveLength(1);
      expect(screen.queryByRole('menuitem', { name: /arquivad/i })).not.toBeInTheDocument();
    });
  }

  it('aluno e avaliador não têm item de Histórico', () => {
    abrirMenuDoUsuario('ALUNO');

    expect(screen.queryByRole('menuitem', { name: /Histórico/ })).not.toBeInTheDocument();
  });
});

describe('Menu lateral', () => {
  it('não traz "Histórico arquivado" para nenhum papel', () => {
    for (const papel of ['COORDENADOR', 'PROFESSOR', 'ALUNO', 'AVALIADOR']) {
      usuarioAtual.papel = papel;
      const { container, unmount } = render(
        <MemoryRouter>
          <LayoutApp />
        </MemoryRouter>,
      );
      const links = [...container.querySelectorAll('.lateral-nav a')].map((a) => a.textContent ?? '');
      expect(links.filter((t) => /arquivad/i.test(t))).toEqual([]);
      unmount();
    }
  });
});
