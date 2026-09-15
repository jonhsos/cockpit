import { randomUUID } from "node:crypto";
import type { MailboxManager } from "./mailbox-manager.ts";
import type { ConnectionManager } from "./connection-manager.ts";
import type { HandoffManager } from "./handoff-manager.ts";
import type { MailboxMessage, PaneSummary, Connection, Handoff } from "./connection-types.ts";
import type { TaskManager } from "../tasks/task-manager.ts";

export interface PaneInfo {
  paneId: string;
  label?: string;
  role?: string;
  runner?: string;
  cli?: string;
  model?: string | null;
  status?: string;
  activeTaskId?: string | null;
  cwd?: string;
  missionId?: string | null;
}

export interface BridgePaneProvider {
  getPane(id: string): PaneInfo | undefined;
  listPanes(): PaneInfo[];
}

export class InterAgentBridge {
  private mailboxManager: MailboxManager;
  private connectionManager: ConnectionManager;
  private handoffManager: HandoffManager;
  private taskManager?: TaskManager;
  private paneProvider: BridgePaneProvider;

  // Correlation tracking
  private activeCorrelationIds: Set<string> = new Set();
  private repliedCorrelationIds: Set<string> = new Set();

  constructor(
    mailboxManager: MailboxManager,
    connectionManager: ConnectionManager,
    handoffManager: HandoffManager,
    paneProvider: BridgePaneProvider,
    taskManager?: TaskManager,
  ) {
    this.mailboxManager = mailboxManager;
    this.connectionManager = connectionManager;
    this.handoffManager = handoffManager;
    this.paneProvider = paneProvider;
    this.taskManager = taskManager;
  }

  // 1. cockpit list
  public list(missionId?: string): { panes: PaneSummary[]; total: number } {
    let allPanes = this.paneProvider.listPanes();
    if (missionId) {
      allPanes = allPanes.filter((p) => p.missionId === missionId);
    }

    const summaries: PaneSummary[] = allPanes.map((p) => {
      let activeTaskId = p.activeTaskId ?? null;
      if (!activeTaskId && this.taskManager && missionId) {
        try {
          const tasks = this.taskManager.listTasks(missionId);
          const active = tasks.find(
            (t) => t.pane === p.paneId && (t.status === "in-progress" || t.status === "in-review"),
          );
          if (active) activeTaskId = active.id;
        } catch {
          // ignore
        }
      }

      const unreadCount = this.mailboxManager.getUnreadCount(
        p.paneId,
        p.missionId ?? missionId ?? "default",
      );

      return {
        id: p.paneId,
        label: p.label || p.paneId,
        role: p.role || "unknown",
        runner: p.runner || p.cli || "bash",
        model: p.model ?? null,
        status: (p.status as any) || "waiting-user",
        activeTaskId,
        cwd: p.cwd || "",
        missionId: p.missionId ?? null,
        inboxCount: unreadCount,
      };
    });

    return { panes: summaries, total: summaries.length };
  }

  // 2. cockpit connect <A> <B>
  public connect(sourcePaneId: string, targetPaneId: string, missionId = "default"): Connection {
    if (!sourcePaneId || !targetPaneId) {
      throw new Error("Both source and target pane IDs are required");
    }
    const source = this.paneProvider.getPane(sourcePaneId);
    const target = this.paneProvider.getPane(targetPaneId);
    if (!source || !target) {
      throw new Error(`Pane does not exist: source=${sourcePaneId}, target=${targetPaneId}`);
    }

    return this.connectionManager.connectPanes(sourcePaneId, targetPaneId, missionId);
  }

  public closeConnectionsForPane(paneId: string): Connection[] {
    return this.connectionManager.closeConnectionsForPane(paneId);
  }

  // 3. cockpit ask <PANE> <tarefa>
  // ZERO STDIN BYTES WRITTEN TO BASH PTY!
  public ask(
    from: string,
    to: string,
    taskText: string,
    taskId?: string,
    missionId = "default",
  ): MailboxMessage | { warning: string; delivered: boolean; queued: boolean } {
    if (!taskText || !taskText.trim()) {
      throw new Error("Task text cannot be empty or whitespace");
    }

    const targetPane = this.paneProvider.getPane(to);
    if (!targetPane) {
      throw new Error(`Target pane does not exist: ${to}`);
    }

    const correlationId = `corr-${Date.now()}-${randomUUID().slice(0, 6)}`;
    this.activeCorrelationIds.add(correlationId);

    // Dead pane check
    const isDead = targetPane.status === "dead";

    // Enqueue message into target mailbox
    const message = this.mailboxManager.enqueue({
      from,
      to,
      type: "ask",
      correlationId,
      taskId,
      task: taskText,
      missionId,
      status: "unread",
    });

    if (isDead) {
      return {
        warning: "PANE_DEAD",
        delivered: false,
        queued: true,
      };
    }

    return message;
  }

  // 4. cockpit reply <PANE> <resultado>
  public reply(
    from: string,
    to: string,
    correlationId: string,
    resultText: string,
    evidence?: unknown[],
    missionId = "default",
  ): MailboxMessage | { status: string; warning?: string } {
    if (!correlationId) {
      return { warning: "CORRELATION_UNKNOWN", status: "rejected" };
    }

    // Idempotency: check if already replied
    if (this.repliedCorrelationIds.has(correlationId)) {
      return { status: "already_replied" };
    }

    const isKnown = this.activeCorrelationIds.has(correlationId);
    this.repliedCorrelationIds.add(correlationId);

    const message = this.mailboxManager.enqueue({
      from,
      to,
      type: "reply",
      correlationId,
      result: resultText ?? "",
      evidence: Array.isArray(evidence) ? evidence : [],
      missionId,
      status: "unread",
    });

    if (!isKnown) {
      return {
        ...message,
        warning: "CORRELATION_UNKNOWN",
      };
    }

    return message;
  }

  // 5. cockpit handoff <A> <B>
  public handoff(
    sourcePaneId: string,
    targetPaneId: string,
    taskId: string,
    context?: string,
    force = false,
    missionId = "default",
  ): Handoff {
    return this.handoffManager.handoff({
      sourcePaneId,
      targetPaneId,
      taskId,
      context,
      force,
      missionId,
    });
  }

  public getMailboxManager(): MailboxManager {
    return this.mailboxManager;
  }

  public getConnectionManager(): ConnectionManager {
    return this.connectionManager;
  }

  public getHandoffManager(): HandoffManager {
    return this.handoffManager;
  }
}
