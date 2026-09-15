#!/usr/bin/env bash
# Idempotente: prepara DSH_HOME isolado do Cockpit com profile sdk + plugins Codex/Claude.
# Nunca usa ~/.dsh (home do dsh web interativo).
set -euo pipefail

DSH_REPO="${DSH_REPO_PATH:-/DATA/Projetos/deepseek-harness}"
DSH_BIN="${DSH_BIN:-$DSH_REPO/apps/cli/lib/bin.js}"
DSH_HOME="${DSH_HOME:-${COCKPIT_HOME:-$HOME/.cockpit}/dsh-home}"

resolve() { python3 -c 'import os,sys; print(os.path.realpath(os.path.expanduser(sys.argv[1])))' "$1"; }

DSH_HOME="$(resolve "$DSH_HOME")"
WEB_DSH="$(resolve "$HOME/.dsh")"
DSH_REPO="$(resolve "$DSH_REPO")"
DSH_BIN="$(resolve "$DSH_BIN")"

if [[ "$DSH_HOME" == "$WEB_DSH" ]]; then
  echo "erro: DSH_HOME não pode ser ~/.dsh (compartilhado com dsh web)." >&2
  echo "use ex: ~/.cockpit/dsh-home" >&2
  exit 1
fi

if [[ ! -f "$DSH_BIN" ]]; then
  echo "erro: bin DSH pinado não encontrado: $DSH_BIN" >&2
  exit 1
fi

if [[ ! -d "$DSH_REPO" ]]; then
  echo "erro: checkout DSH não encontrado: $DSH_REPO" >&2
  exit 1
fi

mkdir -p "$DSH_HOME"
export DSH_HOME

echo "DSH_HOME=$DSH_HOME"
echo "DSH_BIN=$DSH_BIN"
echo "DSH_REPO=$DSH_REPO"

cd "$DSH_REPO"

# Inicializa o profile sdk (idempotente).
pnpm dsh --profile sdk --dump-default-config >/dev/null

# Plugins oficiais via link do checkout pinado (trazem dsh.bundle + cordis.patch).
pnpm dsh plugin --profile sdk add ./packages/subagent/subagent-codex
pnpm dsh plugin --profile sdk add ./packages/subagent/subagent-claude-code

PATCH="$DSH_HOME/profiles/sdk/cordis.patch.yml"
mkdir -p "$(dirname "$PATCH")"

# Habilita tools de delegação no profile (presets oficiais vêm disabled).
# Sem hardcodar modelo — OmniRoute/escolha do usuário entra no PR-4.
cat >"$PATCH" <<'YAML'
# Cockpit profile overlay — tools Codex/Claude (KD-C).
# Model omitido de propósito: override por pane no spawn (PR-4).
- insert:
    - id: tool-subagent-codex
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: codex
        toolName: subagent_codex
        backgroundMode: one-shot
        maxDepth: provider-managed
    - id: tool-subagent-claude-code
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: claude-code
        toolName: subagent_claude_code
        backgroundMode: one-shot
        maxDepth: provider-managed
YAML

echo "ok: profile sdk pronto em $DSH_HOME/profiles/sdk"
echo "ok: cordis.patch.yml com subagent_codex + subagent_claude_code"
