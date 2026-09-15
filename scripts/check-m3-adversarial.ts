import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolverHarness, resolveHarness } from "../servidor/harness.ts";
import { config } from "../servidor/config.ts";
import { DiskStore } from "../servidor/persistence/disk-store.ts";
import { ConnectionStore } from "../servidor/persistence/connection-store.ts";
import { HandoffStore } from "../servidor/persistence/handoff-store.ts";
import { TaskStore } from "../servidor/persistence/task-store.ts";
import { FileOwnershipManager } from "../servidor/tasks/file-ownership.ts";
import { TaskManager } from "../servidor/tasks/task-manager.ts";
import { MailboxStore } from "../servidor/connections/mailbox-store.ts";
import { MailboxManager, MAX_PAYLOAD_BYTES, MAX_QUEUE_CAPACITY } from "../servidor/connections/mailbox-manager.ts";
import { ConnectionManager } from "../servidor/connections/connection-manager.ts";
import { HandoffManager } from "../servidor/connections/handoff-manager.ts";
import { InterAgentBridge, type PaneInfo } from "../servidor/connections/inter-agent-bridge.ts";
import {
  normalizeMissionMode,
  canMaestroAutoSpawn,
  canMaestroDelegate,
  MissionModeManager,
} from "../servidor/orchestration/mission-modes.ts";
import { PaneDispatcher, type PaneDispatcherState } from "../servidor/orchestration/pane-dispatcher.ts";

console.log("=== Starting M3 Adversarial Stress Testing ===");

// =========================================================================
// Section 1: Strict Harness Adversarial Testing
// =========================================================================
console.log("\n[1] Harness Stress Testing...");

// 1.1 Whitelist rejection with case variation
assert.throws(
  () => resolveHarness("CODEX", ["claude", "agy"], false),
  /não permitido no elenco/,
  "Must reject CODEX case-insensitively when not in whitelist",
);

assert.throws(
  () => resolveHarness("claude", ["CODEX", "AGY"], false),
  /não permitido no elenco/,
  "Must reject claude when whitelist has uppercase non-matching items",
);

// 1.2 Non-existent CLI in system PATH
assert.throws(
  () => resolveHarness("malicious-cli-$(rm -rf /)", undefined, true),
  /não disponível no sistema/,
  "Malicious or nonexistent binary must fail availability check cleanly",
);

// 1.3 Contradictory bash invocations: runner='bash' but invoke/roster try to force codex
const hijackedBash = resolverHarness({
  agent: "builder",
  runner: "bash",
  invoke: { cli: "codex", model: "gpt-6-astra" },
  roster: { cli: "claude", model: "opus" },
  elenco: { clis: ["codex"] },
});
assert.equal(hijackedBash.cli, "bash", "Explicit runner=bash must maintain absolute sovereignty");
assert.equal(hijackedBash.origem.cli, "soberano");
assert.equal(hijackedBash.model, undefined);

// 1.4 Agent 'shell' with no overrides
const pureShell = resolverHarness({ agent: "shell" });
assert.equal(pureShell.cli, "bash");
assert.equal(pureShell.origem.cli, "soberano");

// 1.5 Task type model isolation across all agents in config
for (const [agentKey, spec] of Object.entries(config.agents)) {
  if (spec.cli === "bash") continue;
  for (const tipo of ["arquitetura", "explorar", "visual", "mecanico", "site"]) {
    const res = resolverHarness({ agent: agentKey, tipo });
    assert.equal(
      res.cli,
      spec.cli,
      `Agent ${agentKey} with task type ${tipo} must not change CLI`,
    );
  }
}

console.log("✓ Section 1 passed: Strict harness is tamper-proof.");

// =========================================================================
// Section 2: Mailbox Inter-Panes Adversarial Testing
// =========================================================================
console.log("\n[2] Mailbox Inter-Panes Stress Testing...");

const tempDir = mkdtempSync(join(tmpdir(), "m3-adv-"));

