# ESTADO DO PROJETO — leia isto primeiro

> Documento de continuidade. Se você é uma IA/dev que pegou este projeto **sem contexto**,
> leia este arquivo inteiro + `docs/ARQUITETURA.md` (visão geral, fluxo do TCC e regras) +
> `docs/DETALHES.md` (decisões finas por área) + `apps/web/.interface-design/system.md` (design).
> Convenção do projeto: **nomes em português** sempre que possível (arquivos, variáveis,
> entidades, rotas). Só fica em inglês o que é nativo de framework/lib.

Última atualização: 2026-06-07.

---

## 1. O que é
Reconstrução do sistema de gestão de TCC do **DEE** (graduação; 2 cursos: Engenharia Elétrica
e Controle e Automação). O projeto antigo (Django+React) em `../Docs/Portal` é **só referência
de domínio** (somente leitura) — o stack dele foi abandonado. Regras de nota oficiais vêm do
PDF de orientações (resumidas em `docs/ARQUITETURA.md`).

## 2. Stack
Monorepo (npm workspaces): **NestJS + Prisma** (API) · **React + Vite + TypeScript** (web) ·
**Zod** compartilhado · **SQLite** em dev (troca p/ PostgreSQL em produção) ·
auth **e-mail/senha (JWT em cookie httpOnly)** · senhas com **bcrypt**.

```
Projeto/
  apps/api    → backend NestJS (módulos em src/, Prisma em prisma/)
  apps/web    → frontend React (telas em src/paginas, componentes em src/componentes)
  pacotes/compartilhado → tipos + listas + schemas Zod (build p/ dist, consumido pelos dois)
  docs/       → ARQUITETURA.md, DETALHES.md (cópias do planejamento)
```

## 3. Como rodar (Windows)
> ⚠️ **Avast quebra o SSL do npm/Prisma** nesta máquina. A correção já está aplicada de forma
> permanente: a variável `NODE_EXTRA_CA_CERTS=C:\Users\guima\node-ca-bundle.pem` (bundle dos
> certificados raiz do Windows, incl. o do Avast). Em outra máquina, regerar o bundle e setar
> essa variável, senão `npm install`/`prisma` falham com `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

1. `npm install` (na raiz `Projeto/`).
2. Banco já existe (`apps/api/prisma/dev.db`). Para recriar do zero:
   `cd apps/api && npx prisma migrate dev && npx prisma db seed`.
3. Se mexer em `pacotes/compartilhado`, rode `npm run build` lá (gera `dist/`, consumido por api e web).
4. `npm run api` → API em http://localhost:3000
5. `npm run web` → tela em http://localhost:5173

### Credenciais / códigos de teste (vêm do seed)
- Coordenador: **coordenador@dee.br** / senha **coordenador** (coordenador não se cadastra pela tela).
- Códigos de cadastro: Aluno **ALUNO2026** · Professor **PROF2026** · Avaliador **AVAL2026**.

## 4. O que JÁ está pronto (e testado no navegador)
- **Fundação:** monorepo, API sobe, web sobe, banco SQLite + Prisma (modelos `Usuario`,
  `CodigoCadastro`).
- **Autenticação (backend):** `POST /autenticacao/cadastro`, `POST /autenticacao/login`
  (cookie JWT; "manter login" = 7 dias, senão sessão), `POST /autenticacao/sair`,
  `GET /autenticacao/eu` (protegido por `GuardaJwt`). Validação via Zod (`ZodValidacaoPipe`).
- **Autenticação (web):** tela de **login** (vidro branco + logo DEE), **cadastro em modal de
  2 passos** (escolher categoria → formulário; campo "Outros" abre campo livre; "Confirmar
  senha"), home placeholder, `RotaProtegida`, contexto de auth (`autenticacao/contexto.tsx`).
- **Design:** paleta branca + acento azul-céu (#0EA5E9), logo do DEE (`apps/web/public/Logo.png`;
  há também Logo2.png e Logo3.png disponíveis). Sistema salvo em `apps/web/.interface-design/system.md`.

## 5. O que FALTA (próximos passos, em ordem)
1. **Domínio do TCC — perfil do ALUNO (fatia: abrir TCC)** ✔ **PRONTO e testado de ponta a ponta.**
   - Backend: modelos `Tcc` / `SolicitacaoOrientacao` / `DocumentoTcc`; guarda de papéis
     (`comum/guarda-papeis.ts` + `@Papeis`); módulo `tccs` (professores-disponiveis,
     coorientadores, criar, meu, cancelar, upload documentos, pendentes, aprovar, recusar,
     baixar documento). Storage local em `apps/api/uploads/`. Aprovar move INICIALIZACAO → DESENVOLVIMENTO.
   - Frontend: **roteamento por papel** (`/aluno`, `/coordenador`, `/inicio`), `LayoutApp`
     (barra + Outlet), `PainelAluno` (abrir/status/jornada/cancelar), `AbrirTcc` (form + upload),
     `PainelCoordenador` (pendentes + aprovar/recusar com parecer + baixar docs).
   - Próximo no perfil do aluno: **reenviar/editar após recusa**; depois enviar monografia
     (fase DESENVOLVIMENTO). Demais perfis (orientador, coordenador completo, avaliador) e fases
     seguintes pelo fluxo em `docs/ARQUITETURA.md` / `docs/fluxograma-interativo.html`.
2. **Modo administrador do coordenador** (editar/forçar/ criar/**excluir de vez** TCC) — ver DETALHES §5.
3. **Recuperação de senha + infraestrutura de e-mail** (ADIADO a pedido do cliente). Link
   "Esqueci minha senha" já existe no login, porém inerte.
4. **Criação de coordenador** (decisão adiada — não há admin do Django; definir seed/fluxo).
5. Trocar SQLite → PostgreSQL quando for publicar (mudar `provider` no `schema.prisma` + `DATABASE_URL`).

## 6. Armadilhas / decisões que economizam tempo
- **Avast/SSL:** ver seção 3 (NODE_EXTRA_CA_CERTS).
- **pacote compartilhado:** é buildado p/ `dist` (CJS+ESM via tsc/main). A API usa via require;
  o Vite precisa de `optimizeDeps.include: ['@tcc/compartilhado']` (já configurado) porque é
  pacote linkado. Se mudar o pacote, **rebuild**.
- **Modal:** o cartão de login usa `backdrop-filter`, o que prende `position:fixed`. Por isso o
  `Modal` usa `createPortal(document.body)`. Não remover o portal.
- **SQLite:** enums viraram `String` no schema (portável p/ Postgres). Valores válidos ficam no
  pacote compartilhado e são validados com Zod.
- **Regras de nota:** Fase I aprova com NF1 ≥ 6; nota final **NF = 0,6·NF1 + 0,4·NF2**, aprova
  com NF ≥ 7. (O código antigo tinha um bug que usava média simples ≥6 — seguir o regulamento.)

## 7. Documentos de referência
- `docs/ARQUITETURA.md` — domínio, **fluxo completo do TCC**, regras de nota, modelo de dados, roadmap.
- `docs/DETALHES.md` — backlog de detalhes por área (cadastro fechado; resto a preencher).
- `apps/web/.interface-design/system.md` — sistema de design (cores, componentes, padrões).
- `docs/fluxograma-interativo.html` — simulador interativo do fluxo do TCC (abrir no navegador). Confere com a seção de fluxo do ARQUITETURA.md.
