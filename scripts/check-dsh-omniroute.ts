/**
 * Verifica mapeamento OmniRoute / permissionMode (PR-4) sem spawn.
 */
import assert from "node:assert/strict";
import {
  permissionModeFor,
  resolveCodexHome,
  writePaneCordisPatch,
} from "../servidor/sessions/dsh-backend/dsh-pane-config.ts";
import { backendDo, config } from "../servidor/config.ts";

console.log("=== CHECK DSH PR-4: OmniRoute + backends ===\n");

assert.equal(backendDo("claude"), "dsh");
assert.equal(backendDo("codex"), "dsh");
assert.equal(backendDo("agy"), "pty");
assert.equal(backendDo("grok"), "pty");
assert.equal(backendDo("bash"), "pty");
console.log("  ✓ backends: claude/codex=dsh; agy/grok/bash=pty");

assert.equal(
  permissionModeFor({
    cli: "codex",
    autoAprovar: true,
    sandbox: "danger-full-access",
  }),
  "dangerously-bypass-approvals-and-sandbox",
);
assert.equal(
  permissionModeFor({
    cli: "codex",
    autoAprovar: true,
    sandbox: "workspace-write",
  }),
  "never",
);
assert.equal(
  permissionModeFor({
    cli: "claude",
    autoAprovar: true,
    sandbox: "danger-full-access",
  }),
  "bypassPermissions",
);
assert.equal(
  permissionModeFor({
    cli: "claude",
    autoAprovar: false,
    sandbox: "workspace-write",
  }),
  "dontAsk",
);
console.log("  ✓ permissionMode mapeado (sem inventar política nova)");

assert.equal(resolveCodexHome({ CODEX_HOME: "/tmp/home-x" }), "/tmp/home-x");
assert.equal(resolveCodexHome({}), undefined);

const patch = writePaneCordisPatch({
  cli: "codex",
  model: "user-chosen-model",
  codexHome: "/tmp/codex-acct",
  autoAprovar: true,
  sandbox: "danger-full-access",
});
assert.ok(patch && patch.endsWith(".yml"));
const fs = await import("node:fs");
const body = fs.readFileSync(patch!, "utf8");
assert.match(body, /CODEX_HOME/);
assert.match(body, /user-chosen-model/);
assert.match(body, /dangerously-bypass-approvals-and-sandbox/);
assert.ok(!body.includes("gpt-"), "não hardcodar modelo de produto");
console.log("  ✓ patch por pane propaga CODEX_HOME + model do usuário");

assert.ok(config.clis.codex?.env?.CODEX_HOME || config.clis.codex?.pool?.length, "codex tem home/pool");
console.log("\nSUCESSO: OmniRoute + backends PR-4");
