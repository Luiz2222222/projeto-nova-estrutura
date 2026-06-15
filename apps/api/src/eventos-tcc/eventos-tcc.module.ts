import { Global, Module } from '@nestjs/common';
import { EventosTccService } from './eventos-tcc.service';

// Global: o EventosTccService fica injetável nos fluxos (tccs/bancas).
// Reage aos eventos chamando EmailService e NotificacoesService (ambos @Global).
@Global()
@Module({
  providers: [EventosTccService],
  exports: [EventosTccService],
})
export class EventosTccModule {}
