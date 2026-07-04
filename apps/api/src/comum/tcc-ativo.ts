import { NotFoundException } from '@nestjs/common';

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
  db: { tcc: { findUnique: (args: any) => Promise<T | null> } },
  tccId: string,
  args: Record<string, any> = {},
): Promise<T> {
  const tcc = await db.tcc.findUnique({ where: { id: tccId }, ...args });
  if (!tccEstaAtivo(tcc)) throw new NotFoundException({ mensagem: 'TCC não encontrado.' });
  return tcc; // narrowed para T pelo type guard
}
