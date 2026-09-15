import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DiskStore } from "./disk-store.ts";
import type { Connection } from "./types.ts";

export class ConnectionStore {
  private disk: DiskStore;

  constructor(disk: DiskStore) {
    this.disk = disk;
  }

  private connFile(missionId: string): string {
    return join(this.disk.getBaseDir(), "missions", missionId, "connections.json");
  }

  public listConnections(missionId?: string): Connection[] {
    let conns: Connection[] = [];
    if (missionId) {
      conns = this.disk.readJson<Connection[]>(this.connFile(missionId), []);
    } else {
      const missionsDir = join(this.disk.getBaseDir(), "missions");
      if (existsSync(missionsDir)) {
        const dirs = readdirSync(missionsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
        for (const id of dirs) {
          conns.push(...this.disk.readJson<Connection[]>(this.connFile(id), []));
        }
      }
    }
    return conns;
  }

  public getConnection(id: string, missionId?: string): Connection | undefined {
    return this.listConnections(missionId).find((c) => c.id === id);
  }

  public saveConnection(conn: Connection): void {
    const file = this.connFile(conn.missionId);
    const conns = this.disk.readJson<Connection[]>(file, []);
    const idx = conns.findIndex((c) => c.id === conn.id);
    if (idx >= 0) {
      conns[idx] = conn;
    } else {
      conns.push(conn);
    }
    this.disk.writeJsonAtomic(file, conns);
  }

  public deleteConnection(id: string, missionId?: string): boolean {
    if (missionId) {
      const file = this.connFile(missionId);
      const conns = this.disk.readJson<Connection[]>(file, []);
      const filtered = conns.filter((c) => c.id !== id);
      if (filtered.length !== conns.length) {
        this.disk.writeJsonAtomic(file, filtered);
        return true;
      }
      return false;
    }

    const missionsDir = join(this.disk.getBaseDir(), "missions");
    if (!existsSync(missionsDir)) return false;
    const dirs = readdirSync(missionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const mId of dirs) {
      const file = this.connFile(mId);
      const conns = this.disk.readJson<Connection[]>(file, []);
      const filtered = conns.filter((c) => c.id !== id);
      if (filtered.length !== conns.length) {
        this.disk.writeJsonAtomic(file, filtered);
        return true;
      }
    }
    return false;
  }

  public clear(missionId?: string): void {
    if (missionId) {
      this.disk.writeJsonAtomic(this.connFile(missionId), []);
      return;
    }
    const missionsDir = join(this.disk.getBaseDir(), "missions");
    if (!existsSync(missionsDir)) return;
    const dirs = readdirSync(missionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const mId of dirs) {
      this.disk.writeJsonAtomic(this.connFile(mId), []);
    }
  }
}
