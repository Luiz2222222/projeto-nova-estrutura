import { describe, it, expect, vi } from 'vitest';
import { AutenticacaoService } from './autenticacao.service';

// bcrypt.hash é lento; mockamos para o teste focar na lógica de consumo do token.
vi.mock('bcryptjs', () => ({ hash: vi.fn().mockResolvedValue('hash-fake'), compare: vi.fn() }));

function fakePrisma() {
  const p: any = {
    tokenSenha: { findUnique: vi.fn(), updateMany: vi.fn() },
    usuario: { update: vi.fn().mockResolvedValue({}) },
  };
  p.$transaction = (fn: any) => fn(p);
  return p;
}

const servicoCom = (p: any) => new AutenticacaoService(p as any, {} as any, {} as any);
const tokenValido = () => ({ id: 'tk', usuarioId: 'u', usadoEm: null, expiraEm: new Date(Date.now() + 3600_000) });

describe('Item 7 — token de recuperação: consumo atômico e uso único', () => {
  it('consome o token e troca a senha quando a reserva casa 1 linha', async () => {
    const p = fakePrisma();
    p.tokenSenha.findUnique.mockResolvedValue(tokenValido());
    p.tokenSenha.updateMany.mockResolvedValue({ count: 1 });
    const servico = servicoCom(p);
    await expect(servico.redefinirSenha('token123', 'novaSenha1', 'novaSenha1')).resolves.toBeUndefined();
    expect(p.tokenSenha.updateMany).toHaveBeenCalled();
    expect(p.usuario.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ versaoToken: { increment: 1 } }) }));
  });

  it('requisição concorrente perde a corrida (0 linhas reservadas) → 400 e NÃO troca a senha', async () => {
    const p = fakePrisma();
    // Pré-leitura vê o token ainda válido, mas a reserva atômica já foi vencida por outra requisição.
    p.tokenSenha.findUnique.mockResolvedValue(tokenValido());
    p.tokenSenha.updateMany.mockResolvedValue({ count: 0 });
    const servico = servicoCom(p);
    await expect(servico.redefinirSenha('token123', 'novaSenha1', 'novaSenha1')).rejects.toMatchObject({ status: 400 });
    expect(p.usuario.update).not.toHaveBeenCalled();
  });

  it('token já utilizado → 400 (mensagem de já usado, sem tentar reservar)', async () => {
    const p = fakePrisma();
    p.tokenSenha.findUnique.mockResolvedValue({ ...tokenValido(), usadoEm: new Date() });
    const servico = servicoCom(p);
    await expect(servico.redefinirSenha('token123', 'novaSenha1', 'novaSenha1')).rejects.toMatchObject({ status: 400 });
    expect(p.tokenSenha.updateMany).not.toHaveBeenCalled();
    expect(p.usuario.update).not.toHaveBeenCalled();
  });

  it('token expirado → 400', async () => {
    const p = fakePrisma();
    p.tokenSenha.findUnique.mockResolvedValue({ ...tokenValido(), expiraEm: new Date(Date.now() - 1000) });
    const servico = servicoCom(p);
    await expect(servico.redefinirSenha('token123', 'novaSenha1', 'novaSenha1')).rejects.toMatchObject({ status: 400 });
    expect(p.usuario.update).not.toHaveBeenCalled();
  });
});
