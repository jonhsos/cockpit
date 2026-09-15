import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ClientManager } from "./client-manager.ts";
import { TerminalHandler } from "./terminal-handler.ts";
import { WsDispatcher } from "./ws-dispatcher.ts";
import type { Continuity } from "../missions/continuity.ts";
import { listPanes, tick, replayPane, type PaneState } from "../pty.ts";
import type { Pedido } from "../orchestration/harness.ts";
import { readUsage } from "../usage.ts";

export interface WsServerContext {
  continuity: Continuity;
  abrirPainel: (
    agent: string,
    missionId: string,
    tarefa?: string,
    harness?: Omit<Pedido, "agent">,
    skills?: string[],
    maestroOverride?: boolean,
    accountOpts?: { preferredAccountId?: string; accountPinned?: boolean },
  ) => PaneState;
  refreshQuota: () => Promise<void>;
  onPaneExit?: (paneId: string, code?: number) => void;
  checkDelegations?: () => void;
}

export function createWebSocketServer(
  server: HttpServer,
  context: WsServerContext,
): {
  wss: WebSocketServer;
  clientManager: ClientManager;
  terminalHandler: TerminalHandler;
  dispatcher: WsDispatcher;
  broadcast: (msg: unknown) => void;
  close: () => Promise<void>;
} {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const clientManager = new ClientManager();
  const terminalHandler = new TerminalHandler(clientManager, context.continuity, context.onPaneExit);
  const dispatcher = new WsDispatcher(clientManager, terminalHandler, context);

  wss.on("connection", async (ws: WebSocket) => {
    clientManager.register(ws);
    clientManager.send(ws, { type: "panes", panes: listPanes() });

    // Replay scrollback of active panes if applicable
    for (const p of listPanes()) {
      try {
        const scrollback = await replayPane(p.paneId);
        if (scrollback && ws.readyState === ws.OPEN) {
          clientManager.send(ws, { type: "output", paneId: p.paneId, data: scrollback });
        }
      } catch {
        // Best effort
      }
    }

    ws.on("message", async (buf) => {
      try {
        await dispatcher.dispatch(buf, ws);
      } catch (err) {
        clientManager.send(ws, {
          type: "error",
          message: err instanceof Error ? err.message : "Erro interno ao processar mensagem",
        });
      }
    });

    ws.on("error", () => {
      // Defensive: do not crash on unhandled client error
    });
  });

  // Background daemons with unref & cleanup
  const timerQuota = setInterval(() => {
    if (listPanes().some((p) => p.cli === "codex")) {
      void context.refreshQuota().catch(() => {});
    }
  }, 60000);
  timerQuota.unref?.();

  const timerPulse = setInterval(() => {
    try {
      const pulsos: { paneId: string; status: string; atividade: number[]; blockedReason?: string | null }[] = [];
      tick((s) => {
        pulsos.push({
          paneId: s.paneId,
          status: s.status,
          atividade: s.atividade,
          blockedReason: s.blockedReason ?? null,
        });
      });
      if (pulsos.length > 0) {
        clientManager.broadcast({ type: "pulse", pulsos });
      }
      context.checkDelegations?.();
    } catch {
      // Prevent timer crash
    }
  }, 1000);
  timerPulse.unref?.();

  const timerUsage = setInterval(() => {
    try {
      const panes = listPanes().filter((p) => p.sessionId);
      if (panes.length === 0) return;
      clientManager.broadcast({
        type: "usage",
        usos: panes.map((p) => ({ paneId: p.paneId, usage: readUsage(p.sessionId) })),
      });
    } catch {
      // Prevent timer crash
    }
  }, 4000);
  timerUsage.unref?.();

  const cleanup = () => {
    clearInterval(timerQuota);
    clearInterval(timerPulse);
    clearInterval(timerUsage);
    clientManager.closeAll();
  };

  wss.on("close", cleanup);

  return {
    wss,
    clientManager,
    terminalHandler,
    dispatcher,
    broadcast: (msg: unknown) => clientManager.broadcast(msg),
    close: async () => {
      cleanup();
      return new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}

