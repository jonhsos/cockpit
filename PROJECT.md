# Project: Cockpit Orchestration Architecture Overhaul

## Architecture Overview
Complete architectural overhaul of the Cockpit orchestration platform in `/DATA/Projetos/agent-project` fulfilling all requirements R1–R13 and Acceptance Criteria.
The new architecture strictly decouples:
- **Role**: Semantic capabilities and behavior (Maestro, Builder, Reviewer, Scout, Artista, custom roles).
- **Runner**: Execution harness (`bash`, `codex`, `claude`, `agy`, `gemini`, `openrouter`).
- **Model**: LLM configuration and custom combo (e.g. Claude 3.7 Sonnet, GPT-6 Astra, Gemini 3.1 Pro).
- **Pane**: Sovereign live process (PTY), managed via a decoupled background PTY host.
- **Connection**: Real, persistent, bidirectional/directed link between two panes.
- **Task**: Structured work unit with 13 fields and a formal 6-state lifecycle.
- **Handoff**: Contextual transfer envelope between panes.
- **Mission**: Project context, git worktree, mode (`Livre`, `Dirigido`, `Autônomo`), and file ownership mode (`shared`, `isolated`).

Modular server organization into 10 explicit directories (`servidor/`):
1. `servidor/routes/` — Express HTTP route modules
2. `servidor/websocket/` — WebSocket server, typed event broadcast, client handlers
3. `servidor/orchestration/` — Maestro, strict harness, mission modes, MCP
4. `servidor/sessions/` — Decoupled PTY daemon/client, sovereign clean bash, 8-state lifecycle
5. `servidor/tasks/` — 13-field Task entity, 6-state machine, evidence, task board
6. `servidor/connections/` — Pane-to-pane connection registry, mailbox (inbox/outbox), verbs
7. `servidor/missions/` — Mission domain service, git worktree isolation, checkpoints
8. `servidor/providers/` — Provider detection, bridge adapters, quotas, media
9. `servidor/persistence/` — Atomic disk store, file locks (shared vs isolated), audit log
10. `servidor/security/` — Secret sanitizer (redaction), workspace-write sandbox, confirmations

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Sovereign Clean Bash | SHELL starts strictly as `/bin/bash -i -l` with no auto LLM boot | M2 | ORIGINAL_REQUEST § R1 |
| 2 | Zero Bash Prompt Injection | Prohibit injecting prompts, roles, or instructions into bash stdin | M2 | ORIGINAL_REQUEST § R1 |
| 3 | Bash Absolute Precedence | Explicit `bash` selection overrides roster, failover, and policy | M2 | ORIGINAL_REQUEST § R1 |
| 4 | Decoupled Role Entity | Roles decoupled from runners and models; user can assign any runner | M1 | ORIGINAL_REQUEST § R2 |
| 5 | Decoupled Runner Entity | Runners (`bash`, `codex`, `claude`, etc.) decoupled from roles/models | M1 | ORIGINAL_REQUEST § R2 |
| 6 | Decoupled Model Entity | Models decoupled from roles; supports user-configured combos | M1 | ORIGINAL_REQUEST § R2 |
| 7 | Persistent Connection Entity | Entity representing persistent link between two panes | M1 | ORIGINAL_REQUEST § R2, R5 |
| 8 | Structured Task Entity | 13-field Task entity with timestamps, evidence, allowed files | M1 | ORIGINAL_REQUEST § R2, R6 |
| 9 | Structured Handoff Entity | Handoff envelope transferring task context and dependencies | M1 | ORIGINAL_REQUEST § R2, R5 |
| 10 | Roles-First Catalog UI | Catalog shows pure roles first, hiding model names (ASTRA, FLASH, etc.) | M5 | ORIGINAL_REQUEST § R3 |
| 11 | 2-Step Selection Flow | User chooses Role first, then explicitly chooses Runner, then Model | M5 | ORIGINAL_REQUEST § R3 |
| 12 | Mission Renaming | User can rename active and saved missions in UI and API | M5 | ORIGINAL_REQUEST § R3 |
| 13 | Pane Renaming & Reclassifying | User can rename label and reclassify role of any open Shell pane | M5 | ORIGINAL_REQUEST § R3 |
| 14 | Real Connection Visual Lines | Connection wires rendered in UI only when real persisted connection exists | M5 | ORIGINAL_REQUEST § R3, R5 |
| 15 | Visual Element Differentiation| Distinct badges for role, runner, model, status, and active task | M5 | ORIGINAL_REQUEST § R3 |
| 16 | No Silent Fallback to Codex | Unavailable runners emit clear errors; no silent substitution | M3 | ORIGINAL_REQUEST § R4 |
| 17 | Roster Whitelist Enforcement | Elenco acts strictly as allowed whitelist; rejects unauthorized runners | M3 | ORIGINAL_REQUEST § R4 |
| 18 | Task Type Model Isolation | Task type cannot alter or override user-configured model | M3 | ORIGINAL_REQUEST § R4 |
| 19 | Disabled Auto-Failover | Failover disabled by default (`maestroAutoSwitch: false`); requires user auth | M3 | ORIGINAL_REQUEST § R4 |
| 20 | `cockpit list` Verb | Lists active panes, roles, runners, and assigned tasks | M3 | ORIGINAL_REQUEST § R5 |
| 21 | `cockpit connect` Verb | Establishes persistent connection between two panes | M3 | ORIGINAL_REQUEST § R5 |
| 22 | `cockpit ask` Verb | Enqueues structured task to pane inbox; never writes to bash stdin | M3 | ORIGINAL_REQUEST § R5 |
| 23 | `cockpit reply` Verb | Sends structured response to requesting pane | M3 | ORIGINAL_REQUEST § R5 |
| 24 | `cockpit handoff` Verb | Performs structured task and context handoff between panes | M3 | ORIGINAL_REQUEST § R5 |
| 25 | Persistent Inbox/Outbox | Mailbox per pane for safe inter-agent messaging | M3 | ORIGINAL_REQUEST § R5 |
| 26 | Existing Pane Task Dispatch | Maestro can query connected panes and assign tasks without spawning new panes | M3 | ORIGINAL_REQUEST § R5 |
| 27 | Task CRUD & API Routes | Complete REST & WS API for task creation, update, and deletion | M1 | ORIGINAL_REQUEST § R6 |
| 28 | 6-State Formal Lifecycle | Enforces transitions: `todo`, `in-progress`, `blocked`, `in-review`, `complete`, `failed` | M1 | ORIGINAL_REQUEST § R6 |
| 29 | Interactive Sidebar Task Board| Real-time task board in sidebar with 6 status groups | M5 | ORIGINAL_REQUEST § R6 |
| 30 | Knowledge & Evidence Logging | Records knowledge snippets, diffs, and test runs against tasks | M1 | ORIGINAL_REQUEST § R6 |
| 31 | Shared File Ownership Mode | Visual warnings on concurrent file editing in shared mode | M1 | ORIGINAL_REQUEST § R7 |
| 32 | Isolated File Ownership Mode | Exclusive file locks preventing concurrent overwrites with 409 Conflict | M1 | ORIGINAL_REQUEST § R7 |
| 33 | Modo Livre (Default) | User retains 100% manual control; no auto agent spawning by Maestro | M3 | ORIGINAL_REQUEST § R8 |
| 34 | Modo Dirigido | Maestro delegates strictly within user-authorized team and permissions | M3 | ORIGINAL_REQUEST § R8 |
| 35 | Modo Autônomo | Maestro can autonomously create tasks and panes within granted scope | M3 | ORIGINAL_REQUEST § R8 |
| 36 | Disk State Persistence | Persists missions, roles, runners, models, connections, tasks, handoffs | M1 | ORIGINAL_REQUEST § R9 |
| 37 | UI/Server Decoupled PTY | Restarting web server/UI on port 3000 does not kill active PTY processes | M2 | ORIGINAL_REQUEST § R9 |
| 38 | WS Session Resumption | Reconnects WebSocket and restores terminal stream cleanly | M2 | ORIGINAL_REQUEST § R9 |
| 39 | 8-State Granular Pane Lifecycle| Replaces run/idle/dead with 8 states (`starting`, `waiting-user`, `working`, etc.) | M2 | ORIGINAL_REQUEST § R10 |
| 40 | Granular Audit Trail | Comprehensive logging of activities, costs, tokens, commands, and errors | M1 | ORIGINAL_REQUEST § R10 |
| 41 | Secret & Credential Redaction | Never prints API keys, tokens, or credentials in streams or logs | M1 | ORIGINAL_REQUEST § R11 |
| 42 | Scoped Workspace Permissions | Defaults to `workspace-write`; `danger-full-access` requires explicit opt-in | M1 | ORIGINAL_REQUEST § R11 |
| 43 | Destructive Action Confirmations| Explicit confirmation required for kill, merge, lock override | M5 | ORIGINAL_REQUEST § R11 |
| 44 | Modular Routes Directory | `servidor/routes/` hosting modular Express route handlers | M4 | ORIGINAL_REQUEST § R12 |
| 45 | Modular WebSocket Directory | `servidor/websocket/` hosting WSS, client handlers, event broadcasting | M4 | ORIGINAL_REQUEST § R12 |
| 46 | Modular Orchestration Directory| `servidor/orchestration/` housing Maestro, harness, policies, modes | M4 | ORIGINAL_REQUEST § R12 |
| 47 | Modular Sessions Directory | `servidor/sessions/` managing PTY daemon, clean shell, state tracking | M4 | ORIGINAL_REQUEST § R12 |
| 48 | Modular Tasks Directory | `servidor/tasks/` managing Task entities, state machine, evidence | M4 | ORIGINAL_REQUEST § R12 |
| 49 | Modular Connections Directory | `servidor/connections/` managing pane links, mailbox, inter-agent verbs | M4 | ORIGINAL_REQUEST § R12 |
| 50 | Modular Missions Directory | `servidor/missions/` managing mission lifecycle and worktrees | M4 | ORIGINAL_REQUEST § R12 |
| 51 | Modular Providers Directory | `servidor/providers/` managing CLI adapters, bridge, quotas | M4 | ORIGINAL_REQUEST § R12 |
| 52 | Modular Persistence Directory | `servidor/persistence/` managing disk persistence, locks, audit log | M4 | ORIGINAL_REQUEST § R12 |
| 53 | Modular Security Directory | `servidor/security/` managing secret sanitizer and permission sandbox | M4 | ORIGINAL_REQUEST § R12 |
| 54 | E2E Opaque-Box Test Suite | Comprehensive 4-tier test suite validating all requirements independently | E2E | ORIGINAL_REQUEST § Acceptance Criteria |
| 55 | Final Acceptance & Hardening | 100% E2E test pass + adversarial coverage hardening + zero regressions | M6 | ORIGINAL_REQUEST § Acceptance Criteria |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Test harness, opaque-box test runner, Tier 1-4 test cases matching Feature Inventory, publishes `TEST_READY.md` | none | DONE |
| M1 | Domain Entities, Persistence, Tasks & Security | Types & schemas (Role, Runner, Model, Task, Connection, Handoff, Mission), 6-state Task machine, file locks (shared vs isolated), disk store, audit log, secret sanitizer | none | DONE |
| M2 | Sovereign Clean Shell, PTY Host Decoupling & Granular States | Sovereign `/bin/bash -i -l` spawner, decoupled `pty-host` background daemon over UDS, 256KB ring buffer, surviving web UI restart, 8-state pane machine | M1 | DONE |
| M3 | Strict Harness, Inter-Agent Bridge & Mission Modes | Removal of silent fallback to Codex, disabled auto-failover, `cockpit list/connect/ask/reply/handoff`, mailbox queue, mission modes (`Livre`, `Dirigido`, `Autônomo`) | M1 | DONE |
| M4 | Modular Server Architecture & Integration | Refactor monolithic `servidor/` into 10 explicit directories, integrate routes, WebSocket server, sessions, tasks, connections, providers, backward-compatible APIs | M1, M2, M3 | DONE |
| M5 | Frontend Decoupling, Catalog UI & Sidebar Task Board | Roles-first catalog, 2-step selection, true visual connection lines, interactive Sidebar Task Board, pane/mission renaming, confirmation modals | M1, M4 | DONE |
| M6 | Final Milestone: 100% E2E Test Pass & Adversarial Hardening | Phase 1: Pass 100% E2E tests (Tiers 1-4). Phase 2: Adversarial coverage hardening (Tier 5). Full verification of Acceptance Criteria and zero regressions | E2E, M5 | DONE |

