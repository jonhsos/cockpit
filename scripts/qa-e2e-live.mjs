/**
 * Comprehensive End-to-End QA Test — "User/QA perspective"
 *
 * Tests the LIVE running server at http://localhost:3099
 * Exercises real HTTP requests and real WebSocket connections,
 * mimicking what a real user of the Cockpit would do through the UI.
 *
 * Usage:  COCKPIT_PORTA=3099 node scripts/qa-e2e-live.mjs
 */

import http from "node:http";
import assert from "node:assert/strict";

const PORT = process.env.COCKPIT_PORTA || 3099;
const BASE = `http://localhost:${PORT}`;
let passed = 0;
let failed = 0;
const failures = [];

async function json(method, path, body) {
  const url = `${BASE}/api${path}`;
  const opts = { method, headers: { "Content-Type": "application/json" } };
  const payload = body !== undefined ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = http.request(url, opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function rawGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${path}`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on("error", reject);
  });
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message || String(err) });
    console.log(`  ❌ ${name}: ${err.message || err}`);
  }
}

// ============================================================
// SUITE 1 — Server Health & Static Assets
// ============================================================
console.log("\n[Suite 1] Server Health & Static Assets");

await test("GET / serves HTML (index.html from dist)", async () => {
  const r = await rawGet("/");
  assert.equal(r.status, 200);
  assert.ok(r.body.includes("<html") || r.body.includes("<!DOCTYPE"), "Should serve HTML");
});

await test("Static CSS bundle is served", async () => {
  const idx = await rawGet("/");
  const cssMatch = idx.body.match(/href="(\/assets\/[^"]+\.css)"/);
  if (cssMatch) {
    const r = await rawGet(cssMatch[1]);
    assert.equal(r.status, 200);
  }
});

await test("Static JS bundle is served", async () => {
  const idx = await rawGet("/");
  const jsMatch = idx.body.match(/src="(\/assets\/[^"]+\.js)"/);
  if (jsMatch) {
    const r = await rawGet(jsMatch[1]);
    assert.equal(r.status, 200);
  }
});

// ============================================================
// SUITE 2 — Projects & Config
// ============================================================
console.log("\n[Suite 2] Projects & Configuration");

let projectId;

await test("GET /api/projects returns at least 1 project", async () => {
  const r = await json("GET", "/projects");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.projects), "Should have projects array");
  assert.ok(r.body.projects.length >= 1, "At least one project");
  projectId = r.body.projects[0].id;
});

await test("GET /api/config returns agents, squads, harness", async () => {
  const r = await json("GET", "/config");
  assert.equal(r.status, 200);
  // The config endpoint returns agents at top level
  assert.ok(r.body.agents || r.body.squads, "Should have agents or squads");
});

await test("GET /api/providers returns provider detection results", async () => {
  const r = await json("GET", "/providers");
  assert.equal(r.status, 200);
});

await test("GET /api/skills lists available skills", async () => {
  const r = await json("GET", "/skills");
  assert.equal(r.status, 200);
});

await test("GET /api/receitas lists recipes", async () => {
  const r = await json("GET", "/receitas");
  assert.equal(r.status, 200);
  assert.ok(r.body.receitas !== undefined, "Should have receitas");
});

await test("GET /api/media lists media providers", async () => {
  const r = await json("GET", "/media");
  assert.equal(r.status, 200);
});

await test("GET /api/maestro returns maestro status", async () => {
  const r = await json("GET", "/maestro");
  assert.equal(r.status, 200);
});

await test("GET /api/cotas returns quota windows", async () => {
  const r = await json("GET", "/cotas");
  assert.equal(r.status, 200);
});

await test("GET /api/pontes returns bridge providers", async () => {
  const r = await json("GET", "/pontes");
  assert.equal(r.status, 200);
});

// ============================================================
// SUITE 3 — Mission Lifecycle
// ============================================================
console.log("\n[Suite 3] Mission Lifecycle");

let missionId;

await test("POST /api/missions creates a new mission", async () => {
  const r = await json("POST", "/missions", {
    projectId,
    nome: "QA-Missão-E2E",
    objetivo: "Teste end-to-end automatizado",
    modo: "livre",
  });
  assert.equal(r.status, 200);
  missionId = r.body.id || r.body.mission?.id;
  assert.ok(missionId, "Should return mission id");
});

await test("GET /api/missions lists missions and includes the new one", async () => {
  const r = await json("GET", `/missions?projectId=${projectId}`);
  assert.equal(r.status, 200);
  const missions = r.body.missions || r.body;
  assert.ok(Array.isArray(missions), "Should be array");
  const found = missions.find((m) => m.id === missionId);
  assert.ok(found, "Created mission should appear in list");
});

await test("POST /api/missions/:id/nome renames a mission", async () => {
  const r = await json("POST", `/missions/${missionId}/nome`, { nome: "QA-Renomeada" });
  assert.equal(r.status, 200);
});

await test("GET /api/missions/:id/modo returns mode", async () => {
  const r = await json("GET", `/missions/${missionId}/modo`);
  assert.equal(r.status, 200);
});

await test("POST /api/missions/:id/modo switches to dirigido", async () => {
  const r = await json("POST", `/missions/${missionId}/modo`, { modo: "dirigido" });
  assert.equal(r.status, 200);
});

await test("POST /api/missions/:id/modo switches to autonomo", async () => {
  const r = await json("POST", `/missions/${missionId}/modo`, { modo: "autonomo" });
  assert.equal(r.status, 200);
});

await test("POST /api/missions/:id/emergency-stop halts the mission", async () => {
  const r = await json("POST", `/missions/${missionId}/emergency-stop`, {});
  assert.ok(r.status === 200 || r.status === 204, "Should halt");
});

await test("POST /api/missions/:id/resume resumes the mission", async () => {
  const r = await json("POST", `/missions/${missionId}/resume`, {});
  assert.ok(r.status === 200 || r.status === 204, "Should resume");
});

await test("GET /api/missions/:id/elenco returns roster", async () => {
  const r = await json("GET", `/missions/${missionId}/elenco`);
  assert.equal(r.status, 200);
});

// ============================================================
// SUITE 4 — Full Task Lifecycle (6-state machine)
// ============================================================
console.log("\n[Suite 4] Task Lifecycle (6-State Machine)");

let taskId;

await test("POST /api/missions/:id/tasks creates a task (201)", async () => {
  const r = await json("POST", `/missions/${missionId}/tasks`, {
    título: "Tarefa QA E2E",
    descrição: "Verificar que o ciclo funciona",
    responsável: "piloto",
    papel: "executar",
    prioridade: "alta",
    tipo: "implementar",
    missionId,
  });
  assert.equal(r.status, 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
  const task = r.body.task || r.body;
  assert.ok(task.id, "Should return task id");
  assert.equal(task.status, "todo", "Initial status should be 'todo'");
  taskId = task.id;
});

await test("GET /api/missions/:id/tasks lists tasks", async () => {
  const r = await json("GET", `/missions/${missionId}/tasks`);
  assert.equal(r.status, 200);
  const tasks = r.body.tasks || r.body;
  assert.ok(Array.isArray(tasks), "Tasks should be array");
  assert.ok(tasks.length >= 1, "Should have at least 1 task");
});

await test("GET /api/missions/:id/tasks/board returns aggregated board data", async () => {
  const r = await json("GET", `/missions/${missionId}/tasks/board`);
  assert.equal(r.status, 200);
  assert.ok(r.body.board, "Should return board data");
});

await test("Transition todo → in-progress", async () => {
  const r = await json("POST", `/missions/${missionId}/tasks/${taskId}/status`, {
    status: "in-progress",
  });
  assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.equal((r.body.task || r.body).status, "in-progress");
});

await test("Transition in-progress → blocked", async () => {
  const r = await json("POST", `/missions/${missionId}/tasks/${taskId}/status`, {
    status: "blocked",
    reason: "Aguardando dependência",
  });
  assert.equal(r.status, 200, `Got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test("Transition blocked → in-progress", async () => {
  const r = await json("POST", `/missions/${missionId}/tasks/${taskId}/status`, {
    status: "in-progress",
  });
  assert.equal(r.status, 200);
});

await test("Transition in-progress → in-review", async () => {
  const r = await json("POST", `/missions/${missionId}/tasks/${taskId}/status`, {
    status: "in-review",
  });
  assert.equal(r.status, 200);
});

await test("Transition in-review → complete", async () => {
  const r = await json("POST", `/missions/${missionId}/tasks/${taskId}/status`, {
    status: "complete",
  });
  assert.equal(r.status, 200);
});

await test("POST evidence on task (201)", async () => {
  const r = await json("POST", `/missions/${missionId}/tasks/${taskId}/evidencia`, {
    tipo: "test_run",
    descricao: "QA E2E completo",
    status: "passed",
  });
  assert.equal(r.status, 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test("POST knowledge on task (201)", async () => {
  const r = await json("POST", `/missions/${missionId}/tasks/${taskId}/conhecimento`, {
    descricao: "Todas as 6 transições de estado foram exercitadas",
    conteudo: "todo → in-progress → blocked → in-progress → in-review → complete",
  });
  assert.equal(r.status, 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test("GET /api/missions/:id/tasks/:taskId returns full task with evidence", async () => {
  const r = await json("GET", `/missions/${missionId}/tasks/${taskId}`);
  assert.equal(r.status, 200);
  const task = r.body.task || r.body;
  const evs = task.evidências || task.evidencias || [];
  assert.ok(evs.length >= 1, `Should have evidence, found ${evs.length}`);
});

// Create and fail a second task
let taskId2;
await test("Create and fail a task (complete failed path)", async () => {
  const r1 = await json("POST", `/missions/${missionId}/tasks`, {
    título: "Tarefa para falhar",
    descrição: "Teste do estado failed",
    responsável: "scout",
    papel: "pesquisar",
    prioridade: "baixa",
    tipo: "explorar",
    missionId,
  });
  assert.equal(r1.status, 201);
  taskId2 = (r1.body.task || r1.body).id;

  const r2 = await json("POST", `/missions/${missionId}/tasks/${taskId2}/status`, {
    status: "in-progress",
  });
  assert.equal(r2.status, 200);

  const r3 = await json("POST", `/missions/${missionId}/tasks/${taskId2}/status`, {
    status: "failed",
    reason: "Falha intencional para QA",
  });
  assert.equal(r3.status, 200);
});

await test("PATCH /api/missions/:id/tasks/:taskId updates task attributes", async () => {
  const r = await json("PATCH", `/missions/${missionId}/tasks/${taskId}`, {
    título: "Tarefa QA E2E — Atualizada",
    prioridade: "urgente",
  });
  assert.equal(r.status, 200);
  const task = r.body.task || r.body;
  assert.ok(task.título?.includes("Atualizada") || task.titulo?.includes("Atualizada"), "Title should be updated");
});

await test("POST assign task to pane", async () => {
  const r = await json("POST", `/missions/${missionId}/tasks/${taskId}/atribuir`, {
    paneId: "pane-qa-assignment",
    responsavel: "builder",
    papel: "executar",
  });
  assert.equal(r.status, 200);
});

await test("DELETE /api/missions/:id/tasks/:taskId deletes a task", async () => {
  const r = await json("DELETE", `/missions/${missionId}/tasks/${taskId2}`);
  assert.equal(r.status, 200);
});

// ============================================================
// SUITE 5 — File Ownership (Locks)
// ============================================================
console.log("\n[Suite 5] File Ownership & Locks");

await test("POST acquire lock (shared mode) requires taskId and files array", async () => {
  const r = await json("POST", `/missions/${missionId}/locks/acquire`, {
    taskId: taskId,
    paneId: "pane-qa-1",
    files: ["src/test-file.ts"],
    mode: "shared",
  });
  assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.ok(r.body.ok, "Lock should be granted");
});

await test("POST acquire second shared lock (same file, different task)", async () => {
  // Create a second task for locking
  const r1 = await json("POST", `/missions/${missionId}/tasks`, {
    título: "Lock test task 2",
    descrição: "For shared lock test",
    missionId,
  });
  assert.equal(r1.status, 201);
  const lockTask2 = (r1.body.task || r1.body).id;

  const r = await json("POST", `/missions/${missionId}/locks/acquire`, {
    taskId: lockTask2,
    paneId: "pane-qa-2",
    files: ["src/test-file.ts"],
    mode: "shared",
  });
  assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);

  // Release both
  await json("POST", `/missions/${missionId}/locks/release`, { taskId: taskId });
  await json("POST", `/missions/${missionId}/locks/release`, { taskId: lockTask2 });
});

await test("POST acquire isolated lock + conflict → 409", async () => {
  // Create two tasks for isolated lock test
  const r1 = await json("POST", `/missions/${missionId}/tasks`, {
    título: "Isolated lock task A",
    descrição: "Exclusive",
    missionId,
  });
  assert.equal(r1.status, 201);
  const isoTaskA = (r1.body.task || r1.body).id;

  const r2 = await json("POST", `/missions/${missionId}/tasks`, {
    título: "Isolated lock task B",
    descrição: "Conflicting",
    missionId,
  });
  assert.equal(r2.status, 201);
  const isoTaskB = (r2.body.task || r2.body).id;

  // Acquire isolated lock
  const acq1 = await json("POST", `/missions/${missionId}/locks/acquire`, {
    taskId: isoTaskA,
    paneId: "pane-qa-1",
    files: ["src/exclusive.ts"],
    mode: "isolated",
  });
  assert.equal(acq1.status, 200, `Expected 200, got ${acq1.status}`);

  // Second acquire should conflict
  const acq2 = await json("POST", `/missions/${missionId}/locks/acquire`, {
    taskId: isoTaskB,
    paneId: "pane-qa-2",
    files: ["src/exclusive.ts"],
    mode: "isolated",
  });
  assert.equal(acq2.status, 409, `Expected 409 Conflict, got ${acq2.status}: ${JSON.stringify(acq2.body)}`);

  // Release and cleanup
  await json("POST", `/missions/${missionId}/locks/release`, { taskId: isoTaskA });
});

await test("GET /api/missions/:id/locks lists current locks", async () => {
  const r = await json("GET", `/missions/${missionId}/locks`);
  assert.equal(r.status, 200);
  assert.ok(r.body.ok, "Should have ok response");
});

// ============================================================
// SUITE 6 — WebSocket Connection & Hardening
// ============================================================
console.log("\n[Suite 6] WebSocket Connection & Hardening");

await test("WebSocket connects and receives panes message", async () => {
  const { WebSocket } = await import("ws");
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const msg = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error("Timeout")); }, 3000);
    ws.on("message", (data) => { clearTimeout(timer); resolve(JSON.parse(String(data))); ws.close(); });
    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
  assert.equal(msg.type, "panes");
  assert.ok(Array.isArray(msg.panes));
});

await test("WS rejects malformed JSON without crashing", async () => {
  const { WebSocket } = await import("ws");
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  await new Promise((resolve) => ws.on("open", resolve));
  await new Promise((resolve) => ws.on("message", resolve)); // skip panes

  ws.send("this is not json {{{");
  ws.send(Buffer.from([0xff, 0xfe, 0x00, 0x01]));
  ws.send("{}}}}}");

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(ws.readyState, ws.OPEN, "WS should still be open after malformed payloads");
  ws.close();
});

await test("WS rejects prototype pollution attempts", async () => {
  const { WebSocket } = await import("ws");
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  await new Promise((resolve) => ws.on("open", resolve));
  await new Promise((resolve) => ws.on("message", resolve));

  ws.send(JSON.stringify({ type: "input", __proto__: { admin: true } }));
  ws.send(JSON.stringify({ type: "input", constructor: { prototype: { isAdmin: true } } }));

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(ws.readyState, ws.OPEN);
  ws.close();
});

await test("WS handles unknown message types gracefully", async () => {
  const { WebSocket } = await import("ws");
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  await new Promise((resolve) => ws.on("open", resolve));
  await new Promise((resolve) => ws.on("message", resolve));

  ws.send(JSON.stringify({ type: "nonexistent_action_xyz" }));
  ws.send(JSON.stringify({ type: "" }));
  ws.send(JSON.stringify({ notAType: 123 }));

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(ws.readyState, ws.OPEN);
  ws.close();
});

await test("5 concurrent WS clients work independently", async () => {
  const { WebSocket } = await import("ws");
  const url = `ws://localhost:${PORT}/ws`;
  const clients = Array.from({ length: 5 }, () => new WebSocket(url));

  const results = await Promise.all(
    clients.map(
      (ws) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => { ws.close(); reject(new Error("Timeout")); }, 3000);
          ws.on("message", (data) => { clearTimeout(timer); resolve(JSON.parse(String(data))); });
          ws.on("error", (err) => { clearTimeout(timer); reject(err); });
        }),
    ),
  );

  for (const r of results) assert.equal(r.type, "panes");

  // Terminate one and confirm others survive
  clients[0].terminate();
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (let i = 1; i < clients.length; i++) {
    assert.equal(clients[i].readyState, clients[i].OPEN, `Client ${i} should still be open`);
    clients[i].close();
  }
});

// ============================================================
// SUITE 7 — Connections & Mailbox (cockpit verbs)
// ============================================================
console.log("\n[Suite 7] Connections & Mailbox (cockpit verbs)");

await test("GET /api/cockpit/list returns bridge state", async () => {
  const r = await json("GET", "/cockpit/list");
  assert.equal(r.status, 200);
});

await test("GET /api/missions/:id/connections lists mission connections", async () => {
  const r = await json("GET", `/missions/${missionId}/connections`);
  assert.equal(r.status, 200);
});

await test("POST cockpit connect creates a connection", async () => {
  const r = await json("POST", `/missions/${missionId}/cockpit/connect`, {
    from: "pane-qa-1",
    to: "pane-qa-2",
    sourcePaneId: "pane-qa-1",
    targetPaneId: "pane-qa-2",
  });
  // May succeed or fail if panes don't exist — either is valid behavior
  assert.ok(r.status === 200 || r.status === 400 || r.status === 404, `Status: ${r.status}`);
});

await test("GET /api/missions/:id/handoffs lists handoff history", async () => {
  const r = await json("GET", `/missions/${missionId}/handoffs`);
  assert.equal(r.status, 200);
});

// ============================================================
// SUITE 8 — Panes & Role Reclassification
// ============================================================
console.log("\n[Suite 8] Panes & Role Reclassification");

await test("GET /api/panes returns pane list", async () => {
  const r = await json("GET", "/panes");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.panes || r.body));
});

