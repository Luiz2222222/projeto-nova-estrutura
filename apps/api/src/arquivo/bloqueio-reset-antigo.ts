import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

// Desativa a rota antiga POST /resetar, que apagava os TCCs do período SEM exigir
// arquivamento no Drive — um segundo caminho destrutivo, em paralelo ao encerramento.
//
// O bloqueio é um middleware (roda ANTES do handler) porque o handler antigo vive em
// coordenacao.controller.ts / coordenacao.service.ts, arquivos que hoje carregam alterações
// locais não relacionadas: mexer neles arrastaria trabalho pendente para o commit. Assim a
// rota fica inalcançável sem tocar em uma linha desse código.
//
// Quando aquelas alterações forem concluídas, o handler e o service podem ser apagados de
// vez e este middleware some junto.
@Injectable()
export class BloqueioResetAntigo implements NestMiddleware {
  use(_req: Request, res: Response, _next: NextFunction) {
    // 410 Gone: o recurso existia e foi retirado de propósito (não é 404 nem erro do cliente).
    res.status(410).json({
      mensagem:
        'O "Resetar período" foi substituído por "Encerrar e arquivar período", que só apaga ' +
        'depois de arquivar tudo no Google Drive. Use o Planejamento → Arquivamento no Google Drive.',
    });
  }
}