---

## Interface Contracts

### 1. `servidor/tasks` ↔ Other Modules
- **Task Creation**: `createTask(missionId: string, params: CreateTaskParams): Promise<Task>`
  - Validates all 13 fields.
  - Automatically initializes timestamps (`criadaEm`, `atualizadaEm`), status `todo`, empty `evidências`.
- **State Transition**: `transitionTask(taskId: string, targetStatus: TaskStatus, context?: { reason?: string; evidence?: TaskEvidence }): Promise<Task>`
  - Validates transition according to formal matrix.
  - Updates `timestamps.iniciadaEm` on transition to `in-progress`.
  - Updates `timestamps.concluidaEm` on transition to `complete`.
  - Emits `task:updated` WebSocket broadcast.
- **File Locking**: `acquireFileLock(missionId: string, taskId: string, paneId: string, files: string[], mode: "shared" | "isolated"): Promise<{ ok: boolean; conflictFiles?: string[]; lockedBy?: string }>`
  - In `isolated` mode: returns 409 Conflict if any file is locked by another active task.
  - In `shared` mode: allows edit and emits `fs:collision_warning` event.

### 2. `servidor/sessions` (PTY Host) ↔ Server & WebSocket
- **IPC Protocol**: Unix Domain Socket (`~/.cockpit/pty-daemon.sock`) or in-memory fallback.
- **`spawn(opts: SpawnOptions): Promise<{ paneId: string; pid: number }>`**
  - If `opts.runner === "bash"`: launches strictly `/bin/bash -i -l` with clean environment, zero prompt typing.
  - Buffers output in a 256KB circular ring buffer per pane.
  - Tracks 8 granular states (`starting`, `waiting-user`, `working`, `blocked`, `review`, `completed`, `failed`, `dead`).
