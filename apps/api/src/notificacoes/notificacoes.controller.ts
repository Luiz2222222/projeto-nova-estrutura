import { Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { GuardaJwt } from '../autenticacao/guarda-jwt';
import { NotificacoesService } from './notificacoes.service';

type Req = { usuario: { sub: string } };

// Todas as rotas usam SEMPRE o usuário autenticado (req.usuario.sub).
// Nunca aceitam usuarioId do front.
@Controller('notificacoes')
@UseGuards(GuardaJwt)
export class NotificacoesController {
  constructor(private readonly notificacoes: NotificacoesService) {}

  @Get()
  listar(@Req() req: Req) {
    return this.notificacoes.listar(req.usuario.sub);
  }

  @Get('nao-lidas')
  naoLidas(@Req() req: Req) {
    return this.notificacoes.contarNaoLidas(req.usuario.sub);
  }

  @Put('lidas')
  marcarTodas(@Req() req: Req) {
    return this.notificacoes.marcarTodasLidas(req.usuario.sub);
  }

  @Put(':id/lida')
  marcarLida(@Req() req: Req, @Param('id') id: string) {
    return this.notificacoes.marcarLida(id, req.usuario.sub);
  }

  @Delete(':id')
  apagar(@Req() req: Req, @Param('id') id: string) {
    return this.notificacoes.apagar(id, req.usuario.sub);
  }
}
