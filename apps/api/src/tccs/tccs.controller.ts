import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { join } from 'path';
import { TccsService } from './tccs.service';
import { GuardaJwt } from '../autenticacao/guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { Papeis } from '../comum/papeis.decorator';
import { ZodValidacaoPipe } from '../comum/zod-validacao.pipe';
import {
  esquemaAbrirTcc,
  esquemaRecusarAbertura,
  esquemaAvaliarMonografia,
  esquemaContinuidade,
  esquemaAnaliseFinal,
  type DadosAbrirTcc,
  type DadosRecusarAbertura,
  type DadosAvaliarMonografia,
  type DadosContinuidade,
  type DadosAnaliseFinal,
} from '@tcc/compartilhado';

// Aceita só PDF nos uploads de documentos do TCC.
const SO_PDF = {
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new BadRequestException({ mensagem: 'Apenas arquivos PDF são aceitos.' }), false);
  },
};

type Req = { usuario: { sub: string; papel: string } };

@Controller()
export class TccsController {
  constructor(private readonly tccs: TccsService) {}

  @Get('usuarios/professores-disponiveis')
  @UseGuards(GuardaJwt)
  professores() {
    return this.tccs.professoresDisponiveis();
  }

  @Get('usuarios/coorientadores')
  @UseGuards(GuardaJwt)
  coorientadores() {
    return this.tccs.coorientadores();
  }

  @Post('tccs')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('ALUNO')
  abrir(@Req() req: Req, @Body(new ZodValidacaoPipe(esquemaAbrirTcc)) dados: DadosAbrirTcc) {
    return this.tccs.abrir(req.usuario.sub, dados);
  }

  @Get('tccs/meu')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('ALUNO')
  meu(@Req() req: Req) {
    return this.tccs.meu(req.usuario.sub);
  }

  @Delete('tccs/:id')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('ALUNO')
  cancelar(@Req() req: Req, @Param('id') id: string) {
    return this.tccs.cancelar(req.usuario.sub, id);
  }

  @Post('tccs/:id/documentos')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('ALUNO')
  @UseInterceptors(FileInterceptor('arquivo', SO_PDF))
  upload(
    @Req() req: Req,
    @Param('id') id: string,
    @Body('tipo') tipo: string,
    @UploadedFile() arquivo: any,
  ) {
    if (!arquivo) throw new BadRequestException({ mensagem: 'Arquivo obrigatório.' });
    return this.tccs.adicionarDocumento(req.usuario.sub, id, tipo, arquivo);
  }

  @Get('tccs/documentos/:docId/baixar')
  @UseGuards(GuardaJwt)
  async baixar(@Req() req: Req, @Param('docId') docId: string, @Res() res: Response) {
    const doc = await this.tccs.documentoParaUsuario(docId, req.usuario);
    if (!doc) throw new NotFoundException('Documento não encontrado');
    res.download(join(process.cwd(), doc.caminho), doc.nomeArquivo);
  }

  // Abre o PDF inline no navegador (botão de "olho"), sem forçar download.
  @Get('tccs/documentos/:docId/visualizar')
  @UseGuards(GuardaJwt)
  async visualizar(@Req() req: Req, @Param('docId') docId: string, @Res() res: Response) {
    const doc = await this.tccs.documentoParaUsuario(docId, req.usuario);
    if (!doc) throw new NotFoundException('Documento não encontrado');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.nomeArquivo)}"`);
    res.sendFile(join(process.cwd(), doc.caminho));
  }

  // ---------- Fase de Desenvolvimento ----------

  @Post('tccs/:id/monografia')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('ALUNO')
  @UseInterceptors(FileInterceptor('arquivo', SO_PDF))
  enviarMonografia(@Req() req: Req, @Param('id') id: string, @UploadedFile() arquivo: any) {
    if (!arquivo) throw new BadRequestException({ mensagem: 'Arquivo obrigatório.' });
    return this.tccs.enviarMonografia(req.usuario.sub, id, arquivo);
  }

  @Get('tccs/orientando')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR')
  orientandos(@Req() req: Req) {
    return this.tccs.orientandos(req.usuario.sub);
  }

  @Post('tccs/:id/monografia/avaliar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR')
  avaliarMonografia(
    @Req() req: Req,
    @Param('id') id: string,
    @Body(new ZodValidacaoPipe(esquemaAvaliarMonografia)) dados: DadosAvaliarMonografia,
  ) {
    return this.tccs.avaliarMonografia(req.usuario.sub, id, dados.decisao, dados.parecer);
  }

  @Post('tccs/:id/continuidade')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR')
  avaliarContinuidade(
    @Req() req: Req,
    @Param('id') id: string,
    @Body(new ZodValidacaoPipe(esquemaContinuidade)) dados: DadosContinuidade,
  ) {
    return this.tccs.avaliarContinuidade(req.usuario.sub, id, dados.decisao, dados.parecer);
  }

  // ---------- Conclusão ----------

  @Post('tccs/:id/versao-final')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('ALUNO')
  @UseInterceptors(FileInterceptor('arquivo', SO_PDF))
  enviarVersaoFinal(@Req() req: Req, @Param('id') id: string, @UploadedFile() arquivo: any) {
    if (!arquivo) throw new BadRequestException({ mensagem: 'Arquivo obrigatório.' });
    return this.tccs.enviarVersaoFinal(req.usuario.sub, id, arquivo);
  }

  @Post('tccs/:id/analise-final')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  analiseFinal(@Param('id') id: string, @Body(new ZodValidacaoPipe(esquemaAnaliseFinal)) dados: DadosAnaliseFinal) {
    return this.tccs.analiseFinal(id, dados.decisao, dados.parecer);
  }

  @Get('tccs')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  todos() {
    return this.tccs.todos();
  }

  @Get('tccs/pendentes')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  pendentes() {
    return this.tccs.pendentes();
  }

  @Post('tccs/:id/aprovar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  aprovar(@Param('id') id: string) {
    return this.tccs.aprovar(id);
  }

  @Post('tccs/:id/recusar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  recusar(
    @Param('id') id: string,
    @Body(new ZodValidacaoPipe(esquemaRecusarAbertura)) dados: DadosRecusarAbertura,
  ) {
    return this.tccs.recusar(id, dados.parecer);
  }
}
