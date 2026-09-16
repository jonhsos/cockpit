import { randomUUID } from "node:crypto";
import type { MailboxManager } from "./mailbox-manager.ts";
import type { ConnectionManager } from "./connection-manager.ts";
import type { HandoffManager } from "./handoff-manager.ts";
import type { MailboxMessage, PaneSummary, Connection, Handoff } from "./connection-types.ts";
import type { TaskManager } from "../tasks/task-manager.ts";
import {
  formatarColaNoTerminal,
  paneEstaOcupadoDeVerdade,
  panePodeReceberColaNoTerminal,
  resolvePaneRef,
  shellPodeReceberTarefa,
} from "../orchestration/pane-identity.ts";

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
  connected?: boolean;
  attachedRunner?: string | null;
}

export interface BridgePaneProvider {
  getPane(id: string): PaneInfo | undefined;
  listPanes(): PaneInfo[];
  writePane?(id: string, data: string): void;
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
      const isBusy = paneEstaOcupadoDeVerdade({ ...p, activeTaskId });
      const connected = p.connected !== false && p.status !== "dead" && p.status !== "failed";

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
        isBusy,
        canAcceptTask:
          connected &&
          !isBusy &&
          p.status !== "starting" &&
          p.status !== "blocked" &&
          shellPodeReceberTarefa(p),
      };
    });

    return { panes: summaries, total: summaries.length };
  }

  // 2. cockpit connect <A> <B>
  public connect(sourcePaneId: string, targetPaneId: string, missionId = "default"): Connection {
    if (!sourcePaneId || !targetPaneId) {
      throw new Error("Both source and target pane IDs are required");
    }
    const source = this.resolvePane(sourcePaneId, missionId);
    const target = this.resolvePane(targetPaneId, missionId);
    if (!source || !target) {
      throw new Error(`Pane does not exist: source=${sourcePaneId}, target=${targetPaneId}`);
    }

    return this.connectionManager.connectPanes(source.paneId, target.paneId, missionId);
  }

  public closeConnectionsForPane(paneId: string): Connection[] {
    return this.connectionManager.closeConnectionsForPane(paneId);
  }

  public resolvePane(ref: string, missionId?: string): PaneInfo | undefined {
    const exact = this.paneProvider.getPane(ref);
    if (exact && (!missionId || !exact.missionId || exact.missionId === missionId)) return exact;
    return resolvePaneRef(ref, this.paneProvider.listPanes(), missionId);
  }

  // 3. cockpit ask <PANE> <tarefa>
  // Inbox always. Terminal paste only for specialist CLIs that are not truly busy.
  // ZERO STDIN BYTES WRITTEN TO BASH PTY.
  public ask(
    from: string,
    to: string,
    taskText: string,
    taskId?: string,
    missionId = "default",
    options?: { force?: boolean },
  ): MailboxMessage | { warning: string; delivered: boolean; queued: boolean; deliveredToTerminal?: boolean } {
    if (!taskText || !taskText.trim()) {
      throw new Error("Task text cannot be empty or whitespace");
    }

    const targetPane = this.resolvePane(to, missionId);
    if (!targetPane) {
      throw new Error(`Target pane does not exist: ${to}`);
    }

    const correlationId = `corr-${Date.now()}-${randomUUID().slice(0, 6)}`;
    this.activeCorrelationIds.add(correlationId);

    const fromPane = this.resolvePane(from, missionId);
    const fromId = fromPane?.paneId ?? from;
    const toId = targetPane.paneId;
    if (fromId === toId) {
      throw new Error("Não dá para mandar mensagem para o próprio painel");
    }

    const isDead = targetPane.status === "dead" || targetPane.status === "failed";

    const message = this.mailboxManager.enqueue({
      from: fromId,
      to: toId,
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
        deliveredToTerminal: false,
      };
    }

    const canPaste = options?.force
      ? targetPane.connected !== false && shellPodeReceberTarefa(targetPane)
      : panePodeReceberColaNoTerminal(targetPane);
    let deliveredToTerminal = false;
    if (canPaste && this.paneProvider.writePane) {
      this.paneProvider.writePane(toId, formatarColaNoTerminal(taskText));
      deliveredToTerminal = true;
      targetPane.status = "working";
    }

    return {
      ...message,
      deliveredToTerminal,
      queued: true,
      delivered: deliveredToTerminal,
    };
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

    const fromPane = this.resolvePane(from, missionId);
    const toPane = this.resolvePane(to, missionId);
    const fromId = fromPane?.paneId ?? from;
    const toId = toPane?.paneId ?? to;
    const message = this.mailboxManager.enqueue({
      from: fromId,
      to: toId,
      type: "reply",
      correlationId,
      result: resultText ?? "",
      evidence: Array.isArray(evidence) ? evidence : [],
      missionId,
      status: "unread",
    });
    if (toPane && toPane.status !== "dead" && toPane.status !== "failed") {
      const canPaste = panePodeReceberColaNoTerminal(toPane);
      if (canPaste && this.paneProvider.writePane) {
        const quem = fromPane?.label || fromId;
        this.paneProvider.writePane(
          toId,
          formatarColaNoTerminal(`Resposta de ${quem}:\n\n${resultText ?? ""}`),
        );
        toPane.status = "working";
      }
    }

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

  public inbox(paneRef: string, missionId = "default", unreadOnly = false): MailboxMessage[] {
    const pane = this.resolvePane(paneRef, missionId);
    const paneId = pane?.paneId ?? paneRef;
    return this.mailboxManager.getInbox(paneId, missionId, unreadOnly);
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
