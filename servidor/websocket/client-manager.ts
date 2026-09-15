import type { WebSocket } from "ws";
import { sanitize } from "../security/sanitizer.ts";

export class ClientManager {
  private clients = new Set<WebSocket>();

  public register(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
    ws.on("error", () => this.clients.delete(ws));
  }

  public unregister(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  public get count(): number {
    return this.clients.size;
  }

  public getClients(): Set<WebSocket> {
    return this.clients;
  }

  public send(ws: WebSocket, msg: unknown): void {
    try {
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(this.formatMessage(msg));
      }
    } catch {
      // Defensive: ignore send failures on dropping sockets
    }
  }

  public broadcast(msg: unknown, filter?: (ws: WebSocket) => boolean): void {
    try {
      const safe = this.formatMessage(msg);
      for (const client of this.clients) {
        try {
          if (client && client.readyState === client.OPEN && (!filter || filter(client))) {
            client.send(safe);
          }
        } catch {
          // Socket error on one client must never affect other clients
        }
      }
    } catch {
      // Defensive
    }
  }

  public closeAll(): void {
    for (const ws of this.clients) {
      try {
        ws.close();
      } catch {
        // Best effort
      }
    }
    this.clients.clear();
  }

  private formatMessage(msg: unknown): string {
    try {
      if (msg && typeof msg === "object" && (msg as { type?: string }).type === "output") {
        const outputMsg = msg as { type: string; paneId?: string; data?: string };
        if (typeof outputMsg.data === "string") {
          return JSON.stringify({
            ...outputMsg,
            data: sanitize(outputMsg.data),
          });
        }
      }
      return JSON.stringify(msg);
    } catch {
      return JSON.stringify({ type: "error", message: "Falha na serialização da mensagem" });
    }
  }
}
