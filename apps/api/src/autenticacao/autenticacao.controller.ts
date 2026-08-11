import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AutenticacaoService } from './autenticacao.service';
import { EmailService } from '../email/email.service';
import { GuardaJwt } from './guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { Papeis } from '../comum/papeis.decorator';
import { ZodValidacaoPipe } from '../comum/zod-validacao.pipe';
import { LimitadorTentativas, ipDaRequisicao } from '../comum/limitador-tentativas';
import {
  esquemaCadastro,
  esquemaCriarCoordenador,
  esquemaLogin,
  esquemaTrocarSenha,
  type DadosCadastro,
  type DadosCriarCoordenador,
  type DadosLogin,
  type DadosTrocarSenha,
} from '@tcc/compartilhado';

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

const JANELA_MS = 15 * 60 * 1000; // 15 minutos

@Controller('autenticacao')
export class AutenticacaoController {
  constructor(
    private readonly auth: AutenticacaoService,
    private readonly email: EmailService,
  ) {}

  // Limitadores em memória (anti brute-force/spam). Por CONTA (IP+e-mail) e por IP (amplo).
  private readonly limLoginConta = new LimitadorTentativas(8, JANELA_MS);
  private readonly limLoginIp = new LimitadorTentativas(30, JANELA_MS);
  private readonly limRecuperarConta = new LimitadorTentativas(5, JANELA_MS);
  private readonly limRecuperarIp = new LimitadorTentativas(20, JANELA_MS);
  // Cadastro: freia força bruta do código de cadastro (por IP). Redefinir: impede varredura
  // de tokens de redefinição (por IP). Mesmo padrão manual dos demais (sem dependência nova).
  private readonly limCadastroIp = new LimitadorTentativas(10, JANELA_MS);
  private readonly limRedefinirIp = new LimitadorTentativas(20, JANELA_MS);

