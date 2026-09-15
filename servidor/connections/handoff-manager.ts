import { randomUUID } from "node:crypto";
import type { HandoffStore } from "../persistence/handoff-store.ts";
import type { TaskManager } from "../tasks/task-manager.ts";
import type { MailboxManager } from "./mailbox-manager.ts";
import type { Handoff } from "./connection-types.ts";

export interface HandoffRequest {
  sourcePaneId: string;
  targetPaneId: string;
  taskId: string;
  context?: string;
  force?: boolean;
  missionId?: string;
}

export type PaneStatusLookup = (paneId: string) => { status?: string } | undefined;

export class HandoffManager {
  private handoffStore: HandoffStore;
  private taskManager: TaskManager;
  private mailboxManager?: MailboxManager;
  private paneStatusLookup?: PaneStatusLookup;

  constructor(
    handoffStore: HandoffStore,
    taskManager: TaskManager,
    mailboxManager?: MailboxManager,
    paneStatusLookup?: PaneStatusLookup,
  ) {
    this.handoffStore = handoffStore;
    this.taskManager = taskManager;
    this.mailboxManager = mailboxManager;
    this.paneStatusLookup = paneStatusLookup;
  }

  public setPaneStatusLookup(lookup: PaneStatusLookup): void {
    this.paneStatusLookup = lookup;
  }

  public handoff(request: HandoffRequest): Handoff {
    const { sourcePaneId, targetPaneId, taskId, context = "", force = false } = request;
    const missionId = request.missionId || "default";

    if (!sourcePaneId || !targetPaneId) {
      throw new Error("Source and target pane IDs are required for handoff");
    }
    if (sourcePaneId === targetPaneId) {
      throw new Error("Cannot handoff task to the same pane");
    }
    if (!taskId) {
      throw new Error("Task ID is required for handoff");
    }

    // 1. Check target pane status (reject dead pane)
    if (this.paneStatusLookup) {
      const targetPane = this.paneStatusLookup(targetPaneId);
      if (targetPane && targetPane.status === "dead") {
        throw new Error("Target pane is dead: cannot handoff to dead pane");
      }
    }

    // 2. Validate task exists
    const task = this.taskManager.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 3. Ownership check: origin pane must own task unless force: true
    if (task.pane && task.pane !== sourcePaneId && !force) {
      throw new Error("Ownership mismatch: origin pane does not own this task (use --force to override)");
    }

    // 4. Circular loop detection
    const existingHandoffs = this.handoffStore
      .listHandoffs(missionId)
      .filter((h) => h.taskId === taskId);

    // If target pane has already been a source of handoff for this same task, loop detected!
    const isCircular = existingHandoffs.some((h) => h.sourcePaneId === targetPaneId);
    if (isCircular) {
      throw new Error("Circular handoff loop detected");
    }

    // 5. Append handoff evidence to task
    const evidence = this.taskManager.addEvidence(taskId, {
      tipo: "handoff",
      descricao: `Handoff de ${sourcePaneId} para ${targetPaneId}: ${context || "Sem contexto adicional"}`,
      conteudo: context,
      autor: sourcePaneId,
    });

    // 6. Reassign task to target pane
    this.taskManager.assignTask(taskId, targetPaneId);

    // 7. Record handoff
    const handoffRecord: Handoff = {
      id: `hoff-${Date.now()}-${randomUUID().slice(0, 8)}`,
      missionId,
      sourcePaneId,
      targetPaneId,
      taskId,
      context,
      dependencies: task.dependências ?? [],
      evidenceIds: [evidence.id],
      timestamp: Date.now(),
      status: "completed",
    };

    this.handoffStore.saveHandoff(handoffRecord);

    // 8. Enqueue handoff message into target pane mailbox
    if (this.mailboxManager) {
      try {
        this.mailboxManager.enqueue({
          from: sourcePaneId,
          to: targetPaneId,
          type: "handoff",
          taskId,
          task: context || `Handoff da tarefa ${taskId}`,
          missionId,
          evidence: [evidence],
          metadata: { handoffId: handoffRecord.id },
        });
      } catch (err) {
        console.warn("[HandoffManager] Could not enqueue handoff into mailbox:", err);
      }
    }

    return handoffRecord;
  }

  public listHandoffs(missionId?: string): Handoff[] {
    return this.handoffStore.listHandoffs(missionId);
  }

  public getHandoff(id: string, missionId?: string): Handoff | undefined {
    return this.handoffStore.getHandoff(id, missionId);
  }
}
