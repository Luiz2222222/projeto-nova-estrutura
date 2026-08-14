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

// SMTP fixo da configuração salva pela tela: conta institucional no Google Workspace.
// A tela pede só e-mail + senha de app; host/porta/TLS NÃO são escolhidos por quem chama a
// API (nem pela tela, nem por um cliente montando a requisição na mão). Porta 587 com
// requireTLS: sem SSL implícito, mas STARTTLS obrigatório — a conexão nunca fica em texto puro.
const SMTP_GOOGLE = { host: 'smtp.gmail.com', porta: 587, secure: false } as const;

// Ações válidas sobre a senha de app. Validadas em runtime porque o controller entrega o
// body cru — um valor errado precisa dar 400, nunca virar MANTER por omissão.
const ACOES_SENHA = ['MANTER', 'SUBSTITUIR', 'REMOVER'] as const;

// Camada de envio de e-mail + controle de envio (global e por usuário).
// SMTP vem do BANCO (configurado pela UI do coordenador) quando smtpHost está
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
        port: cfg.smtpPort ?? SMTP_GOOGLE.porta,
        secure: !!cfg.smtpSecure,
        // STARTTLS obrigatório: se o servidor não oferecer TLS, a conexão falha em vez de
        // seguir em texto puro. Tirar o campo TLS da tela não tira a criptografia.
        requireTLS: true,
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

  // Revela a senha de app UMA vez, já descriptografada. Só é chamada depois de o
  // controller reautenticar o coordenador — a validação NÃO mora aqui para não haver
  // caminho que descriptografe sem passar por ela.
  //
  // A configuração é global: qualquer coordenador que confirme a própria senha pode ver,
  // porque todos já podem sobrescrevê-la de qualquer forma.
  async revelarSenhaApp(): Promise<string> {
    const c = await this.obterConfig();
    if (!c.smtpSenhaCriptografada) {
      throw new BadRequestException({ mensagem: 'Nenhuma senha de app está salva.' });
    }
    const senha = this.descriptografar(c.smtpSenhaCriptografada);
    if (!senha) {
      throw new BadRequestException({
        mensagem: 'Não foi possível ler a senha salva (a chave de criptografia mudou). Cadastre a senha novamente.',
      });
    }
    return senha; // nunca logado, nunca persistido
  }

  async atualizarConfig(dados: {
    recuperacaoSenhaAtiva?: boolean;
    fluxoTccAtivo?: boolean;
    // Aceitos na assinatura só por compatibilidade com quem já chama a rota: são IGNORADOS.
    // Host/porta/TLS são fixos (SMTP_GOOGLE) e o remetente é sempre o smtpUsuario.
    smtpHost?: string | null;
    smtpPort?: number | null;
    smtpSecure?: boolean;
    smtpRemetente?: string | null;
    smtpUsuario?: string | null; // e-mail remetente (único campo de identidade editável)
    smtpSenha?: string; // texto puro do form; só usado quando a ação é SUBSTITUIR
    // Ação EXPLÍCITA sobre a senha. Existe porque "campo vazio" é ambíguo: pode ser
    // "não mexi" ou "apaguei de propósito". Nunca inferimos pela máscara de pontos da
    // tela — ela é enfeite visual e jamais chega aqui.
    //   MANTER (padrão) → não toca na senha guardada
    //   SUBSTITUIR      → grava a nova senha (exige smtpSenha preenchida)
    //   REMOVER         → apaga a senha guardada
    acaoSenha?: 'MANTER' | 'SUBSTITUIR' | 'REMOVER';
  }) {
    // O controller recebe o body CRU (sem DTO/validação), então a ação é validada aqui.
    // Valor desconhecido NÃO pode virar MANTER silenciosamente: um erro de digitação no
    // cliente passaria despercebido e a senha ficaria diferente do que o usuário quis.
    if (dados.acaoSenha !== undefined && !ACOES_SENHA.includes(dados.acaoSenha)) {
      throw new BadRequestException({
        mensagem: `Ação de senha inválida. Use ${ACOES_SENHA.join(', ')}.`,
        erros: [{ campo: 'acaoSenha', mensagem: 'Valor inválido' }],
      });
    }

    const atual = await this.obterConfig(); // garante a linha
    const data: Record<string, unknown> = {};
    if (typeof dados.recuperacaoSenhaAtiva === 'boolean') data.recuperacaoSenhaAtiva = dados.recuperacaoSenhaAtiva;
    if (typeof dados.fluxoTccAtivo === 'boolean') data.fluxoTccAtivo = dados.fluxoTccAtivo;

    // smtpHost/smtpPort/smtpSecure/smtpRemetente vindos do cliente são IGNORADOS de propósito:
    // a configuração salva pela tela é sempre a do Google Workspace (SMTP_GOOGLE) e o remetente
    // é sempre o próprio e-mail informado. Só o e-mail e a senha de app são escolhidos.
    let desligou = false;
    if (dados.smtpUsuario !== undefined) {
      const email = dados.smtpUsuario?.trim() || '';
      const senha = typeof dados.smtpSenha === 'string' ? dados.smtpSenha : '';

      if (!email) {
        desligou = true;
        // E-mail em branco desliga a configuração salva (volta a valer o .env, se houver).
        data.smtpUsuario = null;
        data.smtpRemetente = null;
        data.smtpHost = null;
        data.smtpPort = null;
        data.smtpSecure = false;
        data.smtpSenhaCriptografada = null;
      } else {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new BadRequestException({
            mensagem: 'Informe um e-mail válido.',
            erros: [{ campo: 'smtpUsuario', mensagem: 'E-mail inválido' }],
          });
        }
        const acao = dados.acaoSenha ?? 'MANTER';
        if (acao === 'REMOVER') {
          // Remoção deliberada: apaga a senha guardada e não exige nova.
          data.smtpSenhaCriptografada = null;
        } else {
          if (acao === 'SUBSTITUIR' && !senha) {
            throw new BadRequestException({
              mensagem: 'Informe a nova senha de app.',
              erros: [{ campo: 'smtpSenha', mensagem: 'Senha de app obrigatória' }],
            });
          }
          // Senha de app é obrigatória no primeiro cadastro E sempre que o e-mail muda (a
          // senha de app é vinculada à conta: manter a antiga com outro e-mail nunca
          // autenticaria).
          const trocouEmail = (atual.smtpUsuario ?? '') !== email;
          const precisaSenha = trocouEmail || !atual.smtpSenhaCriptografada;
          if (precisaSenha && !senha) {
            throw new BadRequestException({
              mensagem: trocouEmail
                ? 'Ao trocar o e-mail remetente, informe a senha de app da nova conta.'
                : 'Informe a senha de app para ativar o envio de e-mails.',
              erros: [{ campo: 'smtpSenha', mensagem: 'Senha de app obrigatória' }],
            });
          }
        }
        data.smtpUsuario = email;
        data.smtpRemetente = email; // remetente = o próprio e-mail informado
        data.smtpHost = SMTP_GOOGLE.host;
        data.smtpPort = SMTP_GOOGLE.porta;
        data.smtpSecure = SMTP_GOOGLE.secure;
      }
    }

    // Grava a nova senha SÓ quando a ação foi SUBSTITUIR. Se o e-mail foi apagado
    // (desligou) ou a ação foi REMOVER, a senha já virou null acima e não é regravada.
    const querSubstituir = dados.acaoSenha === 'SUBSTITUIR' || (dados.acaoSenha === undefined && !!dados.smtpSenha);
    if (!desligou && data.smtpSenhaCriptografada !== null && querSubstituir && dados.smtpSenha) {
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
