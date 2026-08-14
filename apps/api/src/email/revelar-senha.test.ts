// Revelação da senha de app: só sai depois de reautenticar, nunca no GET normal, sem cache.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';

vi.mock('bcryptjs', () => ({
  compare: vi.fn(async (a: string) => a === 'senha-do-coordenador'),
  hash: vi.fn(async () => 'hash-fake'),
}));

// Valor fictício — jamais uma senha real.
const SENHA_APP = 'abcd efgh ijkl mnop';

function prismaFalso(over: Record<string, any> = {}) {
  const linha: Record<string, any> = {
    id: 'global',
    recuperacaoSenhaAtiva: true,
    fluxoTccAtivo: true,
    smtpUsuario: 'coordenacaodee@ufpe.br',
    smtpSenhaCriptografada: null,
    ...over,
  };
  return {
    _linha: linha,
    usuario: { findUnique: vi.fn(async () => ({ id: 'c1', senhaHash: 'hash' })) },
    configuracaoEmail: {
      findUnique: vi.fn(async () => ({ ...linha })),
      create: vi.fn(async () => ({ ...linha })),
      update: vi.fn(async ({ data }: any) => {
        Object.assign(linha, data);
        return { ...linha };
      }),
    },
  } as any;
}

function resFalso() {
  return {
    headers: {} as Record<string, string>,
    corpo: null as any,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    json(c: any) {
      this.corpo = c;
    },
  };
}

const req = { usuario: { sub: 'c1' } } as any;

beforeEach(() => {
  process.env.EMAIL_CRYPTO_SEGREDO = 'segredo-de-teste-para-email-1234';
});

