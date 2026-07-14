import { describe, it, expect } from 'vitest';
import { urlLattesValida, esquemaLogin, esquemaAbrirTcc } from './index';

describe('Item 10 — validação da URL do Lattes', () => {
  it('aceita vazio/ausente (campo opcional)', () => {
    expect(urlLattesValida('')).toBe(true);
    expect(urlLattesValida('   ')).toBe(true);
    expect(urlLattesValida(null)).toBe(true);
    expect(urlLattesValida(undefined)).toBe(true);
  });

  it('aceita URL https do domínio oficial do Lattes', () => {
    expect(urlLattesValida('https://lattes.cnpq.br/1234567890123456')).toBe(true);
    expect(urlLattesValida('https://buscatextual.lattes.cnpq.br/xyz')).toBe(true);
  });

  it('rejeita http, javascript:, data: e URLs malformadas', () => {
    expect(urlLattesValida('http://lattes.cnpq.br/123')).toBe(false); // sem HTTPS
    expect(urlLattesValida('javascript:alert(1)')).toBe(false);
    expect(urlLattesValida('data:text/html,<script>')).toBe(false);
    expect(urlLattesValida('não é url')).toBe(false);
    expect(urlLattesValida('https://exemplo.com/lattes')).toBe(false); // fora do domínio oficial
  });

  it('esquemaAbrirTcc rejeita coorientador externo com Lattes inválido', () => {
    const r = esquemaAbrirTcc.safeParse({
      titulo: 'Meu TCC',
      orientadorId: 'o1',
      coorientadorNome: 'Fulano',
      coorientadorTitulacao: 'Doutor',
      coorientadorAfiliacao: 'UFPE',
      coorientadorLattes: 'http://site-falso/lattes',
    });
    expect(r.success).toBe(false);
  });
});

describe('Item 11 — login por e-mail (sem "usuário")', () => {
  it('a mensagem do campo não menciona mais "usuário"', () => {
    const r = esquemaLogin.safeParse({ email: '', senha: '' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === 'email')?.message ?? '';
      expect(msg.toLowerCase()).toContain('e-mail');
      expect(msg.toLowerCase()).not.toContain('usuário');
    }
  });
});
