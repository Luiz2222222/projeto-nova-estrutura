import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BancasService } from './bancas.service';
import { GuardaJwt } from '../autenticacao/guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { Papeis } from '../comum/papeis.decorator';
import { ZodValidacaoPipe } from '../comum/zod-validacao.pipe';
import {
  esquemaFormarBanca,
  esquemaAvaliarBanca,
  type DadosAvaliarBanca,
} from '@tcc/compartilhado';

// Aceita só PDF no documento de avaliação da banca (mesmo padrão dos uploads de TCC).
const SO_PDF = {
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new BadRequestException({ mensagem: 'Apenas arquivos PDF são aceitos.' }), false);
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
  @UseInterceptors(FileInterceptor('arquivo', SO_PDF))
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

  @Post('tccs/:id/banca/validar')
  @UseGuards(GuardaJwt, GuardaPapeis)
  @Papeis('COORDENADOR')
  validar(@Param('id') id: string) {
    return this.bancas.validar(id);
  }
}
