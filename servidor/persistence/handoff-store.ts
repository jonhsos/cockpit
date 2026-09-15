import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DiskStore } from "./disk-store.ts";
import type { Handoff } from "./types.ts";

export class HandoffStore {
  private disk: DiskStore;

  constructor(disk: DiskStore) {
    this.disk = disk;
  }

  private handoffsFile(missionId: string): string {
    return join(this.disk.getBaseDir(), "missions", missionId, "handoffs.json");
  }

  public listHandoffs(missionId?: string): Handoff[] {
    let handoffs: Handoff[] = [];
    if (missionId) {
      handoffs = this.disk.readJson<Handoff[]>(this.handoffsFile(missionId), []);
    } else {
      const missionsDir = join(this.disk.getBaseDir(), "missions");
      if (existsSync(missionsDir)) {
        const dirs = readdirSync(missionsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
        for (const id of dirs) {
          handoffs.push(...this.disk.readJson<Handoff[]>(this.handoffsFile(id), []));
        }
      }
    }
    return handoffs;
  }

  public getHandoff(id: string, missionId?: string): Handoff | undefined {
    return this.listHandoffs(missionId).find((h) => h.id === id);
  }

  public saveHandoff(handoff: Handoff): void {
    const file = this.handoffsFile(handoff.missionId);
    const handoffs = this.disk.readJson<Handoff[]>(file, []);
    const idx = handoffs.findIndex((h) => h.id === handoff.id);
    if (idx >= 0) {
      handoffs[idx] = handoff;
    } else {
      handoffs.push(handoff);
    }
    this.disk.writeJsonAtomic(file, handoffs);
  }

  public deleteHandoff(id: string, missionId?: string): boolean {
    if (missionId) {
      const file = this.handoffsFile(missionId);
      const handoffs = this.disk.readJson<Handoff[]>(file, []);
      const filtered = handoffs.filter((h) => h.id !== id);
      if (filtered.length !== handoffs.length) {
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
      const file = this.handoffsFile(mId);
      const handoffs = this.disk.readJson<Handoff[]>(file, []);
      const filtered = handoffs.filter((h) => h.id !== id);
      if (filtered.length !== handoffs.length) {
        this.disk.writeJsonAtomic(file, filtered);
        return true;
      }
    }
    return false;
  }

  public clear(missionId?: string): void {
    if (missionId) {
      this.disk.writeJsonAtomic(this.handoffsFile(missionId), []);
      return;
    }
    const missionsDir = join(this.disk.getBaseDir(), "missions");
    if (!existsSync(missionsDir)) return;
    const dirs = readdirSync(missionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const mId of dirs) {
      this.disk.writeJsonAtomic(this.handoffsFile(mId), []);
    }
  }
}
