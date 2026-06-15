import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AutenticacaoService } from './autenticacao.service';
import { GuardaJwt } from './guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { Papeis } from '../comum/papeis.decorator';
import { ZodValidacaoPipe } from '../comum/zod-validacao.pipe';
import {
  esquemaCadastro,
  esquemaLogin,
  esquemaTrocarSenha,
  type DadosCadastro,
  type DadosLogin,
  type DadosTrocarSenha,
} from '@tcc/compartilhado';

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('autenticacao')
export class AutenticacaoController {
  constructor(private readonly auth: AutenticacaoService) {}

  @Post('cadastro')
  async cadastro(@Body(new ZodValidacaoPipe(esquemaCadastro)) dados: DadosCadastro) {
    return this.auth.cadastrar(dados);
  }

  @Post('login')
  async login(
    @Body(new ZodValidacaoPipe(esquemaLogin)) dados: DadosLogin,
    @Res({ passthrough: true }) res: Response,
  ) {
    const u = await this.auth.validarCredenciais(dados);
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
  // revela se o e-mail existe).
  @Post('recuperar-senha')
  async recuperarSenha(@Body('email') email: string) {
    await this.auth.solicitarRecuperacaoSenha(email || '');
    return { ok: true };
  }

  // Redefine a senha a partir do token do link recebido por e-mail.
  @Post('redefinir-senha')
  async redefinirSenha(@Body() dados: { token?: string; novaSenha?: string; confirmarNovaSenha?: string }) {
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
