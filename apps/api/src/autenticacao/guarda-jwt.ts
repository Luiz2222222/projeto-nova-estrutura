import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

// Protege rotas: exige um token válido no cookie 'token' E confirma no banco que a sessão
// ainda vale. Duas checagens além da assinatura:
//   1. o usuário ainda EXISTE (um usuário excluído perdia o acesso só quando o token
//      expirava — até 7 dias depois);
//   2. a versão do token (v) bate com Usuario.versaoToken — trocar/redefinir a senha
//      incrementa a versão e derruba todas as sessões antigas na hora.
// O PAPEL usado nas autorizações vem SEMPRE do banco (não do token): mudar o papel de um
// usuário passa a valer imediatamente, sem esperar o token expirar.
@Injectable()
export class GuardaJwt implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<Request & { usuario?: any; cookies?: any }>();
    const token = req.cookies?.token;
    if (!token) throw new UnauthorizedException('Não autenticado');
    let payload: { sub?: string; v?: number };
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }
    const u = await this.prisma.usuario.findUnique({
      where: { id: payload.sub ?? '' },
      select: { id: true, papel: true, versaoToken: true },
    });
    // Tokens antigos (sem `v`) também são rejeitados — basta logar de novo uma vez.
    if (!u || (payload.v ?? -1) !== u.versaoToken) {
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }
    req.usuario = { sub: u.id, papel: u.papel, v: u.versaoToken };
    return true;
  }
}
