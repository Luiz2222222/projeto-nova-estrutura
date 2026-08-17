import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventosTccService } from '../eventos-tcc/eventos-tcc.service';
import { CAMPO_PRAZO, formatarPrazo } from '../comum/prazo-etapa';

// Lembretes do prazo de AVALIAÇÃO DE CONTINUIDADE.
//
// Substituem o antigo pedido disparado na aprovação da abertura — que chegava semanas antes
// do prazo e era esquecido. Agora o orientador é cobrado só quando a data se aproxima:
// 2 dias antes, 1 dia antes e no próprio dia.
//
// Só é lembrado quem NÃO respondeu: confirmar a continuidade ou descontinuar o TCC tira o
// orientador da fila na mesma hora (a consulta olha o estado atual, não uma lista congelada).
export const EVENTO_LEMBRETE = 'orientador_lembrete_continuidade';
const FUSO = 'America/Fortaleza';

// Quantos dias antes do prazo cada lembrete sai. 0 = no próprio dia.
export const DIAS_LEMBRETE = [2, 1, 0] as const;
export type DiasLembrete = (typeof DIAS_LEMBRETE)[number];

// Título distinto por lembrete: é ele, junto do link (que carrega o tccId), que impede o
// mesmo aviso de sair duas vezes — em reinício da API, rodada repetida ou erro no meio.
export function tituloLembrete(dias: DiasLembrete): string {
  if (dias === 2) return '[Ação pendente] Continuidade do TCC — faltam 2 dias';
  if (dias === 1) return '[Ação pendente] Continuidade do TCC — falta 1 dia';
  return '[Ação pendente] Continuidade do TCC — último dia do prazo';
}

export function corpoLembrete(dias: DiasLembrete, titulo: string, aluno: string, prazo: string): string {
  const cabeca = `A avaliação de continuidade do TCC "${titulo}", do orientando ${aluno}, está pendente.`;
  const fim =
    dias === 0
      ? `O prazo termina hoje, ${prazo} — sem essa avaliação, o TCC não avança para a formação da banca da Fase I.`
      : `O prazo termina em ${prazo} — ${dias === 1 ? 'falta 1 dia' : 'faltam 2 dias'}.`;
  return `${cabeca}\n\nAcesse o sistema para registrar a avaliação de progresso. ${fim}`;
}

// Data "de hoje" no fuso do curso, como AAAA-MM-DD (o servidor pode estar em UTC).
export function diaEmFortaleza(instante: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

// Quantos dias inteiros faltam entre hoje e o prazo, contando pelo CALENDÁRIO (não por
// 24h): comparar instantes daria "1,4 dia" e erraria o disparo perto da meia-noite.
export function diasAte(prazo: Date, agora: Date): number {
  const dia = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const hoje = dia(diaEmFortaleza(agora));
  const alvo = dia(diaEmFortaleza(prazo));
  return Math.round((alvo - hoje) / 86_400_000);
}

@Injectable()
export class LembretesContinuidadeService {
  private readonly logger = new Logger('LembretesContinuidade');

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosTccService,
  ) {}

  // Uma rodada. Idempotente: pode rodar quantas vezes quiser no mesmo dia.
  async enviarLembretes(agora: Date = new Date()): Promise<{ enviados: number; pulados: number }> {
    // Sem prazo cadastrado no calendário não há o que lembrar.
    const calendarios = await this.prisma.calendario.findMany({
      where: { [CAMPO_PRAZO.CONTINUIDADE]: { not: null } },
      select: { semestre: true, [CAMPO_PRAZO.CONTINUIDADE]: true } as any,
    });

    let enviados = 0;
    let pulados = 0;
    for (const cal of calendarios as unknown as { semestre: string; avaliacaoContinuidade: Date }[]) {
      const faltam = diasAte(cal.avaliacaoContinuidade, agora);
      if (!DIAS_LEMBRETE.includes(faltam as DiasLembrete)) continue; // fora da janela
      const dias = faltam as DiasLembrete;
      const prazo = formatarPrazo(cal.avaliacaoContinuidade);
      if (!prazo) continue;

      // PENDENTE = ainda em desenvolvimento e sem decisão de continuidade. Quem confirmou ou
      // descontinuou sai daqui automaticamente, sem precisar de nenhuma marcação extra.
      const pendentes = await this.prisma.tcc.findMany({
        where: {
          excluidoEm: null,
          semestre: cal.semestre,
          faseAtual: 'DESENVOLVIMENTO',
          continuidadeConfirmada: false,
          orientadorId: { not: null },
        },
        select: { id: true, titulo: true, orientadorId: true, aluno: { select: { nomeCompleto: true } } },
      });

      for (const tcc of pendentes) {
        const titulo = tituloLembrete(dias);
        const link = `/professor/orientandos/${tcc.id}#acao`;
        // Trava durável contra repetição: a própria notificação interna já criada serve de
        // registro. Nada de Set em memória, que sumiria no reinício.
        const jaAvisado = await this.prisma.notificacao.findFirst({
          where: { usuarioId: tcc.orientadorId!, evento: EVENTO_LEMBRETE, titulo, link },
          select: { id: true },
        });
        if (jaAvisado) {
          pulados++;
          continue;
        }
        const corpo = corpoLembrete(dias, tcc.titulo, tcc.aluno?.nomeCompleto ?? 'sem nome', prazo);
        await this.eventos.emitirParaUsuario(EVENTO_LEMBRETE, tcc.orientadorId, titulo, corpo, link);
        enviados++;
      }
    }
    if (enviados || pulados) {
      this.logger.log(`Lembretes de continuidade: ${enviados} enviado(s), ${pulados} já avisado(s) antes.`);
    }
    return { enviados, pulados };
  }
}
