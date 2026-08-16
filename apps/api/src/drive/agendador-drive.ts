import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DriveSyncService } from './drive-sync.service';

// Uma única sincronização automática por dia, às 23:00 no fuso oficial do curso.
export const HORA_SYNC = 23;
export const FUSO_SYNC = 'America/Fortaleza';

// Próxima ocorrência REAL das 23:00 em Fortaleza, em instante UTC.
//
// De propósito não é `setInterval(24h)` a partir do boot: aquilo deriva a cada reinício e o
// horário vira "24h depois de quando a API subiu", não 23:00. Aqui a hora de parede manda.
// Fortaleza é UTC-3 fixo (não tem horário de verão), então converter é somar 3h — mas a
// data/hora corrente é lida pelo fuso, não pelo relógio do servidor, que pode estar em UTC.
export function proximaExecucao(agora: Date = new Date()): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_SYNC,
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

  const ano = Number(p.year);
  const mes = Number(p.month);
  const dia = Number(p.day);
  const segundosAgora = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);

  // Já passou das 23:00 de hoje (ou é exatamente 23:00:00): vai para amanhã.
  const paraAmanha = segundosAgora >= HORA_SYNC * 3600;
  const OFFSET_H = 3; // Fortaleza = UTC-3: 23:00 lá é 02:00 UTC do dia seguinte.
  return new Date(Date.UTC(ano, mes - 1, dia + (paraAmanha ? 1 : 0), HORA_SYNC + OFFSET_H, 0, 0, 0));
}

// Agendador do Drive. NÃO roda no boot e NÃO roda de minuto em minuto: o Drive é cópia
// externa, não caminho crítico. O fluxo acadêmico só grava na fila; ela é drenada na rodada
// diária ou quando o coordenador clica em "Atualizar" (POST /drive/sincronizar).
@Injectable()
export class AgendadorDrive implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AgendadorDrive');
  private timer?: NodeJS.Timeout;
  private rodando = false;
  private encerrado = false;

  constructor(private readonly sync: DriveSyncService) {}

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
    const espera = Math.max(1000, alvo.getTime() - Date.now());
    this.timer = setTimeout(() => void this.rodadaDiaria(), espera);
    this.timer.unref?.();
    this.logger.log(`Próxima sincronização automática do Drive: ${alvo.toISOString()} (23:00 em ${FUSO_SYNC}).`);
  }

  // Rodada completa: reenfileira erros -> reconcilia a partir do banco -> processa a fila.
  // É a mesma sequência do botão "Atualizar", e inclui a limpeza de pasta duplicada.
  private async rodadaDiaria() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const r = await this.sync.sincronizarAgora();
      this.logger.log(
        `Sincronização diária do Drive: ${r.reenfileirados} reenfileirado(s), ${r.tccs} TCC(s), ` +
          `${r.documentos} documento(s) novo(s), ${r.processados} processado(s), ${r.falhas} com erro.`,
      );
    } catch (e) {
      this.logger.error('Falha na sincronização diária do Drive: ' + (e as Error).message);
    } finally {
      this.rodando = false;
      // Reagenda SEMPRE, tendo dado certo ou não: um erro de hoje não pode matar o de amanhã.
      this.agendarProxima();
    }
  }
}
