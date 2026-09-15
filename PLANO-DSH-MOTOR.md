# Plano: Cockpit (control plane) + DeepSeek Harness (Agent OS)

**Status:** pronto para execução pelo Agy  
**Revisão:** após pronto, humano + Grok revisam o código (não mergear sem review)  
**Escopo deste ciclo:** workers Claude+Codex via DSH (híbrido; Agy/Grok/bash em PTY)  
**Repo Cockpit:** `/DATA/Projetos/agent-project`  
**Repo DSH:** `/DATA/Projetos/deepseek-harness` (v0.1.5-rc.2, developer preview)  
**Cópia no projeto:** `PLANO-DSH-MOTOR.md` (este arquivo)

---

## 0. Esclarecimento (ler antes de codar)

Há **duas camadas** no DSH. Não misturar:

| Camada | O que é | Exemplo |
|---|---|---|
| **Worker / subagent** | Plugin sobe um **CLI de produto** | Codex app-server, Claude Agent SDK |
Há o **Cockpit híbrido**:

```
Painel Claude / Codex  →  backend dsh  →  harness + subagent oficial
Painel Agy / Grok / bash  →  backend pty  →  CLI direto (como hoje)
```

**Você não “acaba só com Agy/Grok” no path DSH.**  
No piloto, Agy/Grok no Cockpit **continuam PTY**. Claude/Codex é que passam pelo harness.  
(Agy como *builder deste plano* e Grok como *revisor* é o time de construção — não é o runtime do usuário.)

**Sem API?** Workers Claude/Codex usam login do próprio CLI (subscription). Preferir **KD-C** (painel Codex → worker Codex de verdade).

**Adapter Agy/Grok?** Possível porque “tudo é plugin” — **fase 2**, não neste ciclo.

---

## 1. Visão do produto (não negociar)

```
Usuário → Cockpit (missões · squad · maestro · pool · política)
              ↓
         DeepSeek Harness (sessão · tools · plugins · loop · sandbox)
              ↓
         Workers: Codex · Claude Code
              (+) PTY legado: Agy · Grok · bash
```

- **Cockpit** = torre de controle (UI/ops).
- **DSH** = Agent OS para Codex e Claude neste ciclo.
- **Agy / Grok / bash** = PTY até existir adapter (fase 2).
- **Não** transformar o Cockpit num skin do `dsh web`.
- **Não** big-bang: quatro CLIs iguais no DSH de uma vez.

### O que NÃO fazer

- Não reescrever a UI React neste plano.
- Não remover PTY, pool de contas, maestro MCP, nem mailbox `connections/`.
- Não compartilhar `~/.dsh` do `dsh web` interativo com o engine do Cockpit — usar `DSH_HOME` isolado.
- Não tratar `servidor/connections/` como transporte de agente.
- Não habilitar Agy/Grok via DSH neste ciclo (sem subagent oficial).
---

## 2. Decisão de transporte

| Opção | Veredito |
|---|---|
| `dsh --profile headless` | **Não** — one-shot, sai |
| `dsh web` embutido | **Não** como motor do Cockpit — UI própria |
| `dsh --profile acp` | Reserva se cancel/resume forem must-have |
| **`dsh --profile sdk`** | **Escolhido** — JSON-RPC stdio, cliente TS, eventos DSH |

**Cliente:** `@deepseek-ai/dsh-sdk-client`  
**Bin:** checkout local `/DATA/Projetos/deepseek-harness` via `dshBin` / `pnpm dsh`, pinado.

**Riscos aceitos do SDK (documentar no código):**
- Sem `session/cancel` no fio — cancel = matar processo ou política por painel.
- Sem list/resume/close de primeira classe — Cockpit minta `sessionId` (= paneId).
- Preview com breaking changes — pin de versão obrigatório.
- `subagent.finished` só para in-process; Codex/Claude out-of-process não emitem igual.

---

## 3. Arquitetura alvo (híbrido)

### Extensão de config

Em `servidor/config.ts` → `CliSpec`:

```ts
backend?: "pty" | "dsh";  // default: "pty"
```

