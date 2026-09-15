import type { Task, TaskStatus, TaskEvidence } from "./task-types.ts";

export class InvalidTaskStateTransitionError extends Error {
  public readonly taskId: string;
  public readonly from: TaskStatus;
  public readonly to: TaskStatus;
  public readonly reason?: string;

  constructor(taskId: string, from: TaskStatus, to: TaskStatus, reason?: string) {
    super(
      `Transição inválida para a tarefa ${taskId}: "${from}" -> "${to}"${
        reason ? ` (${reason})` : ""
      }`
    );
    this.name = "InvalidTaskStateTransitionError";
    this.taskId = taskId;
    this.from = from;
    this.to = to;
    this.reason = reason;
  }
}

export class UnmetTaskDependencyError extends Error {
  public readonly taskId: string;
  public readonly unmet: string[];

  constructor(taskId: string, unmet: string[]) {
    super(`Não é possível iniciar a tarefa ${taskId}: dependências pendentes [${unmet.join(", ")}]`);
    this.name = "UnmetTaskDependencyError";
    this.taskId = taskId;
    this.unmet = unmet;
  }
}

const ALLOWED_TRANSITIONS: Record<TaskStatus, Set<TaskStatus>> = {
  "todo": new Set(["in-progress", "blocked"]),
  "in-progress": new Set(["blocked", "in-review", "failed"]),
  "blocked": new Set(["in-progress", "failed"]),
  "in-review": new Set(["complete", "in-progress", "failed"]),
  "complete": new Set(["todo"]),
  "failed": new Set(["todo"]),
};

export function canTransition(current: TaskStatus, target: TaskStatus): boolean {
  if (current === target) return true;
  return Boolean(ALLOWED_TRANSITIONS[current]?.has(target));
}

export function validateTransition(
  task: Task,
  target: TaskStatus,
  options?: {
    taskLookup?: (id: string) => Task | undefined;
    force?: boolean;
  }
): void {
  if (task.status === target) return;

  if (!options?.force && !canTransition(task.status, target)) {
    throw new InvalidTaskStateTransitionError(task.id, task.status, target);
  }

  // If moving to in-progress, verify that all dependencies are in 'complete' status
  if (target === "in-progress" && Array.isArray(task.dependências) && task.dependências.length > 0) {
    if (options?.taskLookup && !options?.force) {
      const unmet: string[] = [];
      for (const depId of task.dependências) {
        const depTask = options.taskLookup(depId);
        if (!depTask || depTask.status !== "complete") {
          unmet.push(depId);
        }
      }
      if (unmet.length > 0) {
        throw new UnmetTaskDependencyError(task.id, unmet);
      }
    }
  }
}

export function applyTransition(
  task: Task,
  target: TaskStatus,
  options?: {
    reason?: string;
    resultado?: string;
    evidence?: TaskEvidence;
    taskLookup?: (id: string) => Task | undefined;
    force?: boolean;
  }
): Task {
  validateTransition(task, target, options);

  const now = Date.now();
  task.status = target;
  task.timestamps.atualizadaEm = now;

  if (target === "in-progress") {
    if (!task.timestamps.iniciadaEm) {
      task.timestamps.iniciadaEm = now;
    }
  } else if (target === "complete" || target === "failed") {
    task.timestamps.concluidaEm = now;
  } else if (target === "todo") {
    // Reopening clears completion timestamp
    delete task.timestamps.concluidaEm;
  }

  if (options?.resultado !== undefined) {
    task.resultado = options.resultado;
  }

  if (options?.evidence) {
    task.evidências.push(options.evidence);
  }

  return task;
}
