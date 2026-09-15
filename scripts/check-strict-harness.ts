import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolverHarness, resolveHarness } from "../servidor/harness.ts";
import { config } from "../servidor/config.ts";

console.log("Starting strict harness verification...");

// 1. Verify default maestroAutoSwitch is false in cockpit.json and config.ts
const cockpitJson = JSON.parse(readFileSync("cockpit.json", "utf8"));
assert.equal(
  cockpitJson.maestroAutoSwitch,
  false,
  "cockpit.json must have maestroAutoSwitch: false default",
);
assert.equal(
  config.maestroAutoSwitch,
  false,
  "config.maestroAutoSwitch must default to false",
);

// 2. Test removal of silent fallback & whitelist rejection
// Whitelist allows only "claude". Requesting "codex" must throw explicit error.
assert.throws(
  () => {
    resolverHarness({
      agent: "astra", // uses codex in catalog
      elenco: { clis: ["claude"] },
    });
  },
  (err: Error) => {
    assert.match(
      err.message,
      /Executor "codex" não permitido no elenco desta missão/,
      "Must throw explicit whitelist rejection error without silent fallback to permitidos[0]",
    );
    return true;
  },
);

// Also test via Interface Contract 4 resolveHarness
assert.throws(
  () => {
    resolveHarness("codex", ["claude"], false);
  },
  (err: Error) => {
    assert.match(
      err.message,
      /Executor "codex" não permitido no elenco desta missão/,
      "resolveHarness must throw whitelist rejection error",
    );
    return true;
  },
);

// 3. Test unavailable CLI rejection
// Requesting nonexistent CLI must throw explicit error: Executor <cli> não disponível no sistema
assert.throws(
  () => {
    resolveHarness("nonexistent-ai", undefined, true);
  },
  (err: Error) => {
    assert.match(
      err.message,
      /Executor "nonexistent-ai" não disponível no sistema/,
      "Must throw unavailable system CLI error",
    );
    return true;
  },
);

assert.throws(
  () => {
    resolverHarness({
      agent: "astra",
      invoke: { cli: "nonexistent-ai" },
      checkAvailability: true,
    });
  },
  (err: Error) => {
    assert.match(
      err.message,
      /Executor "nonexistent-ai" não disponível no sistema/,
      "resolverHarness with checkAvailability must throw unavailable error",
    );
    return true;
  },
);

// 4. Test bash sovereign precedence
// Bash should never be rejected by elenco or availability check
const bashHarness = resolverHarness({
  agent: "shell",
  elenco: { clis: ["codex"] },
});
assert.equal(bashHarness.cli, "bash");
assert.equal(bashHarness.origem.cli, "soberano");

const bashExplicit = resolverHarness({
  agent: "builder",
  runner: "bash",
  elenco: { clis: ["codex"] },
});
assert.equal(bashExplicit.cli, "bash");
assert.equal(bashExplicit.origem.cli, "soberano");

const bashResolved = resolveHarness("bash", ["codex"], true);
assert.equal(bashResolved.cli, "bash");
assert.equal(bashResolved.origem.cli, "soberano");

// 5. Test task type model isolation
// Task type must not alter or choose model
const taskTypes = ["visual", "arquitetura", "implementar"];
for (const tipo of taskTypes) {
  const h = resolverHarness({ agent: "luna", tipo });
  assert.equal(h.cli, "codex");
  assert.equal(h.model, config.agents.luna?.model);
  assert.equal(h.effort, config.agents.luna?.effort);
}

console.log("PASS: check-strict-harness.ts — strict harness, whitelist rejection, availability checks, and failover defaults verified!");
