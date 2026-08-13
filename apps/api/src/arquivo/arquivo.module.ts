import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';
import { DriveModule } from '../drive/drive.module';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { ArquivoController } from './arquivo.controller';
import { EncerramentoService } from './encerramento.service';
import { HistoricoArquivadoService } from './historico-arquivado.service';

@Module({
  imports: [PrismaModule, AutenticacaoModule, DriveModule],
  controllers: [ArquivoController],
  providers: [EncerramentoService, HistoricoArquivadoService, GuardaPapeis],
  exports: [EncerramentoService, HistoricoArquivadoService],
})
export class ArquivoModule {}
