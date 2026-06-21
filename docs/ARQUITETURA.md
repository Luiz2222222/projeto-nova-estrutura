# Sistema de Gestão de TCC — Documento de Arquitetura e Contexto

> Arquivo de recuperação de contexto. Resume o **domínio/fluxo entendido** e a
> **arquitetura proposta** para reconstruir do zero o sistema de TCC.
> **Status:** fase de ARQUITETURA. Ainda **não** foi dada a ordem
> "aprovado, pode construir" — nenhum código de aplicação foi escrito.

---

## 0. Convenção de nomes (REGRA DO PROJETO)
**Tudo que puder ser em português, será em português** — nomes de arquivos, pastas,
variáveis, funções, entidades, rotas, campos. Só fica em inglês o que é **nativo/inevitável**
(palavras-chave da linguagem, APIs de framework, libs de terceiros, etc.).

Exemplos: `arquitetura.md` (não `architecture`), módulo `fluxo` (não `workflow`),
`AvaliacaoFase1`, `enviarMonografia()`, pasta `modulos/`, `compartilhado/`.

---

## 1. Visão geral
Reconstrução de um sistema acadêmico de gestão de TCC. Escopo: graduação no
**DEE – Departamento de Engenharia Elétrica** (departamento único, não armazenado),
com **2 cursos**: **Engenharia Elétrica** e **Controle e Automação**.
O projeto antigo (somente leitura, em `Docs/Portal`) serviu só para extrair o **domínio**;
o **stack dele é abandonado**.

- **Stack antigo (abandonado):** Django + DRF + PostgreSQL + React + Docker.
  - PDF: `reportlab`; DOCX: `python-docx`; Auth: JWT em cookie HttpOnly (`simplejwt`).
- **Prioridades:** manutenibilidade, simplicidade, baixo custo operacional.
  Hospedagem/infra devem ser **trocáveis**, não acopladas ao código.

---

## 2. Papéis
- **Aluno** — dono de 1 TCC por semestre.
- **Orientador** (professor) — orienta, aprova monografia, confirma continuidade, participa de banca.
- **Coordenador** — administra o processo (aprova abertura, forma banca, valida avaliações, configura calendário/pesos, gera relatórios). É o "admin" do domínio.
- **Avaliador externo** — membro de banca / coorientador externo.
- (Possível futuro: "Interno administrativo", e mestrado — ver itens em aberto.)

---

## 3. Fluxo do TCC (validado com o cliente — está no `simulador-tcc.html`)

### 3.1 Inicialização
1. **Aluno** envia a **solicitação de orientação JÁ com os documentos iniciais**
   (Plano de Desenvolvimento + Termo de Aceite) e indica o orientador.
2. **Coordenador** aprova ou recusa a abertura (recusa → volta pro aluno corrigir).

### 3.2 Desenvolvimento — DUAS TRILHAS PARALELAS (qualquer ordem)
- **Trilha A (monografia):** Aluno envia monografia → Orientador aprova (ou rejeita → aluno reenvia).
- **Trilha B (continuidade):** Orientador confirma continuidade (ou rejeita → **Descontinuado**).
- **Junção "E":** a banca só é formada quando **as duas** estão prontas
  (monografia aprovada **E** continuidade confirmada). É **automático** — não existe mais
  "termo de solicitação de avaliação" como etapa do aluno.

### 3.3 Fase I (monografia) e Fase II (defesa) — SIMÉTRICAS
Mesmo padrão nas duas:
- Coordenador forma banca → Banca avalia (Fase I: duplo-cego opcional).
- **Coordenador valida**: **validar** (→ checagem de nota) ou **voltar pra banca**.
- Entre as fases: agendamento da defesa.

> **Como está implementado (ver `DETALHES.md` §4 T8):** ao **formar a banca da Fase I** o
> coordenador escolhe os 2 avaliadores **e envia o documento que a banca avalia** (tipo
> `AVALIACAO_BANCA`, interno da banca). A **Fase II não é formada manualmente** — ao validar a
> Fase I ela é criada como **orientador + os 2 avaliadores da Fase I** e segue direto para
> avaliação (sem etapa de **agendamento da defesa**). Avaliação tem rascunho/envio/reabertura
> com status por avaliador; o coordenador pode editar avaliações/avaliadores antes da validação.

