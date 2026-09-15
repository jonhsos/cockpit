import { accountPool } from "../servidor/providers/account-pool.ts";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? "  ok  " : " FALHA", msg);
  if (!cond) falhas++;
};

console.log("=== POOL DE CONTAS — INICIALIZAÇÃO E CARGA ===");
ok(accountPool.hasPool("codex"), "Pool do codex inicializado a partir do config");
ok(accountPool.hasPool("gemini"), "Pool do gemini inicializado a partir do config");
ok(accountPool.hasPool("grok"), "Pool do grok inicializado a partir do config");

const contasCodex = accountPool.getAccounts("codex");
ok(contasCodex.length >= 4, `Codex tem ${contasCodex.length} contas configuradas (>= 4)`);

const contasGemini = accountPool.getAccounts("gemini");
ok(contasGemini.length >= 4, `Gemini tem ${contasGemini.length} contas configuradas (>= 4)`);

console.log("\n=== CONCORRÊNCIA — DISTRIBUIÇÃO SIMULTÂNEA (LEAST-LOADED / LRU) ===");
// Acquire 4 panes concurrently
const acc1 = accountPool.acquire("codex", "pane-1");
const acc2 = accountPool.acquire("codex", "pane-2");
const acc3 = accountPool.acquire("codex", "pane-3");
const acc4 = accountPool.acquire("codex", "pane-4");

ok(acc1 !== null && acc2 !== null && acc3 !== null && acc4 !== null, "Todas as 4 contas foram adquiridas");
const allocatedIds = new Set([acc1?.id, acc2?.id, acc3?.id, acc4?.id]);
ok(allocatedIds.size === 4, `4 painéis simultâneos receberam 4 contas distintas: ${Array.from(allocatedIds).join(", ")}`);

console.log("\n=== AFINIDADE DE SESSÃO E AUTO-RELEASE ===");
// Session affinity por paneId: pane-1 acquires again without preferredAccountId, should get acc1
const acc1Affinity = accountPool.acquire("codex", "pane-1");
ok(acc1Affinity?.id === acc1?.id, `Afinidade de sessão por paneId preservada: pane-1 continua com ${acc1?.id}`);

// Auto-release no re-acquire com mesmo paneId para conta diferente:
const acc1Before = accountPool.getAccounts("codex").find(a => a.id === acc1!.id);
const reacquired = accountPool.acquire("codex", "pane-1", acc2!.id);
ok(reacquired?.id === acc2!.id, `Re-aquisição de pane-1 com preferredAccountId ${acc2!.id} teve sucesso`);
ok(!acc1Before?.activePanes.has("pane-1"), "Auto-release liberou pane-1 da conta anterior (acc1) sem vazamento de slots");

// Afinidade explícita com preferredAccountId
const accPref = accountPool.acquire("codex", "pane-pref", acc3!.id);
ok(accPref?.id === acc3!.id, `Afinidade explícita com preferredAccountId respeitada: alocou ${accPref?.id}`);
accountPool.release("pane-pref");

console.log("\n=== LIBERAÇÃO E RECICLAGEM ===");
accountPool.release("pane-1");
accountPool.release("pane-2");
accountPool.release("pane-3");
accountPool.release("pane-4");

const viewAfterRelease = accountPool.getView("codex")["codex"];
ok(viewAfterRelease.ativas === 0, "Após liberar todos os painéis, zero contas ativas no pool");

console.log("\n=== CIRCUIT BREAKER & DESCARTE DE CONTAS EM COOLDOWN ===");
// Mark acc1 as limited (quota exhausted)
accountPool.markLimited("codex", acc1!.id, 60_000, "429 Rate Limit Exceeded");

const viewWithCooldown = accountPool.getView("codex")["codex"];
ok(viewWithCooldown.emCooldown === 1, "1 conta registrada em cooldown");

// Now acquire for a new pane, it should NOT get acc1
const newPaneAcc = accountPool.acquire("codex", "pane-5");
ok(newPaneAcc?.id !== acc1?.id, `Conta em cooldown (${acc1?.id}) foi evitada. Alocada: ${newPaneAcc?.id}`);

// Descarte de conta em cooldown mesmo quando solicitada via preferredAccountId
const prefInCooldown = accountPool.acquire("codex", "pane-6", acc1!.id);
ok(prefInCooldown?.id !== acc1!.id, `Conta em cooldown descartada mesmo com preferredAccountId: evitou ${acc1?.id}, alocou ${prefInCooldown?.id}`);
accountPool.release("pane-6");

// Failover check: nextAvailable from acc1
const next = accountPool.nextAvailable("codex", acc1!.id);
ok(next !== null && next.id !== acc1?.id, `Failover encontrou próxima conta saudável no mesmo pool: ${next?.id}`);

console.log("\n=== RESET DE COOLDOWN ===");
accountPool.resetLimit("codex", acc1!.id);
const viewAfterReset = accountPool.getView("codex")["codex"];
ok(viewAfterReset.emCooldown === 0, "Cooldown resetado com sucesso, zero contas bloqueadas");

console.log("\n=== EXPANSÃO DE DIRETÓRIOS DE AMBIENTE ===");
const codexDirs = accountPool.getAllEnvDirs("CODEX_HOME");
ok(codexDirs.length >= 4, `getAllEnvDirs retornou ${codexDirs.length} pastas expandidas`);
ok(codexDirs.every(d => !d.startsWith("~") && !d.startsWith("$HOME")), "Nenhum diretório contém ~ ou $HOME não expandido");

// Final cleanup
accountPool.release("pane-5");

if (falhas > 0) {
  console.error(`\n${falhas} testes falharam no account-pool!`);
  process.exit(1);
} else {
  console.log("\nTodos os testes do Account Pool passaram com sucesso!");
  process.exit(0);
}
