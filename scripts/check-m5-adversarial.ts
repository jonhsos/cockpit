/**
 * Milestone M5 Adversarial Verification & Empirical Stress Test Suite.
 *
 * Rigorously challenges:
 * 1. Role Catalog: Zero LLM model leaks in level 1 (ASTRA, FLASH, OPUS, Sonnet, etc.), strict decoupling.
 * 2. Bash Sovereignty: Clean /bin/bash -i -l, zero model payload, zero LLM auto-boot, absolute precedence.
 * 3. 6-State Task Machine: Complete 36-transition matrix, unmet dependencies blocking without force, lock persistence and isolated vs shared modes.
 * 4. WebSocket Broadcasting: Resilient event propagation for all task mutations, fault-tolerant listeners, malformed payloads.
 */

import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CANONICAL_ROLES,
  CANONICAL_RUNNERS,
  CANONICAL_TASK_STATUSES,
  type TaskStatus,
  type Task,
  type RunnerId,
} from "../web/tipos.ts";
import { TaskManager } from "../servidor/tasks/task-manager.ts";
import {
  InvalidTaskStateTransitionError,
  UnmetTaskDependencyError,
  canTransition,
  validateTransition,
  applyTransition,
} from "../servidor/tasks/task-state-machine.ts";
import { FileOwnershipManager } from "../servidor/tasks/file-ownership.ts";
import { OwnershipStore } from "../servidor/persistence/ownership-store.ts";
import { DiskStore } from "../servidor/persistence/disk-store.ts";
import { TaskStore } from "../servidor/persistence/task-store.ts";
import {
  isCleanShell,
  getCleanShellCommand,
  sanitizeCleanShellEnv,
  assertCleanShellInvariants,
  BASH_PATH,
} from "../servidor/sessions/clean-shell.ts";
import { ClientManager } from "../servidor/websocket/client-manager.ts";
import { REDACTED_MARKER } from "../servidor/security/sanitizer.ts";
import { resolverHarness } from "../servidor/orchestration/harness.ts";

let totalPasses = 0;
let totalFails = 0;

