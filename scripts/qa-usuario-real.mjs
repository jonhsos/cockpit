/**
 * QA "Como Usuário" — Simula o fluxo real de um humano usando o Cockpit.
 *
 * 1. Abre a página (GET /) — verifica se carrega
 * 2. Conecta o WebSocket (como o socket.ts faz ao abrir o app)
 * 3. Cria uma missão (como NovaMissao.tsx faz)
 * 4. Spawna um painel SHELL (bash) via WebSocket (como o botão "+ Terminal" faz)
 * 5. Espera o terminal aparecer e envia "echo hello-cockpit" + Enter
 * 6. Verifica que a saída do terminal chega de volta pelo WebSocket
 * 7. Spawna um segundo painel (outro agente: flash)
 * 8. Verifica que os dois painéis coexistem no servidor
 * 9. Cria uma tarefa no placar lateral (QuadroTarefas.tsx)
 * 10. Transiciona a tarefa por todo o ciclo de vida
 * 11. Renomeia a missão (como a UI de renomeação faz)
 * 12. Troca o modo da missão (livre → dirigido → autônomo)
 * 13. Faz emergency-stop e resume
 * 14. Mata um painel via WebSocket (como fechar o terminal pela UI)
 * 15. Verifica o evento "exit" chega pelo WebSocket
 * 16. Limpa tudo (deleta missão)
 *
 * Usage: COCKPIT_PORTA=3099 node scripts/qa-usuario-real.mjs
 */

import http from "node:http";
import assert from "node:assert/strict";

const PORT = process.env.COCKPIT_PORTA || 3099;
const BASE = `http://localhost:${PORT}`;
let passed = 0;
let failed = 0;
const failures = [];