Em `cockpit.json` (exemplo ao final do piloto):

```json
"clis": {
  "claude": { "command": "claude", "backend": "dsh" },
  "codex":  { "command": "codex",  "backend": "dsh", "env": { "CODEX_HOME": "..." }, "pool": [...] },
  "agy":    { "command": "agy" },
  "grok":   { "command": "grok" },
  "bash":   { "command": "/bin/bash", "args": ["-i", "-l"] }
}
```

`familia` = modelo/effort/pool.  
`backend` = transporte.

### Novo módulo (paralelo ao PTY)

Criar `servidor/sessions/dsh-backend/`:

| Arquivo | Responsabilidade |
|---|---|
| `dsh-runtime.ts` | Lifecycle `dsh --profile sdk` (home isolado, pin bin) |
| `dsh-session-bridge.ts` | PaneState ↔ sessionId; prompt; eventos → output WS |
| `dsh-manager.ts` | API espelhando o que `PtyManager` expõe (`spawn`, `write`, `kill`, `resize` adaptado) |
| `dsh-availability.ts` | Disponibilidade para backend dsh |
| `index.ts` | exports |

**Seam:** em `pty-manager.ts`, depois de harness/pool/papel, antes de `this.client.spawn`:

```
if (backendDo(cli) === "dsh") return dshManager.spawnPane(...)
else /* PTY atual */
```

Preferir router fino (`pane-spawn.ts`) se caber sem reescrever o host PTY.

### Mapeamento de I/O

| Operação Cockpit | Backend DSH |
|---|---|
| spawn painel | `initialize` + primeira `session/prompt` (sessionId = paneId) |
| escrever | enfileirar `session/prompt` — **não** stdin PTY bruto |
| output | projetar eventos em texto no xterm (fase 1 transcript) |
| kill | `shutdown` / matar processo do pane (KD-A) |
| resize | no-op ou log |

**KD-A (piloto):** 1 processo SDK **por painel DSH**.  
**KD-B (depois):** 1 processo por missão.

### Maestro / MCP

- Delegar continua via MCP/HTTP → `abrirPainel`.
- Painéis DSH no mesmo `PaneState`.
- **Piloto:** especialistas Claude/Codex → dsh; Maestro pode ficar PTY até PR-5.

### Pool de contas

Manter `accountPool.acquire` antes do spawn. Para DSH passar `env` da conta (`CODEX_HOME`, etc.) ao child/subagent.

### OmniRoute / Codex home isolada (KD-omniroute)

No Cockpit, “OmniRoute” **não** é um CLI separado: é o padrão de **Codex com `CODEX_HOME` por conta** (pool) + sandbox/auto-aprovação do `cockpit.json`, e o **modelo que o usuário escolheu** no wizard (qualquer id — combo local, ponte, o que estiver naquela home).

**Não hardcodar nome de modelo** (nem no plano, nem no código, nem no patch DSH). O modelo vem de `spec.model` / elenco da missão / escolha do usuário.

| Sinal no Cockpit (PTY hoje) | No path DSH |
|---|---|
| `allocatedAccount.env.CODEX_HOME` ou `clis.codex.env.CODEX_HOME` | Overlay `env.CODEX_HOME` no `dsh-subagent-codex` (expandir `~` / `$HOME`) |
| `clis.codex.sandbox` + `autoAprovar` | Mapear para `permissionMode` do subagent (ver tabela abaixo) |
| `spec.model` (escolha do usuário) | Passar como `model` no provider **se** o usuário escolheu um; se omitido, herdar config nativo daquela `CODEX_HOME` |
| Auth / proxy / provider dentro da home | Continua **nativo Codex** naquela pasta — DSH não reimplementa OmniRoute |

Mapeamento sandbox (espelhar a intenção do PTY, não inventar política nova):

| Cockpit | `permissionMode` no `dsh-subagent-codex` |
|---|---|
| `autoAprovar` + sandbox `danger-full-access` | `dangerously-bypass-approvals-and-sandbox` |
| `autoAprovar` + sandbox `workspace-write` (ou default) | Preferir o equivalente unattended mais próximo (`never` / `approve-for-me` conforme docs do subagent) — documentar a escolha no PR |
| `autoAprovar: false` | Não forçar bypass; modo mais restrito disponível no subagent |

