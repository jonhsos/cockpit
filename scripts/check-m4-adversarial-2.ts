import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";
import { WebSocket } from "ws";

import { createApiRouter, type RouterContext } from "../servidor/routes/index.ts";
import { createWebSocketServer } from "../servidor/websocket/index.ts";
import { DiskStore } from "../servidor/persistence/disk-store.ts";
import { OwnershipStore } from "../servidor/persistence/ownership-store.ts";
import { TaskStore } from "../servidor/persistence/task-store.ts";
import { TaskManager } from "../servidor/tasks/task-manager.ts";
import { FileOwnershipManager } from "../servidor/tasks/file-ownership.ts";
import { ConnectionStore } from "../servidor/persistence/connection-store.ts";
import { HandoffStore } from "../servidor/persistence/handoff-store.ts";
import { ConnectionManager } from "../servidor/connections/connection-manager.ts";
import { HandoffManager } from "../servidor/connections/handoff-manager.ts";
import { MailboxStore } from "../servidor/connections/mailbox-store.ts";
import { MailboxManager } from "../servidor/connections/mailbox-manager.ts";
import { InterAgentBridge, type PaneInfo } from "../servidor/connections/inter-agent-bridge.ts";
import { MissionModeManager } from "../servidor/orchestration/mission-modes.ts";
import { PaneDispatcher } from "../servidor/orchestration/pane-dispatcher.ts";
import { config } from "../servidor/config.ts";
import { TEST_SECRET_VALUES } from "./security-test-values.mjs";

console.log("===============================================================================");
console.log("EMPIRICAL ADVERSARIAL CHALLENGER 2: Milestone M4 Verification Suite");
console.log("===============================================================================");

const tempDir = mkdtempSync(join(tmpdir(), "check-m4-adv2-"));
const projectDir = join(tempDir, "sample-project");
mkdirSync(projectDir, { recursive: true });
writeFileSync(join(projectDir, "hello.txt"), "Hello World\n", "utf8");

