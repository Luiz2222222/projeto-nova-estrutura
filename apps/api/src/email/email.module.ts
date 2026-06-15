import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

// Global: o EmailService fica injetável em qualquer módulo (auth, tccs, bancas,
// coordenação) sem precisar reimportar.
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
