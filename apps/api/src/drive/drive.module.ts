import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { DriveController } from './drive.controller';
import { DriveService } from './drive.service';
import { DriveSyncService } from './drive-sync.service';
import { AgendadorDrive } from './agendador-drive';

// Exporta o DriveSyncService para o fluxo acadêmico (TccsModule) apenas ENFILEIRAR —
// nenhuma tela espera o Drive responder.
@Module({
  imports: [PrismaModule, AutenticacaoModule], // AutenticacaoModule fornece GuardaJwt + JwtModule
  controllers: [DriveController],
  providers: [DriveService, DriveSyncService, AgendadorDrive, GuardaPapeis],
  exports: [DriveService, DriveSyncService],
})
export class DriveModule {}