- **`attach(paneId: string, onData: (chunk: string) => void): { replay: string; write: (data: string) => void; resize: (cols: number, rows: number) => void; kill: () => void }`**
  - Replays existing ring buffer so reconnected clients recover terminal state instantly.
  - Allows server restarts on port 3000 without killing underlying PTY processes.

### 3. `servidor/connections` (Inter-Agent Bridge) ↔ Panes & Mailbox
- **`connectPanes(sourcePaneId: string, targetPaneId: string, missionId: string): Promise<Connection>`**
- **`askPane(fromPaneId: string, toPaneId: string, taskText: string): Promise<MailboxMessage>`**
  - Enqueues message into `toPane.inbox`.
  - Emits `inbox:message` WebSocket event.
  - NEVER writes raw commands into bash stdin.
- **`replyPane(fromPaneId: string, toPaneId: string, correlationId: string, resultText: string): Promise<MailboxMessage>`**
- **`handoffTask(sourcePaneId: string, targetPaneId: string, taskId: string, context: string): Promise<Handoff>`**

### 4. `servidor/orchestration/harness` ↔ Providers
- **`resolveHarness(requestedCli: string, missionElenco?: string[]): HarnessResult`**
  - If `requestedCli === "bash"`: returns pure bash runner immediately.
  - If `requestedCli` is not in host PATH: throws explicit error `Executor <cli> não disponível no sistema`.
  - If `requestedCli` is not in `missionElenco`: throws explicit error `Executor <cli> não permitido no elenco desta missão`.
  - Zero silent fallback to Codex or `permitidos[0]`.

