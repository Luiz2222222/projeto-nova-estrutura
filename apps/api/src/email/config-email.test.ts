// Configuração global de e-mail: a tela só escolhe e-mail remetente + senha de app.
// Host/porta/TLS/remetente são fixos no backend e não podem ser escolhidos por quem chama a API.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';

vi.mock('nodemailer', () => ({ createTransport: vi.fn(() => ({ sendMail: vi.fn() })) }));

// Linha única "global" com estado mutável, como no banco real.
function fakePrisma(inicial: Record<string, unknown> = {}) {
  const linha: Record<string, unknown> = {
    id: 'global',
    recuperacaoSenhaAtiva: true,
    fluxoTccAtivo: true,
    smtpHost: null,
    smtpPort: null,
    smtpSecure: false,
    smtpUsuario: null,
    smtpRemetente: null,
    smtpSenhaCriptografada: null,
    ...inicial,
  };
  const p: any = {
    configuracaoEmail: {
      findUnique: vi.fn(async () => ({ ...linha })),
      create: vi.fn(async () => ({ ...linha })),
      update: vi.fn(async ({ data }: any) => {
        Object.assign(linha, data);
        return { ...linha };
      }),
    },
  };
  return { p, linha };
}

const servicoCom = (p: any) => new EmailService(p);
const SENHA_APP = 'senha-de-app-ficticia';
const dadosUpdate = (p: any) => p.configuracaoEmail.update.mock.calls[0][0].data;

beforeEach(() => vi.mocked(nodemailer.createTransport).mockClear());

describe('Valores fixos do Google Workspace', () => {
  it('salva smtp.gmail.com / 587 / secure=false e remetente igual ao e-mail', async () => {
    const { p } = fakePrisma();
    await servicoCom(p).atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', smtpSenha: SENHA_APP });

    const data = dadosUpdate(p);
    expect(data.smtpHost).toBe('smtp.gmail.com');
    expect(data.smtpPort).toBe(587);
    expect(data.smtpSecure).toBe(false);
    expect(data.smtpUsuario).toBe('coordenacaodee@ufpe.br');
    expect(data.smtpRemetente).toBe('coordenacaodee@ufpe.br');
  });

  it('host, porta, TLS e remetente enviados pelo cliente são IGNORADOS', async () => {
    const { p } = fakePrisma();
    await servicoCom(p).atualizarConfig({
      smtpUsuario: 'coordenacaodee@ufpe.br',
      smtpSenha: SENHA_APP,
      // tentativa de escolher servidor/remetente na mão:
      smtpHost: 'smtp.servidor-do-atacante.com',
      smtpPort: 25,
      smtpSecure: true,
      smtpRemetente: 'outro@dominio.com',
    });

    const data = dadosUpdate(p);
    expect(data.smtpHost).toBe('smtp.gmail.com');
    expect(data.smtpPort).toBe(587);
    expect(data.smtpSecure).toBe(false);
    expect(data.smtpRemetente).toBe('coordenacaodee@ufpe.br');
  });

  it('o transporter usa porta 587 com STARTTLS obrigatório (requireTLS)', async () => {
    const { p } = fakePrisma({
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUsuario: 'coordenacaodee@ufpe.br',
    });
    await (servicoCom(p) as any).obterTransporter();

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true }),
    );
  });
});

