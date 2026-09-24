import { DiskStore } from "../persistence/disk-store.ts";
import {
  getDefaultDiskStore,
  getDefaultConnectionStore,
  getDefaultHandoffStore,
} from "../persistence/index.ts";
import { getTaskManager, type TaskManager } from "../tasks/index.ts";
import { getPane, listPanes, writePty } from "../pty.ts";
import { MailboxStore } from "./mailbox-store.ts";
import { MailboxManager } from "./mailbox-manager.ts";
import { ConnectionManager } from "./connection-manager.ts";
import { HandoffManager } from "./handoff-manager.ts";
import { InterAgentBridge, type BridgePaneProvider } from "./inter-agent-bridge.ts";

export * from "./connection-types.ts";
export * from "./mailbox-store.ts";
export * from "./mailbox-manager.ts";
export * from "./connection-manager.ts";
export * from "./handoff-manager.ts";
export * from "./inter-agent-bridge.ts";
export * from "./connection-routes.ts";
export * from "./cockpit-cli.ts";
export * from "./rede.ts";

let defaultMailboxManager: MailboxManager | null = null;
let defaultConnectionManager: ConnectionManager | null = null;
let defaultHandoffManager: HandoffManager | null = null;
let defaultBridge: InterAgentBridge | null = null;

export function getDefaultMailboxManager(disk?: DiskStore): MailboxManager {
  if (!defaultMailboxManager) {
    const store = new MailboxStore(disk ?? getDefaultDiskStore());
    defaultMailboxManager = new MailboxManager(store);
  }
  return defaultMailboxManager;
}

export function getDefaultConnectionManager(disk?: DiskStore): ConnectionManager {
  if (!defaultConnectionManager) {
    defaultConnectionManager = new ConnectionManager(getDefaultConnectionStore(disk));
  }
  return defaultConnectionManager;
}

export function getDefaultHandoffManager(disk?: DiskStore, taskManager?: TaskManager): HandoffManager {
  if (!defaultHandoffManager) {
    const handoffStore = getDefaultHandoffStore(disk);
    const tm = taskManager ?? getTaskManager();
    const mm = getDefaultMailboxManager(disk);
    defaultHandoffManager = new HandoffManager(handoffStore, tm, mm, (id) => getPane(id));
  }
  return defaultHandoffManager;
}

export function getDefaultBridge(options?: {
  mailboxManager?: MailboxManager;
  connectionManager?: ConnectionManager;
  handoffManager?: HandoffManager;
  taskManager?: TaskManager;
  paneProvider?: BridgePaneProvider;
}): InterAgentBridge {
  if (!defaultBridge || options) {
    const mm = options?.mailboxManager ?? getDefaultMailboxManager();
    const cm = options?.connectionManager ?? getDefaultConnectionManager();
    const tm = options?.taskManager ?? getTaskManager();
    const hm = options?.handoffManager ?? getDefaultHandoffManager(undefined, tm);
    const pp = options?.paneProvider ?? {
      getPane: (id: string) => getPane(id),
      listPanes: () => listPanes(),
      writePane: (id: string, data: string) => writePty(id, data),
    };
    defaultBridge = new InterAgentBridge(mm, cm, hm, pp, tm);
  }
  return defaultBridge;
}

export function resetConnectionSingletons(): void {
  defaultMailboxManager = null;
  defaultConnectionManager = null;
  defaultHandoffManager = null;
  defaultBridge = null;
}
