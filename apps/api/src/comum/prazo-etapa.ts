// Prazo da etapa citado nos e-mails de fluxo.
//
// Cada aviso fala do marco que a PESSOA precisa cumprir, não do marco da etapa seguinte.
// O calendário é por semestre e todos os campos são opcionais — quando a coordenação não
// preencheu o marco, o e-mail troca a data por uma frase curta em vez de mostrar "null".
import type { PrismaService } from '../prisma/prisma.service';

const FUSO = 'America/Fortaleza';

// Etapa -> campo do Calendario. Só o que é usado em e-mail entra aqui.
export const CAMPO_PRAZO = {
  DOCUMENTOS_INICIAIS: 'envioDocumentos',
  CONTINUIDADE: 'avaliacaoContinuidade',
  MONOGRAFIA: 'submissaoMonografia',
  AVALIACAO_FASE1: 'avaliacaoFase1',
  AVALIACAO_FASE2: 'apresentacaoFase2',
  VERSAO_FINAL: 'ajustesFinais',
} as const;

export type EtapaPrazo = keyof typeof CAMPO_PRAZO;

// dd/MM/aaaa no fuso oficial do curso (o servidor pode estar em UTC).
export function formatarPrazo(data: Date | string | null | undefined): string | null {
  if (!data) return null;
  const d = data instanceof Date ? data : new Date(data);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

// Data do marco daquela etapa no semestre do TCC. `null` = não cadastrado.
//
// NUNCA lança: isto é enfeite de texto de e-mail e roda no meio de ações acadêmicas
// (aprovar solicitação, avaliar monografia...). Uma falha ao ler o calendário não pode
// derrubar a ação — o aviso sai com a frase curta e o fluxo segue.
export async function prazoDaEtapa(
  prisma: PrismaService,
  semestre: string,
  etapa: EtapaPrazo,
): Promise<string | null> {
  try {
    const cal = await prisma.calendario.findFirst({ where: { semestre } });
    if (!cal) return null;
    return formatarPrazo((cal as unknown as Record<string, Date | null>)[CAMPO_PRAZO[etapa]]);
  } catch {
    return null;
  }
}

// Frase de prazo pronta. Com data, usa o molde; sem data, a versão curta — nunca some com a
// orientação de ficar de olho no calendário.
export const SEM_PRAZO = 'Fique atento aos prazos do semestre.';

export function frasePrazo(prazo: string | null, molde: (data: string) => string): string {
  return prazo ? molde(prazo) : SEM_PRAZO;
}

// Atalho para o molde mais comum nos avisos de etapa.
export function fraseEtapa(prazo: string | null): string {
  return frasePrazo(prazo, (d) => `O prazo desta etapa é ${d}.`);
}
