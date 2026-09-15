import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditLogger, REDACTED_MARKER } from "../servidor/security/index.ts";

console.log("Running check-security-audit.ts...");

const testHome = mkdtempSync(join(tmpdir(), "cockpit-test-audit-"));

try {
  const logger = new AuditLogger(testHome);

  // 1. Log with sensitive details: automatic sanitization before disk write
  const rawKey = "sk-ant-api03-secretkey1234567890secretkey1234567890";
  logger.logAction(
    "config:update",
    { type: "user", id: "admin-1" },
    { apiKeyConfigured: rawKey, setting: "active" },
    { missionId: "m1", taskId: "t1" }
  );

  const globalAuditPath = join(testHome, "audit.jsonl");
  assert.ok(existsSync(globalAuditPath), "Global audit file must exist");

  const rawDiskContent = readFileSync(globalAuditPath, "utf8");
  assert.ok(
    !rawDiskContent.includes(rawKey),
    "Audit log file on disk MUST NOT contain unredacted API key"
  );
  assert.ok(
    rawDiskContent.includes(REDACTED_MARKER),
    "Audit log file must contain REDACTED_MARKER"
  );
  console.log("  ✓ 1. Sensitive detail sanitization before disk write validated");

  // 2. Log across all 10 categories
  // 1. activity
  logger.logAction("pane:open", { type: "user", id: "u1" }, { role: "builder" }, { missionId: "m1" });

  // 2. token
  logger.logTokenUsage("anthropic", "claude-3-7-sonnet", 1500, 800, 0.045, { missionId: "m1" });

  // 3. cost
  logger.log({
    category: "cost",
    severity: "info",
    action: "cost:record",
    actor: { type: "system", id: "billing" },
    missionId: "m1",
    details: { costUsd: 0.12, model: "gpt-6-astra" },
  });

  // 4. admin
  logger.logAdminCommand("reload_config", { type: "user", id: "u1" }, { force: true }, "m1");

  // 5. executor_change
  logger.logExecutorChange("codex", "claude", "Quota exceeded", { missionId: "m1" });

  // 6. handoff
  logger.log({
    category: "handoff",
    severity: "info",
    action: "handoff:transfer",
    actor: { type: "agent", id: "builder-1" },
    missionId: "m1",
    details: { fromPane: "p1", toPane: "p2", taskId: "t1" },
  });

  // 7. file_change
  logger.log({
    category: "file_change",
    severity: "info",
    action: "file:write",
    actor: { type: "agent", id: "builder-1" },
    missionId: "m1",
    details: { path: "src/auth.ts", bytes: 1024 },
  });

  // 8. test_run
  logger.logTestRun("unit-auth", true, 342, "All tests passed", "m1");

  // 9. error
  logger.log({
    category: "error",
    severity: "error",
    action: "process:crash",
    actor: { type: "system", id: "pty-monitor" },
    missionId: "m1",
    details: { exitCode: 137, signal: "SIGKILL" },
  });

  // 10. security
  logger.logSecurityEvent("unauthorized_path_access", "critical", { path: "../../etc/shadow" }, "m1");

  console.log("  ✓ 2. All 10 audit categories logged successfully");

  // 3. Query audit log with filters
  const allEvents = await logger.query({});
  assert.equal(allEvents.length, 11); // 1 from step 1 + 10 from step 2

  const tokenEvents = await logger.query({ category: "token" });
  assert.equal(tokenEvents.length, 1);
  assert.equal(tokenEvents[0].action, "token_usage");
  assert.equal(tokenEvents[0].details.totalTokens, 2300);

  const securityEvents = await logger.query({ category: "security" });
  assert.equal(securityEvents.length, 1);
  assert.equal(securityEvents[0].severity, "critical");

  const limitedEvents = await logger.query({ limit: 3 });
  assert.equal(limitedEvents.length, 3);
  console.log("  ✓ 3. Audit query and filtering validated");

  console.log("\nPASS: all security audit checks passed.");
} finally {
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}