### 3.4 Finalização
Após aprovação na nota final:
- **Aluno posta a versão final** (pós-correções) → **Orientador aprova a versão final?**
  - não → aluno reposta;
  - sim → **Concluído**.

### 3.5 Desfechos terminais
`Concluído` · `Descontinuado` · `Reprovado Fase I` · `Reprovado Fase II`.

---

## 4. Regras de nota (FONTE OFICIAL: PDF "Orientações Gerais")
- **Fase I:** cada um dos **2 avaliadores** dá nota 0–10. **NF1 = média**.
  - **NF1 < 6,0 → reprovado** (não vai pra defesa).
  - **NF1 ≥ 6,0 → segue** (NF1 fica oculta da banca da Fase II até a apuração final).
- **Fase II:** **3 integrantes** dão nota 0–10. **NF2 = média**. (Coorientador pode ser 4º, **sem nota**.)
- **Nota Final:** **NF = (0,6 × NF1) + (0,4 × NF2)** (ponderada).
  - **Aprovado se NF ≥ 7,0**; senão reprovado.
- ⚠️ **Bug do sistema antigo:** o `signals.py` gravava resultado como `(NF1+NF2)/2 ≥ 6`
  (errado); só os relatórios usavam a fórmula correta 0,6/0,4. **No novo, seguir o PDF.**

---

## 5. Camadas ortogonais ao fluxo (existem, mas não estão no fluxograma)
- **Guardas de data (calendário):** cada etapa tem uma **janela de prazo** (`CalendarioSemestre`).
  Fora da janela, a ação é bloqueada. O **coordenador pode liberar manualmente por TCC** (exceção).
  Há também **transições automáticas por data** (job agendado).
- **Permissões por papel (RBAC)** + "é dono do TCC".
- **Efeitos colaterais por transição:** cada transição gera evento → **linha do tempo**
  (auditoria) + **notificação** + **e-mail** (opt-in por papel/evento).

---

## 6. Arquitetura recomendada

### 6.1 Princípio central
**Concentrar num lugar só** "quem pode fazer o quê, quando, e qual a ordem das fases"
(definições de transição + guardas componíveis: papel + data + pré-condição).
Isso ataca diretamente a dor do projeto antigo (regras espalhadas entre view + serializer +
permission_class + React). As **bordas** (hospedagem, storage, e-mail, tempo real, estilo da API)
ficam **trocáveis**; o **miolo** (regras do TCC) fica estável.

> Sobre "máquina de estados": manter a ideia de **estado único + transições centralizadas**,
> mas **sem biblioteca/FSM pomposa nem over-engineering**. Pode ser um serviço bem organizado.

### 6.2 Stack
| Camada | Escolha | Porquê |
|---|---|---|
| Backend | **NestJS (TypeScript)** *(recomendado; ver decisão pendente)* | Guards + módulos + DI + cron + WebSocket nativos batem com este domínio |
| Banco | **PostgreSQL** | Relacional + transações (cálculo de notas) |
| ORM | **Prisma** | Schema único → tipos gerados, migrations |
| Contrato | **Zod** em pacote `compartilhado` | Regras validadas uma vez no back e no front |
| Frontend | **React + Vite + TanStack Query** | Consome tipos do `compartilhado` |
| Auth | **e-mail/senha** + JWT (cookie HttpOnly), módulo isolado | Como o antigo; porta aberta pra SSO |
| Senhas | **argon2/bcrypt** | Hash forte |
| Arquivos | **storage S3-compatível** (MinIO local) | Desacoplado do disco |
| Documentos | `docxtemplater` (preencher Word), `pdf-lib` (PDF), Puppeteer/pdfmake | Gerar/editar/automatizar papelada |
| E-mail | interface `EmailProvider` (SMTP) | Provider trocável; senha criptografada de verdade |
| Tempo real (opcional) | SSE/polling → WebSocket | Aditivo; transmite eventos que já existem |
| Deploy | **Docker Compose** | Roda em servidor local/VPS/gerenciado |

**Forma geral: monólito modular** (um deploy, módulos separados). Não microserviços.

