import { join } from "node:path";
import type { DiskStore } from "./disk-store.ts";
import type { LayoutRecord } from "./types.ts";

export class LayoutStore {
  private disk: DiskStore;

  constructor(disk: DiskStore) {
    this.disk = disk;
  }

  private layoutFile(missionId: string): string {
    return join(this.disk.getBaseDir(), "missions", missionId, "layout.json");
  }

  public getLayout(missionId: string): LayoutRecord {
    const file = this.layoutFile(missionId);
    return this.disk.readJson<LayoutRecord>(file, {
      missionId,
      colunas: "auto",
      paneOrder: [],
      selectedPaneId: null,
      sidebarTab: "missoes",
      taskBoardCollapsed: false,
      atualizadoEm: Date.now(),
    });
  }

  public saveLayout(layout: LayoutRecord): void {
    layout.atualizadoEm = Date.now();
    const file = this.layoutFile(layout.missionId);
    this.disk.writeJsonAtomic(file, layout);
  }
}
