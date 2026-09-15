/**
 * E2E vivo (opt-in): missão → delegar Claude+Codex → transcript DSH → kill sem zumbi.
 *
 *   DSH_E2E=1 COCKPIT_PORT=3011 node scripts/check-dsh-e2e-mission.ts
 *
 * Sobe contra um Cockpit que já carregou o código DSH (worktree feat/dsh-pr*).
 * Não exige que o worker complete a tarefa — só path DSH + kill limpo.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { backendDo } from "../servidor/config.ts";

if (process.env.DSH_E2E !== "1") {
  console.log("skip: defina DSH_E2E=1 (Cockpit vivo com código DSH) para o E2E");
  process.exit(0);
}

const PORT = process.env.COCKPIT_PORT ?? "3000";
const BASE = `http://127.0.0.1:${PORT}`;
const PROJECT = process.env.COCKPIT_PROJECT ?? "projd35d1d222c58";

async function api(path: string, body?: unknown, method?: string): Promise<any> {
  const res = await fetch(BASE + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method ?? (body ? "POST" : "GET")} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return data;
}

function countDshSdkProcesses(): number {
  try {
    const out = execSync("ps -eo pid,args", { encoding: "utf8" });
    return out
      .split("\n")
      .filter((l) => /--profile\s+sdk/.test(l) && /dsh|deepseek-harness|bin\.js/.test(l))
      .filter((l) => !l.includes("check-dsh-e2e"))
      .length;
  } catch {
    return 0;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log("=== E2E DSH: missão Claude+Codex ===\n");
assert.equal(backendDo("claude"), "dsh");
assert.equal(backendDo("codex"), "dsh");

await api("/api/config");

const before = countDshSdkProcesses();
console.log(`  processos sdk antes: ${before}`);

const mission = await api("/api/missions", {
  projectId: PROJECT,
  nome: `dsh-e2e-${Date.now().toString(36)}`,
  objetivo: "E2E DSH: spawn claude+codex, transcript, kill",
  modo: "autonomo",
  elenco: { clis: ["claude", "codex", "grok"] },
});
const missionId: string = mission.id;
assert.ok(missionId, "missão criada");
console.log(`  missão ${missionId}`);

let claudePane: string | undefined;
let codexPane: string | undefined;
let during = before;

try {
  // Claude pode não estar no PATH desta máquina — Codex basta para provar o path DSH.
  const hasClaude = await fetch(`${BASE}/api/config`)
    .then(async () => {
      const { execSync } = await import("node:child_process");
      try {
        execSync("command -v claude", { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    })
    .catch(() => false);

  if (hasClaude) {
    const claude = await api(`/api/missions/${missionId}/delegar`, {
      agent: "builder",
      tarefa: "Responda apenas: pong-dsh-claude. Não edite arquivos.",
      tipo: "explorar",
      provedor: "claude",
    });
    claudePane = claude.paneId;
    assert.ok(claudePane, "pane claude");
    console.log(`  claude pane ${claudePane}`);
  } else {
    console.log("  claude ausente no PATH — E2E só com Codex (ainda valida backend dsh)");
  }

  const codex = await api(`/api/missions/${missionId}/delegar`, {
    agent: "terra",
    tarefa: "Responda apenas: pong-dsh-codex. Não edite arquivos.",
    tipo: "explorar",
    provedor: "codex",
  });
  codexPane = codex.paneId;
  assert.ok(codexPane, "pane codex");
  console.log(`  codex pane ${codexPane}`);

  let sawDsh = false;
  let lastStatus = "";
  for (let i = 0; i < 50; i++) {
    await sleep(400);
    const panes = (await api(`/api/panes?missionId=${missionId}`)).panes as any[];
    const ours = panes.filter((p) => p.paneId === claudePane || p.paneId === codexPane);
    lastStatus = ours.map((p) => `${p.label}:${p.status}`).join(" ");
    for (const p of ours) {
      const blob = `${p.saida_recente ?? ""}\n${p.blockedReason ?? ""}`;
      if (/\[dsh\]|deepseek-harness-sdk-runtime|runtime 0\.1\.5/.test(blob)) sawDsh = true;
    }
    try {
      const r = await api(`/api/missions/${missionId}/resultado/${encodeURIComponent(claudePane!)}`);
      if (/\[dsh\]|deepseek-harness-sdk-runtime/.test(String(r.saida ?? ""))) sawDsh = true;
    } catch {
      /* pane ainda subindo */
    }
    if (sawDsh) break;
    if (ours.every((p) => p.status === "failed")) break;
  }

  during = countDshSdkProcesses();
  console.log(`  status: ${lastStatus}`);
  console.log(`  transcript/banner DSH: ${sawDsh}`);
  console.log(`  processos sdk durante: ${during}`);

  const panes = (await api(`/api/panes?missionId=${missionId}`)).panes as any[];
  const xPane = panes.find((p) => p.paneId === codexPane);
  assert.ok(xPane, "pane codex ainda listado");
  assert.equal(xPane.cli, "codex");
  if (claudePane) {
    const cPane = panes.find((p) => p.paneId === claudePane);
    assert.ok(cPane, "pane claude ainda listado");
    assert.equal(cPane.cli, "claude");
    if (cPane.status === "failed" && xPane.status === "failed") {
      throw new Error(`ambos failed: ${cPane.blockedReason} | ${xPane.blockedReason}`);
    }
  } else if (xPane.status === "failed") {
    throw new Error(`codex failed: ${xPane.blockedReason}`);
  }
  assert.ok(
    sawDsh || during > before || ["starting", "working", "waiting-user"].includes(xPane.status),
    "path DSH deve mostrar banner, processo sdk ou pane vivo",
  );} finally {
  await api(`/api/missions/${missionId}`, undefined, "DELETE");
  console.log("  missão arquivada");
}

await sleep(2500);
const after = countDshSdkProcesses();
console.log(`  processos sdk depois: ${after}`);

assert.ok(
  after <= before,
  `possível zumbi DSH: antes=${before} durante=${during} depois=${after}`,
);

let leftover = 0;
try {
  leftover = ((await api(`/api/panes?missionId=${missionId}`)).panes as any[]).length;
} catch {
  leftover = 0; // missão sumiu — ok
}
assert.equal(leftover, 0, "nenhum pane da missão E2E deve sobrar");

console.log("\nSUCESSO: E2E missão Claude+Codex via DSH (spawn → kill limpo)");
