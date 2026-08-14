import { ConflictException, NotFoundException } from '@nestjs/common';

const MSG_ENCERRANDO =
  'Este período está sendo encerrado e arquivado pela coordenação. Nenhuma alteração é aceita até o processo terminar.';

// Recusa (409) qualquer ação sobre um semestre que está sendo encerrado. Sem esta trava,
// um TCC criado/alterado durante o encerramento poderia ser apagado sem ter sido arquivado.
//
// Custo: uma leitura de UMA linha. Quando não há encerramento em curso (o caso normal),
// para por aqui e nem consulta o semestre do TCC.
export async function exigirPeriodoAberto(
  db: { periodoEncerramento?: { findFirst: (args: any) => Promise<{ semestre: string } | null> } },
  semestre: string | null | undefined,
): Promise<void> {
  if (!db.periodoEncerramento) return; // dublês de teste que não modelam a trava
  const travado = await db.periodoEncerramento.findFirst({ where: { status: 'ENCERRANDO' } });
  if (travado && semestre && travado.semestre === semestre) {
    throw new ConflictException({ mensagem: MSG_ENCERRANDO });
  }
}

// Um TCC está "ativo" quando existe e NÃO tem soft delete (excluidoEm == null). É um TYPE
// GUARD: além de retornar boolean, estreita o tipo para T (não-nulo) após a checagem —
// preservando o tipo com include. Regra pura (testável) usada pelo gate abaixo e por rotas
// que carregam o TCC por id (ex.: export de um TCC específico).
export function tccEstaAtivo<T extends { excluidoEm?: Date | null }>(
  tcc: T | null | undefined,
): tcc is T {
  return !!tcc && !tcc.excluidoEm;
}

// Busca um TCC pelo id e FALHA (404) se ele não existir OU se estiver excluído logicamente
// (excluidoEm != null). Use em TODO fluxo que age sobre um TCC por id — assim um TCC com
// soft delete some não só das listas, mas também dos fluxos ativos via chamada direta de API.
//
// Aceita tanto o PrismaService quanto um client de transação (tx). `args` permite passar
// include/select; o tipo de retorno é inferido do findUnique correspondente.
export async function buscarTccAtivoOuFalhar<T extends { excluidoEm?: Date | null }>(
  db: {
    tcc: { findUnique: (args: any) => Promise<T | null> };
    periodoEncerramento?: { findFirst: (args: any) => Promise<{ semestre: string } | null> };
  },
  tccId: string,
  args: Record<string, any> = {},
): Promise<T> {
  const tcc = await db.tcc.findUnique({ where: { id: tccId }, ...args });
  if (!tccEstaAtivo(tcc)) throw new NotFoundException({ mensagem: 'TCC não encontrado.' });

  // Este é o ponto por onde passam TODOS os fluxos que agem sobre um TCC por id, então é
  // aqui que a trava de encerramento pega criação de documento, avaliação, edição, defesa
  // etc. de uma vez só. `semestre` pode não vir no select do chamador — nesse caso é lido
  // à parte, e só quando existe encerramento em curso.
  const comSemestre = tcc as unknown as { semestre?: string };
  if (comSemestre.semestre !== undefined) {
    await exigirPeriodoAberto(db, comSemestre.semestre);
  } else if (db.periodoEncerramento) {
    const travado = await db.periodoEncerramento.findFirst({ where: { status: 'ENCERRANDO' } });
    if (travado) {
      const so = (await db.tcc.findUnique({ where: { id: tccId }, select: { semestre: true } } as any)) as unknown as
        | { semestre?: string }
        | null;
      if (so?.semestre === travado.semestre) throw new ConflictException({ mensagem: MSG_ENCERRANDO });
    }
  }
  return tcc; // narrowed para T pelo type guard
}
