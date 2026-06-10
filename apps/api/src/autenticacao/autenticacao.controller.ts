import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AutenticacaoService } from './autenticacao.service';
import { GuardaJwt } from './guarda-jwt';
import { ZodValidacaoPipe } from '../comum/zod-validacao.pipe';
import {
  esquemaCadastro,
  esquemaLogin,
  type DadosCadastro,
  type DadosLogin,
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

  @Get('eu')
  @UseGuards(GuardaJwt)
  async eu(@Req() req: Request & { usuario?: { sub: string } }) {
    const u = await this.auth.buscarPorId(req.usuario!.sub);
    if (!u) throw new UnauthorizedException();
    return u;
  }
}
