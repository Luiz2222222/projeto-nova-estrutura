import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { AutenticacaoModule } from './autenticacao/autenticacao.module';
import { TccsModule } from './tccs/tccs.module';
import { CoordenacaoModule } from './coordenacao/coordenacao.module';
import { BancasModule } from './bancas/bancas.module';
import { SaudeController } from './saude/saude.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EmailModule,
    AutenticacaoModule,
    TccsModule,
    CoordenacaoModule,
    BancasModule,
  ],
  controllers: [SaudeController],
})
export class ModuloPrincipal {}
