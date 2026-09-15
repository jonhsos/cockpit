import assert from "node:assert/strict";
import { resolverHarness } from "../servidor/harness.ts";
import { config } from "../servidor/config.ts";

// Regression: the Visual task must never turn Codex specialists into Gemini.
for (const agent of ["luna", "terra", "astra"]) {
  const result = resolverHarness({ agent, tipo: "visual" });
  assert.equal(result.cli, "codex");
  assert.equal(result.model, config.agents[agent]!.model);
  assert.equal(result.effort, config.agents[agent]!.effort);
  assert.equal(result.origem.cli, "catálogo");
}
assert.equal(resolverHarness({ agent: "artista", tipo: "visual" }).cli, "agy");
assert.equal(resolverHarness({ agent: "builder", tipo: "visual" }).cli, "claude");
assert.equal(resolverHarness({ agent: "astra", tipo: "implementar" }).model, "gpt-6-astra");
assert.equal(resolverHarness({ agent: "luna", tipo: "arquitetura" }).model, "gpt-5.6-luna");
assert.equal(resolverHarness({ agent: "astra", tipo: "visual", invoke: { cli: "agy" } }).cli, "agy");
assert.equal(resolverHarness({ agent: "astra", tipo: "visual", invoke: { cli: "agy" }, roster: { cli: "codex" } }).cli, "codex");
assert.throws(() => resolverHarness({ agent: "inexistente" }));

// Regressão: escolher SHELL deve abrir bash para qualquer papel, mesmo quando
// missão libera só Codex ou política fixa uma execução para aquele papel.
for (const agent of Object.keys(config.agents)) {
  const shell = resolverHarness({
    agent,
    invoke: { cli: "bash" },
    elenco: { clis: ["codex"], porCli: { codex: { model: "gpt-6-astra" } } },
  });
  assert.equal(shell.cli, "bash", `${agent} trocou SHELL por ${shell.cli}`);
  assert.equal(shell.model, undefined, `${agent} carregou modelo dentro do SHELL`);
  assert.equal(shell.effort, undefined, `${agent} carregou effort dentro do SHELL`);
}
assert.equal(resolverHarness({ agent: "shell", elenco: { clis: ["codex"] } }).cli, "bash");

console.log("PASS: tipo preserva agente; SHELL explícito sempre permanece bash vazio.");
