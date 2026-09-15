import type { TaskManager } from "../tasks/task-manager.ts";
import type { MailboxManager } from "../connections/mailbox-manager.ts";

export interface PaneDispatcherState {
  paneId: string;
  label?: string;
  role?: string;
  runner?: string;
  cli?: string;
  model?: string | null;
  status?: string;
  activeTaskId?: string | null;
  missionId?: string | null;
}

export interface AvailablePaneInfo {
  paneId: string;
  label: string;
  role: string;
  runner: string;
  model: string | null;
  status: string;
  activeTaskId: string | null;
  isBusy: boolean;
  canAcceptTask: boolean;
}

export interface DispatchResult {
  ok: boolean;
  taskId: string;
  paneId: string;
  status: string;
}

export interface DispatcherPaneProvider {
  getPane(id: string): PaneDispatcherState | undefined;
  listPanes(): PaneDispatcherState[];
  updatePane?(id: string, update: Partial<PaneDispatcherState>): void;
  writePane?(id: string, data: string): void;
}

export class PaneDispatcher {
  private taskManager: TaskManager;
  private mailboxManager: MailboxManager;
  private paneProvider: DispatcherPaneProvider;
  private onEvent?: (type: string, payload: unknown) => void;

  constructor(
    taskManager: TaskManager,
    mailboxManager: MailboxManager,
    paneProvider: DispatcherPaneProvider,
    onEvent?: (type: string, payload: unknown) => void,
  ) {
    this.taskManager = taskManager;
    this.mailboxManager = mailboxManager;
    this.paneProvider = paneProvider;
    this.onEvent = onEvent;
  }

  public listAvailablePanes(missionId: string): AvailablePaneInfo[] {
    const all = this.paneProvider.listPanes();
    const missionPanes = all.filter((p) => !p.missionId || p.missionId === missionId);

    return missionPanes.map((p) => {
      const status = p.status || "waiting-user";
      const isBusy = status === "working";
      const canAcceptTask = status === "waiting-user" || status === "completed" || status === "idle";

      return {
        paneId: p.paneId,
        label: p.label || p.paneId,
        role: p.role || "unknown",
        runner: p.runner || p.cli || "bash",
        model: p.model ?? null,
        status,
        activeTaskId: p.activeTaskId ?? null,
        isBusy,
        canAcceptTask,
      };
    });
  }

  /**
   * Dispatches a task to an existing idle pane without spawning any new PTY processes.
   */
  public dispatchToExistingPane(
    missionId: string,
    taskId: string,
    paneId: string,
  ): DispatchResult {
    // 1. Validate task
    const task = this.taskManager.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 2. Validate pane
    const pane = this.paneProvider.getPane(paneId);
    if (!pane) {
      throw new Error(`Pane not found: ${paneId}`);
    }
    if (pane.missionId && pane.missionId !== missionId) {
      throw new Error(`Pane ${paneId} belongs to a different mission: ${pane.missionId}`);
    }

    // 3. Status checks
    const currentStatus = pane.status || "waiting-user";
    if (currentStatus === "dead" || currentStatus === "failed") {
      throw new Error(`Pane is dead or failed: cannot dispatch task to inactive pane`);
    }

    if (currentStatus === "working") {
      throw new Error(`Pane is busy: pane ${paneId} is currently working on task ${pane.activeTaskId || "another task"}`);
    }

    // 4. Assign task and transition to in-progress
    this.taskManager.assignTask(taskId, paneId, pane.label, pane.role);
    if (task.status === "todo" || task.status === "blocked") {
      this.taskManager.transitionTask(taskId, "in-progress");
    }

    // 5. Update pane state to working
    pane.activeTaskId = taskId;
    pane.status = "working";
    if (this.paneProvider.updatePane) {
      this.paneProvider.updatePane(paneId, { activeTaskId: taskId, status: "working" });
    }

    // 6. Enqueue task instruction into pane mailbox
    const prompt = task.descrição ? `${task.título}\n\n${task.descrição}` : task.título;
    this.mailboxManager.enqueue({
      from: "maestro",
      to: paneId,
      type: "ask",
      taskId,
      task: prompt,
      missionId,
      status: "unread",
    });

    const isSpecialistOrNonBash =
      (pane.cli !== "bash" && pane.runner !== "bash") ||
      (Boolean(pane.label) && pane.label!.toLowerCase() !== "shell") ||
      (Boolean(pane.role) && pane.role!.toLowerCase() !== "shell");

    if (this.paneProvider.writePane && isSpecialistOrNonBash) {
      const bracketedPrompt = `\x1b[200~${prompt}\x1b[201~\r`;
      this.paneProvider.writePane(paneId, bracketedPrompt);
    }

    this.onEvent?.("pane:task_dispatched", { missionId, taskId, paneId });

    return {
      ok: true,
      taskId,
      paneId,
      status: "in-progress",
    };
  }
}
