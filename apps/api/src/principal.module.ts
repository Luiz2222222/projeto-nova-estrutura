import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { NotificacoesModule } from './notificacoes/notificacoes.module';
import { EventosTccModule } from './eventos-tcc/eventos-tcc.module';
import { AutenticacaoModule } from './autenticacao/autenticacao.module';
import { TccsModule } from './tccs/tccs.module';
import { CoordenacaoModule } from './coordenacao/coordenacao.module';
import { BancasModule } from './bancas/bancas.module';
import { PrazosModule } from './prazos/prazos.module';
import { DriveModule } from './drive/drive.module';
import { ArquivoModule } from './arquivo/arquivo.module';
import { SaudeController } from './saude/saude.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EmailModule,
    NotificacoesModule,
    EventosTccModule,
    AutenticacaoModule,
    TccsModule,
    CoordenacaoModule,
    BancasModule,
    PrazosModule,
    DriveModule,
    ArquivoModule,
  ],
  controllers: [SaudeController],
})
export class ModuloPrincipal {}
