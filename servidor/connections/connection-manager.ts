import type { ConnectionStore } from "../persistence/connection-store.ts";
import type { Connection } from "./connection-types.ts";

export class ConnectionManager {
  private store: ConnectionStore;

  constructor(store: ConnectionStore) {
    this.store = store;
  }

  public connectPanes(
    sourcePaneId: string,
    targetPaneId: string,
    missionId = "default",
    config?: Connection["config"],
  ): Connection {
    if (!sourcePaneId || !targetPaneId) {
      throw new Error("Both sourcePaneId and targetPaneId are required to establish a connection");
    }
    if (sourcePaneId === targetPaneId) {
      throw new Error("Cannot connect a pane to itself");
    }

    // Check for existing connection (idempotency)
    const existing = this.store
      .listConnections(missionId)
      .find(
        (c) =>
          c.missionId === missionId &&
          ((c.sourcePaneId === sourcePaneId && c.targetPaneId === targetPaneId) ||
            (c.sourcePaneId === targetPaneId && c.targetPaneId === sourcePaneId)) &&
          c.status === "active",
      );

    if (existing) {
      return existing;
    }

    const connId = `conn-${sourcePaneId}-${targetPaneId}`;
    const newConn: Connection = {
      id: connId,
      missionId,
      sourcePaneId,
      targetPaneId,
      criadaEm: Date.now(),
      status: "active",
      config: config ?? {
        allowAsk: true,
        allowReply: true,
        allowHandoff: true,
      },
    };

    this.store.saveConnection(newConn);
    return newConn;
  }

  public disconnectPanes(connectionId: string, missionId?: string): boolean {
    const conn = this.store.getConnection(connectionId, missionId);
    if (!conn) return false;
    conn.status = "closed";
    this.store.saveConnection(conn);
    return true;
  }

  public closeConnectionsForPane(paneId: string): Connection[] {
    const closed: Connection[] = [];
    const conns = this.store.listConnections();
    for (const conn of conns) {
      if (
        conn.status === "active" &&
        (conn.sourcePaneId === paneId || conn.targetPaneId === paneId)
      ) {
        conn.status = "closed";
        this.store.saveConnection(conn);
        closed.push(conn);
      }
    }
    return closed;
  }

  public listConnections(missionId?: string): Connection[] {
    return this.store.listConnections(missionId);
  }

  public getConnection(id: string, missionId?: string): Connection | undefined {
    return this.store.getConnection(id, missionId);
  }

  public isConnected(
    sourcePaneId: string,
    targetPaneId: string,
    missionId?: string,
  ): boolean {
    return this.store
      .listConnections(missionId)
      .some(
        (c) =>
          c.status === "active" &&
          ((c.sourcePaneId === sourcePaneId && c.targetPaneId === targetPaneId) ||
            (c.sourcePaneId === targetPaneId && c.targetPaneId === sourcePaneId)),
      );
  }

  public clear(missionId?: string): void {
    this.store.clear(missionId);
  }
}
