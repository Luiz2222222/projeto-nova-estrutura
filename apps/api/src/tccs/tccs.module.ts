import { Module } from '@nestjs/common';
import { TccsController } from './tccs.controller';
import { TccsService } from './tccs.service';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';
import { PrazosModule } from '../prazos/prazos.module';

@Module({
  imports: [AutenticacaoModule, PrazosModule], // fornece GuardaJwt + JwtModule + PrazosService
  controllers: [TccsController],
  providers: [TccsService, GuardaPapeis],
})
export class TccsModule {}
