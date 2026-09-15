import { randomUUID } from "node:crypto";
import type {
  Task,
  TaskStatus,
  TaskEvidence,
  TaskBoardData,
  CreateTaskParams,
  UpdateTaskParams,
} from "./task-types.ts";
import { applyTransition } from "./task-state-machine.ts";
import type { FileOwnershipManager } from "./file-ownership.ts";
import type { TaskStore } from "../persistence/task-store.ts";
import { getDefaultTaskStore } from "../persistence/index.ts";

export class TaskManager {
  private ownershipManager: FileOwnershipManager;
  private taskStore: TaskStore;
  private onEvent?: (type: string, payload: unknown) => void;
  private listeners: Set<(type: string, payload: unknown) => void> = new Set();
  private tasksCache: Map<string, Task> = new Map();

  constructor(
    ownershipManager: FileOwnershipManager,
    taskStore?: TaskStore,
    onEvent?: (type: string, payload: unknown) => void
  ) {
    this.ownershipManager = ownershipManager;
    this.taskStore = taskStore ?? getDefaultTaskStore();
    this.onEvent = onEvent;
    this.loadFromStore();
  }

  public addListener(listener: (type: string, payload: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setEventHandler(handler: (type: string, payload: unknown) => void): void {
    this.onEvent = handler;
  }

  private emitEvent(type: string, payload: unknown): void {
    try {
      this.onEvent?.(type, payload);
    } catch (err) {
      console.error(`[TaskManager] Erro no callback onEvent (${type}):`, err);
    }
    for (const listener of this.listeners) {
      try {
        listener(type, payload);
      } catch (err) {
        console.error(`[TaskManager] Erro no listener (${type}):`, err);
      }
    }
  }

  private loadFromStore(): void {
    try {
      const stored = this.taskStore.listTasks();
      for (const t of stored) {
        this.tasksCache.set(t.id, t);
      }
    } catch {
      // Store might not be initialized yet
    }
  }

  public createTask(missionId: string, params: CreateTaskParams): Task {
    const now = Date.now();
    const taskId =
      params.id ?? `task-${now.toString(36)}-${randomUUID().slice(0, 6)}`;

    const task: Task = {
      id: taskId,
      título: params.título ?? params.titulo ?? "Sem título",
      descrição: params.descrição ?? params.descricao ?? "",
      responsável: params.responsável ?? params.responsavel ?? null,
      papel: params.papel ?? null,
      pane: params.pane ?? null,
      "arquivos permitidos":
        params["arquivos permitidos"] ?? params.arquivosPermitidos ?? [],
      dependências: params.dependências ?? params.dependencias ?? [],
      prioridade: params.prioridade ?? "normal",
      status: params.status ?? "todo",
      evidências: params.evidências ?? params.evidencias ?? [],
      resultado: params.resultado ?? null,
      timestamps: {
        criadaEm: now,
        atualizadaEm: now,
      },
      missionId: missionId || params.missionId || "default",
    };

    this.tasksCache.set(task.id, task);
    this.taskStore.saveTask(task);

    this.emitEvent("task:created", task);
    return task;
  }

  public getTask(taskId: string): Task | undefined {
    let task = this.tasksCache.get(taskId);
    if (!task) {
      task = this.taskStore.getTask(taskId);
      if (task) {
        this.tasksCache.set(task.id, task);
      }
    }
    return task;
  }

  public listTasks(
    missionId?: string,
    filter?: { status?: TaskStatus; papel?: string; pane?: string }
  ): Task[] {
    const stored = this.taskStore.listTasks(missionId);
    for (const t of stored) {
      if (!this.tasksCache.has(t.id)) {
        this.tasksCache.set(t.id, t);
      }
    }
    let tasks = Array.from(this.tasksCache.values());

    if (missionId) {
      tasks = tasks.filter((t) => t.missionId === missionId);
    }

    if (!filter) return tasks;

    return tasks.filter((t) => {
      if (filter.status && t.status !== filter.status) return false;
      if (filter.papel && t.papel !== filter.papel) return false;
      if (filter.pane && t.pane !== filter.pane) return false;
      return true;
    });
  }

  public updateTask(taskId: string, params: UpdateTaskParams): Task {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Tarefa ${taskId} não encontrada`);
    }

    if (params.título !== undefined || params.titulo !== undefined) {
      task.título = (params.título ?? params.titulo)!;
    }
    if (params.descrição !== undefined || params.descricao !== undefined) {
      task.descrição = (params.descrição ?? params.descricao)!;
    }
    if (params.responsável !== undefined || params.responsavel !== undefined) {
      task.responsável = params.responsável ?? params.responsavel ?? null;
    }
    if (params.papel !== undefined) {
      task.papel = params.papel;
    }
    if (params.pane !== undefined) {
      task.pane = params.pane;
    }
    if (params["arquivos permitidos"] !== undefined || params.arquivosPermitidos !== undefined) {
      task["arquivos permitidos"] =
        params["arquivos permitidos"] ?? params.arquivosPermitidos ?? [];
    }
    if (params.dependências !== undefined || params.dependencias !== undefined) {
      task.dependências = params.dependências ?? params.dependencias ?? [];
    }
    if (params.prioridade !== undefined) {
      task.prioridade = params.prioridade;
    }
    if (params.resultado !== undefined) {
      task.resultado = params.resultado;
    }

    task.timestamps.atualizadaEm = Date.now();
    this.tasksCache.set(task.id, task);
    this.taskStore.saveTask(task);

    this.emitEvent("task:updated", task);
    return task;
  }

  public transitionTask(
    taskId: string,
    targetStatus: TaskStatus,
    context?: {
      reason?: string;
      resultado?: string;
      evidence?: TaskEvidence;
      force?: boolean;
    }
  ): Task {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Tarefa ${taskId} não encontrada`);
    }

    applyTransition(task, targetStatus, {
      ...context,
      taskLookup: (id) => this.getTask(id),
    });

    // Auto-release file locks when task finishes (complete or failed)
    if (targetStatus === "complete" || targetStatus === "failed") {
      this.ownershipManager.releaseLock(task.id);
    }

    this.tasksCache.set(task.id, task);
    this.taskStore.saveTask(task);

    this.emitEvent("task:updated", task);
    this.emitEvent("task:status_changed", { taskId: task.id, status: task.status });
    return task;
  }

