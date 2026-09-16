import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskStore } from "../servidor/persistence/disk-store.ts";
import { TaskStore } from "../servidor/persistence/task-store.ts";
import { FileOwnershipManager } from "../servidor/tasks/file-ownership.ts";
import { TaskManager } from "../servidor/tasks/task-manager.ts";
import { MailboxStore } from "../servidor/connections/mailbox-store.ts";
import { MailboxManager } from "../servidor/connections/mailbox-manager.ts";
import { PaneDispatcher, type PaneDispatcherState } from "../servidor/orchestration/pane-dispatcher.ts";

console.log("Starting check-pane-dispatch.ts verification...");

const tempDir = mkdtempSync(join(tmpdir(), "check-dispatch-"));

try {
  const disk = new DiskStore(tempDir);
  const taskStore = new TaskStore(disk);
  const ownership = new FileOwnershipManager();
  const taskManager = new TaskManager(ownership, taskStore);
  const mailboxStore = new MailboxStore(disk);
  const mailboxManager = new MailboxManager(mailboxStore);

  // Simulated PTY spawn counter: MUST REMAIN 0!
  let ptySpawnCount = 0;
  const mockSpawnPane = () => {
    ptySpawnCount++;
  };

  const panes: Map<string, PaneDispatcherState> = new Map([
    [
      "pane-idle",
      {
        paneId: "pane-idle",
        label: "Builder",
        role: "builder",
        runner: "claude",
        status: "waiting-user",
        activeTaskId: null,
        missionId: "m1",
      },
    ],
    [
      "pane-busy",
      {
        paneId: "pane-busy",
        label: "Reviewer",
        role: "reviewer",
        runner: "codex",
        status: "working",
        activeTaskId: "task-existing",
        missionId: "m1",
      },
    ],
    [
      "pane-dead",
      {
        paneId: "pane-dead",
        label: "Scout",
        role: "scout",
        runner: "agy",
        status: "dead",
        activeTaskId: null,
        missionId: "m1",
      },
    ],
  ]);

  const writtenInputs: { id: string; data: string }[] = [];
  const paneProvider = {
    getPane: (id: string) => panes.get(id),
    listPanes: () => Array.from(panes.values()),
    updatePane: (id: string, upd: Partial<PaneDispatcherState>) => {
      const p = panes.get(id);
      if (p) Object.assign(p, upd);
    },
    writePane: (id: string, data: string) => {
      writtenInputs.push({ id, data });
    },
  };

  const dispatcher = new PaneDispatcher(taskManager, mailboxManager, paneProvider);

  // -------------------------------------------------------------
  // Test 1: Query Panes (listAvailablePanes)
  // -------------------------------------------------------------
  console.log("Test 1: Query Panes...");
  const available = dispatcher.listAvailablePanes("m1");
  assert.equal(available.length, 3);

  const idle = available.find((p) => p.paneId === "pane-idle")!;
  assert(idle);
  assert.equal(idle.canAcceptTask, true);
  assert.equal(idle.isBusy, false);

  const busy = available.find((p) => p.paneId === "pane-busy")!;
  assert(busy);
  assert.equal(busy.canAcceptTask, false);
  assert.equal(busy.isBusy, true);

  const dead = available.find((p) => p.paneId === "pane-dead")!;
  assert(dead);
  assert.equal(dead.canAcceptTask, false);
  assert.equal(dead.isBusy, false);

  assert.equal(dispatcher.findAvailablePane("m1", "construtor")?.paneId, "pane-idle");
  assert.equal(dispatcher.findAvailablePane("m1", "explorador")?.paneId, undefined);

  // -------------------------------------------------------------
  // Test 2: Dispatch to Existing Idle Pane (0 new PTY processes!)
  // -------------------------------------------------------------
  console.log("Test 2: Dispatch to existing idle pane (0 new PTYs)...");
  const task1 = taskManager.createTask("m1", {
    título: "Implement auth module",
    descrição: "Write authentication JWT service",
    status: "todo",
  });

  const initialSpawnCount = ptySpawnCount;

  const result = dispatcher.dispatchToExistingPane("m1", task1.id, "pane-idle");
  assert.equal(result.ok, true);
  assert.equal(result.taskId, task1.id);
  assert.equal(result.paneId, "pane-idle");
  assert.equal(result.status, "in-progress");

  // VERIFY: 0 new PTY processes spawned!
  assert.equal(
    ptySpawnCount,
    initialSpawnCount,
    "dispatchToExistingPane must NEVER spawn a new PTY process!",
  );

  // Verify task state
  const updatedTask1 = taskManager.getTask(task1.id)!;
  assert.equal(updatedTask1.pane, "pane-idle");
  assert.equal(updatedTask1.status, "in-progress");

  // Verify pane state
  const updatedPane = panes.get("pane-idle")!;
  assert.equal(updatedPane.activeTaskId, task1.id);
  assert.equal(updatedPane.status, "working");

  // Verify task prompt enqueued into pane mailbox
  const inbox = mailboxManager.getInbox("pane-idle", "m1");
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].taskId, task1.id);
  assert.match(inbox[0].task!, /Implement auth module/);

  // Verify writePane was called with bracketed paste ending in \r (Enter)
  assert.equal(writtenInputs.length, 1);
  assert.equal(writtenInputs[0].id, "pane-idle");
  assert.match(writtenInputs[0].data, /^\x1b\[200~.*Implement auth module.*\x1b\[201~\r$/s);

  // -------------------------------------------------------------
  // Test 3: Dispatch to Busy Pane (Conflict / Error)
  // -------------------------------------------------------------
  console.log("Test 3: Dispatch to busy pane...");
  const task2 = taskManager.createTask("m1", {
    título: "Task for busy pane",
    status: "todo",
  });

  // pane-busy is already "working"
  assert.throws(
    () => dispatcher.dispatchToExistingPane("m1", task2.id, "pane-busy"),
    /busy/,
    "Dispatch to busy pane must be rejected",
  );

  // pane-idle is now also "working"
  assert.throws(
    () => dispatcher.dispatchToExistingPane("m1", task2.id, "pane-idle"),
    /busy/,
    "Dispatch to now-working pane-idle must be rejected",
  );

  // Task2 status must remain todo
  assert.equal(taskManager.getTask(task2.id)!.status, "todo");

  // -------------------------------------------------------------
  // Test 4: Dispatch to Dead Pane (Rejection)
  // -------------------------------------------------------------
  console.log("Test 4: Dispatch to dead pane...");
  const task3 = taskManager.createTask("m1", {
    título: "Task for dead pane",
    status: "todo",
  });

  assert.throws(
    () => dispatcher.dispatchToExistingPane("m1", task3.id, "pane-dead"),
    /dead or failed/,
    "Dispatch to dead pane must be rejected",
  );

  // Task3 status must remain untouched in todo
  assert.equal(taskManager.getTask(task3.id)!.status, "todo");

  // -------------------------------------------------------------
  // Test 5: Invalid Task or Pane ID (Not Found)
  // -------------------------------------------------------------
  console.log("Test 5: Invalid Task or Pane ID...");
  assert.throws(
    () => dispatcher.dispatchToExistingPane("m1", "non-existent-task", "pane-idle"),
    /Task not found/,
  );

  // -------------------------------------------------------------
  // Test 6: Dispatch to Pure Shell (Zero Stdin Writes)
  // -------------------------------------------------------------
  console.log("Test 6: Dispatch to pure shell pane (zero stdin writes)...");
  panes.set("pane-shell", {
    paneId: "pane-shell",
    label: "Shell",
    role: "shell",
    runner: "bash",
    cli: "bash",
    status: "waiting-user",
    activeTaskId: null,
    missionId: "m1",
  });
  assert.equal(dispatcher.findAvailablePane("m1", "shell"), undefined, "Shell puro não é destino autônomo");
  const task4 = taskManager.createTask("m1", {
    título: "Task for pure shell",
    descrição: "Do not write to stdin",
    status: "todo",
  });
  const writesBeforePureShell = writtenInputs.length;
  dispatcher.dispatchToExistingPane("m1", task4.id, "pane-shell");
  assert.equal(writtenInputs.length, writesBeforePureShell, "Zero stdin writes to pure shell guaranteed");

  // -------------------------------------------------------------
  // Test 7: Dispatch to Shell Designated as Specialist (Prompt is written)
  // -------------------------------------------------------------
  console.log("Test 7: Dispatch to shell designated as specialist...");
  panes.set("pane-specialist-shell", {
    paneId: "pane-specialist-shell",
    label: "builder",
    role: "shell",
    runner: "bash",
    cli: "bash",
    status: "waiting-user",
    activeTaskId: null,
    missionId: "m1",
  });
  assert.equal(dispatcher.findAvailablePane("m1", "builder")?.paneId, "pane-specialist-shell");
  const task5 = taskManager.createTask("m1", {
    título: "Build UI component",
    descrição: "Implement reactive cards",
    status: "todo",
  });
  dispatcher.dispatchToExistingPane("m1", task5.id, "pane-specialist-shell");
  assert.equal(writtenInputs.length, writesBeforePureShell + 1, "Specialist shell receives task prompt");
  assert.equal(writtenInputs[writtenInputs.length - 1].id, "pane-specialist-shell");
  assert.match(writtenInputs[writtenInputs.length - 1].data, /^\x1b\[200~.*Implement reactive cards.*\x1b\[201~\r$/s);

  // -------------------------------------------------------------
  // Test 8: Reclassified shell without an attached CLI remains sovereign
  // -------------------------------------------------------------
  console.log("Test 8: Reclassified shell without attached CLI...");
  panes.set("pane-reclassified-shell", {
    paneId: "pane-reclassified-shell",
    label: "Shell - 2",
    role: "builder",
    runner: "bash",
    cli: "bash",
    status: "waiting-user",
    activeTaskId: null,
    missionId: "m1",
  });
  const task6 = taskManager.createTask("m1", {
    título: "Task for unattached shell",
    descrição: "Keep shell stdin untouched",
    status: "todo",
  });
  const writesBeforeUnattachedShell = writtenInputs.length;
  assert.equal(dispatcher.findAvailablePane("m1", "builder"), undefined, "Shell reclassificado sem CLI não é destino");
  dispatcher.dispatchToExistingPane("m1", task6.id, "pane-reclassified-shell");
  assert.equal(writtenInputs.length, writesBeforeUnattachedShell, "Reclassified shell without CLI must not receive stdin bytes");

  // -------------------------------------------------------------
  // Test 9: Portuguese alias dispatches to a shell with a manually attached CLI
  // -------------------------------------------------------------
  console.log("Test 9: Portuguese alias dispatches to attached CLI...");
  panes.set("pane-attached-shell", {
    paneId: "pane-attached-shell",
    label: "Shell - 3",
    role: "explorador",
    runner: "bash",
    cli: "bash",
    attachedRunner: "codex",
    connected: true,
    status: "waiting-user",
    activeTaskId: null,
    missionId: "m1",
  });
  const task7 = taskManager.createTask("m1", {
    título: "Task for attached Codex",
    descrição: "Send only to the attached CLI",
    status: "todo",
  });
  const attached = dispatcher.findAvailablePane("m1", "explorer");
  assert.equal(attached?.paneId, "pane-attached-shell");
  dispatcher.dispatchToExistingPane("m1", task7.id, "pane-attached-shell");
  assert.equal(writtenInputs.length, writesBeforeUnattachedShell + 1, "Attached CLI receives delegated task");

  panes.set("pane-disconnected", {
    paneId: "pane-disconnected",
    label: "Construtor",
    role: "builder",
    runner: "claude",
    connected: false,
    status: "waiting-user",
    activeTaskId: null,
    missionId: "m1",
  });
  assert.equal(dispatcher.findAvailablePane("m1", "builder"), undefined);

  console.log("PASS: check-pane-dispatch.ts — pane querying, dispatching without spawning, busy conflicts, dead rejections, and shell specialist dispatch verified!");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
