import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

console.log("Starting check-connections.ts verification...");

const tempDir = mkdtempSync(join(tmpdir(), "check-connections-"));

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

  // Mock pane provider
  const panes: Map<string, PaneInfo> = new Map([
    [
      "pane-1",
      {
        paneId: "pane-1",
        label: "Builder",
        role: "builder",
        runner: "claude",
        cli: "claude",
        model: "opus",
        status: "waiting-user",
        missionId: "m1",
        cwd: "/tmp/project",
      },
    ],
    [
      "pane-2",
      {
        paneId: "pane-2",
        label: "Reviewer",
        role: "reviewer",
        runner: "codex",
        cli: "codex",
        model: "gpt-6-astra",
        status: "working",
        missionId: "m1",
        cwd: "/tmp/project",
      },
    ],
    [
      "pane-bash",
      {
        paneId: "pane-bash",
        label: "Shell",
        role: "shell",
        runner: "bash",
        cli: "bash",
        model: null,
        status: "waiting-user",
        missionId: "m1",
        cwd: "/tmp/project",
      },
    ],
    [
      "pane-dead",
      {
        paneId: "pane-dead",
        label: "Dead Agent",
        role: "scout",
        runner: "agy",
        cli: "agy",
        model: "gemini-pro",
        status: "dead",
        missionId: "m1",
        cwd: "/tmp/project",
      },
    ],
  ]);

  const writtenInputs: { id: string; data: string }[] = [];
  const paneProvider = {
    getPane: (id: string) => panes.get(id),
    listPanes: () => Array.from(panes.values()),
    writePane: (id: string, data: string) => {
      writtenInputs.push({ id, data });
    },
  };

  const handoffManager = new HandoffManager(
    handoffStore,
    taskManager,
    mailboxManager,
    (id) => panes.get(id),
  );

  const bridge = new InterAgentBridge(
    mailboxManager,
    connManager,
    handoffManager,
    paneProvider,
    taskManager,
  );

  // -------------------------------------------------------------
  // Test 1: cockpit list
  // -------------------------------------------------------------
  console.log("Test 1: cockpit list...");
  const listResult = bridge.list("m1");
  assert.equal(listResult.total, 4);
  assert.equal(listResult.panes.length, 4);
  const p1 = listResult.panes.find((p) => p.id === "pane-1");
  assert(p1);
  assert.equal(p1.role, "builder");
  assert.equal(p1.runner, "claude");
  assert.equal(p1.status, "waiting-user");

  // Filtering non-existent mission returns empty list
  const emptyList = bridge.list("non-existent-mission");
  assert.equal(emptyList.total, 0);
  assert.equal(emptyList.panes.length, 0);

  // -------------------------------------------------------------
  // Test 2: cockpit connect (with Idempotency)
  // -------------------------------------------------------------
  console.log("Test 2: cockpit connect...");
  const conn1 = bridge.connect("pane-1", "pane-2", "m1");
  assert.equal(conn1.sourcePaneId, "pane-1");
  assert.equal(conn1.targetPaneId, "pane-2");
  assert.equal(conn1.status, "active");

  // Re-connecting should be idempotent (return same connection object)
  const conn2 = bridge.connect("pane-1", "pane-2", "m1");
  assert.equal(conn2.id, conn1.id);

  // Bidirectional lookup: connect("pane-2", "pane-1") should also return existing connection
  const conn3 = bridge.connect("pane-2", "pane-1", "m1");
  assert.equal(conn3.id, conn1.id);

  // Connecting non-existent panes must fail
  assert.throws(() => bridge.connect("pane-1", "pane-unknown", "m1"), /Pane does not exist/);

  // -------------------------------------------------------------
  // Test 3: cockpit ask & Zero Bash Stdin Invariant
  // -------------------------------------------------------------
  console.log("Test 3: cockpit ask & zero stdin...");
  let stdinBytesWritten = 0;
  // Simulated PTY stdin writer tracking
  const mockPtyWrite = (_paneId: string, data: string) => {
    stdinBytesWritten += Buffer.byteLength(data);
  };

  // Asking pane-bash
  const writesBeforeBash = writtenInputs.length;
  const askResult = bridge.ask("pane-1", "pane-bash", "echo hello world", undefined, "m1");
  assert("id" in askResult);
  assert.equal(askResult.type, "ask");
  assert.equal(askResult.task, "echo hello world");
  assert.equal(askResult.status, "unread");
  assert(askResult.correlationId);

  // VERIFY: ZERO stdin bytes written to bash PTY!
  assert.equal(stdinBytesWritten, 0, "cockpit ask must NEVER write to bash stdin!");
  assert.equal(writtenInputs.length, writesBeforeBash, "cockpit ask must NEVER write to bash stdin via writePane");

  const specialistAsk = bridge.ask("maestro", "builder", "Implement auth", undefined, "m1");
  assert("id" in specialistAsk);
  assert.equal(specialistAsk.to, "pane-1");
  assert.equal("deliveredToTerminal" in specialistAsk && specialistAsk.deliveredToTerminal, true);
  assert.equal(writtenInputs.at(-1)?.id, "pane-1");
  assert.match(writtenInputs.at(-1)?.data ?? "", /\x1b\[200~Implement auth/);
  const byLabel = bridge.inbox("Builder", "m1");
  assert.equal(byLabel.some((m) => m.task === "Implement auth"), true);

  assert.throws(() => bridge.ask("pane-1", "pane-1", "loop", undefined, "m1"), /próprio painel/);

  // Empty task text must be rejected
  assert.throws(() => bridge.ask("pane-1", "pane-2", "   ", undefined, "m1"), /empty or whitespace/);

  // Asking a dead pane should return PANE_DEAD warning without crashing
  const deadAsk = bridge.ask("pane-1", "pane-dead", "Run diagnostics", undefined, "m1");
  assert("warning" in deadAsk);
  assert.equal(deadAsk.warning, "PANE_DEAD");
  assert.equal(deadAsk.delivered, false);
  assert.equal(deadAsk.queued, true);

  // -------------------------------------------------------------
  // Test 4: Mailbox FIFO order, Persistence & Read status
  // -------------------------------------------------------------
  console.log("Test 4: Mailbox FIFO order and read status...");
  const msg1 = mailboxManager.enqueue({
    from: "pane-1",
    to: "pane-2",
    type: "ask",
    task: "first task",
    missionId: "m1",
  });
  const msg2 = mailboxManager.enqueue({
    from: "pane-1",
    to: "pane-2",
    type: "ask",
    task: "second task",
    missionId: "m1",
  });
  const msg3 = mailboxManager.enqueue({
    from: "pane-1",
    to: "pane-2",
    type: "ask",
    task: "third task",
    missionId: "m1",
  });

  // Verify FIFO retrieval
  const inboxP2 = mailboxManager.getInbox("pane-2", "m1");
  const p2Tasks = inboxP2.filter((m) => m.type === "ask").map((m) => m.task);
  assert.deepEqual(p2Tasks.slice(-3), ["first task", "second task", "third task"]);

  // Test pop (FIFO dequeue and auto markRead)
  const popped = mailboxManager.pop("pane-2", "m1");
  assert(popped);
  assert.equal(popped.status, "read");

  // Test manual markRead
  assert.equal(msg2.status, "unread");
  mailboxManager.markRead("pane-2", msg2.id, "m1");
  const reloaded = mailboxManager.findMessage("pane-2", msg2.id, "m1");
  assert.equal(reloaded?.status, "read");

  // Verify disk persistence
  const mailboxFile = join(tempDir, "missions", "m1", "mailboxes.json");
  assert(existsSync(mailboxFile), "mailboxes.json must be written to disk");
  const onDisk = JSON.parse(readFileSync(mailboxFile, "utf8"));
  assert(onDisk["pane-2"], "pane-2 must be persisted on disk");

  // -------------------------------------------------------------
  // Test 5: Payload limit (5MB) & Queue Overflow (1000 cap)
  // -------------------------------------------------------------
  console.log("Test 5: Payload limit & queue overflow...");
  // 5MB limit
  const hugeString = "x".repeat(MAX_PAYLOAD_BYTES + 100);
  assert.throws(
    () => {
      mailboxManager.enqueue({
        from: "pane-1",
        to: "pane-2",
        type: "ask",
        task: hugeString,
        missionId: "m1",
      });
    },
    /Payload too large/,
    "Payload exceeding 5MB must be rejected",
  );

  // Queue capacity limit (1000)
  const overflowPane = "pane-overflow-test";
  for (let i = 0; i < MAX_QUEUE_CAPACITY; i++) {
    mailboxManager.enqueue({
      from: "pane-1",
      to: overflowPane,
      type: "notification",
      task: `Item ${i}`,
      missionId: "m1",
    });
  }
  // 1001st message must throw overflow error
  assert.throws(
    () => {
      mailboxManager.enqueue({
        from: "pane-1",
        to: overflowPane,
        type: "notification",
        task: "Overflow item",
        missionId: "m1",
      });
    },
    /Mailbox overflow/,
    "1001st message must trigger Mailbox overflow error",
  );

  // -------------------------------------------------------------
  // Test 6: cockpit reply & Duplicate handling
  // -------------------------------------------------------------
  console.log("Test 6: cockpit reply & idempotency...");
  const askForReply = bridge.ask("pane-1", "pane-2", "Compute value", undefined, "m1");
  assert("correlationId" in askForReply);
  const corrId = askForReply.correlationId!;

  // First reply
  const reply1 = bridge.reply("pane-2", "pane-1", corrId, "Result: 42", undefined, "m1");
  assert("result" in reply1);
  assert.equal(reply1.result, "Result: 42");

  // Duplicate reply to same correlationId must be handled idempotently
  const reply2 = bridge.reply("pane-2", "pane-1", corrId, "Duplicate 42", undefined, "m1");
  assert.equal(reply2.status, "already_replied");

  // Unknown correlation ID warning
  const unknownReply = bridge.reply("pane-2", "pane-1", "non-existent-corr-id", "Some result", undefined, "m1");
  assert.equal(unknownReply.warning, "CORRELATION_UNKNOWN");

  // -------------------------------------------------------------
  // Test 7: cockpit handoff (Ownership check, Circular loop detection, Dead pane rejection)
  // -------------------------------------------------------------
  console.log("Test 7: cockpit handoff...");
  // Create task owned by pane-1
  const taskA = taskManager.createTask("m1", {
    título: "Task A",
    pane: "pane-1",
    status: "in-progress",
  });

  // Handoff to dead pane must fail
  assert.throws(
    () => bridge.handoff("pane-1", "pane-dead", taskA.id, "Context", false, "m1"),
    /Target pane is dead/,
    "Cannot handoff to dead pane",
  );

  // Ownership mismatch: pane-2 trying to handoff taskA (owned by pane-1) without force
  assert.throws(
    () => bridge.handoff("pane-2", "pane-bash", taskA.id, "Context", false, "m1"),
    /Ownership mismatch/,
    "Ownership mismatch must be rejected without --force",
  );

  // Successful handoff from pane-1 to pane-2
  const handoff1 = bridge.handoff("pane-1", "pane-2", taskA.id, "Context 1 to 2", false, "m1");
  assert.equal(handoff1.sourcePaneId, "pane-1");
  assert.equal(handoff1.targetPaneId, "pane-2");
  assert.equal(handoff1.status, "completed");

  // Verify task was reassigned to pane-2 and has handoff evidence
  const updatedTask = taskManager.getTask(taskA.id)!;
  assert.equal(updatedTask.pane, "pane-2");
  const handoffEvidence = updatedTask.evidências.find((e) => e.tipo === "handoff");
  assert(handoffEvidence);
  assert.match(handoffEvidence.descricao, /Handoff de pane-1 para pane-2/);

  // Handoff from pane-2 to pane-bash
  const handoff2 = bridge.handoff("pane-2", "pane-bash", taskA.id, "Context 2 to bash", false, "m1");
  assert.equal(handoff2.targetPaneId, "pane-bash");

  // Circular loop detection: handoff from pane-bash back to pane-1 (which already handed it off!)
  assert.throws(
    () => bridge.handoff("pane-bash", "pane-1", taskA.id, "Cycle back", false, "m1"),
    /Circular handoff loop detected/,
    "Circular loop must be detected and rejected",
  );

  console.log("PASS: check-connections.ts — all 5 verbs, persistent mailboxes, FIFO order, zero bash stdin, payload limits, and handoff protections verified!");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