  public assignTask(
    taskId: string,
    paneId: string | null,
    responsavel?: string,
    papel?: string
  ): Task {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Tarefa ${taskId} não encontrada`);
    }

    task.pane = paneId;
    if (responsavel !== undefined) {
      task.responsável = responsavel;
    }
    if (papel !== undefined) {
      task.papel = papel;
    }

    task.timestamps.atualizadaEm = Date.now();
    this.ownershipManager.transferLock(taskId, paneId || "", responsavel);

    this.tasksCache.set(task.id, task);
    this.taskStore.saveTask(task);

    this.emitEvent("task:assigned", { taskId, paneId, responsavel, papel });
    return task;
  }

  public handlePaneExit(paneId: string): Task[] {
    const modified: Task[] = [];
    const tasks = this.listTasks(undefined, { pane: paneId });
    for (const task of tasks) {
      if (task.status === "in-progress" || task.status === "in-review") {
        try {
          this.transitionTask(task.id, "blocked", { reason: "Painel encerrado", force: true });
        } catch {
          // If transition fails, continue
        }
      }
      this.assignTask(task.id, null);
      this.ownershipManager.releaseLock(task.id);
      modified.push(task);
    }
    return modified;
  }

  public addEvidence(
    taskId: string,
    evidence: Omit<TaskEvidence, "id" | "timestamp"> & { id?: string; timestamp?: number }
  ): TaskEvidence {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Tarefa ${taskId} não encontrada`);
    }

    const now = Date.now();
    const fullEvidence: TaskEvidence = {
      ...evidence,
      id: evidence.id ?? `ev-${now}-${randomUUID().slice(0, 6)}`,
      timestamp: evidence.timestamp ?? now,
    };

    task.evidências.push(fullEvidence);
    task.timestamps.atualizadaEm = now;

    this.tasksCache.set(task.id, task);
    this.taskStore.saveTask(task);

    this.emitEvent("task:evidence_added", { taskId, evidence: fullEvidence });
    return fullEvidence;
  }

  public recordKnowledge(
    taskId: string,
    descricao: string,
    conteudo?: string,
    autor?: string
  ): TaskEvidence {
    return this.addEvidence(taskId, {
      tipo: "knowledge",
      descricao,
      conteudo,
      autor,
    });
  }

  public deleteTask(taskId: string): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;

    this.ownershipManager.releaseLock(taskId);
    this.tasksCache.delete(taskId);
    const deleted = this.taskStore.deleteTask(taskId, task.missionId);

    this.emitEvent("task:deleted", { taskId, missionId: task.missionId });
    return deleted;
  }

  public getBoard(missionId: string): TaskBoardData {
    const all = this.listTasks(missionId);

    const board: TaskBoardData = {
      missionId,
      todo: [],
      "in-progress": [],
      blocked: [],
      "in-review": [],
      complete: [],
      failed: [],
      total: all.length,
    };

    for (const task of all) {
      if (board[task.status]) {
        board[task.status].push(task);
      }
    }

    return board;
  }

  public clear(): void {
    this.tasksCache.clear();
  }
}
