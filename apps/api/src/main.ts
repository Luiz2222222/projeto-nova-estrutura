import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { ModuloPrincipal } from './principal.module';

async function iniciar() {
  const app = await NestFactory.create(ModuloPrincipal);

  // Atrás de proxy reverso (Nginx/Apache), req.ip precisa vir do X-Forwarded-For, senão o
  // rate limit por IP enxerga todos os usuários com o IP DO PROXY (lockout coletivo).
  // TRUST_PROXY = nº de proxies confiáveis à frente (ex.: 1). Sem a variável, fica 0
  // (comportamento atual, correto quando a API é exposta direto) — nunca confiar às cegas,
  // pois X-Forwarded-For é forjável por quem fala direto com o Node.
  const trustProxy = Number(process.env.TRUST_PROXY ?? 0);
  if (trustProxy > 0) app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);

  app.use(cookieParser());

  // Allowlist de origens (CORS_ORIGENS no .env, separadas por vírgula). Padrão: Vite local.
  const origens = (process.env.CORS_ORIGENS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origens, credentials: true });

  const porta = process.env.PORT ?? 3000;
  await app.listen(porta);
  console.log(`API do TCC no ar em http://localhost:${porta}`);
}

iniciar();
