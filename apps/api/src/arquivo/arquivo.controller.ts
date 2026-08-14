import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { GuardaJwt } from '../autenticacao/guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { Papeis } from '../comum/papeis.decorator';
import { EncerramentoService } from './encerramento.service';
import { HistoricoArquivadoService } from './historico-arquivado.service';

type Req = { usuario: { sub: string; papel: string } };

// Rotas PRÓPRIAS do arquivo histórico e do encerramento de período. De propósito fora das
// rotas de TCC ativo: o TCC original é apagado no encerramento, então nada aqui pode
// depender do id nem das permissões dele.
@Controller()
export class ArquivoController {
  constructor(
    private readonly encerramento: EncerramentoService,
    private readonly historico: HistoricoArquivadoService,
  ) {}

  // ---------- Encerramento de período (só coordenador) ----------

  @Get('periodo/encerrar/previa')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  previa(@Query('semestre') semestre?: string) {
    return this.encerramento.previa(semestre);
  }

  @Post('periodo/encerrar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  encerrar(@Req() req: Req, @Body() body: { senha?: string; confirmacao?: string; semestre?: string }) {
    return this.encerramento.encerrar(req.usuario.sub, body.senha ?? '', body.confirmacao ?? '', body.semestre);
  }

  // ---------- Histórico arquivado (coordenador e professor participante) ----------

  @Get('historico-arquivado')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR', 'PROFESSOR')
  listar(@Req() req: Req) {
    return this.historico.listar(req.usuario.sub, req.usuario.papel);
  }

  @Get('historico-arquivado/:id')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR', 'PROFESSOR')
  detalhe(@Param('id') id: string, @Req() req: Req) {
    return this.historico.detalhe(id, req.usuario.sub, req.usuario.papel);
  }

  // `documento` opcional: sem ele baixa o documento final do registro.
  @Get('historico-arquivado/:id/baixar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR', 'PROFESSOR')
  async baixar(@Param('id') id: string, @Query('documento') documentoId: string | undefined, @Req() req: Req, @Res() res: Response) {
    const { conteudo, nome } = await this.historico.baixar(id, req.usuario.sub, req.usuario.papel, documentoId);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nome)}"`);
    res.send(conteudo);
  }
}
