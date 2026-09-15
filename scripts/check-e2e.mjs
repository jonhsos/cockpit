// Integration check for master runner scripts/testar.mjs
import { harness } from "./e2e/framework.mjs";
import { registerTier1Tests } from "./e2e/tier1-features.mjs";
import { registerTier2Tests } from "./e2e/tier2-boundaries.mjs";
import { registerTier3Tests } from "./e2e/tier3-combinations.mjs";
import { registerTier4Tests } from "./e2e/tier4-scenarios.mjs";
import assert from "node:assert/strict";

// Register test suites across all 4 tiers
registerTier1Tests();
registerTier2Tests();
registerTier3Tests();
registerTier4Tests();

// Run all test cases
const summary = await harness.run();

if (summary.failed > 0) {
  console.error(`FALHA E2E: ${summary.failed} de ${summary.total} testes falharam.`);
  summary.failures.forEach((f) => console.error(`  - [Tier ${f.tier}] [${f.feature}] ${f.name}: ${f.error}`));
  process.exit(1);
}

assert.equal(summary.total, 550, `Esperado 550 testes no total, recebido ${summary.total}`);
assert.equal(summary.failed, 0, "Nenhum teste E2E pode falhar");

console.log(`PASS: Bateria E2E completa executada com sucesso (${summary.passed}/${summary.total} testes em 4 tiers).`);
