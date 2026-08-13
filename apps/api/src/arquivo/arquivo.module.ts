import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AutenticacaoModule } from '../autenticacao/autenticacao.module';
import { DriveModule } from '../drive/drive.module';
import { GuardaPapeis } from '../comum/guarda-papeis';
import { ArquivoController } from './arquivo.controller';
import { EncerramentoService } from './encerramento.service';
import { HistoricoArquivadoService } from './historico-arquivado.service';
import { BloqueioResetAntigo } from './bloqueio-reset-antigo';

@Module({
  imports: [PrismaModule, AutenticacaoModule, DriveModule],
  controllers: [ArquivoController],
  providers: [EncerramentoService, HistoricoArquivadoService, GuardaPapeis],
  exports: [EncerramentoService, HistoricoArquivadoService],
})
export class ArquivoModule implements NestModule {
  // Fecha a rota antiga POST /resetar: o encerramento de período passa a ter um caminho só.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(BloqueioResetAntigo).forRoutes({ path: 'resetar', method: RequestMethod.POST });
  }
}
