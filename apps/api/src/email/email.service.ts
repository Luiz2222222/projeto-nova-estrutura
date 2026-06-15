import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

// Camada de envio de e-mail. Por padrão (sem SMTP_HOST no .env) roda em modo
// dev/console: NÃO envia nada, apenas registra o conteúdo (e o link) no log.
// Quando SMTP_HOST/USER/PASS estiverem no .env, passa a enviar de verdade.
// Sem credenciais hardcoded — tudo por variável de ambiente.
@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');
  private readonly transporter: nodemailer.Transporter | null;
  private readonly remetente: string;

  constructor() {
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

  async enviarRecuperacaoSenha(para: string, nome: string, link: string): Promise<void> {
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
}
