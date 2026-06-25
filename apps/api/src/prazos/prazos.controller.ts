import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PrazosService } from './prazos.service';
import { GuardaJwt } from '../autenticacao/guarda-jwt';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { Papeis } from '../comum/papeis.decorator';

// Liberações de prazo (só coordenador). Liberar/bloquear é um TOGGLE: a presença da
// liberação = permitido fora do prazo; remover = volta a respeitar o prazo global.
@Controller()
@UseGuards(GuardaJwt, GuardaPapeis)
@Papeis('COORDENADOR')
export class PrazosController {
  constructor(private readonly prazos: PrazosService) {}

  // Estado das etapas restritivas de um TCC (para a seção "Liberações de prazo").
  @Get('tccs/:id/liberacoes')
  liberacoesTcc(@Param('id') id: string) {
    return this.prazos.estadoPorTccId(id);
  }

  // Liberar/bloquear (toggle) uma etapa de um TCC. Devolve { etapa, liberado }.
  @Post('tccs/:id/liberacoes/:etapa')
  alternarTcc(@Param('id') id: string, @Param('etapa') etapa: string) {
    return this.prazos.alternarPorTccId(id, etapa);
  }

  // Abertura (ENVIO_DOCUMENTOS) por aluno+semestre — antes de existir TCC.
  @Get('coordenacao/alunos-liberacao')
  alunosAbertura() {
    return this.prazos.listaAlunosAbertura();
  }

  @Post('coordenacao/alunos/:alunoId/liberacao-abertura')
  alternarAbertura(@Param('alunoId') alunoId: string) {
    return this.prazos.alternarAberturaAluno(alunoId);
  }
}
