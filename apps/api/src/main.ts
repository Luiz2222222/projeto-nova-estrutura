import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { ModuloPrincipal } from './principal.module';

async function iniciar() {
  const app = await NestFactory.create(ModuloPrincipal);

  app.use(cookieParser());

  // Allowlist de origens (CORS_ORIGENS no .env, separadas por vírgula). Padrão: Vite local.
  const origens = (process.env.CORS_ORIGENS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origens, credentials: true });

  const porta = process.env.PORT ?? 3000;
  await app.listen(porta);
  // eslint-disable-next-line no-console
  console.log(`API do TCC no ar em http://localhost:${porta}`);
}

iniciar();
