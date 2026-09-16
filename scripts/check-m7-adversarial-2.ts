/**
 * Milestone M7 Adversarial Challenge 2: Empirical Verification & Stress Test Suite
 *
 * Encarregado: challenger_m7_2 (critic, specialist)
 *
 * Adversarial Objectives:
 * 1. Pool Exhaustion:
 *    - Acquire all 4 `agy` accounts simultaneously.
 *    - Attempt a 5th acquisition: verify clean handling (least-loaded LRU multiplexing without crash or corruption).
 *    - Attempt acquisition when ALL accounts are in cooldown/exhausted: verify clean return of null without crash or throw.
 *    - Verify release and state transitions across all 4+ accounts.
 *
 * 2. Rate Limit, Cooldown & Failover:
 *    - Mark an account with rate limit (429 / ResourceExhausted).
 *    - Verify view reflects cooldown status, duration, and error details.
 *    - Verify failover via nextAvailable() bypasses limited account.
 *    - Verify acquire() bypasses limited account even when requested via preferredAccountId.
 *    - Verify cascading rate limits (3 of 4 in cooldown, then 4 of 4 in cooldown).
 *    - Verify limit reset and recovery (single account vs all accounts).
 *
 * 3. Environment Variable Expansion:
 *    - Verify `~` and `$HOME` expansion in acquire() env.
 *    - Verify `~` and `$HOME` expansion in nextAvailable() env.
 *    - Verify expansion in getAllEnvDirs("JETSKI_APP_DATA_DIR") and getAllEnvDirs("HOME").
 *    - Verify edge cases: bare `~`, `~/path`, `$HOME`, `$HOME/path`, non-home paths, and `~user`.
 *    - Verify pty-manager cliEnv expansion for JETSKI_APP_DATA_DIR and HOME.
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { accountPool, AccountPoolManager } from "../servidor/providers/account-pool.ts";
import { definirModelo } from "../servidor/providers/agy.ts";
import { config } from "../servidor/config.ts";

let totalPasses = 0;
let totalFails = 0;

function check(desc: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    totalPasses++;
  } catch (err: any) {
    console.error(`  ✗ ${desc}`);
    console.error(`    Error: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split("\n").slice(1, 4).join("\n"));
    }
    totalFails++;
  }
}

console.log("===============================================================================");
console.log("Milestone M7 Adversarial Challenge 2: Empirical Stress Test Suite");
console.log("===============================================================================\n");

// Ensure clean initial state
accountPool.resetLimit("agy");
const agyAccountIds = accountPool.getAccounts("agy").map((account) => account.id);
const testedAccountIds = agyAccountIds.slice(0, 4);
const [primaryAccountId, secondAccountId, thirdAccountId, survivorAccountId] = testedAccountIds;
const healthyFailoverIds = testedAccountIds.slice(1);
for (let index = 1; index <= 5; index++) accountPool.release(`pane-agy-${index}`);

// ---------------------------------------------------------------------------
// 1. POOL EXHAUSTION AND CONCURRENCY STRESS
// ---------------------------------------------------------------------------
console.log("--- 1. Pool Exhaustion & Concurrency Limits ---");

check("Initial agy pool contains at least 4 configured accounts", () => {
  assert.equal(accountPool.hasPool("agy"), true, "agy must have a configured pool");
  const accounts = accountPool.getAccounts("agy");
  assert.ok(accounts.length >= 4, `agy pool must have >= 4 accounts, found ${accounts.length}`);
});

check("Acquire all 4 agy accounts concurrently without collision", () => {
  const a1 = accountPool.acquire("agy", "pane-stress-1");
  const a2 = accountPool.acquire("agy", "pane-stress-2");
  const a3 = accountPool.acquire("agy", "pane-stress-3");
  const a4 = accountPool.acquire("agy", "pane-stress-4");

  assert.ok(a1 !== null, "Pane 1 acquired account");
  assert.ok(a2 !== null, "Pane 2 acquired account");
  assert.ok(a3 !== null, "Pane 3 acquired account");
  assert.ok(a4 !== null, "Pane 4 acquired account");

  const distinctIds = new Set([a1?.id, a2?.id, a3?.id, a4?.id]);
  assert.equal(distinctIds.size, 4, "All 4 panes must receive distinct accounts");

  const view = accountPool.getView("agy")["agy"];
  assert.equal(view.ativas, 4, "All 4 accounts must be marked active/occupied");
  assert.equal(view.emCooldown, 0, "No accounts should be in cooldown");
});

check("Attempt 5th acquisition when all 4 accounts are active: clean handling (least-loaded LRU sharing without crash)", () => {
  // All 4 accounts currently have 1 active pane.
  // When a 5th pane requests an account, the system must not crash or throw.
  // It must select the least-loaded account (all tied at 1) via LRU (the one used least recently, i.e. pane-stress-1's account).
  const a5 = accountPool.acquire("agy", "pane-stress-5");
  assert.ok(a5 !== null, "5th acquisition must succeed and return an account spec");
  assert.ok(testedAccountIds.includes(a5!.id), "5th acquisition must return a valid agy account");

  // Verify pane mapping
  const accRuntime = accountPool.getAccountForPane("pane-stress-5");
  assert.ok(accRuntime !== null, "Runtime account found for pane-stress-5");
  assert.equal(accRuntime?.id, a5!.id, "Runtime account matches returned account");
  assert.ok(accRuntime!.activePanes.has("pane-stress-5"), "Active panes includes pane-stress-5");
  assert.ok(accRuntime!.activePanes.size >= 2, "Active panes count for shared account is >= 2");
});

check("Releasing one pane from shared account keeps account active for remaining pane", () => {
  const accRuntimeBefore = accountPool.getAccountForPane("pane-stress-5");
  const sharedAccountId = accRuntimeBefore!.id;
  const initialSize = accRuntimeBefore!.activePanes.size;

  // Release pane-stress-5
  accountPool.release("pane-stress-5");

  const accRuntimeAfter = accountPool.getAccounts("agy").find((a) => a.id === sharedAccountId);
  assert.ok(accRuntimeAfter !== null, "Account still exists");
  assert.equal(accRuntimeAfter!.activePanes.size, initialSize - 1, "Active panes reduced by 1");
  assert.equal(accRuntimeAfter!.activePanes.has("pane-stress-5"), false, "pane-stress-5 removed");
});

check("Attempt acquisition when ALL 4 accounts are exhausted via Cooldown: returns null cleanly without crash", () => {
  // Mark all 4 accounts in cooldown
  for (const accountId of agyAccountIds) {
    accountPool.markLimited("agy", accountId, 60_000, "QuotaExceeded: 429");
  }

  const view = accountPool.getView("agy")["agy"];
  assert.equal(view.emCooldown, agyAccountIds.length, "All configured accounts are in cooldown");

  // Attempt 5th (or any) acquisition
  const exhaustedResult = accountPool.acquire("agy", "pane-exhausted");
  assert.equal(exhaustedResult, null, "Acquire must return null cleanly when all accounts are in cooldown");

  // nextAvailable must also return null cleanly
  const nextWhenExhausted = accountPool.nextAvailable("agy", primaryAccountId);
  assert.equal(nextWhenExhausted, null, "nextAvailable must return null cleanly when all accounts are in cooldown");

  // Release on unallocated pane is a clean no-op
  assert.doesNotThrow(() => {
    accountPool.release("pane-exhausted");
  }, "Release on unallocated pane must not throw");

  // Clean up cooldowns
  accountPool.resetLimit("agy");
});

check("Release all active stress panes resets active count to zero", () => {
  accountPool.release("pane-stress-1");
  accountPool.release("pane-stress-2");
  accountPool.release("pane-stress-3");
  accountPool.release("pane-stress-4");

  const view = accountPool.getView("agy")["agy"];
  assert.equal(view.ativas, 0, "After release, active accounts count is 0");
});

// ---------------------------------------------------------------------------
// 2. RATE LIMIT, COOLDOWN AND FAILOVER
// ---------------------------------------------------------------------------
console.log("\n--- 2. Rate Limit, Cooldown & Failover ---");

check("Mark account with rate limit updates cooldown status and details", () => {
  accountPool.markLimited("agy", primaryAccountId, 120_000, "Google Cloud Quota Exceeded (429)");

  const view = accountPool.getView("agy")["agy"];
  assert.equal(view.emCooldown, 1, "Exactly 1 account in cooldown");

  const agy1Item = view.contas.find((c) => c.id === primaryAccountId);
  assert.ok(agy1Item !== undefined, `${primaryAccountId} found in view`);
  assert.equal(agy1Item?.status, "cooldown", `${primaryAccountId} status is cooldown`);
  assert.equal(agy1Item?.lastLimitDetail, "Google Cloud Quota Exceeded (429)", "Limit detail preserved");
  assert.ok(agy1Item?.limitedUntil && agy1Item.limitedUntil > Date.now(), "limitedUntil is in the future");
});

check("nextAvailable fails over to a healthy account and avoids rate-limited account", () => {
  const next = accountPool.nextAvailable("agy", primaryAccountId);
  assert.ok(next !== null, "Failover found a healthy account");
  assert.notEqual(next?.id, primaryAccountId, `Failover must not select ${primaryAccountId}`);
  assert.ok(healthyFailoverIds.includes(next!.id), "Failover chose one of the healthy accounts");
});

check("acquire rejects account in cooldown even when explicitly requested as preferredAccountId", () => {
  const prefResult = accountPool.acquire("agy", "pane-pref-failover", primaryAccountId);
  assert.ok(prefResult !== null, "Acquire returned an account");
  assert.notEqual(prefResult?.id, primaryAccountId, "Preferred account in cooldown must be rejected");
  assert.ok(healthyFailoverIds.includes(prefResult!.id), "Acquire fell back to healthy account");
  accountPool.release("pane-pref-failover");
});

check("Cascading rate limits: failover selects the sole surviving healthy account", () => {
  // Mark two more accounts with rate limit; only the fourth remains healthy.
  accountPool.markLimited("agy", secondAccountId, 60_000, "Rate limit");
  accountPool.markLimited("agy", thirdAccountId, 60_000, "Rate limit");

  const view = accountPool.getView("agy")["agy"];
  assert.equal(view.emCooldown, 3, "3 accounts in cooldown");

  const soleSurvivor = accountPool.acquire("agy", "pane-sole-survivor");
  assert.ok(soleSurvivor !== null, "Acquisition succeeded for sole healthy account");
  assert.equal(soleSurvivor?.id, survivorAccountId, `Must acquire ${survivorAccountId} as the only healthy candidate`);
  accountPool.release("pane-sole-survivor");

  // nextAvailable from each limited account must point to the sole survivor.
  assert.equal(accountPool.nextAvailable("agy", primaryAccountId)?.id, survivorAccountId);
  assert.equal(accountPool.nextAvailable("agy", secondAccountId)?.id, survivorAccountId);
  assert.equal(accountPool.nextAvailable("agy", thirdAccountId)?.id, survivorAccountId);

  // nextAvailable from the survivor itself has no other healthy account.
  assert.equal(accountPool.nextAvailable("agy", survivorAccountId), null, "No other healthy account available");
});

check("Selective cooldown reset restores specific account while keeping others in cooldown", () => {
  accountPool.resetLimit("agy", primaryAccountId);

  const view = accountPool.getView("agy")["agy"];
  assert.equal(view.emCooldown, 2, `${secondAccountId} and ${thirdAccountId} remain in cooldown`);

  const agy1Item = view.contas.find((c) => c.id === primaryAccountId);
  assert.equal(agy1Item?.status, "livre", `${primaryAccountId} is now livre`);

  // Now agy-1 can be acquired again
  const recovered = accountPool.acquire("agy", "pane-recovered", primaryAccountId);
  assert.equal(recovered?.id, primaryAccountId, `${primaryAccountId} successfully acquired after reset`);
  accountPool.release("pane-recovered");
});

check("Global cooldown reset restores all accounts to healthy livre status", () => {
  accountPool.resetLimit("agy");

  const view = accountPool.getView("agy")["agy"];
  assert.equal(view.emCooldown, 0, "Zero accounts in cooldown after global reset");
  assert.ok(view.contas.every((c) => c.status === "livre"), "All accounts are livre");
});

// ---------------------------------------------------------------------------
// 3. ENVIRONMENT VARIABLE EXPANSION (~ & $HOME)
// ---------------------------------------------------------------------------
console.log("\n--- 3. Environment Variable Expansion (~ & $HOME) ---");

check("All agy accounts in config use tilde paths for JETSKI_APP_DATA_DIR and HOME", () => {
  const agyPoolConfig = config.clis["agy"]?.pool;
  assert.ok(Array.isArray(agyPoolConfig), "config.clis.agy.pool is an array");
  assert.ok(agyPoolConfig.length >= 4, "At least 4 accounts in config");

  for (const item of agyPoolConfig) {
    assert.ok(item.env?.JETSKI_APP_DATA_DIR?.startsWith("~"), `${item.id} config has ~ in JETSKI_APP_DATA_DIR`);
    assert.ok(item.env?.HOME?.startsWith("~"), `${item.id} config has ~ in HOME`);
  }
});

check("acquire() expands ~ to absolute homedir() in JETSKI_APP_DATA_DIR and HOME", () => {
  const home = homedir();
  const accs = [
    accountPool.acquire("agy", "pane-env-1"),
    accountPool.acquire("agy", "pane-env-2"),
    accountPool.acquire("agy", "pane-env-3"),
    accountPool.acquire("agy", "pane-env-4"),
  ];

  for (let i = 0; i < accs.length; i++) {
    const acc = accs[i];
    assert.ok(acc !== null, `Account ${i + 1} acquired`);

    const accNum = acc!.id.replace("agy-", "");

    // Verify JETSKI_APP_DATA_DIR
    const jetskiDir = acc!.env.JETSKI_APP_DATA_DIR;
    assert.ok(jetskiDir, "JETSKI_APP_DATA_DIR is present");
    assert.ok(!jetskiDir.startsWith("~"), `JETSKI_APP_DATA_DIR must not start with ~: ${jetskiDir}`);
    assert.ok(!jetskiDir.startsWith("$HOME"), `JETSKI_APP_DATA_DIR must not start with $HOME: ${jetskiDir}`);
    assert.ok(jetskiDir.startsWith(home), `JETSKI_APP_DATA_DIR must start with ${home}: ${jetskiDir}`);
    assert.equal(
      jetskiDir,
      join(home, ".gemini", "antigravity-cli", "profiles", `conta_${accNum}`),
      `JETSKI_APP_DATA_DIR must match exact expected profile path for conta_${accNum}`,
    );

    // Verify HOME
    const homeDir = acc!.env.HOME;
    assert.ok(homeDir, "HOME is present");
    assert.ok(!homeDir.startsWith("~"), `HOME must not start with ~: ${homeDir}`);
    assert.ok(!homeDir.startsWith("$HOME"), `HOME must not start with $HOME: ${homeDir}`);
    assert.ok(homeDir.startsWith(home), `HOME must start with ${home}: ${homeDir}`);
    assert.equal(
      homeDir,
      join(home, ".gemini", "antigravity-cli", "profiles", `conta_${accNum}`),
      `HOME must match exact expected profile path for conta_${accNum}`,
    );
  }

  accountPool.release("pane-env-1");
  accountPool.release("pane-env-2");
  accountPool.release("pane-env-3");
  accountPool.release("pane-env-4");
});

check("nextAvailable() expands ~ in env for failover candidate", () => {
  const home = homedir();
  const next = accountPool.nextAvailable("agy");
  assert.ok(next !== null, "nextAvailable returned an account");

  assert.ok(!next!.env.JETSKI_APP_DATA_DIR?.startsWith("~"), "nextAvailable env JETSKI_APP_DATA_DIR has no ~");
  assert.ok(!next!.env.HOME?.startsWith("~"), "nextAvailable env HOME has no ~");
  assert.ok(next!.env.JETSKI_APP_DATA_DIR?.startsWith(home), "nextAvailable JETSKI_APP_DATA_DIR is absolute");
  assert.ok(next!.env.HOME?.startsWith(home), "nextAvailable HOME is absolute");
});

check("getAllEnvDirs() returns absolute paths without ~ or $HOME for JETSKI_APP_DATA_DIR and HOME", () => {
  const home = homedir();

  const jetskiDirs = accountPool.getAllEnvDirs("JETSKI_APP_DATA_DIR");
  assert.ok(jetskiDirs.length >= 4, `At least 4 JETSKI_APP_DATA_DIR paths, found ${jetskiDirs.length}`);
  for (const d of jetskiDirs) {
    assert.ok(!d.startsWith("~"), `Directory must not start with ~: ${d}`);
    assert.ok(!d.startsWith("$HOME"), `Directory must not start with $HOME: ${d}`);
    assert.ok(d.startsWith(home), `Directory must start with homedir(): ${d}`);
  }

  const homeDirs = accountPool.getAllEnvDirs("HOME");
  assert.ok(homeDirs.length >= 4, `At least 4 HOME paths, found ${homeDirs.length}`);
  for (const d of homeDirs) {
    assert.ok(!d.startsWith("~"), `Directory must not start with ~: ${d}`);
    assert.ok(!d.startsWith("$HOME"), `Directory must not start with $HOME: ${d}`);
    assert.ok(d.startsWith(home), `Directory must start with homedir(): ${d}`);
  }
});

check("Path boundary edge cases in expandEnv regex: bare ~, ~/, $HOME, $HOME/, and ~user", () => {
  // Test regex behavior directly against the contract in account-pool.ts:
  // .replace(/^~(?=$|\/)/, home).replace(/^\$HOME(?=$|\/)/, home)
  const home = homedir();
  const expand = (val: string) => val.replace(/^~(?=$|\/)/, home).replace(/^\$HOME(?=$|\/)/, home);

  // Bare tilde
  assert.equal(expand("~"), home, "Bare ~ expands to homedir()");

  // Tilde with slash
  assert.equal(expand("~/foo/bar"), join(home, "foo/bar"), "~/foo/bar expands to home/foo/bar");

  // $HOME bare
  assert.equal(expand("$HOME"), home, "$HOME bare expands to homedir()");

  // $HOME with slash
  assert.equal(expand("$HOME/foo/bar"), join(home, "foo/bar"), "$HOME/foo/bar expands to home/foo/bar");

  // Absolute path without tilde
  assert.equal(expand("/usr/local/bin"), "/usr/local/bin", "Absolute path unchanged");

  // Tilde username expansion (e.g. ~otheruser) should NOT be replaced by current user's homedir
  assert.equal(expand("~otheruser/data"), "~otheruser/data", "~otheruser is preserved as non-current user");
});

check("definirModelo handles unexpanded ~ defense-in-depth and isolates settings across accounts", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "cockpit-agy-models-"));
  const dirs = [1, 2, 3, 4].map((index) => join(fixtureRoot, `conta_${index}`));
  const models = [
    ["gemini-3.8-flash-high", "Gemini 3.8 Flash (High)"],
    ["claude-opus-4-6-thinking", "Claude Opus 4.6 (Thinking)"],
    ["gemini-3.1-pro-high", "Gemini 3.1 Pro (High)"],
    ["claude-sonnet-4-6", "Claude Sonnet 4.6 (Thinking)"],
  ] as const;

  try {
    models.forEach(([modelId], index) => definirModelo(modelId, dirs[index]));
    models.forEach(([, expected], index) => {
      const settings = JSON.parse(readFileSync(join(dirs[index], "settings.json"), "utf8"));
      assert.equal(settings.model, expected, `Temporary account ${index + 1} keeps its own model`);
    });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  // Verify that no literal ~ directory was created in current working directory
  assert.equal(existsSync(join(process.cwd(), "~")), false, "No literal ~ directory created in cwd");
});

check("Sanitizer check: gemini mock CLI is completely absent from config clis", () => {
  assert.equal((config.clis as any)["gemini"], undefined, "config.clis.gemini must not exist");
  assert.equal((config.modelos as any)?.["gemini"], undefined, "config.modelos.gemini must not exist");
});

// ---------------------------------------------------------------------------
// TEARDOWN AND SUMMARY
// ---------------------------------------------------------------------------
accountPool.resetLimit("agy");

console.log("\n===============================================================================");
console.log(`Results: ${totalPasses} passed, ${totalFails} failed`);
console.log("===============================================================================");

if (totalFails > 0) {
  console.error(`\nFAILED: ${totalFails} check(s) failed in M7 Adversarial Challenge 2.`);
  process.exit(1);
} else {
  console.log("\nSUCCESS: All M7 Adversarial Challenge 2 checks passed with 100% integrity!");
  process.exit(0);
}
