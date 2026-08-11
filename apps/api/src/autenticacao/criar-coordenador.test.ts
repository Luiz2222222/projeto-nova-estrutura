// Criação de coordenador por outro coordenador (card em "Meu perfil").
// Cobre as três camadas: schema (não aceita `papel`), service (papel fixo + e-mail único +
// hash) e os guards da rota (401 sem sessão, 403 para os demais papéis).
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AutenticacaoService } from './autenticacao.service';
import { AutenticacaoController } from './autenticacao.controller';
import { GuardaJwt } from './guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { esquemaCriarCoordenador } from '@tcc/compartilhado';

function fakePrisma() {
  return {
    usuario: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'novo-id', ...data })),
    },
  } as any;
}

const servicoCom = (p: any) => new AutenticacaoService(p, {} as any, {} as any);

const dadosValidos = {
  nomeCompleto: 'Maria Coordenadora',
  email: 'Maria.Coord@Exemplo.COM',
  senha: 'senhaForte1',
};

// Contexto de execução falso apontando para o handler REAL da rota, para os guards lerem
// os metadados verdadeiros (@Papeis) em vez de uma cópia.
function contextoDaRota(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => AutenticacaoController.prototype.criarCoordenador,
    getClass: () => AutenticacaoController,
  } as any;
}

describe('Schema dedicado: não aceita elevação de privilégio pelo corpo', () => {
  it('descarta `papel` enviado no corpo', () => {
    const saida = esquemaCriarCoordenador.parse({ ...dadosValidos, papel: 'ALUNO' } as any);
    expect(saida).not.toHaveProperty('papel');
    expect(Object.keys(saida).sort()).toEqual(['email', 'nomeCompleto', 'senha']);
  });

  it('descarta `codigo` de cadastro (esta rota não usa código)', () => {
    const saida = esquemaCriarCoordenador.parse({ ...dadosValidos, codigo: 'ABC123' } as any);
    expect(saida).not.toHaveProperty('codigo');
  });

  it('rejeita nome incompleto, e-mail inválido e senha curta', () => {
    expect(esquemaCriarCoordenador.safeParse({ ...dadosValidos, nomeCompleto: 'Maria' }).success).toBe(false);
    expect(esquemaCriarCoordenador.safeParse({ ...dadosValidos, email: 'sem-arroba' }).success).toBe(false);
    expect(esquemaCriarCoordenador.safeParse({ ...dadosValidos, senha: '12345' }).success).toBe(false);
  });
});

describe('Service: criarCoordenador', () => {
  it('cria com papel COORDENADOR fixado no backend e e-mail em minúsculas', async () => {
    const p = fakePrisma();
    const criado = await servicoCom(p).criarCoordenador(esquemaCriarCoordenador.parse(dadosValidos));

    const data = p.usuario.create.mock.calls[0][0].data;
    expect(data.papel).toBe('COORDENADOR');
    expect(data.email).toBe('maria.coord@exemplo.com');
    expect(criado.papel).toBe('COORDENADOR');
  });

  it('grava a senha só como hash bcrypt (nunca em texto puro)', async () => {
    const p = fakePrisma();
    await servicoCom(p).criarCoordenador(esquemaCriarCoordenador.parse(dadosValidos));

    const data = p.usuario.create.mock.calls[0][0].data;
    expect(data.senhaHash).not.toBe(dadosValidos.senha);
    expect(data.senhaHash.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare(dadosValidos.senha, data.senhaHash)).toBe(true);
  });

  it('não devolve senha nem hash na resposta', async () => {
    const p = fakePrisma();
    const criado = await servicoCom(p).criarCoordenador(esquemaCriarCoordenador.parse(dadosValidos));
    expect(criado).not.toHaveProperty('senha');
    expect(criado).not.toHaveProperty('senhaHash');
  });

  it('rejeita e-mail já existente (400) e não cria nada', async () => {
    const p = fakePrisma();
    p.usuario.findUnique.mockResolvedValue({ id: 'ja-existe' });
    await expect(
      servicoCom(p).criarCoordenador(esquemaCriarCoordenador.parse(dadosValidos)),
    ).rejects.toMatchObject({ status: 400 });
    expect(p.usuario.create).not.toHaveBeenCalled();
  });

  it('a conta criada consegue autenticar normalmente', async () => {
    const p = fakePrisma();
    const servico = servicoCom(p);
    await servico.criarCoordenador(esquemaCriarCoordenador.parse(dadosValidos));
    const salvo = p.usuario.create.mock.calls[0][0].data;

    // Login: o service busca por e-mail minúsculo e compara com o hash gravado.
    p.usuario.findUnique.mockResolvedValue({ ...salvo, id: 'novo-id' });
    const autenticado = await servico.validarCredenciais({
      email: 'MARIA.COORD@exemplo.com',
      senha: dadosValidos.senha,
      manterLogin: false,
    });
    expect(autenticado.id).toBe('novo-id');
    expect(autenticado.papel).toBe('COORDENADOR');

    await expect(
      servico.validarCredenciais({ email: dadosValidos.email, senha: 'senhaErrada', manterLogin: false }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('Rota POST /autenticacao/coordenadores: quem pode chamar', () => {
  const guardaPapeis = () => new GuardaPapeis(new Reflector());

  it('COORDENADOR autenticado passa', () => {
    expect(guardaPapeis().canActivate(contextoDaRota({ usuario: { papel: 'COORDENADOR' } }))).toBe(true);
  });

  it.each(['ALUNO', 'PROFESSOR', 'AVALIADOR'])('%s recebe 403', (papel) => {
    expect(() => guardaPapeis().canActivate(contextoDaRota({ usuario: { papel } }))).toThrow(ForbiddenException);
  });

  it('sem sessão (nenhum cookie) recebe 401 no GuardaJwt', async () => {
    const guarda = new GuardaJwt({} as any, {} as any);
    await expect(guarda.canActivate(contextoDaRota({ cookies: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token de ALUNO não vira coordenador: o papel vem do banco e o 403 acontece', async () => {
    // Mesmo que o token diga COORDENADOR, o GuardaJwt sobrescreve com o papel do banco.
    const jwt = { verify: vi.fn().mockReturnValue({ sub: 'u1', papel: 'COORDENADOR', v: 0 }) } as any;
    const prisma = {
      usuario: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', papel: 'ALUNO', versaoToken: 0 }) },
    } as any;
    const req: any = { cookies: { token: 'tok' } };

    await new GuardaJwt(jwt, prisma).canActivate(contextoDaRota(req));
    expect(req.usuario.papel).toBe('ALUNO');
    expect(() => guardaPapeis().canActivate(contextoDaRota(req))).toThrow(ForbiddenException);
  });
});