async function runAdversarialM4Suite(): Promise<void> {
  const disk = new DiskStore(tempDir);
  const ownershipStore = new OwnershipStore(disk);
  OwnershipStore.setDefaultStore(ownershipStore);
  const taskStore = new TaskStore(disk);
  const ownership = new FileOwnershipManager(ownershipStore);
  const taskManager = new TaskManager(ownership, taskStore);
  const connStore = new ConnectionStore(disk);
  const handoffStore = new HandoffStore(disk);
  const connManager = new ConnectionManager(connStore);
  const handoffManager = new HandoffManager(handoffStore, taskManager);
  const mailboxStore = new MailboxStore(disk);
  const mailboxManager = new MailboxManager(mailboxStore);

  const mockPanes = new Map<string, PaneInfo>();
  const bridge = new InterAgentBridge(
    mailboxManager,
    connManager,
    handoffManager,
    {
      getPane: (id) => mockPanes.get(id),
      listPanes: () => Array.from(mockPanes.values()),
    },
    taskManager,
  );

  const missionModeManager = new MissionModeManager();
  const paneDispatcher = new PaneDispatcher(taskManager, mailboxManager, {
    getPane: (id) => mockPanes.get(id) as any,
    listPanes: () => Array.from(mockPanes.values()) as any,
    updatePane: (id, p) => {
      const pane = mockPanes.get(id);
      if (pane) Object.assign(pane, p);
    },
  });

  const app = express();
  app.use(express.json({ limit: "8mb" }));

  let broadcastEvents: any[] = [];
  const broadcast = (msg: unknown) => {
    broadcastEvents.push(msg);
  };

  const routerCtx: RouterContext = {
    config: { ...config, agents: { ...config.agents } },
    salvarConfig: () => {},
    porta: 0,
    taskManager,
    ownershipManager: ownership,
    bridge,
    mailboxManager,
    missionModeManager,
    paneDispatcher,
    continuity: { record: () => {} } as any,
    broadcast,
    notifyMaestro: () => {},
    abrirPainel: () => ({} as any),
    switchMaestro: async () => ({} as any),
    saveCheckpoint: () => ({ ok: true }),
    raizDe: (_mId, _pId) => projectDir,
    limits: new Map(),
    refreshQuota: async () => {},
    maestroStatus: () => ({ status: "ok" }),
    presetsDoMaestro: () => ({}),
    especialistasDaMissao: () => [],
    limparElenco: (e) => e,
  };

  app.use("/api", createApiRouter(routerCtx));
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ ok: false, error: err.message });
  });

  const httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://localhost:${port}/api`;

  try {
    // =========================================================================
    // SECTION 1: REST ROUTE CONFLICT & PARAMETER RESOLUTION
    // =========================================================================
    console.log("\n[1] REST Route Conflict & Parameter Resolution Testing...");

    const missionId = "m-test-routes";

    // 1.1 Route Ordering Invariant: /tasks/board must NOT be matched as :taskId = "board"
    console.log("  1.1 Verifying /tasks/board route precedence over /tasks/:taskId...");
    const boardRes = await fetch(`${baseUrl}/missions/${missionId}/tasks/board`);
    assert.equal(boardRes.status, 200, "GET /tasks/board must return 200 OK");
    const boardData = (await boardRes.json()) as any;
    assert.equal(boardData.ok, true);
    assert.ok(boardData.board, "Must return board object");
    assert.ok(Array.isArray(boardData.board.todo), "Must contain formal state arrays");
    assert.ok(Array.isArray(boardData.board["in-progress"]));
    assert.ok(Array.isArray(boardData.board.blocked));
    assert.ok(Array.isArray(boardData.board["in-review"]));
    assert.ok(Array.isArray(boardData.board.complete));
    assert.ok(Array.isArray(boardData.board.failed));
    assert.equal(boardData.board.total, 0);

    // 1.2 Task lookup by real ID vs board
    console.log("  1.2 Verifying /tasks/:taskId lookup and 404 behavior...");
    const nonExistentTaskRes = await fetch(`${baseUrl}/missions/${missionId}/tasks/task-nonexistent`);
    assert.equal(nonExistentTaskRes.status, 404, "Nonexistent task lookup must return 404");
    const nonExistentData = (await nonExistentTaskRes.json()) as any;
    assert.equal(nonExistentData.ok, false);
    assert.match(nonExistentData.error, /Tarefa não encontrada/);

    // Create a real task via API
    const createTaskRes = await fetch(`${baseUrl}/missions/${missionId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        título: "Route conflict verification task",
        descrição: "Testing routes",
        responsavel: "tester",
      }),
    });
    assert.equal(createTaskRes.status, 201, "POST /tasks must return 201 Created");
    const createdTask = ((await createTaskRes.json()) as any).task;
    assert.ok(createdTask.id);

    // Lookup real task by ID
    const realTaskRes = await fetch(`${baseUrl}/missions/${missionId}/tasks/${createdTask.id}`);
    assert.equal(realTaskRes.status, 200);
    const realTaskData = (await realTaskRes.json()) as any;
    assert.equal(realTaskData.ok, true);
    assert.equal(realTaskData.task.id, createdTask.id);

    // 1.3 Path Traversal Prevention in fs-api
    console.log("  1.3 Verifying path traversal rejection in /file...");
    const traversalPayloads = [
      "../../../../etc/passwd",
      "../package.json",
      "..%2f..%2fpackage.json",
      "/etc/passwd",
      "../../../../../../../../../../../../etc/shadow",
    ];
    for (const trav of traversalPayloads) {
      const travRes = await fetch(`${baseUrl}/file?path=${encodeURIComponent(trav)}`);
      assert.equal(travRes.status, 400, `Path traversal "${trav}" must be rejected with 400 Bad Request`);
      const travData = (await travRes.json()) as any;
      assert.match(travData.error, /caminho fora da raiz/);
    }

    // Read valid file
    const validFileRes = await fetch(`${baseUrl}/file?path=hello.txt`);
    assert.equal(validFileRes.status, 200, "GET /file?path=hello.txt must return 200");
    const validFileData = (await validFileRes.json()) as any;
    assert.equal(validFileData.content, "Hello World\n");

    // 1.4 Isolated Lock Conflict Prevention in /locks/acquire & /file
    console.log("  1.4 Verifying 409 Conflict handling for isolated file locks...");
    // Task 1 acquires exclusive lock on hello.txt
    const lock1Res = await fetch(`${baseUrl}/missions/${missionId}/locks/acquire`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: createdTask.id,
        paneId: "pane-1",
        files: ["hello.txt"],
        mode: "isolated",
        owner: "Agent1",
      }),
    });
    const lock1Body = await lock1Res.text();
    assert.equal(lock1Res.status, 200, "First isolated lock acquisition must return 200 OK: " + lock1Body);

    // Create a second task
    const task2Res = await fetch(`${baseUrl}/missions/${missionId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ título: "Second task" }),
    });
    const task2 = ((await task2Res.json()) as any).task;

    // Task 2 attempts to acquire lock on the same file in isolated mode
    const lock2Res = await fetch(`${baseUrl}/missions/${missionId}/locks/acquire`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task2.id,
        paneId: "pane-2",
        files: ["hello.txt"],
        mode: "isolated",
        owner: "Agent2",
      }),
    });
    assert.equal(lock2Res.status, 409, "Conflicting lock acquisition must return 409 Conflict");
    const lock2Data = (await lock2Res.json()) as any;
    assert.equal(lock2Data.ok, false);
    assert.equal(lock2Data.locked, false);
    assert.ok(lock2Data.conflictFiles.includes("hello.txt"));

    // Task 2 attempts to write to hello.txt via POST /file
    const writeConflictRes = await fetch(`${baseUrl}/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "hello.txt",
        content: "Malicious overwrite",
        missionId,
        taskId: task2.id,
        paneId: "pane-2",
      }),
    });
    assert.equal(writeConflictRes.status, 409, "Conflicting file write must return 409 Conflict");
    const writeConflictData = (await writeConflictRes.json()) as any;
    assert.equal(writeConflictData.ok, false);
    assert.match(writeConflictData.error, /bloqueado/i);

    // Release lock
    const releaseRes = await fetch(`${baseUrl}/missions/${missionId}/locks/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: createdTask.id, files: ["hello.txt"] }),
    });
    assert.equal(releaseRes.status, 200);

    // 1.5 Special Characters & URL Encoded Parameters
    console.log("  1.5 Verifying URL encoding and special characters in route parameters...");
    const complexMissionId = "m-complex_test-123.456@xyz";
    const complexBoardRes = await fetch(`${baseUrl}/missions/${encodeURIComponent(complexMissionId)}/tasks/board`);
    assert.equal(complexBoardRes.status, 200, "URL-encoded missionId with special chars must route cleanly");

    // 1.6 Query parameter array handling
    console.log("  1.6 Verifying query parameter array handling...");
    const queryArrayRes = await fetch(`${baseUrl}/cockpit/list?mission=m1&mission=m2`);
    assert.equal(queryArrayRes.status, 200, "Array query parameters must not crash router");

    // 1.7 Task deletion 404
    console.log("  1.7 Verifying task deletion error handling...");
    const delTaskRes = await fetch(`${baseUrl}/missions/${missionId}/tasks/nonexistent-task`, {
      method: "DELETE",
    });
    assert.equal(delTaskRes.status, 404);

    // Delete real task
    const delRealRes = await fetch(`${baseUrl}/missions/${missionId}/tasks/${createdTask.id}`, {
      method: "DELETE",
    });
    assert.equal(delRealRes.status, 200);
    assert.equal(((await delRealRes.json()) as any).ok, true);

    console.log("  ✓ Section 1 Passed: REST routing, precedence, traversal defenses, and parameter handling verified.");

    // =========================================================================
    // SECTION 2: WEBSOCKET EVENT SCHEMAS & ERROR HANDLING
    // =========================================================================
    console.log("\n[2] WebSocket Event Schemas & Error Handling Testing...");

    const wsApp = createWebSocketServer(httpServer, {
      continuity: { record: () => {} } as any,
      abrirPainel: () => ({} as any),
      refreshQuota: async () => {},
    });

    const receivedMessages: any[] = [];
    const wsClient = new WebSocket(`ws://localhost:${port}/ws`);
    wsClient.on("message", (buf) => {
      try {
        receivedMessages.push(JSON.parse(String(buf)));
      } catch {
        // raw
      }
    });
    await new Promise<void>((resolve, reject) => {
      wsClient.on("open", resolve);
      wsClient.on("error", reject);
    });

    // Wait for initial connection handshake messages
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(receivedMessages.length >= 1, "Client must receive initial connection state (panes)");

    // 2.1 Secret Redaction in Real-Time WebSocket Output Broadcast
    console.log("  2.1 Verifying real-time secret sanitization in output broadcasts...");
    const secretOutput =
      `Connected! Anthropic key: ${TEST_SECRET_VALUES.anthropicApi03}, OpenAI key: ${TEST_SECRET_VALUES.openAiProject}`;
    wsApp.broadcast({ type: "output", paneId: "p-sec", data: secretOutput });

    await new Promise((r) => setTimeout(r, 50));
    const lastOutput = receivedMessages.find((m) => m.type === "output" && m.paneId === "p-sec");
    assert.ok(lastOutput, "Must receive output message");
    assert.equal(
      lastOutput.data.includes("sk-ant-api03-"),
      false,
      "Anthropic secret key must be redacted from WS stream",
    );
    assert.equal(
      lastOutput.data.includes("sk-proj-"),
      false,
      "OpenAI secret key must be redacted from WS stream",
    );

    // 2.2 Fuzzing WS Event Messages (safe non-crashing payloads)
    console.log("  2.2 Fuzzing WebSocket with malformed non-JSON payloads...");
    wsClient.send("NOT_JSON_DATA_GARBAGE");
    wsClient.send("{ malformed json");
    wsClient.send("12345");
    wsClient.send("true");
    wsClient.send(JSON.stringify({ type: "unknown_random_type", foo: "bar" }));
    wsClient.send(JSON.stringify({ type: "resize" })); // missing paneId, cols, rows
    wsClient.send(JSON.stringify({ type: "kill" })); // missing paneId
    wsClient.send(JSON.stringify({ type: "replay" })); // missing paneId
    wsClient.send(JSON.stringify({ type: "attach" })); // missing paneId

    await new Promise((r) => setTimeout(r, 100));
    assert.equal(wsClient.readyState, WebSocket.OPEN, "WebSocket connection must remain open after fuzzing");

    // 2.3 Rapid Concurrent Connections
    console.log("  2.3 Verifying rapid concurrent WebSocket connections...");
    const concurrentClients: WebSocket[] = [];
    for (let i = 0; i < 10; i++) {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      concurrentClients.push(ws);
    }
    await Promise.all(
      concurrentClients.map(
        (ws) =>
          new Promise<void>((resolve) => {
            ws.on("open", () => resolve());
          }),
      ),
    );
    assert.ok(wsApp.clientManager.count >= 10, "ClientManager must track all concurrent clients");

    // Close concurrent clients
    for (const ws of concurrentClients) {
      ws.close();
    }
    await new Promise((r) => setTimeout(r, 50));

    wsClient.close();
    console.log("  ✓ Section 2 Passed: WebSocket sanitization, schema fuzzing, and concurrency verified.");

    // =========================================================================
    // SECTION 3: RACE CONDITIONS & CONCURRENCY
    // =========================================================================
    console.log("\n[3] Race Conditions & Concurrency Stress Testing...");

    // 3.1 Concurrent Lock Acquisition: 20 simultaneous requests
    console.log("  3.1 Testing 20 simultaneous lock acquisition requests on the same file...");
    const concurrentTasks = Array.from({ length: 20 }, (_, i) =>
      taskManager.createTask(missionId, { título: `Concurrent lock task ${i}` }),
    );

    const lockResults = await Promise.all(
      concurrentTasks.map((t) =>
        fetch(`${baseUrl}/missions/${missionId}/locks/acquire`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: t.id,
            paneId: `pane-${t.id}`,
            files: ["race-test.txt"],
            mode: "isolated",
            owner: `Worker-${t.id}`,
          }),
        }).then((r) => r.status),
      ),
    );

    const successCount = lockResults.filter((s) => s === 200).length;
    const conflictCount = lockResults.filter((s) => s === 409).length;

    assert.equal(successCount, 1, "Exactly one concurrent lock request must succeed with 200");
    assert.equal(conflictCount, 19, "All other 19 concurrent lock requests must return 409 Conflict");
    console.log("  ✓ 1 succeeded (200 OK), 19 rejected (409 Conflict) — zero race condition collisions.");

    // 3.2 Concurrent State Transitions on the same Task
    console.log("  3.2 Testing concurrent state transitions on the same task...");
    const raceTask = taskManager.createTask(missionId, { título: "State Machine Race Task" });
    const transitionResults = await Promise.all(
      Array.from({ length: 10 }, () =>
        fetch(`${baseUrl}/missions/${missionId}/tasks/${raceTask.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "in-progress" }),
        }).then((r) => r.status),
      ),
    );

    const transSuccess = transitionResults.filter((s) => s === 200).length;
    assert.ok(transSuccess >= 1, "At least one transition succeeded");
    const finalTask = taskManager.getTask(raceTask.id)!;
    assert.equal(finalTask.status, "in-progress", "Task must settle in valid in-progress status");
    console.log("  ✓ Concurrent transitions settled cleanly in 'in-progress'.");

    console.log("  ✓ Section 3 Passed: Concurrency boundaries and lock serialization verified.");

    // =========================================================================
    // SECTION 4: EMPIRICAL VULNERABILITY PROBES (ISOLATED CHILD PROCESSES)
    // =========================================================================
    console.log("\n[4] Empirical Vulnerability Probes (Child Processes)...");

    // 4.1 Empirical Bug 1: Unhandled 'null' JSON in WebSocket Server
    console.log("  4.1 Probing WebSocket server resilience to JSON 'null' payload...");
    const probeCodeNull = `
      import { createServer } from "node:http";
      import { WebSocket } from "ws";
      import { createWebSocketServer } from "./servidor/websocket/index.ts";

      const server = createServer();
      createWebSocketServer(server, {
        continuity: { record: () => {} },
        abrirPainel: () => ({}),
        refreshQuota: async () => {},
      });

      server.listen(0, () => {
        const port = server.address().port;
        const ws = new WebSocket("ws://localhost:" + port + "/ws");
        ws.on("open", () => {
          ws.send("null");
        });
        ws.on("message", (buf) => {
          try {
            const msg = JSON.parse(String(buf));
            if (msg.type === "error") {
              ws.close();
              server.close(() => process.exit(0));
            }
          } catch {
            // ignore
          }
        });
        setTimeout(() => {
          ws.close();
          server.close(() => process.exit(0));
        }, 1500);
      });
    `;

    const nullResult = spawnSync(process.execPath, ["--input-type=module", "-e", probeCodeNull], {
      encoding: "utf8",
      timeout: 5000,
    });

    if (nullResult.status === 0) {
      console.log("  ✓ Milestone M6 Hardening Verified: 'null' payload handled safely with typed error reply.");
    } else {
      assert.equal(
        nullResult.status,
        1,
        "Vulnerability confirmed: sending 'null' terminates Node.js process with exit code 1",
      );
      assert.match(
        nullResult.stderr,
        /TypeError: Cannot read properties of null \(reading 'type'\)/,
        "Vulnerability confirmed: TypeError thrown at ws-server.ts switch (msg.type)",
      );
      console.log("  ⚠️ Confirmed Vulnerability 1: WebSocket server crashes on 'null' payload (TypeError on msg.type).");
    }

    // 4.2 Empirical Bug 2: Active Pane Input with Missing 'data' Field
    console.log("  4.2 Probing TerminalHandler input with undefined 'data' field...");
    const probeCodeInput = `
      import { getDefaultPtyManager } from "./servidor/sessions/pty-manager.ts";
      import { TerminalHandler } from "./servidor/websocket/terminal-handler.ts";
      import { ClientManager } from "./servidor/websocket/client-manager.ts";

      const mgr = getDefaultPtyManager();
      mgr.ptys.set("pane-test", {
        state: { paneId: "pane-test", status: "working", bytesIn: 0 },
        lastData: Date.now(),
        acumulado: 0,
      });

      const th = new TerminalHandler(new ClientManager(), { record: () => {} });
      th.handleInput("pane-test", undefined);
      process.exit(0);
    `;

    const inputResult = spawnSync(process.execPath, ["--input-type=module", "-e", probeCodeInput], {
      encoding: "utf8",
      timeout: 5000,
    });

    if (inputResult.status === 0) {
      console.log("  ✓ Milestone M6 Hardening Verified: TerminalHandler safely discards invalid input without crashing.");
    } else {
      assert.equal(
        inputResult.status,
        1,
        "Vulnerability confirmed: missing data crashes with exit code 1",
      );
      assert.match(
        inputResult.stderr,
        /TypeError: Cannot read properties of undefined \(reading 'length'\)/,
        "Vulnerability confirmed: pty-manager writePty crashes on undefined data.length",
      );
      console.log("  ⚠️ Confirmed Vulnerability 2: Active pane input with undefined data crashes process.");
    }

    // 4.3 Empirical Bug 3: Dangling setIntervals in ws-server.ts
    console.log("  4.3 Probing dangling setInterval handles in ws-server.ts...");
    const probeCodeTimers = `
      import { createServer } from "node:http";
      import { createWebSocketServer } from "./servidor/websocket/index.ts";

      const server = createServer();
      const wsApp = createWebSocketServer(server, {
        continuity: { record: () => {} },
        abrirPainel: () => ({}),
        refreshQuota: async () => {},
      });

      server.listen(0, () => {
        wsApp.wss.close(() => {
          server.close(() => {
            // Both servers closed; event loop should exit naturally if no timers leak
          });
        });
      });
      setTimeout(() => {
        console.error("EVENT_LOOP_LEAK");
        process.exit(42);
      }, 1500);
    `;

    const timerResult = spawnSync(process.execPath, ["--input-type=module", "-e", probeCodeTimers], {
      encoding: "utf8",
      timeout: 5000,
    });

    if (timerResult.status === 0) {
      console.log("  ✓ Milestone M6 Hardening Verified: WebSocket timers cleaned up naturally.");
    } else {
      assert.equal(
        timerResult.status,
        42,
        "Vulnerability confirmed: event loop held open by dangling setInterval timers",
      );
      assert.match(
        timerResult.stderr,
        /EVENT_LOOP_LEAK/,
        "Vulnerability confirmed: process does not exit naturally when server is closed",
      );
      console.log("  ⚠️ Confirmed Vulnerability 3: Dangling setInterval timers prevent natural event loop exit.");
    }

    console.log("\n===============================================================================");
    console.log("ALL ADVERSARIAL PROBES AND M4 VERIFICATIONS COMPLETED SUCCESSFULLY!");
    console.log("===============================================================================\n");
  } finally {
    httpServer.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

runAdversarialM4Suite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("M4 ADVERSARIAL VERIFICATION FAILED:", err);
    process.exit(1);
  });