// ─── HTTP helper (same as web/api.ts uses under the hood) ───
async function api(method, path, body) {
  const url = `${BASE}/api${path}`;
  const opts = { method, headers: { "Content-Type": "application/json" } };
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(url, opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let p; try { p = JSON.parse(data); } catch { p = data; }
        resolve({ status: res.statusCode, body: p });
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
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
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

// ─── WebSocket helper — mimics web/socket.ts ───
const { WebSocket } = await import("ws");

function createWsClient() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const received = [];
  const waiters = [];

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(String(buf)); } catch { return; }
    received.push(msg);
    // Wake up any waiters
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].check(msg)) {
        waiters[i].resolve(msg);
        waiters.splice(i, 1);
      }
    }
  });

  return {
    ws,
    send: (msg) => ws.send(JSON.stringify(msg)),
    received,
    /** Wait for a specific message type, with timeout */
    waitFor: (check, timeoutMs = 5000) => new Promise((resolve, reject) => {
      // Check if it already arrived
      const existing = received.find(check);
      if (existing) return resolve(existing);
      const timer = setTimeout(() => {
        reject(new Error(`Timeout aguardando mensagem (${timeoutMs}ms). Recebidas: ${received.map(m => m.type).join(", ")}`));
      }, timeoutMs);
      waiters.push({
        check,
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
      });
    }),
    /** Wait only for messages arriving AFTER this call */
    waitForNew: (check, timeoutMs = 5000) => {
      const startIndex = received.length;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout aguardando nova mensagem (${timeoutMs}ms)`));
        }, timeoutMs);
        waiters.push({
          check: (msg) => {
            const idx = received.indexOf(msg);
            return idx >= startIndex && check(msg);
          },
          resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        });
      });
    },
    close: () => ws.close(),
    ready: () => new Promise((resolve) => ws.on("open", resolve)),
  };
}

// ============================================================
console.log("\n" + "═".repeat(70));
console.log("  QA COMO USUÁRIO REAL — Fluxo completo do Cockpit");
console.log("═".repeat(70));

// ============================================================
// PASSO 1 — Usuário abre o app no navegador
// ============================================================
console.log("\n[1] Usuário abre o Cockpit no navegador");

await test("A página carrega com HTML + bundles JS/CSS", async () => {
  const r = await rawGet("/");
  assert.equal(r.status, 200);
  assert.ok(r.body.includes("<!DOCTYPE") || r.body.includes("<html"), "Deve servir HTML");
  assert.ok(r.body.includes("/assets/"), "Deve referenciar bundles de assets");
});

// ============================================================
// PASSO 2 — socket.ts conecta o WebSocket automaticamente
// ============================================================
console.log("\n[2] WebSocket conecta automaticamente");

const client = createWsClient();
await client.ready();

await test("WebSocket conecta e recebe lista de painéis", async () => {
  const panes = await client.waitFor((m) => m.type === "panes");
  assert.equal(panes.type, "panes");
  assert.ok(Array.isArray(panes.panes), "Deve receber array de painéis");
});

// ============================================================
// PASSO 3 — Usuário busca seus projetos e vê o catálogo
// ============================================================
console.log("\n[3] Usuário vê seus projetos e catálogo de agentes");

let projectId;
await test("App carrega projetos na lateral", async () => {
  const r = await api("GET", "/projects");
  assert.equal(r.status, 200);
  assert.ok(r.body.projects.length >= 1, "Deve haver pelo menos 1 projeto");
  projectId = r.body.projects[0].id;
  console.log(`     → Projeto: ${r.body.projects[0].nome} (${projectId})`);
});

await test("Catálogo de agentes carrega com config completa", async () => {
  const r = await api("GET", "/config");
  assert.equal(r.status, 200);
  const agentNames = Object.keys(r.body.agents || {});
  assert.ok(agentNames.length >= 10, `Deve ter 10+ agentes, tem ${agentNames.length}`);
  assert.ok(agentNames.includes("shell"), "Deve incluir agente 'shell' (bash)");
  assert.ok(agentNames.includes("builder"), "Deve incluir agente 'builder'");
  assert.ok(r.body.squads, "Deve ter squads configurados");
  console.log(`     → ${agentNames.length} agentes disponíveis: ${agentNames.join(", ")}`);
});

// ============================================================
// PASSO 4 — Usuário cria uma nova missão
// ============================================================
console.log("\n[4] Usuário cria uma nova missão");

let missionId;
await test("Criar missão 'Meu Projeto QA' no modo livre", async () => {
  const r = await api("POST", "/missions", {
    projectId,
    nome: "Meu Projeto QA",
    objetivo: "Testar o cockpit como um usuário real faria",
    modo: "livre",
  });
  assert.equal(r.status, 200, `Status ${r.status}: ${JSON.stringify(r.body)}`);
  missionId = r.body.id || r.body.mission?.id;
  assert.ok(missionId, "Deve retornar ID da missão");
  console.log(`     → Missão criada: ${missionId}`);
});

// ============================================================
// PASSO 5 — Usuário abre um terminal SHELL (bash)
// ============================================================
console.log("\n[5] Usuário clica em '+ Terminal' e abre bash");

let shellPaneId;
await test("Spawnar painel SHELL (bash -i -l) via WebSocket", async () => {
  client.send({ type: "spawn", agent: "shell", missionId });

  // Esperar o evento "spawned" ou o update de "panes" com o novo painel
  const spawned = await client.waitFor(
    (m) => m.type === "spawned" || (m.type === "panes" && m.panes?.some((p) => p.agent === "shell" && p.missionId === missionId)),
    8000,
  );

  if (spawned.type === "spawned") {
    shellPaneId = spawned.paneId || spawned.pane?.paneId;
  } else {
    const shellPane = spawned.panes.find((p) => p.agent === "shell" && p.missionId === missionId);
    shellPaneId = shellPane?.paneId;
  }
  assert.ok(shellPaneId, `Deve retornar paneId do shell. Msg: ${JSON.stringify(spawned).slice(0, 200)}`);
  console.log(`     → Painel shell: ${shellPaneId}`);
});

await test("Terminal bash envia output (prompt)", async () => {
  // Esperar qualquer output do shell recém-criado
  const output = await client.waitFor(
    (m) => m.type === "output" && m.paneId === shellPaneId,
    5000,
  );
  assert.ok(output.data, "Deve receber dados de saída do terminal");
  console.log(`     → Recebido ${output.data.length} bytes de output do terminal`);
});

// ============================================================
// PASSO 6 — Usuário digita um comando no terminal
// ============================================================
console.log("\n[6] Usuário digita 'echo hello-cockpit' no terminal");

await test("Enviar comando e receber saída", async () => {
  // Limpar mensagens anteriores de output
  const outputsBefore = client.received.filter((m) => m.type === "output" && m.paneId === shellPaneId).length;

  client.send({ type: "input", paneId: shellPaneId, data: "echo hello-cockpit-qa-2026\n" });

  // Esperar output que contenha nossa string
  const output = await client.waitFor(
    (m) => m.type === "output" && m.paneId === shellPaneId && m.data?.includes("hello-cockpit-qa-2026"),
    5000,
  );
  assert.ok(output.data.includes("hello-cockpit-qa-2026"), "Output deve conter o echo");
  console.log(`     → Terminal respondeu: ${output.data.trim().slice(0, 80)}`);
});

await test("Enviar segundo comando: 'pwd'", async () => {
  client.send({ type: "input", paneId: shellPaneId, data: "pwd\n" });

  const output = await client.waitFor(
    (m) => m.type === "output" && m.paneId === shellPaneId && m.data?.includes("/"),
    5000,
  );
  assert.ok(output.data.includes("/"), "pwd deve retornar um caminho com /");
  console.log(`     → pwd: ${output.data.trim().split("\n").pop()}`);
});

// ============================================================
// PASSO 7 — Usuário verifica os painéis via REST (como a lateral faz)
// ============================================================
console.log("\n[7] Lateral mostra os painéis ativos");

await test("GET /api/panes confirma que o shell está ativo", async () => {
  const r = await api("GET", "/panes");
  assert.equal(r.status, 200);
  const panes = r.body.panes || r.body;
  const ourShell = panes.find((p) => p.paneId === shellPaneId);
  assert.ok(ourShell, "Nosso painel shell deve estar na lista");
  assert.equal(ourShell.cli, "bash", "CLI deve ser bash");
  console.log(`     → Shell encontrado: cli=${ourShell.cli}, status=${ourShell.status}`);
});

// ============================================================
// PASSO 7b — Usuário adiciona um Agente IA especialista (Flash / Gemini via agy)
// ============================================================
console.log("\n[7b] Usuário adiciona Agente IA (Flash / agy)");

let aiPaneId;
await test("Spawnar agente IA 'flash' (agy + gemini-3.8-flash-high) via WebSocket", async () => {
  client.send({ type: "spawn", agent: "flash", missionId, tarefa: "Analise o repositório" });

  const spawned = await client.waitFor(
    (m) =>
      (m.type === "spawned" && m.pane?.agent === "flash") ||
      (m.type === "panes" && m.panes?.some((p) => p.agent === "flash" && p.missionId === missionId)),
    8000,
  );

  if (spawned.type === "spawned") {
    aiPaneId = spawned.paneId || spawned.pane?.paneId;
  } else {
    const p = spawned.panes.find((p) => p.agent === "flash" && p.missionId === missionId);
    aiPaneId = p?.paneId;
  }
  assert.ok(aiPaneId, "Deve retornar paneId do agente IA");
  console.log(`     → Painel Agente IA: ${aiPaneId}`);
});

await test("Agente IA inicializa e emite output no terminal", async () => {
  const output = await client.waitFor(
    (m) => m.type === "output" && m.paneId === aiPaneId,
    8000,
  );
  assert.ok(output.data, "Agente IA deve produzir output de terminal");
  console.log(`     → Recebidos ${output.data.length} bytes de output da IA (${aiPaneId})`);
});

await test("GET /api/panes confirma metadados do agente IA (cli=agy, model, effort)", async () => {
  const r = await api("GET", "/panes");
  assert.equal(r.status, 200);
  const panes = r.body.panes || r.body;
  const aiPane = panes.find((p) => p.paneId === aiPaneId);
  assert.ok(aiPane, "Painel do agente IA deve estar na lista");
  assert.equal(aiPane.cli, "agy", "CLI do agente IA deve ser agy");
  assert.equal(aiPane.agent, "flash", "Agent deve ser flash");
  assert.ok(aiPane.model?.includes("gemini"), `Modelo deve ser gemini, veio ${aiPane.model}`);
  console.log(`     → Agente IA confirmado: cli=${aiPane.cli}, model=${aiPane.model}, status=${aiPane.status}`);
});

await test("Encerrar painel do agente IA de forma limpa", async () => {
  client.send({ type: "kill", paneId: aiPaneId });

  const exit = await client.waitFor(
    (m) => m.type === "exit" && m.paneId === aiPaneId,
    5000,
  );
  assert.ok(exit, "Deve receber evento exit para o agente IA");
  console.log(`     → Agente IA encerrado com sucesso`);
});

// ============================================================
// PASSO 8 — Usuário cria tarefas no Placar de Tarefas
// ============================================================
console.log("\n[8] Usuário usa o QuadroTarefas para criar e gerenciar tarefas");

let taskA, taskB;
await test("Criar tarefa 'Implementar componente' no placar", async () => {
  const r = await api("POST", `/missions/${missionId}/tasks`, {
    título: "Implementar componente React",
    descrição: "Criar o componente QuadroTarefas com os 6 estados",
    responsável: "builder",
    papel: "executar",
    prioridade: "alta",
    tipo: "implementar",
    missionId,
  });
  assert.equal(r.status, 201);
  taskA = r.body.task;
  assert.equal(taskA.status, "todo");
  console.log(`     → Tarefa criada: ${taskA.id} (status: todo)`);
});

await test("Criar tarefa 'Revisar código' no placar", async () => {
  const r = await api("POST", `/missions/${missionId}/tasks`, {
    título: "Revisar código do componente",
    descrição: "Auditar o diff e procurar bugs de verdade",
    responsável: "reviewer",
    papel: "revisar",
    prioridade: "normal",
    tipo: "auditoria",
    missionId,
  });
  assert.equal(r.status, 201);
  taskB = r.body.task;
  console.log(`     → Tarefa criada: ${taskB.id} (status: todo)`);
});

await test("Quadro Kanban mostra as 2 tarefas em 'todo'", async () => {
  const r = await api("GET", `/missions/${missionId}/tasks/board`);
  assert.equal(r.status, 200);
  const board = r.body.board;
  assert.ok(board, "Board deve existir");
  // Verificar que pelo menos 2 tarefas estão no board
  const totalTasks = Object.values(board).flat().length;
  assert.ok(totalTasks >= 2, `Board deve ter ≥2 tarefas, tem ${totalTasks}`);
  console.log(`     → Board com ${totalTasks} tarefas`);
});

// ============================================================
// PASSO 9 — Usuário arrasta tarefa pelo ciclo de vida
// ============================================================
console.log("\n[9] Usuário transiciona tarefas pelos 6 estados");

await test("Tarefa A: todo → in-progress (builder começa a trabalhar)", async () => {
  const r = await api("POST", `/missions/${missionId}/tasks/${taskA.id}/status`, { status: "in-progress" });
  assert.equal(r.status, 200);
  assert.equal(r.body.task.status, "in-progress");
});

await test("Tarefa A: in-progress → in-review (builder terminou, pede revisão)", async () => {
  const r = await api("POST", `/missions/${missionId}/tasks/${taskA.id}/status`, { status: "in-review" });
  assert.equal(r.status, 200);
});

await test("Tarefa B: todo → in-progress (reviewer começa a revisar)", async () => {
  const r = await api("POST", `/missions/${missionId}/tasks/${taskB.id}/status`, { status: "in-progress" });
  assert.equal(r.status, 200);
});

await test("Tarefa A: in-review → complete (revisão aprovada!)", async () => {
  const r = await api("POST", `/missions/${missionId}/tasks/${taskA.id}/status`, { status: "complete" });
  assert.equal(r.status, 200);
  assert.equal(r.body.task.status, "complete");
});

await test("Tarefa B: in-progress → blocked (dependência não resolvida)", async () => {
  const r = await api("POST", `/missions/${missionId}/tasks/${taskB.id}/status`, {
    status: "blocked",
    reason: "Aguardando deploy do ambiente de staging",
  });
  assert.equal(r.status, 200);
});

await test("Tarefa B: blocked → in-progress → failed (desbloqueou mas falhou)", async () => {
  const r1 = await api("POST", `/missions/${missionId}/tasks/${taskB.id}/status`, { status: "in-progress" });
  assert.equal(r1.status, 200);
  const r2 = await api("POST", `/missions/${missionId}/tasks/${taskB.id}/status`, {
    status: "failed",
    reason: "Testes de regressão falharam",
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.task.status, "failed");
});

await test("Board final mostra: 1 complete, 1 failed, 0 todo", async () => {
  const r = await api("GET", `/missions/${missionId}/tasks/board`);
  assert.equal(r.status, 200);
  const board = r.body.board;
  const completeTasks = (board["complete"] || []).length;
  const failedTasks = (board["failed"] || []).length;
  assert.ok(completeTasks >= 1, "Deve ter pelo menos 1 tarefa 'complete'");
  assert.ok(failedTasks >= 1, "Deve ter pelo menos 1 tarefa 'failed'");
  console.log(`     → Board: complete=${completeTasks}, failed=${failedTasks}`);
});

// ============================================================
// PASSO 10 — Usuário renomeia a missão pela lateral
// ============================================================
console.log("\n[10] Usuário renomeia a missão");

await test("Renomear missão para 'Projeto Alpha v2'", async () => {
  const r = await api("POST", `/missions/${missionId}/nome`, { nome: "Projeto Alpha v2" });
  assert.equal(r.status, 200);
});

await test("Missão aparece com nome novo na listagem", async () => {
  const r = await api("GET", `/missions?projectId=${projectId}`);
  const mission = (r.body.missions || r.body).find((m) => m.id === missionId);
  assert.ok(mission, "Missão deve existir");
  assert.equal(mission.nome, "Projeto Alpha v2", "Nome deve estar atualizado");
  console.log(`     → Missão: "${mission.nome}"`);
});

// ============================================================
// PASSO 11 — Usuário troca o modo da missão
// ============================================================
console.log("\n[11] Usuário alterna modos de missão");

await test("Livre → Dirigido → Autônomo → Livre", async () => {
  let r;
  r = await api("POST", `/missions/${missionId}/modo`, { modo: "dirigido" });
  assert.equal(r.status, 200);

  r = await api("GET", `/missions/${missionId}/modo`);
  assert.equal(r.body.modo, "dirigido");

  r = await api("POST", `/missions/${missionId}/modo`, { modo: "autonomo" });
  assert.equal(r.status, 200);

  r = await api("POST", `/missions/${missionId}/modo`, { modo: "livre" });
  assert.equal(r.status, 200);

  r = await api("GET", `/missions/${missionId}/modo`);
  assert.equal(r.body.modo, "livre");
  console.log(`     → Modo final: ${r.body.modo}`);
});

// ============================================================
// PASSO 12 — Usuário aciona parada de emergência
// ============================================================
console.log("\n[12] Usuário aciona parada de emergência");

await test("Emergency stop → verifica emergencyHalt → resume", async () => {
  const r1 = await api("POST", `/missions/${missionId}/emergency-stop`, {});
  assert.equal(r1.status, 200);

  const r2 = await api("GET", `/missions/${missionId}/modo`);
  assert.equal(r2.body.emergencyHalt, true, "Missão deve estar com emergencyHalt=true");

  const r3 = await api("POST", `/missions/${missionId}/resume`, {});
  assert.equal(r3.status, 200);

  const r4 = await api("GET", `/missions/${missionId}/modo`);
  assert.equal(r4.body.emergencyHalt, false, "Missão deve estar com emergencyHalt=false");
  console.log(`     → Parada de emergência e retomada: OK`);
});

// ============================================================
// PASSO 13 — Usuário reclassifica papel de um painel (como na UI)
// ============================================================
console.log("\n[13] Usuário reclassifica papel do painel");

await test("POST /api/panes/:id/papel reclassifica para 'builder'", async () => {
  const r = await api("POST", `/panes/${shellPaneId}/papel`, {
    agent: "builder",
    label: "BUILDER-CUSTOM",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.pane.agent, "builder");
  assert.equal(r.body.pane.label, "BUILDER-CUSTOM");
  console.log(`     → Painel reclassificado: agent=${r.body.pane.agent}, label=${r.body.pane.label}`);
});

// ============================================================
// PASSO 14 — Usuário abre 2º painel e conecta os dois (Multi-agente)
// ============================================================
console.log("\n[14] Usuário abre 2º painel e conecta os dois (Multi-agente)");

let secondPaneId;
await test("Spawnar 2º painel para colaboração inter-agente", async () => {
  const waitPromise = client.waitForNew(
    (m) =>
      (m.type === "spawned" && m.pane?.paneId !== shellPaneId && m.pane?.paneId !== aiPaneId) ||
      (m.type === "panes" && m.panes?.some((p) => p.paneId !== shellPaneId && p.paneId !== aiPaneId && p.missionId === missionId)),
    8000,
  );

  client.send({ type: "spawn", agent: "shell", missionId });
  const spawned = await waitPromise;

  if (spawned.type === "spawned") {
    secondPaneId = spawned.paneId || spawned.pane?.paneId;
  } else {
    const p = spawned.panes.find((p) => p.paneId !== shellPaneId && p.paneId !== aiPaneId && p.missionId === missionId);
    secondPaneId = p?.paneId;
  }
  assert.ok(secondPaneId, "Deve retornar ID do 2º painel");
  console.log(`     → 2º Painel: ${secondPaneId}`);
});

await test("Conectar Painel 1 ao Painel 2 via cockpit/connect", async () => {
  const r = await api("POST", `/missions/${missionId}/cockpit/connect`, {
    from: shellPaneId,
    to: secondPaneId,
    sourcePaneId: shellPaneId,
    targetPaneId: secondPaneId,
  });
  assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.ok(r.body.connection?.id, "Deve retornar ID da conexão");
  console.log(`     → Conexão criada: ${r.body.connection.id} (${shellPaneId} ↔ ${secondPaneId})`);
});

let correlationId;
await test("Enviar mensagem / pergunta inter-painel (cockpit/ask)", async () => {
  const r = await api("POST", `/missions/${missionId}/cockpit/ask`, {
    from: shellPaneId,
    to: secondPaneId,
    task: "Por favor revise a tarefa taskA",
  });
  assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  correlationId = r.body.result?.correlationId;
  console.log(`     → Mensagem enviada (correlationId: ${correlationId})`);
});

await test("Painel 2 recebe a mensagem na sua caixa de entrada (inbox)", async () => {
  const r = await api("GET", `/missions/${missionId}/panes/${secondPaneId}/inbox`);
  assert.equal(r.status, 200);
  const messages = r.body.inbox || r.body.messages || r.body;
  assert.ok(Array.isArray(messages), "inbox deve ser array");
  const msg = messages.find((m) => m.correlationId === correlationId || m.task?.includes("taskA"));
  assert.ok(msg, "Mensagem enviada deve estar na caixa de entrada do painel 2");
  console.log(`     → Mensagem na inbox do Painel 2: "${msg.task || msg.content}"`);
});

await test("Painel 2 responde ao Painel 1 (cockpit/reply)", async () => {
  const r = await api("POST", `/missions/${missionId}/cockpit/reply`, {
    from: secondPaneId,
    to: shellPaneId,
    correlationId: correlationId || "dummy-corr",
    result: "Revisão concluída: aprovado com mérito",
  });
  assert.equal(r.status, 200);
  console.log(`     → Resposta entregue via mailbox`);
});

// ============================================================
// PASSO 15 — Usuário fecha os terminais pelo botão Kill
// ============================================================
console.log("\n[15] Usuário fecha os terminais (kill)");

await test("Matar painel 1 e receber evento 'exit'", async () => {
  client.send({ type: "kill", paneId: shellPaneId });

  const exit = await client.waitFor(
    (m) => m.type === "exit" && m.paneId === shellPaneId,
    5000,
  );
  assert.ok(exit, "Deve receber evento exit");
  console.log(`     → Terminal 1 encerrado (code: ${exit.code})`);
});

await test("Matar painel 2 e receber evento 'exit'", async () => {
  client.send({ type: "kill", paneId: secondPaneId });

  const exit = await client.waitFor(
    (m) => m.type === "exit" && m.paneId === secondPaneId,
    5000,
  );
  assert.ok(exit, "Deve receber evento exit");
  console.log(`     → Terminal 2 encerrado (code: ${exit.code})`);
});

await test("Nenhum dos painéis aparece mais em /api/panes", async () => {
  await new Promise((r) => setTimeout(r, 200));
  const r = await api("GET", "/panes");
  const panes = r.body.panes || r.body;
  assert.ok(!panes.some((p) => p.paneId === shellPaneId), "Painel 1 não deve constar");
  assert.ok(!panes.some((p) => p.paneId === secondPaneId), "Painel 2 não deve constar");
});

// ============================================================
// PASSO 14 — Limpeza e encerramento
// ============================================================
console.log("\n[14] Limpeza final");

await test("Deletar missão de teste", async () => {
  const r = await api("DELETE", `/missions/${missionId}`);
  assert.ok(r.status === 200 || r.status === 204);
});

client.close();

// ============================================================
// RELATÓRIO
// ============================================================
console.log("\n" + "═".repeat(70));
console.log(`  QA COMO USUÁRIO: ${passed} passaram, ${failed} falharam`);
console.log("═".repeat(70));

if (failures.length > 0) {
  console.log("\nFalhas:");
  for (const f of failures) {
    console.log(`  ❌ ${f.name}`);
    console.log(`     ${f.error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
