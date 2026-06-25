import { Module } from '@nestjs/common';
import { BancasController } from './bancas.controller';
import { BancasService } from './bancas.service';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';
import { PrazosModule } from '../prazos/prazos.module';

@Module({
  imports: [AutenticacaoModule, PrazosModule], // fornece GuardaJwt + JwtModule + PrazosService
  controllers: [BancasController],
  providers: [BancasService, GuardaPapeis],
})
export class BancasModule {}
