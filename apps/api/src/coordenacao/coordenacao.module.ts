import { Module } from '@nestjs/common';
import { CoordenacaoController } from './coordenacao.controller';
import { CoordenacaoService } from './coordenacao.service';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';

@Module({
  imports: [AutenticacaoModule], // fornece GuardaJwt + JwtModule
  controllers: [CoordenacaoController],
  providers: [CoordenacaoService, GuardaPapeis],
})
export class CoordenacaoModule {}
