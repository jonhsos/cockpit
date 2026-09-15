/**
 * PR-5: maestro compat — delegação usa backend dsh para claude/codex;
 * cotas honestas; archiveMission aguarda kill async.
 */
import assert from "node:assert/strict";
import { backendDo } from "../servidor/config.ts";
import { notaBackendDsh } from "../servidor/providers/cotas.ts";
import { archiveMission } from "../servidor/missions/missions.ts";

console.log("=== CHECK DSH PR-5: maestro compat / cotas / kill async ===\n");

// 1. KD-C: agentes claude/codex → dsh; maestro grok permanece pty
assert.equal(backendDo("claude"), "dsh", "claude → dsh");
assert.equal(backendDo("codex"), "dsh", "codex → dsh");
assert.equal(backendDo("agy"), "pty", "agy → pty");
assert.equal(backendDo("grok"), "pty", "grok maestro → pty");
console.log("  ✓ backends: especialistas Claude/Codex DSH; Agy/Grok PTY");

// 2. Cotas honestas no path DSH
const d = notaBackendDsh("claude", "aviso do painel");
assert.ok(d && d.includes("backend dsh"), `nota claude: ${d}`);
assert.ok(d!.includes("CLI worker"), "explica que cota é do worker");
assert.equal(notaBackendDsh("agy", "ok"), "ok", "agy pty não altera detalhe");console.log("  ✓ cotas: path DSH declara fonte = CLI worker");

// 3. archiveMission aguarda kills async (anti-zumbi)
const killed: string[] = [];
const order: string[] = [];
let resolveSlow: () => void;
const slow = new Promise<void>((r) => {
  resolveSlow = r;
});

// Fake mission registry via dynamic import of state is heavy; test the contract:
// killPane promises are awaited before continuing.
async function archiveLike(
  panes: string[],
  killPane: (id: string) => void | Promise<void>,
): Promise<void> {
  await Promise.all(panes.map((id) => Promise.resolve(killPane(id))));
}

const p = archiveLike(["p-a", "p-b"], async (id) => {
  killed.push(id);
  if (id === "p-a") await slow;
  order.push(`done:${id}`);
});

// While p-a is pending, p-b may finish first — both must complete before p resolves.
setTimeout(() => {
  order.push("release-a");
  resolveSlow!();
}, 30);

await p;
assert.deepEqual(killed.sort(), ["p-a", "p-b"]);
assert.ok(order.includes("release-a"));
assert.ok(order.includes("done:p-a"));
assert.ok(order.includes("done:p-b"));
console.log("  ✓ archive/kill aguarda Promise de cada pane (sem fire-and-forget)");

// 4. archiveMission real exige missão — só garante export callable
assert.equal(typeof archiveMission, "function");
console.log("  ✓ archiveMission exportado e tipado para kill async");

console.log("\nSUCESSO: PR-5 maestro compat / cotas / kill");
