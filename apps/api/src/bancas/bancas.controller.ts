import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { BancasService } from './bancas.service';
import { GuardaJwt } from '../autenticacao/guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { Papeis } from '../comum/papeis.decorator';
import { ZodValidacaoPipe } from '../comum/zod-validacao.pipe';
import {
  esquemaFormarBanca,
  esquemaAvaliarBanca,
  type DadosFormarBanca,
  type DadosAvaliarBanca,
} from '@tcc/compartilhado';

type Req = { usuario: { sub: string; papel: string } };

@Controller()
export class BancasController {
  constructor(private readonly bancas: BancasService) {}

  @Get('tccs/:id/banca/candidatos')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  candidatos(@Param('id') id: string) {
    return this.bancas.candidatos(id);
  }

  @Post('tccs/:id/banca')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  formar(@Param('id') id: string, @Body(new ZodValidacaoPipe(esquemaFormarBanca)) dados: DadosFormarBanca) {
    return this.bancas.formarBanca(id, dados.avaliadorIds);
  }

  @Get('bancas/minhas')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR', 'AVALIADOR')
  minhas(@Req() req: Req) {
    return this.bancas.minhasBancas(req.usuario.sub);
  }

  @Post('bancas/:bancaId/avaliar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR', 'AVALIADOR')
  avaliar(
    @Req() req: Req,
    @Param('bancaId') bancaId: string,
    @Body(new ZodValidacaoPipe(esquemaAvaliarBanca)) dados: DadosAvaliarBanca,
  ) {
    return this.bancas.avaliar(req.usuario.sub, bancaId, dados.notas, dados.parecer);
  }

  @Post('tccs/:id/banca/validar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  validar(@Param('id') id: string) {
    return this.bancas.validar(id);
  }
}
