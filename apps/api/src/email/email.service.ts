import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { CHAVES_EVENTO_EMAIL } from '@tcc/compartilhado';

type Destinatario = { id: string; email: string | null; nomeCompleto: string } | null | undefined;

// Camada de envio de e-mail + controle de envio (global e por usuário).
// Por padrão (sem SMTP_HOST no .env) roda em modo dev/console: NÃO envia, só
// registra no log. Com SMTP_* no .env, envia de verdade. Sem credenciais no código.
@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');
  private readonly transporter: nodemailer.Transporter | null;
  private readonly remetente: string;

  constructor(private readonly prisma: PrismaService) {
    const host = process.env.SMTP_HOST;
    this.remetente = process.env.SMTP_FROM || 'Sistema de TCC <nao-responda@dee.local>';
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
      this.logger.log(`SMTP configurado (host=${host}).`);
    } else {
      this.transporter = null;
      this.logger.warn('SMTP não configurado — e-mails só serão registrados no console (modo dev).');
    }
  }

  private async enviar(para: string, assunto: string, html: string, texto: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `\n----- E-MAIL (modo dev, NÃO enviado) -----\nPara: ${para}\nAssunto: ${assunto}\n${texto}\n------------------------------------------`,
      );
      return;
    }
    await this.transporter.sendMail({ from: this.remetente, to: para, subject: assunto, text: texto, html });
  }

  // ---------- Configuração global (linha única) ----------

  async obterConfig() {
    const existe = await this.prisma.configuracaoEmail.findUnique({ where: { id: 'global' } });
    return existe ?? this.prisma.configuracaoEmail.create({ data: { id: 'global' } });
  }

  async atualizarConfig(dados: { recuperacaoSenhaAtiva?: boolean; fluxoTccAtivo?: boolean }) {
    await this.obterConfig(); // garante a linha
    return this.prisma.configuracaoEmail.update({
      where: { id: 'global' },
      data: {
        ...(typeof dados.recuperacaoSenhaAtiva === 'boolean' ? { recuperacaoSenhaAtiva: dados.recuperacaoSenhaAtiva } : {}),
        ...(typeof dados.fluxoTccAtivo === 'boolean' ? { fluxoTccAtivo: dados.fluxoTccAtivo } : {}),
      },
    });
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
      `<p>Olá, ${nome}.</p>` +
      `<p>Recebemos um pedido para redefinir sua senha. Clique no link abaixo (válido por 1 hora):</p>` +
      `<p><a href="${link}">Redefinir minha senha</a></p>` +
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

      await this.enviar(destinatario.email, assunto, html ?? `<p>${texto.replace(/\n/g, '<br>')}</p>`, texto);
    } catch (e) {
      this.logger.error(`Falha ao enviar e-mail do evento "${evento}": ${(e as Error).message}`);
    }
  }
}
