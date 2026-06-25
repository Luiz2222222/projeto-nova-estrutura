import { Module } from '@nestjs/common';
import { PrazosService } from './prazos.service';
import { PrazosController } from './prazos.controller';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';

// PrismaModule é global, então não precisa importar aqui. Exporta PrazosService para
// os módulos de TCC e banca usarem o gate de prazo (exigirEtapaLiberada).
@Module({
  imports: [AutenticacaoModule], // fornece GuardaJwt + JwtModule
  providers: [PrazosService, GuardaPapeis],
  controllers: [PrazosController],
  exports: [PrazosService],
})
export class PrazosModule {}
