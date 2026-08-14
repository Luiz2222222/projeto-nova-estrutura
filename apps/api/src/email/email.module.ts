import { Global, Module } from '@nestjs/common';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';

// Global: o EmailService fica injetável em qualquer módulo (auth, tccs, bancas,
// coordenação) sem precisar reimportar.
//
// O controller daqui expõe SÓ a revelação da senha de app (reautenticada). O GET/PUT da
// configuração seguem na coordenação — este módulo não os duplica.
@Global()
@Module({
  imports: [AutenticacaoModule], // GuardaJwt + JwtModule
  controllers: [EmailController],
  providers: [EmailService, GuardaPapeis],
  exports: [EmailService],
})
export class EmailModule {}
