import assert from "node:assert/strict";
import { MaestroCoordinator } from "../servidor/orchestration/maestro-coordinator.ts";
import { Continuity } from "../servidor/missions/continuity.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pty from "../servidor/pty.ts";

console.log("Iniciando verificação de coordenação do Maestro e entrega de informações...");

const tempDir = mkdtempSync(join(tmpdir(), "check-maestro-coord-"));

try {
  const continuity = new Continuity(tempDir);
  let lastBroadcast: any = null;
  const coordinator = new MaestroCoordinator({
    continuity,
    broadcast: (msg) => { lastBroadcast = msg; },
    porta: 3000,
  });

  const manager = pty.getDefaultPtyManager();
  const writtenToMaestro: string[] = [];
  const originalWritePty = manager.writePty;
  manager.writePty = (paneId: string, data: string) => {
    if (paneId === "pane-maestro") {
      writtenToMaestro.push(data);
    }
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
    "Explorando src/...\nEncontrados 15 módulos.\n\x1b[32mConclusão:\x1b[0m Arquitetura é modular e componentes estão em web/."
  );
  coordinator.outputTails.set(
    "pane-builder",
    "Criando botões e ajustando layout.\n\x1b[34m[Build]\x1b[0m 3 arquivos modificados com sucesso sem erros."
  );

  // 2. Enquanto os agentes estão "working", checkDelegations não deve disparar
  coordinator.checkDelegations();
  assert.equal(writtenToMaestro.length, 0, "Maestro não deve ser notificado enquanto especialistas trabalham");

  // 3. Builder e Scout concluem o trabalho (transição para waiting-user após tempo)
  const builderPane = mockPanes.find((p) => p.paneId === "pane-builder");
  const scoutPane = mockPanes.find((p) => p.paneId === "pane-scout");

  builderPane.status = "waiting-user";
  scoutPane.status = "waiting-user";

  // Forçar o timestamp de delegação para o passado para simular o tempo decorrido (> 4s)
  const map = (coordinator as any).pendingDelegations.get("m1");
  for (const info of map.values()) {
    info.delegatedAt = Date.now() - 5000;
  }

  // 4. Executar checkDelegations agora que ambos terminaram
  coordinator.checkDelegations();

  assert.equal(writtenToMaestro.length, 1, "Maestro deve ter recebido 1 notificação de reativação");
  const notification = writtenToMaestro[0];

  // 5. Verificar que a notificação contém os resumos de entrega reais de BUILDER e SCOUT
  assert.ok(notification.includes("=== [BUILDER] ==="), "Notificação deve conter cabeçalho do BUILDER");
  assert.ok(notification.includes("3 arquivos modificados com sucesso"), "Notificação deve conter o resultado do BUILDER");
  assert.ok(notification.includes("=== [SCOUT] ==="), "Notificação deve conter cabeçalho do SCOUT");
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
