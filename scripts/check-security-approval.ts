import assert from "node:assert/strict";
import {
  ApprovalManager,
} from "../servidor/security/index.ts";

console.log("Running check-security-approval.ts...");

const approval = new ApprovalManager();

// 1. Create confirmation request for destructive action (kill_pane)
const req1 = approval.createRequest({
  action: "kill_pane",
  title: "Encerrar painel de execução",
  description: "Interromperá o processo PTY ativo",
  severity: "danger",
  target: { paneId: "pane-999", missionId: "m1" },
  requestedBy: { type: "agent", id: "maestro" },
  ttlMs: 5000,
});

assert.ok(req1.id.startsWith("conf-"));
assert.equal(req1.action, "kill_pane");
assert.equal(req1.status, "pending");
assert.equal(req1.severity, "danger");
assert.equal(approval.listPending().length, 1);
console.log("  ✓ 1. Destructive action confirmation request creation validated");

// 2. Approve confirmation request
const approvedReq = await approval.approve(req1.id, "user-admin");
assert.equal(approvedReq.status, "approved");
assert.equal(approvedReq.resolvedBy, "user-admin");
assert.ok(approvedReq.resolvedAt! > 0);
assert.equal(approval.listPending().length, 0);

// Re-approving an already approved request throws error
await assert.rejects(async () => {
  await approval.approve(req1.id, "user-admin");
});
console.log("  ✓ 2. Approval transition and idempotency check validated");

// 3. Reject confirmation request
const req2 = approval.createRequest({
  action: "merge_worktree",
  title: "Merge de worktree",
  description: "Mesclagem direta no branch principal",
  severity: "critical",
  target: { branch: "main", worktree: "/tmp/wt" },
  requestedBy: { type: "agent", id: "builder-1" },
});

const rejectedReq = await approval.reject(req2.id, "reviewer-1", "Faltam testes de regressão");
assert.equal(rejectedReq.status, "rejected");
assert.equal(rejectedReq.resolvedBy, "reviewer-1");
assert.equal(rejectedReq.reason, "Faltam testes de regressão");
console.log("  ✓ 3. Rejection transition and reason recording validated");

// 4. Expired confirmation request cannot be approved
const reqExpired = approval.createRequest({
  action: "lock_override",
  title: "Forçar liberação de arquivo",
  description: "Quebrar lock exclusivo de outro agente",
  severity: "danger",
  target: { file: "db.ts" },
  requestedBy: { type: "agent", id: "builder-2" },
  ttlMs: 50, // 50 milliseconds TTL
});

// Wait for expiration
await new Promise((resolve) => setTimeout(resolve, 80));

await assert.rejects(
  async () => {
    await approval.approve(reqExpired.id, "user-admin");
  },
  (err: any) => err.message.includes("expirada")
);

const fetchedExpired = approval.get(reqExpired.id);
assert.equal(fetchedExpired?.status, "expired");
assert.equal(approval.listPending().length, 0);
console.log("  ✓ 4. TTL expiration and rejection of expired approval validated");

// 5. Clean expired requests
const cleanedCount = approval.cleanExpired();
assert.ok(cleanedCount >= 1);
assert.equal(approval.get(reqExpired.id), undefined);
console.log("  ✓ 5. Expired request garbage collection validated");

// 6. Action Guard Pattern: Action blocked if approval is not confirmed
function executeDestructiveKill(paneId: string, confirmationId: string): { killed: boolean } {
  const req = approval.get(confirmationId);
  if (!req || req.status !== "approved") {
    throw new Error("Ação destrutiva não autorizada: confirmação pendente ou inexistente");
  }
  return { killed: true };
}

// Without approved request: must throw
assert.throws(
  () => {
    executeDestructiveKill("pane-999", "conf-fake-id");
  },
  (err: any) => err.message.includes("não autorizada")
);

// With approved request: succeeds
const result = executeDestructiveKill("pane-999", approvedReq.id);
assert.equal(result.killed, true);
console.log("  ✓ 6. Execution gate pattern with confirmation enforcement validated");

// 7. Single-Use Token Invalidation (consume API)
const reqSingleUse = approval.createRequest({
  action: "delete_resource",
  title: "Exclusão única",
  description: "Teste de token de uso único",
  severity: "danger",
  target: { resId: "res-1" },
  requestedBy: { type: "agent", id: "builder-1" },
});
await approval.approve(reqSingleUse.id, "user-admin");
assert.equal(approval.get(reqSingleUse.id)?.status, "approved");

const consumedFirst = approval.consume(reqSingleUse.id, "user-admin");
assert.equal(consumedFirst, true, "First consumption of approved token must succeed");
assert.equal(approval.get(reqSingleUse.id)?.status, "consumed");

// Second consumption attempt must be rejected (replay prevention)
const consumedSecond = approval.consume(reqSingleUse.id, "user-admin");
assert.equal(consumedSecond, false, "Second consumption attempt must be rejected (anti-replay)");
console.log("  ✓ 7. Single-use token consumption (anti-replay) validated");

console.log("\nPASS: all security approval checks passed.");
