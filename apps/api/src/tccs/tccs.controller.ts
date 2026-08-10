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
import { extname, join } from 'path';
import { FORMATOS_ARQUIVO } from '@tcc/compartilhado';
import { TccsService } from './tccs.service';
import { HistoricoTccsService } from './historico-tccs.service';
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
  esquemaEditarTcc,
  esquemaCorrigirFase,
  esquemaEditarDocumento,
  type DadosAbrirTcc,
  type DadosRecusarAbertura,
  type DadosAvaliarMonografia,
  type DadosContinuidade,
  type DadosAnaliseFinal,
  type DadosEditarTcc,
  type DadosCorrigirFase,
  type DadosEditarDocumento,
} from '@tcc/compartilhado';

// Filtro de upload por formato (valida pela extensão do nome enviado). Para rotas em
// que o tipo é dinâmico (admin/substituição/banca) usamos o conjunto mais amplo aqui e
// validamos o tipo exato no service.
function filtroArquivo(formato: { exts: readonly string[]; rotulo: string }) {
  return {
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      const ext = extname(file.originalname || '').toLowerCase();
      if (formato.exts.includes(ext)) cb(null, true);
      else cb(new BadRequestException({ mensagem: `Apenas arquivos ${formato.rotulo} são aceitos.` }), false);
    },
  };
}

type Req = { usuario: { sub: string; papel: string } };

@Controller()
export class TccsController {
  constructor(
    private readonly tccs: TccsService,
    private readonly historico: HistoricoTccsService,
  ) {}

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

  // Estado do prazo de abertura (ENVIO_DOCUMENTOS) do próprio aluno no semestre atual.
  @Get('tccs/abertura-prazo')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('ALUNO')
  aberturaPrazo(@Req() req: Req) {
    return this.tccs.aberturaPrazo(req.usuario.sub);
  }

  // DELETE /tccs/:id: ALUNO cancela a PRÓPRIA abertura pendente (só em INICIALIZACAO).
  // COORDENADOR (qualquer TCC) ou PROFESSOR ORIENTADOR (só o dele) fazem EXCLUSÃO
  // PERMANENTE (banco + arquivos; sem restauração). A permissão fina é validada no service.
  @Delete('tccs/:id')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('ALUNO', 'PROFESSOR', 'COORDENADOR')
  excluirOuCancelar(@Req() req: Req, @Param('id') id: string) {
    if (req.usuario.papel === 'ALUNO') return this.tccs.cancelar(req.usuario.sub, id);
    return this.tccs.excluir(req.usuario, id);
  }

  // Documentos iniciais (Plano/Termo): só PDF.
  @Post('tccs/:id/documentos')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('ALUNO')
  @UseInterceptors(FileInterceptor('arquivo', filtroArquivo(FORMATOS_ARQUIVO.PDF)))
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

  // Monografia (TCC textual do aluno): só Word (.doc, .docx).
  @Post('tccs/:id/monografia')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('ALUNO')
  @UseInterceptors(FileInterceptor('arquivo', filtroArquivo(FORMATOS_ARQUIVO.WORD)))
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

  // Histórico do professor (períodos anteriores): usa SEMPRE o id do JWT, nunca do front.
  @Get('tccs/historico-professor')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR')
  historicoProfessor(@Req() req: Req) {
    return this.historico.historicoProfessor(req.usuario.sub);
  }

  // Ocultar/mostrar um TCC no histórico do PRÓPRIO usuário (preferência por usuário). NÃO é
  // exclusão: não mexe no TCC nem em excluidoEm. Só o coordenador ou um professor com vínculo.
  @Post('tccs/:id/historico/ocultar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR', 'COORDENADOR')
  ocultarHistorico(@Req() req: Req, @Param('id') id: string) {
    return this.historico.ocultarDoHistorico(req.usuario, id);
  }

  @Delete('tccs/:id/historico/ocultar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR', 'COORDENADOR')
  desocultarHistorico(@Req() req: Req, @Param('id') id: string) {
    return this.historico.desocultarDoHistorico(req.usuario, id);
  }

