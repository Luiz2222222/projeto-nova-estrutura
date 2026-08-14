import { BadRequestException, Body, Controller, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { GuardaJwt } from '../autenticacao/guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { Papeis } from '../comum/papeis.decorator';
import { EmailService } from './email.service';

type Req = { usuario: { sub: string } };

// Revelação da senha de app do e-mail. Fica FORA do GET normal da configuração de propósito:
// aquele endpoint nunca devolve a senha, nem criptografada. Aqui, a senha só sai depois de o
// coordenador reautenticar com a própria senha, e a resposta é de uso único (no-store).
@Controller('email-config')
export class EmailController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Post('revelar-senha')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  async revelarSenha(@Req() req: Req, @Body() body: { senha?: string }, @Res() res: Response) {
    const u = await this.prisma.usuario.findUnique({ where: { id: req.usuario.sub } });
    if (!u) throw new UnauthorizedException();

    // Reautenticação: a senha DO COORDENADOR (não a de app). Mensagem genérica e sem log.
    const ok = await bcrypt.compare(body?.senha || '', u.senhaHash);
    if (!ok) {
      throw new BadRequestException({
        mensagem: 'Senha incorreta.',
        erros: [{ campo: 'senha', mensagem: 'Senha incorreta' }],
      });
    }

    const senhaApp = await this.email.revelarSenhaApp();
    // Sem cache em lugar nenhum: nem navegador, nem proxy, nem histórico de página.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({ senha: senhaApp });
  }
}