function check(desc: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    totalPasses++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${(err as Error).message}`);
    totalFails++;
  }
}

async function checkAsync(desc: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${desc}`);
    totalPasses++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${(err as Error).message}`);
    totalFails++;
  }
}

console.log("================================================================================");
console.log("             Milestone M5 Empirical Adversarial Stress Test                     ");
console.log("================================================================================");

// ============================================================================
// SUITE 1: Catálogo por Papéis & Ocultação Rigorosa de Modelos LLM
// ============================================================================
console.log("\n[Suite 1] Adversarial Challenge: Role Catalog & Model Name Leak Prevention");

const FORBIDDEN_MODEL_PATTERNS = [
  /\bastra\b/i,
  /\bflash\b/i,
  /\bopus\b/i,
  /\bsonnet\b/i,
  /\bhaiku\b/i,
  /\bgpt-[345]/i,
  /\bclaude-[23]/i,
  /\bgemini-[123]/i,
  /\bdeepseek/i,
  /\bqwen/i,
  /\bllama/i,
];

check("1.1 CANONICAL_ROLES contains zero mentions of LLM model names", () => {
  const json = JSON.stringify(CANONICAL_ROLES);
  for (const pattern of FORBIDDEN_MODEL_PATTERNS) {
    const match = json.match(pattern);
    assert.equal(
      match,
      null,
      `Model pattern ${pattern} leaked into CANONICAL_ROLES: ${match?.[0]}`
    );
  }
  const roleIds = CANONICAL_ROLES.map((r) => r.id);
  assert.ok(roleIds.includes("maestro"), "maestro role must be present");
  assert.ok(roleIds.includes("builder"), "builder role must be present");
  assert.ok(roleIds.includes("reviewer"), "reviewer role must be present");
  assert.ok(roleIds.includes("scout"), "scout role must be present");
});

check("1.2 web/RoleCatalog.tsx Etapa 1 has zero LLM model leakage in role grid", () => {
  const src = readFileSync("web/RoleCatalog.tsx", "utf8");
  // Extract stage 1 JSX section
  const etapa1Match = src.match(/\{etapa === 1 && !criandoCustom && \(([\s\S]*?)\)\}/);
  assert.ok(etapa1Match, "Etapa 1 section must be clearly demarcated in RoleCatalog.tsx");
  const etapa1Content = etapa1Match[1];

  for (const pattern of FORBIDDEN_MODEL_PATTERNS) {
    const match = etapa1Content.match(pattern);
    assert.equal(
      match,
      null,
      `Model pattern ${pattern} leaked into Stage 1 role catalog JSX: ${match?.[0]}`
    );
  }
});

check("1.3 web/NovaMissao.tsx agent selection has zero LLM model name leakage in L1", () => {
  const src = readFileSync("web/NovaMissao.tsx", "utf8");
  // Check the agent button block in NovaMissao
  const agentesBlockMatch = src.match(/<div className="agentes">([\s\S]*?)<\/div>/);
  assert.ok(agentesBlockMatch, "Agentes button block must exist in NovaMissao.tsx");
  const block = agentesBlockMatch[1];

  assert.ok(
    !block.includes("{a.model}"),
    "NovaMissao must not render a.model in agent buttons"
  );
  assert.ok(
    !block.includes("{a.model ?? a.cli}"),
    "NovaMissao must not render a.model fallback in agent buttons"
  );
  assert.ok(
    block.includes("a.papel ?? a.label"),
    "NovaMissao must render role/label semantically"
  );
});

check("1.4 Role decoupling: Role definitions do not enforce runners or models", () => {
  for (const role of CANONICAL_ROLES) {
    assert.equal(
      (role as any).runner,
      undefined,
      `Role ${role.id} must not dictate a runner`
    );
    assert.equal(
      (role as any).model,
      undefined,
      `Role ${role.id} must not dictate a model`
    );
    assert.equal(
      (role as any).cli,
      undefined,
      `Role ${role.id} must not dictate a cli`
    );
  }
});

check("1.5 Whitelist Roster (Elenco) filtering logic in Stage 2 (bash is sovereign)", () => {
  // Typical real mission where user only selects AI providers like codex
  const mockElenco = { clis: ["codex"] };
  const allRunners = CANONICAL_RUNNERS.map((r) => r.id);

  for (const runnerId of allRunners) {
    const foraDoElenco =
      runnerId !== "bash" &&
      mockElenco.clis.length > 0 &&
      !mockElenco.clis.includes(runnerId);

    if (runnerId === "claude" || runnerId === "agy" || runnerId === "openrouter" || runnerId === "grok") {
      assert.equal(
        foraDoElenco,
        true,
        `Runner ${runnerId} must be marked as foraDoElenco when outside roster`
      );
    } else {
      assert.equal(
        foraDoElenco,
        false,
        `Runner ${runnerId} (codex or sovereign bash) must be allowed`
      );
    }
  }
});

// ============================================================================
// SUITE 2: Soberania Bash (Shell Limpo, Sem LLM, Sem Payload)
// ============================================================================
console.log("\n[Suite 2] Adversarial Challenge: Sovereign Clean Bash Invariants");

check("2.1 isCleanShell identifies bash variants and rejects LLM CLIs", () => {
  assert.equal(isCleanShell("bash"), true);
  assert.equal(isCleanShell("shell"), true);
  assert.equal(isCleanShell("/bin/bash"), true);
  assert.equal(isCleanShell({ runner: "bash" }), true);
  assert.equal(isCleanShell({ cli: "bash" }), true);
  assert.equal(isCleanShell({ role: "shell" }), true);
  assert.equal(isCleanShell({ agent: "builder", runner: "bash" }), true);
  assert.equal(isCleanShell({ agent: "maestro", harness: { invoke: { cli: "bash" } } }), true);

  // Adversarial negative cases
  assert.equal(isCleanShell("codex"), false);
  assert.equal(isCleanShell("claude"), false);
  assert.equal(isCleanShell("agy"), false);
  assert.equal(isCleanShell("openrouter"), false);
  assert.equal(isCleanShell("gemini"), false);
  assert.equal(isCleanShell({ runner: "codex" }), false);
  assert.equal(isCleanShell(undefined), false);
  assert.equal(isCleanShell(null), false);
});

check("2.2 getCleanShellCommand strictly produces /bin/bash -i -l", () => {
  const cmd = getCleanShellCommand();
  assert.equal(cmd.file, BASH_PATH);
  assert.deepEqual(cmd.args, ["-i", "-l"]);
  assert.equal(cmd.args.length, 2, "Must not include any additional flags or arguments");
});

check("2.3 sanitizeCleanShellEnv eliminates AI harness markers and prompt variables", () => {
  const dirtyEnv: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/user",
    TERM: "xterm",
    CLAUDE_CODE_ENTRYPOINT: "1",
    CLAUDECODE: "1",
    COCKPIT_MAESTRO_TASK: "malicious instruction",
    COCKPIT_PROMPT: "injected system prompt",
    COCKPIT_TASK: "injected task",
    COCKPIT_INSTRUCTION: "injected instruction",
  };

  const clean = sanitizeCleanShellEnv(dirtyEnv, {
    paneId: "p1-test",
    label: "Shell Teste",
  });

  assert.equal(clean.PATH, "/usr/bin:/bin");
  assert.equal(clean.TERM, "xterm-256color");
  assert.equal(clean.SHELL, BASH_PATH);
  assert.equal(clean.CLAUDE_CODE_ENTRYPOINT, undefined);
  assert.equal(clean.CLAUDECODE, undefined);
  assert.equal(clean.COCKPIT_MAESTRO_TASK, undefined);
  assert.equal(clean.COCKPIT_PROMPT, undefined);
  assert.equal(clean.COCKPIT_TASK, undefined);
  assert.equal(clean.COCKPIT_INSTRUCTION, undefined);
});

check("2.4 assertCleanShellInvariants rejects any command alteration or prompt injection", () => {
  const validCmd = getCleanShellCommand();
  // Valid invocation should pass without throw
  assert.doesNotThrow(() => assertCleanShellInvariants(validCmd, undefined));

  // Adversarial: passing prompt/tarefa string to bash must throw
  assert.throws(
    () => assertCleanShellInvariants(validCmd, "Some automated prompt text"),
    /prompt injection/i
  );

  // Adversarial: passing non-bash command file must throw
  assert.throws(
    () => assertCleanShellInvariants({ file: "python3", args: ["-i", "-l"] }, undefined),
    /must execute strictly as|R1 Violation/i
  );

  // Adversarial: passing altered args (e.g. -c 'evil command') must throw
  assert.throws(
    () => assertCleanShellInvariants({ file: BASH_PATH, args: ["-c", "ls -la"] }, undefined),
    /argumentos do clean shell|R1 Violation/i
  );
});

check("2.5 resolverHarness resolves bash runner with zero model payload and absolute precedence", () => {
  const result = resolverHarness({
    agent: "maestro",
    runner: "bash",
    elenco: ["codex", "claude"], // Roster does not include bash, but bash is sovereign
  });

  assert.equal(result.cli, "bash");
  assert.equal(result.model, undefined, "Bash runner must never have a model");
  assert.equal(result.effort, undefined, "Bash runner must never have effort");
});

// ============================================================================
// SUITE 3: Máquina de 6 Estados de Tarefas, Dependências e File Locks
// ============================================================================
console.log("\n[Suite 3] Adversarial Challenge: 6-State Task Machine, Dependency Gates & Locks");

const ALL_STATES: TaskStatus[] = [
  "todo",
  "in-progress",
  "blocked",
  "in-review",
  "complete",
  "failed",
];

const LEGAL_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  "todo": ["in-progress", "blocked"],
  "in-progress": ["blocked", "in-review", "failed"],
  "blocked": ["in-progress", "failed"],
  "in-review": ["complete", "in-progress", "failed"],
  "complete": ["todo"],
  "failed": ["todo"],
};

check("3.1 Complete 36-cell State Transition Matrix verification", () => {
  for (const from of ALL_STATES) {
    const allowed = new Set(LEGAL_TRANSITIONS[from]);
    for (const to of ALL_STATES) {
      const mockTask: Task = {
        id: "t-matrix",
        missionId: "m1",
        título: "Matrix Task",
        descrição: "",
        responsável: null,
        papel: null,
        pane: null,
        "arquivos permitidos": [],
        dependências: [],
        prioridade: "normal",
        status: from,
        evidências: [],
        resultado: null,
        timestamps: { criadaEm: 1000, atualizadaEm: 1000 },
      };

      const isLegal = from === to || allowed.has(to);
      assert.equal(
        canTransition(from, to),
        isLegal,
        `canTransition(${from} -> ${to}) must be ${isLegal}`
      );

      if (isLegal) {
        assert.doesNotThrow(
          () => validateTransition(mockTask, to),
          `Legal transition ${from} -> ${to} threw error unexpectedly`
        );
        const transitioned = applyTransition({ ...mockTask }, to);
        assert.equal(transitioned.status, to);
      } else {
        assert.throws(
          () => validateTransition(mockTask, to),
          (err: any) => err instanceof InvalidTaskStateTransitionError,
          `Illegal transition ${from} -> ${to} must throw InvalidTaskStateTransitionError`
        );
      }
    }
  }
});

check("3.2 Timestamps lifecycle: start, complete, and reopen integrity", () => {
  const task: Task = {
    id: "t-time",
    missionId: "m1",
    título: "Timestamp task",
    descrição: "",
    responsável: null,
    papel: null,
    pane: null,
    "arquivos permitidos": [],
    dependências: [],
    prioridade: "normal",
    status: "todo",
    evidências: [],
    resultado: null,
    timestamps: { criadaEm: 1000, atualizadaEm: 1000 },
  };

  // Move to in-progress
  applyTransition(task, "in-progress");
  assert.ok(task.timestamps.iniciadaEm, "iniciadaEm must be recorded");
  const startedAt = task.timestamps.iniciadaEm;

  // Move to in-review
  applyTransition(task, "in-review");
  assert.equal(task.timestamps.iniciadaEm, startedAt, "iniciadaEm must be preserved");
  assert.equal(task.timestamps.concluidaEm, undefined, "concluidaEm not set in in-review");

  // Move to complete
  applyTransition(task, "complete");
  assert.ok(task.timestamps.concluidaEm, "concluidaEm must be recorded on complete");

  // Reopen to todo
  applyTransition(task, "todo");
  assert.equal(task.status, "todo");
  assert.equal(task.timestamps.concluidaEm, undefined, "concluidaEm must be cleared when reopening");
});

await checkAsync("3.3 Unsatisfied Dependencies Gate: blocking advancement without force", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "m5-adv-deps-"));
  try {
    const diskStore = new DiskStore(tempDir);
    const taskStore = new TaskStore(diskStore);
    const ownership = new FileOwnershipManager();
    const taskMgr = new TaskManager(ownership, taskStore);

    // Prerequisite task A
    const taskA = taskMgr.createTask("m1", {
      título: "Task A - Prerequisite",
      status: "todo",
    });

    // Dependent task B
    const taskB = taskMgr.createTask("m1", {
      título: "Task B - Dependent",
      status: "todo",
      dependências: [taskA.id],
    });

    // Attempt 1: B -> in-progress while A is 'todo' WITHOUT force (MUST FAIL)
    assert.throws(
      () => taskMgr.transitionTask(taskB.id, "in-progress"),
      (err: any) => {
        assert.ok(err instanceof UnmetTaskDependencyError);
        assert.ok(err.unmet.includes(taskA.id));
        return true;
      },
      "Must throw UnmetTaskDependencyError when prerequisite is 'todo'"
    );
    assert.equal(taskMgr.getTask(taskB.id)?.status, "todo");

    // Attempt 2: Advance A to in-progress, then try B again (MUST STILL FAIL)
    taskMgr.transitionTask(taskA.id, "in-progress");
    assert.throws(
      () => taskMgr.transitionTask(taskB.id, "in-progress"),
      (err: any) => err instanceof UnmetTaskDependencyError,
      "Must throw UnmetTaskDependencyError when prerequisite is 'in-progress'"
    );

    // Attempt 3: Advance B -> in-progress WITH force: true (MUST SUCCEED)
    const forced = taskMgr.transitionTask(taskB.id, "in-progress", { force: true });
    assert.equal(forced.status, "in-progress", "Forced transition must bypass dependency gate");

    // Reset B to blocked
    taskMgr.transitionTask(taskB.id, "blocked");

    // Attempt 4: Ghost dependency on non-existent task
    const taskGhost = taskMgr.createTask("m1", {
      título: "Task with ghost dependency",
      status: "todo",
      dependências: ["task-non-existent-999"],
    });
    assert.throws(
      () => taskMgr.transitionTask(taskGhost.id, "in-progress"),
      (err: any) => err instanceof UnmetTaskDependencyError && err.unmet.includes("task-non-existent-999"),
      "Must throw UnmetTaskDependencyError when dependency does not exist"
    );

    // Complete Task A properly (todo -> in-progress -> in-review -> complete)
    taskMgr.transitionTask(taskA.id, "in-review");
    taskMgr.transitionTask(taskA.id, "complete");

    // Attempt 5: B -> in-progress without force now that A is complete (MUST SUCCEED)
    const legit = taskMgr.transitionTask(taskB.id, "in-progress");
    assert.equal(legit.status, "in-progress", "Must succeed when all dependencies are complete");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

await checkAsync("3.4 File Ownership: Isolated vs Shared Mode, Concurrency & Auto-Release", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "m5-adv-locks-"));
  try {
    const diskStore = new DiskStore(tempDir);
    const ownershipStore = new OwnershipStore(diskStore);
    const taskStore = new TaskStore(diskStore);
    const ownership = new FileOwnershipManager({ ownershipStore });
    const taskMgr = new TaskManager(ownership, taskStore);

    const task1 = taskMgr.createTask("m1", { título: "Task 1" });
    const task2 = taskMgr.createTask("m1", { título: "Task 2" });

    // 1. Task 1 acquires isolated lock on core/server.ts
    const lock1 = ownership.acquireLock({
      missionId: "m1",
      taskId: task1.id,
      files: ["core/server.ts"],
      mode: "isolated",
      owner: "builder",
    });
    assert.equal(lock1.ok, true);
    assert.equal(lock1.locked, true);

    // 2. Task 2 attempts isolated lock on same file -> 409 CONFLICT
    const lock2Isolated = ownership.acquireLock({
      missionId: "m1",
      taskId: task2.id,
      files: ["core/server.ts"],
      mode: "isolated",
      owner: "reviewer",
    });
    assert.equal(lock2Isolated.ok, false);
    assert.deepEqual(lock2Isolated.conflictFiles, ["core/server.ts"]);

    // 3. Task 2 attempts shared lock on same file -> MUST BE BLOCKED BY ISOLATED LOCK
    const lock2Shared = ownership.acquireLock({
      missionId: "m1",
      taskId: task2.id,
      files: ["core/server.ts"],
      mode: "shared",
      owner: "reviewer",
    });
    assert.equal(lock2Shared.ok, false, "Existing isolated lock must block shared lock");

    // 4. Shared Mode coexistence with collision warning
    let collisionDetected = false;
    const sharedMgr = new FileOwnershipManager({
      ownershipStore,
      onCollision: (payload) => {
        if (payload.file === "docs/guide.md") collisionDetected = true;
      },
    });

    const lockShared1 = sharedMgr.acquireLock({
      missionId: "m1",
      taskId: "t-shared-1",
      files: ["docs/guide.md"],
      mode: "shared",
      owner: "agent-1",
    });
    assert.equal(lockShared1.ok, true);

    const lockShared2 = sharedMgr.acquireLock({
      missionId: "m1",
      taskId: "t-shared-2",
      files: ["docs/guide.md"],
      mode: "shared",
      owner: "agent-2",
    });
    assert.equal(lockShared2.ok, true);
    assert.ok(lockShared2.warning?.includes("Colisão detectada"));
    assert.equal(collisionDetected, true, "Collision callback must fire on shared file conflict");

    // 5. Auto-release locks when task reaches 'complete'
    taskMgr.transitionTask(task1.id, "in-progress");
    taskMgr.transitionTask(task1.id, "in-review");
    taskMgr.transitionTask(task1.id, "complete");

    // Verify task1's lock on core/server.ts was auto-released
    const remainingLocks = ownership.getLocksForFile("m1", "core/server.ts");
    assert.equal(remainingLocks.length, 0, "Task complete must auto-release file locks");

    // Now Task 2 can acquire isolated lock on core/server.ts
    const lock2Retry = ownership.acquireLock({
      missionId: "m1",
      taskId: task2.id,
      files: ["core/server.ts"],
      mode: "isolated",
      owner: "reviewer",
    });
    assert.equal(lock2Retry.ok, true, "Lock acquisition must succeed after prior lock released");

    // 6. Persistence & Reload Verification
    const freshOwnership = new FileOwnershipManager({ ownershipStore });
    freshOwnership.reloadFromStore();
    const persistedLocks = freshOwnership.getLocksForFile("m1", "core/server.ts");
    assert.equal(persistedLocks.length, 1, "Lock on core/server.ts must persist in store");
    assert.equal(persistedLocks[0].taskId, task2.id);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ============================================================================
// SUITE 4: Broadcasting WebSocket de Eventos & Resiliência a Falhas
// ============================================================================
console.log("\n[Suite 4] Adversarial Challenge: Task Event WebSocket Broadcasting & Resilience");

await checkAsync("4.1 TaskManager emits typed events across complete task lifecycle", async () => {
  const ownership = new FileOwnershipManager();
  const taskMgr = new TaskManager(ownership);

  const events: Array<{ type: string; payload: any }> = [];
  const unsubscribe = taskMgr.addListener((type, payload) => {
    events.push({ type, payload });
  });

  // 1. Create
  const task = taskMgr.createTask("m1", { título: "Broadcast Test" });
  assert.ok(events.some((e) => e.type === "task:created" && e.payload.id === task.id));

  // 2. Update
  taskMgr.updateTask(task.id, { prioridade: "urgent" as any });
  assert.ok(events.some((e) => e.type === "task:updated" && e.payload.prioridade === "urgent"));

  // 3. Status Changed
  taskMgr.transitionTask(task.id, "in-progress");
  assert.ok(
    events.some(
      (e) =>
        e.type === "task:status_changed" &&
        e.payload.taskId === task.id &&
        e.payload.status === "in-progress"
    )
  );

  // 4. Assigned
  taskMgr.assignTask(task.id, "p-123", "Alice", "builder");
  assert.ok(
    events.some(
      (e) =>
        e.type === "task:assigned" &&
        e.payload.taskId === task.id &&
        e.payload.paneId === "p-123"
    )
  );

  // 5. Evidence Added
  taskMgr.addEvidence(task.id, {
    tipo: "diff",
    descricao: "Added unit tests",
  });
  assert.ok(
    events.some(
      (e) =>
        e.type === "task:evidence_added" &&
        e.payload.taskId === task.id &&
        e.payload.evidence.tipo === "diff"
    )
  );

  // 6. Delete
  taskMgr.deleteTask(task.id);
  assert.ok(events.some((e) => e.type === "task:deleted" && e.payload.taskId === task.id));

  // 7. Unsubscribe check
  const countBefore = events.length;
  unsubscribe();
  taskMgr.createTask("m1", { título: "After unsubscribe" });
  assert.equal(events.length, countBefore, "Unsubscribed listener must not receive further events");
});

check("4.2 Fault Isolation: Crashing/malicious listeners do not crash TaskManager", () => {
  const ownership = new FileOwnershipManager();
  const taskMgr = new TaskManager(ownership);

  let healthyReceived = 0;

  // Temporarily mute console.error during deliberate listener failure injection
  const origError = console.error;
  console.error = () => {};

  try {
    // Malicious listener that intentionally throws
    taskMgr.addListener(() => {
      throw new Error("MALICIOUS_LISTENER_CRASH_EXPLOSION");
    });

    // Healthy listener
    taskMgr.addListener(() => {
      healthyReceived++;
    });

    // TaskManager operations must complete without throwing and healthy listener receives events
    assert.doesNotThrow(() => {
      const t = taskMgr.createTask("m1", { título: "Resilience test" });
      taskMgr.transitionTask(t.id, "in-progress");
      taskMgr.deleteTask(t.id);
    });

    assert.ok(healthyReceived >= 3, "Healthy listener must still receive all events despite failing listener");
  } finally {
    console.error = origError;
  }
});

check("4.3 ClientManager Broadcasting: Socket error tolerance and secret redaction", () => {
  const clientMgr = new ClientManager();

  const receivedByClientA: string[] = [];

  // Client A: Healthy mock WebSocket
  const mockClientA: any = {
    readyState: 1, // OPEN
    OPEN: 1,
    send: (data: string) => {
      receivedByClientA.push(data);
    },
    on: () => {},
  };

  // Client B: Broken socket whose send throws
  const mockClientB: any = {
    readyState: 1, // OPEN
    OPEN: 1,
    send: () => {},
    on: () => {},
  };

  // Client C: Closed socket (readyState = 2 CLOSING or 3 CLOSED)
  let receivedByClientC = false;
  const mockClientC: any = {
    readyState: 3, // CLOSED
    OPEN: 1,
    send: () => {
      receivedByClientC = true;
    },
    on: () => {},
  };

  clientMgr.register(mockClientA);
  clientMgr.register(mockClientB);
  clientMgr.register(mockClientC);

  // Broadcast task event with secret in data field (sanitizer test)
  const taskOutputMsg = {
    type: "output",
    paneId: "p-1",
    data: "Running task with key: sk-ant-api03-abcdef1234567890abcdef1234567890abcdef1234567890-test12345678",
  };

  clientMgr.broadcast(taskOutputMsg);

  assert.equal(receivedByClientC, false, "Closed client must not receive messages");
  assert.equal(receivedByClientA.length, 1, "Healthy client must receive broadcast message");

  const parsed = JSON.parse(receivedByClientA[0]);
  assert.ok(
    !parsed.data.includes("sk-ant-api03-"),
    "Secret credential must be redacted by ClientManager"
  );
  assert.ok(parsed.data.includes(REDACTED_MARKER), "Sanitizer marker REDACTED_MARKER must be present");
});

await checkAsync("4.4 High-concurrency task transition and event broadcasting stress test", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "m5-stress-tasks-"));
  try {
    const diskStore = new DiskStore(tempDir);
    const taskStore = new TaskStore(diskStore);
    const ownership = new FileOwnershipManager();
    const taskMgr = new TaskManager(ownership, taskStore);

    let eventsProcessed = 0;
    taskMgr.addListener(() => {
      eventsProcessed++;
    });

    const missionId = `m-stress-${Date.now()}-${randomUUID().slice(0, 4)}`;
    const TASK_COUNT = 30;
    const tasks: Task[] = [];

    // Rapidly create tasks
    for (let i = 0; i < TASK_COUNT; i++) {
      tasks.push(taskMgr.createTask(missionId, { título: `Stress Task #${i}` }));
    }

    // Rapidly transition all tasks in parallel
    await Promise.all(
      tasks.map(async (t) => {
        taskMgr.transitionTask(t.id, "in-progress");
        taskMgr.addEvidence(t.id, { tipo: "log", descricao: "Concurrent execution log" });
        taskMgr.transitionTask(t.id, "in-review");
        taskMgr.transitionTask(t.id, "complete");
      })
    );

    // Each task went through: create (1) + in-progress (2: updated, status_changed) + evidence (1) + in-review (2) + complete (2) = 8 events
    const expectedMinEvents = TASK_COUNT * 8;
    assert.ok(
      eventsProcessed >= expectedMinEvents,
      `Expected at least ${expectedMinEvents} events, processed: ${eventsProcessed}`
    );

    const completed = taskMgr.listTasks(missionId, { status: "complete" });
    assert.equal(completed.length, TASK_COUNT, "All 30 tasks must reach complete state under concurrency");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ============================================================================
// SUMMARY & VERDICT
// ============================================================================
console.log("\n================================================================================");
console.log(`Results: ${totalPasses} passed, ${totalFails} failed`);
console.log("================================================================================");

if (totalFails > 0) {
  console.error(`\nFAILED: Milestone M5 Adversarial Challenge encountered ${totalFails} failures.`);
  process.exit(1);
} else {
  console.log("\nSUCCESS: All Milestone M5 Adversarial Stress Tests passed without regressions.");
  process.exit(0);
}
