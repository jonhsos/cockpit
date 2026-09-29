import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { config, salvarConfig } from "./config.ts";
import { Continuity } from "./missions/continuity.ts";
import { getPane, listPanes, initializePty, getDefaultPtyManager, updatePane, writePty } from "./pty.ts";
import { CASA, detachPane, listProjects } from "./state.ts";
import { observar } from "./missions/watcher.ts";
import { getDefaultBridge, getDefaultMailboxManager } from "./connections/index.ts";
import { getTaskManager, getFileOwnershipManager } from "./tasks/index.ts";
import { getMissionModeManager, getPaneDispatcher, MaestroCoordinator } from "./orchestration/index.ts";
import { createWebSocketServer } from "./websocket/index.ts";
import { createApiRouter, type RouterContext } from "./routes/index.ts";
import { accountPool } from "./providers/account-pool.ts";
import type { PaneState } from "./sessions/pane-state.ts";
import { parseServerOptions, resolveServerPort } from "./rede.ts";

const serverOpts = parseServerOptions(process.argv.slice(2), config.port);
const porta = await resolveServerPort(serverOpts.port, serverOpts.host, serverOpts.strict);
const host = serverOpts.host;
process.env.COCKPIT_PORT = String(porta);
process.env.COCKPIT_PORTA = String(porta);
if (host) process.env.COCKPIT_HOST = host;
const app = express();
const webDist = fileURLToPath(new URL("../web/dist", import.meta.url));
const webIndex = join(webDist, "index.html");
app.use(express.json({ limit: "8mb" }));

const server = createServer(app);
const continuity = new Continuity(join(CASA, "continuity"));

// Domain singletons
const ptyManager = getDefaultPtyManager();
const taskManager = getTaskManager();
const ownershipManager = getFileOwnershipManager();
const mailboxManager = getDefaultMailboxManager();
const missionModeManager = getMissionModeManager();
const paneDispatcher = getPaneDispatcher({ taskManager, mailboxManager });
const bridge = getDefaultBridge({
  mailboxManager,
  taskManager,
  paneProvider: {
    getPane: (id) => getPane(id),
    listPanes: () => listPanes(),
    writePane: (id, data) => writePty(id, data),
  },
});
accountPool.setPaneLabelResolver((paneId) => getPane(paneId)?.label);

// Coordinator & WebSocket Server
const coordinator = new MaestroCoordinator({
  continuity,
  broadcast: (msg) => wsServer.broadcast(msg),
  porta,
});
bridge.setOrchestrationHooks({
  canDeliverAsk: (target) => !coordinator.hasPendingDelegation(target.missionId ?? "", target.paneId),
  onAskDelivered: (message, target) => {
    let taskId = message.taskId;
    try {
      const task = taskId ? taskManager.getTask(taskId) : undefined;
      const trackedTask = task ?? taskManager.createTask(message.missionId, {
        título: (message.task ?? "Tarefa do Orquestrador").slice(0, 80),
        descrição: message.task,
        papel: target.role,
        status: "todo",
      });
      taskId = trackedTask.id;
      taskManager.assignTask(taskId, target.paneId, target.label, target.role);
      if (trackedTask.status === "todo" || trackedTask.status === "blocked") {
        taskManager.transitionTask(taskId, "in-progress");
      }
      updatePane(target.paneId, { activeTaskId: taskId, status: "working" });
    } catch (err) {
      console.error(`[Cockpit] Falha ao persistir tarefa enviada para ${target.paneId}:`, err);
    }
    coordinator.trackDelegation(message.missionId, target.paneId, target.label, taskId, message.correlationId);
  },
  onReply: (message) => coordinator.acceptReply(message),
});

let broadcast: (msg: unknown) => void = () => {};

const cleanedPanes = new Set<string>();
const cleanupPane = (paneId: string, code = 0, exitedPane?: PaneState) => {
  const isFirst = !cleanedPanes.has(paneId);
  cleanedPanes.add(paneId);
  setTimeout(() => cleanedPanes.delete(paneId), 5000);

  const pane = exitedPane ?? getPane(paneId);
  if (pane?.maestro && pane.missionId) {
    coordinator.clearDelegations(pane.missionId);
  }

  detachPane(paneId);
  if (!pane?.missionId || !coordinator.hasPendingDelegation(pane.missionId, paneId)) {
    coordinator.outputTails.delete(paneId);
  }
  coordinator.seenSignals.delete(paneId);

  if (isFirst) {
    bridge.closeConnectionsForPane(paneId);
    taskManager.handlePaneExit(paneId);
    ownershipManager.releaseLocksByPane(paneId);
  }

  broadcast({ type: "exit", paneId, code });
  if (isFirst) {
    broadcast({ type: "panes", panes: listPanes() });
    broadcast({ type: "connection:updated" });
    if (pane?.accountId) {
      broadcast({ type: "pool:updated", pools: accountPool.getView() });
    }
  }
};

