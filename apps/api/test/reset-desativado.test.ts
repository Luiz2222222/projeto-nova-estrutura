// Teste HTTP REAL da desativação do reset antigo: sobe um Nest de verdade com o middleware
// e um controller que finge ser o handler destrutivo. Se o middleware falhar, o handler roda
// e o teste acusa — é a garantia de que /resetar não é mais um caminho destrutivo.
//
// Sem @nestjs/testing nem supertest (não estão no projeto e adicionar dependência exigiria
// sua autorização): NestFactory + fetch nativo do Node dão o mesmo resultado.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Controller, MiddlewareConsumer, Module, NestModule, Post, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { BloqueioResetAntigo } from '../src/arquivo/bloqueio-reset-antigo';

// Marcador global: vira true SE o handler antigo for alcançado.
let handlerAntigoRodou = false;

@Controller()
class ControllerAntigoFalso {
  @Post('resetar')
  resetar() {
    handlerAntigoRodou = true; // não deve acontecer nunca
    return { apagados: 999 };
  }

  @Post('outra-rota')
  outra() {
    return { ok: true };
  }
}

// Mesma configuração de middleware do ArquivoModule real.
@Module({ controllers: [ControllerAntigoFalso] })
class ModuloTeste implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(BloqueioResetAntigo).forRoutes({ path: 'resetar', method: RequestMethod.POST });
  }
}

let app: INestApplication;
let base: string;

beforeAll(async () => {
  app = await NestFactory.create(ModuloTeste, { logger: false });
  await app.listen(0); // porta efêmera
  const { port } = app.getHttpServer().address();
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
});

describe('POST /resetar (rota antiga)', () => {
  it('responde 410 e NÃO executa o handler destrutivo', async () => {
    handlerAntigoRodou = false;
    const r = await fetch(`${base}/resetar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha: 'x', confirmacao: 'APAGAR' }),
    });

    expect(r.status).toBe(410);
    expect(handlerAntigoRodou).toBe(false); // nada foi apagado
  });

  it('a resposta explica o caminho novo', async () => {
    const r = await fetch(`${base}/resetar`, { method: 'POST' });
    const corpo: any = await r.json();
    expect(corpo.mensagem).toMatch(/Encerrar e arquivar período/i);
  });

  it('o middleware não afeta as demais rotas', async () => {
    const r = await fetch(`${base}/outra-rota`, { method: 'POST' });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ ok: true });
  });
});