describe('POST /email-config/revelar-senha', () => {
  async function comSenhaSalva() {
    const p = prismaFalso();
    const servico = new EmailService(p);
    // Grava uma senha fictícia pelo caminho normal (fica criptografada).
    await servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', smtpSenha: SENHA_APP });
    return { p, servico, controller: new EmailController(p, servico) };
  }

  it('senha do coordenador correta revela a senha de app', async () => {
    const { controller } = await comSenhaSalva();
    const res = resFalso();

    await controller.revelarSenha(req, { senha: 'senha-do-coordenador' }, res as any);

    expect(res.corpo).toEqual({ senha: SENHA_APP });
  });

  it('senha do coordenador incorreta é recusada (400) e não revela nada', async () => {
    const { controller } = await comSenhaSalva();
    const res = resFalso();

    await expect(controller.revelarSenha(req, { senha: 'errada' }, res as any)).rejects.toMatchObject({ status: 400 });
    expect(res.corpo).toBeNull();
  });

  it('sem senha informada é recusado', async () => {
    const { controller } = await comSenhaSalva();
    const res = resFalso();
    await expect(controller.revelarSenha(req, {}, res as any)).rejects.toMatchObject({ status: 400 });
    expect(res.corpo).toBeNull();
  });

  it('responde com Cache-Control no-store', async () => {
    const { controller } = await comSenhaSalva();
    const res = resFalso();

    await controller.revelarSenha(req, { senha: 'senha-do-coordenador' }, res as any);

    expect(res.headers['Cache-Control']).toMatch(/no-store/);
    expect(res.headers['Pragma']).toBe('no-cache');
  });

  it('sem senha salva, informa em vez de revelar vazio', async () => {
    const p = prismaFalso();
    const servico = new EmailService(p);
    const controller = new EmailController(p, servico);
    const res = resFalso();

    await expect(controller.revelarSenha(req, { senha: 'senha-do-coordenador' }, res as any)).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('O GET normal continua sem a senha', () => {
  it('obterConfigSegura não devolve a senha nem a versão criptografada', async () => {
    const p = prismaFalso();
    const servico = new EmailService(p);
    await servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', smtpSenha: SENHA_APP });

    const seguro: any = await servico.obterConfigSegura();

    expect(seguro).not.toHaveProperty('smtpSenha');
    expect(seguro).not.toHaveProperty('smtpSenhaCriptografada');
    expect(JSON.stringify(seguro)).not.toContain(SENHA_APP);
    expect(seguro.temSenha).toBe(true); // só informa que existe
  });

  it('a senha fica criptografada no banco, nunca em texto puro', async () => {
    const p = prismaFalso();
    const servico = new EmailService(p);
    await servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', smtpSenha: SENHA_APP });

    expect(p._linha.smtpSenhaCriptografada).not.toBe(SENHA_APP);
    expect(String(p._linha.smtpSenhaCriptografada).split(':')).toHaveLength(3); // iv:tag:dados
  });

  it('salvar com senha vazia mantém a senha atual (config global compartilhada)', async () => {
    const p = prismaFalso();
    const servico = new EmailService(p);
    await servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', smtpSenha: SENHA_APP });
    const cifradaAntes = p._linha.smtpSenhaCriptografada;

    await servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', smtpSenha: '' });

    expect(p._linha.smtpSenhaCriptografada).toBe(cifradaAntes);
    // E qualquer coordenador continua conseguindo revelar a MESMA senha global.
    await expect(servico.revelarSenhaApp()).resolves.toBe(SENHA_APP);
  });
});

// "Campo vazio" é ambíguo (não mexi x apaguei), então a ação vem EXPLÍCITA da tela.
describe('Ação explícita sobre a senha (MANTER / SUBSTITUIR / REMOVER)', () => {
  async function comSenha() {
    const p = prismaFalso();
    const servico = new EmailService(p);
    await servico.atualizarConfig({
      smtpUsuario: 'coordenacaodee@ufpe.br',
      acaoSenha: 'SUBSTITUIR',
      smtpSenha: SENHA_APP,
    });
    return { p, servico };
  }

  it('MANTER não toca na senha guardada', async () => {
    const { p, servico } = await comSenha();
    const antes = p._linha.smtpSenhaCriptografada;

    await servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', acaoSenha: 'MANTER' });

    expect(p._linha.smtpSenhaCriptografada).toBe(antes);
    expect((await servico.obterConfigSegura()).temSenha).toBe(true);
  });

  it('SUBSTITUIR troca a senha guardada', async () => {
    const { p, servico } = await comSenha();
    const antes = p._linha.smtpSenhaCriptografada;

    await servico.atualizarConfig({
      smtpUsuario: 'coordenacaodee@ufpe.br',
      acaoSenha: 'SUBSTITUIR',
      smtpSenha: 'outra-senha-ficticia',
    });

    expect(p._linha.smtpSenhaCriptografada).not.toBe(antes);
    await expect(servico.revelarSenhaApp()).resolves.toBe('outra-senha-ficticia');
  });

  it('SUBSTITUIR sem senha é recusado', async () => {
    const { servico } = await comSenha();
    await expect(
      servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', acaoSenha: 'SUBSTITUIR', smtpSenha: '' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('REMOVER apaga a senha e temSenha vira falso', async () => {
    const { p, servico } = await comSenha();

    const r: any = await servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', acaoSenha: 'REMOVER' });

    expect(p._linha.smtpSenhaCriptografada).toBeNull();
    expect(r.temSenha).toBe(false);
    // E não sobra nada para revelar.
    await expect(servico.revelarSenhaApp()).rejects.toMatchObject({ status: 400 });
  });

  it('REMOVER não exige senha nova nem reclama de "senha obrigatória"', async () => {
    const { servico } = await comSenha();
    await expect(
      servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', acaoSenha: 'REMOVER' }),
    ).resolves.toBeTruthy();
  });

  it('o e-mail e o SMTP fixo do Google continuam intactos após REMOVER', async () => {
    const { p, servico } = await comSenha();
    await servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', acaoSenha: 'REMOVER' });

    expect(p._linha.smtpUsuario).toBe('coordenacaodee@ufpe.br');
    expect(p._linha.smtpHost).toBe('smtp.gmail.com');
    expect(p._linha.smtpPort).toBe(587);
  });

  it('trocar o e-mail com MANTER continua exigindo a senha da nova conta', async () => {
    const { servico } = await comSenha();
    await expect(
      servico.atualizarConfig({ smtpUsuario: 'outro@ufpe.br', acaoSenha: 'MANTER' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  // O controller entrega o body cru, então a validação vive aqui.
  it('acaoSenha inválida devolve 400 — nunca é tratada como MANTER', async () => {
    const { p, servico } = await comSenha();
    const antes = p._linha.smtpSenhaCriptografada;
    p.configuracaoEmail.update.mockClear(); // ignora a gravação do preparo

    await expect(
      servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', acaoSenha: 'APAGAR' as any }),
    ).rejects.toMatchObject({ status: 400 });

    expect(p.configuracaoEmail.update).not.toHaveBeenCalled();
    expect(p._linha.smtpSenhaCriptografada).toBe(antes); // nada mudou
  });

  it('a mensagem do erro lista as ações aceitas', async () => {
    const { servico } = await comSenha();
    await expect(
      servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', acaoSenha: 'remover' as any }),
    ).rejects.toMatchObject({
      response: { mensagem: expect.stringMatching(/MANTER, SUBSTITUIR, REMOVER/) },
    });
  });

  it('acaoSenha ausente continua valendo como MANTER (compatibilidade)', async () => {
    const { p, servico } = await comSenha();
    const antes = p._linha.smtpSenhaCriptografada;

    await servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br' });

    expect(p._linha.smtpSenhaCriptografada).toBe(antes);
  });

  it('a máscara de pontos nunca chega ao banco como senha', async () => {
    const { p, servico } = await comSenha();
    // A tela manda MANTER e nenhum campo de senha — nada de "••••" virar segredo.
    await servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', acaoSenha: 'MANTER' });

    const cifrada = String(p._linha.smtpSenhaCriptografada);
    await expect(servico.revelarSenhaApp()).resolves.toBe(SENHA_APP);
    expect(cifrada).not.toContain('•');
  });
});
