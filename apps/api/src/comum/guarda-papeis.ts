import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PAPEIS_CHAVE } from './papeis.decorator';

// Permite a rota só para os papéis marcados com @Papeis(...). Usar APÓS o GuardaJwt
// (que coloca req.usuario). @UseGuards(GuardaJwt, GuardaPapeis)
@Injectable()
export class GuardaPapeis implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const papeis = this.reflector.getAllAndOverride<string[]>(PAPEIS_CHAVE, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!papeis || papeis.length === 0) return true;

    const req = contexto.switchToHttp().getRequest();
    if (!papeis.includes(req.usuario?.papel)) {
      throw new ForbiddenException('Você não tem permissão para esta ação');
    }
    return true;
  }
}