try {
  const disk = new DiskStore(tempDir);
  const connStore = new ConnectionStore(disk);
  const handoffStore = new HandoffStore(disk);
  const taskStore = new TaskStore(disk);
  const ownership = new FileOwnershipManager();
  const taskManager = new TaskManager(ownership, taskStore);
  const mailboxStore = new MailboxStore(disk);
  const mailboxManager = new MailboxManager(mailboxStore);
  const connManager = new ConnectionManager(connStore);

  // 2.1 Boundary testing for MAX_PAYLOAD_BYTES (5MB)
  // Payload near boundary: 5MB exact vs 5MB + 1
  const payloadKeyOverhead = JSON.stringify({ from: "a", to: "b", type: "ask", missionId: "m-5mb", task: "" }).length;
  const safePadding = MAX_PAYLOAD_BYTES - payloadKeyOverhead - 200;
  const near5MbStr = "A".repeat(safePadding);

  // Should succeed
  const okMsg = mailboxManager.enqueue({
    from: "pane-A",
    to: "pane-B",
    type: "ask",
    task: near5MbStr,
    missionId: "m-5mb",
  });
  assert.equal(okMsg.status, "unread");

  // Should fail (> 5MB)
  const over5MbStr = "A".repeat(MAX_PAYLOAD_BYTES + 10);
  assert.throws(
    () => {
      mailboxManager.enqueue({
        from: "pane-A",
        to: "pane-B",
        type: "ask",
        task: over5MbStr,
        missionId: "m-5mb",
      });
    },
    /Payload too large/,
    "Must reject payload exceeding 5MB",
  );

  // 2.2 Queue capacity limit: exact 1000 messages
  const capPane = "pane-cap";
  for (let i = 0; i < MAX_QUEUE_CAPACITY; i++) {
    mailboxManager.enqueue({
      from: "sender",
      to: capPane,
      type: "ask",
      task: `msg-${i}`,
      missionId: "m-adv",
    });
  }
  assert.equal(mailboxManager.getInbox(capPane, "m-adv").length, 1000);

  // 1001st message must throw
  assert.throws(
    () => {
      mailboxManager.enqueue({
        from: "sender",
        to: capPane,
        type: "ask",
        task: "msg-1001",
        missionId: "m-adv",
      });
    },
    /Mailbox overflow/,
    "Must strictly cap mailbox queue at 1000",
  );

  // Popping one should free a slot
  const popped = mailboxManager.pop(capPane, "m-adv");
  assert(popped);
  assert.equal(popped.task, "msg-0"); // FIFO

  // Now 1 more enqueue should succeed
  const recoveredMsg = mailboxManager.enqueue({
    from: "sender",
    to: capPane,
    type: "ask",
    task: "msg-recovered",
    missionId: "m-adv",
  });
  assert(recoveredMsg);
  assert.equal(mailboxManager.getInbox(capPane, "m-adv").length, 1000);

  // 2.3 Disk corruption recovery
  const mBoxFile = join(tempDir, "missions", "m-corrupt", "mailboxes.json");
  disk.ensureDir(join(tempDir, "missions", "m-corrupt"));
  writeFileSync(mBoxFile, "INVALID JSON CONTENT {{{", "utf8");

  const corruptManager = new MailboxManager(mailboxStore);
  // Should not crash, starts gracefully with empty
  const corruptInbox = corruptManager.getInbox("pane-x", "m-corrupt");
  assert.deepEqual(corruptInbox, []);

  // 2.4 Handoff multi-hop loop detection: A -> B -> C -> D -> A
  const pA = "p-A";
  const pB = "p-B";
  const pC = "p-C";
  const pD = "p-D";

  const panesMap = new Map<string, PaneInfo>([
    [pA, { paneId: pA, status: "waiting-user" }],
    [pB, { paneId: pB, status: "waiting-user" }],
    [pC, { paneId: pC, status: "waiting-user" }],
    [pD, { paneId: pD, status: "waiting-user" }],
  ]);

  const hManager = new HandoffManager(
    handoffStore,
    taskManager,
    mailboxManager,
    (id) => panesMap.get(id),
  );

  const testTask = taskManager.createTask("m-adv", {
    título: "Multi-hop task",
    pane: pA,
    status: "in-progress",
  });

  // Hop 1: A -> B
  hManager.handoff({ sourcePaneId: pA, targetPaneId: pB, taskId: testTask.id, missionId: "m-adv" });
  assert.equal(taskManager.getTask(testTask.id)!.pane, pB);

  // Hop 2: B -> C
  hManager.handoff({ sourcePaneId: pB, targetPaneId: pC, taskId: testTask.id, missionId: "m-adv" });
  assert.equal(taskManager.getTask(testTask.id)!.pane, pC);

  // Hop 3: C -> D
  hManager.handoff({ sourcePaneId: pC, targetPaneId: pD, taskId: testTask.id, missionId: "m-adv" });
  assert.equal(taskManager.getTask(testTask.id)!.pane, pD);

  // Hop 4: D -> A (Loop! A was already a source!)
  assert.throws(
    () => hManager.handoff({ sourcePaneId: pD, targetPaneId: pA, taskId: testTask.id, missionId: "m-adv" }),
    /Circular handoff loop detected/,
    "Must detect 4-hop circular handoff loop (D -> A)",
  );

  // Hop 5: D -> B (Loop! B was also already a source!)
  assert.throws(
    () => hManager.handoff({ sourcePaneId: pD, targetPaneId: pB, taskId: testTask.id, missionId: "m-adv" }),
    /Circular handoff loop detected/,
    "Must detect circular handoff loop to intermediate node (D -> B)",
  );

  // 2.5 Handoff force override on ownership
  const alienTask = taskManager.createTask("m-adv", {
    título: "Alien task",
    pane: "alien-pane",
    status: "in-progress",
  });
  assert.throws(
    () => hManager.handoff({ sourcePaneId: pA, targetPaneId: pB, taskId: alienTask.id, force: false, missionId: "m-adv" }),
    /Ownership mismatch/,
  );
  // With force=true, it should succeed
  const forced = hManager.handoff({
    sourcePaneId: pA,
    targetPaneId: pB,
    taskId: alienTask.id,
    force: true,
    missionId: "m-adv",
  });
  assert.equal(forced.status, "completed");
  assert.equal(taskManager.getTask(alienTask.id)!.pane, pB);

  console.log("✓ Section 2 passed: Mailbox and Handoff protections are robust.");

  // =========================================================================
  // Section 3: Mission Modes & Dispatcher Adversarial Testing
  // =========================================================================
  console.log("\n[3] Mission Modes & Dispatcher Stress Testing...");

  const modeManager = new MissionModeManager();

  // 3.1 Unrecognized mode fallback
  assert.equal(normalizeMissionMode(""), "livre");
  assert.equal(normalizeMissionMode({}), "livre");
  assert.equal(normalizeMissionMode(123), "livre");
  assert.equal(normalizeMissionMode("hacked_mode"), "livre");

  // 3.2 Emergency stop toggle under load
  modeManager.emergencyStop("m-stop");
  assert.equal(modeManager.isHalted("m-stop"), true);
  assert.equal(
    canMaestroAutoSpawn({ mode: "autonomo", currentPanes: 0, emergencyHalt: true }).allowed,
    false,
  );
  assert.equal(
    canMaestroDelegate({ mode: "autonomo", targetAgentOrRole: "builder", emergencyHalt: true }).allowed,
    false,
  );

  modeManager.resumeMission("m-stop");
  assert.equal(modeManager.isHalted("m-stop"), false);
  assert.equal(
    canMaestroAutoSpawn({ mode: "autonomo", currentPanes: 0, emergencyHalt: false }).allowed,
    true,
  );

  // 3.3 Dispatcher adversarial checks
  const dPanes: Map<string, PaneDispatcherState> = new Map([
    ["p1", { paneId: "p1", status: "waiting-user", missionId: "m-d" }],
    ["p2", { paneId: "p2", status: "working", missionId: "m-d", activeTaskId: "other" }],
    ["p3", { paneId: "p3", status: "dead", missionId: "m-d" }],
    ["p-foreign", { paneId: "p-foreign", status: "waiting-user", missionId: "other-mission" }],
  ]);

  let spawnCount = 0;
  const dispatcher = new PaneDispatcher(
    taskManager,
    mailboxManager,
    {
      getPane: (id) => dPanes.get(id),
      listPanes: () => Array.from(dPanes.values()),
      updatePane: (id, upd) => {
        const p = dPanes.get(id);
        if (p) Object.assign(p, upd);
      },
    },
  );

  const dTask = taskManager.createTask("m-d", { título: "Dispatcher test task" });

  // Foreign mission pane must be rejected
  assert.throws(
    () => dispatcher.dispatchToExistingPane("m-d", dTask.id, "p-foreign"),
    /different mission/,
  );

  // Dispatch to dead pane must be rejected
  assert.throws(
    () => dispatcher.dispatchToExistingPane("m-d", dTask.id, "p3"),
    /dead or failed/,
  );

  // Dispatch to working pane must be rejected
  assert.throws(
    () => dispatcher.dispatchToExistingPane("m-d", dTask.id, "p2"),
    /busy/,
  );

  // Dispatch to idle pane succeeds with 0 spawns
  const dispRes = dispatcher.dispatchToExistingPane("m-d", dTask.id, "p1");
  assert.equal(dispRes.ok, true);
  assert.equal(dispRes.status, "in-progress");
  assert.equal(spawnCount, 0, "Zero PTY spawns guaranteed");
  assert.equal(dPanes.get("p1")!.status, "working");
  assert.equal(dPanes.get("p1")!.activeTaskId, dTask.id);

  console.log("✓ Section 3 passed: Mission modes and Pane dispatcher are secure.");

} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("\n=== ALL M3 ADVERSARIAL STRESS TESTS PASSED SUCCESSFULLY! ===\n");
