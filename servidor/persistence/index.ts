import { homedir } from "node:os";
import { join } from "node:path";
import { DiskStore } from "./disk-store.ts";
import { MissionStore } from "./mission-store.ts";
import { PaneStore } from "./pane-store.ts";
import { TaskStore } from "./task-store.ts";
import { ConnectionStore } from "./connection-store.ts";
import { OwnershipStore } from "./ownership-store.ts";
import { HandoffStore } from "./handoff-store.ts";
import { LayoutStore } from "./layout-store.ts";
import { HistoryStore } from "./history-store.ts";

export * from "./types.ts";
export * from "./disk-store.ts";
export * from "./mission-store.ts";
export * from "./pane-store.ts";
export * from "./task-store.ts";
export * from "./connection-store.ts";
export * from "./ownership-store.ts";
export * from "./handoff-store.ts";
export * from "./layout-store.ts";
export * from "./history-store.ts";
export * from "./migration.ts";
export * from "./recovery.ts";

export function getCockpitHome(): string {
  return process.env.COCKPIT_HOME ?? join(homedir(), ".cockpit");
}

let defaultDiskStore: DiskStore | null = null;
let defaultMissionStore: MissionStore | null = null;
let defaultPaneStore: PaneStore | null = null;
let defaultTaskStore: TaskStore | null = null;
let defaultConnectionStore: ConnectionStore | null = null;
let defaultOwnershipStore: OwnershipStore | null = null;
let defaultHandoffStore: HandoffStore | null = null;
let defaultLayoutStore: LayoutStore | null = null;
let defaultHistoryStore: HistoryStore | null = null;

export function getDefaultDiskStore(baseDir?: string): DiskStore {
  const dir = baseDir ?? getCockpitHome();
  if (!defaultDiskStore || defaultDiskStore.getBaseDir() !== dir) {
    defaultDiskStore = new DiskStore(dir);
  }
  return defaultDiskStore;
}

export function getDefaultMissionStore(disk?: DiskStore): MissionStore {
  const d = disk ?? getDefaultDiskStore();
  if (!defaultMissionStore) {
    defaultMissionStore = new MissionStore(d);
  }
  return defaultMissionStore;
}

export function getDefaultPaneStore(disk?: DiskStore): PaneStore {
  const d = disk ?? getDefaultDiskStore();
  if (!defaultPaneStore) {
    defaultPaneStore = new PaneStore(d);
  }
  return defaultPaneStore;
}

export function getDefaultTaskStore(disk?: DiskStore): TaskStore {
  const d = disk ?? getDefaultDiskStore();
  if (!defaultTaskStore) {
    defaultTaskStore = new TaskStore(d);
  }
  return defaultTaskStore;
}

export function getDefaultConnectionStore(disk?: DiskStore): ConnectionStore {
  const d = disk ?? getDefaultDiskStore();
  if (!defaultConnectionStore) {
    defaultConnectionStore = new ConnectionStore(d);
  }
  return defaultConnectionStore;
}

export function getDefaultOwnershipStore(disk?: DiskStore): OwnershipStore {
  const d = disk ?? getDefaultDiskStore();
  if (!defaultOwnershipStore) {
    defaultOwnershipStore = new OwnershipStore(d);
  }
  return defaultOwnershipStore;
}

export function getDefaultHandoffStore(disk?: DiskStore): HandoffStore {
  const d = disk ?? getDefaultDiskStore();
  if (!defaultHandoffStore) {
    defaultHandoffStore = new HandoffStore(d);
  }
  return defaultHandoffStore;
}

export function getDefaultLayoutStore(disk?: DiskStore): LayoutStore {
  const d = disk ?? getDefaultDiskStore();
  if (!defaultLayoutStore) {
    defaultLayoutStore = new LayoutStore(d);
  }
  return defaultLayoutStore;
}

export function getDefaultHistoryStore(disk?: DiskStore): HistoryStore {
  const d = disk ?? getDefaultDiskStore();
  if (!defaultHistoryStore) {
    defaultHistoryStore = new HistoryStore(d);
  }
  return defaultHistoryStore;
}

export function resetPersistenceSingletons(): void {
  defaultDiskStore = null;
  defaultMissionStore = null;
  defaultPaneStore = null;
  defaultTaskStore = null;
  defaultConnectionStore = null;
  defaultOwnershipStore = null;
  defaultHandoffStore = null;
  defaultLayoutStore = null;
  defaultHistoryStore = null;
}