const wsServer = createWebSocketServer(server, {
  continuity,
  abrirPainel: (...args) => coordinator.abrirPainel(...args),
  refreshQuota: () => coordinator.refreshQuota(),
  onPaneExit: cleanupPane,
  checkDelegations: () => coordinator.checkDelegations(),
});
broadcast = wsServer.broadcast;

mailboxManager.addListener((event, payload) => broadcast({ type: event, ...payload }));
taskManager.addListener((event, payload) => {
  if (event === "task:created" || event === "task:updated") {
    const task = (payload && typeof payload === "object" && "id" in payload && "título" in payload)
      ? payload
      : (payload as any)?.task;
    broadcast({ type: event, task } as any);
  } else if (payload && typeof payload === "object") {
    broadcast({ type: event, ...payload } as any);
  }
});

ptyManager.onOutput((paneId, data) => {
  broadcast({ type: "output", paneId, data });
  const pane = getPane(paneId);
  if (pane) {
    try {
      coordinator.observeOutput(pane, data);
    } catch (err) {
      broadcast({ type: "error", message: `Não foi possível salvar continuidade: ${String(err)}` });
    }
  }
});

ptyManager.onExit((paneId, code, pane) => {
  cleanupPane(paneId, code, pane);
});

const avisarMudanca = (path: string, base: string) => broadcast({ type: "fs-change", path, base });

// REST Router
const routerContext: RouterContext = {
  config,
  salvarConfig,
  porta,
  taskManager,
  ownershipManager,
  bridge,
  mailboxManager,
  missionModeManager,
  paneDispatcher,
  continuity,
  broadcast,
  notifyMaestro: () => coordinator.notifyMaestro(),
  abrirPainel: (...args) => coordinator.abrirPainel(...args),
  switchMaestro: (mId, cli) => coordinator.switchMaestro(mId, cli),
  saveCheckpoint: (mId, val) => coordinator.saveCheckpoint(mId, val),
  raizDe: (mId, pId) => coordinator.raizDe(mId, pId),
  limits: coordinator.limits,
  refreshQuota: () => coordinator.refreshQuota(),
  maestroStatus: () => coordinator.maestroStatus(),
  presetsDoMaestro: () => coordinator.presetsDoMaestro(),
  especialistasDaMissao: (mId) => coordinator.especialistasDaMissao(mId),
  limparElenco: (b) => coordinator.limparElenco(b),
  trackDelegation: (mId, pId, a, tId, correlationId) => coordinator.trackDelegation(mId, pId, a, tId, correlationId),
  outputTails: coordinator.outputTails,
};

app.use("/api", createApiRouter(routerContext));
app.use(express.static(webDist));
app.get("/", (_req, res, next) => {
  res.sendFile(webIndex, (error) => error ? next(error) : undefined);
});
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: err.message });
});

// File Watchers
for (const project of listProjects()) observar(project.root, avisarMudanca);

// Process error handling & Server listen
process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE" || err.syscall === "listen") {
    console.error(`[cockpit] a porta ${porta} já está em uso — saindo`);
    process.exit(1);
  }
  console.error("[cockpit] exceção ignorada:", err);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  console.error(`[cockpit] não consegui abrir a porta ${porta}: ${err.message}`);
  process.exit(1);
});

await initializePty();

// O host PTY sobrevive ao reinício do servidor; recupere as delegações ainda
// atribuídas para que respostas e alertas continuem chegando ao Maestro.
for (const pane of listPanes()) {
  if (!pane.missionId || pane.maestro) continue;
  const activeTasks = taskManager.listTasks(pane.missionId, { pane: pane.paneId })
    .filter((task) => task.status === "in-progress" || task.status === "in-review")
    .sort((a, b) => b.timestamps.atualizadaEm - a.timestamps.atualizadaEm);
  const task = activeTasks.find((candidate) => candidate.id === pane.activeTaskId) ?? activeTasks[0];
  if (!task) continue;
  updatePane(pane.paneId, { activeTaskId: task.id });
  const ask = mailboxManager.getInbox(pane.paneId, pane.missionId)
    .filter((message) => message.type === "ask" && message.taskId === task.id)
    .at(-1);
  coordinator.trackDelegation(pane.missionId, pane.paneId, pane.label, task.id, ask?.correlationId);
}

const onPronto = () => {
  console.log(`cockpit → http://localhost:${porta}`);
  if (host && host !== "localhost" && host !== "127.0.0.1") console.log(`cockpit (${host}) → http://${host}:${porta}`);
  console.log(`${listProjects().length} projeto(s) aberto(s)`);
};
if (host) server.listen(porta, host, onPronto);
else server.listen(porta, onPronto);
