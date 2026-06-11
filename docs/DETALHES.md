# Detalhes do Sistema de TCC (backlog vivo)

Detalhes capturados por área, conforme o cliente vai falando. Companheiro do `ARQUITETURA.md`.

**Legenda de quando decidir:**
- **[AGORA]** — mexe em **dado, regra ou permissão**; afeta modelo/guardas. Decidir cedo.
- **[NA TELA]** — **apresentação** (onde/como aparece); barato, decide ao construir a tela.
- **[CONFIRMAR]** — pendente de resposta do cliente.

---

## 1. Cadastro e Autenticação

### Autenticação
- **[AGORA]** Autenticação por **token (JWT)**. (já previsto na arquitetura)
- **[AGORA]** **"Manter login" (lembrar de mim):**
  - marcado → a sessão dura **7 dias**, mesmo se fechar o navegador;
  - desmarcado → sessão curta / expira ao fechar o navegador.
  - *Implementação:* token de atualização de 7 dias quando marcado; senão, sessão curta.

### Curso e departamento (mudança importante vs projeto antigo)
- **[AGORA]** Existem **2 cursos** de graduação (todos no DEE):
  **Engenharia Elétrica** e **Controle e Automação**.
- **[AGORA]** **Aluno** tem o campo **curso** (um dos 2 acima) no cadastro.
- **[AGORA]** **Departamento deixa de ser um dado.** Há **um único** departamento
  (**DEE – Departamento de Engenharia Elétrica**); como é único, não se pede nem se armazena
  (igual não faz sentido cadastrar "planeta = Terra"). Some a divisão de departamento que o
  projeto antigo tinha no cadastro de professores.
- **[AGORA]** **Professor/orientador NÃO tem curso nem departamento** (atende o DEE inteiro).
- **[AGORA]** ✔ Confirmado: um **orientador pode orientar aluno de qualquer um dos 2 cursos**.
- **[AGORA]** **Avaliador externo:** tem **afiliação** (outra instituição), não tem curso.

### Código de cadastro e recuperação de senha
- **[AGORA]** **Mantém o código de cadastro** (como no antigo): há um código por tipo de
  usuário que controla quem pode se registrar (ALUNO / PROFESSOR / AVALIADOR).
- **[AGORA]** **Recuperação de senha por e-mail** (no antigo não funcionava → fazer funcionar):
  usuário pede "esqueci a senha" → sistema envia **link com token de uso único e prazo curto**
  (ex.: 1h) → usuário define nova senha. Depende do envio de e-mail.

### Campos do cadastro e regras (resolvido)
- **[AGORA]** **Campos por tipo** seguem o original como **base** (não cópia literal):
  - **Aluno:** nome, e-mail, senha, **curso**.
  - **Professor:** nome, e-mail, senha, **tratamento/titulação**. (afiliação é sempre UFPE → não se pede)
  - **Avaliador externo:** nome, e-mail, senha, **tratamento/titulação** + **afiliação**.
  - *O tratamento/titulação entra na geração automática de ata/termos.*
- **[AGORA]** **Tratamento** = lista (Prof. Dr., Prof. Ms., Prof., Dr., Eng., …) **com opção
  "Outros"** → ao escolher "Outros", abre **campo livre** pra preencher. Mesma ideia para a
  **afiliação** do avaliador externo (UFPE, UFRPE, IFPE, … + "Outros" → campo livre).
- **[NA TELA]** Como mostrar o "Outros" (abrir campo do lado/abaixo) — a critério; abrir ao selecionar é bom.
- **[AGORA]** **Coordenador NÃO se cadastra** na tela principal (hoje é criado pelo admin interno
  do Django). **Decisão adiada:** definir como criar coordenador no novo sistema (ex.: seed inicial
  + coordenador cria coordenador). Lembrar que o novo **não terá** o admin do Django.
- **[AGORA]** **Avaliador externo se cadastra sozinho** (com código), como hoje — perfil como
  outro qualquer; muda só o que faz/vê.
