import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { criptografarDrive, descriptografarDrive } from './cripto-drive';
import {
  ESCOPO_DRIVE,
  ErroDrive,
  credenciaisDoAmbiente,
  criarPasta,
  emailDaConta,
  gerarState,
  renovarAccessToken,
  trocarCodigoPorTokens,
  urlDeAutorizacao,
} from './drive-api';

const NOME_PASTA_RAIZ = 'Sistema de TCC - DEE';
const VALIDADE_STATE_MS = 10 * 60 * 1000; // 10 min
const MARGEM_TOKEN_MS = 60 * 1000; // renova 1 min antes de expirar

// Configuração GLOBAL da integração com o Drive + fluxo OAuth do servidor.
// O refresh token só existe aqui dentro: nunca vai para resposta HTTP, log ou snapshot.
@Injectable()
export class DriveService {
  private readonly logger = new Logger('DriveService');
  private tokenCache: { valor: string; expiraEm: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async obterConfig() {
    const existe = await this.prisma.integracaoDrive.findUnique({ where: { id: 'global' } });
    return existe ?? this.prisma.integracaoDrive.create({ data: { id: 'global' } });
  }

  // Versão para o frontend: sem token, sem segredo. Só o suficiente para o card do
  // Planejamento (conta autorizada, último sync, pendências e erros).
  async statusSeguro() {
    const c = await this.obterConfig();
    const [pendentes, comErro] = await Promise.all([
      this.prisma.syncDrive.count({ where: { status: 'PENDENTE' } }),
      this.prisma.syncDrive.count({ where: { status: 'ERRO' } }),
    ]);
    return {
      conectado: !!c.refreshTokenCriptografado && !!c.pastaRaizId,
      configurado: !!credenciaisDoAmbiente(), // credenciais OAuth presentes no .env
      contaEmail: c.contaEmail,
      pastaRaizNome: c.pastaRaizNome,
      conectadoEm: c.conectadoEm,
      ultimoSyncEm: c.ultimoSyncEm,
      ultimoErro: c.ultimoErro,
      pendentes,
      comErro,
      escopo: ESCOPO_DRIVE,
    };
  }

  // ---------- OAuth ----------

  private credenciais() {
    const cred = credenciaisDoAmbiente();
    if (!cred) {
      throw new BadRequestException({
        mensagem:
          'Integração com o Drive não configurada no servidor. Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env da API.',
      });
    }
    return cred;
  }

  // Gera o state (uso único, validade curta) e devolve a URL de consentimento.
  async iniciarAutorizacao(): Promise<{ url: string }> {
    const cred = this.credenciais();
    await this.obterConfig();
    const state = gerarState();
    await this.prisma.integracaoDrive.update({
      where: { id: 'global' },
      data: { oauthState: state, oauthStateExpiraEm: new Date(Date.now() + VALIDADE_STATE_MS) },
    });
    return { url: urlDeAutorizacao(cred, state) };
  }

  // Callback: confere o state (CSRF), troca o código pelos tokens, descobre a conta e
  // cria a pasta raiz. O state é consumido em qualquer desfecho.
  async concluirAutorizacao(codigo: string, state: string): Promise<{ contaEmail: string | null }> {
    const cred = this.credenciais();
    const c = await this.obterConfig();

    const stateOk =
      !!c.oauthState && !!state && c.oauthState === state && !!c.oauthStateExpiraEm && c.oauthStateExpiraEm > new Date();
    // Consome o state SEMPRE (sucesso ou falha): não dá para reusar um callback.
    await this.prisma.integracaoDrive.update({
      where: { id: 'global' },
      data: { oauthState: null, oauthStateExpiraEm: null },
    });
    if (!stateOk) {
      throw new BadRequestException({ mensagem: 'Autorização inválida ou expirada. Tente conectar novamente.' });
    }
    if (!codigo) throw new BadRequestException({ mensagem: 'O Google não devolveu o código de autorização.' });

    const { refreshToken, accessToken } = await trocarCodigoPorTokens(cred, codigo);
    const email = await emailDaConta(accessToken).catch(() => null);
    // Pasta raiz criada pelo PRÓPRIO sistema: com escopo drive.file o app não enxerga
    // pastas que não criou, então não há como reaproveitar uma pasta existente.
    const pastaRaizId = await criarPasta(accessToken, NOME_PASTA_RAIZ);

    await this.prisma.integracaoDrive.update({
      where: { id: 'global' },
      data: {
        refreshTokenCriptografado: criptografarDrive(refreshToken),
        contaEmail: email,
        pastaRaizId,
        pastaRaizNome: NOME_PASTA_RAIZ,
        conectadoEm: new Date(),
        ultimoErro: null,
      },
    });
    this.tokenCache = { valor: accessToken, expiraEm: Date.now() + 50 * 60 * 1000 };
    this.logger.log(`Drive conectado na conta ${email ?? '(desconhecida)'}`);
    return { contaEmail: email };
  }

  async desconectar(): Promise<void> {
    await this.obterConfig();
    // Some com o token e com os ponteiros locais; NÃO apaga nada no Drive.
    await this.prisma.integracaoDrive.update({
      where: { id: 'global' },
      data: {
        refreshTokenCriptografado: null,
        contaEmail: null,
        pastaRaizId: null,
        pastaRaizNome: null,
        conectadoEm: null,
        oauthState: null,
        oauthStateExpiraEm: null,
      },
    });
    this.tokenCache = null;
  }

  // ---------- Uso interno (worker/encerramento) ----------

  async conectado(): Promise<boolean> {
    const c = await this.obterConfig();
    return !!c.refreshTokenCriptografado && !!c.pastaRaizId;
  }

  // Access token válido, renovado a partir do refresh token guardado criptografado.
  async accessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiraEm - MARGEM_TOKEN_MS > Date.now()) {
      return this.tokenCache.valor;
    }
    const cred = this.credenciais();
    const c = await this.obterConfig();
    if (!c.refreshTokenCriptografado) {
      throw new ErroDrive('Drive não conectado.', undefined, true);
    }
    const refresh = descriptografarDrive(c.refreshTokenCriptografado);
    if (!refresh) {
      // Chave trocada ou dado corrompido: exige reconexão, e repetir não adianta.
      throw new ErroDrive(
        'Não foi possível ler as credenciais do Drive (DRIVE_CRYPTO_SEGREDO mudou?). Reconecte a conta.',
        undefined,
        true,
      );
    }
    const token = await renovarAccessToken(cred, refresh);
    this.tokenCache = { valor: token, expiraEm: Date.now() + 50 * 60 * 1000 };
    return token;
  }

  async pastaRaizId(): Promise<string> {
    const c = await this.obterConfig();
    if (!c.pastaRaizId) throw new ErroDrive('Pasta raiz do Drive não definida. Reconecte a conta.', undefined, true);
    return c.pastaRaizId;
  }

  async registrarSync(erro?: string): Promise<void> {
    await this.prisma.integracaoDrive.update({
      where: { id: 'global' },
      data: { ultimoSyncEm: new Date(), ultimoErro: erro ?? null },
    });
  }
}