**Reconhecer OmniRoute:** se existir `CODEX_HOME` efetivo (conta do pool ou env do cli), o path DSH **obrigatoriamente** propaga essa home. Sem `CODEX_HOME`, Codex DSH usa o default nativo do processo (comportamento Codex “cru”).

Implementação: na bridge/spawn DSH, montar config do subagent **por pane** a partir do mesmo `SpawnOpts` / conta alocada que o `pty-manager` já usa — não um preset global “modelo X”.

### Subagents no profile SDK

```sh
export DSH_HOME=/caminho/isolado   # ex. ~/.cockpit/dsh-home
dsh --profile sdk --dump-default-config >/dev/null
dsh plugin --profile sdk add @deepseek-ai/dsh-subagent-codex
dsh plugin --profile sdk add @deepseek-ai/dsh-subagent-claude-code
```

Habilitar tools no `$DSH_HOME/profiles/sdk/cordis.patch.yml` (READMEs dos subagents).  
Preset do profile pode deixar `model` omitido; o **override por pane** (OmniRoute / escolha do usuário) manda no spawn.

**KD-C:** `cli: codex` → worker `subagent_codex`; `cli: claude` → `subagent_claude_code`.  
Usuário escolhe Codex no Cockpit → comportamento Codex, não DeepSeek genérico.

---

## 4. Plano de PRs Cockpit (ordem obrigatória)

Cada PR compila, tem testes, é revisável sozinho.

### PR-1 — Config + disponibilidade + feature flag

**Título:** `feat(dsh): CliSpec.backend e detecção de engine DSH`

- `backend?: "pty" | "dsh"`; Claude/Codex ainda `pty` no json até PR-4
- Disponibilidade dsh = bin + `DSH_HOME`
- `scripts/check-dsh-config.ts`

**Aceite:** server sobe; runtime dos panes inalterado.

### PR-2 — Runtime SDK isolado

**Título:** `feat(dsh): runtime SDK pinado com home isolado`

- `@deepseek-ai/dsh-sdk-client` pinado
- `dsh-runtime.ts` + `scripts/setup-dsh-cockpit-home.sh` (plugins codex+claude)
- `scripts/check-dsh-runtime.ts` (opt-in)

**Aceite:** setup idempotente; smoke no servidor.

### PR-3 — Bridge PaneState ↔ sessão DSH

**Título:** `feat(dsh): dsh-manager spawn/kill/output`

- KD-A; WS `output`; kill limpa processo
- `scripts/check-dsh-pane-lifecycle.ts`

**Aceite:** spawn→output→kill sem vazamento.

### PR-4 — Liga Claude + Codex

**Título:** `feat(dsh): backend dsh para claude e codex`

- `cockpit.json` `"backend": "dsh"` em claude e codex
- KD-C + pool env
- **KD-omniroute:** propagar `CODEX_HOME` da conta + `spec.model` do usuário + mapear sandbox/`autoAprovar` → `permissionMode` (sem hardcodar modelo)
- Agy/Grok/bash intactos em PTY

**Aceite:** missão Claude+Codex abre panes DSH; conta com `CODEX_HOME` custom usa essa home no subagent; modelo = o escolhido no wizard; Agy/Grok ainda PTY.

### PR-5 — Maestro + hardening

**Título:** `feat(dsh): maestro compat e limpeza`

- Delegar → pane DSH; kill missão limpa; cotas honestas; docs

**Aceite:** Maestro delega especialista DSH; `CHECKPOINT-DSH.md` completo.

---

## 5. Ordem de trabalho para o Agy (checklist)

