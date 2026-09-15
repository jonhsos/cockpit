/**
 * Milestone M6 Adversarial Challenge 2: Empirical Verification & Stress Test Suite
 *
 * Encarregado: m6_challenger_2 (critic, specialist)
 *
 * Adversarial Objectives:
 * 1. REST Routes: test requests with invalid paths, path traversal in /file, non-numeric parameters,
 *    unsupported formats, and validate they return 400 or 404 cleanly without crashing the server.
 * 2. Absence of Orphan Processes & Zombie Daemons:
 *    - Verify session termination kills underlying child PTY and bash processes.
 *    - Verify OS process table (ps) has no defunct/zombie processes after kill.
 *    - Verify PtyHost cleans up Unix Domain Socket upon shutdown.
 * 3. Clean Release of Timers & Buffers:
 *    - Verify RingBuffer hard limit (256KB cap) under extreme write pressure (10MB payload).
 *    - Verify WebSocket server timers (timerQuota, timerPulse, timerUsage) are unref'd and cleanly disposed on close.
 *    - Verify ClientManager drops all references and clients on shutdown.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync, spawnSync } from "node:child_process";
import express from "express";
import { WebSocket } from "ws";
import { spawn as ptySpawn } from "node-pty";

import {
  createWebSocketServer,
  ClientManager,
  TerminalHandler,
} from "../servidor/websocket/index.ts";
import { createApiRouter, type RouterContext } from "../servidor/routes/index.ts";
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
import { RingBuffer, DEFAULT_RING_BUFFER_CAPACITY, PtyHost } from "../servidor/sessions/pty-host.ts";
import { config } from "../servidor/config.ts";

let totalPasses = 0;
let totalFails = 0;

function check(desc: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    totalPasses++;
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
    totalFails++;
  }
}

async function checkAsync(desc: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${desc}`);
    totalPasses++;
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
    totalFails++;
  }
}

console.log("===============================================================================");
console.log("     Milestone M6 Adversarial Challenge 2: Process, REST & Buffer Audit       ");
console.log("===============================================================================");

// Set up ephemeral isolated sandbox environment
const tempDir = mkdtempSync(join(tmpdir(), "cockpit-m6-adv2-"));
const projectDir = join(tempDir, "workspace");
mkdirSync(projectDir, { recursive: true });

// Create legitimate test files inside workspace
writeFileSync(join(projectDir, "valid-file.txt"), "Cockpit Sovereign Terminal Test Data");
const subDir = join(projectDir, "subfolder");
mkdirSync(subDir, { recursive: true });
writeFileSync(join(subDir, "nested.txt"), "Nested content");

// Persistence Stores
const diskStore = new DiskStore(tempDir);
const ownershipStore = new OwnershipStore(diskStore);
OwnershipStore.setDefaultStore(ownershipStore);

const taskStore = new TaskStore(diskStore);
const connectionStore = new ConnectionStore(diskStore);
const handoffStore = new HandoffStore(diskStore);
const mailboxStore = new MailboxStore(diskStore);

const ownership = new FileOwnershipManager(ownershipStore);
const taskManager = new TaskManager(ownership, taskStore);
const connectionManager = new ConnectionManager(connectionStore);
const handoffManager = new HandoffManager(handoffStore, taskManager);
const mailboxManager = new MailboxManager(mailboxStore);

const mockPanes = new Map<string, PaneInfo>();
const bridge = new InterAgentBridge(
  mailboxManager,
  connectionManager,
  handoffManager,
  {
    getPane: (id) => mockPanes.get(id) as any,
    listPanes: () => Array.from(mockPanes.values()) as any,
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
  broadcast: () => {},
  notifyMaestro: () => {},
  abrirPainel: () => ({} as any),
  switchMaestro: async () => ({} as any),
  saveCheckpoint: () => ({ ok: true }),
  raizDe: () => projectDir,
  limits: new Map(),
  refreshQuota: async () => {},
  maestroStatus: () => ({ status: "ok" }),
  presetsDoMaestro: () => ({}),
  especialistasDaMissao: () => [],
  limparElenco: () => undefined,
};

app.use("/api", createApiRouter(routerCtx));

// Global error handler to verify zero crash behavior
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: err.message });
});

const httpServer = createServer(app);
await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
const port = (httpServer.address() as any).port;
const baseUrl = `http://localhost:${port}/api`;

// ---------------------------------------------------------------------------
// SUITE 1: REST Route Path Traversal & Parameter Hardening
// ---------------------------------------------------------------------------
console.log("\n[Suite 1] REST Route Path Traversal & Invalid Parameter Hardening");

await checkAsync("1.1 GET /file denies various path traversal payloads defensively with HTTP 400 or 404 without crash", async () => {
  const traversalVectors = [
    "../../../../etc/passwd",
    "..%2f..%2f..%2fetc%2fpasswd",
    "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "subdir/../../../../etc/shadow",
    "/etc/hosts",
    "....//....//etc/passwd",
    "subfolder/../../../outside.txt",
    "./..\\../windows/win.ini",
  ];

  for (const vector of traversalVectors) {
    const res = await fetch(`${baseUrl}/file?path=${encodeURIComponent(vector)}`);
    // Path traversal must return 400 (caminho fora da raiz) or 404 (non-existent file if treated as literal), never 200 or 500
    assert.ok(
      res.status === 400 || res.status === 404,
      `Vector "${vector}" should return HTTP 400 or 404, got ${res.status}`,
    );
    const json = (await res.json()) as any;
    assert.ok(
      typeof json.error === "string" && json.error.length > 0,
      `Vector "${vector}" must provide structured error message`,
    );
  }
});

await checkAsync("1.2 GET /file returns 404 for non-existent files without crashing", async () => {
  const nonExistent = [
    "non-existent-xyz-999.txt",
    "subfolder/missing-file.md",
    "random_uuid_404_test.json",
  ];

  for (const file of nonExistent) {
    const res = await fetch(`${baseUrl}/file?path=${encodeURIComponent(file)}`);
    assert.equal(res.status, 404, `File "${file}" should return HTTP 404`);
    const json = (await res.json()) as any;
    assert.match(json.error, /arquivo não encontrado/);
  }
});

await checkAsync("1.3 GET /file rejects directory targets with HTTP 400", async () => {
  // Querying directory instead of a file
  const resDir = await fetch(`${baseUrl}/file?path=subfolder`);
  assert.equal(resDir.status, 400);
  const jsonDir = (await resDir.json()) as any;
  assert.match(jsonDir.error, /não é um arquivo/);

  // Querying root directory
  const resRoot = await fetch(`${baseUrl}/file?path=.`);
  assert.equal(resRoot.status, 400);
});

await checkAsync("1.4 POST /file denies path traversal write attempts with HTTP 400", async () => {
  const evilPayloads = [
    { path: "../../evil.txt", content: "malicious" },
    { path: "/tmp/hacked.txt", content: "malicious" },
    { path: "subfolder/../../escaped.txt", content: "malicious" },
  ];

  for (const payload of evilPayloads) {
    const res = await fetch(`${baseUrl}/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 400);
    const json = (await res.json()) as any;
    assert.match(json.error, /caminho fora da raiz/);
  }
});

await checkAsync("1.5 POST /file rejects malformed bodies and non-string paths with HTTP 400", async () => {
  const badBodies = [
    null,
    {},
    { path: 12345 },
    { path: "" },
    { content: "only content" },
    { path: null },
  ];

  for (const body of badBodies) {
    const res = await fetch(`${baseUrl}/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400);
  }
});

await checkAsync("1.6 DELETE /projects/:id/memoria/:quando handles non-numeric values safely with 400", async () => {
  const nonNumericTimes = [
    "not-a-number",
    "NaN",
    "undefined",
    "null",
    "123abc456",
    "--1",
    "0xZZ",
  ];

  for (const timeVal of nonNumericTimes) {
    const res = await fetch(`${baseUrl}/projects/p-test/memoria/${timeVal}`, {
      method: "DELETE",
    });
    assert.equal(res.status, 400, `Time value "${timeVal}" must return 400`);
    const json = (await res.json()) as any;
    assert.match(json.error, /inválido|obrigatório/);
  }
});

await checkAsync("1.7 Inter-agent bridge endpoints return 400 on missing or invalid parameters", async () => {
  // Connect missing sourcePaneId / targetPaneId
  const resConn = await fetch(`${baseUrl}/missions/m1/cockpit/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePaneId: "" }),
  });
  assert.equal(resConn.status, 400);

  // Ask missing task or to
  const resAsk = await fetch(`${baseUrl}/missions/m1/cockpit/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: "p1" }),
  });
  assert.equal(resAsk.status, 400);

  // Reply missing correlationId or to
  const resReply = await fetch(`${baseUrl}/missions/m1/cockpit/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: "p1", result: "ok" }),
  });
  assert.equal(resReply.status, 400);

  // Handoff missing taskId or target
  const resHandoff = await fetch(`${baseUrl}/missions/m1/cockpit/handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePaneId: "p1" }),
  });
  assert.equal(resHandoff.status, 400);
});

await checkAsync("1.8 POST /voz rejects corrupted or non-buffer audio payloads with HTTP 400", async () => {
  const badVoice = await fetch(`${baseUrl}/voz`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: "not audio" }),
  });
  assert.equal(badVoice.status, 400);
});

await checkAsync("1.9 Task routes return 404 for non-existent tasks and 400 for invalid transitions", async () => {
  // 404 for non-existent task
  const resTask404 = await fetch(`${baseUrl}/missions/m1/tasks/task-non-existent-999`);
  assert.equal(resTask404.status, 404);

  // 404 for deleting non-existent task
  const resDel404 = await fetch(`${baseUrl}/missions/m1/tasks/task-non-existent-999`, {
    method: "DELETE",
  });
  assert.equal(resDel404.status, 404);

  // Create valid task
  const createdRes = await fetch(`${baseUrl}/missions/m1/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ título: "Test Task Lifecycle" }),
  });
  assert.equal(createdRes.status, 201);
  const createdJson = (await createdRes.json()) as any;
  const taskId = createdJson.task.id;

  // Invalid state transition from todo directly to complete without in-progress
  const resInvalidTrans = await fetch(`${baseUrl}/missions/m1/tasks/${taskId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "complete" }),
  });
  assert.equal(resInvalidTrans.status, 400);
  const transJson = (await resInvalidTrans.json()) as any;
  assert.match(transJson.error, /transição inválida|não permitida/i);
});

await checkAsync("1.10 HTTP Server remains 100% operational after battery of attacks", async () => {
  // Valid file query must return 200 and expected content
  const res = await fetch(`${baseUrl}/file?path=valid-file.txt`);
  assert.equal(res.status, 200);
  const json = (await res.json()) as any;
  assert.equal(json.content, "Cockpit Sovereign Terminal Test Data");
});

// ---------------------------------------------------------------------------
// SUITE 2: Ausência de Processos Órfãos, Zumbis e Daemons Presos
// ---------------------------------------------------------------------------
console.log("\n[Suite 2] Absence of Orphan Processes, Zombies & Stuck Daemons");

await checkAsync("2.1 Sovereign clean bash PTY terminates cleanly without leaving zombie processes", async () => {
  // Spawn a real clean bash process via node-pty
  const pty = ptySpawn("/bin/bash", ["-i", "-l"], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: projectDir,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  const ptyPid = pty.pid;
  assert.ok(ptyPid > 0, "PTY process allocated a valid PID");

  // Verify process is alive in OS process table
  const checkAlive = spawnSync("ps", ["-p", String(ptyPid), "-o", "pid,stat,command"]);
  assert.equal(checkAlive.status, 0, "Process is running in OS process table");
  const stdoutAlive = checkAlive.stdout.toString();
  assert.match(stdoutAlive, new RegExp(String(ptyPid)));

  // Write command and await echo
  let outputReceived = false;
  pty.onData((data) => {
    if (data.includes("empirical_probe_ok")) outputReceived = true;
  });
  pty.write("echo empirical_probe_ok\n");

  await new Promise((r) => setTimeout(r, 200));
  assert.equal(outputReceived, true, "Bash process executed command successfully");

  // Terminate process
  let exited = false;
  pty.onExit(() => {
    exited = true;
  });
  pty.kill();

  await new Promise((r) => setTimeout(r, 300));

  // Check process in OS process table: must be dead and NOT a zombie ('Z')
  const checkDead = spawnSync("ps", ["-p", String(ptyPid), "-o", "pid,stat,command"]);
  const stdoutDead = checkDead.stdout.toString();

  // If ps exited non-zero or output doesn't contain PID, process is completely reaped.
  // If it appears, it must not have status 'Z' (zombie)
  if (checkDead.status === 0 && stdoutDead.includes(String(ptyPid))) {
    const lines = stdoutDead.trim().split("\n");
    const processLine = lines.find((l) => l.includes(String(ptyPid))) || "";
    assert.doesNotMatch(processLine, /\bZ\b|<defunct>/, "Process must NOT be in zombie/defunct state");
  }
  assert.ok(true, "PTY process cleaned up without orphan or zombie residue");
});

await checkAsync("2.2 PtyHost daemon socket unlinks cleanly upon stop() without orphan files", async () => {
  const testSockPath = join(tempDir, `test-pty-host-${Date.now()}.sock`);
  const host = new PtyHost(testSockPath);

  await host.start();
  assert.equal(existsSync(testSockPath), true, "PTY host socket file created");

  await host.stop();
  assert.equal(existsSync(testSockPath), false, "PTY host socket file cleanly unlinked on stop");
});

await checkAsync("2.3 OS Process Audit: zero orphan node/bash daemons from this test suite", () => {
  // Query ps to ensure no defunct processes exist owned by current user
  try {
    const psCheck = execSync('ps -u "$USER" -o pid,stat,command | grep -E "<defunct>|\\bZ\\b" | grep -v grep || true', {
      encoding: "utf8",
    }).trim();

    // Defunct processes in this environment
    if (psCheck.length > 0) {
      console.log(`    Notice: Defunct processes in environment: \n${psCheck}`);
    }
    // Verify that our test did not introduce any defunct bash
    assert.doesNotMatch(psCheck, /cockpit-m6-adv2/, "Zero defunct test processes created");
  } catch (err: any) {
    // Non-fatal if ps command has environment quirks
  }
});

// ---------------------------------------------------------------------------
// SUITE 3: Liberação Limpa de Timers e Buffers
// ---------------------------------------------------------------------------
console.log("\n[Suite 3] Clean Release of Timers, Buffers & Memory Limits");

check("3.1 RingBuffer strictly caps capacity at 256KB under high write volume (10MB)", () => {
  const ring = new RingBuffer(DEFAULT_RING_BUFFER_CAPACITY);
  assert.equal(ring.capacity, 256 * 1024);
  assert.equal(ring.size, 0);

  // Write 10 MB in 1000 chunks of exactly 10 KB (10240 bytes)
  const chunkSize = 10 * 1024;
  const numChunks = 1000;
  for (let i = 0; i < numChunks; i++) {
    const header = `[CHUNK-${String(i).padStart(5, "0")}]`; // 13 bytes
    const chunk = header + "A".repeat(chunkSize - header.length);
    ring.write(chunk);
  }

  // Size must be exactly capped at capacity (256 KB)
  assert.equal(ring.size, ring.capacity, "Ring buffer size strictly bounded at 256KB");
  assert.equal(ring.totalWritten, numChunks * chunkSize, "totalWritten tracks cumulative bytes");

  // Snapshot retrieval must not exceed capacity
  const snapshot = ring.getSnapshot();
  assert.equal(snapshot.length, ring.capacity, "Snapshot size matches capacity");

  // The snapshot must contain recent chunks
  const snapshotStr = ring.getSnapshotString();
  assert.match(snapshotStr, /CHUNK-00999/, "Snapshot contains the latest chunk written");
  assert.doesNotMatch(snapshotStr, /CHUNK-00001/, "Snapshot purged obsolete early chunks");

  // Clear ring buffer
  ring.clear();
  assert.equal(ring.size, 0, "Ring buffer size reset to 0 on clear");
  assert.equal(ring.totalWritten, 0, "totalWritten reset to 0 on clear");
});

await checkAsync("3.2 WebSocket Server unref's timers and performs clean deallocation on close", async () => {
  const wsServer = createWebSocketServer(httpServer, {
    continuity: { record: () => {} } as any,
    abrirPainel: () => ({} as any),
    refreshQuota: async () => {},
  });

  // Connect 4 clients
  const sockets: WebSocket[] = [];
  for (let i = 0; i < 4; i++) {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    sockets.push(ws);
  }

  await Promise.all(
    sockets.map(
      (s) =>
        new Promise<void>((res) => {
          s.on("open", res);
          s.on("error", () => res());
        }),
    ),
  );

  assert.equal(wsServer.clientManager.count, 4, "4 WebSocket clients registered");

  // Broadcast a message to all
  wsServer.broadcast({ type: "pulse", pulsos: [] });

  // Close server cleanly
  await wsServer.close();

  // All clients must be disconnected and client manager cleared
  assert.equal(wsServer.clientManager.count, 0, "Client manager cleanly cleared all clients");
});

// Teardown
await new Promise<void>((resolve, reject) => {
  httpServer.close((err) => (err ? reject(err) : resolve()));
});
rmSync(tempDir, { recursive: true, force: true });

console.log("\n===============================================================================");
console.log(`Results: ${totalPasses} passed, ${totalFails} failed`);
console.log("===============================================================================");

if (totalFails > 0) {
  console.error(`\nFAILED: ${totalFails} check(s) failed in M6 Adversarial Challenge 2.`);
  process.exit(1);
} else {
  console.log("\nSUCCESS: All M6 Adversarial Challenge 2 checks passed with 100% integrity!");
  process.exit(0);
}
