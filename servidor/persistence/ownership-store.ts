import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DiskStore } from "./disk-store.ts";
import type { FileLock, FileOwnershipState } from "./types.ts";

export class OwnershipStore {
  private disk: DiskStore;
  private static defaultStore?: OwnershipStore;

  constructor(disk: DiskStore) {
    this.disk = disk;
    OwnershipStore.defaultStore = this;
  }

  public static getDefaultStore(): OwnershipStore | undefined {
    return OwnershipStore.defaultStore;
  }

  public static setDefaultStore(store: OwnershipStore | undefined): void {
    OwnershipStore.defaultStore = store;
  }

  private ownershipFile(missionId: string): string {
    return join(this.disk.getBaseDir(), "missions", missionId, "ownership.json");
  }

  public getOwnershipState(missionId: string): FileOwnershipState {
    const file = this.ownershipFile(missionId);
    return this.disk.readJson<FileOwnershipState>(file, {
      missionId,
      mode: "shared",
      locks: {},
      collisionWarnings: [],
    });
  }

  public saveOwnershipState(state: FileOwnershipState): void {
    const file = this.ownershipFile(state.missionId);
    this.disk.writeJsonAtomic(file, state);
  }

  public saveLock(lock: FileLock): void {
    const state = this.getOwnershipState(lock.missionId);
    const key = lock.file || lock.filePath || "";
    if (!key) return;

    const normalizedLock: FileLock = {
      ...lock,
      file: key,
      filePath: key,
    };

    // Key locks by ${filePath}::${taskId} so concurrent shared locks do not overwrite each other
    const compoundKey = `${key}::${lock.taskId}`;
    state.locks[compoundKey] = normalizedLock;

    // Maintain single-file alias if and only if exactly 1 lock exists on this file
    const fileEntries = Object.entries(state.locks).filter(
      ([k, l]) => l && (l.file === key || l.filePath === key) && k.includes("::")
    );

    if (fileEntries.length === 1) {
      state.locks[key] = normalizedLock;
    } else {
      delete state.locks[key];
    }

    this.saveOwnershipState(state);
  }

  public removeLock(missionId: string, filePath: string, taskId?: string): void {
    const state = this.getOwnershipState(missionId);
    let changed = false;

    if (taskId) {
      const compoundKey = `${filePath}::${taskId}`;
      if (state.locks[compoundKey]) {
        delete state.locks[compoundKey];
        changed = true;
      }
    } else {
      for (const [k, l] of Object.entries(state.locks)) {
        if (
          k === filePath ||
          k.startsWith(`${filePath}::`) ||
          (l && (l.file === filePath || l.filePath === filePath))
        ) {
          delete state.locks[k];
          changed = true;
        }
      }
    }

    const remainingLocks = Object.entries(state.locks)
      .filter(([k, l]) => l && (l.file === filePath || l.filePath === filePath) && k.includes("::"))
      .map(([_, l]) => l);

    if (remainingLocks.length === 1) {
      state.locks[filePath] = remainingLocks[0];
      changed = true;
    } else if (remainingLocks.length === 0 && state.locks[filePath]) {
      delete state.locks[filePath];
      changed = true;
    }

    if (changed) {
      this.saveOwnershipState(state);
    }
  }

  public listAllLocks(): FileLock[] {
    const missionsDir = join(this.disk.getBaseDir(), "missions");
    if (!existsSync(missionsDir)) return [];
    try {
      const dirs = readdirSync(missionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      const seen = new Set<string>();
      const allLocks: FileLock[] = [];
      for (const mId of dirs) {
        const state = this.getOwnershipState(mId);
        for (const [_, lock] of Object.entries(state.locks)) {
          if (!lock || !lock.id) continue;
          if (!seen.has(lock.id)) {
            seen.add(lock.id);
            allLocks.push(lock);
          }
        }
      }
      return allLocks;
    } catch {
      return [];
    }
  }

  public clear(missionId?: string): void {
    if (missionId) {
      this.saveOwnershipState({
        missionId,
        mode: "shared",
        locks: {},
        collisionWarnings: [],
      });
      return;
    }

    const missionsDir = join(this.disk.getBaseDir(), "missions");
    if (!existsSync(missionsDir)) return;
    const dirs = readdirSync(missionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const mId of dirs) {
      this.saveOwnershipState({
        missionId: mId,
        mode: "shared",
        locks: {},
        collisionWarnings: [],
      });
    }
  }
}
