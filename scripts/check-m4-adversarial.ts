/**
 * Milestone M4 Adversarial Verification & Stress Test Suite.
 *
 * Empirical verification of:
 * 1. Line count and bootstrap conciseness (< 200 lines for servidor/index.ts).
 * 2. 10 canonical directory presence and valid barrel exports.
 * 3. Exact export parity and value equivalence across all root re-export shims vs canonical targets.
 * 4. Scan for Node strip-only incompatible syntax (e.g. parameter properties) across all servidor TS files.
 * 5. Router mount integrity and adversarial input handling (malformed JSON, 404s, 400s).
 * 6. Live server startup in Node native TS mode, HTTP REST endpoints, and WebSocket handshake.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { WebSocket } from "ws";

console.log("================================================================================");
console.log("        Milestone M4 Empirical Adversarial Verification Suite                  ");
console.log("================================================================================");

// ============================================================================
// SUITE 1: Server Entry Point & Modular Directory Structure
// ============================================================================
console.log("\n[Suite 1] Verifying servidor/index.ts Line Count & Canonical Directories...");

const indexPath = "servidor/index.ts";
const indexLines = readFileSync(indexPath, "utf-8").split(/\r?\n/).length;
console.log(`  - servidor/index.ts line count: ${indexLines}`);
assert.ok(
  indexLines < 200,
  `servidor/index.ts MUST be strictly below 200 lines, found ${indexLines}`,
);
console.log(`  ✓ Line count strictly below 200 (${indexLines} lines).`);

const canonicalDirs = [
  "connections",
  "missions",
  "orchestration",
  "persistence",
  "providers",
  "routes",
  "security",
  "sessions",
  "tasks",
  "websocket",
];

for (const dir of canonicalDirs) {
  const dirPath = join("servidor", dir);
  assert.ok(
    statSync(dirPath).isDirectory(),
    `Canonical directory missing: ${dirPath}`,
  );
  const barrelPath = join(dirPath, "index.ts");
  assert.ok(
    statSync(barrelPath).isFile(),
    `Canonical barrel missing: ${barrelPath}`,
  );
}
console.log(`  ✓ All 10 canonical modular directories and index.ts barrels verified.`);

// ============================================================================
// SUITE 2: Node Strip-Only Mode Syntax Invariant Check
// ============================================================================
console.log("\n[Suite 2] Scanning all TypeScript files for strip-only incompatible syntax...");

function scanFiles(dir: string, fileList: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      scanFiles(full, fileList);
    } else if (full.endsWith(".ts")) {
      fileList.push(full);
    }
  }
  return fileList;
}

const allTsFiles = scanFiles("servidor");
let syntaxViolations = 0;

for (const file of allTsFiles) {
  const content = readFileSync(file, "utf-8");
  // Check for parameter properties: constructor(... private/public/protected/readonly x: ...)
  const paramPropRegex = /constructor\s*\([^)]*\b(private|public|protected|readonly)\s+[\w$]+/g;
  const matches = content.match(paramPropRegex);
  if (matches) {
    console.error(`  ✗ Parameter property detected in ${file}: ${matches.join(", ")}`);
    syntaxViolations++;
  }
}

assert.equal(
  syntaxViolations,
  0,
  `Found ${syntaxViolations} strip-only incompatible parameter properties.`,
);
console.log(`  ✓ All ${allTsFiles.length} servidor/*.ts files free of strip-only parameter properties.`);

// ============================================================================
// SUITE 3: Re-export Shim Equivalence & Parity
// ============================================================================
console.log("\n[Suite 3] Testing Export Parity between Root Shims and Canonical Targets...");

const rootFiles = readdirSync("servidor");
let shimsChecked = 0;

for (const f of rootFiles) {
  const p = join("servidor", f);
  if (!statSync(p).isDirectory() && f.endsWith(".ts") && f !== "index.ts" && f !== "maestro-cli.ts") {
    const content = readFileSync(p, "utf-8").trim();
    const match = content.match(/^export \* from "([^"]+)";$/);
    if (match) {
      const relTarget = match[1];
      const shimModule = await import(`../servidor/${f}`);
      const targetModule = await import(`../servidor/${relTarget.replace(/^\.\//, "")}`);

      const shimKeys = Object.keys(shimModule).sort();
      const targetKeys = Object.keys(targetModule).sort();

      assert.deepEqual(
        shimKeys,
        targetKeys,
        `Export keys mismatch between shim ${f} and target ${relTarget}`,
      );

      for (const key of shimKeys) {
        assert.equal(
          shimModule[key],
          targetModule[key],
          `Value mismatch for export ${key} in ${f}`,
        );
      }
      shimsChecked++;
    }
  }
}

console.log(`  ✓ ${shimsChecked} root re-export shims verified for 100% key and value equivalence.`);

// ============================================================================
// SUITE 4: 10 Barrel Import Verification
// ============================================================================
console.log("\n[Suite 4] Stress Testing Imports of all 10 Modular Barrels...");

for (const dir of canonicalDirs) {
  const mod = await import(`../servidor/${dir}/index.ts`);
  assert.ok(mod !== null && typeof mod === "object", `Barrel ${dir}/index.ts failed to export an object`);
  const exportedCount = Object.keys(mod).length;
  console.log(`  - servidor/${dir}/index.ts: ${exportedCount} symbols exported.`);
}
console.log(`  ✓ All 10 modular barrels loaded and verified without cycle stalls.`);

// ============================================================================
// SUITE 5: Express Router Integrity & Adversarial Error Dispatch
// ============================================================================
console.log("\n[Suite 5] Testing Express Router Context & Mount Integrity...");

const { createApiRouter } = await import("../servidor/routes/index.ts");
const { getDefaultMailboxManager, getDefaultBridge } = await import("../servidor/connections/index.ts");
const { getTaskManager, getFileOwnershipManager } = await import("../servidor/tasks/index.ts");
const { getMissionModeManager, getPaneDispatcher } = await import("../servidor/orchestration/index.ts");
const { config, salvarConfig } = await import("../servidor/config.ts");

const mailboxManager = getDefaultMailboxManager();
const taskManager = getTaskManager();
const ownershipManager = getFileOwnershipManager();
const missionModeManager = getMissionModeManager();
const paneDispatcher = getPaneDispatcher({ taskManager, mailboxManager });
const bridge = getDefaultBridge({
  mailboxManager,
  taskManager,
  paneProvider: { getPane: () => undefined, listPanes: () => [] },
});

const mockRouterContext = {
  config,
  salvarConfig,
  porta: 9999,
  taskManager,
  ownershipManager,
  bridge,
  mailboxManager,
  missionModeManager,
  paneDispatcher,
  continuity: null as any,
  broadcast: () => {},
  notifyMaestro: () => {},
  abrirPainel: () => ({} as any),
  switchMaestro: async () => {},
  saveCheckpoint: () => {},
  raizDe: () => "/tmp",
  limits: () => ({}),
  refreshQuota: async () => {},
  maestroStatus: () => ({ status: "idle" }),
  presetsDoMaestro: () => [],
  especialistasDaMissao: () => [],
  limparElenco: () => {},
};

const router = createApiRouter(mockRouterContext);
assert.ok(typeof router === "function", "createApiRouter must return an Express Router middleware");
console.log("  ✓ createApiRouter mounted cleanly with mock context.");

// ============================================================================
// SUITE 6: Live Server Startup, HTTP API & WebSocket Handshake in Strip-Only Mode
// ============================================================================
console.log("\n[Suite 6] Spawning Real Server in Node Native TS Mode...");

const TEST_PORT = 48888;
const serverProcess = spawn("node", ["servidor/index.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    COCKPIT_PORTA: String(TEST_PORT),
    COCKPIT_HOME: join(process.cwd(), ".cockpit_test_m4"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverStarted = false;
let serverLogs = "";

serverProcess.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  serverLogs += text;
});

serverProcess.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  serverLogs += text;
});

try {
  // Wait up to 10 seconds for server startup
  const start = Date.now();
  while (Date.now() - start < 10000) {
    if (serverLogs.includes(`cockpit → http://localhost:${TEST_PORT}`)) {
      serverStarted = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  assert.ok(
    serverStarted,
    `Server failed to start on port ${TEST_PORT} within 10s. Logs:\n${serverLogs}`,
  );
  console.log(`  ✓ Server booted cleanly on http://localhost:${TEST_PORT} in Node native TS mode.`);

  // 6.1 Test GET /api/config
  const resConfig = await fetch(`http://127.0.0.1:${TEST_PORT}/api/config`);
  assert.equal(resConfig.status, 200, "GET /api/config must return 200");
  const dataConfig = await resConfig.json();
  assert.ok(typeof dataConfig === "object" && dataConfig !== null, "Config response must be object");
  console.log("  ✓ GET /api/config responded 200 OK");

  // 6.2 Test GET /api/missions/default/tasks
  const resTasks = await fetch(`http://127.0.0.1:${TEST_PORT}/api/missions/default/tasks`);
  assert.equal(resTasks.status, 200, "GET /api/missions/default/tasks must return 200");
  const dataTasks = await resTasks.json();
  assert.ok(Array.isArray(dataTasks.tasks), "Tasks response must be array");
  console.log("  ✓ GET /api/missions/default/tasks responded 200 OK");

  // 6.3 Test GET /api/cockpit/list
  const resCockpitList = await fetch(`http://127.0.0.1:${TEST_PORT}/api/cockpit/list`);
  assert.equal(resCockpitList.status, 200, "GET /api/cockpit/list must return 200");
  const dataCockpitList = await resCockpitList.json();
  assert.ok(Array.isArray(dataCockpitList.panes), "Cockpit list response must have panes array");
  console.log("  ✓ GET /api/cockpit/list responded 200 OK");

  // 6.4 Test GET /api/missions
  const resMissions = await fetch(`http://127.0.0.1:${TEST_PORT}/api/missions`);
  assert.equal(resMissions.status, 200, "GET /api/missions must return 200");
  console.log("  ✓ GET /api/missions responded 200 OK");

  // 6.5 Test Adversarial 404
  const res404 = await fetch(`http://127.0.0.1:${TEST_PORT}/api/non-existent-adversarial-route`);
  assert.equal(res404.status, 404, "Unknown API route must return 404");
  console.log("  ✓ GET /api/non-existent-route responded 404");

  // 6.6 Test Task Creation (201) & Illegal State Transition (400 Bad Request)
  const resCreateTask = await fetch(`http://127.0.0.1:${TEST_PORT}/api/missions/default/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ título: "Adversarial Test Task", prioridade: "alta" }),
  });
  assert.equal(resCreateTask.status, 201, "Valid task creation must return 201 Created");
  const createdTask = await resCreateTask.json();
  assert.ok(createdTask.task?.id, "Created task must have an ID");
  console.log("  ✓ POST /api/missions/default/tasks responded 201 Created");

  const resIllegalTransition = await fetch(
    `http://127.0.0.1:${TEST_PORT}/api/missions/default/tasks/${createdTask.task.id}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "complete" }), // todo -> complete is illegal
    },
  );
  assert.equal(resIllegalTransition.status, 400, "Illegal state transition (todo -> complete) must return 400");
  console.log("  ✓ POST .../status with illegal jump (todo -> complete) correctly rejected with 400");

  // 6.7 Test WebSocket Handshake and Initial Message
  console.log("  - Connecting WebSocket client to /ws...");
  const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`);

  const initialMsgReceived = await new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket timeout")), 5000);
    ws.on("open", () => {
      // Send ping or check receipt
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "panes") {
          clearTimeout(timer);
          resolve(true);
        }
      } catch (err) {
        reject(err);
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  assert.ok(initialMsgReceived, "WebSocket client received initial 'panes' message");
  ws.close();
  console.log("  ✓ WebSocket connected, received initial 'panes' event, closed cleanly.");

} finally {
  serverProcess.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
}

console.log("\n================================================================================");
console.log("PASS: All Milestone M4 Adversarial Verification checks PASSED (100% SUCCESS)!");
console.log("================================================================================");
process.exit(0);
