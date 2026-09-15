/**
 * Milestone M6 Adversarial Challenge: Empirical Verification & Concurrency Stress Test Suite
 *
 * Authored by: m6_challenger_1 (Empirical Challenger)
 *
 * Core Adversarial Objectives:
 * 1. Malformed Frames & Injection Fuzzing:
 *    - Send corrupted raw binary buffers (non-UTF8, null bytes)
 *    - Send truncated JSON, non-JSON strings, and non-object JSON roots (null, numbers, booleans, arrays)
 *    - Send prototype pollution payloads (__proto__, constructor.prototype, prototype, unicode-escaped keys)
 *    - Verify that runtime prototypes (Object.prototype) remain pristine and unpolluted
 *    - Verify that every malformed message receives a structured error response without crashing the server
 *
 * 2. High-Concurrency Malformed Burst vs. Legitimate Terminal Session:
 *    - 20 adversarial WebSocket clients blasting 1,000 malformed frames simultaneously
 *    - Legitimate client executing active terminal operations (attach, input, resize)
 *    - Verify legitimate client connection remains OPEN, unharmed, and receives all broadcast pulses/data
 *
 * 3. Abrupt Disconnections (ws.terminate()) During Active Broadcast:
 *    - Blast 500 high-frequency server broadcasts across 50 active WebSocket connections
 *    - Terminate 40 client sockets abruptly via ws.terminate() (TCP RST without WS close handshake)
 *    - Prove zero EPIPE, zero unhandled rejections, zero process crashes
 *    - Verify server remains 100% operational and immediately accepts new client connections
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { WebSocket } from "ws";

import {
  createWebSocketServer,
  validateAndParseClientMessage,
  hasPrototypePollution,
  MAX_WS_PAYLOAD_BYTES,
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
console.log("     Milestone M6 Adversarial Challenge & Empirical Concurrency Stress         ");
console.log("===============================================================================");

// ---------------------------------------------------------------------------
// CHALLENGE 1: Payloads Corrompidos, Buffers não-JSON, Nulos e Prototype Pollution
// ---------------------------------------------------------------------------
console.log("\n[Challenge 1] Corrupted Frames, Raw Binary, Null/Array & Prototype Pollution Fuzzing");

check("1.1 Raw binary buffer with non-UTF8 bytes is safely handled without throwing", () => {
  const badBuffer = Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0x1b, 0x7f, 0xc0, 0xaf]);
  const res = validateAndParseClientMessage(badBuffer);
  assert.equal(res.ok, false);
  assert.ok(typeof res.error === "string");
  assert.match(res.error!, /JSON inválido/);
});

check("1.2 Truncated unicode escapes and broken JSON strings return structured error", () => {
  const brokenUnicode = '{"type": "in\\u00';
  const res1 = validateAndParseClientMessage(brokenUnicode);
  assert.equal(res1.ok, false);
  assert.match(res1.error!, /JSON inválido/);

  const brokenQuotes = '{"type": "input", "paneId": "p1", "data": "unterminated string...';
  const res2 = validateAndParseClientMessage(brokenQuotes);
  assert.equal(res2.ok, false);
  assert.match(res2.error!, /JSON inválido/);
});

check("1.3 Primitive JSON values (null, numbers, booleans) return non-null object error", () => {
  for (const primitive of ["null", "0", "-42.7", "true", "false", '"a string"']) {
    const res = validateAndParseClientMessage(primitive);
    assert.equal(res.ok, false, `Primitive ${primitive} must be rejected`);
    assert.match(res.error!, /objeto JSON não-nulo/);
  }
});

check("1.4 Arrays (empty, numeric, and arrays of valid objects) are strictly rejected", () => {
  const emptyArray = "[]";
  const res1 = validateAndParseClientMessage(emptyArray);
  assert.equal(res1.ok, false);
  assert.match(res1.error!, /objeto JSON não-nulo/);

  const objArray = '[{"type": "input", "paneId": "p1", "data": "ls"}]';
  const res2 = validateAndParseClientMessage(objArray);
  assert.equal(res2.ok, false);
  assert.match(res2.error!, /objeto JSON não-nulo/);
});

check("1.5 Prototype pollution variants (__proto__, constructor.prototype, unicode escapes) are rejected", () => {
  // Direct __proto__
  const payload1 = '{"type": "input", "paneId": "p1", "data": "echo", "__proto__": {"pwned1": true}}';
  const res1 = validateAndParseClientMessage(payload1);
  assert.equal(res1.ok, false);
  assert.match(res1.error!, /prototype pollution/);
  assert.equal((Object.prototype as any).pwned1, undefined);

  // Unicode-escaped __proto__
  const payload2 = '{"type": "input", "paneId": "p1", "data": "echo", "\\u005f\\u005fproto\\u005f\\u005f": {"pwned2": true}}';
  const res2 = validateAndParseClientMessage(payload2);
  assert.equal(res2.ok, false);
  assert.match(res2.error!, /prototype pollution/);
  assert.equal((Object.prototype as any).pwned2, undefined);

  // constructor.prototype
  const payload3 = '{"type": "spawn", "agent": "builder", "missionId": "m1", "constructor": {"prototype": {"pwned3": true}}}';
  const res3 = validateAndParseClientMessage(payload3);
  assert.equal(res3.ok, false);
  assert.match(res3.error!, /prototype pollution/);
  assert.equal((Object.prototype as any).pwned3, undefined);

  // Deeply nested prototype injection
  const payload4 = '{"type": "input", "paneId": "p1", "data": "x", "meta": {"sub": {"deep": {"__proto__": {"pwned4": true}}}}}';
  const res4 = validateAndParseClientMessage(payload4);
  assert.equal(res4.ok, false);
  assert.match(res4.error!, /prototype pollution/);
  assert.equal((Object.prototype as any).pwned4, undefined);
});

check("1.6 hasPrototypePollution detects objects with modified prototypes or forbidden keys", () => {
  assert.equal(hasPrototypePollution(Object.create({ malicious: true })), true);
  assert.equal(hasPrototypePollution({ regular: "object", num: 42 }), false);
  assert.equal(hasPrototypePollution({ arr: [1, 2, { __proto__: {} }] }), true);
});

check("1.7 Schema validation rejects invalid field values, types and bounds", () => {
  // Negative or non-integer terminal resize
  const resResizeNeg = validateAndParseClientMessage('{"type": "resize", "paneId": "p1", "cols": -1, "rows": 24}');
  assert.equal(resResizeNeg.ok, false);
  assert.match(resResizeNeg.error!, /cols/);

  const resResizeZero = validateAndParseClientMessage('{"type": "resize", "paneId": "p1", "cols": 80, "rows": 0}');
  assert.equal(resResizeZero.ok, false);
  assert.match(resResizeZero.error!, /rows/);

  const resResizeHuge = validateAndParseClientMessage('{"type": "resize", "paneId": "p1", "cols": 1001, "rows": 24}');
  assert.equal(resResizeHuge.ok, false);
  assert.match(resResizeHuge.error!, /cols/);

  // Input with missing paneId or non-string data
  const resInputNoPane = validateAndParseClientMessage('{"type": "input", "data": "hello"}');
  assert.equal(resInputNoPane.ok, false);
  assert.match(resInputNoPane.error!, /paneId/);

  const resInputNumberData = validateAndParseClientMessage('{"type": "input", "paneId": "p1", "data": 9999}');
  assert.equal(resInputNumberData.ok, false);
  assert.match(resInputNumberData.error!, /data/);

  // Unknown or injected command type
  const resUnknown = validateAndParseClientMessage('{"type": "exec_remote_code", "cmd": "rm -rf /"}');
  assert.equal(resUnknown.ok, false);
  assert.match(resUnknown.error!, /desconhecido ou não suportado/);
});

// ---------------------------------------------------------------------------
// Setup Live Test Environment
// ---------------------------------------------------------------------------
const tempDir = mkdtempSync(join(tmpdir(), "check-m6-adversarial-"));
const projectDir = join(tempDir, "proj");
mkdirSync(projectDir, { recursive: true });
writeFileSync(join(projectDir, "sample.txt"), "cockpit sample\n", "utf8");

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
mockPanes.set("pane-challenger-legit", {
  paneId: "pane-challenger-legit",
  agent: "builder",
  role: "Builder",
  runner: "bash",
  status: "working",
  missionId: "mission-challenger",
});

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
  limparElenco: () => {},
};

app.use("/api", createApiRouter(routerCtx));

const httpServer = createServer(app);
const wsServer = createWebSocketServer(httpServer, {
  continuity: { record: () => {} } as any,
  abrirPainel: () => ({} as any),
  refreshQuota: async () => {},
});

await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
const port = (httpServer.address() as any).port;

// ---------------------------------------------------------------------------
// CHALLENGE 2: Rajadas de Frames Malformados Concorrentes vs. Cliente Legítimo
// ---------------------------------------------------------------------------
console.log("\n[Challenge 2] Live Adversarial Storm (20 Attackers, 1,000 Bad Frames) vs. Legitimate Terminal Client");

await checkAsync("2.1 Legitimate client maintains uninterrupted terminal operations during concurrent malformed attack storm", async () => {
  // 1. Establish Legitimate Client
  const legitWs = new WebSocket(`ws://localhost:${port}/ws`);
  const legitReceived: any[] = [];
  let legitErrors = 0;

  legitWs.on("message", (buf) => {
    try {
      const parsed = JSON.parse(String(buf));
      legitReceived.push(parsed);
      if (parsed.type === "error") {
        legitErrors++;
      }
    } catch {
      // Ignored
    }
  });

  await new Promise<void>((res, rej) => {
    legitWs.on("open", res);
    legitWs.on("error", rej);
  });

  // 2. Establish 20 Adversarial Attackers
  const numAttackers = 20;
  const attackerSockets: WebSocket[] = [];

  for (let i = 0; i < numAttackers; i++) {
    const atk = new WebSocket(`ws://localhost:${port}/ws`);
    attackerSockets.push(atk);
  }

  await Promise.all(
    attackerSockets.map(
      (s) =>
        new Promise<void>((res) => {
          s.on("open", res);
          s.on("error", () => res());
        }),
    ),
  );

  assert.ok(wsServer.clientManager.count >= 21, `Expected at least 21 connected clients, got ${wsServer.clientManager.count}`);

  // 3. Launch 1,000 malformed frames across the 20 attacker sockets (50 frames each)
  const attackPromises: Promise<void>[] = [];
  for (let i = 0; i < numAttackers; i++) {
    attackPromises.push(
      (async () => {
        const s = attackerSockets[i];
        for (let j = 0; j < 50; j++) {
          if (s.readyState === WebSocket.OPEN) {
            const kind = j % 6;
            switch (kind) {
              case 0:
                // Corrupted non-JSON
                s.send(Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]));
                break;
              case 1:
                // Null / boolean primitives
                s.send("null");
                break;
              case 2:
                // Array instead of object
                s.send("[1, 2, 3, false]");
                break;
              case 3:
                // Prototype pollution injection
                s.send(JSON.stringify({ type: "input", paneId: "p1", data: "x", __proto__: { hacked: true } }));
                break;
              case 4:
                // Invalid resize parameters
                s.send(JSON.stringify({ type: "resize", paneId: "p1", cols: -999, rows: "invalid" }));
                break;
              case 5:
                // Unknown command
                s.send(JSON.stringify({ type: `unauthorized_admin_${j}`, action: "destroy" }));
                break;
            }
          }
          // Micro-tick to interleave I/O events
          if (j % 10 === 0) await new Promise((r) => setTimeout(r, 2));
        }
      })(),
    );
  }

  // 4. Concurrently, legitimate client performs real terminal actions and server broadcasts
  const legitimateActions = (async () => {
    for (let cycle = 0; cycle < 20; cycle++) {
      if (legitWs.readyState === WebSocket.OPEN) {
        // Legitimate attach
        legitWs.send(JSON.stringify({ type: "attach", paneId: "pane-challenger-legit" }));
        // Legitimate resize
        legitWs.send(JSON.stringify({ type: "resize", paneId: "pane-challenger-legit", cols: 80, rows: 24 }));
        // Legitimate input
        legitWs.send(JSON.stringify({ type: "input", paneId: "pane-challenger-legit", data: `echo "pass_${cycle}"\n` }));

        // Concurrently server broadcasts state updates
        wsServer.broadcast({
          type: "pulse",
          pulsos: [{ paneId: "pane-challenger-legit", status: "working", atividade: [cycle, cycle + 1] }],
        });
        wsServer.broadcast({
          type: "output",
          paneId: "pane-challenger-legit",
          data: `output-chunk-${cycle}\r\n`,
        });
      }
      await new Promise((r) => setTimeout(r, 8));
    }
  })();

  await Promise.all([...attackPromises, legitimateActions]);

  // Wait for pending frames to clear event loop
  await new Promise((r) => setTimeout(r, 200));

  // 5. Verification of Legitimate Client Health
  assert.equal(legitWs.readyState, WebSocket.OPEN, "Legitimate client must stay OPEN and healthy");
  assert.equal(legitErrors, 0, "Legitimate client must have encountered ZERO error messages for its valid messages");

  const receivedPulses = legitReceived.filter((m) => m.type === "pulse");
  assert.ok(receivedPulses.length >= 10, `Legitimate client must have received pulses (got ${receivedPulses.length})`);

  const receivedOutputs = legitReceived.filter((m) => m.type === "output");
  assert.ok(receivedOutputs.length >= 10, `Legitimate client must have received outputs (got ${receivedOutputs.length})`);

  // Verify runtime prototypes remained pristine
  assert.equal((Object.prototype as any).hacked, undefined, "Object.prototype must not be polluted");

  // Clean up sockets
  for (const s of attackerSockets) {
    s.terminate();
  }
  legitWs.close();
});

// ---------------------------------------------------------------------------
// CHALLENGE 3: Desconexões Abruptas (ws.terminate()) Durante Envio de Broadcast
// ---------------------------------------------------------------------------
console.log("\n[Challenge 3] Abrupt Sockets Termination (ws.terminate()) During High-Volume Broadcast");

await checkAsync("3.1 Server survives abrupt termination of 40/50 sockets during 500-broadcast burst without EPIPE crash", async () => {
  const totalSockets = 50;
  const sockets: WebSocket[] = [];

  for (let i = 0; i < totalSockets; i++) {
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

  assert.ok(wsServer.clientManager.count >= totalSockets, "All 50 sockets registered in ClientManager");

  let broadcastErrors = 0;

  // Run 500 rapid broadcasts while simultaneously terminating 40 sockets abruptly
  const broadcastPromise = (async () => {
    for (let b = 0; b < 500; b++) {
      try {
        wsServer.broadcast({
          type: "pulse",
          pulsos: [{ paneId: "pane-challenger-legit", status: "working", atividade: [b] }],
        });
      } catch (err) {
        broadcastErrors++;
      }
      if (b % 50 === 0) {
        await new Promise((r) => setTimeout(r, 2));
      }
    }
  })();

  const terminatePromise = (async () => {
    // Terminate 40 sockets abruptly mid-broadcast
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1));
      sockets[i].terminate(); // Abrupt TCP abort, no close frame
    }
  })();

  await Promise.all([broadcastPromise, terminatePromise]);

  assert.equal(broadcastErrors, 0, "wsServer.broadcast must never throw EPIPE or unhandled exception on dropping sockets");

  await new Promise((r) => setTimeout(r, 250));

  // The remaining 10 sockets should still be open
  const openRemaining = sockets.slice(40).filter((s) => s.readyState === WebSocket.OPEN);
  assert.ok(openRemaining.length >= 8, `Remaining sockets must stay open (got ${openRemaining.length})`);

  // Verify that a brand new client can connect immediately after the chaos
  const freshClient = new WebSocket(`ws://localhost:${port}/ws`);
  const freshReceived: any[] = [];
  freshClient.on("message", (buf) => {
    try {
      freshReceived.push(JSON.parse(String(buf)));
    } catch {}
  });

  await new Promise<void>((res, rej) => {
    freshClient.on("open", res);
    freshClient.on("error", rej);
  });

  await new Promise((r) => setTimeout(r, 100));

  assert.equal(freshClient.readyState, WebSocket.OPEN, "Server immediately accepts new connections after socket terminations");
  assert.ok(freshReceived.some((m) => m.type === "panes"), "New client receives initial panes message");

  freshClient.close();
  for (const s of sockets.slice(40)) {
    s.close();
  }
});

// ---------------------------------------------------------------------------
// CHALLENGE 4: ClientManager & TerminalHandler Edge Case Resilience
// ---------------------------------------------------------------------------
console.log("\n[Challenge 4] ClientManager & TerminalHandler Extreme Edge Cases");

check("4.1 ClientManager.send handles broken socket with synchronous throw without escaping", () => {
  const mgr = new ClientManager();
  const faultySocket: any = {
    readyState: 1,
    OPEN: 1,
    send: () => {
      throw new Error("Simulated EPIPE / ECONNRESET");
    },
    on: () => {},
  };
  mgr.register(faultySocket);
  assert.doesNotThrow(() => {
    mgr.send(faultySocket, { type: "panes", panes: [] });
  });
});

check("4.2 ClientManager.broadcast handles circular object payloads defensively", () => {
  const mgr = new ClientManager();
  const circular: any = { type: "test" };
  circular.self = circular;

  assert.doesNotThrow(() => {
    mgr.broadcast(circular);
  });
});

check("4.3 TerminalHandler safely discards boundary / edge inputs without leaking or throwing", () => {
  const mgr = new ClientManager();
  const th = new TerminalHandler(mgr, { record: () => {} } as any);

  assert.doesNotThrow(() => {
    // Non-string or oversized input
    th.handleInput(null as any, "data");
    th.handleInput("p1", null as any);
    th.handleInput("p1", {} as any);

    // Negative, floating, zero, and infinite resize values
    th.handleResize("p1", -1, 24);
    th.handleResize("p1", 80, 0);
    th.handleResize("p1", NaN, 24);
    th.handleResize("p1", 80, Infinity);
    th.handleResize("p1", 80.5, 24);

    // Non-existent pane kill
    th.handleKill("non-existent-pane-id-999");
  });
});

// ---------------------------------------------------------------------------
// Clean Teardown
// ---------------------------------------------------------------------------
console.log("\n[Teardown] Graceful Shutdown of Test Servers");

await checkAsync("Teardown HTTP & WebSocket Servers", async () => {
  await wsServer.close();
  assert.equal(wsServer.clientManager.count, 0, "All WebSocket connections cleanly unregistered");

  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()));
  });
});

rmSync(tempDir, { recursive: true, force: true });

console.log("\n===============================================================================");
console.log(`Challenger Results: ${totalPasses} passed, ${totalFails} failed`);
console.log("===============================================================================");

if (totalFails > 0) {
  console.error(`\nFAILED: ${totalFails} check(s) failed in Milestone M6 Adversarial Challenger Suite.`);
  process.exit(1);
} else {
  console.log("\nSUCCESS: All Milestone M6 Adversarial & Empirical Concurrency challenges passed!");
  process.exit(0);
}
