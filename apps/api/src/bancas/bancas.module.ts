import { Module } from '@nestjs/common';
import { BancasController } from './bancas.controller';
import { BancasService } from './bancas.service';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';

@Module({
  imports: [AutenticacaoModule], // fornece GuardaJwt + JwtModule
  controllers: [BancasController],
  providers: [BancasService, GuardaPapeis],
})
export class BancasModule {}
