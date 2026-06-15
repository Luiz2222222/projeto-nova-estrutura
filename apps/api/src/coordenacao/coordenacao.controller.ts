import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { join } from 'path';
import { CoordenacaoService } from './coordenacao.service';
import { EmailService } from '../email/email.service';
import { GuardaJwt } from '../autenticacao/guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { Papeis } from '../comum/papeis.decorator';
import { ZodValidacaoPipe } from '../comum/zod-validacao.pipe';
import {
  esquemaAviso,
  esquemaComentario,
  type DadosAviso,
  type DadosComentario,
} from '@tcc/compartilhado';

type Req = { usuario: { sub: string; papel: string; nomeCompleto?: string } };

@Controller()
export class CoordenacaoController {
  constructor(
    private readonly coord: CoordenacaoService,
    private readonly email: EmailService,
  ) {}

  // ---------- Configuração global de e-mails (só coordenador) ----------

  @Get('email-config')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  emailConfig() {
    return this.email.obterConfigSegura();
  }

  @Put('email-config')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  salvarEmailConfig(
    @Body()
    dados: {
      recuperacaoSenhaAtiva?: boolean;
      fluxoTccAtivo?: boolean;
      smtpHost?: string | null;
      smtpPort?: number | null;
      smtpSecure?: boolean;
      smtpUsuario?: string | null;
      smtpRemetente?: string | null;
      smtpSenha?: string;
    },
  ) {
    return this.email.atualizarConfig(dados);
  }

  // ---------- Calendário ----------

  @Get('calendario')
  @UseGuards(GuardaJwt)
  calendario() {
    return this.coord.calendario();
  }

  @Put('calendario')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  salvarCalendario(@Body() dados: Record<string, string | null>) {
    return this.coord.salvarCalendario(dados);
  }

  @Put('calendario/pesos')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  salvarPesos(@Body() dados: Record<string, unknown>) {
    return this.coord.salvarPesos(dados);
  }

  // ---------- Códigos de cadastro (só coordenador: são segredos) ----------

  @Get('codigos-cadastro')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  codigos() {
    return this.coord.listarCodigos();
  }

  @Put('codigos-cadastro')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  salvarCodigos(@Body() dados: Record<string, string>) {
    return this.coord.salvarCodigos(dados);
  }

  // ---------- Exportar / Resetar dados (só coordenador) ----------

  @Get('relatorio')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  relatorio() {
    return this.coord.relatorio();
  }

  @Get('lista-do-periodo')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  listaDoPeriodo() {
    return this.coord.listaDoPeriodo();
  }

  // ---------- Usuários (só coordenador) ----------

  @Get('usuarios/lista')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  listarUsuarios(@Query('papel') papel: string) {
    return this.coord.listarUsuarios(papel);
  }

  @Put('usuarios/:id')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  editarUsuario(@Param('id') id: string, @Body() dados: Record<string, unknown>) {
    return this.coord.editarUsuario(id, dados);
  }

  @Put('usuarios/:id/senha')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  resetarSenhaUsuario(@Param('id') id: string, @Body('senha') senha: string) {
    return this.coord.resetarSenhaUsuario(id, senha);
  }

  @Delete('usuarios/:id')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  excluirUsuario(@Req() req: Req, @Param('id') id: string) {
    return this.coord.excluirUsuario(id, req.usuario.sub);
  }

  @Get('exportar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  async exportar(@Res() res: Response) {
    const dados = await this.coord.exportarDados();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dados_tcc_${dados.semestre}.json"`);
    res.send(JSON.stringify(dados, null, 2));
  }

  @Post('resetar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  resetar(@Req() req: Req, @Body() body: { senha?: string; confirmacao?: string }) {
    return this.coord.resetarPeriodo(req.usuario.sub, body.senha ?? '', body.confirmacao ?? '');
  }

  // ---------- Avisos ----------

  @Get('avisos')
  @UseGuards(GuardaJwt)
  avisos(@Req() req: Req) {
    return this.coord.listarAvisos(req.usuario.papel);
  }

