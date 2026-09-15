import { posix } from "node:path";
import { randomUUID } from "node:crypto";
import type { FileLock, LockMode, LockResult } from "./task-types.ts";
import { OwnershipStore } from "../persistence/ownership-store.ts";

export class FileOwnershipManager {
  private locks: Map<string, FileLock> = new Map(); // key: `${missionId}:${normalizedPath}:${taskId}`
  private onCollision?: (payload: { file: string; missionId: string; locks: FileLock[] }) => void;
  private ownershipStore?: OwnershipStore;

  constructor(options?: {
    onCollision?: (payload: { file: string; missionId: string; locks: FileLock[] }) => void;
    ownershipStore?: OwnershipStore;
  } | OwnershipStore) {
    if (options && "getOwnershipState" in options) {
      this.ownershipStore = options;
    } else if (options) {
      this.onCollision = options.onCollision;
      this.ownershipStore = options.ownershipStore;
    }
    if (!this.ownershipStore) {
      this.ownershipStore = OwnershipStore.getDefaultStore();
    }
    this.reloadFromStore();
  }

  public setOwnershipStore(store: OwnershipStore): void {
    this.ownershipStore = store;
    this.reloadFromStore();
  }

  public getOwnershipStore(): OwnershipStore | undefined {
    return this.ownershipStore;
  }

  public reloadFromStore(): void {
    if (!this.ownershipStore) return;
    try {
      const persistedLocks = this.ownershipStore.listAllLocks();
      for (const lock of persistedLocks) {
        const file = this.normalizePath(lock.file || lock.filePath || "");
        if (!file || !lock.taskId || !lock.missionId) continue;
        const lockKey = `${lock.missionId}:${file}:${lock.taskId}`;
        this.locks.set(lockKey, {
          ...lock,
          file,
          filePath: file,
        });
      }
    } catch {
      // Best-effort reload
    }
  }

  public normalizePath(filePath: string): string {
    const forward = filePath.replace(/\\/g, "/");
    const normalized = posix.normalize(forward);
    return normalized.replace(/^\/+/, "");
  }

  public acquireLock(options: {
    missionId: string;
    taskId: string;
    paneId?: string | null;
    files: string[];
    mode: LockMode;
    owner?: string;
  }): LockResult {
    const { missionId, taskId, paneId = null, files, mode, owner = "unknown" } = options;
    const normalizedFiles = Array.from(
      new Set(files.map((f) => this.normalizePath(f)).filter(Boolean))
    );

    const conflictFiles: string[] = [];
    const conflictLocks: FileLock[] = [];

    // Check existing locks across all requested files
    for (const file of normalizedFiles) {
      const existing = this.getLocksForFile(missionId, file);
      const foreignLocks = existing.filter((l) => l.taskId !== taskId);

      if (foreignLocks.length > 0) {
        // In isolated mode: any lock (isolated or shared) held by another task blocks acquisition
        // If an existing lock is isolated, it also blocks
        if (mode === "isolated" || foreignLocks.some((l) => l.mode === "isolated")) {
          conflictFiles.push(file);
          conflictLocks.push(...foreignLocks);
        } else {
          // Both are shared: collision warning
          conflictFiles.push(file);
          conflictLocks.push(...foreignLocks);
        }
      }
    }

    const hasIsolatedConflict =
      mode === "isolated" || conflictLocks.some((l) => l.mode === "isolated");

    if (hasIsolatedConflict && conflictFiles.length > 0) {
      return {
        ok: false,
        locked: false,
        mode,
        conflictFiles,
        conflictLocks,
        message: `Conflito: arquivos já bloqueados em modo isolado por outra tarefa: ${conflictFiles.join(", ")}`,
      };
    }

    const now = Date.now();
    for (const file of normalizedFiles) {
      const lockKey = `${missionId}:${file}:${taskId}`;
      const lock: FileLock = {
        id: `lock-${now}-${randomUUID().slice(0, 6)}`,
        file,
        filePath: file,
        missionId,
        taskId,
        paneId,
        owner,
        mode,
        acquiredAt: now,
      };
      this.locks.set(lockKey, lock);
      if (this.ownershipStore) {
        this.ownershipStore.saveLock(lock);
      }
    }

    if (conflictFiles.length > 0) {
      if (this.onCollision) {
        for (const file of conflictFiles) {
          const allLocks = this.getLocksForFile(missionId, file);
          this.onCollision({ file, missionId, locks: allLocks });
        }
      }
      return {
        ok: true,
        locked: true,
        mode: "shared",
        conflictFiles,
        conflictLocks,
        warning: `Colisão detectada para arquivos compartilhados: ${conflictFiles.join(", ")}`,
      };
    }

    return {
      ok: true,
      locked: true,
      mode,
    };
  }

