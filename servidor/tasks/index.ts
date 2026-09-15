import { FileOwnershipManager } from "./file-ownership.ts";
import { TaskManager } from "./task-manager.ts";
import { criarTaskRoutes } from "./task-routes.ts";

export * from "./task-types.ts";
export * from "./task-state-machine.ts";
export * from "./file-ownership.ts";
export * from "./task-manager.ts";
export * from "./task-routes.ts";

let defaultOwnershipManager: FileOwnershipManager | null = null;
let defaultTaskManager: TaskManager | null = null;

export function getFileOwnershipManager(
  onCollision?: (payload: { file: string; missionId: string; locks: any[] }) => void,
  ownershipStore?: any
): FileOwnershipManager {
  if (!defaultOwnershipManager) {
    defaultOwnershipManager = new FileOwnershipManager({ onCollision, ownershipStore });
  }
  return defaultOwnershipManager;
}

export function getTaskManager(
  ownershipManager?: FileOwnershipManager,
  onEvent?: (type: string, payload: unknown) => void
): TaskManager {
  if (!defaultTaskManager) {
    const om = ownershipManager ?? getFileOwnershipManager();
    defaultTaskManager = new TaskManager(om, undefined, onEvent);
  }
  return defaultTaskManager;
}

export function resetTaskSingletons(): void {
  defaultOwnershipManager = null;
  defaultTaskManager = null;
}
