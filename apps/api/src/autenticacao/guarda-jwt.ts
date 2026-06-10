import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

// Protege rotas: exige um token válido no cookie 'token'.
@Injectable()
export class GuardaJwt implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(contexto: ExecutionContext): boolean {
    const req = contexto.switchToHttp().getRequest<Request & { usuario?: any; cookies?: any }>();
    const token = req.cookies?.token;
    if (!token) throw new UnauthorizedException('Não autenticado');
    try {
      req.usuario = this.jwt.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }
  }
}