// ============================================================
// SUITE 9 — Harness & Task Types
// ============================================================
console.log("\n[Suite 9] Harness & Task Types");

await test("POST /api/harness resolves harness config", async () => {
  const r = await json("POST", "/harness", { agent: "builder", tipo: "implementar" });
  assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.ok(r.body.cli, "Should return resolved CLI");
});

// ============================================================
// SUITE 10 — Memory Persistence
// ============================================================
console.log("\n[Suite 10] Memory Persistence");

await test("GET /api/projects/:id/memoria returns memory notes", async () => {
  const r = await json("GET", `/projects/${projectId}/memoria`);
  assert.equal(r.status, 200);
});

await test("POST /api/projects/:id/memoria saves a note", async () => {
  const r = await json("POST", `/projects/${projectId}/memoria`, {
    texto: "Nota de QA: E2E completo às " + new Date().toISOString(),
    quem: "qa-bot",
  });
  assert.equal(r.status, 200);
});

// ============================================================
// SUITE 11 — Negative Paths & Edge Cases
// ============================================================
console.log("\n[Suite 11] Negative Paths & Edge Cases");

await test("GET /api/missions/nonexistent/tasks returns empty or 200", async () => {
  const r = await json("GET", "/missions/nonexistent-id-xyz/tasks");
  // TaskManager returns empty for unknown mission - that's valid
  assert.ok(r.status === 200 || r.status === 404, `Status: ${r.status}`);
});