  // Registra as tentativas (sem short-circuit, para contar todas as chaves) e bloqueia com
  // mensagem amigável se QUALQUER limite estourar. Não revela se o e-mail existe (429 é igual
  // para conta existente ou não).
  private bloquearSeExcedeu(checagens: Array<{ lim: LimitadorTentativas; chave: string }>) {
    const permitidos = checagens.map(({ lim, chave }) => lim.permitir(chave));
    if (permitidos.some((ok) => !ok)) {
      throw new HttpException(
        { mensagem: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  @Post('cadastro')
  async cadastro(@Req() req: Request, @Body(new ZodValidacaoPipe(esquemaCadastro)) dados: DadosCadastro) {
    const ip = ipDaRequisicao(req);
    this.bloquearSeExcedeu([{ lim: this.limCadastroIp, chave: `cadastro:ip:${ip}` }]);
    return this.auth.cadastrar(dados);
  }

  // Criação de coordenador pelo card em "Meu perfil". Fora do cadastro público: exige sessão
  // válida E papel COORDENADOR (o guard lê o papel do BANCO, não do token). Não recebe `papel`
  // nem código de cadastro — quem define o papel é o service.
  @Post('coordenadores')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  async criarCoordenador(
    @Body(new ZodValidacaoPipe(esquemaCriarCoordenador)) dados: DadosCriarCoordenador,
  ) {
    return this.auth.criarCoordenador(dados);
  }

  @Post('login')
  async login(
    @Req() req: Request,
    @Body(new ZodValidacaoPipe(esquemaLogin)) dados: DadosLogin,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = ipDaRequisicao(req);
    const email = (dados.email || '').toLowerCase();
    const chaveConta = `login:${ip}:${email}`;
    this.bloquearSeExcedeu([
      { lim: this.limLoginIp, chave: `login:ip:${ip}` },
      { lim: this.limLoginConta, chave: chaveConta },
    ]);

    const u = await this.auth.validarCredenciais(dados);
    // Login OK: zera o contador desta conta para não punir o usuário legítimo.
    this.limLoginConta.limpar(chaveConta);
    const token = this.auth.gerarToken(u, !!dados.manterLogin);

    const emProducao = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: emProducao, // só exige HTTPS em produção
      path: '/',
      // "Manter login" → cookie de 7 dias; senão, cookie de sessão (some ao fechar o navegador).
      ...(dados.manterLogin ? { maxAge: SETE_DIAS_MS } : {}),
    });

    return this.auth.publicar(u);
  }

  @Post('sair')
  sair(@Res({ passthrough: true }) res: Response) {
    const emProducao = process.env.NODE_ENV === 'production';
    res.clearCookie('token', { path: '/', httpOnly: true, sameSite: 'lax', secure: emProducao });
    return { ok: true };
  }

  // Esqueci minha senha: dispara o e-mail com o link (resposta sempre "ok", não
  // revela se o e-mail existe). Throttle por IP+e-mail e por IP contra spam de e-mails.
  @Post('recuperar-senha')
  async recuperarSenha(@Req() req: Request, @Body('email') email: string) {
    const ip = ipDaRequisicao(req);
    const e = (email || '').toLowerCase();
    this.bloquearSeExcedeu([
      { lim: this.limRecuperarIp, chave: `recuperar:ip:${ip}` },
      { lim: this.limRecuperarConta, chave: `recuperar:${ip}:${e}` },
    ]);
    await this.auth.solicitarRecuperacaoSenha(email || '');
    return { ok: true };
  }

  // Redefine a senha a partir do token do link recebido por e-mail. Throttle por IP para
  // impedir varredura de tokens de redefinição.
  @Post('redefinir-senha')
  async redefinirSenha(@Req() req: Request, @Body() dados: { token?: string; novaSenha?: string; confirmarNovaSenha?: string }) {
    const ip = ipDaRequisicao(req);
    this.bloquearSeExcedeu([{ lim: this.limRedefinirIp, chave: `redefinir:ip:${ip}` }]);
    await this.auth.redefinirSenha(dados.token ?? '', dados.novaSenha ?? '', dados.confirmarNovaSenha ?? '');
    return { ok: true };
  }

  @Get('eu')
  @UseGuards(GuardaJwt)
  async eu(@Req() req: Request & { usuario?: { sub: string } }) {
    const u = await this.auth.buscarPorId(req.usuario!.sub);
    if (!u) throw new UnauthorizedException();
    return u;
  }

  // Troca a própria senha (valida a senha atual no backend).
  @Put('senha')
  @UseGuards(GuardaJwt)
  async trocarSenha(
    @Req() req: Request & { usuario?: { sub: string } },
    @Body(new ZodValidacaoPipe(esquemaTrocarSenha)) dados: DadosTrocarSenha,
  ) {
    await this.auth.trocarSenha(req.usuario!.sub, dados.senhaAtual, dados.novaSenha);
    return { ok: true };
  }

  // Preferências de e-mail do próprio usuário (quais e-mails de fluxo quer receber).
  @Get('preferencias-email')
  @UseGuards(GuardaJwt)
  preferenciasEmail(@Req() req: Request & { usuario?: { sub: string } }) {
    return this.email.obterPreferencias(req.usuario!.sub);
  }

  @Put('preferencias-email')
  @UseGuards(GuardaJwt)
  atualizarPreferenciaEmail(
    @Req() req: Request & { usuario?: { sub: string } },
    @Body() dados: { evento?: string; ativo?: boolean },
  ) {
    return this.email.atualizarPreferencia(req.usuario!.sub, dados.evento ?? '', !!dados.ativo);
  }

  // Professor liga/desliga a disponibilidade para orientar.
  @Put('disponibilidade')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR')
  disponibilidade(
    @Req() req: Request & { usuario?: { sub: string } },
    @Body('disponivel') disponivel: boolean,
  ) {
    return this.auth.definirDisponibilidade(req.usuario!.sub, !!disponivel);
  }
}
