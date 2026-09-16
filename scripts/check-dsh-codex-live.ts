/**
 * E2E opt-in: DSH como harness principal usando o gateway do Codex/OmniRoute.
 * Executa sem DEEPSEEK_API_KEY e exige uma resposta real do modelo configurado.
 */
import assert from "node:assert/strict";
import { DshManager } from "../servidor/sessions/dsh-backend/dsh-manager.ts";
import type { PaneState } from "../servidor/sessions/pane-state.ts";
import { readCodexGatewayConfig } from "../servidor/providers/codex-config.ts";

if (process.env.DSH_CODEX_LIVE !== "1") {
  console.log("skip: defina DSH_CODEX_LIVE=1 para testar DSH + Codex/OmniRoute ao vivo");
  process.exit(0);
}

const codexHome = process.env.CODEX_HOME;
assert.ok(codexHome, "CODEX_HOME é obrigatório");
const gateway = readCodexGatewayConfig(codexHome);
assert.ok(gateway?.model, "config.toml do Codex precisa declarar um modelo padrão");
const model = gateway.model;
const credentialEnv = gateway.credentialEnv;
assert.ok(process.env[credentialEnv], `${credentialEnv} é obrigatória`);
delete process.env.DEEPSEEK_API_KEY;

const marker = `DSH_CODEX_GATEWAY_OK_${Date.now()}`;
const paneId = `dsh-codex-live-${Date.now()}`;
const state: PaneState = {
  paneId,
  agent: "reviewer",
  label: "DSH Codex Live",
  cor: "#94a3b8",
  cli: "codex",
  role: "reviewer",
  runner: "codex",
  model,
  effort: null,
  tipo: null,
  tarefa: null,
  cwd: process.cwd(),
  projectId: "dsh-live",
  missionId: "dsh-live",
  sessionId: null,
  maestro: false,
  accountId: null,
  accountLabel: null,
  accountPinned: false,
  backend: "dsh",
  status: "starting",
  bytesIn: 0,
  bytesOut: 0,
  iniciadoEm: Date.now(),
  atualizadoEm: Date.now(),
  atividade: Array(24).fill(0),
  blockedReason: null,
};

let output = "";
const manager = new DshManager();
try {
  await manager.spawn({
    paneId,
    state,
    cwd: process.cwd(),
    env: { ...process.env, CODEX_HOME: codexHome },
    model,
    tarefa: `Responda somente com ${marker}`,
    onOutput(data) {
      output += data;
      process.stdout.write(data);
    },
  });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const occurrences = output.split(marker).length - 1;
    if (occurrences >= 2 && state.status === "waiting-user") break;
    if (state.status === "failed" || state.status === "dead") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(output.split(marker).length - 1 >= 2, "resposta do assistente não contém o marcador");
  assert.equal(state.status, "waiting-user");
  assert.equal(process.env.DEEPSEEK_API_KEY, undefined);
  console.log(`\nSUCESSO: DSH respondeu via ${gateway.provider}/${model} sem DEEPSEEK_API_KEY`);
} finally {
  await manager.kill(paneId);
}
