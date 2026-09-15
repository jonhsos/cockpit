import assert from "node:assert/strict";
import { config } from "../servidor/config.ts";
import { resolverHarness } from "../servidor/harness.ts";
import { validarPoliticaIA } from "../servidor/politica-ia.ts";

const original = config.politicaIA;
try {
  config.politicaIA = { modo: "padrao" };
  const baseline = resolverHarness({ agent: "builder", tipo: "implementar" });
  console.log("Regra visual anterior (sem personalização):", resolverHarness({ agent: "luna", tipo: "visual" }).cli);
  const sol = { cli: "codex", model: "gpt-5.6-sol", effort: "high" };
  config.politicaIA = validarPoliticaIA({ modo: "unica", unica: sol });
  for (const [agent, spec] of Object.entries(config.agents)) {
    if (spec.cli === "bash") continue;
    for (const tipo of Object.keys(config.harness?.tipos ?? {})) {
      const result = resolverHarness({ agent, tipo, elenco: { clis: ["claude"], porCli: { claude: { model: "opus" } } }, roster: { cli: "agy" }, invoke: { model: "haiku" } });
      assert.equal(result.cli, sol.cli);
      assert.equal(result.model, sol.model);
      assert.equal(result.effort, sol.effort);
    }
  }
  assert.equal(resolverHarness({ agent: "shell" }).cli, "bash");
  assert.equal(
    resolverHarness({ agent: "shell", tipo: "implementar", elenco: { clis: ["codex"] } }).cli,
    "bash",
    "SHELL vazio não pode virar Codex por causa do elenco da missão",
  );
  assert.equal(
    resolverHarness({ agent: "shell", invoke: { cli: "codex" }, elenco: { clis: ["codex"] } }).cli,
    "codex",
    "SHELL só vira IA após escolha explícita",
  );
  config.politicaIA = validarPoliticaIA({ modo: "dividida", papeis: { builder: sol } });
  assert.equal(resolverHarness({ agent: "builder", tipo: "arquitetura" }).model, sol.model);
  assert.equal(resolverHarness({ agent: "piloto" }).cli, config.agents.piloto!.cli);
  config.politicaIA = validarPoliticaIA({ modo: "padrao" });
  assert.deepEqual(resolverHarness({ agent: "builder", tipo: "implementar" }), baseline);
  assert.throws(() => validarPoliticaIA({ modo: "unica", unica: { ...sol, model: "opus" } }));
  assert.throws(() => validarPoliticaIA({ modo: "dividida", papeis: { inexistente: sol } }));
  assert.throws(() => validarPoliticaIA({ modo: "unica" }));
  assert.throws(() => validarPoliticaIA({ modo: "outro" }));
  console.log("PASS: IA única em todos os papéis/tarefas, divisão, restauração do padrão, shell e validação.");
} finally {
  config.politicaIA = original;
}