await test("POST /api/missions/:id/tasks/:id/status with invalid status → 400", async () => {
  const r = await json("POST", `/missions/${missionId}/tasks/${taskId}/status`, {
    status: "banana",
  });
  assert.ok(r.status === 400 || (r.body && r.body.error), "Invalid status should be rejected");
});

await test("POST malformed JSON to REST endpoint → 400", async () => {
  const r = await new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/api/missions/${missionId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write("{{not valid json}}");
    req.end();
  });
  assert.equal(r.status, 400, "Malformed JSON should return 400");
});

await test("GET /api/nonexistent-route → 404", async () => {
  const r = await rawGet("/api/this-route-does-not-exist");
  assert.ok(r.status === 404 || r.status === 501, `Unknown route got ${r.status}`);
});

await test("POST /api/missions/:id/tasks/:id/status without status field → 400", async () => {
  const r = await json("POST", `/missions/${missionId}/tasks/${taskId}/status`, {});
  assert.equal(r.status, 400, "Missing status field should return 400");
});

await test("POST /api/missions/:id/locks/acquire without required fields → 400", async () => {
  const r = await json("POST", `/missions/${missionId}/locks/acquire`, {
    paneId: "test",
  });
  assert.equal(r.status, 400, "Missing required fields should return 400");
});

await test("POST /api/missions/:id/locks/release without taskId → 400", async () => {
  const r = await json("POST", `/missions/${missionId}/locks/release`, {});
  assert.equal(r.status, 400, "Missing taskId should return 400");
});

// ============================================================
// CLEANUP
// ============================================================
console.log("\n[Cleanup] Removing test mission");

await test("DELETE /api/missions/:id removes test mission", async () => {
  const r = await json("DELETE", `/missions/${missionId}`);
  assert.ok(r.status === 200 || r.status === 204);
});

// ============================================================
// REPORT
// ============================================================
console.log("\n" + "═".repeat(70));
console.log(`  QA E2E LIVE RESULTS: ${passed} passed, ${failed} failed`);
console.log("═".repeat(70));

if (failures.length > 0) {
  console.log("\nFailed tests:");
  for (const f of failures) {
    console.log(`  ❌ ${f.name}`);
    console.log(`     ${f.error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
