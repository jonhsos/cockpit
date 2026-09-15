import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskStore } from "../servidor/persistence/disk-store.ts";
import { ConnectionStore } from "../servidor/persistence/connection-store.ts";
import { ConnectionManager } from "../servidor/connections/connection-manager.ts";
import { TaskStore } from "../servidor/persistence/task-store.ts";
import { TaskManager } from "../servidor/tasks/task-manager.ts";
import { FileOwnershipManager } from "../servidor/tasks/file-ownership.ts";
import { sanitizeCleanShellEnv } from "../servidor/sessions/clean-shell.ts";

console.log("Starting check-pane-kill-cleanup.ts verification...");

const tempDir = mkdtempSync(join(tmpdir(), "check-cleanup-"));

try {
  // Test 1: NVM / npm_config_prefix sanitization
  console.log("1. Verifying npm_* sanitization in clean shell env...");
  const dirtyEnv: NodeJS.ProcessEnv = {
    ...process.env,
    npm_config_prefix: "/home/jj/.local",
    npm_lifecycle_event: "server",
    npm_package_name: "cockpit",
    NPM_CONFIG_GLOBAL: "true",
  };
  const cleaned = sanitizeCleanShellEnv(dirtyEnv, { paneId: "p1", label: "Shell" });
  assert.equal(cleaned.npm_config_prefix, undefined, "npm_config_prefix must be removed");
  assert.equal(cleaned.npm_lifecycle_event, undefined, "npm_lifecycle_event must be removed");
  assert.equal(cleaned.npm_package_name, undefined, "npm_package_name must be removed");
  assert.equal(cleaned.NPM_CONFIG_GLOBAL, undefined, "NPM_CONFIG_GLOBAL must be removed");
  console.log("  ✓ Environment sanitization strips all npm_* variables (NVM compatible)");

  // Test 2: Connection cleanup on pane close
  console.log("2. Verifying ConnectionManager.closeConnectionsForPane...");
  const disk = new DiskStore(tempDir);
  const connStore = new ConnectionStore(disk);
  const connManager = new ConnectionManager(connStore);

  connManager.connectPanes("maestro-1", "agent-builder", "m1");
  connManager.connectPanes("maestro-1", "agent-scout", "m1");
  connManager.connectPanes("agent-builder", "agent-scout", "m1");

  assert.equal(connManager.listConnections("m1").filter((c) => c.status === "active").length, 3);

  // Close agent-builder
  const closed = connManager.closeConnectionsForPane("agent-builder");
  assert.equal(closed.length, 2, "Must close 2 connections involving agent-builder");

  const remainingActive = connManager.listConnections("m1").filter((c) => c.status === "active");
  assert.equal(remainingActive.length, 1, "Only maestro-1 <-> agent-scout should remain active");
  assert.equal(remainingActive[0].sourcePaneId, "maestro-1");
  assert.equal(remainingActive[0].targetPaneId, "agent-scout");
  console.log("  ✓ Dead pane connections closed; surviving connections untouched");

  // Test 3: Task unassign and state transition on pane close
  console.log("3. Verifying TaskManager.handlePaneExit...");
  const ownership = new FileOwnershipManager();
  const taskStore = new TaskStore(disk);
  const taskManager = new TaskManager(ownership, taskStore);

  const t1 = taskManager.createTask("m1", {
    título: "Build feature",
    descrição: "Implement CRM",
    status: "in-progress",
    pane: "agent-builder",
  });
  const t2 = taskManager.createTask("m1", {
    título: "Review code",
    descrição: "Review CRM",
    status: "in-review",
    pane: "agent-builder",
  });
  const t3 = taskManager.createTask("m1", {
    título: "Scout dependencies",
    descrição: "Research npm libs",
    status: "in-progress",
    pane: "agent-scout",
  });

  const modified = taskManager.handlePaneExit("agent-builder");
  assert.equal(modified.length, 2, "Must modify 2 tasks assigned to agent-builder");

  const ut1 = taskManager.getTask(t1.id);
  assert.equal(ut1?.pane, null, "t1 pane must be unassigned");
  assert.equal(ut1?.status, "blocked", "t1 status must transition to blocked");

  const ut2 = taskManager.getTask(t2.id);
  assert.equal(ut2?.pane, null, "t2 pane must be unassigned");
  assert.equal(ut2?.status, "blocked", "t2 status must transition to blocked");

  const ut3 = taskManager.getTask(t3.id);
  assert.equal(ut3?.pane, "agent-scout", "t3 pane must remain untouched");
  assert.equal(ut3?.status, "in-progress", "t3 status must remain in-progress");
  console.log("  ✓ Orphaned in-progress tasks transitioned to blocked and unassigned");

  // Test 4: File lock release on pane close
  console.log("4. Verifying FileOwnershipManager.releaseLocksByPane...");
  ownership.acquireLock({
    missionId: "m1",
    taskId: t1.id,
    paneId: "agent-builder",
    files: ["src/index.ts", "src/crm.ts"],
    mode: "isolated",
  });
  ownership.acquireLock({
    missionId: "m1",
    taskId: t3.id,
    paneId: "agent-scout",
    files: ["package.json"],
    mode: "isolated",
  });

  const released = ownership.releaseLocksByPane("agent-builder");
  assert.equal(released.released.length, 2, "Must release 2 file locks");

  const check1 = ownership.checkAccess("m1", "src/index.ts", { paneId: "other" });
  assert.equal(check1.allowed, true, "src/index.ts must now be unlocked");

  const check3 = ownership.checkAccess("m1", "package.json", { paneId: "other" });
  assert.equal(check3.allowed, false, "package.json must still be locked by agent-scout");
  console.log("  ✓ Locks held by killed pane released; other locks intact");

  console.log("\nPASS: check-pane-kill-cleanup.ts — all pane exit cleanup and sanitization checks passed successfully!");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
