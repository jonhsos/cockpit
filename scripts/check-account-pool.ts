import { accountPool, argumentosDeLogin } from "../servidor/providers/account-pool.ts";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? "  ok  " : " FALHA", msg);
  if (!cond) falhas++;
};

console.log("=== POOL DE CONTAS — INICIALIZAÇÃO E CARGA ===");
ok(JSON.stringify(argumentosDeLogin("codex")) === JSON.stringify(["login", "--device-auth"]), "Codex usa login por dispositivo");
ok(JSON.stringify(argumentosDeLogin("agy")) === JSON.stringify(["login"]), "Outros CLIs mantêm o login padrão");
ok(accountPool.hasPool("codex"), "Pool do codex inicializado a partir do config");
ok(accountPool.hasPool("agy"), "Pool do agy inicializado a partir do config");
ok(accountPool.hasPool("grok"), "Pool do grok inicializado a partir do config");

const contasCodex = accountPool.getAccounts("codex");
ok(contasCodex.length >= 4, `Codex tem ${contasCodex.length} contas configuradas (>= 4)`);

const contasAgy = accountPool.getAccounts("agy");
ok(contasAgy.length >= 4, `AGY tem ${contasAgy.length} contas configuradas (>= 4)`);

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
ok(codexDirs.length >= 4, `getAllEnvDirs(CODEX_HOME) retornou ${codexDirs.length} pastas expandidas`);
ok(codexDirs.every(d => !d.startsWith("~") && !d.startsWith("$HOME")), "Nenhum diretório CODEX_HOME contém ~ ou $HOME não expandido");

const agyJetskiDirs = accountPool.getAllEnvDirs("JETSKI_APP_DATA_DIR");
ok(agyJetskiDirs.length >= 4, `getAllEnvDirs(JETSKI_APP_DATA_DIR) retornou ${agyJetskiDirs.length} pastas expandidas`);
ok(agyJetskiDirs.every(d => !d.startsWith("~") && !d.startsWith("$HOME")), "Nenhum diretório JETSKI_APP_DATA_DIR contém ~ ou $HOME");

const agyHomeDirs = accountPool.getAllEnvDirs("HOME");
ok(agyHomeDirs.length >= 4, `getAllEnvDirs(HOME) retornou ${agyHomeDirs.length} pastas expandidas`);
ok(agyHomeDirs.every(d => !d.startsWith("~") && !d.startsWith("$HOME")), "Nenhum diretório HOME contém ~ ou $HOME");

console.log("\n=== CONCORRÊNCIA AGY — DISTRIBUIÇÃO SIMULTÂNEA DAS 4 CONTAS ===");
const agy1 = accountPool.acquire("agy", "pane-agy-1");
const agy2 = accountPool.acquire("agy", "pane-agy-2");
const agy3 = accountPool.acquire("agy", "pane-agy-3");
const agy4 = accountPool.acquire("agy", "pane-agy-4");

ok(agy1 !== null && agy2 !== null && agy3 !== null && agy4 !== null, "Todas as 4 contas do AGY foram adquiridas");
const allocatedAgyIds = new Set([agy1?.id, agy2?.id, agy3?.id, agy4?.id]);
ok(allocatedAgyIds.size === 4, `4 painéis simultâneos receberam 4 contas distintas do AGY: ${Array.from(allocatedAgyIds).join(", ")}`);
ok(Boolean(agy1?.env?.JETSKI_APP_DATA_DIR), "Conta AGY 1 possui JETSKI_APP_DATA_DIR");
ok(Boolean(agy1?.env?.HOME), "Conta AGY 1 possui HOME");
ok(!agy1?.env?.JETSKI_APP_DATA_DIR?.startsWith("~"), "JETSKI_APP_DATA_DIR expandido sem ~");
ok(!agy1?.env?.HOME?.startsWith("~"), "HOME expandido sem ~");

// Teste de rotação e circuit breaker no AGY
accountPool.markLimited("agy", agy1!.id, 60_000, "ResourceExhausted / Quota Limit");
const nextAgy = accountPool.nextAvailable("agy", agy1!.id);
ok(nextAgy !== null && nextAgy.id !== agy1?.id, `Failover AGY encontrou próxima conta saudável no mesmo pool: ${nextAgy?.id}`);
accountPool.resetLimit("agy", agy1!.id);

accountPool.release("pane-agy-1");
accountPool.release("pane-agy-2");
accountPool.release("pane-agy-3");
accountPool.release("pane-agy-4");

console.log("\n=== AUTHENTICATED FLAG NO getView ===");
const agyView = accountPool.getView("agy")["agy"];
ok(agyView.contas.every((c) => typeof c.authenticated === "boolean"), "Todas as contas AGY expõem authenticated boolean");
const codexView = accountPool.getView("codex")["codex"];
ok(codexView.contas.every((c) => typeof c.authenticated === "boolean"), "Todas as contas Codex expõem authenticated boolean");
const agyAuth = agyView.contas.filter((c) => c.authenticated);
ok(agyAuth.length >= 1, `Pelo menos 1 conta AGY autenticada no disco (achou ${agyAuth.length})`);

// Final cleanup
accountPool.release("pane-5");

if (falhas > 0) {
  console.error(`\n${falhas} testes falharam no account-pool!`);
  process.exit(1);
} else {
  console.log("\nTodos os testes do Account Pool passaram com sucesso!");
  process.exit(0);
}
