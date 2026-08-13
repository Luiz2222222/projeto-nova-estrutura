import { Module } from '@nestjs/common';
import { BancasController } from './bancas.controller';
import { BancasService } from './bancas.service';
import { DefesasService } from './defesas.service';
import { AgendadorDefesas } from './agendador-defesas';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';
import { PrazosModule } from '../prazos/prazos.module';
import { DriveModule } from '../drive/drive.module';

@Module({
  imports: [AutenticacaoModule, PrazosModule, DriveModule], // GuardaJwt + JwtModule + PrazosService + fila do Drive
  controllers: [BancasController],
  providers: [BancasService, DefesasService, AgendadorDefesas, GuardaPapeis],
})
export class BancasModule {}
