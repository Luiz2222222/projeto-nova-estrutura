import { ConflictException, NotFoundException } from '@nestjs/common';

const MSG_ENCERRANDO =
  'Este período está sendo encerrado e arquivado pela coordenação. Nenhuma alteração é aceita até o processo terminar.';
const MSG_ENCERRADO =
  'Este período já foi encerrado e arquivado. Para novas atividades, a coordenação precisa configurar/selecionar outro semestre no Planejamento.';

interface DbComTrava {
  periodoEncerramento?: { findFirst: (args: any) => Promise<{ status: string } | null> };
}

// Recusa (409) qualquer ação sobre um semestre encerrado ou em encerramento.
//
//  ENCERRANDO → temporário: o arquivamento está rodando agora.
//  ENCERRADO  → definitivo: o período saiu do ar; sem isto, um aluno ainda conseguiria
//               abrir TCC num semestre já arquivado (se ele seguisse ativo no Planejamento).
//
// Custo: a leitura de UMA linha, direto pelo semestre.
export async function exigirPeriodoAberto(db: DbComTrava, semestre: string | null | undefined): Promise<void> {
  if (!db.periodoEncerramento || !semestre) return; // dublês de teste / sem semestre a checar
  const trava = await db.periodoEncerramento.findFirst({ where: { semestre } });
  if (!trava) return;
  if (trava.status === 'ENCERRANDO') throw new ConflictException({ mensagem: MSG_ENCERRANDO });
  if (trava.status === 'ENCERRADO') throw new ConflictException({ mensagem: MSG_ENCERRADO });
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
  db: { tcc: { findUnique: (args: any) => Promise<T | null> } } & DbComTrava,
  tccId: string,
  args: Record<string, any> = {},
): Promise<T> {
  const tcc = await db.tcc.findUnique({ where: { id: tccId }, ...args });
  if (!tccEstaAtivo(tcc)) throw new NotFoundException({ mensagem: 'TCC não encontrado.' });

  // Este é o ponto por onde passam TODOS os fluxos que agem sobre um TCC por id, então é
  // aqui que a trava pega criação de documento, avaliação, edição, defesa etc. de uma vez.
  // `semestre` costuma vir junto (include traz os escalares); quando o chamador usou um
  // select que o omite, buscamos só esse campo — em ambos os casos a MESMA regra vale.
  let semestre = (tcc as unknown as { semestre?: string }).semestre;
  if (semestre === undefined && db.periodoEncerramento) {
    const so = (await db.tcc.findUnique({ where: { id: tccId }, select: { semestre: true } } as any)) as unknown as
      | { semestre?: string }
      | null;
    semestre = so?.semestre;
  }
  await exigirPeriodoAberto(db, semestre);
  return tcc; // narrowed para T pelo type guard
}
