// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ComboAvaliador } from './ComboAvaliador';
import type { UsuarioResumo } from '../tipos';

const CANDIDATOS: UsuarioResumo[] = [
  { id: 'c1', nomeCompleto: 'Cárlos Orientador', tratamento: 'Prof. Dr.' },
  { id: 'c2', nomeCompleto: 'Maria Silva', tratamento: 'Prof. Dr.' },
  { id: 'c3', nomeCompleto: 'José Souza' },
];
const rotuloDe = (c: UsuarioResumo) => `${c.tratamento ? c.tratamento + ' ' : ''}${c.nomeCompleto}`;

function montar(props: Partial<Parameters<typeof ComboAvaliador>[0]> = {}) {
  const aoEscolher = vi.fn();
  const utils = render(
    <ComboAvaliador rotulo="Avaliador 1" valor="" candidatos={CANDIDATOS} rotuloDe={rotuloDe} aoEscolher={aoEscolher} {...props} />,
  );
  const input = screen.getByRole('combobox', { name: 'Avaliador 1' }) as HTMLInputElement;
  return { ...utils, input, aoEscolher };
}

describe('ComboAvaliador (interação)', () => {
  it('FormTrocar: id já selecionado ANTES de os candidatos chegarem → nome aparece quando a lista carrega', () => {
    const aoEscolher = vi.fn();
    const { rerender } = render(
      <ComboAvaliador rotulo="Avaliador 1" valor="c2" candidatos={[]} rotuloDe={rotuloDe} aoEscolher={aoEscolher} />,
    );
    const input = screen.getByRole('combobox', { name: 'Avaliador 1' }) as HTMLInputElement;
    expect(input.value).toBe(''); // lista ainda não chegou
    rerender(
      <ComboAvaliador rotulo="Avaliador 1" valor="c2" candidatos={CANDIDATOS} rotuloDe={rotuloDe} aoEscolher={aoEscolher} />,
    );
    expect(input.value).toBe('Prof. Dr. Maria Silva'); // sincronizou sozinho
  });

  it('abrir um campo já selecionado mostra a lista COMPLETA de elegíveis, não só o selecionado', () => {
    const { input } = montar({ valor: 'c2' });
    fireEvent.focus(input);
    const opcoes = screen.getAllByRole('option');
    expect(opcoes).toHaveLength(3); // todos, não apenas Maria
  });

  it('digitar filtra sem acento/caixa e NÃO seleciona nem desfaz seleção', () => {
    const { input, aoEscolher } = montar({ valor: 'c2' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'carlos' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /Cárlos/ })).toBeInTheDocument();
    expect(aoEscolher).not.toHaveBeenCalled(); // digitar não escolhe nem limpa
  });

  it('digitar e clicar fora sem confirmar restaura o nome da seleção anterior', () => {
    const { input, aoEscolher } = montar({ valor: 'c2' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'jos' } });
    fireEvent.mouseDown(document.body); // clique fora = cancelar
    expect(input.value).toBe('Prof. Dr. Maria Silva'); // nada de campo vazio/texto solto
    expect(aoEscolher).not.toHaveBeenCalled(); // seleção anterior intacta
  });

  it('Escape também cancela e restaura', () => {
    const { input } = montar({ valor: 'c1' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'maria' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('Prof. Dr. Cárlos Orientador');
  });

  it('escolher uma opção confirma a troca e o campo acompanha o novo valor (controlado)', () => {
    const aoEscolher = vi.fn();
    const { rerender } = render(
      <ComboAvaliador rotulo="Avaliador 1" valor="c2" candidatos={CANDIDATOS} rotuloDe={rotuloDe} aoEscolher={aoEscolher} />,
    );
    const input = screen.getByRole('combobox', { name: 'Avaliador 1' }) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'jose' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'José Souza' }));
    expect(aoEscolher).toHaveBeenCalledWith('c3');
    // O pai (controlado) confirma a troca — o campo mostra o novo nome, sem resíduo.
    rerender(
      <ComboAvaliador rotulo="Avaliador 1" valor="c3" candidatos={CANDIDATOS} rotuloDe={rotuloDe} aoEscolher={aoEscolher} />,
    );
    expect(input.value).toBe('José Souza');
  });

  it('a pessoa do outro campo (excluirId) não aparece na lista', () => {
    const { input } = montar({ valor: '', excluirId: 'c3' });
    fireEvent.focus(input);
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.queryByRole('option', { name: 'José Souza' })).toBeNull();
  });
});
