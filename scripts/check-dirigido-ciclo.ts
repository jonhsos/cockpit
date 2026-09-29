import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskStore } from "../servidor/persistence/disk-store.ts";
import { TaskStore } from "../servidor/persistence/task-store.ts";
import { FileOwnershipManager } from "../servidor/tasks/file-ownership.ts";
import { TaskManager } from "../servidor/tasks/task-manager.ts";
import { MailboxStore } from "../servidor/connections/mailbox-store.ts";
import { MailboxManager } from "../servidor/connections/mailbox-manager.ts";
import { PaneDispatcher, type PaneDispatcherState } from "../servidor/orchestration/pane-dispatcher.ts";
import { MaestroCoordinator } from "../servidor/orchestration/maestro-coordinator.ts";
import { Continuity } from "../servidor/missions/continuity.ts";
import * as pty from "../servidor/pty.ts";
import { canMaestroDelegate } from "../servidor/orchestration/mission-modes.ts";

console.log("Verificando ciclo dirigido: delegar → cola no PTY → retorno acorda o Orquestrador...");

const tempDir = mkdtempSync(join(tmpdir(), "check-dirigido-ciclo-"));

try {
  const disk = new DiskStore(tempDir);
  const taskManager = new TaskManager(new FileOwnershipManager(), new TaskStore(disk));
  const mailbox = new MailboxManager(new MailboxStore(disk));
  const panes = new Map<string, PaneDispatcherState>([
    ["p-orq", { paneId: "p-orq", label: "ORQUESTRADOR", role: "maestro", runner: "agy", status: "waiting-user", maestro: true, missionId: "m-dir", connected: true }],
    ["p-dbg", { paneId: "p-dbg", label: "DEPURADOR", role: "debugger", runner: "codex", status: "waiting-user", missionId: "m-dir", connected: true }],
  ]);
  const escritos: { id: string; data: string }[] = [];
  const dispatcher = new PaneDispatcher(
    taskManager,
    mailbox,
    {
      getPane: (id) => panes.get(id),
      listPanes: () => [...panes.values()],
      updatePane: (id, upd) => {
        const p = panes.get(id);
        if (p) Object.assign(p, upd);
      },
      writePane: (id, data) => {
        escritos.push({ id, data });
        return true;
      },
    },
  );

  const autorizados = dispatcher.listAvailablePanes("m-dir").flatMap((p) => [p.label, p.role, p.paneId]);
  assert.equal(canMaestroDelegate({ mode: "dirigido", targetAgentOrRole: "debugger", authorizedRoles: autorizados }).allowed, true);
  assert.equal(canMaestroDelegate({ mode: "dirigido", targetAgentOrRole: "p-dbg", authorizedRoles: autorizados }).allowed, true);

  const alvo = dispatcher.findExistingPane("m-dir", "Depurador");
  assert.equal(alvo?.paneId, "p-dbg");

  const task = taskManager.createTask("m-dir", { título: "Isolar crash no seletor", descrição: "Reproduza e ache a causa.", papel: "debugger", status: "todo" });
  const dispatched = dispatcher.dispatchToExistingPane("m-dir", task.id, "p-dbg");
  assert.equal(dispatched.deliveredToTerminal, true);
  assert.equal(escritos.some((e) => e.id === "p-dbg" && e.data.includes("Isolar crash")), true, "texto colou no PTY do Depurador");
  const inbox = mailbox.getInbox("p-dbg", "m-dir");
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].metadata?.deliveredToTerminal, true);
  const correio = mailbox.listMission("m-dir");
  assert.equal(correio[0].id, inbox[0].id);

  const continuity = new Continuity(tempDir);
  const writtenToMaestro: string[] = [];
  const coordinator = new MaestroCoordinator({
    continuity,
    broadcast: () => {},
    porta: 3000,
    taskManager,
  });
  const manager = pty.getDefaultPtyManager();
  const originalWrite = manager.writePty;
  const originalList = manager.listPanes;
  manager.writePty = (id, data) => {
    if (id === "p-orq") writtenToMaestro.push(data);
    return true;
  };
  manager.listPanes = () =>
    [...panes.values()].map((p) => ({
      ...p,
      agent: p.role,
      cli: p.runner,
      connected: true,
      bytesIn: 0,
      bytesOut: 10,
      atividade: [0],
      cwd: tempDir,
      projectId: null,
      sessionId: null,
      model: null,
      effort: null,
      tipo: null,
      cor: "#000",
      iniciadoEm: Date.now() - 60_000,
    })) as any;

  coordinator.trackDelegation("m-dir", "p-dbg", "DEPURADOR", task.id, dispatched.correlationId);
  panes.get("p-dbg")!.status = "waiting-user";
  panes.get("p-dbg")!.activeTaskId = null;
  coordinator.outputTails.set("p-dbg", "Causa: nil pointer em Select(). Correção mínima aplicada.");
  const info = (coordinator as any).pendingDelegations.get("m-dir").get("p-dbg");
  info.delegatedAt = Date.now() - 11_000;
  info.lastActiveAt = Date.now() - 11_000;
  coordinator.checkDelegations();
  assert.equal(writtenToMaestro.length, 1, "Orquestrador recebeu o retorno mecânico");
  assert.match(writtenToMaestro[0], /DEPURADOR/);
  assert.match(writtenToMaestro[0], /nil pointer/);

  manager.writePty = originalWrite;
  manager.listPanes = originalList;

  const ptySrc = readFileSync(new URL("../servidor/sessions/pty-manager.ts", import.meta.url), "utf8");
  assert.match(ptySrc, /--disallowed-tools/);
  assert.match(ptySrc, /--no-subagents/);
  assert.match(ptySrc, /regrasDeCanalDoPainel/);

  console.log("PASS: check-dirigido-ciclo.ts — delegar cola no PTY, correio registra, prompt ocioso acorda o Orquestrador.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
