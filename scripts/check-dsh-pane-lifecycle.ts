/**
 * Lifecycle DSH pane: spawn → output → kill sem vazamento (PR-3).
 * Opt-in: DSH_RUNTIME_SMOKE=1 (precisa home provisionado).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkDshAvailability,
  getDshHomePath,
  DshManager,
  extractPromptText,
  sessionIdForPane,
} from "../servidor/sessions/dsh-backend/index.ts";
import type { PaneState } from "../servidor/sessions/pane-state.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.DSH_RUNTIME_SMOKE !== "1") {
  console.log("skip: defina DSH_RUNTIME_SMOKE=1 para o lifecycle DSH");
  process.exit(0);
}

console.log("=== SMOKE DSH PR-3: PANE LIFECYCLE ===\n");

if (!checkDshAvailability().homeExists) {
  const setup = join(root, "scripts/setup-dsh-cockpit-home.sh");
  const r = spawnSync("bash", [setup], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, "setup home");
}

assert.ok(checkDshAvailability().available, "engine DSH disponível");
assert.ok(existsSync(getDshHomePath()), "DSH_HOME existe");

assert.equal(sessionIdForPane("p9-test"), "p9-test");
assert.equal(extractPromptText("\x1b[200~olá\x1b[201~\r"), "olá");

const manager = new DshManager();
const paneId = "p-dsh-lifecycle-test";
const chunks: string[] = [];

const state = {
  paneId,
  agent: "builder",
  label: "DSH-TEST",
  cor: "#4fb286",
  cli: "claude",
  model: null,
  effort: null,
  tipo: null,
  cwd: root,
  projectId: null,
  missionId: null,
  sessionId: null,
  maestro: false,
  status: "starting",
  bytesIn: 0,
  bytesOut: 0,
  iniciadoEm: Date.now(),
} as PaneState;

await manager.spawn({
  paneId,
  state,
  cwd: root,
  tarefa: null,
  onOutput: (d) => chunks.push(d),
  onExit: () => {},
});

assert.ok(manager.has(paneId), "pane registrado no DshManager");
assert.equal(state.sessionId, paneId, "sessionId = paneId");
assert.ok(chunks.some((c) => c.includes("[dsh] runtime")), "emitiu banner de runtime");

manager.write(paneId, "\x1b[200~ping do cockpit\x1b[201~\r");
// Dar tempo ao enqueue/prompt (pode falhar sem API key — ainda assim não pode vazar processo)
await new Promise((r) => setTimeout(r, 1500));

await manager.kill(paneId, 0);
assert.equal(manager.has(paneId), false, "kill remove do mapa");
assert.equal(state.status, "dead", "status dead após kill");

console.log("SUCESSO: spawn → output → kill sem deixar pane no mapa");
