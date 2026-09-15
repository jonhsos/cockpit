import { getTaskManager, type TaskManager } from "../tasks/index.ts";
import { getDefaultMailboxManager, type MailboxManager } from "../connections/index.ts";
import { getDefaultMissionStore } from "../persistence/index.ts";
import { getPane, listPanes, updatePane, writePty } from "../pty.ts";
import { MissionModeManager } from "./mission-modes.ts";
import { PaneDispatcher, type DispatcherPaneProvider } from "./pane-dispatcher.ts";

export * from "./mission-modes.ts";
export * from "./pane-dispatcher.ts";
export * from "./harness.ts";
export * from "./politica-ia.ts";
export * from "./mcp-maestro.ts";
export * from "./squad.ts";
export * from "./skills.ts";
export * from "./receitas.ts";
export * from "./marketplace.ts";
export * from "./maestro-coordinator.ts";

let defaultMissionModeManager: MissionModeManager | null = null;
let defaultPaneDispatcher: PaneDispatcher | null = null;

export function getMissionModeManager(): MissionModeManager {
  if (!defaultMissionModeManager) {
    defaultMissionModeManager = new MissionModeManager(getDefaultMissionStore());
  }
  return defaultMissionModeManager;
}

export function getPaneDispatcher(options?: {
  taskManager?: TaskManager;
  mailboxManager?: MailboxManager;
  paneProvider?: DispatcherPaneProvider;
  onEvent?: (type: string, payload: unknown) => void;
}): PaneDispatcher {
  if (!defaultPaneDispatcher || options) {
    const tm = options?.taskManager ?? getTaskManager();
    const mm = options?.mailboxManager ?? getDefaultMailboxManager();
    const pp = options?.paneProvider ?? {
      getPane: (id: string) => getPane(id) as any,
      listPanes: () => listPanes() as any,
      updatePane: (id: string, upd: any) => updatePane(id, upd),
      writePane: (id: string, data: string) => writePty(id, data),
    };
    defaultPaneDispatcher = new PaneDispatcher(tm, mm, pp, options?.onEvent);
  }
  return defaultPaneDispatcher;
}

export function resetOrchestrationSingletons(): void {
  defaultMissionModeManager = null;
  defaultPaneDispatcher = null;
}
