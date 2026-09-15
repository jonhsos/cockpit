# Cockpit

Estação de trabalho local para rodar **vários agentes de IA no mesmo projeto**, em paralelo, com terminal de verdade, missões, orquestração (Maestro) e cotas/contas sob seu controle.

O Cockpit **não intermedia nem revende** chamadas de IA. Ele sobe os CLIs que você já tem (`claude`, `codex`, `agy`, `grok`, `bash`, OpenRouter…) e organiza o trabalho em cima deles.

```text
Você → UI (missões · painéis · terminal)
         ↓
      Cockpit (Express + WebSocket + PTY host)
         ↓
   ┌─────┴──────────────────────────┐
   │ Claude / Codex  → DeepSeek Harness (DSH, profile sdk)
   │ Agy / Grok / bash / OpenRouter → PTY direto (node-pty)
   └────────────────────────────────┘
```

---

## Sumário

1. [O que tem neste projeto](#o-que-tem-neste-projeto)
2. [Para que cada peça serve](#para-que-cada-peça-serve)
3. [Pré-requisitos](#pré-requisitos)
4. [Instalação e subida](#instalação-e-subida)
5. [DeepSeek Harness (DSH) — Claude e Codex](#deepseek-harness-dsh--claude-e-codex)
6. [Como usar no dia a dia](#como-usar-no-dia-a-dia)
7. [Papéis de agente (elenco)](#papéis-de-agente-elenco)
8. [CLI `cockpit` (comunicação entre painéis)](#cli-cockpit-comunicação-entre-painéis)
9. [Configuração (`cockpit.json`)](#configuração-cockpitjson)
10. [Variáveis de ambiente](#variáveis-de-ambiente)
11. [Testes e checks](#testes-e-checks)
12. [Estrutura de pastas](#estrutura-de-pastas)
13. [Limitações atuais](#limitações-atuais)

---

## O que tem neste projeto

| Área | O que é |
|---|---|
| **UI** (`web/`) | React + Vite + xterm. Lateral de missões, palco de terminal, ajustes, quadro de tarefas, catálogo de papéis |
| **Servidor** (`servidor/`) | Express, WebSocket, missões, Maestro, pool de contas, tarefas, segurança, PTY desacoplado |
| **Backend híbrido** | Claude/Codex via **DSH** (`servidor/sessions/dsh-backend/`); resto via **PTY** |
| **Config** (`cockpit.json`) | CLIs, agentes, modelos, esforços, pools, receitas, squads, mídia |
| **CLI** (`bin/cockpit.mjs`) | Verbos entre painéis: `list`, `connect`, `ask`, `reply`, `handoff`, `inbox`, `resultado` |
| **App desktop** (`app/`) | Empacotamento Windows (WebView2) opcional |
| **Checks** (`scripts/`) | Bateria de testes unitários, DSH, E2E e QA |

Estado persistente do usuário fica em `~/.cockpit/` (projetos, missões, chaves, histórico) — **não** no repositório.

---

## Para que cada peça serve

### No fluxo de trabalho

| Peça | Quando usar | Benefício |
|---|---|---|
| **Projeto** | Pasta Git (ou não) que você abre uma vez | Todos os agentes trabalham no mesmo root / worktree |
| **Missão** | Um objetivo concreto (“implementar X”, “revisar Y”) | Agrupa painéis, tarefas e contexto; pode isolar em worktree Git |
| **Painel** | Uma sessão de CLI (Claude, Codex, Agy…) | Terminal vivo; reiniciar a UI não mata o processo (PTY host) |
| **Maestro** | Orquestrar vários especialistas | Delega, acompanha e reúne entregas sem você colar prompt em cada um |
| **BUILDER / SCOUT / REVIEWER…** | Papéis no elenco | Especialização clara: quem edita, quem só pesquisa, quem revisa |
| **Quadro de Tarefas** | Trabalho com dependências e dono | Estado formal + locks de arquivo para não colidir |
| **Pool de contas** | Vários `CODEX_HOME` / perfis Agy | Concorrência real sem duas sessões na mesma home |
| **OpenRouter (GRÁTIS)** | Modelos $0 quando a cota paga acaba | Continuidade barata via ponte Codex→OpenRouter |
| **DSH** | Claude e Codex no piloto atual | Agent OS (sessão, tools, subagents oficiais) sob o Cockpit |
| **Receitas / Squads** | Formações que já funcionaram | Monta time + modelo + esforço sem reescolher tudo |

### No backend (mapa mental)

| Módulo | Função |
|---|---|
| `sessions/` | PTY host/daemon, clean shell, **dsh-backend** |
| `orchestration/` | Maestro, harness de tipos de tarefa, dispatcher de panes |
| `providers/` | Pool, cotas, pontes, onboarding Agy |
| `tasks/` | Ciclo de vida de tarefas + ownership de arquivos |
| `connections/` | Mailbox / CLI inter-agentes (não é transporte do DSH) |
| `missions/` | Criar/arquivar missão, worktrees |
| `security/` | Cofre, sanitização, aprovações |
| `persistence/` | Disco atômico sob `~/.cockpit` |

---

## Pré-requisitos

- **Node.js** 20+ (LTS recente recomendado)
- **npm** 10+
- **Git** no `PATH`
- Linux (validado) ou Windows 10/11
- CLIs que for usar, autenticados:
  - `codex` — [OpenAI Codex CLI](https://github.com/openai/codex)
  - `claude` — Claude Code
  - `agy` — Antigravity (Gemini etc.)
  - `grok` — Grok CLI
- Para Claude/Codex via DSH: checkout local do **DeepSeek Harness** (pin `0.1.5-rc.2`), tipicamente em `/DATA/Projetos/deepseek-harness` (ajustável por `DSH_REPO_PATH` / `DSH_BIN`)

---

## Instalação e subida

```bash
git clone https://github.com/jonhsos/agent-project.git
cd agent-project
npm ci
```

### Subir (produção local)

```bash
npm start
# = vite build + node servidor/index.ts
```

Abra **http://localhost:3000**.

### Só backend (frontend já buildado)

```bash
npm run server
```

### Frontend em modo dev (hot reload)

```bash
# terminal 1
npm run server
# terminal 2
npm run dev
```

### Home DSH (Claude/Codex)

Uma vez (idempotente):

```bash
bash scripts/setup-dsh-cockpit-home.sh
# cria ~/.cockpit/dsh-home com profile sdk + plugins Codex/Claude
```

Opcional — catálogo de Models (cérebro API, não worker CLI):

```bash
cp docs/dsh-home/settings.example.yaml ~/.cockpit/dsh-home/settings.yaml
# exporte MOONSHOT_API_KEY, XAI_API_KEY, OPENROUTER_API_KEY, etc.
```

---

## DeepSeek Harness (DSH) — Claude e Codex

No `cockpit.json` atual:

| CLI | Backend | Significado |
|---|---|---|
| `claude` | `dsh` | Sobe via `dsh --profile sdk` + subagent Claude |
| `codex` | `dsh` | Idem + subagent Codex; `CODEX_HOME` do pool/conta |
| `agy`, `grok`, `bash`, `openrouter` | `pty` (padrão) | Terminal clássico node-pty |

**OmniRoute (Codex):** qualquer conta com `CODEX_HOME` no pool propaga essa home ao subagent; o modelo é o que o usuário escolheu no wizard (sem hardcode). `sandbox` + `autoAprovar` viram `permissionMode` no subagent.

**Importante:** `DSH_HOME` do Cockpit é `~/.cockpit/dsh-home`. **Não** compartilhe com `~/.dsh` do `dsh web` interativo.

Detalhes e riscos do piloto: [`CHECKPOINT-DSH.md`](./CHECKPOINT-DSH.md). Plano técnico: [`PLANO-DSH-MOTOR.md`](./PLANO-DSH-MOTOR.md).

---

## Como usar no dia a dia

### 1. Autenticar os CLIs

No terminal do sistema (fora do Cockpit):

```bash
codex          # login OpenAI / conta Codex
claude         # OAuth Anthropic
agy models     # Antigravity / Gemini
grok           # xAI
```

### 2. Abrir projeto e missão

1. Na UI: abra a **pasta do projeto**.
2. Crie uma **missão** com objetivo claro.
3. Escolha o **modo**:
   - **Livre** — você abre painéis na mão.
   - **Dirigido / Squad** — elenco e fases controlados.
   - **Agêntico** — Maestro divide e delega.

### 3. Escolher quem trabalha

No elenco / RoleCatalog, combine papéis com provedores. Exemplos:

- **SCOUT** (Claude) — mapear código, sem editar.
- **BUILDER** (Claude) — implementar.
- **TERRA / LUNA / ASTRA** (Codex) — implementação / volume / arquitetura.
- **ARTISTA / FLASH** (Agy) — mídia ou Gemini barato.
- **GRÁTIS** (OpenRouter) — rascunho sem gastar assinatura.

### 4. Pool multicontas (Codex / Agy / Grok)

Em `cockpit.json`, várias entradas em `clis.<id>.pool` com `env` distinto (`CODEX_HOME`, `JETSKI_APP_DATA_DIR`/`HOME` no Agy, `GROK_HOME`).

Na UI: **Ajustes → Provedores → Pool** — vê livres/em uso e reseta cotas.

### 5. OpenRouter grátis

Configure a ponte `openrouter` (chave em Ajustes / cofre). O agente **GRÁTIS** usa modelos de preço zero quando a cota paga aperta.

### 6. Maestro

Com Maestro na missão:

- `listar_especialistas` / `delegar` / `situacao` / `ler_resultado` / `checkpoint` (via MCP do painel Maestro).
- Especialistas Claude/Codex sobem no path **DSH**; o próprio Maestro (se for Grok/Codex conforme config) segue o backend do CLI dele.

### 7. Encerrar

Arquivar missão ou fechar projeto mata os panes (incluindo reap do processo DSH — sem zumbi).

---

## Papéis de agente (elenco)

Definidos em `cockpit.json` → `agents`:

| Id | Label | CLI típico | Bom para |
|---|---|---|---|
| `maestro` | MAESTRO | codex (configurável) | Orquestrar, não implementar |
| `piloto` | PILOTO | claude | Conduzir ponta a ponta |
| `builder` | BUILDER | claude | Código / front |
| `scout` | SCOUT | claude | Explorar repo (sem editar) |
| `reviewer` | REVIEWER | claude | Diff e bugs |
| `astra` / `terra` / `luna` | Codex | codex | Arquitetura / dia a dia / volume |
| `artista` / `flash` / `opus46` / `gemini` | Agy | agy | Imagem, Gemini, segunda opinião |
| `pintor` / `cineasta` | Mídia | claude (+ tools) | Imagem / vídeo / áudio via Cockpit |
| `gratis` | GRÁTIS | openrouter | Custo zero |
| `shell` | SHELL | bash | Terminal puro |

Tipos de tarefa do harness (`mecanico`, `explorar`, `implementar`, `site`, `arquitetura`, `auditoria`, …) **organizam** o trabalho; o agente escolhido preserva modelo/esforço do perfil.

---

## CLI `cockpit` (comunicação entre painéis)

Com o servidor no ar:

```bash
# opcional: instalar o bin no PATH
npm link   # ou: node bin/cockpit.mjs …

export COCKPIT_PORT=3000
export COCKPIT_MISSION=<id-da-missão>

cockpit list
cockpit connect <paneA> <paneB>
cockpit ask <pane> "tarefa autossuficiente"
cockpit reply <pane> "resultado" --correlation-id=…
cockpit handoff <de> <para> <taskId> "contexto"
cockpit inbox --unread
cockpit resultado <pane>
```

Útil quando um especialista precisa pedir algo a outro **sem** misturar isso no stdin bruto do TUI (mailbox). O transporte de Claude/Codex no piloto é o **DSH**, não o mailbox.

---

## Configuração (`cockpit.json`)

Arquivo vivo na raiz. Trechos que mais importam:

```json
{
  "port": 3000,
  "autoAprovar": true,
  "clis": {
    "claude": { "command": "claude", "backend": "dsh" },
    "codex": {
      "command": "codex",
      "backend": "dsh",
      "sandbox": "danger-full-access",
      "env": { "CODEX_HOME": "~/.jion" },
      "pool": [ { "id": "codex-1", "env": { "CODEX_HOME": "..." } } ]
    },
    "agy": { "command": "agy", "pool": [ /* perfis */ ] },
    "grok": { "command": "grok" },
    "bash": { "command": "/bin/bash", "args": ["-i", "-l"] }
  },
  "agents": { /* papéis */ },
  "harness": { "tipos": { /* explorar, implementar, … */ } },
  "receitas": { /* formações prontas */ },
  "squads": { /* pipelines por fase */ }
}
```

- `backend` omitido = **`pty`**.
- Reinicie o servidor depois de mudar `cockpit.json` (config é lida no boot).

---

## Variáveis de ambiente

| Variável | Função |
|---|---|
| `COCKPIT_PORTA` | Porta HTTP (padrão: `port` do json, 3000) |
| `COCKPIT_HOME` | Estado do usuário (padrão `~/.cockpit`) |
| `COCKPIT_CONFIG` | Caminho alternativo do `cockpit.json` |
| `DSH_HOME` | Home isolado do harness (padrão `~/.cockpit/dsh-home`) |
| `DSH_BIN` / `DSH_REPO_PATH` | Binário / checkout pinado do DeepSeek Harness |
| `COCKPIT_MISSION` / `COCKPIT_PANE` / `COCKPIT_PORT` | Usados pelo CLI `cockpit` e pelos agentes |

---

## Testes e checks

```bash
# suíte agregada
npm test

# DSH
node scripts/check-dsh-config.ts
node scripts/check-dsh-omniroute.ts
node scripts/check-dsh-maestro-compat.ts
DSH_RUNTIME_SMOKE=1 node scripts/check-dsh-runtime.ts
DSH_RUNTIME_SMOKE=1 node scripts/check-dsh-pane-lifecycle.ts

# E2E DSH (servidor com código DSH no ar)
DSH_E2E=1 COCKPIT_PORT=3000 COCKPIT_PROJECT=<id> node scripts/check-dsh-e2e-mission.ts

# PTY / estados
node scripts/check-decoupled-pty.ts
node scripts/check-pane-states.ts
```

Há dezenas de `scripts/check-*.ts` e `scripts/qa-*.mjs` / `scripts/e2e/` para pool, segurança, UI e stress. Prints de QA ficam em `prints/`.

---

## Estrutura de pastas

```text
agent-project/
├── web/                 # UI React (Vite)
├── servidor/            # Backend modular
│   ├── sessions/        # PTY + dsh-backend/
│   ├── orchestration/   # Maestro, harness
│   ├── providers/       # Pool, cotas, pontes
│   ├── tasks/           # Tarefas + locks
│   ├── connections/     # Mailbox / CLI
│   ├── missions/
│   ├── security/
│   ├── persistence/
│   ├── routes/
│   └── websocket/
├── bin/cockpit.mjs      # CLI inter-agentes
├── scripts/             # Checks, QA, setup DSH
├── docs/dsh-home/       # Exemplo settings Models
├── app/                 # Empacote Windows (opcional)
├── cockpit.json         # Config operacional
├── PLANO-DSH-MOTOR.md   # Plano técnico DSH
└── CHECKPOINT-DSH.md    # Estado do piloto DSH
```

---

## Limitações atuais

- **Agy / Grok** ainda não têm adapter DSH (ficam em PTY). Fase 2.
- SDK DSH é **developer preview**: cancel = matar processo (1 SDK por painel); transcript é texto projetado, não a TUI nativa completa.
- `origin` (upstream alheio) pode exigir PR; o fork `jonhsos/agent-project` recebe o `main` com DSH.
- Reinicie o servidor após puxar `main` novo — a UI antiga em memória não carrega o backend DSH sozinha.

---

## Comandos rápidos (cola)

```bash
cd /DATA/Projetos/agent-project   # ou onde você clonou
npm ci
bash scripts/setup-dsh-cockpit-home.sh
npm start
# → http://localhost:3000

npm run server          # só API/WS
npm run build           # só frontend
npm test                # bateria

node bin/cockpit.mjs list --mission=<id>
```

Dúvidas de produto/UX: `PRODUCT.md`. Checkpoint do motor DSH: `CHECKPOINT-DSH.md`.