describe('Regras da senha de app', () => {
  it('primeiro cadastro sem senha é rejeitado e nada é gravado', async () => {
    const { p } = fakePrisma();
    await expect(
      servicoCom(p).atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', smtpSenha: '' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(p.configuracaoEmail.update).not.toHaveBeenCalled();
  });

  it('trocar o e-mail sem informar nova senha é rejeitado', async () => {
    const { p } = fakePrisma({ smtpUsuario: 'antigo@ufpe.br', smtpSenhaCriptografada: 'cripto-antiga' });
    await expect(
      servicoCom(p).atualizarConfig({ smtpUsuario: 'novo@ufpe.br', smtpSenha: '' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(p.configuracaoEmail.update).not.toHaveBeenCalled();
  });

  it('trocar o e-mail COM nova senha grava os dois', async () => {
    const { p } = fakePrisma({ smtpUsuario: 'antigo@ufpe.br', smtpSenhaCriptografada: 'cripto-antiga' });
    await servicoCom(p).atualizarConfig({ smtpUsuario: 'novo@ufpe.br', smtpSenha: SENHA_APP });

    const data = dadosUpdate(p);
    expect(data.smtpUsuario).toBe('novo@ufpe.br');
    expect(data.smtpSenhaCriptografada).toBeTypeOf('string');
    expect(data.smtpSenhaCriptografada).not.toBe('cripto-antiga');
  });

  it('mesmo e-mail com senha vazia PRESERVA a senha já salva', async () => {
    const { p, linha } = fakePrisma({ smtpUsuario: 'igual@ufpe.br', smtpSenhaCriptografada: 'cripto-existente' });
    await servicoCom(p).atualizarConfig({ smtpUsuario: 'igual@ufpe.br', smtpSenha: '' });

    expect(dadosUpdate(p)).not.toHaveProperty('smtpSenhaCriptografada');
    expect(linha.smtpSenhaCriptografada).toBe('cripto-existente');
  });

  it('a senha é gravada criptografada (nunca em texto puro)', async () => {
    const { p, linha } = fakePrisma();
    await servicoCom(p).atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', smtpSenha: SENHA_APP });
    expect(linha.smtpSenhaCriptografada).not.toBe(SENHA_APP);
    expect(String(linha.smtpSenhaCriptografada).split(':')).toHaveLength(3); // iv:tag:dados
  });

  it('e-mail inválido é rejeitado', async () => {
    const { p } = fakePrisma();
    await expect(
      servicoCom(p).atualizarConfig({ smtpUsuario: 'sem-arroba', smtpSenha: SENHA_APP }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('e-mail em branco desliga a configuração e zera a senha', async () => {
    const { p } = fakePrisma({ smtpUsuario: 'antigo@ufpe.br', smtpSenhaCriptografada: 'cripto-antiga' });
    await servicoCom(p).atualizarConfig({ smtpUsuario: '' });

    const data = dadosUpdate(p);
    expect(data.smtpUsuario).toBeNull();
    expect(data.smtpHost).toBeNull();
    expect(data.smtpSenhaCriptografada).toBeNull();
  });
});

describe('Resposta ao frontend e escopo global', () => {
  it('nunca devolve a senha (nem criptografada); só informa que existe', async () => {
    const { p } = fakePrisma();
    const resposta: any = await servicoCom(p).atualizarConfig({
      smtpUsuario: 'coordenacaodee@ufpe.br',
      smtpSenha: SENHA_APP,
    });

    expect(resposta).not.toHaveProperty('smtpSenha');
    expect(resposta).not.toHaveProperty('smtpSenhaCriptografada');
    expect(JSON.stringify(resposta)).not.toContain(SENHA_APP);
    expect(resposta.temSenha).toBe(true);
  });

  it('a configuração é global: sempre a linha única "global", sem id de usuário', async () => {
    const { p } = fakePrisma();
    const servico = servicoCom(p);
    await servico.atualizarConfig({ smtpUsuario: 'coordenacaodee@ufpe.br', smtpSenha: SENHA_APP });

    expect(p.configuracaoEmail.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'global' } }));
    // Outro coordenador lendo depois enxerga exatamente a mesma configuração.
    const lidoPorOutro: any = await servico.obterConfigSegura();
    expect(lidoPorOutro.smtpUsuario).toBe('coordenacaodee@ufpe.br');
    expect(lidoPorOutro.temSenha).toBe(true);
  });

  it('os dois interruptores globais continuam funcionando', async () => {
    const { p } = fakePrisma();
    await servicoCom(p).atualizarConfig({ recuperacaoSenhaAtiva: false, fluxoTccAtivo: false });

    const data = dadosUpdate(p);
    expect(data.recuperacaoSenhaAtiva).toBe(false);
    expect(data.fluxoTccAtivo).toBe(false);
    // Sem mexer na conta remetente.
    expect(data).not.toHaveProperty('smtpUsuario');
  });
});
