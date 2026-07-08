import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CHAVES_EVENTO_EMAIL } from '@tcc/compartilhado';

type Destinatario = { id: string; email: string | null; nomeCompleto: string } | null | undefined;

const REMETENTE_PADRAO = 'Sistema de TCC <nao-responda@dee.local>';

// Escapa texto para interpolação segura no HTML do e-mail. Nome de usuário e título de TCC
// são controlados pelos próprios usuários — sem escape, um título com tags viraria HTML
// clicável (phishing) na caixa de entrada de coordenador/orientador/avaliador.
function escaparHtml(texto: string): string {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Camada de envio de e-mail + controle de envio (global e por usuário).
// SMTP vem do BANCO (configurado pela UID do coordenador) quando smtpHost está
// setado; senão cai no .env; sem nenhum dos dois, modo dev/console (só loga).
@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');

  constructor(private readonly prisma: PrismaService) {}

  // ---------- Criptografia da senha SMTP (AES-256-GCM; chave do .env) ----------

  private chaveCripto(): Buffer {
    const seg = process.env.EMAIL_CRYPTO_SEGREDO || process.env.JWT_SEGREDO || 'segredo-dev-email-tcc';
    return crypto.createHash('sha256').update(seg).digest(); // 32 bytes
  }

  private criptografar(texto: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.chaveCripto(), iv);
    const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  }

  private descriptografar(blob: string): string | undefined {
    try {
      const [ivB, tagB, dataB] = blob.split(':');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.chaveCripto(), Buffer.from(ivB, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
    } catch (e) {
      this.logger.error('Falha ao descriptografar a senha SMTP: ' + (e as Error).message);
      return undefined;
    }
  }

  // Monta o transporter: banco (se smtpHost) → .env → null (modo dev/console).
  private async obterTransporter(): Promise<{ transporter: nodemailer.Transporter | null; remetente: string }> {
    const cfg = await this.obterConfig();
    if (cfg.smtpHost) {
      const senha = cfg.smtpSenhaCriptografada ? this.descriptografar(cfg.smtpSenhaCriptografada) : undefined;
      const transporter = nodemailer.createTransport({
        host: cfg.smtpHost,
        port: cfg.smtpPort ?? 587,
        secure: !!cfg.smtpSecure,
        auth: cfg.smtpUsuario ? { user: cfg.smtpUsuario, pass: senha } : undefined,
      });
      return { transporter, remetente: cfg.smtpRemetente || cfg.smtpUsuario || REMETENTE_PADRAO };
    }
    const host = process.env.SMTP_HOST;
    if (host) {
      const transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
      return { transporter, remetente: process.env.SMTP_FROM || REMETENTE_PADRAO };
    }
    return { transporter: null, remetente: process.env.SMTP_FROM || REMETENTE_PADRAO };
  }

  private async enviar(para: string, assunto: string, html: string, texto: string): Promise<void> {
    const { transporter, remetente } = await this.obterTransporter();
    if (!transporter) {
      this.logger.log(
        `\n----- E-MAIL (modo dev, NÃO enviado) -----\nPara: ${para}\nAssunto: ${assunto}\n${texto}\n------------------------------------------`,
      );
      return;
    }
    await transporter.sendMail({ from: remetente, to: para, subject: assunto, text: texto, html });
  }

  // ---------- Configuração global (linha única) ----------

  // Uso interno (inclui a senha criptografada). NÃO devolver direto ao frontend.
  async obterConfig() {
    const existe = await this.prisma.configuracaoEmail.findUnique({ where: { id: 'global' } });
    return existe ?? this.prisma.configuracaoEmail.create({ data: { id: 'global' } });
  }

  // Versão SEGURA para o frontend: sem a senha; só indica se há senha salva.
  async obterConfigSegura() {
    const c = await this.obterConfig();
    return {
      recuperacaoSenhaAtiva: c.recuperacaoSenhaAtiva,
      fluxoTccAtivo: c.fluxoTccAtivo,
      smtpHost: c.smtpHost,
      smtpPort: c.smtpPort,
      smtpSecure: c.smtpSecure,
      smtpUsuario: c.smtpUsuario,
      smtpRemetente: c.smtpRemetente,
      temSenha: !!c.smtpSenhaCriptografada,
    };
  }

  async atualizarConfig(dados: {
    recuperacaoSenhaAtiva?: boolean;
    fluxoTccAtivo?: boolean;
    smtpHost?: string | null;
    smtpPort?: number | null;
    smtpSecure?: boolean;
    smtpUsuario?: string | null;
    smtpRemetente?: string | null;
    smtpSenha?: string; // texto puro do form; vazio/ausente = mantém a senha atual
  }) {
    await this.obterConfig(); // garante a linha
    const data: Record<string, unknown> = {};
    if (typeof dados.recuperacaoSenhaAtiva === 'boolean') data.recuperacaoSenhaAtiva = dados.recuperacaoSenhaAtiva;
    if (typeof dados.fluxoTccAtivo === 'boolean') data.fluxoTccAtivo = dados.fluxoTccAtivo;
    if (dados.smtpHost !== undefined) data.smtpHost = dados.smtpHost?.trim() || null;
    if (dados.smtpPort !== undefined) {
      const n = Number(dados.smtpPort);
      data.smtpPort = dados.smtpPort != null && Number.isFinite(n) ? n : null;
    }
    if (typeof dados.smtpSecure === 'boolean') data.smtpSecure = dados.smtpSecure;
    if (dados.smtpUsuario !== undefined) data.smtpUsuario = dados.smtpUsuario?.trim() || null;
    if (dados.smtpRemetente !== undefined) data.smtpRemetente = dados.smtpRemetente?.trim() || null;
    // Senha: só atualiza se vier preenchida; vazia/ausente → mantém a atual.
    if (typeof dados.smtpSenha === 'string' && dados.smtpSenha.length > 0) {
      data.smtpSenhaCriptografada = this.criptografar(dados.smtpSenha);
    }
    await this.prisma.configuracaoEmail.update({ where: { id: 'global' }, data });
    return this.obterConfigSegura();
  }

  // ---------- Preferências por usuário ----------

  // Devolve só as preferências SALVAS (o front trata ausência como "ligado").
  async obterPreferencias(usuarioId: string) {
    const rows = await this.prisma.preferenciaEmail.findMany({ where: { usuarioId } });
    return rows.map((r) => ({ evento: r.evento, ativo: r.ativo }));
  }

  async atualizarPreferencia(usuarioId: string, evento: string, ativo: boolean) {
    if (!CHAVES_EVENTO_EMAIL.includes(evento)) {
      throw new BadRequestException({ mensagem: 'Tipo de e-mail inválido.' });
    }
    await this.prisma.preferenciaEmail.upsert({
      where: { usuarioId_evento: { usuarioId, evento } },
      create: { usuarioId, evento, ativo: !!ativo },
      update: { ativo: !!ativo },
    });
    return { ok: true };
  }

  // ---------- Envio ----------

  // Recuperação de senha: categoria própria, gated SÓ pelo toggle global de
  // recuperação (não depende de preferência individual).
  async enviarRecuperacaoSenha(para: string, nome: string, link: string): Promise<void> {
    const config = await this.obterConfig();
    if (!config.recuperacaoSenhaAtiva) {
      this.logger.warn(`Recuperação de senha desativada por configuração — e-mail para ${para} NÃO enviado.`);
      return;
    }
    const assunto = 'Recuperação de senha — Sistema de TCC';
    const texto =
      `Olá, ${nome}.\n\n` +
      `Recebemos um pedido para redefinir sua senha. Acesse o link abaixo (válido por 1 hora):\n${link}\n\n` +
      `Se você não fez esse pedido, ignore este e-mail — sua senha continua a mesma.`;
    const html =
      `<p>Olá, ${escaparHtml(nome)}.</p>` +
      `<p>Recebemos um pedido para redefinir sua senha. Clique no link abaixo (válido por 1 hora):</p>` +
      `<p><a href="${escaparHtml(link)}">Redefinir minha senha</a></p>` +
      `<p>Se você não fez esse pedido, ignore este e-mail — sua senha continua a mesma.</p>`;
    await this.enviar(para, assunto, html, texto);
  }

  // Envio de e-mail de EVENTO do fluxo. Verifica, nesta ordem: toggle global de
  // fluxo, preferência individual do destinatário (padrão ligado) e e-mail válido.
  // Nunca lança — uma falha de e-mail não pode quebrar o fluxo do TCC.
  async enviarEvento(evento: string, destinatario: Destinatario, assunto: string, texto: string, html?: string): Promise<void> {
    try {
      if (!destinatario?.email) return;

      const config = await this.obterConfig();
      if (!config.fluxoTccAtivo) {
        this.logger.warn(`E-mails de fluxo desativados por configuração — "${evento}" para ${destinatario.email} NÃO enviado.`);
        return;
      }

      const pref = await this.prisma.preferenciaEmail.findUnique({
        where: { usuarioId_evento: { usuarioId: destinatario.id, evento } },
      });
      if (pref && !pref.ativo) {
        this.logger.log(`"${evento}": destinatário ${destinatario.email} desativou esse tipo de e-mail. Pulando.`);
        return;
      }

      await this.enviar(destinatario.email, assunto, html ?? `<p>${escaparHtml(texto).replace(/\n/g, '<br>')}</p>`, texto);
    } catch (e) {
      this.logger.error(`Falha ao enviar e-mail do evento "${evento}": ${(e as Error).message}`);
    }
  }
}
