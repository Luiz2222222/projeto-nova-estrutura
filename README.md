# Sistema de Gestão de TCC

Monorepo do sistema de TCC do DEE (2 cursos de graduação).

## Estrutura
- `apps/api` — backend (NestJS + Prisma + **SQLite**)
- `apps/web` — frontend (React + Vite)
- `pacotes/compartilhado` — tipos e validações usados pelos dois lados

## Como rodar (desenvolvimento)
1. `npm install` (na raiz)
2. Copiar `apps/api/.env.example` para `apps/api/.env` (o padrão já usa SQLite em `file:./dev.db`)
3. `npm run api` — sobe a API em http://localhost:3000
4. `npm run web` — sobe a tela em http://localhost:5173

## Banco de dados e arquivos

O projeto usa **SQLite** (um arquivo no disco, apontado por `DATABASE_URL`) e guarda os **uploads
localmente** na pasta `apps/api/uploads/`. O provider do Prisma está fixado em `sqlite`
(`apps/api/prisma/schema.prisma`): **não** é possível migrar para PostgreSQL apenas trocando a
`DATABASE_URL` — isso exigiria mudar o provider e recriar as migrations.

## Produção

Mesmo em produção o sistema roda em **SQLite + uploads locais** (a mesma arquitetura do dev).
Por isso, o servidor precisa de um **volume persistente** e de **backup regular** para os DOIS:

- o arquivo do banco SQLite (ex.: `file:/dados/prod.db`);
- a pasta de uploads (`apps/api/uploads/`), com os documentos enviados (plano, termo, monografia,
  versão final, documento da banca).

Se o disco/volume for efêmero (ex.: container recriado a cada deploy), **banco e documentos são
perdidos**. Faça backup dos dois juntos e no mesmo instante (eles se referenciam: o banco guarda o
caminho dos arquivos). Defina também `JWT_SEGREDO` e `NODE_ENV=production` (ver `.env.example`).

Documentos de contexto: `../ARQUITETURA.md`, `../DETALHES.md`.
