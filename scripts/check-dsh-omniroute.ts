/**
 * Verifica mapeamento OmniRoute / permissionMode (PR-4) sem spawn.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createPaneDshRuntimeConfig,
  permissionModeFor,
  resolveCodexHome,
  writePaneCordisPatch,
} from "../servidor/sessions/dsh-backend/dsh-pane-config.ts";
import { readCodexGatewayConfig } from "../servidor/providers/codex-config.ts";
import { contaAutenticada } from "../servidor/providers/account-pool.ts";
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

const codexHome = config.clis.codex?.env?.CODEX_HOME;
assert.ok(codexHome, "CODEX_HOME global do Codex é obrigatório para o teste");
const gateway = readCodexGatewayConfig(codexHome);
assert.ok(gateway?.model, "config.toml do Codex precisa declarar um modelo padrão");
const liveModel = gateway.model;

const patch = writePaneCordisPatch({
  cli: "codex",
  model: "user-chosen-model",
  codexHome: "/tmp/codex-acct",
  autoAprovar: true,
  sandbox: "danger-full-access",
});
assert.ok(patch && patch.endsWith(".yml"));
const body = readFileSync(patch!, "utf8");
assert.match(body, /CODEX_HOME/);
assert.match(body, /user-chosen-model/);
assert.match(body, /dangerously-bypass-approvals-and-sandbox/);
assert.ok(!body.includes("gpt-"), "não hardcodar modelo de produto");
console.log("  ✓ patch por pane propaga CODEX_HOME + model do usuário");
rmSync(dirname(patch!), { recursive: true, force: true });

const runtimeConfig = createPaneDshRuntimeConfig({
  cli: "codex",
  model: liveModel,
  codexHome,
  autoAprovar: true,
  sandbox: "danger-full-access",
});
assert.ok(runtimeConfig);
const runtimePatch = readFileSync(runtimeConfig.patchPath, "utf8");
assert.equal(runtimeConfig.provider, "cockpit-codex-gateway");
assert.equal(runtimeConfig.model, liveModel);
assert.match(runtimePatch, /api: openai-responses/);
assert.match(runtimePatch, /http:\/\/127\.0\.0\.1:20128\/v1/);
assert.ok(!runtimePatch.includes("deepseek-official"));
assert.ok(process.env[runtimeConfig.credentialEnv], `${runtimeConfig.credentialEnv} precisa estar presente`);
assert.equal(
  contaAutenticada("codex", { CODEX_HOME: config.clis.codex?.env?.CODEX_HOME ?? "" }),
  true,
  "gateway com env_key disponível deve contar como autenticado",
);
rmSync(dirname(runtimeConfig.patchPath), { recursive: true, force: true });
console.log("  ✓ DSH usa OmniRoute como LLM principal sem depender de DeepSeek API");

const unsafeHome = mkdtempSync(join(tmpdir(), "cockpit-codex-config-"));
try {
  writeFileSync(
    join(unsafeHome, "config.toml"),
    'model_provider = "unsafe"\n[model_providers.unsafe]\nbase_url = "http://example.com/v1"\nenv_key = "SAFE_KEY"\nwire_api = "responses"\n',
  );
  assert.throws(() => readCodexGatewayConfig(unsafeHome), /HTTPS/);
} finally {
  rmSync(unsafeHome, { recursive: true, force: true });
}
console.log("  ✓ gateway remoto sem TLS é rejeitado");

assert.ok(config.clis.codex?.env?.CODEX_HOME || config.clis.codex?.pool?.length, "codex tem home/pool");
console.log("\nSUCESSO: OmniRoute + backends PR-4");
