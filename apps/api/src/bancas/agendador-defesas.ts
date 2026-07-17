import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BancasService } from './bancas.service';

// Agendador das defesas (Fase II): roda na inicialização e a cada minuto, liberando a
// avaliação dos TCCs cuja data/hora de defesa já venceu — mesmo sem ninguém com a tela
// aberta. A liberação em si é idempotente (updateMany condicional no BancasService),
// então rodadas simultâneas ou repetidas nunca liberam/notificam duas vezes.
// Sem dependência nova: setInterval nativo amarrado ao ciclo de vida do Nest.
@Injectable()
export class AgendadorDefesas implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AgendadorDefesas');
  private timer?: NodeJS.Timeout;

  constructor(private readonly bancas: BancasService) {}

  onModuleInit() {
    void this.rodar(); // varredura imediata na subida (pega defesas vencidas com a API parada)
    this.timer = setInterval(() => void this.rodar(), 60_000);
    this.timer.unref?.(); // não impede o processo de encerrar (importante nos testes)
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async rodar() {
    try {
      const liberadas = await this.bancas.liberarDefesasVencidas();
      if (liberadas > 0) this.logger.log(`Avaliação da Fase II liberada para ${liberadas} TCC(s) com defesa vencida.`);
    } catch (e) {
      this.logger.error('Falha na varredura de defesas vencidas: ' + (e as Error).message);
    }
  }
}
