// Authoritative fixtures and domain contracts derived from ORIGINAL_REQUEST.md and PROJECT.md

export const TASK_STATUSES = ["todo", "in-progress", "blocked", "in-review", "complete", "failed"];

export const PANE_STATUSES = [
  "starting",
  "waiting-user",
  "working",
  "blocked",
  "review",
  "completed",
  "failed",
  "dead",
];

export const VALID_TASK_TRANSITIONS = {
  todo: ["in-progress", "blocked", "failed"],
  "in-progress": ["blocked", "in-review", "failed", "complete"],
  blocked: ["in-progress", "failed"],
  "in-review": ["complete", "failed", "in-progress"],
  complete: [], // terminal unless explicitly reopened
  failed: ["todo", "in-progress"], // allow retry
};

export function createTaskFixture(overrides = {}) {
  const now = Date.now();
  return {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 9)}`,
    title: overrides.title ?? "Tarefa Padrão E2E",
    description: overrides.description ?? "Descrição da tarefa para teste",
    assignee: overrides.assignee ?? "agente-1",
    role: overrides.role ?? "builder",
    pane: overrides.pane ?? "pane-1",
    allowedFiles: overrides.allowedFiles ?? ["src/index.ts"],
    dependencies: overrides.dependencies ?? [],
    priority: overrides.priority ?? "medium",
    status: overrides.status ?? "todo",
    evidence: overrides.evidence ?? [],
    result: overrides.result ?? null,
    timestamps: {
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
      startedAt: overrides.startedAt ?? null,
      completedAt: overrides.completedAt ?? null,
    },
    ...overrides,
  };
}

export function validateTask13Fields(task) {
  const required = [
    "id",
    "title",
    "description",
    "assignee",
    "role",
    "pane",
    "allowedFiles",
    "dependencies",
    "priority",
    "status",
    "evidence",
    "result",
    "timestamps",
  ];
  const missing = required.filter((field) => !(field in task));
  if (missing.length > 0) {
    throw new Error(`Task missing required fields: ${missing.join(", ")}`);
  }
  if (!TASK_STATUSES.includes(task.status)) {
    throw new Error(`Invalid task status: ${task.status}`);
  }
  if (!Array.isArray(task.allowedFiles)) {
    throw new Error("Task allowedFiles must be an array");
  }
  if (!Array.isArray(task.dependencies)) {
    throw new Error("Task dependencies must be an array");
  }
  if (!Array.isArray(task.evidence)) {
    throw new Error("Task evidence must be an array");
  }
  return true;
}

export function canTransitionTask(fromStatus, toStatus) {
  if (!TASK_STATUSES.includes(fromStatus)) return false;
  if (!TASK_STATUSES.includes(toStatus)) return false;
  const allowed = VALID_TASK_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

export function transitionTaskStatus(task, newStatus, reason = "") {
  if (!canTransitionTask(task.status, newStatus)) {
    throw new Error(`Invalid task transition: cannot move from ${task.status} to ${newStatus}`);
  }
  const updated = { ...task, status: newStatus };
  updated.timestamps = { ...task.timestamps, updatedAt: Date.now() };
  if (newStatus === "in-progress" && !updated.timestamps.startedAt) {
    updated.timestamps.startedAt = Date.now();
  }
  if (newStatus === "complete") {
    updated.timestamps.completedAt = Date.now();
  }
  if (reason) {
    updated.evidence = [...updated.evidence, { type: "transition", from: task.status, to: newStatus, reason, at: Date.now() }];
  }
  return updated;
}

export function createRoleFixture(overrides = {}) {
  return {
    id: overrides.id ?? "builder",
    name: overrides.name ?? "Builder",
    description: overrides.description ?? "Construtor e implementador de software",
    capabilities: overrides.capabilities ?? ["code", "test", "build"],
  };
}

export function createRunnerFixture(overrides = {}) {
  return {
    id: overrides.id ?? "bash",
    name: overrides.name ?? "Sovereign Clean Bash",
    binary: overrides.binary ?? "/bin/bash",
    defaultArgs: overrides.defaultArgs ?? ["-i", "-l"],
    supportedModels: overrides.supportedModels ?? [],
  };
}

export function createModelFixture(overrides = {}) {
  return {
    id: overrides.id ?? "claude-3-7-sonnet",
    name: overrides.name ?? "Claude 3.7 Sonnet",
    provider: overrides.provider ?? "anthropic",
    contextWindow: overrides.contextWindow ?? 200000,
  };
}

export function createConnectionFixture(paneA, paneB, missionId = "m1") {
  return {
    id: `conn-${paneA}-${paneB}`,
    sourcePaneId: paneA,
    targetPaneId: paneB,
    missionId,
    status: "active",
    createdAt: Date.now(),
  };
}

export function createHandoffFixture(sourcePane, targetPane, taskId, context = "") {
  return {
    id: `handoff-${Date.now()}`,
    sourcePaneId: sourcePane,
    targetPaneId: targetPane,
    taskId,
    context,
    createdAt: Date.now(),
    status: "pending",
  };
}

export class MockFileLockManager {
  constructor() {
    this.locks = new Map(); // file -> { taskId, paneId, mode }
  }

  acquire(missionId, taskId, paneId, files, mode = "isolated") {
    if (mode === "isolated") {
      const conflicts = [];
      let lockedBy = null;
      for (const f of files) {
        if (this.locks.has(f)) {
          const current = this.locks.get(f);
          if (current.taskId !== taskId) {
            conflicts.push(f);
            lockedBy = current.taskId;
          }
        }
      }
      if (conflicts.length > 0) {
        return {
          ok: false,
          statusCode: 409,
          conflictFiles: conflicts,
          lockedBy,
        };
      }
      for (const f of files) {
        this.locks.set(f, { taskId, paneId, mode: "isolated" });
      }
      return { ok: true, statusCode: 200 };
    } else {
      // shared mode allows multiple, returns warning if collision
      let warning = false;
      const collisionFiles = [];
      for (const f of files) {
        if (this.locks.has(f)) {
          const current = this.locks.get(f);
          if (current.taskId !== taskId) {
            warning = true;
            collisionFiles.push(f);
          }
        }
        this.locks.set(f, { taskId, paneId, mode: "shared" });
      }
      return {
        ok: true,
        statusCode: 200,
        warning,
        collisionFiles,
      };
    }
  }

  release(taskId) {
    for (const [file, lock] of this.locks.entries()) {
      if (lock.taskId === taskId) {
        this.locks.delete(file);
      }
    }
    return { ok: true };
  }
}

export function redactSecrets(input) {
  if (typeof input !== "string") return input;
  // Match sk-..., Bearer ..., secret tokens
  return input
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9_.-]{16,}/gi, "Bearer [REDACTED]")
    .replace(/(api[_-]?key\s*[:=]\s*["']?)[A-Za-z0-9_.-]{16,}(["']?)/gi, "$1[REDACTED]$2")
    .replace(/(token\s*[:=]\s*["']?)[A-Za-z0-9_.-]{16,}(["']?)/gi, "$1[REDACTED]$2")
    .replace(/secret-token-[A-Za-z0-9_-]+/gi, "[REDACTED]");
}

export function resolveHarnessContract({ requestedCli, missionElenco, availableInPath = true } = {}) {
  if (!requestedCli || typeof requestedCli !== "string") {
    throw new Error("requestedCli must be a valid string");
  }

  // R1 & R4: Bash has absolute precedence
  if (requestedCli === "bash") {
    return {
      cli: "bash",
      model: undefined,
      effort: undefined,
      origem: { cli: "soberano", model: "none", effort: "none" },
    };
  }

  // R4: Available in PATH check
  if (!availableInPath) {
    throw new Error(`Executor ${requestedCli} não disponível no sistema`);
  }

  // R4: Elenco whitelist check
  if (missionElenco && missionElenco.length > 0 && !missionElenco.includes(requestedCli)) {
    throw new Error(`Executor ${requestedCli} não permitido no elenco desta missão`);
  }

  return {
    cli: requestedCli,
    model: "default-model",
    origem: { cli: "elenco", model: "default", effort: "default" },
  };
}
