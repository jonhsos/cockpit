import assert from "node:assert/strict";
import {
  FileOwnershipManager,
  TaskManager,
  InvalidTaskStateTransitionError,
  UnmetTaskDependencyError,
} from "../servidor/tasks/index.ts";

console.log("Running check-tasks.ts...");

const ownership = new FileOwnershipManager();
const taskManager = new TaskManager(ownership);

const missionId = "mission-test-tasks";

// Case 1: 13 Fields - Creating task generates all 13 canonical fields, status todo, initialized timestamps
const t1 = taskManager.createTask(missionId, {
  titulo: "Implementar autenticação",
  descricao: "Criar fluxo JWT para login",
  responsavel: "builder-1",
  papel: "builder",
  arquivosPermitidos: ["src/auth.ts", "src/tokens.ts"],
  dependencias: [],
  prioridade: "high",
});

assert.ok(t1.id, "Task must have an id");
assert.equal(t1.título, "Implementar autenticação");
assert.equal(t1.descrição, "Criar fluxo JWT para login");
assert.equal(t1.responsável, "builder-1");
assert.equal(t1.papel, "builder");
assert.equal(t1.pane, null);
assert.deepEqual(t1["arquivos permitidos"], ["src/auth.ts", "src/tokens.ts"]);
assert.deepEqual(t1.dependências, []);
assert.equal(t1.prioridade, "high");
assert.equal(t1.status, "todo");
assert.deepEqual(t1.evidências, []);
assert.equal(t1.resultado, null);
assert.ok(t1.timestamps.criadaEm > 0, "criadaEm must be initialized");
assert.ok(t1.timestamps.atualizadaEm > 0, "atualizadaEm must be initialized");
assert.equal(t1.timestamps.iniciadaEm, undefined);
assert.equal(t1.timestamps.concluidaEm, undefined);
console.log("  ✓ Case 1: 13 Fields validated");

// Case 2: Lifecycle - todo -> in-progress sets iniciadaEm, in-progress -> in-review -> complete sets concluidaEm
const started = taskManager.transitionTask(t1.id, "in-progress");
assert.equal(started.status, "in-progress");
assert.ok(started.timestamps.iniciadaEm !== undefined, "iniciadaEm must be set");
assert.equal(started.timestamps.concluidaEm, undefined);

const inReview = taskManager.transitionTask(t1.id, "in-review");
assert.equal(inReview.status, "in-review");

const completed = taskManager.transitionTask(t1.id, "complete", {
  resultado: "Autenticação JWT concluída com 100% de cobertura",
});
assert.equal(completed.status, "complete");
assert.ok(completed.timestamps.concluidaEm !== undefined, "concluidaEm must be set");
assert.equal(completed.resultado, "Autenticação JWT concluída com 100% de cobertura");
console.log("  ✓ Case 2: Lifecycle transitions and timestamps validated");

// Case 3: Strict Validation - Invalid transitions throw InvalidTaskStateTransitionError
const t2 = taskManager.createTask(missionId, {
  titulo: "Tarefa de validação estrita",
  papel: "reviewer",
});

// todo -> complete (bypass in-progress and in-review) must fail
assert.throws(
  () => {
    taskManager.transitionTask(t2.id, "complete");
  },
  (err: any) => err instanceof InvalidTaskStateTransitionError
);

// complete -> in-progress must fail (must reopen to todo first)
assert.throws(
  () => {
    taskManager.transitionTask(completed.id, "in-progress");
  },
  (err: any) => err instanceof InvalidTaskStateTransitionError
);
console.log("  ✓ Case 3: Invalid transition rejection validated");

// Case 4: Dependencies - Unmet dependency throws UnmetTaskDependencyError
const depTask = taskManager.createTask(missionId, {
  titulo: "Dependência de banco",
  papel: "builder",
});

const blockedTask = taskManager.createTask(missionId, {
  titulo: "Migração de esquema",
  papel: "builder",
  dependencias: [depTask.id],
});

assert.throws(
  () => {
    taskManager.transitionTask(blockedTask.id, "in-progress");
  },
  (err: any) => err instanceof UnmetTaskDependencyError && err.unmet.includes(depTask.id)
);

// Resolve dependency: todo -> in-progress -> in-review -> complete
taskManager.transitionTask(depTask.id, "in-progress");
taskManager.transitionTask(depTask.id, "in-review");
taskManager.transitionTask(depTask.id, "complete");

// Now blockedTask can start
const unblockedTask = taskManager.transitionTask(blockedTask.id, "in-progress");
assert.equal(unblockedTask.status, "in-progress");
console.log("  ✓ Case 4: Dependency resolution validated");

// Case 5: Reopen - Reopening from complete -> todo or failed -> todo clears concluidaEm
const reopened = taskManager.transitionTask(completed.id, "todo");
assert.equal(reopened.status, "todo");
assert.equal(reopened.timestamps.concluidaEm, undefined);

const failTask = taskManager.createTask(missionId, { titulo: "Tarefa falha", papel: "builder" });
taskManager.transitionTask(failTask.id, "in-progress");
taskManager.transitionTask(failTask.id, "failed");
assert.ok(taskManager.getTask(failTask.id)!.timestamps.concluidaEm !== undefined);

const reopenedFail = taskManager.transitionTask(failTask.id, "todo");
assert.equal(reopenedFail.status, "todo");
assert.equal(reopenedFail.timestamps.concluidaEm, undefined);
console.log("  ✓ Case 5: Reopen state and timestamp reset validated");