---

## Code Layout
```
/DATA/Projetos/agent-project/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── cockpit.json
├── scripts/
│   ├── testar.mjs                   # Master test runner
│   ├── check-*.ts / check-*.mjs     # Unit & integration checks
│   └── e2e/                         # E2E test runner & test cases (Tiers 1-4)
├── servidor/
│   ├── index.ts                     # Express & HTTP/WS bootstrap entry point
│   ├── routes/                      # Modular REST route handlers (R12)
│   ├── websocket/                   # WebSocket server & event broadcasting (R12)
│   ├── orchestration/               # Maestro, harness, mission modes (R12)
│   ├── sessions/                    # Decoupled PTY host, clean shell, lifecycle (R12)
│   ├── tasks/                       # Task entity, 6-state machine, board (R12)
│   ├── connections/                 # Pane connections, mailbox, inter-agent bridge (R12)
│   ├── missions/                    # Mission service, git worktrees (R12)
│   ├── providers/                   # CLI detection, bridges, quotas (R12)
│   ├── persistence/                 # Atomic disk store, file locks, audit logs (R12)
│   └── security/                    # Secret sanitizer, workspace-write sandbox (R12)
├── web/
│   ├── index.html
│   ├── App.tsx                      # Main app, decoupled modals, state binding
│   ├── socket.ts                    # WebSocket client with task & connection events
│   ├── api.ts                       # Typed REST client (tasks, connections, panes)
│   ├── QuadroTarefas.tsx            # Interactive Sidebar Task Board (R6)
│   ├── Lateral.tsx                  # Sidebar with Missões / Tarefas / Arquivos tabs
│   ├── Pane.tsx                     # Terminal pane with real connection lines & badges
│   ├── PaneGrid.tsx                 # Grid of panes
│   ├── NovaMissao.tsx               # Roles-first catalog, Livre/Dirigido/Autônomo modes
│   └── Mascote.tsx                  # Granular 8-state mascot expressions
└── .agents/                         # Agent coordination metadata only
```
