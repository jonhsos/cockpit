import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DiskStore } from "./disk-store.ts";
import type { PaneRecord, PaneStatus } from "./types.ts";

export class PaneStore {
  private disk: DiskStore;
  private panesDir: string;

  constructor(disk: DiskStore) {
    this.disk = disk;
    this.panesDir = join(disk.getBaseDir(), "panes");
    disk.ensureDir(this.panesDir);
  }

  private paneFile(paneId: string): string {
    return join(this.panesDir, `${paneId}.json`);
  }

  public savePane(record: PaneRecord): void {
    record.atualizadoEm = Date.now();
    this.disk.writeJsonAtomic(this.paneFile(record.paneId), record);
  }

  public getPane(paneId: string): PaneRecord | undefined {
    const file = this.paneFile(paneId);
    if (!existsSync(file)) return undefined;
    const record = this.disk.readJson<PaneRecord | null>(file, null);
    return record ?? undefined;
  }

  public listPanes(missionId?: string): PaneRecord[] {
    if (!existsSync(this.panesDir)) return [];
    const files = readdirSync(this.panesDir).filter((f) => f.endsWith(".json"));
    const panes: PaneRecord[] = [];
    for (const f of files) {
      const record = this.disk.readJson<PaneRecord | null>(join(this.panesDir, f), null);
      if (record) {
        if (!missionId || record.missionId === missionId) {
          panes.push(record);
        }
      }
    }
    return panes;
  }

  public deletePane(paneId: string): void {
    const file = this.paneFile(paneId);
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch {
        // Best effort
      }
    }
  }

  public updatePaneStatus(paneId: string, status: PaneStatus): void {
    const pane = this.getPane(paneId);
    if (pane) {
      pane.status = status;
      this.savePane(pane);
    }
  }
}
