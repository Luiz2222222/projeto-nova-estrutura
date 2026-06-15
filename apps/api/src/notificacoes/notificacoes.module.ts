import { Global, Module } from '@nestjs/common';
import { NotificacoesController } from './notificacoes.controller';
import { NotificacoesService } from './notificacoes.service';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';

// Global: o NotificacoesService fica injetável nos fluxos (tccs/bancas) para
// criar notificações nos mesmos pontos onde já se dispara e-mail.
@Global()
@Module({
  imports: [AutenticacaoModule], // fornece GuardaJwt
  controllers: [NotificacoesController],
  providers: [NotificacoesService],
  exports: [NotificacoesService],
})
export class NotificacoesModule {}