### 6.3 Segurança (mapeamento Django → novo)
Nada se perde: senha (argon2), SQL injection (Prisma parametrizado), XSS (React escapa),
JWT em cookie (igual ao antigo), permissões (Guards), helmet, rate-limit, validação (Zod).
**Única coisa que o Django dava "de graça" e será construída: o painel admin** —
mas o **painel do coordenador É esse admin** (seria feito de qualquer jeito).

---

## 7. Modelo de dados (entidades principais — nomes em português)
`Usuario` (com `papel`) · `Tcc` (estado + flags das trilhas + NF1/NF2/NF/resultado) ·
`SolicitacaoOrientacao` · `DocumentoTcc` (versionado) · `Banca` / `MembroBanca` ·
`AvaliacaoFase1` / `AvaliacaoFase2` (5 critérios + pesos) · `AgendamentoDefesa` ·
`EventoLinhaTempo` (append-only, auditoria) · `CalendarioSemestre` (datas + pesos) ·
`Notificacao` / `PreferenciasEmail` · `Aviso` / `ComentarioAviso`.
`Usuario`: **aluno** tem campo **`curso`** (Engenharia Elétrica | Controle e Automação);
**professor/orientador NÃO tem curso nem departamento** (atende o DEE inteiro);
**departamento não é armazenado** (único: DEE).
Melhorias vs antigo: **coorientador externo como entidade própria** (não campos soltos);
senha SMTP criptografada; modelo de **Curso** leve (já são 2; expansível p/ mestrado).

---

## 8. Estrutura de pastas (alto nível, em português)
```
/apps
  /api                 (NestJS)
    /src/modulos       autenticacao, usuarios, tccs, fluxo, avaliacoes,
                       calendario, documentos, notificacoes, relatorios
    /src/comum         guardas, pipes, decoradores
  /web                 (React + Vite + TanStack Query)
/pacotes
  /compartilhado       schemas Zod + tipos + definição do fluxo (estados/transições)
/infra                 docker-compose, migracoes
```

---

## 9. Decisões em aberto
- **Stack:** ✔ decidido — **NestJS + React** (em construção; ver `../ESTADO.md`).
- **Hospedagem:** adiada — Docker resolve, decide depois (provável servidor local).
- **Criação de coordenador:** o novo sistema não terá admin do Django; definir como criar o
  1º coordenador (seed) e os demais (coordenador cria coordenador?). Não entra no cadastro público.
- **Modo administrador do coordenador (rede de segurança — pedido p/ a entrega):** o coordenador
  poderá editar/forçar qualquer dado de qualquer TCC (fase, notas, avaliações, banca, arquivos),
  **criar TCC manualmente** e **excluir** (recomendado: exclusão lógica/arquivar + restauração),
  com **tudo auditado na linha do tempo**. Substitui o admin do Django. Detalhes em `DETALHES.md` §5.
- **Matriz exata de permissões** por papel/estado e **semântica das liberações de data**.
- **Avaliação cega:** processo de anonimização do documento.
- **Escopo:** graduação no DEE, **2 cursos** (Elétrica, Controle e Automação); sem divisão
  de departamento. Se **mestrado / "Interno administrativo"** entrar, o modelo de Curso já
  acomoda (barato agora, caro depois).
- **Nota mínima:** confirmada pelo PDF (Fase I ≥ 6; NF final ≥ 7).

---

## 10. Roadmap por fases
0. **Fundação:** auth, usuários/papéis, esqueleto modular, Docker, CI.
1. **Núcleo do ciclo:** solicitação → abertura → desenvolvimento paralelo → banca (transições + guardas RBAC).
2. **Avaliações + notas:** Fase I/II, cálculo (0,6/0,4; cortes 6 e 7), validação do coordenador.
3. **Calendário + guardas de data** + liberações manuais.
4. **Notificações + e-mail + linha do tempo.**
5. **Relatórios/exportação + versão final** (repositório).
6. **Polimento:** preferências, mural, temas, (tempo real se quiser).

---

## 11. Artefatos desta fase
- `simulador-tcc.html` — simulador interativo do fluxo (fonte de verdade visual, validado).
- `fluxo-tcc.html`, `fluxograma-tcc.html` — versões anteriores (cards / fluxograma estático).
- `0_-_Orientações_Gerais_alunos.pdf` — regulamento oficial (regras de nota).