- **[AGORA]** **Sem confirmação de e-mail** no cadastro (o código já basta como controle).
- **[AGORA]** **Senha: mínimo 6 caracteres**, qualquer composição.

---

## 2. Aluno

### Cadastro / nome (feito)
- **[AGORA]** ✔ **Nome completo exige nome + sobrenome** (≥ 2 palavras). Um nome só **dá erro**
  com a mesma mensagem genérica `Informe o nome completo` (decisão: não avisar "coloque mais de
  um nome"). Validação no `esquemaCadastro` (`pacotes/compartilhado`) → vale na tela **e** na API.

### Abrir TCC (feito)
- **[NA TELA]** ✔ Form de abertura mostra **dados do aluno não editáveis** (nome, e-mail, curso)
  no topo, vindos do `useAuth`.
- **[NA TELA]** ✔ **Campo de upload bonito** copiado do projeto antigo: componente reutilizável
  `componentes/CampoArquivo.tsx` — área tracejada clicável com ícone, "Clique para selecionar o
  arquivo" + dica; quando há arquivo, mostra nome + tamanho + "Remover". Usado no `AbrirTcc`.
- **[NA TELA]** ✔ Modal de confirmação ("Revisar e enviar") antes do envio.

### Telas/abas do aluno (feito — espelham o projeto antigo)
Menu do aluno (`NAV.ALUNO` no `LayoutApp`): **Dashboard · Meu TCC · Documentos · Informações ·
Mural de avisos · Configurações**.
- ✔ **Dashboard** (`/aluno`, `DashboardAluno.tsx`) — saudação + andamento (trilha) + resumo;
  CTA "Abrir meu TCC" quando não há TCC. É a home do aluno (`fim:true` no NavLink).
- ✔ **Meu TCC** (`/aluno/meu-tcc`, `PainelAluno.tsx`) — detalhe: trilha + dados + documentos +
  cancelar solicitação.
- ✔ **Documentos** (`/aluno/documentos`, `Documentos.tsx`) — lista os arquivos do TCC com botão
  Baixar (`${URL_API}/tccs/documentos/:id/baixar`). **[A FAZER]** modelos p/ baixar + envio de
  monografia quando existirem as fases.
- ✔ **Informações** (`/aluno/informacoes`, `Informacoes.tsx`) — **espelha o antigo**:
  **Datas importantes** (9 marcos do semestre, "A definir" até haver calendário) +
  **Documentos de referência** (modelos; vazio até existirem). **[A FAZER]** ligar ao
  calendário e aos modelos quando a área do coordenador existir.
- ✔ **Mural de avisos** (`/aluno/avisos`, `MuralAvisos.tsx`) — **estado vazio** por enquanto;
  depende do backend de avisos (a fazer, ver seção 6).
- ✔ **Configurações** (`/configuracoes`) — ver seção 7 (preferências).
- **[A FAZER]** Tela de **Perfil** (dados do usuário + trocar senha) — saiu de Configurações.

## 3. Professor (orientador)

### Fase de Desenvolvimento — backend FEITO (telas a fazer)
Implementa a ARQUITETURA 3.2 (duas trilhas paralelas). Migration
`20260608131549_desenvolvimento_monografia` adicionou em `Tcc`: `monografiaAprovada`,
`continuidadeConfirmada`, `parecerContinuidade`; e `parecer` em `DocumentoTcc`.
- ✔ **Aluno** `POST /tccs/:id/monografia` (PDF) — cria versão da monografia `PENDENTE` (Trilha A).
  Só na fase DESENVOLVIMENTO e enquanto não aprovada.
- ✔ **Orientador** `GET /tccs/orientando` — seus TCCs (aluno + documentos + flags).
- ✔ **Orientador** `POST /tccs/:id/monografia/avaliar` `{decisao:APROVAR|REJEITAR, parecer?}` —
  aprova (→ `monografiaAprovada`) ou rejeita (doc `REJEITADO` + parecer; aluno reenvia nova versão).
- ✔ **Orientador** `POST /tccs/:id/continuidade` `{decisao:CONFIRMAR|REJEITAR, parecer?}` —
  confirma (Trilha B) ou rejeita (→ fase `DESCONTINUADO`).
- ✔ **Junção "E" automática:** ao confirmar as duas trilhas, fase → `FORMACAO_BANCA_FASE_1`
  (Fase I, do coordenador = próxima fatia). Esquemas no compartilhado: `esquemaAvaliarMonografia`,
  `esquemaContinuidade`. Testado e2e (aluno→orientador→junção).
- ✔ **Telas FEITAS e testadas na UI:**
  - **Área do Professor** (novo): `RedirecionarHome`/`NAV.PROFESSOR` → `/professor` (Dashboard) +
    `/professor/orientandos` (`MeusOrientandos.tsx`) — lista, baixar monografia, Aprovar/Pedir
    ajustes e Confirmar/Descontinuar continuidade (modais de parecer). Guardado por `ExigePapel`.
  - **Aluno:** `DashboardAluno` tem o **card de ação pendente** ("Enviar versão do TCC", mostra a
    devolutiva quando rejeitada); `ModalEnviarMonografia` (reusado em Dashboard e Meu TCC);
    `PainelAluno` mostra status da monografia + reenviar. Card de pendência espelha o
    `usePendingActionsAluno` do antigo (só na fase DESENVOLVIMENTO, enquanto não aprovada).

### Disponibilidade
- **[AGORA]** Professor pode marcar se está **disponível ou não para pegar atividades**
  (orientações). *Efeito:* quando indisponível, ele **não aparece** na lista de orientadores
  que o aluno escolhe ao abrir o TCC. (no antigo era o campo `disponivel_para_listas`)
- ✔ **FEITO:** toggle "Disponibilidade para orientar" no **Dashboard do professor**
  (`PUT /autenticacao/disponibilidade`, guard PROFESSOR; atualiza o contexto de auth). Testado e2e:
  indisponível → some de `professores-disponiveis`; disponível → reaparece.

## 4. Avaliador externo

### Fase I (banca + NF1) — backend FEITO (telas a fazer)
Módulo novo `apps/api/src/bancas/`. Migration `20260610174128_fase1_banca`: modelos **`Banca`**
(`@@unique([tccId, fase])`, fase=FASE_1|FASE_2) e **`MembroBanca`** (`avaliadorId`, `nota` 0–10,
`parecer`, `avaliadoEm`); e em `Tcc`: `nf1/nf2/nf` (Float) + `resultado`.
- ✔ **Coordenador** `GET /tccs/:id/banca/candidatos` — professores/avaliadores, exceto aluno e orientador.
- ✔ **Coordenador** `POST /tccs/:id/banca` `{avaliadorIds:[2]}` — forma a banca (2 distintos) →
  `FORMACAO_BANCA_FASE_1` → `AVALIACAO_FASE_1`.
- ✔ **Avaliador** `GET /bancas/minhas` — bancas em que é membro (com TCC + documentos).
- ✔ **Avaliador** `POST /bancas/:bancaId/avaliar` `{nota,parecer?}` — dá a nota; quando **todos**
  avaliam → `AVALIACAO_FASE_1` → `VALIDACAO_FASE_1` (automático).
- ✔ **Coordenador** `POST /tccs/:id/banca/validar` — **NF1 = média**; **≥6** → `FORMACAO_BANCA_FASE_2`,
  **<6** → `REPROVADO_FASE_1` (resultado REPROVADO). Esquemas: `esquemaFormarBanca`,`esquemaAvaliarBanca`.
- Testado e2e: forma → 2 notas (8,7) → valida → **NF1 7.5, aprovado** → Fase II.
- ✔ **Tela do Avaliador FEITA:** `/bancas` (`paginas/MinhasBancas.tsx`), no menu de **Avaliador**
  (home) e **Professor** (membros de banca podem ser os dois). Lista as bancas, baixa a monografia
  e **dá a nota 0–10** (modal). Autorização de download estendida a membros de banca
  (`documentoParaUsuario`). Testado na UI (nota 9 → "Sua nota: 9.0"; download 200).
- ✔ **Telas do coordenador FEITAS** (aba **TCCs**, `TccsCoordenador.tsx` + `GET /tccs`): lista os
  TCCs com a fase; **Formar banca** (escolhe 2 avaliadores, modal) quando em FORMACAO_BANCA_FASE_1;
  **Validar Fase I** (vê as notas + NF1, modal) quando em VALIDACAO_FASE_1. Testado na UI:
  formar → notas 9/8 → validar → "Aprovado (NF1 8.50), segue p/ Fase II". **Fase I fechada
  ponta a ponta.** (A aba TCCs começa a preencher a opção B; o "god mode" completo fica pra depois.)
- ✔ **Fase II FEITA (ciclo completo do TCC):** `formarBanca`/`validar` generalizados (Fase II = 3
  avaliadores → **NF2**; depois a **nota final NF = 0,6·NF1 + 0,4·NF2**, ≥7 → **CONCLUIDO**,
  senão `REPROVADO_FASE_2`). A área do Avaliador e o `avaliar()` já tratavam FASE_2; a aba **TCCs**
  do coordenador forma/valida as duas fases (modais adaptam 2/3 avaliadores e NF1/NF2+NF). Testado
  e2e na UI: NF1 8 → NF2 9 → **NF 8.40 → Concluído/Aprovado**. **Ciclo abertura→…→conclusão completo.**

## 5. Coordenador

### Estrutura + features que alimentam o aluno (FEITO)
Backend novo: módulo `apps/api/src/coordenacao/` (controller+service+module, registrado no
`principal.module`). Modelos Prisma novos: **`Calendario`** (1 por semestre, 9 datas-marco),
**`DocumentoReferencia`** (modelos), **`Aviso`** (mural). Schema sincronizado por `prisma db push`.
> ⚠️ Rotas do front foram **realinhadas** depois (ver "Menu lateral"): hoje é
> `/coordenador/solicitacoes` e `/coordenador/planejamento`. Os **endpoints** abaixo não mudaram.
- ✔ **Dashboard** (`/coordenador`, `DashboardCoordenador.tsx`) — contador de solicitações pendentes.
- ✔ **Solicitações** (`/coordenador/solicitacoes`, `PainelCoordenador.tsx`) — aprovar/recusar.
- ✔ **Calendário** (seção de `/coordenador/planejamento`, `SecaoCalendario.tsx`) — `GET/PUT /calendario`;
  define as 9 datas → aparecem em **Informações** do aluno. Datas em **UTC** (exibir com `timeZone:'UTC'`).
- ✔ **Documentos de referência** (seção de `/coordenador/planejamento`, `SecaoModelos.tsx`) —
  `GET/POST/DELETE /documentos-referencia` + `/:id/baixar`; upload de modelos → aluno baixa em
  **Informações**. Arquivos em `uploads/referencia/`.
- ✔ **Mural de avisos** (`/coordenador/avisos`) — `GET/POST/DELETE /avisos`; publica → aluno vê em **Mural**.
  Validação `esquemaAviso` no compartilhado. `autorNome` denormalizado (sem FK p/ Usuario).
- Constantes no compartilhado: `MARCOS_CALENDARIO`, `ROTULO_MARCO`, `DESC_MARCO`, `esquemaAviso`.
- **⚠ Vite:** ao adicionar exports no `@tcc/compartilhado`, o Vite precisa **re-otimizar** — rode
  `npm run dev -- --force` (ou apague `apps/web/node_modules/.vite`), senão o import vem `undefined`.

### Modo administrador / rede de segurança (IMPORTANTE — pedido p/ a entrega)
O coordenador é o "admin" do sistema (substitui o admin do Django). Precisa resolver problemas
sem depender de dev. Capacidades:
- **[AGORA]** Editar **qualquer dado** de qualquer TCC: orientador, título, **fase atual**,
  **notas (NF1/NF2)**, avaliações, banca, datas.
- **[AGORA]** **Substituir/baixar** arquivos (documentos) de qualquer TCC.
- **[AGORA]** **Forçar a fase** do TCC para qualquer etapa (generaliza os `liberar_*` do original).
- **[AGORA]** **Criar um TCC manualmente** em nome do aluno, já inserindo dados (orientador,
  fase, arquivos, notas, avaliações) — caminho de "recriar quando deu problema".
- **[AGORA]** **Excluir** um TCC = **apagar de vez** (decisão do cliente). **Confirmação dupla**
  obrigatória. Guardar um **registro de auditoria** (quem/quando) **fora** do TCC, já que o
  registro some.
- **[AGORA]** **Toda alteração manual registrada na linha do tempo** (quem/o quê/quando) — auditoria.
- **[NA TELA]** Onde ficam esses controles (provável: área de administração + ações no detalhe do TCC).

### Visão "alunos não iniciados" (a fazer)
- **[AGORA-ish]** Tela/relatório do coordenador com os **alunos que ainda NÃO enviaram a
  solicitação** no semestre (= alunos sem TCC). É **consulta derivada**, NÃO um estado do TCC
  (decidido: "Não iniciado" não entra na linha do tempo, pois antes da solicitação não existe TCC).
  Serve pro coordenador cobrar quem está atrasado.

_(demais detalhes do coordenador a preencher)_

## 6. E-mail / Notificações
_(a preencher)_

## 7. Outros

### Build & segurança — hardening (FEITO, a partir de revisão)
- ✔ **Build web voltou a passar.** O `@tcc/compartilhado` agora gera **dual CJS + ESM** com
  `exports` map (`dist/cjs` p/ a API via `require`, `dist/esm` p/ o Vite/Rollup via `import`).
  Antes, o Rollup não rastreava `esquemaCadastro` do CJS e `vite build` quebrava. Build: dois
  `tsc` (`tsconfig.cjs.json` / `tsconfig.esm.json`).
- ✔ **Download de documento autorizado** (`GET /tccs/documentos/:id/baixar`): só coordenador, o
  aluno dono, ou o orientador/coorientador do TCC; senão **404** (sem vazar existência).
  Testado: dono 200, não-dono 404, coordenador 200, id falso 404.
- ✔ **Upload de doc do TCC só aceita PDF** (`fileFilter` no multer) → não-PDF dá **400**. Testado.
- ✔ **CORS por allowlist** (`CORS_ORIGENS` no `.env`, padrão `http://localhost:5173`).
- ✔ **Cookie `secure` por ambiente** (`NODE_ENV=production` → `secure:true`).
- ✔ **`JWT_SEGREDO` obrigatório em produção** — sem ele, a API não inicia (em dev, fallback).
- ✔ **Abertura de TCC atômica no cliente**: se o upload do plano/termo falhar, faz rollback
  (`DELETE /tccs/:id`) pra não deixar TCC parcial. (Ideal futuro: 1 request multipart no back.)
- ✔ **`.gitignore`** agora ignora o banco real (`apps/api/prisma/*.db`), uploads e `.vite`.

Segunda rodada de revisão (FEITO):
- ✔ **Migration das tabelas de coordenação.** Eu as criei com `db push` (sem migration) — erro:
  num banco limpo `migrate deploy` não criaria `calendarios/documentos_referencia/avisos`.
  Corrigido: migration `20260608113423_adiciona_coordenacao` (banco dev resetado e re-semeado;
  `prisma migrate status` = "up to date"). **Regra: usar `prisma migrate dev`, não `db push`.**
- ✔ **`URL_API` por env** (`VITE_API_URL`, com fallback localhost) — `apps/web/src/api.ts` +
  `vite-env.d.ts`.
- ✔ **Guarda de papel no front** (`ExigePapel` em `App.tsx`): rotas `/aluno/*` e `/coordenador/*`
  exigem o papel; quem não tem é mandado pra própria home. (Backend já bloqueava via `@Papeis`.)
  Testado: aluno em `/coordenador/planejamento` → redirecionado.
- ✔ **`aprovar`/`recusar` validam o estado** (faseAtual=INICIALIZACAO + solicitação PENDENTE),
  senão 400. Corrige o bug de re-aprovar jogar o TCC de volta pra DESENVOLVIMENTO. Testado.
- **Atomicidade (parcial):** abertura tem rollback no cliente (cobre o caso normal). O 100%
  atômico = 1 request multipart no backend (`$transaction` criar TCC + 2 docs). **A FAZER.**
Terceira rodada de revisão (FEITO):
- ✔ **Reenvio de monografia** marca versões `PENDENTE` antigas como `SUBSTITUIDA` (não fica várias
  pendentes). Testado: 2 envios → 1 PENDENTE + 1 SUBSTITUIDA.
- ✔ **`avaliarMonografia`/`enviarMonografia` em `$transaction`** (doc + TCC + fase juntos); envio
  com cleanup do arquivo em caso de falha (sem órfão).
- ✔ **Coorientador** na abertura validado por papel (PROFESSOR/AVALIADOR/COORDENADOR), não aluno.
- ✔ **Upload de documentos de referência** com allowlist (PDF/Office/imagem; bloqueia executáveis).
- ✔ **Calendário** valida data inválida → 400. ✔ **`removerAviso`** id inexistente → 404 (não 500).
- ✔ **Upload de doc de abertura** (`adicionarDocumento`) agora valida o **tipo** (só
  PLANO_DESENVOLVIMENTO/TERMO_ACEITE) e a **fase** (só INICIALIZACAO) + cleanup de arquivo órfão.
  Testado: abertura 201; tipo inventado 400; upload fora da fase 400.
- ✔ **`adicionarReferencia`** também com cleanup de arquivo órfão.
- ✔ **Meu TCC** não mostra mais "Reenviar" enquanto a monografia está em avaliação (consistente
  com o card do Dashboard).
Quarta rodada de revisão (FEITO):
- ✔ **Fluxo de recusa destravado:** o aluno vê o parecer e tem botão **"Corrigir e reenviar"**
  (descarta o TCC recusado — `cancelar` já permitia em INICIALIZACAO — e volta pro `/aluno/abrir`).
  No Dashboard e no Meu TCC. Resolve o bloqueio do `@@unique([alunoId, semestre])`.
- ✔ **`aprovar` exige Plano + Termo** (checa os dois `DocumentoTcc` antes de aprovar) → senão 400. Testado.
- ✔ **Nomes de arquivo seguros:** o caminho salvo usa nome interno aleatório + extensão sanitizada
  (`gravarArquivo` e `adicionarReferencia`); o nome original vira só metadado (`nomeArquivo`). Evita
  path traversal.
- **[A FAZER] `npm audit`** roda (24 vulns: 7 high/14 mod/3 low). `npm audit fix` **não resolve nada**
  (todas pedem `--force`/major). A maioria é toolchain de dev (vite/esbuild/picomatch) + a cadeia
  NestJS/multer. **Não apliquei `--force`** (quebraria) — virar upgrade dedicado (NestJS 10→11, Vite),
  testado. Build segue passando.
- ✔ **Testes (início):** **Vitest** no monorepo. Domínio do TCC (fases, rótulos, índices da trilha,
  cálculo de notas NF1/NF2/NF e cortes) virou **fonte única** em `pacotes/compartilhado/src/dominio.ts`,
  usada por **back** (`bancas.service`) e **front** (`utils/fases.ts` re-exporta). `dominio.test.ts`
  cobre o cálculo de notas e a completude das fases (pega o bug de "fase nova sem rótulo"). Rodar:
  `npm test` na raiz (ou `npm run test` no pacote). 7 testes passando.
- ✔ **ESLint** montado (`eslint.config.mjs`, flat config pragmática: TS + regras de hooks no front,
  sem ruído de `any`). `npm run lint` na raiz — **0 problemas**.
- **[A FAZER]** expandir testes (integração dos fluxos) antes do **upgrade de deps** (npm audit)
  — ver seção 7 e a tarefa registrada.

### Menu lateral (app shell) — em progresso
- **[NA TELA]** ✔ **Menu lateral por papel** no `LayoutApp` (NAV: Record<Papel, ItemNav[]>).
  Hoje: ALUNO=[Meu TCC, Configurações]; COORDENADOR=[Aberturas pendentes, Configurações];
  PROFESSOR/AVALIADOR=[Início, Configurações]. **Configurações** aparece para todos.
- **[NA TELA]** ✔ **Layout igual ao projeto antigo:** `header` ocupa o **topo inteiro**
  (`sticky top:0`, logo + "Sistema de TCC" à esquerda, usuário à direita) e a **lateral fica
  ABAIXO do header** (`sticky top:64px; height:calc(100vh-64px)`). Estrutura:
  `.app-shell`(coluna) > [`.barra-topo`, `.corpo`(linha) > [`.lateral`, `.area > .conteudo`]].
  No mobile a lateral vira barra horizontal logo abaixo do header.
- **[NA TELA]** ✔ **Menu do coordenador REALINHADO pra espelhar o original** (`SidebarCoord`):
  **Dashboard · TCCs · Relatórios · Solicitações · Usuários · Lista do período · Mural de avisos ·
  Planejamento · Configurações**. (Antes eu tinha improvisado nomes/abas — corrigido.)
  - "Solicitações" = a antiga "Aberturas pendentes" (`PainelCoordenador`).
  - "Planejamento" (`PlanejamentoCoordenador`) junta **Calendário** (`SecaoCalendario`) +
    **Documentos de referência** (`SecaoModelos`) numa tela só — como no original (não é aba separada).
  - TCCs, Relatórios, Usuários, Lista do período: **esqueleto** (`EmConstrucao`) até serem construídos.
  - Dashboard sem os "atalhos" inventados.
- **Regra reforçada:** espelhar a IA do original (menu/telas/nomes); melhorar só a qualidade, não
  reinventar onde as coisas ficam. Ver [[feedback_espelhar_original_tcc]].
- **[A FAZER]** Conteúdo real de TCCs/Relatórios/Usuários/Lista do período; menu do avaliador.

### Preferências visuais do usuário — em progresso
- **[NA TELA]** ✔ Tela **Configurações** (`/configuracoes`) só com **preferências** (sem "dados do
  usuário" — esses ficam pra uma futura tela de **Perfil**).
- **[NA TELA]** ✔ **4 temas** (espelham o projeto antigo): **Claro** (branco), **Escuro** (azul
  escuro), **Preto** (alto contraste) e **Institucional** (clássico SIGAA, marinho `#12355B` +
  dourado no avatar/badge/menu ativo). Cada um é um bloco `[data-tema="…"]` em `estilo.css`
  sobrescrevendo os tokens; "claro" é o `:root`.
- **[NA TELA]** ✔ **Fonte**: **Tamanho** (pequeno/médio/grande via `html[data-fonte=…] .area{zoom}`)
  e **Tipo/família** (Padrão sans · Serif · Mono via `html[data-familia=…] .area{font-family}`).
- Estado em `tema/contexto.tsx` (`ProvedorTema` / `useTema`), aplicado como `data-tema` /
  `data-fonte` / `data-familia` no `<html>`.
- **[A FAZER / DESVIO]** Hoje as preferências são salvas em **localStorage (por navegador)**, não
  **por usuário no servidor** como previsto. Para "salvo por usuário": adicionar campos
  `tema`/`fonte` no `Usuario` (Prisma) + endpoint pra salvar + carregar no login. localStorage é o v1.