1. Ler este plano + `PRODUCT.md`.
2. Confirmar DSH: `cd /DATA/Projetos/deepseek-harness && pnpm dsh --help`.
3. Executar PRs Cockpit **1→5** na ordem (branches `feat/dsh-prN-…`).
4. Não refatorar UI React do Cockpit nem `connections/` como transporte.
5. Ao terminar: `CHECKPOINT-DSH.md` com setup, `DSH_HOME`, o que falta (adapters Agy/Grok), riscos.
6. **Parar** para review humano+Grok — sem merge sem review.

---

## 6. Critérios de pronto (piloto)

### Workers (Cockpit ↔ DSH)

- [ ] `backend` no config com default `pty`
- [ ] Home DSH isolado + plugins Codex/Claude
- [ ] Pane Claude/Codex via SDK (não node-pty)
- [ ] Pane Agy/Grok/bash inalterados (PTY)
- [ ] OmniRoute: `CODEX_HOME` da conta chega no subagent; modelo = escolha do usuário (sem hardcode)
- [ ] Kill não deixa `dsh` zumbi
- [ ] Maestro delega especialista DSH
- [ ] Testes + harness checks verdes

### Fechamento

- [ ] `CHECKPOINT-DSH.md` escrito
- [ ] Review humano + Grok pendente

---

## 7. Key Decisions

| ID | Decisão | Por quê |
|---|---|---|
| KD-transport | SDK, não ACP/web/headless | UI Cockpit + eventos DSH |
| KD-hybrid | Claude+Codex no DSH; Agy/Grok PTY | Subagents oficiais vs adapter |
| KD-A | 1 SDK process / pane | Cancel=kill simples |
| KD-C | cli → subagent correspondente | Expectativa do usuário |
| KD-omniroute | `CODEX_HOME` + modelo do usuário + sandbox → subagent | OmniRoute = home isolada; modelo não é fixo |
| KD-home | `DSH_HOME` isolado | Não corromper dsh web |
| KD-maestro | Maestro PTY até PR-5 | Reduz risco |
| KD-agy-grok | Adapter = fase 2 | Plugin possível; não oficial hoje |

---

## 8. Arquivos-âncora

**Cockpit:** `pty-manager.ts`, `maestro-coordinator.ts`, `harness.ts`, `providers.ts`, `config.ts`, `cockpit.json`, `ws-dispatcher.ts` — **não** `connections/` como backend.

**DSH:** `apps/cli/README.md`, `packages/sdk/client/README.md`, `subagent-codex`, `subagent-claude-code`, `docs/architecture.md`.

---

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Breaking changes DSH | Pin + home isolado + smoke |
| Cancel fraco SDK | KD-A kill; spike ACP depois |
| Transcript ≠ TUI nativo | Aceitar no piloto |
| Modelo fixo no patch DSH | Proibido — só `spec.model` / nativo da `CODEX_HOME` |
| OmniRoute “só numa home mágica” | Qualquer `CODEX_HOME` de conta/pool; não path único |
| Escopo creep “4 CLIs” | Fase 2 explícita |

---

## 10. Depois do piloto (fase 2+)

- Subagent/adapter **Agy** e **Grok** (plugin Cordis)
- Multiplex KD-B
- ACP se cancel/resume must-have
- OpenRouter via DSH vs ponte
- Migrar Maestro para DSH
- Tool cards na UI do Cockpit

---

## 11. Instrução curta para colar no Agy

```
Implemente o piloto Cockpit+DSH conforme PLANO-DSH-MOTOR.md.

Visão: Cockpit = control plane; DSH = Agent OS.
- Claude + Codex via dsh --profile sdk (workers oficiais).
- Agy / Grok / bash permanecem PTY (não inventar adapter neste ciclo).
- OmniRoute: reconhecer via CODEX_HOME da conta/pool; propagar env ao
  subagent-codex; modelo = o que o usuário escolheu no Cockpit (nunca
  hardcodar nome de modelo); mapear sandbox/autoAprovar → permissionMode.

Siga PRs 1→5 na ordem. Não redesenhe a UI do Cockpit.
Não use servidor/connections/ como transporte. Home DSH isolado.
KD-C: painel Codex/Claude = subagent correspondente.
Ao terminar, escreva CHECKPOINT-DSH.md e pare para review humano+Grok.
```
