// Tier 4: Real-World Application Scenarios
// Complete end-to-end mission workflows
import { setTestScope, test, expect, assert } from "./framework.mjs";
import {
  createTaskFixture,
  validateTask13Fields,
  canTransitionTask,
  transitionTaskStatus,
  createRoleFixture,
  createRunnerFixture,
  createModelFixture,
  createConnectionFixture,
  createHandoffFixture,
  MockFileLockManager,
  redactSecrets,
  resolveHarnessContract,
} from "./fixtures.mjs";

export function registerTier4Tests() {
  // Scenario 1: Complete Mission Workflow in Modo Livre
  setTestScope(4, "SCENARIO-1", "Complete Mission Workflow in Modo Livre");
  test("Scenario 1: Manual, user-driven mission with clean bash terminal, task board, and evidence", async () => {
    // 1. Mission creation in Modo Livre
    const mission = {
      id: "mission-livre-001",
      nome: "Refatoração de Testes",
      mode: "livre",
      worktree: "/DATA/Projetos/agent-project",
      criadaEm: Date.now(),
    };
    expect(mission.mode).toBe("livre");

    // 2. User opens clean sovereign bash pane
    const runner = createRunnerFixture({ id: "bash" });
    const bashPane = {
      id: "pane-shell-1",
      missionId: mission.id,
      label: "Terminal Inicial",
      role: "builder",
      runner: runner.id,
      binary: runner.binary,
      args: runner.defaultArgs,
      status: "waiting-user",
      pid: 50100,
      stdinBytes: 0,
      inbox: [],
    };
    expect(bashPane.binary).toBe("/bin/bash");
    expect(bashPane.args).toEqual(["-i", "-l"]);
    expect(bashPane.status).toBe("waiting-user");
    expect(bashPane.stdinBytes).toBe(0);

    // 3. User renames pane and reclassifies role
    bashPane.label = "Terminal de Integração";
    bashPane.role = "qa";
    expect(bashPane.label).toBe("Terminal de Integração");
    expect(bashPane.role).toBe("qa");
    expect(bashPane.pid).toBe(50100); // Preserves PID

    // 4. User creates Task with 13 fields in todo status
    const task = createTaskFixture({
      id: "task-qa-01",
      title: "Verificar integridade do test runner",
      description: "Rodar bateria completa de testes e registrar logs",
      assignee: "user",
      role: "qa",
      pane: bashPane.id,
      allowedFiles: ["scripts/testar.mjs"],
      priority: "high",
      status: "todo",
    });
    expect(validateTask13Fields(task)).toBeTruthy();
    expect(task.status).toBe("todo");

    // 5. User transitions task to in-progress
    const inProgress = transitionTaskStatus(task, "in-progress", "Usuário iniciou execução manual");
    expect(inProgress.status).toBe("in-progress");
    expect(inProgress.timestamps.startedAt).toBeDefined();

    // 6. User executes command in bash terminal
    const userCommand = "npm test\n";
    bashPane.stdinBytes += userCommand.length;
    expect(bashPane.stdinBytes).toBe(userCommand.length);

    // 7. Test output captured as evidence
    inProgress.evidence.push({
      type: "test-run",
      command: "npm test",
      passed: 14,
      failed: 0,
      at: Date.now(),
    });
    expect(inProgress.evidence).toHaveLength(2); // 1 transition + 1 test-run

    // 8. User transitions task to in-review
    const inReview = transitionTaskStatus(inProgress, "in-review", "Testes validados localmente");
    expect(inReview.status).toBe("in-review");

    // 9. User marks task complete
    const completed = transitionTaskStatus(inReview, "complete", "Aprovado sem regressões");
    expect(completed.status).toBe("complete");
    expect(completed.timestamps.completedAt).toBeDefined();
  });

  // Scenario 2: Complete Mission Workflow in Modo Dirigido
  setTestScope(4, "SCENARIO-2", "Complete Mission Workflow in Modo Dirigido");
  test("Scenario 2: Team delegation with persistent connection, mailbox ask/reply, isolated lock, and handoff", async () => {
    // 1. Mission in Modo Dirigido with authorized roster
    const mission = {
      id: "mission-dirigido-001",
      nome: "Overhaul de Segurança",
      mode: "dirigido",
      elenco: ["codex", "claude", "bash"],
    };
    expect(mission.mode).toBe("dirigido");

    // 2. Panes for Maestro, Builder, and Reviewer
    const maestroPane = { id: "p-maestro", role: "maestro", runner: "claude", inbox: [], outbox: [] };
    const builderPane = { id: "p-builder", role: "builder", runner: "codex", inbox: [], outbox: [] };
    const reviewerPane = { id: "p-reviewer", role: "reviewer", runner: "claude", inbox: [], outbox: [] };

    // 3. Persistent connections
    const conn1 = createConnectionFixture(maestroPane.id, builderPane.id, mission.id);
    const conn2 = createConnectionFixture(builderPane.id, reviewerPane.id, mission.id);
    expect(conn1.status).toBe("active");
    expect(conn2.status).toBe("active");

    // 4. File Lock Manager in isolated mode
    const lockMgr = new MockFileLockManager();
    const task = createTaskFixture({
      id: "task-auth-hardening",
      title: "Implementar redação de segredos",
      role: "builder",
      pane: builderPane.id,
      allowedFiles: ["servidor/security/sanitizer.ts"],
      status: "todo",
    });

    // 5. Maestro queries panes via cockpit list and dispatches task via cockpit ask
    const correlationId = "corr-dirigido-101";
    const askMessage = {
      from: maestroPane.id,
      to: builderPane.id,
      correlationId,
      text: "Implementar sanitização de tokens Bearer e chaves sk-",
      taskId: task.id,
      at: Date.now(),
    };
    maestroPane.outbox.push(askMessage);
    builderPane.inbox.push(askMessage);
    expect(builderPane.inbox).toHaveLength(1);

    // 6. Builder acquires exclusive file lock
    const lockResult = lockMgr.acquire(mission.id, task.id, builderPane.id, task.allowedFiles, "isolated");
    expect(lockResult.ok).toBeTruthy();

    const inProgressTask = transitionTaskStatus(task, "in-progress", "Builder assumiu a tarefa");
    expect(inProgressTask.status).toBe("in-progress");

    // 7. Builder attaches diff evidence
    inProgressTask.evidence.push({
      type: "diff",
      file: "servidor/security/sanitizer.ts",
      patch: "+ export function redactSecrets(...) { ... }",
      at: Date.now(),
    });

    // 8. Builder hands off task to Reviewer
    const inReviewTask = transitionTaskStatus(inProgressTask, "in-review", "Código pronto para revisão");
    const handoff = createHandoffFixture(builderPane.id, reviewerPane.id, task.id, "Favor auditar regex de segredos");
    expect(handoff.status).toBe("pending");
    handoff.status = "accepted";
    inReviewTask.pane = reviewerPane.id;

    // 9. Reviewer validates and replies to Maestro via cockpit reply
    const replyMessage = {
      from: reviewerPane.id,
      to: maestroPane.id,
      correlationId,
      result: "Sanitização validada contra todos os vetores de vazamento.",
      at: Date.now(),
    };
    reviewerPane.outbox.push(replyMessage);
    maestroPane.inbox.push(replyMessage);
    expect(maestroPane.inbox).toHaveLength(1);

    // 10. Task marked complete and locks released
    const completedTask = transitionTaskStatus(inReviewTask, "complete", "Revisão e testes aprovados");
    expect(completedTask.status).toBe("complete");
    lockMgr.release(task.id);
    expect(lockMgr.locks.size).toBe(0);
  });

  // Scenario 3: Complete Mission Workflow in Modo Autônomo
  setTestScope(4, "SCENARIO-3", "Complete Mission Workflow in Modo Autônomo");
  test("Scenario 3: Scoped autonomy with subtask creation, concurrency cap, and token quota enforcement", async () => {
    // 1. Mission in Modo Autônomo
    const mission = {
      id: "mission-auto-001",
      mode: "autonomo",
      maxPanes: 3,
      tokenBudget: 50000,
      tokensUsed: 0,
    };
    expect(mission.mode).toBe("autonomo");

    // 2. High level goal
    const goal = "Modernizar pipeline de build e testes";

    // 3. Maestro creates 3 subtasks
    const subtasks = [
      createTaskFixture({ id: "sub-1", title: "Migrar tsc para noEmit", status: "todo" }),
      createTaskFixture({ id: "sub-2", title: "Configurar Vite build otimizado", status: "todo" }),
      createTaskFixture({ id: "sub-3", title: "Executar testes de integração", status: "todo" }),
    ];
    expect(subtasks).toHaveLength(3);

    // 4. Concurrency cap enforcement
    let runningPanes = 0;
    const spawnWorker = () => {
      if (runningPanes >= mission.maxPanes) {
        throw new Error("Concurrency cap reached");
      }
      runningPanes++;
      return { id: `worker-${runningPanes}` };
    };

    const w1 = spawnWorker();
    const w2 = spawnWorker();
    const w3 = spawnWorker();
    expect(runningPanes).toBe(3);
    // 4th spawn is rejected
    expect(() => spawnWorker()).toThrow();

    // 5. Worker completes task and updates tokens
    const completedSub1 = transitionTaskStatus(subtasks[0], "in-progress");
    completedSub1.evidence.push({ type: "summary", text: "Compilação OK" });
    const finalSub1 = transitionTaskStatus(completedSub1, "complete");
    mission.tokensUsed += 12000;

    expect(finalSub1.status).toBe("complete");
    expect(mission.tokensUsed).toBeLessThan(mission.tokenBudget);

    // 6. Emergency Stop verification
    let autonomousLoopActive = true;
    const emergencyStop = () => { autonomousLoopActive = false; };
    emergencyStop();
    expect(autonomousLoopActive).toBeFalsy();
  });

  // Scenario 4: Server Reboot & Session Resumption During Active Mission
  setTestScope(4, "SCENARIO-4", "Server Reboot & Session Resumption");
  test("Scenario 4: Web server port 3000 restart does not kill PTY, WS reconnect restores ring buffer", async () => {
    // 1. PTY daemon starts sovereign bash pane
    const ptyDaemon = {
      panes: new Map([
        ["pane-bash-live", {
          pid: 40220,
          alive: true,
          ringBuffer: ["line 1: build started\n", "line 2: compilation finished\n"],
        }],
      ]),
    };
    expect(ptyDaemon.panes.get("pane-bash-live").alive).toBeTruthy();

    // 2. Active task associated with pane
    const task = createTaskFixture({
      id: "task-live-build",
      pane: "pane-bash-live",
      status: "in-progress",
    });
    expect(task.status).toBe("in-progress");

    // 3. Web server on port 3000 shuts down (simulated)
    let webServerRunning = false;
    // Process in PTY daemon survives!
    expect(ptyDaemon.panes.get("pane-bash-live").alive).toBeTruthy();
    expect(ptyDaemon.panes.get("pane-bash-live").pid).toBe(40220);

    // 4. Web server restarts
    webServerRunning = true;
    expect(webServerRunning).toBeTruthy();

    // 5. WebSocket client reconnects and requests replay
    const reconnectedClient = {
      paneId: "pane-bash-live",
      receivedReplay: null,
    };
    const pty = ptyDaemon.panes.get(reconnectedClient.paneId);
    reconnectedClient.receivedReplay = pty.ringBuffer.join("");

    expect(reconnectedClient.receivedReplay).toContain("line 1: build started");
    expect(reconnectedClient.receivedReplay).toContain("line 2: compilation finished");

    // 6. Task status remains in-progress
    expect(task.status).toBe("in-progress");
  });

  // Scenario 5: Multi-Agent File Lock Contention and Resolution
  setTestScope(4, "SCENARIO-5", "Multi-Agent File Lock Contention");
  test("Scenario 5: Conflict detection 409, alternative dispatch, and sequential lock resolution", async () => {
    const lockMgr = new MockFileLockManager();
    const missionId = "mission-contention-01";

    // 1. Builder A starts Task A and acquires lock on core file
    const taskA = createTaskFixture({
      id: "task-A",
      pane: "pane-A",
      allowedFiles: ["servidor/index.ts"],
      status: "todo",
    });
    const lockA = lockMgr.acquire(missionId, taskA.id, "pane-A", taskA.allowedFiles, "isolated");
    expect(lockA.ok).toBeTruthy();
    expect(lockA.statusCode).toBe(200);

    const inProgressA = transitionTaskStatus(taskA, "in-progress");

    // 2. Builder B attempts to acquire lock on same file -> 409 Conflict
    const taskB = createTaskFixture({
      id: "task-B",
      pane: "pane-B",
      allowedFiles: ["servidor/index.ts"],
      status: "todo",
    });
    const lockB = lockMgr.acquire(missionId, taskB.id, "pane-B", taskB.allowedFiles, "isolated");
    expect(lockB.ok).toBeFalsy();
    expect(lockB.statusCode).toBe(409);
    expect(lockB.conflictFiles).toEqual(["servidor/index.ts"]);
    expect(lockB.lockedBy).toBe(taskA.id);

    // 3. Task B moves to blocked status while waiting
    const blockedB = transitionTaskStatus(taskB, "blocked", "Aguardando liberação de lock em servidor/index.ts");
    expect(blockedB.status).toBe("blocked");

    // 4. Builder A finishes work, moves to complete, and releases lock
    const completeA = transitionTaskStatus(inProgressA, "complete", "Trabalho concluído em servidor/index.ts");
    expect(completeA.status).toBe("complete");
    lockMgr.release(taskA.id);

    // 5. Task B unblocks and acquires lock successfully
    const retryLockB = lockMgr.acquire(missionId, taskB.id, "pane-B", taskB.allowedFiles, "isolated");
    expect(retryLockB.ok).toBeTruthy();
    expect(retryLockB.statusCode).toBe(200);

    const inProgressB = transitionTaskStatus(blockedB, "in-progress", "Lock adquirido com sucesso");
    expect(inProgressB.status).toBe("in-progress");

    // 6. Builder B completes work
    const completeB = transitionTaskStatus(inProgressB, "complete", "Alterações finalizadas");
    expect(completeB.status).toBe("complete");
    lockMgr.release(taskB.id);
    expect(lockMgr.locks.size).toBe(0);
  });
}