// Case 6: Evidence Logging - Adding diff and test run evidence
const ev1 = taskManager.addEvidence(unblockedTask.id, {
  tipo: "diff",
  descricao: "Modificação nos esquemas SQL",
  diff: "--- a/schema.sql\n+++ b/schema.sql\n@@ -1 +1 @@\n-old\n+new",
});
assert.ok(ev1.id);
assert.equal(ev1.tipo, "diff");

const ev2 = taskManager.addEvidence(unblockedTask.id, {
  tipo: "test_run",
  descricao: "Testes de integridade de esquema",
  status: "passed",
});
assert.equal(ev2.status, "passed");

const taskWithEvidence = taskManager.getTask(unblockedTask.id)!;
assert.equal(taskWithEvidence.evidências.length, 2);
console.log("  ✓ Case 6: Evidence logging validated");

// Case 7: Knowledge Logging - Recording knowledge creates evidence of type knowledge
const kn = taskManager.recordKnowledge(
  unblockedTask.id,
  "Postgres 16 requer índices parciais para chaves nulas",
  "Snippet e lição aprendida durante migração",
  "architect-1"
);
assert.equal(kn.tipo, "knowledge");
assert.equal(kn.descricao, "Postgres 16 requer índices parciais para chaves nulas");
assert.equal(kn.autor, "architect-1");
console.log("  ✓ Case 7: Knowledge logging validated");

// Case 8: Modo Isolado - Task A locks server.ts, Task B cannot lock server.ts
const lockA = ownership.acquireLock({
  missionId,
  taskId: "task-A",
  paneId: "pane-1",
  files: ["src/server.ts", "src/routes.ts"],
  mode: "isolated",
  owner: "agent-A",
});
assert.equal(lockA.ok, true);
assert.equal(lockA.locked, true);

const lockB = ownership.acquireLock({
  missionId,
  taskId: "task-B",
  paneId: "pane-2",
  files: ["src/server.ts", "src/client.ts"],
  mode: "isolated",
  owner: "agent-B",
});
assert.equal(lockB.ok, false);
assert.equal(lockB.locked, false);
assert.deepEqual(lockB.conflictFiles, ["src/server.ts"]);
console.log("  ✓ Case 8: Isolated mode exclusive locks validated");

// Case 9: Modo Compartilhado - Concurrent locks allowed with collision warning
const lockSharedA = ownership.acquireLock({
  missionId: "mission-shared",
  taskId: "task-shared-1",
  files: ["common.ts"],
  mode: "shared",
});
assert.equal(lockSharedA.ok, true);

const lockSharedB = ownership.acquireLock({
  missionId: "mission-shared",
  taskId: "task-shared-2",
  files: ["common.ts"],
  mode: "shared",
});
assert.equal(lockSharedB.ok, true);
assert.ok(lockSharedB.warning !== undefined, "Warning must be generated on shared collision");
assert.deepEqual(lockSharedB.conflictFiles, ["common.ts"]);
console.log("  ✓ Case 9: Shared mode collision warnings validated");

// Case 10: Auto Lock Release - Moving task to complete automatically releases its file locks
const taskWithLocks = taskManager.createTask(missionId, {
  titulo: "Tarefa com travas",
  papel: "builder",
});
ownership.acquireLock({
  missionId,
  taskId: taskWithLocks.id,
  files: ["locked-file.ts"],
  mode: "isolated",
});

assert.equal(ownership.getLocksForFile(missionId, "locked-file.ts").length, 1);
taskManager.transitionTask(taskWithLocks.id, "in-progress");
taskManager.transitionTask(taskWithLocks.id, "in-review");
taskManager.transitionTask(taskWithLocks.id, "complete");

assert.equal(
  ownership.getLocksForFile(missionId, "locked-file.ts").length,
  0,
  "Locks must be released upon task completion"
);
console.log("  ✓ Case 10: Auto lock release on completion validated");

// Case 11: Filesystem 409 Enforcement - checkAccess returns allowed: false for isolated locked files
const checkDenied = ownership.checkAccess(missionId, "src/server.ts", { taskId: "task-intruder" });
assert.equal(checkDenied.allowed, false);
assert.ok(checkDenied.conflict !== undefined);

const checkAllowedForOwner = ownership.checkAccess(missionId, "src/server.ts", { taskId: "task-A" });
assert.equal(checkAllowedForOwner.allowed, true);
console.log("  ✓ Case 11: Filesystem access check enforcement validated");

// Case 12: Task Board - getBoard() groups tasks into the 6 status columns
const board = taskManager.getBoard(missionId);
assert.equal(board.missionId, missionId);
assert.ok(Array.isArray(board.todo));
assert.ok(Array.isArray(board["in-progress"]));
assert.ok(Array.isArray(board.blocked));
assert.ok(Array.isArray(board["in-review"]));
assert.ok(Array.isArray(board.complete));
assert.ok(Array.isArray(board.failed));
assert.ok(board.total > 0);
assert.equal(
  board.total,
  board.todo.length +
    board["in-progress"].length +
    board.blocked.length +
    board["in-review"].length +
    board.complete.length +
    board.failed.length
);
console.log("  ✓ Case 12: Interactive Sidebar Task Board grouping validated");

console.log("\nPASS: all task and ownership checks passed.");