  // Coorientações: visão de leitura dos TCCs em que o usuário é coorientador.
  // Professor ou avaliador podem ser coorientadores.
  @Get('tccs/coorientando')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR', 'AVALIADOR')
  coorientacoes(@Req() req: Req) {
    return this.tccs.coorientacoes(req.usuario.sub);
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

  // Versão final: só PDF.
  @Post('tccs/:id/versao-final')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('ALUNO')
  @UseInterceptors(FileInterceptor('arquivo', filtroArquivo(FORMATOS_ARQUIVO.PDF)))
  enviarVersaoFinal(@Req() req: Req, @Param('id') id: string, @UploadedFile() arquivo: any) {
    if (!arquivo) throw new BadRequestException({ mensagem: 'Arquivo obrigatório.' });
    return this.tccs.enviarVersaoFinal(req.usuario.sub, id, arquivo);
  }

  @Post('tccs/:id/validar-versao-final')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR')
  validarVersaoFinal(
    @Req() req: Req,
    @Param('id') id: string,
    @Body(new ZodValidacaoPipe(esquemaAnaliseFinal)) dados: DadosAnaliseFinal,
  ) {
    return this.tccs.validarVersaoFinal(req.usuario.sub, id, dados.decisao, dados.parecer);
  }

  @Get('tccs')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  todos() {
    return this.tccs.todos();
  }

  // Histórico administrativo do coordenador (períodos anteriores): id sempre do JWT.
  @Get('tccs/historico-coordenador')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  historicoCoordenador(@Req() req: Req) {
    return this.historico.historicoCoordenador(req.usuario.sub);
  }

  // TCCs que o PRÓPRIO usuário ocultou do histórico (para listar e reexibir).
  @Get('tccs/historico-ocultos')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR', 'COORDENADOR')
  historicoOcultos(@Req() req: Req) {
    return this.historico.listarOcultosDoHistorico(req.usuario);
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

  // Edição administrativa dos DADOS GERAIS do TCC (só coordenador). Fase/notas/resultado
  // não passam por aqui — ver a rota de correção de fluxo abaixo.
  @Put('tccs/:id')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  editar(@Param('id') id: string, @Body(new ZodValidacaoPipe(esquemaEditarTcc)) dados: DadosEditarTcc) {
    return this.tccs.editarTcc(id, dados);
  }

  // Correção administrativa de FLUXO (só coordenador): muda a fase de forma controlada.
  // confirmar=false → devolve os impactos sem gravar; confirmar=true → aplica.
  @Post('tccs/:id/corrigir-fase')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  corrigirFase(@Param('id') id: string, @Body(new ZodValidacaoPipe(esquemaCorrigirFase)) dados: DadosCorrigirFase) {
    return this.tccs.corrigirFase(id, dados.fase, dados.confirmar);
  }

  // Edição de metadados de um documento do TCC (só coordenador).
  @Put('tccs/documentos/:docId')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  editarDocumento(@Param('docId') docId: string, @Body(new ZodValidacaoPipe(esquemaEditarDocumento)) dados: DadosEditarDocumento) {
    return this.tccs.editarDocumento(docId, dados);
  }

  // Coordenador adiciona administrativamente um novo documento ao TCC. Filtro amplo
  // (PDF/Word) aqui; o service valida pelo TIPO selecionado.
  @Post('tccs/:id/documentos/admin')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  @UseInterceptors(FileInterceptor('arquivo', filtroArquivo(FORMATOS_ARQUIVO.PDF_WORD)))
  adicionarDocumentoAdmin(
    @Param('id') id: string,
    @Body('tipo') tipo: string,
    @Body('status') status: string,
    @Body('parecer') parecer: string,
    @UploadedFile() arquivo: any,
  ) {
    if (!arquivo) throw new BadRequestException({ mensagem: 'Arquivo obrigatório.' });
    return this.tccs.adicionarDocumentoAdmin(id, tipo, status, parecer, arquivo);
  }

  // Coordenador substitui o arquivo de um documento existente (antigo → SUBSTITUIDA; cria
  // nova versão). Filtro amplo aqui; o service valida pelo TIPO original do documento.
  @Post('tccs/documentos/:docId/substituir')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  @UseInterceptors(FileInterceptor('arquivo', filtroArquivo(FORMATOS_ARQUIVO.PDF_WORD)))
  substituirArquivoDocumento(
    @Param('docId') docId: string,
    @Body('status') status: string,
    @UploadedFile() arquivo: any,
  ) {
    if (!arquivo) throw new BadRequestException({ mensagem: 'Arquivo obrigatório.' });
    return this.tccs.substituirArquivoDocumento(docId, status, arquivo);
  }
}
