import { Module } from '@nestjs/common';
import { TccsController } from './tccs.controller';
import { TccsService } from './tccs.service';
import { HistoricoTccsService } from './historico-tccs.service';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';
import { PrazosModule } from '../prazos/prazos.module';
import { DriveModule } from '../drive/drive.module';

@Module({
  // DriveModule entra só para ENFILEIRAR o arquivamento; nenhuma rota espera o Drive.
  imports: [AutenticacaoModule, PrazosModule, DriveModule],
  controllers: [TccsController],
  providers: [TccsService, HistoricoTccsService, GuardaPapeis],
})
export class TccsModule {}
