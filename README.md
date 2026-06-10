# Sistema de Gestão de TCC

Monorepo do sistema de TCC do DEE (2 cursos de graduação).

## Estrutura
- `apps/api` — backend (NestJS + Prisma + PostgreSQL)
- `apps/web` — frontend (React + Vite)
- `pacotes/compartilhado` — tipos e validações usados pelos dois lados

## Como rodar (desenvolvimento)
1. `npm install` (na raiz)
2. Configurar `apps/api/.env` com a conexão do PostgreSQL (`DATABASE_URL`)
3. `npm run api` — sobe a API em http://localhost:3000
4. `npm run web` — sobe a tela em http://localhost:5173

Documentos de contexto: `../ARQUITETURA.md`, `../DETALHES.md`.
