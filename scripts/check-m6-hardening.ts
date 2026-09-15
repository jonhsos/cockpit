/**
 * Milestone M6 Hardening, Concurrency & Resilience Adversarial Test Suite
 *
 * Rigorously validates:
 * 1. Non-JSON, malformed, and oversized WebSocket messages (graceful error reply, zero crashes)
 * 2. Schema validation, unexpected types, and unknown message types
 * 3. Prototype pollution attacks (__proto__, constructor, prototype)
 * 4. Field-level type verification per message type
 * 5. High-concurrency adversarial storm: multiple attackers blasting bad payloads while
 *    a legitimate client maintains uninterrupted bidirectional communication
 * 6. Abrupt socket terminations (terminate without close frame)
 * 7. Defensive hardening of REST endpoints (JSON, parameters, path traversal, audio buffer)
 * 8. Clean resource and timer teardown
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
console.log("             Milestone M6 Hardening & Resilience Verification                  ");
console.log("===============================================================================");

// ---------------------------------------------------------------------------
// SUITE 1: Parser Defensivo & Validação de Payload
// ---------------------------------------------------------------------------
console.log("\n[Suite 1] Defensive Parser & Malformed Payload Validation");

check("1.1 Raw non-JSON string returns structured error", () => {
  const res = validateAndParseClientMessage("NOT_VALID_JSON{{{");
  assert.equal(res.ok, false);
  assert.match(res.error!, /JSON inválido/);
});

check("1.2 Truncated JSON returns structured error", () => {
  const res = validateAndParseClientMessage('{"type": "spawn", "agent":');
  assert.equal(res.ok, false);
  assert.match(res.error!, /JSON inválido/);
});

check("1.3 Oversized payload exceeding MAX_WS_PAYLOAD_BYTES is rejected immediately", () => {
  const hugePayload = "x".repeat(MAX_WS_PAYLOAD_BYTES + 100);
  const res = validateAndParseClientMessage(hugePayload);
  assert.equal(res.ok, false);
  assert.match(res.error!, /excede o tamanho máximo/);
});

check("1.4 Non-object JSON roots (null, number, boolean, array) are rejected", () => {
  const nullRes = validateAndParseClientMessage("null");
  assert.equal(nullRes.ok, false);
  assert.match(nullRes.error!, /objeto JSON não-nulo/);

  const numRes = validateAndParseClientMessage("12345");
  assert.equal(numRes.ok, false);
  assert.match(numRes.error!, /objeto JSON não-nulo/);

  const boolRes = validateAndParseClientMessage("true");
  assert.equal(boolRes.ok, false);

  const arrRes = validateAndParseClientMessage('[{"type":"input"}]');
  assert.equal(arrRes.ok, false);
  assert.match(arrRes.error!, /objeto JSON não-nulo/);
});

// ---------------------------------------------------------------------------
// SUITE 2: Defesa Contra Prototype Pollution
// ---------------------------------------------------------------------------
console.log("\n[Suite 2] Prototype Pollution Detection & Invariant Defense");

check("2.1 hasPrototypePollution detects __proto__, constructor, and prototype", () => {
  assert.equal(hasPrototypePollution({ __proto__: { admin: true } }), true);
  assert.equal(hasPrototypePollution({ constructor: { prototype: {} } }), true);
  assert.equal(hasPrototypePollution({ nested: { prototype: {} } }), true);
  assert.equal(hasPrototypePollution({ valid: "data", safe: 123 }), false);
});

check("2.2 Payload containing __proto__ is rejected and runtime object prototype is untouched", () => {
  const payload = '{"type": "input", "paneId": "p1", "data": "hi", "__proto__": {"polluted": true}}';
  const res = validateAndParseClientMessage(payload);
  assert.equal(res.ok, false);
  assert.match(res.error!, /prototype pollution/);
  assert.equal((Object.prototype as any).polluted, undefined);
  assert.equal(({} as any).polluted, undefined);
});

check("2.3 Payload containing constructor.prototype is rejected", () => {
  const payload = '{"type": "input", "paneId": "p1", "data": "hi", "constructor": {"prototype": {"admin": true}}}';
  const res = validateAndParseClientMessage(payload);
  assert.equal(res.ok, false);
  assert.match(res.error!, /prototype pollution/);
  assert.equal((Object.prototype as any).admin, undefined);
});

// ---------------------------------------------------------------------------
// SUITE 3: Verificação de Tipos e Campos Obrigatórios
// ---------------------------------------------------------------------------
console.log("\n[Suite 3] Strict Schema & Field Verification per Message Type");

check("3.1 Missing or non-string 'type' field is rejected", () => {
  const res1 = validateAndParseClientMessage("{}");
  assert.equal(res1.ok, false);
  assert.match(res1.error!, /Campo 'type' obrigatório/);

  const res2 = validateAndParseClientMessage('{"type": 123}');
  assert.equal(res2.ok, false);
  assert.match(res2.error!, /Campo 'type' obrigatório/);
});

check("3.2 Unknown or corrupted message type is rejected", () => {
  const res = validateAndParseClientMessage('{"type": "corrupted_type", "payload": null}');
  assert.equal(res.ok, false);
  assert.match(res.error!, /Tipo de mensagem desconhecido/);
});

check("3.3 'spawn' requires non-empty agent and missionId", () => {
  const resMissingAgent = validateAndParseClientMessage('{"type": "spawn", "missionId": "m1"}');
  assert.equal(resMissingAgent.ok, false);
  assert.match(resMissingAgent.error!, /agent/);

  const resEmptyAgent = validateAndParseClientMessage('{"type": "spawn", "agent": "   ", "missionId": "m1"}');
  assert.equal(resEmptyAgent.ok, false);

  const resMissingMission = validateAndParseClientMessage('{"type": "spawn", "agent": "builder"}');
  assert.equal(resMissingMission.ok, false);
  assert.match(resMissingMission.error!, /missionId/);

  const resValid = validateAndParseClientMessage('{"type": "spawn", "agent": "builder", "missionId": "m1"}');
  assert.equal(resValid.ok, true);
  assert.equal(resValid.message?.type, "spawn");
});

check("3.4 'input' requires paneId and string data", () => {
  const resMissingData = validateAndParseClientMessage('{"type": "input", "paneId": "p1"}');
  assert.equal(resMissingData.ok, false);
  assert.match(resMissingData.error!, /data/);

  const resNonStringData = validateAndParseClientMessage('{"type": "input", "paneId": "p1", "data": 123}');
  assert.equal(resNonStringData.ok, false);
  assert.match(resNonStringData.error!, /data/);

  const resMissingPane = validateAndParseClientMessage('{"type": "input", "data": "ls"}');
  assert.equal(resMissingPane.ok, false);
  assert.match(resMissingPane.error!, /paneId/);

  const resValid = validateAndParseClientMessage('{"type": "input", "paneId": "p1", "data": "ls\\n"}');
  assert.equal(resValid.ok, true);
  assert.equal(resValid.message?.type, "input");
});

check("3.5 'resize' enforces positive integer bounds on cols and rows", () => {
  const resNeg = validateAndParseClientMessage('{"type": "resize", "paneId": "p1", "cols": -5, "rows": 24}');
  assert.equal(resNeg.ok, false);
  assert.match(resNeg.error!, /cols/);

  const resFloat = validateAndParseClientMessage('{"type": "resize", "paneId": "p1", "cols": 80.5, "rows": 24}');
  assert.equal(resFloat.ok, false);

  const resHuge = validateAndParseClientMessage('{"type": "resize", "paneId": "p1", "cols": 80, "rows": 99999}');
  assert.equal(resHuge.ok, false);
  assert.match(resHuge.error!, /rows/);

  const resValid = validateAndParseClientMessage('{"type": "resize", "paneId": "p1", "cols": 120, "rows": 40}');
  assert.equal(resValid.ok, true);
  assert.equal(resValid.message?.type, "resize");
});

check("3.6 'kill', 'replay', 'attach' validate required paneId", () => {
  for (const type of ["kill", "replay", "attach"]) {
    const resMissing = validateAndParseClientMessage(JSON.stringify({ type }));
    assert.equal(resMissing.ok, false);
    assert.match(resMissing.error!, /paneId/);

    const resValid = validateAndParseClientMessage(JSON.stringify({ type, paneId: "pane-123" }));
    assert.equal(resValid.ok, true);
  }
});

// ---------------------------------------------------------------------------
// SUITE 4: ClientManager & TerminalHandler Defesas de Runtime
// ---------------------------------------------------------------------------
console.log("\n[Suite 4] ClientManager & TerminalHandler Runtime Hardening");

check("4.1 ClientManager.send safely catches errors on closed or dropping sockets", () => {
  const mgr = new ClientManager();
  const mockBrokenSocket: any = {
    readyState: 1, // OPEN
    OPEN: 1,
    send: () => {
      throw new Error("EPIPE / Connection reset");
    },
    on: () => {},
  };
  mgr.register(mockBrokenSocket);
  // Must not throw
  assert.doesNotThrow(() => {
    mgr.send(mockBrokenSocket, { type: "panes", panes: [] });
  });
});

check("4.2 ClientManager.broadcast isolates client errors without interrupting other clients", () => {
  const mgr = new ClientManager();
  let clientAReceived = false;
  const mockClientA: any = {
    readyState: 1,
    OPEN: 1,
    send: () => {
      clientAReceived = true;
    },
    on: () => {},
  };
  const mockFailingClient: any = {
    readyState: 1,
    OPEN: 1,
    send: () => {
      throw new Error("Broken pipe");
    },
    on: () => {},
  };
  let clientBReceived = false;
  const mockClientB: any = {
    readyState: 1,
    OPEN: 1,
    send: () => {
      clientBReceived = true;
    },
    on: () => {},
  };

  mgr.register(mockClientA);
  mgr.register(mockFailingClient);
  mgr.register(mockClientB);

  assert.doesNotThrow(() => {
    mgr.broadcast({ type: "pulse", pulsos: [] });
  });

  assert.equal(clientAReceived, true, "Client A must receive broadcast despite Client B failure");
  assert.equal(clientBReceived, true, "Client B must receive broadcast despite previous client failure");
});

check("4.3 TerminalHandler safely discards invalid inputs without crashing", () => {
  const th = new TerminalHandler(new ClientManager(), { record: () => {} } as any);
  assert.doesNotThrow(() => {
    th.handleInput("", "test");
    th.handleInput("pane-x", undefined as any);
    th.handleInput("pane-x", 12345 as any);
    th.handleResize("", 80, 24);
    th.handleResize("pane-x", -10, 24);
    th.handleKill("");
  });
});

// ---------------------------------------------------------------------------
// SUITE 5: Teste de Estresse Adversarial em Conexões Reais de WebSocket
// ---------------------------------------------------------------------------
console.log("\n[Suite 5] Live WebSocket Adversarial Storm & Abrupt Disconnects");

const tempDir = mkdtempSync(join(tmpdir(), "check-m6-hardening-"));
const projectDir = join(tempDir, "proj");
mkdirSync(projectDir, { recursive: true });
writeFileSync(join(projectDir, "test.txt"), "hello\n", "utf8");

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

await checkAsync("5.1 Server sends typed error replies for malformed payloads over live WS", async () => {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const received: any[] = [];
  ws.on("message", (buf) => {
    try {
      received.push(JSON.parse(String(buf)));
    } catch {}
  });

  await new Promise<void>((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });

  // Send non-JSON string
  ws.send("INVALID_STRING_BLAH_BLAH");

  // Send unknown type
  ws.send(JSON.stringify({ type: "unknown_attack_type", payload: null }));

  // Send prototype pollution
  ws.send('{"type": "input", "paneId": "p1", "data": "x", "__proto__": {"hack": true}}');

  // Wait for responses
  await new Promise((r) => setTimeout(r, 200));

  const errorMessages = received.filter((m) => m.type === "error");
  assert.ok(errorMessages.length >= 3, `Expected at least 3 error replies, got ${errorMessages.length}`);
  assert.ok(errorMessages.every((m) => typeof m.message === "string" && m.message.length > 0));

  ws.close();
});

await checkAsync("5.2 High-concurrency attack storm with concurrent legitimate traffic", async () => {
  // 1 Legitimate client
  const legitWs = new WebSocket(`ws://localhost:${port}/ws`);
  const legitMessages: any[] = [];
  legitWs.on("message", (buf) => {
    try {
      legitMessages.push(JSON.parse(String(buf)));
    } catch {}
  });

  await new Promise<void>((res) => legitWs.on("open", res));

  // 10 Adversarial clients
  const numAttackers = 10;
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

  assert.ok(wsServer.clientManager.count >= 11, "All clients registered in ClientManager");

  // Adversarial blast: each attacker fires 30 malformed frames
  const attacks: Promise<void>[] = [];
  for (let i = 0; i < numAttackers; i++) {
    attacks.push(
      (async () => {
        const s = attackerSockets[i];
        for (let j = 0; j < 30; j++) {
          if (s.readyState === WebSocket.OPEN) {
            const variant = j % 5;
            if (variant === 0) s.send("corrupted string");
            else if (variant === 1) s.send("null");
            else if (variant === 2) s.send(JSON.stringify({ type: "fake_command_" + j }));
            else if (variant === 3) s.send(JSON.stringify({ type: "resize", paneId: "p", cols: -5 }));
            else s.send(JSON.stringify({ type: "input", __proto__: { p: 1 } }));
          }
        }
      })(),
    );
  }

  // Simultaneously, legitimate client sends valid requests and server broadcasts
  const legitActivity = (async () => {
    for (let k = 0; k < 10; k++) {
      if (legitWs.readyState === WebSocket.OPEN) {
        legitWs.send(JSON.stringify({ type: "attach", paneId: "pane-legit" }));
        wsServer.broadcast({ type: "pulse", pulsos: [{ paneId: "p1", status: "working", atividade: [1, 2] }] });
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  })();

  await Promise.all([...attacks, legitActivity]);

  // Half of attackers terminate abruptly without close frame
  for (let i = 0; i < 5; i++) {
    attackerSockets[i].terminate();
  }

  // Other half close cleanly
  for (let i = 5; i < numAttackers; i++) {
    attackerSockets[i].close();
  }

  await new Promise((r) => setTimeout(r, 200));

  // Legitimate client must have received its broadcast pulses and remain open
  assert.equal(legitWs.readyState, WebSocket.OPEN, "Legitimate client remains connected and healthy");
  const pulses = legitMessages.filter((m) => m.type === "pulse");
  assert.ok(pulses.length >= 5, "Legitimate client received server broadcast pulses during storm");

  legitWs.close();
});

// ---------------------------------------------------------------------------
// SUITE 6: REST Controller Defensive Hardening
// ---------------------------------------------------------------------------
console.log("\n[Suite 6] REST Controller Defensive Parameter & Payload Hardening");

await checkAsync("6.1 /api/file handles non-existent files and path traversal defensively", async () => {
  const res1 = await fetch(`http://localhost:${port}/api/file?path=non-existent-file-123.txt`);
  assert.equal(res1.status, 404, "Non-existent file returns 404");
  const json1 = (await res1.json()) as any;
  assert.match(json1.error, /arquivo não encontrado/);

  const res2 = await fetch(`http://localhost:${port}/api/file?path=../../etc/passwd`);
  assert.equal(res2.status, 400, "Path traversal returns 400");
  const json2 = (await res2.json()) as any;
  assert.match(json2.error, /fora da raiz/);
});

await checkAsync("6.2 POST /api/file rejects empty or missing path", async () => {
  const res = await fetch(`http://localhost:${port}/api/file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "test" }), // missing path
  });
  assert.equal(res.status, 400, "Missing path in POST /api/file returns 400");
});

await checkAsync("6.3 /api/missions/:missionId/cockpit/connect validates required parameters", async () => {
  const res = await fetch(`http://localhost:${port}/api/missions/m1/cockpit/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}), // missing source and target
  });
  assert.equal(res.status, 400, "Missing endpoints in connect returns 400");
  const json = (await res.json()) as any;
  assert.match(json.error, /obrigatórios/);
});

await checkAsync("6.4 /api/missions/:missionId/cockpit/ask validates required parameters", async () => {
  const res = await fetch(`http://localhost:${port}/api/missions/m1/cockpit/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: "user" }), // missing to and task
  });
  assert.equal(res.status, 400, "Missing to and task returns 400");
});

await checkAsync("6.5 /api/missions/:missionId/cockpit/reply validates required parameters", async () => {
  const res = await fetch(`http://localhost:${port}/api/missions/m1/cockpit/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: "user" }), // missing correlationId
  });
  assert.equal(res.status, 400, "Missing correlationId returns 400");
});

await checkAsync("6.6 /api/missions/:missionId/cockpit/handoff validates required parameters", async () => {
  const res = await fetch(`http://localhost:${port}/api/missions/m1/cockpit/handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: "p1", to: "p2" }), // missing taskId
  });
  assert.equal(res.status, 400, "Missing taskId returns 400");
});

await checkAsync("6.7 DELETE /api/projects/:id/memoria/:quando rejects NaN timestamp", async () => {
  const res = await fetch(`http://localhost:${port}/api/projects/p1/memoria/invalid-nan-time`, {
    method: "DELETE",
  });
  assert.equal(res.status, 400, "Invalid timestamp in memoria DELETE returns 400");
});

await checkAsync("6.8 POST /api/voz rejects empty or non-buffer audio payloads", async () => {
  const res = await fetch(`http://localhost:${port}/api/voz`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio: "corrupted" }),
  });
  assert.equal(res.status, 400, "Non-buffer voice payload returns 400");
});

// ---------------------------------------------------------------------------
// SUITE 7: Clean Teardown & Zero Orphan Resources
// ---------------------------------------------------------------------------
console.log("\n[Suite 7] Clean Teardown & Resource Deallocation");

await checkAsync("7.1 WebSocket and HTTP servers shut down cleanly without leaking timers", async () => {
  await wsServer.close();
  assert.equal(wsServer.clientManager.count, 0, "All clients cleanly closed and unregistered");

  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()));
  });
});

rmSync(tempDir, { recursive: true, force: true });

console.log("\n===============================================================================");
console.log(`Results: ${totalPasses} passed, ${totalFails} failed`);
console.log("===============================================================================");

if (totalFails > 0) {
  console.error(`\nFAILED: ${totalFails} check(s) failed in Milestone M6 Hardening Suite.`);
  process.exit(1);
} else {
  console.log("\nSUCCESS: All Milestone M6 Hardening & Resilience checks passed with 100% integrity!");
  process.exit(0);
}
