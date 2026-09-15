import type { WebSocket } from "ws";
import type { ClientManager } from "./client-manager.ts";
import type { Continuity } from "../missions/continuity.ts";
import { getPane, killPty, resizePty, writePty, replayPane } from "../pty.ts";
import { detachPane } from "../state.ts";

export class TerminalHandler {
  private clientManager: ClientManager;
  private continuity: Continuity;
  private onPaneExit?: (paneId: string, code?: number) => void;

  constructor(
    clientManager: ClientManager,
    continuity: Continuity,
    onPaneExit?: (paneId: string, code?: number) => void,
  ) {
    this.clientManager = clientManager;
    this.continuity = continuity;
    this.onPaneExit = onPaneExit;
  }

  public handleInput(paneId: string, data: string): void {
    if (typeof paneId !== "string" || !paneId) return;
    if (typeof data !== "string") return;
    try {
      const pane = getPane(paneId);
      if (pane?.missionId) {
        this.continuity.record(pane.missionId, pane.paneId, "input", data);
      }
      writePty(paneId, data);
    } catch {
      // Safely ignore input errors on closed or missing panes
    }
  }

  public handleResize(paneId: string, cols: number, rows: number): void {
    if (typeof paneId !== "string" || !paneId) return;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return;
    try {
      resizePty(paneId, cols, rows);
    } catch {
      // Safely ignore resize errors on dead panes
    }
  }

  public handleKill(paneId: string): void {
    if (typeof paneId !== "string" || !paneId) return;
    try {
      if (getPane(paneId)) {
        killPty(paneId);
        if (this.onPaneExit) {
          this.onPaneExit(paneId, 0);
        } else {
          detachPane(paneId);
          this.clientManager.broadcast({ type: "exit", paneId, code: 0 });
        }
      }
    } catch {
      // Safely ignore kill errors
    }
  }

  public async handleAttachOrReplay(ws: WebSocket, paneId: string): Promise<void> {
    if (typeof paneId !== "string" || !paneId) return;
    try {
      const scrollback = await replayPane(paneId);
      if (scrollback && ws.readyState === ws.OPEN) {
        this.clientManager.send(ws, { type: "output", paneId, data: scrollback });
        this.clientManager.send(ws, { type: "replay", paneId, scrollback });
      }
    } catch {
      // Pane may not exist or have closed
    }
  }
}
