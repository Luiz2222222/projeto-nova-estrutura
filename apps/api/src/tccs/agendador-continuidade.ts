import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LembretesContinuidadeService } from './lembretes-continuidade.service';

export const HORA_LEMBRETE = 8; // 08:00
export const FUSO_LEMBRETE = 'America/Fortaleza';

// Próxima ocorrência real das 08:00 em Fortaleza, como instante UTC.
//
// Não é setInterval(24h) a partir do boot: aquilo derivaria a cada reinício e o lembrete
// chegaria em horários aleatórios. Fortaleza é UTC-3 fixo (sem horário de verão), mas a
// data corrente é lida PELO FUSO, porque o servidor roda em UTC.
export function proximaExecucao(agora: Date = new Date()): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_LEMBRETE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const parte of fmt.formatToParts(agora)) p[parte.type] = parte.value;

  const segundosAgora = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
  const paraAmanha = segundosAgora >= HORA_LEMBRETE * 3600;
  const OFFSET_H = 3; // UTC-3: 08:00 em Fortaleza = 11:00 UTC
  return new Date(
    Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + (paraAmanha ? 1 : 0), HORA_LEMBRETE + OFFSET_H, 0, 0, 0),
  );
}

// Dispara os lembretes de continuidade uma vez por dia, às 08:00 de Fortaleza.
//
// Não roda no boot: reiniciar a API não pode virar motivo para reenviar aviso. A proteção
// contra repetição mora no serviço (consulta a notificação já criada), então uma rodada
// extra é inofensiva — mas evitar a rodada desnecessária é mais barato.
@Injectable()
export class AgendadorContinuidade implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AgendadorContinuidade');
  private timer?: NodeJS.Timeout;
  private rodando = false;
  private encerrado = false;

  constructor(private readonly lembretes: LembretesContinuidadeService) {}

  onModuleInit() {
    this.agendarProxima();
  }

  onModuleDestroy() {
    this.encerrado = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private agendarProxima() {
    if (this.encerrado) return;
    const alvo = proximaExecucao();
    this.timer = setTimeout(() => void this.rodada(), Math.max(1000, alvo.getTime() - Date.now()));
    this.timer.unref?.();
    this.logger.log(`Próximos lembretes de continuidade: ${alvo.toISOString()} (08:00 em ${FUSO_LEMBRETE}).`);
  }

  private async rodada() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.lembretes.enviarLembretes();
    } catch (e) {
      this.logger.error('Falha na rodada de lembretes de continuidade: ' + (e as Error).message);
    } finally {
      this.rodando = false;
      // Reagenda sempre: uma falha de hoje não pode matar o lembrete de amanhã.
      this.agendarProxima();
    }
  }
}
