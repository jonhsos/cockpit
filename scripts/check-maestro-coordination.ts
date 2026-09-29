import assert from "node:assert/strict";
import { MaestroCoordinator } from "../servidor/orchestration/maestro-coordinator.ts";
import { Continuity } from "../servidor/missions/continuity.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pty from "../servidor/pty.ts";
import { DiskStore } from "../servidor/persistence/disk-store.ts";
import { TaskStore } from "../servidor/persistence/task-store.ts";
import { FileOwnershipManager } from "../servidor/tasks/file-ownership.ts";
import { TaskManager } from "../servidor/tasks/task-manager.ts";

console.log("Iniciando verificação de coordenação do Maestro e entrega de informações...");

const tempDir = mkdtempSync(join(tmpdir(), "check-maestro-coord-"));

try {
  const continuity = new Continuity(tempDir);
  const taskManager = new TaskManager(new FileOwnershipManager(), new TaskStore(new DiskStore(tempDir)));
  let lastBroadcast: any = null;
  const coordinator = new MaestroCoordinator({
    continuity,
    broadcast: (msg) => { lastBroadcast = msg; },
    porta: 3000,
    taskManager,
  });

  const manager = pty.getDefaultPtyManager();
  const writtenToMaestro: string[] = [];
  const originalWritePty = manager.writePty;
  let rejectNotification = false;
  manager.writePty = (paneId: string, data: string) => {
    if (rejectNotification) return false;
    if (paneId === "pane-maestro") {
      writtenToMaestro.push(data);
    }
    return true;
  };

  // Mock listPanes
  let mockPanes: any[] = [
    {
      paneId: "pane-maestro",
      label: "MAESTRO",
      missionId: "m1",
      maestro: true,
      status: "waiting-user",
      cli: "codex",
      agent: "maestro",
      role: "maestro",
      bytesIn: 10,
      bytesOut: 50,
      atividade: [0, 0, 0],
    },
    {
      paneId: "pane-builder",
      label: "BUILDER",
      missionId: "m1",
      maestro: false,
      status: "working",
      cli: "codex",
      agent: "builder",
      role: "builder",
      bytesIn: 100,
      bytesOut: 500,
      atividade: [5, 10, 20],
    },
    {
      paneId: "pane-scout",
      label: "SCOUT",
      missionId: "m1",
      maestro: false,
      status: "working",
      cli: "codex",
      agent: "scout",
      role: "scout",
      bytesIn: 80,
      bytesOut: 400,
      atividade: [4, 8, 15],
    },
  ];

  const originalListPanes = manager.listPanes;
  manager.listPanes = () => mockPanes;

  // 1. Registrar delegações do Maestro para Builder e Scout
  coordinator.trackDelegation("m1", "pane-builder", "builder");
  coordinator.trackDelegation("m1", "pane-scout", "scout");

  // Simular outputs gerados pelos especialistas
  coordinator.outputTails.set(
    "pane-scout",
    "Explorando src/...\nEncontrados 15 módulos.\n\x1b[32mConclusão:\x1b[0m Arquitetura é modular e componentes estão em web/.\nCOCKPIT_STATUS: complete"
  );
  coordinator.outputTails.set(
    "pane-builder",
    "Criando botões e ajustando layout.\n\x1b[34m[Build]\x1b[0m 3 arquivos modificados com sucesso sem erros.\nCOCKPIT_STATUS: complete"
  );

  // 2. Enquanto os agentes estão "working", checkDelegations não deve disparar
  coordinator.checkDelegations();
  assert.equal(writtenToMaestro.length, 0, "Maestro não deve ser notificado enquanto especialistas trabalham");

  // 3. Builder e Scout concluem o trabalho (transição para waiting-user após tempo)
  const builderPane = mockPanes.find((p) => p.paneId === "pane-builder");
  const scoutPane = mockPanes.find((p) => p.paneId === "pane-scout");

  builderPane.status = "waiting-user";
  scoutPane.status = "waiting-user";

  // Silêncio breve não indica conclusão, mesmo com marcador no output.
  coordinator.checkDelegations();
  assert.equal(writtenToMaestro.length, 0);

  // Forçar janela de estabilidade após relatório explícito.
  const map = (coordinator as any).pendingDelegations.get("m1");
  for (const info of map.values()) {
    info.delegatedAt = Date.now() - 11_000;
    info.lastActiveAt = Date.now() - 11_000;
  }

  // 4. Executar checkDelegations agora que ambos terminaram
  coordinator.checkDelegations();

  assert.equal(writtenToMaestro.length, 1, "Maestro deve ter recebido 1 notificação de reativação");
  const notification = writtenToMaestro[0];

  // 5. Verificar que a notificação contém os resumos de entrega reais de BUILDER e SCOUT
  assert.ok(notification.includes("=== [BUILDER] CONCLUÍDO ==="), "Notificação deve conter cabeçalho do BUILDER");
  assert.ok(notification.includes("3 arquivos modificados com sucesso"), "Notificação deve conter o resultado do BUILDER");
  assert.ok(notification.includes("=== [SCOUT] CONCLUÍDO ==="), "Notificação deve conter cabeçalho do SCOUT");
  assert.ok(notification.includes("Arquitetura é modular"), "Notificação deve conter o resultado do SCOUT");
  assert.ok(!notification.includes("\x1b[32m"), "Sequências ANSI devem ser limpas da notificação");

  assert.equal(lastBroadcast?.type, "maestro:reactivated");
  assert.equal(lastBroadcast?.missionId, "m1");

  // 6. Testar endpoint /panes com saida_recente
  const { createPanesRouter } = await import("../servidor/routes/panes-router.ts");
  const panesRouter = createPanesRouter({
    outputTails: coordinator.outputTails,
  } as any);

  let panesResult: any = null;
  const mockPanesReq = { query: { missionId: "m1" } };
  const mockPanesRes = {
    json: (data: any) => { panesResult = data; },
  };

  const panesGetHandler = (panesRouter.stack.find((s: any) => s.route?.path === "/panes") as any).route.stack[0].handle;
  panesGetHandler(mockPanesReq, mockPanesRes);

  assert.ok(panesResult?.panes?.length > 0, "Deve retornar lista de painéis");
  const scoutInPanes = panesResult.panes.find((p: any) => p.paneId === "pane-scout");
  assert.ok(scoutInPanes?.saida_recente?.includes("Arquitetura é modular"), "Painel deve conter saida_recente limpa");
  assert.ok(!scoutInPanes?.saida_recente?.includes("\x1b[32m"), "saida_recente não deve conter escapes ANSI");

  // 7. Testar endpoint /missions/:id/resultado/:painel
  const { createMissionsRouter } = await import("../servidor/routes/missions-router.ts");
  const missionsRouter = createMissionsRouter({
    outputTails: coordinator.outputTails,
  } as any);

  let resultadoScout: any = null;
  const resultadoHandler = (missionsRouter.stack.find((s: any) => s.route?.path === "/missions/:id/resultado/:painel") as any).route.stack[0].handle;
  
  await resultadoHandler(
    { params: { id: "m1", painel: "scout" } },
    { json: (data: any) => { resultadoScout = data; }, status: () => ({ json: () => {} }) }
  );

  assert.equal(resultadoScout?.agente, "SCOUT");
  assert.ok(resultadoScout?.saida?.includes("Arquitetura é modular"));

  let resultadoBuilder: any = null;
  await resultadoHandler(
    { params: { id: "m1", painel: "builder" } },
    { json: (data: any) => { resultadoBuilder = data; }, status: () => ({ json: () => {} }) }
  );
  assert.equal(resultadoBuilder?.agente, "BUILDER");
  assert.ok(resultadoBuilder?.saida?.includes("3 arquivos modificados com sucesso"));

  // Testar com qualquer outro agente/painel (ex: reviewer ou por paneId direto)
  mockPanes.push({
    paneId: "pane-reviewer",
    label: "REVIEWER",
    missionId: "m1",
    maestro: false,
    status: "waiting-user",
    cli: "claude",
    agent: "reviewer",
    role: "reviewer",
    bytesIn: 50,
    bytesOut: 300,
    atividade: [1, 2],
  });
  coordinator.outputTails.set("pane-reviewer", "Revisão concluída: 0 erros críticos encontrados.");

  let resultadoReviewer: any = null;
  await resultadoHandler(
    { params: { id: "m1", painel: "reviewer" } },
    { json: (data: any) => { resultadoReviewer = data; }, status: () => ({ json: () => {} }) }
  );
  assert.equal(resultadoReviewer?.agente, "REVIEWER");
  assert.ok(resultadoReviewer?.saida?.includes("Revisão concluída: 0 erros"));

  // Por paneId direto
  let resultadoPorPaneId: any = null;
  await resultadoHandler(
    { params: { id: "m1", painel: "pane-reviewer" } },
    { json: (data: any) => { resultadoPorPaneId = data; }, status: () => ({ json: () => {} }) }
  );
  assert.equal(resultadoPorPaneId?.agente, "REVIEWER");
  assert.ok(resultadoPorPaneId?.saida?.includes("0 erros"));

  // Output parcial ou eco do prompt não pode encerrar tarefa por silêncio enquanto o CLI ainda trabalha.
  coordinator.trackDelegation("m1", "pane-builder", "builder");
  assert.equal(coordinator.outputTails.has("pane-builder"), false, "Nova tarefa não reutiliza relatório anterior");
  builderPane.status = "working";
  builderPane.activeTaskId = null;
  coordinator.outputTails.set("pane-builder", 'Executando testes... "COCKPIT_STATUS: complete" citado no prompt');
  const pending = (coordinator as any).pendingDelegations.get("m1").get("pane-builder");
  pending.delegatedAt = Date.now() - 11_000;
  pending.lastActiveAt = Date.now() - 11_000;
  coordinator.checkDelegations();
  assert.equal(writtenToMaestro.length, 1, "Silêncio e marcador citado não confirmam conclusão");

  pending.delegatedAt = Date.now() - 61_000;
  pending.lastActiveAt = Date.now() - 61_000;
  coordinator.checkDelegations();
  assert.equal(writtenToMaestro.length, 2, "Interrupção prolongada avisa o Maestro");
  assert.ok(writtenToMaestro[1]?.includes("SEM CONFIRMAÇÃO"));
  assert.ok((coordinator as any).pendingDelegations.get("m1")?.has("pane-builder"), "Silêncio não encerra delegação");
  coordinator.checkDelegations();
  assert.equal(writtenToMaestro.length, 2, "Aviso de silêncio não se repete a cada pulso");
  builderPane.status = "waiting-user";
  builderPane.activeTaskId = null;
  coordinator.outputTails.set("pane-builder", "Trabalho retomado e verificado.\nCOCKPIT_STATUS: complete");
  coordinator.checkDelegations();
  assert.equal(writtenToMaestro.length, 3, "Relatório tardio ainda conclui a delegação");

  // Voltar ao prompt sem o marcador também entrega o tail ao Orquestrador.
  coordinator.trackDelegation("m1", "pane-scout", "scout");
  scoutPane.status = "waiting-user";
  scoutPane.activeTaskId = null;
  coordinator.outputTails.set("pane-scout", "Mapa do repo em src/ e cmd/. Sem alterações.");
  const pendingScout = (coordinator as any).pendingDelegations.get("m1").get("pane-scout");
  pendingScout.delegatedAt = Date.now() - 11_000;
  pendingScout.lastActiveAt = Date.now() - 11_000;
  coordinator.checkDelegations();
  assert.equal(writtenToMaestro.length, 4, "Prompt ocioso após trabalho acorda o Maestro sem COCKPIT_STATUS");
  assert.ok(writtenToMaestro[3]?.includes("Mapa do repo"));

  // cockpit_reply é confirmação explícita mesmo se o status do PTY ainda for working.
  const task = taskManager.createTask("m1", { título: "Entrega do Builder", status: "todo" });
  taskManager.assignTask(task.id, "pane-builder");
  taskManager.transitionTask(task.id, "in-progress");
  coordinator.trackDelegation("m1", "pane-builder", "builder", task.id, "corr-builder");
  builderPane.status = "working";
  assert.equal(coordinator.acceptReply({
    type: "reply", from: "pane-builder", to: "pane-maestro", missionId: "m1",
    correlationId: "corr-errada", result: "Resultado falso",
  } as any), false);
  assert.equal(coordinator.acceptReply({
    type: "reply", from: "pane-builder", to: "pane-maestro", missionId: "m1",
    correlationId: "corr-builder", result: "Entrega final com evidências",
  } as any), true);
  coordinator.checkDelegations();
  assert.equal(writtenToMaestro.length, 5, "Resposta correlacionada acorda o Maestro");
  assert.ok(writtenToMaestro[4]?.includes("Entrega final com evidências"));
  assert.equal(taskManager.getTask(task.id)?.status, "complete", "Tarefa persistida deve concluir após entrega");
  assert.equal(taskManager.getTask(task.id)?.resultado, "Entrega final com evidências");

  const retriedTask = taskManager.createTask("m1", { título: "Entrega após fila cheia", status: "todo" });
  taskManager.assignTask(retriedTask.id, "pane-builder");
  taskManager.transitionTask(retriedTask.id, "in-progress");
  coordinator.trackDelegation("m1", "pane-builder", "builder", retriedTask.id, "corr-retry");
  assert.equal(coordinator.acceptReply({
    type: "reply", from: "pane-builder", to: "pane-maestro", missionId: "m1",
    correlationId: "corr-retry", result: "Resultado após nova tentativa",
  } as any), true);
  rejectNotification = true;
  coordinator.checkDelegations();
  assert.equal(taskManager.getTask(retriedTask.id)?.status, "in-progress", "Falha de entrega mantém tarefa pendente");
  assert.equal(writtenToMaestro.length, 5);
  rejectNotification = false;
  coordinator.checkDelegations();
  assert.equal(taskManager.getTask(retriedTask.id)?.status, "complete");
  assert.equal(writtenToMaestro.length, 6);

  // Restaurar mocks
  manager.writePty = originalWritePty;
  manager.listPanes = originalListPanes;

  console.log("  ✓ Delegações rastreadas corretamente");
  console.log("  ✓ Conclusão dos especialistas detectada sem falsos positivos");
  console.log("  ✓ Entregas e resumos do Builder e Scout extraídos e limpos de sequências ANSI");
  console.log("  ✓ Notificação injetada no Maestro com todos os resultados reais e acionáveis");
  console.log("  ✓ GET /panes expõe saida_recente e tarefa de cada especialista");
  console.log("  ✓ GET /missions/:id/resultado/:painel devolve entrega de Scout e Builder");
  console.log("\n=============================================");
  console.log("TODAS AS VERIFICAÇÕES DE COORDENAÇÃO PASSARAM COM SUCESSO!");
  console.log("=============================================");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