  @Post('avisos')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  criarAviso(@Req() req: Req, @Body(new ZodValidacaoPipe(esquemaAviso)) dados: DadosAviso) {
    return this.coord.criarAviso(req.usuario.sub, dados);
  }

  @Put('avisos/:id')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  editarAviso(@Param('id') id: string, @Body(new ZodValidacaoPipe(esquemaAviso)) dados: DadosAviso) {
    return this.coord.editarAviso(id, dados);
  }

  @Delete('avisos/:id')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  removerAviso(@Param('id') id: string) {
    return this.coord.removerAviso(id);
  }

  // Comentários: qualquer usuário logado comenta; apaga o autor ou o coordenador.
  @Post('avisos/:id/comentarios')
  @UseGuards(GuardaJwt)
  comentar(
    @Req() req: Req,
    @Param('id') id: string,
    @Body(new ZodValidacaoPipe(esquemaComentario)) dados: DadosComentario,
  ) {
    return this.coord.comentar(id, req.usuario, dados.texto);
  }

  @Delete('avisos/:avisoId/comentarios/:comentarioId')
  @UseGuards(GuardaJwt)
  removerComentario(
    @Req() req: Req,
    @Param('avisoId') avisoId: string,
    @Param('comentarioId') comentarioId: string,
  ) {
    return this.coord.removerComentario(avisoId, comentarioId, req.usuario);
  }

  // ---------- Documentos de referência ----------

  @Get('documentos-referencia')
  @UseGuards(GuardaJwt)
  referencias(@Req() req: Req) {
    return this.coord.listarReferencias(req.usuario.papel);
  }

  @Post('documentos-referencia')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  @UseInterceptors(
    FileInterceptor('arquivo', {
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        // Modelos costumam ser PDF/Office/imagem. Bloqueia executáveis e afins.
        const ok = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'image/png',
          'image/jpeg',
        ].includes(file.mimetype);
        if (ok) cb(null, true);
        else cb(new BadRequestException({ mensagem: 'Tipo de arquivo não permitido (use PDF, Word, Excel, PPT ou imagem).' }), false);
      },
    }),
  )
  adicionarReferencia(
    @Body('titulo') titulo: string,
    @Body('visivelPara') visivelPara: string,
    @UploadedFile() arquivo: any,
  ) {
    if (!arquivo) throw new BadRequestException({ mensagem: 'Arquivo obrigatório.' });
    if (!titulo?.trim()) throw new BadRequestException({ mensagem: 'Informe um título.' });
    return this.coord.adicionarReferencia(titulo.trim(), visivelPara, arquivo);
  }

  // Edita quais perfis podem ver o documento de referência.
  @Put('documentos-referencia/:id/visibilidade')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  editarVisibilidade(@Param('id') id: string, @Body('visivelPara') visivelPara: string) {
    return this.coord.editarVisibilidade(id, visivelPara);
  }

  @Delete('documentos-referencia/:id')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  removerReferencia(@Param('id') id: string) {
    return this.coord.removerReferencia(id);
  }

  @Get('documentos-referencia/:id/baixar')
  @UseGuards(GuardaJwt)
  async baixar(@Req() req: Req, @Param('id') id: string, @Res() res: Response) {
    const doc = await this.coord.referenciaParaUsuario(id, req.usuario.papel);
    if (!doc) throw new NotFoundException('Documento não encontrado');
    res.download(join(process.cwd(), doc.caminho), doc.nomeArquivo);
  }

  // Abre o documento-modelo inline no navegador (botão de "olho"), sem forçar download.
  @Get('documentos-referencia/:id/visualizar')
  @UseGuards(GuardaJwt)
  async visualizarReferencia(@Req() req: Req, @Param('id') id: string, @Res() res: Response) {
    const doc = await this.coord.referenciaParaUsuario(id, req.usuario.papel);
    if (!doc) throw new NotFoundException('Documento não encontrado');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.nomeArquivo)}"`);
    res.sendFile(join(process.cwd(), doc.caminho));
  }
}
