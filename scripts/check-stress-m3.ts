/**
 * Milestone M3 Adversarial & Stress Test Suite
 * Executed by m3_challenger_1 (Empirical Challenger)
 *
 * Scope of Adversarial Verification:
 * 1. Mailbox Stress & Adversarial Boundary Testing:
 *    - Massive concurrent message flooding (100 parallel async writes from 10 distinct senders)
 *    - Atomic disk persistence and zero JSON corruption under concurrency
 *    - Queue capacity limit (1000 message cap) exact boundary rejection and recovery on pop
 *    - Payload size boundary (5MB) exact byte boundary rejection (5,242,880 vs 5,242,881)
 *    - UTF-8 multibyte boundary rejection (emojis / 4-byte characters)
 *    - FIFO queue ordering, unread count tracking, and listener error resilience
 * 2. Clean Shell Stdin Safety (Strictly ZERO Bytes to Bash Stdin):
 *    - Live clean bash pane (/bin/bash -i -l) spawned via PtyHost/PtyManager
 *    - 50 `cockpit ask` operations targeting bash pane with injection attacks
 *    - 20 `cockpit handoff` operations targeting bash pane
 *    - Probe verification: bytesIn counter strictly 0, 0 bytes written to master stdin
 *    - Positive control: verify that real pty keystrokes increment bytesIn
 * 3. 5 CLI Verbs across Simulated Panes:
 *    - Express server on ephemeral port hosting live connection routes
 *    - `cockpit list`: table vs json, mission filtering
 *    - `cockpit connect`: link creation, idempotency, bidirectional resolution, missing pane errors
 *    - `cockpit ask`: task delivery, inbox queuing, correlation IDs, dead pane warnings, empty task rejection
 *    - `cockpit reply`: response delivery, correlation verification, idempotency on duplicates, unknown correlation warning
 *    - `cockpit handoff`: task reassignment, handoff evidence logging, ownership enforcement, --force override, circular loop detection, dead pane rejection, self-handoff rejection
 *    - `cockpit inbox`: retrieval, unread filter
 * 4. Adversarial Edge Cases:
 *    - Shell metacharacter safety ($(), pipes, semicolons, null bytes)
 *    - Multi-node circular handoff loop (A -> B -> C -> A)
 *    - Mission isolation across mailboxes
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

import { DiskStore } from "../servidor/persistence/disk-store.ts";
import { ConnectionStore } from "../servidor/persistence/connection-store.ts";
import { HandoffStore } from "../servidor/persistence/handoff-store.ts";
import { TaskStore } from "../servidor/persistence/task-store.ts";
import { FileOwnershipManager } from "../servidor/tasks/file-ownership.ts";
import { TaskManager } from "../servidor/tasks/task-manager.ts";
import { MailboxStore } from "../servidor/connections/mailbox-store.ts";
import {
  MailboxManager,
  MAX_PAYLOAD_BYTES,
  MAX_QUEUE_CAPACITY,
} from "../servidor/connections/mailbox-manager.ts";
import { ConnectionManager } from "../servidor/connections/connection-manager.ts";
import { HandoffManager } from "../servidor/connections/handoff-manager.ts";
import { InterAgentBridge, type PaneInfo } from "../servidor/connections/inter-agent-bridge.ts";
import { createConnectionRoutes } from "../servidor/connections/connection-routes.ts";
import { spawnPane, killPty, writePty, getPane } from "../servidor/pty.ts";
import type { MailboxMessage } from "../servidor/connections/connection-types.ts";

console.log("================================================================================");
console.log("Starting Milestone M3 Adversarial & Empirical Stress Suite (check-stress-m3.ts)");
console.log("================================================================================\n");

const tempDir = mkdtempSync(join(tmpdir(), "cockpit-m3-stress-"));
const CLI_PATH = join(process.cwd(), "bin", "cockpit.mjs");

async function main() {
  try {
    // =========================================================================
    // SECTION 1: MAILBOX STRESS & ADVERSARIAL BOUNDARIES
    // =========================================================================
    console.log("--------------------------------------------------------------------------------");
    console.log("SECTION 1: Mailbox Stress & Adversarial Boundaries");
    console.log("--------------------------------------------------------------------------------");

    const disk = new DiskStore(tempDir);
    const mailboxStore = new MailboxStore(disk);
    const mailboxManager = new MailboxManager(mailboxStore);

    // 1.1 Massive Concurrent Message Flooding
    console.log("  1.1 Testing massive concurrent writes (100 parallel async writes across panes)...");
    const numSenders = 10;
    const msgsPerSender = 10;
    const targetPanes = ["worker-alpha", "worker-beta", "worker-gamma"];

    const concurrentPromises: Promise<MailboxMessage>[] = [];

    for (let s = 0; s < numSenders; s++) {
      const senderId = `sender-${s}`;
      for (let m = 0; m < msgsPerSender; m++) {
        const target = targetPanes[(s + m) % targetPanes.length];
        concurrentPromises.push(
          new Promise<MailboxMessage>((resolve, reject) => {
            // Slight async stagger to simulate asynchronous network / event dispatch
            setImmediate(() => {
              try {
                const msg = mailboxManager.enqueue({
                  from: senderId,
                  to: target,
                  type: "ask",
                  task: `Concurrent task payload ${s}-${m}`,
                  missionId: "stress-m1",
                });
                resolve(msg);
              } catch (err) {
                reject(err);
              }
            });
          }),
        );
      }
    }

    const results = await Promise.all(concurrentPromises);
    assert.equal(results.length, 100, "All 100 concurrent messages must succeed");

    // Verify all 100 messages have distinct IDs
    const uniqueIds = new Set(results.map((r) => r.id));
    assert.equal(uniqueIds.size, 100, "All 100 messages must receive globally unique IDs");

    // Verify recipient distribution
    const alphaInbox = mailboxManager.getInbox("worker-alpha", "stress-m1");
    const betaInbox = mailboxManager.getInbox("worker-beta", "stress-m1");
    const gammaInbox = mailboxManager.getInbox("worker-gamma", "stress-m1");
    const totalDelivered = alphaInbox.length + betaInbox.length + gammaInbox.length;
    assert.equal(totalDelivered, 100, "Sum of messages across inboxes must match 100");

    // Verify disk persistence integrity under concurrency
    const persistedFile = join(tempDir, "missions", "stress-m1", "mailboxes.json");
    assert.ok(existsSync(persistedFile), "mailboxes.json must exist on disk");
    const fileContent = readFileSync(persistedFile, "utf8");
    const parsedData = JSON.parse(fileContent);
    assert.ok(parsedData["worker-alpha"], "worker-alpha must exist in persisted file");
    assert.equal(
      parsedData["worker-alpha"].inbox.length +
        parsedData["worker-beta"].inbox.length +
        parsedData["worker-gamma"].inbox.length,
      100,
      "Persisted message count must strictly match in-memory count (zero data loss)",
    );

    // Verify fresh MailboxManager reloads state from disk without corruption
    const freshMailboxStore = new MailboxStore(disk);
    const freshManager = new MailboxManager(freshMailboxStore);
    const reloadedAlpha = freshManager.getInbox("worker-alpha", "stress-m1");
    assert.equal(reloadedAlpha.length, alphaInbox.length, "Fresh manager must restore exact mailbox state");
    console.log("  ✓ Massive concurrent writes: 100/100 delivered, 0 lost, atomic persistence verified");

    // 1.2 Queue Capacity Limit (1000 message cap) Exact Boundary
    console.log("  1.2 Testing queue overflow at exact 1000 message cap boundary...");
    const capPane = "pane-cap-test";

    // Enqueue up to exactly MAX_QUEUE_CAPACITY (1000)
    for (let i = 0; i < MAX_QUEUE_CAPACITY; i++) {
      mailboxManager.enqueue({
        from: "system",
        to: capPane,
        type: "notification",
        task: `Message ${i}`,
        missionId: "cap-mission",
      });
    }

    const currentInbox = mailboxManager.getInbox(capPane, "cap-mission");
    assert.equal(currentInbox.length, 1000, "Inbox must contain exactly 1000 messages");

    // Message 1001 MUST be rejected with explicit error
    assert.throws(
      () => {
        mailboxManager.enqueue({
          from: "system",
          to: capPane,
          type: "notification",
          task: "Overflow message 1001",
          missionId: "cap-mission",
        });
      },
      /Mailbox overflow: inbox queue for pane pane-cap-test reached capacity of 1000 messages/,
      "Message 1001 must throw Mailbox overflow error",
    );

    // Verify capacity was NOT exceeded
    assert.equal(mailboxManager.getInbox(capPane, "cap-mission").length, 1000);

    // Pop 1 message: capacity drops to 999
    const poppedMsg = mailboxManager.pop(capPane, "cap-mission");
    assert.ok(poppedMsg);
    assert.equal(poppedMsg.task, "Message 0", "Popped message must be the first in FIFO order");
    assert.equal(mailboxManager.getInbox(capPane, "cap-mission").length, 999);

    // Enqueue 1 message: MUST now succeed
    const newMsg = mailboxManager.enqueue({
      from: "system",
      to: capPane,
      type: "notification",
      task: "Replacement message",
      missionId: "cap-mission",
    });
    assert.ok(newMsg.id);
    assert.equal(mailboxManager.getInbox(capPane, "cap-mission").length, 1000);

    // Next message MUST fail again
    assert.throws(
      () => {
        mailboxManager.enqueue({
          from: "system",
          to: capPane,
          type: "notification",
          task: "Second overflow message",
          missionId: "cap-mission",
        });
      },
      /Mailbox overflow/,
      "Must reject again once 1000 cap is re-reached",
    );
    console.log("  ✓ 1000-message cap: exact boundary enforced (1000 accepted, 1001 rejected, recovery verified)");

    // 1.3 Payload Size Boundary (5MB) Exact Boundary
    console.log("  1.3 Testing 5MB payload boundary rejection (exact byte counting & UTF-8 multibyte)...");

    // Construct base object structure
    const dummyEnvelope = {
      from: "p1",
      to: "p2",
      type: "ask" as const,
      task: "",
      missionId: "m1",
    };
    const emptyJsonBytes = Buffer.byteLength(JSON.stringify(dummyEnvelope), "utf8");

    // Calculate exact padding needed so that total JSON bytes === MAX_PAYLOAD_BYTES (5 * 1024 * 1024 = 5242880)
    const exactPaddingLength = MAX_PAYLOAD_BYTES - emptyJsonBytes;
    const exactTaskString = "a".repeat(exactPaddingLength);
    const exactPayload = { ...dummyEnvelope, task: exactTaskString };
    const exactBytes = Buffer.byteLength(JSON.stringify(exactPayload), "utf8");
    assert.equal(exactBytes, MAX_PAYLOAD_BYTES, `Exact payload must equal 5242880 bytes (got ${exactBytes})`);

    // Enqueue exact 5MB: MUST SUCCEED
    const exactResult = mailboxManager.enqueue(exactPayload);
    assert.ok(exactResult.id, "Exact 5MB payload must be accepted");

    // Enqueue 5MB + 1 byte: MUST FAIL
    const overflowTaskString = "a".repeat(exactPaddingLength + 1);
    const overflowPayload = { ...dummyEnvelope, task: overflowTaskString };
    const overflowBytes = Buffer.byteLength(JSON.stringify(overflowPayload), "utf8");
    assert.equal(overflowBytes, MAX_PAYLOAD_BYTES + 1, "Overflow payload must equal 5242881 bytes");

    assert.throws(
      () => {
        mailboxManager.enqueue(overflowPayload);
      },
      /Payload too large: 5242881 bytes exceeds 5MB limit/,
      "Payload exceeding 5MB by 1 byte must be rejected",
    );

    // Multibyte UTF-8 testing:
    // Emoji "🚀" is 4 bytes in UTF-8, but length 2 in JS string
    const numEmojis = 1_400_000; // 1.4 million emojis = 5.6 million UTF-8 bytes!
    const emojiString = "🚀".repeat(numEmojis);
    const emojiBytes = Buffer.byteLength(
      JSON.stringify({ ...dummyEnvelope, task: emojiString }),
      "utf8",
    );
    assert.ok(emojiBytes > MAX_PAYLOAD_BYTES, "Emoji byte length must exceed 5MB");
    assert.throws(
      () => {
        mailboxManager.enqueue({ ...dummyEnvelope, task: emojiString });
      },
      /Payload too large/,
      "Multibyte UTF-8 payload exceeding 5MB must be rejected by byte length, not string length",
    );

    // Extreme 10MB payload
    const extremeTaskString = "z".repeat(10 * 1024 * 1024);
    assert.throws(
      () => {
        mailboxManager.enqueue({ ...dummyEnvelope, task: extremeTaskString });
      },
      /Payload too large/,
      "10MB payload must be rejected",
    );
    console.log("  ✓ 5MB payload boundary: exact byte boundary (5,242,880 accepted, 5,242,881 rejected) & UTF-8 validated");

    // 1.4 FIFO Ordering, Unread Tracking & Pop Semantics
    console.log("  1.4 Testing FIFO queue ordering and unread status transitions...");
    const fifoPane = "pane-fifo-test";
    for (let i = 1; i <= 10; i++) {
      mailboxManager.enqueue({
        from: "sender",
        to: fifoPane,
        type: "ask",
        task: `Task #${i}`,
        missionId: "fifo-m",
      });
    }

    assert.equal(mailboxManager.getUnreadCount(fifoPane, "fifo-m"), 10);
    const peek1 = mailboxManager.peek(fifoPane, "fifo-m");
    assert.equal(peek1?.task, "Task #1", "Peek must view front of FIFO without removing");
    assert.equal(mailboxManager.getUnreadCount(fifoPane, "fifo-m"), 10, "Peek must not mark as read");

    // Pop first 3
    for (let i = 1; i <= 3; i++) {
      const popped = mailboxManager.pop(fifoPane, "fifo-m");
      assert.equal(popped?.task, `Task #${i}`, `Popped message ${i} must match FIFO sequence`);
      assert.equal(popped?.status, "read", "Popped message must automatically be marked as read");
    }
    assert.equal(mailboxManager.getUnreadCount(fifoPane, "fifo-m"), 7, "Unread count must reflect pops");

    // Mark remaining #4 read manually
    const inboxRemaining = mailboxManager.getInbox(fifoPane, "fifo-m");
    const msg4 = inboxRemaining.find((m) => m.task === "Task #4")!;
    mailboxManager.markRead(fifoPane, msg4.id, "fifo-m");
    assert.equal(mailboxManager.getUnreadCount(fifoPane, "fifo-m"), 6);

    const unreadOnly = mailboxManager.getInbox(fifoPane, "fifo-m", true);
    assert.equal(unreadOnly.length, 6);
    assert.ok(!unreadOnly.some((m) => m.task === "Task #4"));
    console.log("  ✓ FIFO ordering, unread tracking, and pop semantics verified");

    // 1.5 Listener Error Resilience
    console.log("  1.5 Testing listener exception handling and event isolation...");
    let eventReceived = 0;
    const cleanupBad = mailboxManager.addListener(() => {
      throw new Error("Adversarial listener crash simulation");
    });
    const cleanupGood = mailboxManager.addListener((event, payload) => {
      if (event === "inbox:message" && payload.targetPane === "listener-test") {
        eventReceived++;
      }
    });

    // Enqueuing must NOT throw despite bad listener
    const listenerMsg = mailboxManager.enqueue({
      from: "user",
      to: "listener-test",
      type: "ask",
      task: "Resilience check",
      missionId: "m1",
    });
    assert.ok(listenerMsg.id);
    assert.equal(eventReceived, 1, "Good listener must still receive event when bad listener fails");
    cleanupBad();
    cleanupGood();
    console.log("  ✓ Listener errors isolated cleanly without impacting mailbox operations");

    // =========================================================================
    // SECTION 2: CLEAN SHELL STDIN SAFETY (STRICTLY ZERO BYTES TO BASH STDIN)
    // =========================================================================
    console.log("\n--------------------------------------------------------------------------------");
    console.log("SECTION 2: Clean Shell Stdin Safety (Strictly ZERO Bytes to Bash Stdin)");
    console.log("--------------------------------------------------------------------------------");

    // Setup bridge and real components for stdin safety check
    const connStore = new ConnectionStore(disk);
    const handoffStore = new HandoffStore(disk);
    const taskStore = new TaskStore(disk);
    const fileOwnership = new FileOwnershipManager();
    const taskManager = new TaskManager(fileOwnership, taskStore);
    const connManager = new ConnectionManager(connStore);

    // Spawn a live clean bash pane via PtyManager
    console.log("  2.1 Spawning live clean shell (/bin/bash -i -l)...");
    const liveBashPane = spawnPane({
      agent: "shell",
      cwd: process.cwd(),
      porta: 3000,
      projectId: null,
      missionId: "m-stdin-test",
    });

    assert.ok(liveBashPane.paneId, "Live bash pane must have valid paneId");
    assert.equal(liveBashPane.cli, "bash");
    assert.equal(liveBashPane.runner, "bash");
    assert.equal(liveBashPane.bytesIn, 0, "Initial bytesIn on live bash pane must be strictly 0");

    // Build pane provider referencing the live bash pane
    const livePanesMap = new Map<string, PaneInfo>([
      [
        liveBashPane.paneId,
        {
          paneId: liveBashPane.paneId,
          label: "Shell",
          role: "shell",
          runner: "bash",
          cli: "bash",
          status: liveBashPane.status,
          missionId: "m-stdin-test",
          cwd: process.cwd(),
        },
      ],
      [
        "pane-sender",
        {
          paneId: "pane-sender",
          label: "Maestro",
          role: "maestro",
          runner: "codex",
          cli: "codex",
          status: "working",
          missionId: "m-stdin-test",
          cwd: process.cwd(),
        },
      ],
    ]);

    const livePaneProvider = {
      getPane: (id: string) => livePanesMap.get(id),
      listPanes: () => Array.from(livePanesMap.values()),
    };

    const handoffManager = new HandoffManager(
      handoffStore,
      taskManager,
      mailboxManager,
      (id) => livePanesMap.get(id),
    );

    const bridge = new InterAgentBridge(
      mailboxManager,
      connManager,
      handoffManager,
      livePaneProvider,
      taskManager,
    );

    // 2.2 Adversarial `cockpit ask` barrage against live bash pane
    console.log("  2.2 Bombarding live bash pane with 50 adversarial `cockpit ask` commands...");
    const hostilePayloads = [
      "rm -rf /",
      "$(reboot)",
      "; cat /etc/shadow",
      "`echo injected`",
      "| nc -lvnp 4444",
      "&& :(){ :|:& };:",
      "export PATH=/tmp:$PATH\nrm -rf *\n",
      "\\x00\\x0a\\x0d",
      "' OR '1'='1",
      "\n\n\n\nls -la\n",
    ];

    for (let i = 0; i < 50; i++) {
      const hostileText = hostilePayloads[i % hostilePayloads.length] + ` [run-${i}]`;
      const askResult = bridge.ask("pane-sender", liveBashPane.paneId, hostileText, undefined, "m-stdin-test");
      assert.ok("id" in askResult);
      assert.equal(askResult.status, "unread");
    }

    // Inspect live pane state directly from PtyManager
    const bashStateAfterAsk = getPane(liveBashPane.paneId);
    assert.ok(bashStateAfterAsk);
    assert.equal(
      bashStateAfterAsk.bytesIn,
      0,
      `VIOLATION DETECTED: bytesIn after 50 asks is ${bashStateAfterAsk.bytesIn} (expected strictly 0)!`,
    );

    // 2.3 Adversarial `cockpit handoff` operations targeting bash pane
    console.log("  2.3 Performing 20 `cockpit handoff` transfers targeting live bash pane...");
    for (let i = 0; i < 20; i++) {
      const task = taskManager.createTask("m-stdin-test", {
        título: `Handoff Task ${i}`,
        pane: "pane-sender",
        status: "in-progress",
      });

      const handoffRecord = bridge.handoff(
        "pane-sender",
        liveBashPane.paneId,
        task.id,
        `Context payload for task ${i}: rm -rf / ; sudo reboot`,
        false,
        "m-stdin-test",
      );
      assert.ok(handoffRecord.id);
      assert.equal(handoffRecord.targetPaneId, liveBashPane.paneId);
    }

    // Inspect live pane state again
    const bashStateAfterHandoff = getPane(liveBashPane.paneId);
    assert.ok(bashStateAfterHandoff);
    assert.equal(
      bashStateAfterHandoff.bytesIn,
      0,
      `VIOLATION DETECTED: bytesIn after 20 handoffs is ${bashStateAfterHandoff.bytesIn} (expected strictly 0)!`,
    );

    // Verify messages were enqueued in bash pane inbox and NOT typed into bash stdin
    const bashInbox = mailboxManager.getInbox(liveBashPane.paneId, "m-stdin-test");
    assert.equal(bashInbox.length, 70, "Bash inbox must contain all 50 asks + 20 handoffs");

    // 2.4 Positive Control: Verify sensor active
    console.log("  2.4 Positive control: verifying that genuine keystrokes increment bytesIn...");
    const testKeystrokes = "echo safe\n";
    writePty(liveBashPane.paneId, testKeystrokes);
    const bashStateAfterWrite = getPane(liveBashPane.paneId);
    assert.ok(bashStateAfterWrite);
    assert.equal(
      bashStateAfterWrite.bytesIn,
      testKeystrokes.length,
      `Positive control confirmed: bytesIn incremented to ${bashStateAfterWrite.bytesIn}`,
    );

    // Terminate live bash pane cleanly
    killPty(liveBashPane.paneId);
    console.log("  ✓ Clean Shell stdin safety strictly verified: 0 bytes written across 70 operations");

    // =========================================================================
    // SECTION 3: 5 CLI VERBS ACROSS SIMULATED PANES (E2E HTTP & CLI BINARY)
    // =========================================================================
    console.log("\n--------------------------------------------------------------------------------");
    console.log("SECTION 3: 5 CLI Verbs Across Simulated Panes (Live CLI Binary & HTTP)");
    console.log("--------------------------------------------------------------------------------");

    // Create an Express server with connection routes on an ephemeral port
    const app = express();
    app.use(express.json());

    // Simulated multi-pane roster
    const simulatedPanes = new Map<string, PaneInfo>([
      [
        "pane-maestro",
        {
          paneId: "pane-maestro",
          label: "Maestro",
          role: "maestro",
          runner: "codex",
          cli: "codex",
          model: "gpt-6-astra",
          status: "waiting-user",
          missionId: "cli-mission",
          cwd: "/workspace",
        },
      ],
      [
        "pane-builder",
        {
          paneId: "pane-builder",
          label: "Builder",
          role: "builder",
          runner: "claude",
          cli: "claude",
          model: "claude-3-7-sonnet",
          status: "working",
          missionId: "cli-mission",
          cwd: "/workspace",
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
          missionId: "cli-mission",
          cwd: "/workspace",
        },
      ],
      [
        "pane-reviewer",
        {
          paneId: "pane-reviewer",
          label: "Reviewer",
          role: "reviewer",
          runner: "codex",
          cli: "codex",
          model: "opus",
          status: "waiting-user",
          missionId: "cli-mission",
          cwd: "/workspace",
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
          missionId: "cli-mission",
          cwd: "/workspace",
        },
      ],
    ]);

    const simPaneProvider = {
      getPane: (id: string) => simulatedPanes.get(id),
      listPanes: () => Array.from(simulatedPanes.values()),
    };

    const simHandoffManager = new HandoffManager(
      handoffStore,
      taskManager,
      mailboxManager,
      (id) => simulatedPanes.get(id),
    );

    const simBridge = new InterAgentBridge(
      mailboxManager,
      connManager,
      simHandoffManager,
      simPaneProvider,
      taskManager,
    );

    app.use("/api", createConnectionRoutes(simBridge));

    // Listen on ephemeral port
    const server: Server = await new Promise((resolve) => {
      const s = createServer(app);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });

    const serverAddress = server.address();
    if (!serverAddress || typeof serverAddress === "string") {
      throw new Error("Could not acquire server address");
    }
    const testPort = String(serverAddress.port);
    const testEnv = {
      ...process.env,
      COCKPIT_PORT: testPort,
      COCKPIT_MISSION: "cli-mission",
    };

    // Helper to invoke CLI binary asynchronously so event loop can serve HTTP requests
    async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; status: number }> {
      const { spawn } = await import("node:child_process");
      return new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI_PATH, ...args], {
          env: testEnv,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => {
          stdout += d.toString();
        });
        child.stderr.on("data", (d) => {
          stderr += d.toString();
        });
        child.on("close", (status) => {
          resolve({ stdout, stderr, status: status ?? 0 });
        });
      });
    }

    // 3.1 CLI Verb: `cockpit list`
    console.log("  3.1 Testing CLI verb `cockpit list` (table, json, mission filter)...");
    const listTable = await runCli(["list"]);
    assert.equal(listTable.status, 0, "cockpit list table output must exit with code 0");
    assert.match(listTable.stdout, /pane-maestro/);
    assert.match(listTable.stdout, /pane-builder/);

    const listJson = await runCli(["list", "--format=json"]);
    assert.equal(listJson.status, 0, "cockpit list --format=json must exit with code 0");
    const parsedPanes = JSON.parse(listJson.stdout);
    assert.equal(parsedPanes.length, 5, "Must list all 5 simulated panes");
    const maestroPane = parsedPanes.find((p: any) => p.id === "pane-maestro");
    assert.ok(maestroPane);
    assert.equal(maestroPane.role, "maestro");
    assert.equal(maestroPane.runner, "codex");
    assert.equal(maestroPane.model, "gpt-6-astra");

    // Empty mission list
    const listEmpty = await runCli(["list", "--mission=nonexistent", "--format=json"]);
    assert.equal(listEmpty.status, 0);
    assert.deepEqual(JSON.parse(listEmpty.stdout), []);
    console.log("  ✓ `cockpit list` validated");

    // 3.2 CLI Verb: `cockpit connect`
    console.log("  3.2 Testing CLI verb `cockpit connect` (idempotency, bidirectional, errors)...");
    const connRes1 = await runCli(["connect", "pane-maestro", "pane-builder"]);
    assert.equal(connRes1.status, 0, "cockpit connect must exit with code 0");
    const connObj1 = JSON.parse(connRes1.stdout);
    assert.ok(connObj1.ok);
    assert.equal(connObj1.connection.sourcePaneId, "pane-maestro");
    assert.equal(connObj1.connection.targetPaneId, "pane-builder");

    // Idempotency: re-running returns identical connection
    const connRes2 = await runCli(["connect", "pane-maestro", "pane-builder"]);
    assert.equal(connRes2.status, 0);
    const connObj2 = JSON.parse(connRes2.stdout);
    assert.equal(connObj2.connection.id, connObj1.connection.id, "Re-connecting must return identical connection ID");

    // Bidirectional reverse connection returns identical connection
    const connRes3 = await runCli(["connect", "pane-builder", "pane-maestro"]);
    assert.equal(connRes3.status, 0);
    const connObj3 = JSON.parse(connRes3.stdout);
    assert.equal(connObj3.connection.id, connObj1.connection.id, "Reverse connection must be bidirectional idempotent");

    // Nonexistent pane connection fails cleanly
    const connResFail = await runCli(["connect", "pane-maestro", "pane-nonexistent"]);
    assert.equal(connResFail.status, 1, "Connecting nonexistent pane must fail with exit code 1");
    assert.match(connResFail.stderr, /Pane does not exist/);

    // Missing argument fails cleanly
    const connResMissing = await runCli(["connect", "pane-maestro"]);
    assert.equal(connResMissing.status, 1, "Missing target pane must fail with exit code 1");
    console.log("  ✓ `cockpit connect` validated");

    // 3.3 CLI Verb: `cockpit ask`
    console.log("  3.3 Testing CLI verb `cockpit ask` (delivery, inbox query, dead pane warning)...");
    const askRes = await runCli([
      "ask",
      "pane-builder",
      "Implement user authorization subsystem",
      "--task-id=task-auth",
      "--from=pane-maestro",
    ]);
    assert.equal(askRes.status, 0, "cockpit ask must exit with code 0");
    const askObj = JSON.parse(askRes.stdout);
    assert.ok(askObj.ok);
    assert.equal(askObj.result.to, "pane-builder");
    assert.equal(askObj.result.from, "pane-maestro");
    assert.equal(askObj.result.task, "Implement user authorization subsystem");
    assert.ok(askObj.result.correlationId);
    const correlationId = askObj.result.correlationId;

    // Verify message landed in inbox via `cockpit inbox`
    const inboxRes = await runCli(["inbox", "--pane=pane-builder"]);
    assert.equal(inboxRes.status, 0);
    const inboxObj = JSON.parse(inboxRes.stdout);
    assert.ok(inboxObj.ok);
    const targetMsg = inboxObj.inbox.find((m: any) => m.correlationId === correlationId);
    assert.ok(targetMsg, "Message must appear in pane-builder inbox");
    assert.equal(targetMsg.status, "unread");

    // Ask dead pane returns PANE_DEAD warning without crashing
    const askDeadRes = await runCli(["ask", "pane-dead", "Run health diagnostics", "--from=pane-maestro"]);
    assert.equal(askDeadRes.status, 0);
    const askDeadObj = JSON.parse(askDeadRes.stdout);
    assert.equal(askDeadObj.result.warning, "PANE_DEAD");
    assert.equal(askDeadObj.result.delivered, false);
    assert.equal(askDeadObj.result.queued, true);

    // Empty task rejection
    const askEmpty = await runCli(["ask", "pane-builder", "   "]);
    assert.equal(askEmpty.status, 1);

    // Missing arguments rejection
    const askMissing = await runCli(["ask"]);
    assert.equal(askMissing.status, 1);
    console.log("  ✓ `cockpit ask` validated");

    // 3.4 CLI Verb: `cockpit reply`
    console.log("  3.4 Testing CLI verb `cockpit reply` (reply delivery, idempotency, warnings)...");
    const replyRes = await runCli([
      "reply",
      "pane-maestro",
      "Authorization subsystem completed and tested",
      `--correlation-id=${correlationId}`,
      "--from=pane-builder",
    ]);
    assert.equal(replyRes.status, 0, "cockpit reply must exit with code 0");
    const replyObj = JSON.parse(replyRes.stdout);
    assert.ok(replyObj.ok);
    assert.equal(replyObj.result.type, "reply");
    assert.equal(replyObj.result.result, "Authorization subsystem completed and tested");

    // Verify reply in maestro inbox
    const maestroInboxRes = await runCli(["inbox", "--pane=pane-maestro"]);
    const maestroInboxObj = JSON.parse(maestroInboxRes.stdout);
    const replyMsg = maestroInboxObj.inbox.find((m: any) => m.correlationId === correlationId);
    assert.ok(replyMsg, "Reply message must land in pane-maestro inbox");

    // Duplicate reply with same correlationId: handled idempotently
    const dupReplyRes = await runCli([
      "reply",
      "pane-maestro",
      "Duplicate response attempt",
      `--correlation-id=${correlationId}`,
      "--from=pane-builder",
    ]);
    assert.equal(dupReplyRes.status, 0);
    const dupReplyObj = JSON.parse(dupReplyRes.stdout);
    assert.equal(dupReplyObj.result.status, "already_replied", "Duplicate reply must return already_replied");

    // Reply with unknown correlationId returns warning
    const unknownReplyRes = await runCli([
      "reply",
      "pane-maestro",
      "Spurious reply",
      "--correlation-id=corr-unknown-9999",
      "--from=pane-builder",
    ]);
    assert.equal(unknownReplyRes.status, 0);
    const unknownReplyObj = JSON.parse(unknownReplyRes.stdout);
    assert.equal(unknownReplyObj.result.warning, "CORRELATION_UNKNOWN");

    // Missing target pane fails cleanly
    const replyMissing = await runCli(["reply"]);
    assert.equal(replyMissing.status, 1);
    console.log("  ✓ `cockpit reply` validated");

    // 3.5 CLI Verb: `cockpit handoff`
    console.log("  3.5 Testing CLI verb `cockpit handoff` (reassignment, evidence, ownership, loops)...");
    // Create task owned by pane-builder
    const taskHandoff = taskManager.createTask("cli-mission", {
      título: "Code Review Subsystem",
      pane: "pane-builder",
      status: "in-progress",
    });

    // Successful handoff from pane-builder to pane-reviewer
    const handoffRes1 = await runCli([
      "handoff",
      "pane-builder",
      "pane-reviewer",
      taskHandoff.id,
      "Please verify auth tests and type safety",
    ]);
    assert.equal(handoffRes1.status, 0, "cockpit handoff must exit with code 0");
    const handoffObj1 = JSON.parse(handoffRes1.stdout);
    assert.ok(handoffObj1.ok);
    assert.equal(handoffObj1.handoff.sourcePaneId, "pane-builder");
    assert.equal(handoffObj1.handoff.targetPaneId, "pane-reviewer");
    assert.equal(handoffObj1.handoff.status, "completed");

    // Verify task was reassigned in task manager
    const taskAfterHandoff = taskManager.getTask(taskHandoff.id)!;
    assert.equal(taskAfterHandoff.pane, "pane-reviewer", "Task must now be assigned to pane-reviewer");

    // Verify handoff evidence added to task
    const hoffEvidence = taskAfterHandoff.evidências.find((e) => e.tipo === "handoff");
    assert.ok(hoffEvidence, "Task must have evidence of type handoff");
    assert.match(hoffEvidence.descricao, /Handoff de pane-builder para pane-reviewer/);

    // Verify handoff message enqueued in reviewer inbox
    const reviewerInboxRes = await runCli(["inbox", "--pane=pane-reviewer"]);
    const reviewerInboxObj = JSON.parse(reviewerInboxRes.stdout);
    const hoffMsg = reviewerInboxObj.inbox.find((m: any) => m.type === "handoff");
    assert.ok(hoffMsg, "Handoff message must be delivered to pane-reviewer inbox");

    // Ownership Enforcement: pane-maestro trying to handoff task now owned by pane-reviewer without --force
    const unauthHandoffRes = await runCli([
      "handoff",
      "pane-maestro",
      "pane-bash",
      taskHandoff.id,
      "Unauthorized hijack attempt",
    ]);
    assert.equal(unauthHandoffRes.status, 1, "Unauthorized handoff must fail with exit code 1");
    assert.match(unauthHandoffRes.stderr, /Ownership mismatch/);

    // Force override flag: allows transfer despite mismatch
    const forceHandoffRes = await runCli([
      "handoff",
      "pane-maestro",
      "pane-bash",
      taskHandoff.id,
      "Forced administrative transfer",
      "--force",
    ]);
    assert.equal(forceHandoffRes.status, 0, "Handoff with --force must succeed");
    const taskAfterForce = taskManager.getTask(taskHandoff.id)!;
    assert.equal(taskAfterForce.pane, "pane-bash", "Task must now be owned by pane-bash");

    // Circular loop detection: handoff pane-bash back to pane-builder (pane-builder was source of handoff 1!)
    const circularRes = await runCli([
      "handoff",
      "pane-bash",
      "pane-builder",
      taskHandoff.id,
      "Attempting circular transfer back to original owner",
    ]);
    assert.equal(circularRes.status, 1, "Circular handoff loop must fail with exit code 1");
    assert.match(circularRes.stderr, /Circular handoff loop detected/);

    // Dead pane handoff rejection
    const deadHandoffRes = await runCli([
      "handoff",
      "pane-bash",
      "pane-dead",
      taskHandoff.id,
      "Transfer to dead pane",
    ]);
    assert.equal(deadHandoffRes.status, 1, "Handoff to dead pane must fail with exit code 1");
    assert.match(deadHandoffRes.stderr, /Target pane is dead/);

    // Self handoff rejection
    const selfHandoffRes = await runCli([
      "handoff",
      "pane-bash",
      "pane-bash",
      taskHandoff.id,
      "Transfer to self",
    ]);
    assert.equal(selfHandoffRes.status, 1, "Handoff to self must fail with exit code 1");
    assert.match(selfHandoffRes.stderr, /Cannot handoff task to the same pane/);

    console.log("  ✓ `cockpit handoff` validated");

    // Close test server
    await new Promise((resolve) => server.close(resolve));

    // =========================================================================
    // SECTION 4: MULTI-HOP CIRCULAR HANDOFF & MISSION ISOLATION
    // =========================================================================
    console.log("\n--------------------------------------------------------------------------------");
    console.log("SECTION 4: Multi-Hop Circular Handoff & Mission Isolation");
    console.log("--------------------------------------------------------------------------------");

    // 4.1 Multi-Hop Circular Chain: P1 -> P2 -> P3 -> P1
    console.log("  4.1 Testing 3-node circular handoff loop (P1 -> P2 -> P3 -> P1)...");
    const multiTask = taskManager.createTask("chain-m", {
      título: "Multi-hop task",
      pane: "pane-builder",
      status: "in-progress",
    });

    // P1 (builder) -> P2 (reviewer)
    simBridge.handoff("pane-builder", "pane-reviewer", multiTask.id, "Hop 1", false, "chain-m");
    // P2 (reviewer) -> P3 (bash)
    simBridge.handoff("pane-reviewer", "pane-bash", multiTask.id, "Hop 2", false, "chain-m");
    // P3 (bash) -> P1 (builder) MUST FAIL (circular loop detected)
    assert.throws(
      () => simBridge.handoff("pane-bash", "pane-builder", multiTask.id, "Hop 3 (Cycle)", false, "chain-m"),
      /Circular handoff loop detected/,
      "3-node circular handoff must be detected and rejected",
    );
    // P3 (bash) -> P2 (reviewer) MUST ALSO FAIL (circular loop detected)
    assert.throws(
      () => simBridge.handoff("pane-bash", "pane-reviewer", multiTask.id, "Hop 3 to P2 (Cycle)", false, "chain-m"),
      /Circular handoff loop detected/,
      "Any return to prior node in handoff chain must be rejected",
    );
    console.log("  ✓ Multi-hop circular handoff prevention verified");

    // 4.2 Mission Isolation
    console.log("  4.2 Testing cross-mission mailbox isolation...");
    mailboxManager.enqueue({
      from: "p1",
      to: "shared-worker",
      type: "ask",
      task: "Mission Alpha Work",
      missionId: "mission-alpha",
    });
    mailboxManager.enqueue({
      from: "p2",
      to: "shared-worker",
      type: "ask",
      task: "Mission Beta Work",
      missionId: "mission-beta",
    });

    const alphaBox = mailboxManager.getInbox("shared-worker", "mission-alpha");
    const betaBox = mailboxManager.getInbox("shared-worker", "mission-beta");
    assert.equal(alphaBox.length, 1);
    assert.equal(alphaBox[0].task, "Mission Alpha Work");
    assert.equal(betaBox.length, 1);
    assert.equal(betaBox[0].task, "Mission Beta Work");
    console.log("  ✓ Mailboxes strictly isolated across distinct missions");

    console.log("\n================================================================================");
    console.log("ALL ADVERSARIAL STRESS TESTS PASSED (100% SUCCESS)");
    console.log("================================================================================");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nSTRESS TEST FAILURE:", err);
    process.exit(1);
  });
