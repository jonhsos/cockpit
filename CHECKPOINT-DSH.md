# CHECKPOINT-DSH — piloto Cockpit + DeepSeek Harness (modo B)

**Data:** 2026-09-15  
**Status:** implementação das PRs 1→5 + S1/S2 mínimas — **não mergear sem review humano + Grok**

## Visão entregue

| Camada | Estado |
|---|---|
| Cockpit = control plane | mantido; UI React **não** redesenhada |
| DSH = Agent OS (`dsh --profile sdk`) | pin **0.1.5-rc.2** no checkout `/DATA/Projetos/deepseek-harness` |
| Claude / Codex | `backend: "dsh"` em `cockpit.json` |
| Agy / Grok / bash | **PTY** (sem adapter neste ciclo) |
| OmniRoute | `CODEX_HOME` da conta/pool + `spec.model` + sandbox/autoAprovar → `permissionMode` |
| Settings / Models | PR-S1 no repo DSH; exemplo S2 em `docs/dsh-home/settings.example.yaml` |

## Branches (stack local)

| PR | Branch | Commit (tip) |
|---|---|---|
| PR-1 | `feat/dsh-pr1-cli-backend` | `bc0cd5a` CliSpec.backend + detecção |
| PR-2 | `feat/dsh-pr2-runtime-sdk` | `37abd14` runtime + setup home |
| PR-3 | `feat/dsh-pr3-pane-lifecycle` | `f359d38` dsh-manager + seam |
| PR-4 | `feat/dsh-pr4-claude-codex-backend` | (este tip) backends + OmniRoute |
| PR-5 | `feat/dsh-pr5-checkpoint` | este arquivo |
| S1 | DSH `feat/dsh-s1-settings-models` | `beee4442cc` persistence host em LAN |

## Home isolado

- `DSH_HOME` default: `~/.cockpit/dsh-home` (**nunca** `~/.dsh`)
- Setup: `bash scripts/setup-dsh-cockpit-home.sh`
- Plugins: `subagent-codex` + `subagent-claude-code` (link do checkout) + tools no `cordis.patch.yml`

## Como verificar

```bash
node scripts/check-dsh-config.ts
node scripts/check-dsh-omniroute.ts
node scripts/check-dsh-runtime.ts          # skip sem flag
DSH_RUNTIME_SMOKE=1 node scripts/check-dsh-runtime.ts
DSH_RUNTIME_SMOKE=1 node scripts/check-dsh-pane-lifecycle.ts
node scripts/check-decoupled-pty.ts        # regressão PTY
node scripts/check-pane-states.ts
```

## Riscos aceitos (SDK developer preview)

- Sem `session/cancel` → cancel = `close()` / kill do processo (KD-A: 1 SDK/pane)
- Sem list/resume/close de primeira classe → `sessionId = paneId`
- Breaking changes possíveis → pin de versão obrigatório
- Transcript fase 1: eventos → texto no xterm (tool cards = fase 2)

## Fora deste ciclo

- Adapter Agy / Grok via DSH  
- Multiplex KD-B  
- ACP cancel/resume  
- Redesign UI React / `servidor/connections/` como transporte de agente  

## Próximo passo

Review humano + Grok nos diffs das branches acima. Só então empilhar/mergear.
