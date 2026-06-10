# Sistema de Design — Sistema de TCC (DEE)

Direção: **azul institucional (cores do projeto original) + acesso em "vidro" (glassmorphism)**.
Acesso (login/cadastro): cartão de vidro fosco sobre gradiente azul.
Área logada: claro, limpo, mesmo acento azul.

## Cores (do projeto original)
- Acento: **azul-céu `--azul` #0EA5E9** (+ `--azul-forte` #0284c7) — destaque, ações, foco, links.
- Institucional: **azul-marinho `--azul-escuro` #12355B** — barra, avatar, gradiente.
- Superfícies (área logada): `--canvas` #eef2f8 · `--papel-1` #fff · `--papel-2` #f5f8fc.
- Texto (4 níveis): `--tinta-1` #0f2540 … `--tinta-4` #9aa6b8. Bordas: tinta baixa opacidade.
- Semânticas: `--aprovado` #15803d · `--reprovado` #b91c1c.
- **Um acento só** (azul). Tokens em `src/estilo.css`.

## Acesso — glassmorphism (`componentes/LayoutAuth.tsx`)
- `.palco`: gradiente azul (#0a1c33 → #12355b → #0e3f63) + 3 `.brilho` desfocados (céu/indigo/ciano).
- `.vidro`: `backdrop-filter: blur(22px)`, fundo translúcido, borda clara, raio 24px, sombra funda. Texto claro.
- Login: avatar + campos com ícone sublinhados (`.campo-icone`), "Manter login" + "Esqueci a senha?", `.botao-vidro` (gradiente).
- Cadastro: `LayoutAuth largo`, campos com rótulo claro (`.vidro .campo`).
- Tokens do vidro: `--vidro-bg/-borda/-txt/-txt-suave/-linha`.

## Área logada — claro
- `.barra-topo` (logo `.logo-no` azul, `.badge-papel` mono azul, `.avatar` marinho, Sair).
- `.cartao-secao` (branco, borda suave). `.botao` azul / `.botao-secundario` contorno.

## Assinatura — trilha de fases (em azul)
`componentes/TrilhaFases.tsx` (horizontal|vertical, `atual` = índice ou `null`). Nós alcançados em azul.

## Tipografia (IBM Plex)
Serif (títulos da área logada) · Sans (interface; títulos do vidro) · Mono (dados, badges, rótulo da marca).

## Espaçamento / raio
Base 4px. Raio: 8 (controles) · 12 (cartões) · 16/24 (modais/vidro).

## Logo e cadastro
- **Logo do DEE**: `apps/web/public/logo-dee.jpg` (DEE + raio amarelo). Usado no topo do login (`.login-logo`) e na barra (`.topo-logo`).
- **Cadastro é modal de 2 passos** (como no original): `componentes/Modal.tsx` (genérico, via `createPortal` no body por causa do `backdrop-filter` do vidro) + `componentes/ModalCadastro.tsx`. Aberto pelo link "Cadastre-se" no login. Não há rota `/cadastro`.
  - Passo 1: cartões de categoria (`.cat-grid`/`.cat-card`) — Aluno/Professor/Avaliador.
  - Passo 2: faixa "Cadastro como: X · Alterar" (`.cat-banner`) + formulário.
  - **Ordem dos campos** (como o original, só os que existem): Nome completo → E-mail → (Curso | Titulação | Afiliação) → Código de cadastro → Senha. (Departamento e "confirmar senha" não existem mais.)

## Dívidas
- `<select>` nativo (estilizado). Trocar por dropdown custom quando precisar.
- Página de recuperação de senha (`/esqueci-senha`) ainda não existe — link já presente no login.
- Sem modo escuro na área logada.
