import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DriveSyncService } from './drive-sync.service';

const INTERVALO_MS = 60_000; // worker da fila
const VARREDURA_MS = 24 * 60 * 60 * 1000; // reenfileira erros uma vez por dia

// Worker da fila do Drive. Mesmo padrão do AgendadorDefesas: setInterval nativo amarrado ao
// ciclo de vida do Nest, sem dependência nova.
//
// O fluxo acadêmico NUNCA espera o Drive: ele só grava na fila. Se o Drive estiver fora,
// os itens ficam pendentes e voltam a ser tentados aqui — nada quebra para o usuário.
@Injectable()
export class AgendadorDrive implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AgendadorDrive');
  private timer?: NodeJS.Timeout;
  private timerDiario?: NodeJS.Timeout;
  private rodando = false;

  constructor(private readonly sync: DriveSyncService) {}

  onModuleInit() {
    void this.rodar();
    this.timer = setInterval(() => void this.rodar(), INTERVALO_MS);
    this.timer.unref?.();
    this.timerDiario = setInterval(() => void this.varreduraDiaria(), VARREDURA_MS);
    this.timerDiario.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.timerDiario) clearInterval(this.timerDiario);
  }

  // Guarda de reentrância: uma rodada lenta (upload grande) não pode empilhar com a próxima.
  private async rodar() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const { processados, falhas } = await this.sync.processarPendentes();
      if (processados || falhas) {
        this.logger.log(`Fila do Drive: ${processados} concluído(s), ${falhas} com erro.`);
      }
    } catch (e) {
      this.logger.error('Falha na rodada da fila do Drive: ' + (e as Error).message);
    } finally {
      this.rodando = false;
    }
  }

  // Rede de segurança diária: reenfileira erros E reconcilia os TCCs ativos. A reconciliação
  // é o que garante que um gancho esquecido no futuro não deixe TCC sem pasta nem documento
  // sem subir — ela recalcula o que falta direto do banco.
  private async varreduraDiaria() {
    try {
      const n = await this.sync.reenfileirarErros();
      if (n > 0) this.logger.log(`Varredura diária do Drive: ${n} item(ns) em erro reenfileirado(s).`);
      const { tccs, documentos } = await this.sync.reconciliar();
      if (documentos > 0) {
        this.logger.log(`Reconciliação: ${documentos} documento(s) sem sincronizar em ${tccs} TCC(s) ativo(s).`);
      }
    } catch (e) {
      this.logger.error('Falha na varredura diária do Drive: ' + (e as Error).message);
    }
  }
}
