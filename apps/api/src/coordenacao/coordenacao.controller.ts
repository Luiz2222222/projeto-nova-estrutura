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
import { GuardaJwt } from '../autenticacao/guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { Papeis } from '../comum/papeis.decorator';
import { ZodValidacaoPipe } from '../comum/zod-validacao.pipe';
import { esquemaAviso, type DadosAviso } from '@tcc/compartilhado';

type Req = { usuario: { sub: string; papel: string; nomeCompleto?: string } };

@Controller()
export class CoordenacaoController {
  constructor(private readonly coord: CoordenacaoService) {}

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

  // ---------- Avisos ----------

  @Get('avisos')
  @UseGuards(GuardaJwt)
  avisos() {
    return this.coord.listarAvisos();
  }

  @Post('avisos')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  criarAviso(@Req() req: Req, @Body(new ZodValidacaoPipe(esquemaAviso)) dados: DadosAviso) {
    return this.coord.criarAviso(req.usuario.sub, dados.titulo, dados.conteudo);
  }

  @Delete('avisos/:id')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  removerAviso(@Param('id') id: string) {
    return this.coord.removerAviso(id);
  }

  // ---------- Documentos de referência ----------

  @Get('documentos-referencia')
  @UseGuards(GuardaJwt)
  referencias() {
    return this.coord.listarReferencias();
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
  adicionarReferencia(@Body('titulo') titulo: string, @UploadedFile() arquivo: any) {
    if (!arquivo) throw new BadRequestException({ mensagem: 'Arquivo obrigatório.' });
    if (!titulo?.trim()) throw new BadRequestException({ mensagem: 'Informe um título.' });
    return this.coord.adicionarReferencia(titulo.trim(), arquivo);
  }

  @Delete('documentos-referencia/:id')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  removerReferencia(@Param('id') id: string) {
    return this.coord.removerReferencia(id);
  }

  @Get('documentos-referencia/:id/baixar')
  @UseGuards(GuardaJwt)
  async baixar(@Param('id') id: string, @Res() res: Response) {
    const doc = await this.coord.referencia(id);
    if (!doc) throw new NotFoundException('Documento não encontrado');
    res.download(join(process.cwd(), doc.caminho), doc.nomeArquivo);
  }

  // Abre o documento-modelo inline no navegador (botão de "olho"), sem forçar download.
  @Get('documentos-referencia/:id/visualizar')
  @UseGuards(GuardaJwt)
  async visualizarReferencia(@Param('id') id: string, @Res() res: Response) {
    const doc = await this.coord.referencia(id);
    if (!doc) throw new NotFoundException('Documento não encontrado');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.nomeArquivo)}"`);
    res.sendFile(join(process.cwd(), doc.caminho));
  }
}
