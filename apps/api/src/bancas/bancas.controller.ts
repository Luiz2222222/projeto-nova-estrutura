import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { FORMATOS_ARQUIVO } from '@tcc/compartilhado';
import { BancasService } from './bancas.service';
import { GuardaJwt } from '../autenticacao/guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { Papeis } from '../comum/papeis.decorator';
import { ZodValidacaoPipe } from '../comum/zod-validacao.pipe';
import {
  esquemaFormarBanca,
  esquemaAvaliarBanca,
  esquemaEditarAvaliacaoMembro,
  esquemaTrocarAvaliadores,
  type DadosAvaliarBanca,
  type DadosEditarAvaliacaoMembro,
  type DadosTrocarAvaliadores,
} from '@tcc/compartilhado';

// Documento de avaliação da banca: aceita PDF ou Word (.doc, .docx). Valida pela
// extensão do nome enviado; o service confirma a regra do tipo AVALIACAO_BANCA.
const FILTRO_BANCA = {
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    const ext = extname(file.originalname || '').toLowerCase();
    if ((FORMATOS_ARQUIVO.PDF_WORD.exts as readonly string[]).includes(ext)) cb(null, true);
    else cb(new BadRequestException({ mensagem: `Apenas arquivos ${FORMATOS_ARQUIVO.PDF_WORD.rotulo} são aceitos.` }), false);
  },
};

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

  // Formar banca da Fase I: multipart com o documento de avaliação ('arquivo') e a
  // lista de avaliadores ('avaliadorIds', JSON). Sem arquivo, a banca não é formada.
  @Post('tccs/:id/banca')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  @UseInterceptors(FileInterceptor('arquivo', FILTRO_BANCA))
  formar(
    @Param('id') id: string,
    @Body('avaliadorIds') avaliadorIdsRaw: string,
    @UploadedFile() arquivo: any,
  ) {
    if (!arquivo) throw new BadRequestException({ mensagem: 'Envie o documento para avaliação da banca.' });
    let ids: unknown;
    try {
      ids = JSON.parse(avaliadorIdsRaw ?? '[]');
    } catch {
      throw new BadRequestException({ mensagem: 'Lista de avaliadores inválida.' });
    }
    const r = esquemaFormarBanca.safeParse({ avaliadorIds: ids });
    if (!r.success) throw new BadRequestException({ mensagem: 'Lista de avaliadores inválida.' });
    return this.bancas.formarBanca(id, r.data.avaliadorIds, arquivo);
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
    return this.bancas.avaliar(req.usuario.sub, bancaId, dados.notas, dados.parecer, dados.finalizar);
  }

  // Reabre a própria avaliação enviada (ENVIADO → PENDENTE) para editar de novo.
  @Post('bancas/:bancaId/reabrir')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR', 'AVALIADOR')
  reabrir(@Req() req: Req, @Param('bancaId') bancaId: string) {
    return this.bancas.reabrir(req.usuario.sub, bancaId);
  }

  // Coordenador inicia a análise: AGUARDANDO_ANALISE_* → VALIDACAO_* (trava a banca).
  @Post('tccs/:id/banca/iniciar-analise')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  iniciarAnalise(@Param('id') id: string) {
    return this.bancas.iniciarAnalise(id);
  }

  // Coordenador aprova a avaliação de um membro (durante a análise).
  @Post('bancas/membros/:membroId/aprovar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  aprovarAvaliacao(@Param('membroId') membroId: string) {
    return this.bancas.aprovarAvaliacaoMembro(membroId);
  }

  // Coordenador solicita ajuste a um membro (motivo obrigatório).
  @Post('bancas/membros/:membroId/solicitar-ajuste')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  solicitarAjuste(@Param('membroId') membroId: string, @Body('motivo') motivo: string) {
    return this.bancas.solicitarAjuste(membroId, motivo);
  }

  // Coordenador cancela/desfaz a solicitação de ajuste de um membro.
  @Post('bancas/membros/:membroId/cancelar-ajuste')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  cancelarAjuste(@Param('membroId') membroId: string) {
    return this.bancas.cancelarAjuste(membroId);
  }

  @Post('tccs/:id/banca/validar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  validar(@Param('id') id: string) {
    return this.bancas.validar(id);
  }

  // Orientador libera a defesa da Fase II (AGENDAMENTO_DEFESA_FASE_2 → AVALIACAO_FASE_2).
  @Post('tccs/:id/liberar-defesa')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('PROFESSOR')
  liberarDefesa(@Req() req: Req, @Param('id') id: string) {
    return this.bancas.liberarDefesa(req.usuario.sub, id);
  }

  // ----- Edição administrativa da banca (só coordenador) -----

  // Pesos do calendário do semestre do TCC (para a tela de banca do coordenador).
  @Get('tccs/:id/banca/pesos')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  pesos(@Param('id') id: string) {
    return this.bancas.pesosDaBanca(id);
  }

  // Edita a avaliação de um membro da banca (notas/comentários/parecer/status).
  @Put('bancas/membros/:membroId/avaliacao')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  editarAvaliacao(
    @Param('membroId') membroId: string,
    @Body(new ZodValidacaoPipe(esquemaEditarAvaliacaoMembro)) dados: DadosEditarAvaliacaoMembro,
  ) {
    return this.bancas.editarAvaliacaoMembro(membroId, dados.notas, dados.parecer, dados.status);
  }

  // Troca os 2 avaliadores da banca da Fase I (sincroniza a Fase II).
  @Put('tccs/:id/banca/avaliadores')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  trocarAvaliadores(
    @Param('id') id: string,
    @Body(new ZodValidacaoPipe(esquemaTrocarAvaliadores)) dados: DadosTrocarAvaliadores,
  ) {
    return this.bancas.editarAvaliadoresFase1(id, dados.avaliadorIds);
  }
}
