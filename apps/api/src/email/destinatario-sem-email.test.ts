// O campo `email` do usuário também é o LOGIN, então existe conta de acesso interno com
// valor que não é endereço (a coordenação de produção usa "adm"). Mandar isso ao nodemailer
// rendia "No recipients defined" a cada evento — erro barulhento para algo que nunca teria
// como dar certo. Agora sai calado, e a notificação interna continua sendo criada.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailService, emailValido } from './email.service';
import { EventosTccService } from '../eventos-tcc/eventos-tcc.service';

// Tipado com o parâmetro para o tsc aceitar `sendMail.mock.calls[0][0]` (mock sem
// argumentos vira tupla vazia).
const sendMail = vi.hoisted(() => vi.fn(async (opcoes: Record<string, unknown>) => ({ opcoes })));
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail }),
}));

function prismaFalso(usuarios: any[] = []) {
  return {
    configuracaoEmail: {
      findUnique: vi.fn(async () => ({
        id: 'global',
        fluxoTccAtivo: true,
        recuperacaoSenhaAtiva: true,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        smtpUsuario: 'coordenacao@exemplo.com',
        smtpSenhaCriptografada: null,
        smtpRemetente: 'coordenacao@exemplo.com',
      })),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    preferenciaEmail: { findUnique: vi.fn(async () => null) },
    usuario: {
      findMany: vi.fn(async () => usuarios),
      findUnique: vi.fn(async ({ where }: any) => usuarios.find((u) => u.id === where.id) ?? null),
    },
  } as any;
}

beforeEach(() => {
  sendMail.mockClear();
  process.env.EMAIL_CRYPTO_SEGREDO = 'segredo-de-teste-para-email-1234';
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_USER = 'coordenacao@exemplo.com';
  process.env.SMTP_PASS = 'senha-ficticia';
});

describe('emailValido', () => {
  it('aceita endereço de verdade', () => {
    for (const e of ['a@b.com', 'coordenacao.dee@ufpe.br', 'nome+tag@sub.dominio.edu']) {
      expect(emailValido(e)).toBe(true);
    }
  });

  it('recusa login que não é endereço', () => {
    for (const e of ['adm', '', '   ', null, undefined, 'adm@', '@dominio.com', 'a b@c.com', 'sem-arroba.com', 'a@b']) {
      expect(emailValido(e)).toBe(false);
    }
  });
});

describe('enviarEvento com destinatário sem e-mail utilizável', () => {
  it('não chama o SMTP para um login como "adm"', async () => {
    const servico = new EmailService(prismaFalso());

    await servico.enviarEvento('coord_nova_solicitacao', { id: 'u1', email: 'adm', nomeCompleto: 'Coordenação' }, 'Assunto', 'Texto');

    expect(sendMail).not.toHaveBeenCalled();
  });

  it('não chama o SMTP quando o e-mail é nulo', async () => {
    const servico = new EmailService(prismaFalso());

    await servico.enviarEvento('coord_nova_solicitacao', { id: 'u1', email: null, nomeCompleto: 'Coordenação' }, 'Assunto', 'Texto');

    expect(sendMail).not.toHaveBeenCalled();
  });

  it('não registra erro (sai calado)', async () => {
    const servico = new EmailService(prismaFalso());
    const erro = vi.spyOn((servico as any).logger, 'error');

    await servico.enviarEvento('coord_nova_solicitacao', { id: 'u1', email: 'adm', nomeCompleto: 'Coordenação' }, 'Assunto', 'Texto');

    expect(erro).not.toHaveBeenCalled();
  });

  it('destinatário com e-mail de verdade continua recebendo', async () => {
    const servico = new EmailService(prismaFalso());

    await servico.enviarEvento('coord_nova_solicitacao', { id: 'u1', email: 'prof@ufpe.br', nomeCompleto: 'Prof' }, 'Assunto', 'Texto');

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: 'prof@ufpe.br' });
  });
});

describe('O evento continua chegando pela notificação interna', () => {
  const notificacoes = { criar: vi.fn(async () => ({})) } as any;

  beforeEach(() => notificacoes.criar.mockClear());

  it('coordenador "adm": sem SMTP, mas COM notificação interna', async () => {
    const prisma = prismaFalso([{ id: 'coord-1', email: 'adm', nomeCompleto: 'Coordenação' }]);
    const eventos = new EventosTccService(prisma, new EmailService(prisma), notificacoes);

    await eventos.emitirParaCoordenadores('coord_nova_solicitacao', 'Nova solicitação', 'Mensagem', '/x');

    expect(sendMail).not.toHaveBeenCalled();
    expect(notificacoes.criar).toHaveBeenCalledTimes(1);
    expect(notificacoes.criar).toHaveBeenCalledWith('coord-1', 'coord_nova_solicitacao', 'Nova solicitação', 'Mensagem', '/x');
  });

  it('usuário "adm": sem SMTP, mas COM notificação interna', async () => {
    const prisma = prismaFalso([{ id: 'u1', email: 'adm', nomeCompleto: 'Coordenação' }]);
    const eventos = new EventosTccService(prisma, new EmailService(prisma), notificacoes);

    await eventos.emitirParaUsuario('coord_nova_solicitacao', 'u1', 'Título', 'Mensagem');

    expect(sendMail).not.toHaveBeenCalled();
    expect(notificacoes.criar).toHaveBeenCalledTimes(1);
  });

  it('numa lista mista, só quem tem endereço válido recebe e-mail — todos recebem notificação', async () => {
    const prisma = prismaFalso([
      { id: 'coord-1', email: 'adm', nomeCompleto: 'Coordenação' },
      { id: 'coord-2', email: 'coord2@ufpe.br', nomeCompleto: 'Coordenação Dois' },
    ]);
    const eventos = new EventosTccService(prisma, new EmailService(prisma), notificacoes);

    await eventos.emitirParaCoordenadores('coord_nova_solicitacao', 'Nova solicitação', 'Mensagem');

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: 'coord2@ufpe.br' });
    expect(notificacoes.criar).toHaveBeenCalledTimes(2);
  });
});
