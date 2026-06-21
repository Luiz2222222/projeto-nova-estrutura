# ESTADO DO PROJETO — leia isto primeiro

> Documento de continuidade. Se você é uma IA/dev que pegou este projeto **sem contexto**,
> leia este arquivo inteiro + `docs/ARQUITETURA.md` (visão geral, fluxo do TCC e regras) +
> `docs/DETALHES.md` (decisões finas por área) + `apps/web/.interface-design/system.md` (design).
> Convenção do projeto: **nomes em português** sempre que possível (arquivos, variáveis,
> entidades, rotas). Só fica em inglês o que é nativo de framework/lib.

Última atualização: 2026-06-21.

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

### Credenciais / códigos de teste
O **login é o e-mail** do usuário; senhas com bcrypt (não há como recuperar — só resetar).
- Vêm do **seed** (`prisma db seed`, só fora de produção): Coordenador **adm / adm** · Aluno **aluno / aluno**.
- O `dev.db` atual também tem usuários criados manualmente/pela tela de cadastro que um seed
  novo **não** recria: **avaliador / avaliador** (avaliador externo), `prof@dee.br`, etc.
- Códigos de cadastro: Aluno **ALUNO2026** · Professor **PROF2026** · Avaliador **AVAL2026**.

## 4. O que JÁ está pronto
O **ciclo completo do TCC** está implementado (backend + telas dos 4 papéis), espelhando o
layout/fluxo do projeto antigo onde fazia sentido. Tudo passa em `build/lint/test/prisma`;
parte foi conferida no navegador, parte só por build (ver §5).

- **Fundação + auth:** monorepo, JWT em cookie httpOnly, cadastro por papel com código,
  recuperação de senha (e-mail dev/console por padrão, SMTP por `.env` ou pela UI do coordenador),
  notificações internas (sino), preferências individuais de e-mail.
- **Aluno:** abrir TCC (form + upload), dashboard com "Ação pendente / Próximo prazo / Fase atual",
  "Meu TCC" (`PainelAluno`) com timeline vertical/horizontal, Documentos, Informações, Mural.
  Envia monografia e versão final.
- **Orientador (professor):** dashboard espelhado, "Meus orientandos" (lista em cards →
  página interna `DetalheOrientando`): aprova/pede ajustes na monografia, confirma/descontinua
  continuidade, valida a versão final (a versão final é do **orientador**, não do coordenador).
- **Coordenador:** dashboard (ações pendentes + datas + TCCs por etapa), aba **TCCs** (lista
  com distribuição/filtros + cards) e **página interna** `TccDetalheCoordenador`:
  - **Formar banca da Fase I:** 2 dropdowns de avaliador + upload do **documento de avaliação**
    (tipo `AVALIACAO_BANCA`, interno da banca) — obrigatório.
  - **Validar Fase I / Fase II** (NF1 = média; NF = 0,6·NF1 + 0,4·NF2).
  - **Editar informações do TCC** (`PUT /tccs/:id`): título, semestre, fase, flags, notas,
    resultado, aluno/orientador/coorientador + coorientador externo (com validação de papéis e
    unique aluno+semestre). E **editar metadados de documento** (`PUT /tccs/documentos/:docId`).
  - **Banca e notas (admin):** vê notas por critério/peso/comentário + parecer + status de cada
    avaliador; **edita avaliação** de um membro e **troca os 2 avaliadores da Fase I** (sincroniza
    a Fase II). Bloqueado quando a fase já foi validada/concluída (preserva NF — sem recálculo).
  - Calendário/pesos, usuários (editar/reset senha/excluir), códigos de cadastro, relatórios,
    lista do período, exportar/resetar, mural com comentários, documentos de referência.
- **Avaliador externo / membro de banca:** dashboard espelhado; **Participações em bancas**
  (lista por TCC com botões Fase I/Fase II) → **página interna de avaliação** (`AvaliarBanca`):
  formulário por critério (nota com máscara/clamp pelo peso, comentário por critério, parecer
  geral, nota total ao vivo). Fluxo **rascunho → enviar → reabrir/editar**, com status do membro
  `PENDENTE | ENVIADO | BLOQUEADO | CONCLUIDO`. Coorientações (leitura).
- **Regras de fase fechadas:** banca da Fase II = **orientador + os 2 avaliadores da Fase I**
  (sem formação manual); avanço para `VALIDACAO_*` só quando todos enviam; versão final validada
  pelo orientador; documento `AVALIACAO_BANCA` só visível a coordenador + membros da banca.

## 5. O que FALTA / próximos passos
1. **Testar no navegador o ciclo completo** (de risco): muita coisa recente foi validada só por
   `build/lint/test/prisma`, sem clicar na UI. Subir API+web e percorrer abrir → monografia/
   continuidade → formar banca → avaliar (rascunho/enviar/reabrir) → validar Fase I/II →
   versão final → concluído, + edições admin de TCC/banca.
2. **Testes automatizados do backend** (hoje só ~10 testes no `compartilhado`): cobrir transições
   de fase, guards e cálculo de NF no módulo `bancas`.
3. **Recálculo de NF/resultado para TCC já concluído** (deferido): a edição admin de banca bloqueia
   fases validadas justamente para não deixar NF inconsistente. Se for preciso editar nota de TCC
   concluído, falta um fluxo explícito de recálculo (decidir antes de implementar).
4. **Trocar SQLite → PostgreSQL** ao publicar (mudar `provider` no `schema.prisma` + `DATABASE_URL`).
5. **Deploy** (build de produção, variáveis, SMTP real).

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
- `docs/DETALHES.md` — changelog/decisões finas por área (endpoints, migrations, regras de borda).
- `apps/web/.interface-design/system.md` — sistema de design (cores, componentes, padrões).
- `docs/fluxograma-interativo.html` — simulador interativo do fluxo do TCC (abrir no navegador). Confere com a seção de fluxo do ARQUITETURA.md.
