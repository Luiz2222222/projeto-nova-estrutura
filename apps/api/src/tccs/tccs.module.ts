import { Module } from '@nestjs/common';
import { TccsController } from './tccs.controller';
import { TccsService } from './tccs.service';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';

@Module({
  imports: [AutenticacaoModule], // fornece GuardaJwt + JwtModule
  controllers: [TccsController],
  providers: [TccsService, GuardaPapeis],
})
export class TccsModule {}