  public releaseLock(taskId: string, files?: string[]): { released: string[] } {
    const released: string[] = [];
    const normalizedFiles = files
      ? new Set(files.map((f) => this.normalizePath(f)))
      : null;

    for (const [key, lock] of Array.from(this.locks.entries())) {
      if (lock.taskId === taskId) {
        if (!normalizedFiles || normalizedFiles.has(lock.file)) {
          this.locks.delete(key);
          released.push(lock.file);
          if (this.ownershipStore) {
            this.ownershipStore.removeLock(lock.missionId, lock.file, lock.taskId);
          }
        }
      }
    }

    return { released };
  }

  public releaseLocksByPane(paneId: string): { released: string[] } {
    const released: string[] = [];
    for (const [key, lock] of Array.from(this.locks.entries())) {
      if (lock.paneId === paneId) {
        this.locks.delete(key);
        released.push(lock.file);
        if (this.ownershipStore) {
          this.ownershipStore.removeLock(lock.missionId, lock.file, lock.taskId);
        }
      }
    }
    return { released };
  }

  public transferLock(taskId: string, newPaneId: string, newOwner?: string): void {
    for (const lock of this.locks.values()) {
      if (lock.taskId === taskId) {
        lock.paneId = newPaneId;
        if (newOwner) {
          lock.owner = newOwner;
        }
        if (this.ownershipStore) {
          this.ownershipStore.saveLock(lock);
        }
      }
    }
  }

  public checkAccess(
    missionId: string,
    filePath: string,
    context?: { taskId?: string; paneId?: string }
  ): { allowed: boolean; conflict?: FileLock; warning?: string } {
    const normalized = this.normalizePath(filePath);
    const existing = this.getLocksForFile(missionId, normalized);

    if (existing.length === 0) {
      return { allowed: true };
    }

    for (const lock of existing) {
      const isOwner =
        (context?.taskId && lock.taskId === context.taskId) ||
        (context?.paneId && lock.paneId === context.paneId);

      if (isOwner) continue;

      if (lock.mode === "isolated") {
        return {
          allowed: false,
          conflict: lock,
          warning: `Arquivo bloqueado com exclusividade em modo isolado pela tarefa ${lock.taskId}`,
        };
      }
    }

    const foreignLocks = existing.filter(
      (l) =>
        (!context?.taskId || l.taskId !== context.taskId) &&
        (!context?.paneId || l.paneId !== context.paneId)
    );

    if (foreignLocks.length > 0) {
      return {
        allowed: true,
        conflict: foreignLocks[0],
        warning: `Aviso: arquivo em edição concorrente no modo compartilhado`,
      };
    }

    return { allowed: true };
  }

  public getLocksForFile(missionId: string, normalizedFile: string): FileLock[] {
    const result: FileLock[] = [];
    for (const lock of this.locks.values()) {
      if (lock.missionId === missionId && lock.file === normalizedFile) {
        result.push(lock);
      }
    }
    return result;
  }

  public listLocks(missionId?: string): FileLock[] {
    const all = Array.from(this.locks.values());
    return missionId ? all.filter((l) => l.missionId === missionId) : all;
  }

  public detectCollisions(missionId?: string): { file: string; locks: FileLock[] }[] {
    const byFile = new Map<string, FileLock[]>();
    for (const lock of this.listLocks(missionId)) {
      const list = byFile.get(lock.file) ?? [];
      list.push(lock);
      byFile.set(lock.file, list);
    }

    const collisions: { file: string; locks: FileLock[] }[] = [];
    for (const [file, locks] of byFile.entries()) {
      const uniqueTasks = new Set(locks.map((l) => l.taskId));
      if (uniqueTasks.size > 1) {
        collisions.push({ file, locks });
      }
    }
    return collisions;
  }

  public clear(missionId?: string): void {
    if (missionId) {
      for (const [key, lock] of Array.from(this.locks.entries())) {
        if (lock.missionId === missionId) {
          this.locks.delete(key);
        }
      }
    } else {
      this.locks.clear();
    }
    if (this.ownershipStore) {
      this.ownershipStore.clear(missionId);
    }
  }
}
