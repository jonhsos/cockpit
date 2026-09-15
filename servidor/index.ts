import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { config, salvarConfig } from "./config.ts";
import { Continuity } from "./missions/continuity.ts";
import { getPane, listPanes, initializePty, getDefaultPtyManager } from "./pty.ts";
import { CASA, detachPane, getProject, listMissions, listProjects } from "./state.ts";
import { observar } from "./missions/watcher.ts";
import { getDefaultBridge, getDefaultMailboxManager } from "./connections/index.ts";
import { getTaskManager, getFileOwnershipManager } from "./tasks/index.ts";
import { getMissionModeManager, getPaneDispatcher, MaestroCoordinator } from "./orchestration/index.ts";
import { createWebSocketServer } from "./websocket/index.ts";
import { createApiRouter, type RouterContext } from "./routes/index.ts";

const porta = Number(process.env.COCKPIT_PORTA) || config.port;
const app = express();
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
  paneProvider: { getPane: (id) => getPane(id), listPanes: () => listPanes() },
});

// Coordinator & WebSocket Server
const coordinator = new MaestroCoordinator({
  continuity,
  broadcast: (msg) => wsServer.broadcast(msg),
  porta,
});

let broadcast: (msg: unknown) => void = () => {};

const cleanedPanes = new Set<string>();
const cleanupPane = (paneId: string, code = 0) => {
  const isFirst = !cleanedPanes.has(paneId);
  cleanedPanes.add(paneId);
  setTimeout(() => cleanedPanes.delete(paneId), 5000);

  const pane = getPane(paneId);
  if (pane?.maestro && pane.missionId) {
    coordinator.clearDelegations(pane.missionId);
  }

  detachPane(paneId);
  coordinator.outputTails.delete(paneId);
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

ptyManager.onExit((paneId, code) => {
  cleanupPane(paneId, code);
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
  trackDelegation: (mId, pId, a) => coordinator.trackDelegation(mId, pId, a),
  outputTails: coordinator.outputTails,
};

app.use("/api", createApiRouter(routerContext));
app.use(express.static(fileURLToPath(new URL("../web/dist", import.meta.url))));
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: err.message });
});

// File Watchers
for (const project of listProjects()) observar(project.root, avisarMudanca);
for (const mission of listMissions()) {
  if (getProject(mission.projectId)) observar(mission.worktree, avisarMudanca);
}

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

server.listen(porta, () => {
  console.log(`cockpit → http://localhost:${porta}`);
  console.log(`${listProjects().length} projeto(s) aberto(s)`);
});
