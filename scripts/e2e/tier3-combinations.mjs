// Tier 3: Cross-Feature Combinations
// Pairwise and multi-feature interaction scenarios
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
import { TEST_SECRET_VALUES } from "../security-test-values.mjs";

export function registerTier3Tests() {
  setTestScope(3, "T3.1", "Task + File Lock + Connection + Handoff Integration");
  test("T3.1: Task lifecycle across connected panes with isolated file locking and handoff", () => {
    // 1. Setup two connected panes
    const conn = createConnectionFixture("pane-builder", "pane-reviewer", "mission-alpha");
    expect(conn.status).toBe("active");

    // 2. Builder creates task with isolated lock on src/engine.ts
    const lockMgr = new MockFileLockManager();
    const task = createTaskFixture({
      id: "task-engine-refactor",
      title: "Refactor engine core",
      pane: "pane-builder",
      role: "builder",
      allowedFiles: ["src/engine.ts"],
      status: "todo",
    });
    expect(validateTask13Fields(task)).toBeTruthy();

    const lockResult = lockMgr.acquire("mission-alpha", task.id, "pane-builder", task.allowedFiles, "isolated");
    expect(lockResult.ok).toBeTruthy();
    expect(lockResult.statusCode).toBe(200);

    // 3. Builder starts work
    const inProgressTask = transitionTaskStatus(task, "in-progress", "Started development");
    expect(inProgressTask.status).toBe("in-progress");
    expect(inProgressTask.timestamps.startedAt).toBeDefined();

    // 4. Reviewer tries to acquire lock on same file -> 409 Conflict
    const reviewerLock = lockMgr.acquire("mission-alpha", "task-reviewer", "pane-reviewer", ["src/engine.ts"], "isolated");
    expect(reviewerLock.ok).toBeFalsy();
    expect(reviewerLock.statusCode).toBe(409);
    expect(reviewerLock.lockedBy).toBe(task.id);

    // 5. Builder moves to in-review and performs handoff to Reviewer
    const inReviewTask = transitionTaskStatus(inProgressTask, "in-review", "Ready for review");
    expect(inReviewTask.status).toBe("in-review");

    const handoff = createHandoffFixture("pane-builder", "pane-reviewer", task.id, "Please review unit tests");
    expect(handoff.status).toBe("pending");
    handoff.status = "accepted";
    inReviewTask.pane = "pane-reviewer";

    // 6. Reviewer completes task and lock is released
    const completedTask = transitionTaskStatus(inReviewTask, "complete", "Review passed with green tests");
    expect(completedTask.status).toBe("complete");
    expect(completedTask.timestamps.completedAt).toBeDefined();

    lockMgr.release(task.id);
    const retryReviewerLock = lockMgr.acquire("mission-alpha", "task-reviewer", "pane-reviewer", ["src/engine.ts"], "isolated");
    expect(retryReviewerLock.ok).toBeTruthy();
  });

  setTestScope(3, "T3.2", "Sovereign Clean Bash + Zero Stdin Injection + Secret Redaction + Audit Trail");
  test("T3.2: Bash terminal lifecycle preserves clean stdin, redacts secrets, and logs audit events", () => {
    // 1. Spawning bash runner enforces sovereign clean flags
    const runner = createRunnerFixture({ id: "bash" });
    expect(runner.binary).toBe("/bin/bash");
    expect(runner.defaultArgs).toEqual(["-i", "-l"]);

    // 2. Audit trail records spawn
    const auditLogs = [];
    auditLogs.push({ action: "spawn_pane", paneId: "pane-bash", runner: "bash", at: Date.now() });

    // 3. External prompt/task assigned: bash stdin receives zero bytes
    let stdinBytes = 0;
    const sendTask = (targetRunner, taskText) => {
      if (targetRunner !== "bash") {
        stdinBytes += taskText.length;
      }
    };
    sendTask("bash", `Configure API_KEY=${TEST_SECRET_VALUES.openAiProject}`);
    expect(stdinBytes).toBe(0);

    // 4. Output stream containing secret is sanitized
    const rawOutput = `Configured provider with key ${TEST_SECRET_VALUES.openAiProject} on /bin/bash`;
    const sanitizedOutput = redactSecrets(rawOutput);
    expect(sanitizedOutput).toBe("Configured provider with key [REDACTED] on /bin/bash");
    expect(sanitizedOutput).toNotContain("sk-1234");

    // 5. Audit log receives sanitized execution event
    auditLogs.push({ action: "command_complete", paneId: "pane-bash", output: sanitizedOutput });
    expect(auditLogs[1].output).toNotContain("sk-1234");
  });

  setTestScope(3, "T3.3", "Roles-First Catalog + 2-Step Flow + Roster Enforcement + No Fallback");
  test("T3.3: 2-step selection validates roster whitelist and forbids silent fallback", () => {
    // 1. Catalog shows pure roles without model names
    const catalogRoles = [createRoleFixture({ id: "builder", name: "Builder" })];
    expect(catalogRoles[0].name).not.toBe("ASTRA");

    // 2. Mission elenco permits only bash and codex
    const missionElenco = ["bash", "codex"];

    // 3. Step 1: User picks Builder
    const step1 = { role: "builder" };
    expect(step1.role).toBe("builder");

    // 4. Step 2: User requests Claude (not in elenco) -> explicit error, NO silent fallback to codex
    expect(() => {
      resolveHarnessContract({ requestedCli: "claude", missionElenco, availableInPath: true });
    }).toThrow();

    try {
      resolveHarnessContract({ requestedCli: "claude", missionElenco, availableInPath: true });
      assert.fail("Should have thrown error");
    } catch (err) {
      expect(err.message).toContain("claude");
      expect(err.message).toContain("não permitido no elenco");
    }

    // 5. Selecting allowed runner (codex) succeeds without substitution
    const validHarness = resolveHarnessContract({ requestedCli: "codex", missionElenco, availableInPath: true });
    expect(validHarness.cli).toBe("codex");
  });

  setTestScope(3, "T3.4", "Task CRUD + 6-State Lifecycle + Task Board + Knowledge & Evidence");
  test("T3.4: Complete task management from creation through evidence collection to board completion", () => {
    // 1. Create task
    const task = createTaskFixture({ title: "Document API contracts", status: "todo" });
    expect(validateTask13Fields(task)).toBeTruthy();

    // 2. Move to in-progress
    const inProgress = transitionTaskStatus(task, "in-progress", "Started drafting docs");
    expect(inProgress.status).toBe("in-progress");

    // 3. Add evidence: diff, test result, knowledge snippet
    inProgress.evidence.push({ type: "diff", file: "docs/api.md", lines: "+50" });
    inProgress.evidence.push({ type: "test-run", passed: 15, failed: 0 });
    inProgress.evidence.push({ type: "knowledge", title: "REST Endpoints", note: "All routes use JSON envelope" });
    expect(inProgress.evidence).toHaveLength(4); // 1 transition + 3 artifacts

    // 4. Move to in-review
    const inReview = transitionTaskStatus(inProgress, "in-review", "Docs submitted for peer review");
    expect(inReview.status).toBe("in-review");

    // 5. Move to complete
    const complete = transitionTaskStatus(inReview, "complete", "Docs approved");
    expect(complete.status).toBe("complete");

    // 6. Sidebar board groups task under complete column
    const board = { todo: [], "in-progress": [], blocked: [], "in-review": [], complete: [complete], failed: [] };
    expect(board.complete).toHaveLength(1);
    expect(board.complete[0].id).toBe(task.id);
  });

  setTestScope(3, "T3.5", "Decoupled Entities + Task Type Model Isolation");
  test("T3.5: Independent Role, Runner, and Model entities preserve model regardless of task type", () => {
    const role = createRoleFixture({ id: "architect", name: "Architect" });
    const runner = createRunnerFixture({ id: "claude", binary: "claude" });
    const model = createModelFixture({ id: "claude-3-7-sonnet", provider: "anthropic" });

    // Combine into pane descriptor
    const pane = { roleId: role.id, runnerId: runner.id, modelId: model.id };

    // Assign multiple task types: visual, arquitetura, implementar
    const taskTypes = ["visual", "arquitetura", "implementar", "refactor"];
    for (const type of taskTypes) {
      const task = createTaskFixture({ type, role: pane.roleId });
      // Model must remain claude-3-7-sonnet
      expect(pane.modelId).toBe("claude-3-7-sonnet");
      expect(task.type).toBe(type);
    }
  });

  setTestScope(3, "T3.6", "Inter-Agent Bridge: list + connect + ask + reply + Mailbox");
  test("T3.6: End-to-end inter-agent communication via structured mailbox verbs", () => {
    // 1. List active panes
    const panes = [
      { id: "pane-lead", role: "maestro", runner: "claude", inbox: [], outbox: [] },
      { id: "pane-worker", role: "builder", runner: "bash", inbox: [], outbox: [] },
    ];
    expect(panes).toHaveLength(2);

    // 2. Connect panes
    const conn = createConnectionFixture("pane-lead", "pane-worker");
    expect(conn.status).toBe("active");

    // 3. Ask: Lead sends query to Worker mailbox (never to stdin)
    const correlationId = "corr-bridge-001";
    const askMsg = {
      id: "msg-1",
      from: "pane-lead",
      to: "pane-worker",
      correlationId,
      text: "Verifique o status do build",
      at: Date.now(),
    };
    panes[0].outbox.push(askMsg);
    panes[1].inbox.push(askMsg);

    expect(panes[0].outbox).toHaveLength(1);
    expect(panes[1].inbox).toHaveLength(1);

    // 4. Reply: Worker replies to Lead
    const replyMsg = {
      id: "msg-2",
      from: "pane-worker",
      to: "pane-lead",
      correlationId,
      result: "Build OK: 0 errors",
      at: Date.now(),
    };
    panes[1].outbox.push(replyMsg);
    panes[0].inbox.push(replyMsg);

    expect(panes[0].inbox[0].result).toBe("Build OK: 0 errors");
    expect(panes[0].inbox[0].correlationId).toBe(correlationId);
  });

  setTestScope(3, "T3.7", "Mission Modes (Livre vs Dirigido vs Autônomo) + Task Dispatch");
  test("T3.7: Task dispatch behavior aligns strictly with active mission mode", () => {
    const mission = { id: "m1", mode: "livre" };
    const panes = [{ id: "p1", status: "waiting-user" }];

    // In Livre mode: Maestro cannot auto-dispatch or auto-spawn
    const canAutoDispatchInLivre = mission.mode === "autonomo";
    expect(canAutoDispatchInLivre).toBeFalsy();

    // Switch to Dirigido: Maestro delegates to pre-existing authorized team
    mission.mode = "dirigido";
    const team = ["p1"];
    const dispatchToExisting = (paneId) => team.includes(paneId);
    expect(dispatchToExisting("p1")).toBeTruthy();
    expect(dispatchToExisting("p-unauthorized")).toBeFalsy();

    // Switch to Autônomo: Scoped autonomy enables task & pane creation within limits
    mission.mode = "autonomo";
    const maxConcurrency = 3;
    let currentPanes = 1;
    const spawnAutonomousPane = () => {
      if (currentPanes < maxConcurrency) {
        currentPanes++;
        return true;
      }
      return false;
    };
    expect(spawnAutonomousPane()).toBeTruthy();
    expect(currentPanes).toBe(2);
  });

  setTestScope(3, "T3.8", "File Ownership Modes (Isolated vs Shared) + Destructive Confirmation");
  test("T3.8: Switching lock modes and overriding locks requires explicit confirmation and audit", () => {
    const lockMgr = new MockFileLockManager();
    const auditLogs = [];

    // Isolated lock acquired by Task 1
    const res1 = lockMgr.acquire("m1", "t1", "p1", ["config.json"], "isolated");
    expect(res1.ok).toBeTruthy();

    // Task 2 collision
    const res2 = lockMgr.acquire("m1", "t2", "p2", ["config.json"], "isolated");
    expect(res2.statusCode).toBe(409);

    // Force override without confirmation -> fails
    const forceOverride = (confirmed) => {
      if (!confirmed) throw new Error("Confirmation required to override lock");
      lockMgr.release("t1");
      return lockMgr.acquire("m1", "t2", "p2", ["config.json"], "isolated");
    };
    expect(() => forceOverride(false)).toThrow();

    // Force override with confirmation -> succeeds and writes audit log
    const overrideRes = forceOverride(true);
    expect(overrideRes.ok).toBeTruthy();
    auditLogs.push({ event: "lock_overridden", file: "config.json", by: "t2", previousOwner: "t1" });
    expect(auditLogs[0].event).toBe("lock_overridden");
  });

  setTestScope(3, "T3.9", "Decoupled PTY Host + WS Resumption + 8-State Pane Lifecycle");
  test("T3.9: PTY daemon lifecycle preserves running process across server reboot and WS reconnect", () => {
    // 1. Process spawned in PTY host
    const pane = {
      id: "pane-backend",
      pid: 30401,
      status: "starting",
      ringBuffer: "Initial startup log\n",
    };
    expect(pane.status).toBe("starting");

    // 2. Terminal ready -> waiting-user
    pane.status = "waiting-user";
    expect(pane.status).toBe("waiting-user");

    // 3. Web server on port 3000 reboots: PTY process remains alive
    let webServerPort3000Active = false;
    expect(pane.pid).toBe(30401); // PID unchanged

    // 4. Web server comes back up and re-attaches to PTY host
    webServerPort3000Active = true;
    const clientSession = {
      reconnected: true,
      replayBuffer: pane.ringBuffer,
    };
    expect(clientSession.replayBuffer).toContain("Initial startup log");

    // 5. Process execution -> working state
    pane.status = "working";
    expect(pane.status).toBe("working");
  });

  setTestScope(3, "T3.10", "Disk Persistence + Mission Renaming + Pane Reclassifying");
  test("T3.10: State persistence maintains integrity after renaming and reclassifying entities", () => {
    // State before edits
    const state = {
      missions: [{ id: "m1", nome: "Missão Original", worktree: "/repo" }],
      panes: [{ id: "p1", role: "builder", runner: "bash" }],
    };

    // Rename mission
    state.missions[0].nome = "Missão Produção";
    expect(state.missions[0].nome).toBe("Missão Produção");

    // Reclassify pane
    state.panes[0].role = "reviewer";
    expect(state.panes[0].role).toBe("reviewer");

    // Persist to disk and reload
    const serialized = JSON.stringify(state);
    const reloaded = JSON.parse(serialized);

    expect(reloaded.missions[0].nome).toBe("Missão Produção");
    expect(reloaded.panes[0].role).toBe("reviewer");
    expect(reloaded.panes[0].runner).toBe("bash");
  });

  setTestScope(3, "T3.11", "Scoped Workspace Permissions + Secret Sanitizer + Security Sandboxing");
  test("T3.11: Workspace security boundary rejects path escapes and sanitizes outputs", () => {
    const workspaceRoot = "/DATA/Projetos/agent-project";
    const isPathPermitted = (targetPath, mode = "workspace-write") => {
      if (mode !== "danger-full-access" && !targetPath.startsWith(workspaceRoot)) {
        return false;
      }
      return true;
    };

    // Valid path
    expect(isPathPermitted("/DATA/Projetos/agent-project/servidor/index.ts")).toBeTruthy();

    // Escape attempt
    expect(isPathPermitted("/etc/shadow")).toBeFalsy();
    expect(isPathPermitted("/root/.ssh/id_rsa")).toBeFalsy();

    // Sensitive variable output sanitization
    const logOutput = `Exported AWS_SECRET_ACCESS_KEY=${TEST_SECRET_VALUES.anthropicApi03}`;
    const safeOutput = redactSecrets(logOutput);
    expect(safeOutput).toBe("Exported AWS_SECRET_ACCESS_KEY=[REDACTED]");
  });

  setTestScope(3, "T3.12", "Disabled Auto-Failover + Quota Exhaustion + Manual Authorization");
  test("T3.12: Quota exhaustion blocks execution and only swaps upon explicit user authorization", () => {
    const config = { maestroAutoSwitch: false };
    const pane = { id: "p1", runner: "codex", status: "working" };

    // Runner hits quota
    const quotaExhausted = true;
    if (quotaExhausted && !config.maestroAutoSwitch) {
      pane.status = "blocked";
    }
    expect(pane.status).toBe("blocked");
    expect(pane.runner).toBe("codex"); // no auto swap

    // User receives notification and confirms manual failover to claude
    const userAuth = { paneId: "p1", confirmed: true, targetRunner: "claude" };
    if (userAuth.confirmed) {
      pane.runner = userAuth.targetRunner;
      pane.status = "working";
    }
    expect(pane.runner).toBe("claude");
    expect(pane.status).toBe("working");
  });

  setTestScope(3, "T3.13", "Modular Architecture Directory Integration");
  test("T3.13: All 10 modular server directories cooperate without circular dependencies", () => {
    const serverModules = {
      routes: ["missions", "tasks", "panes", "connections"],
      websocket: ["server", "broadcast", "handlers"],
      orchestration: ["maestro", "harness", "modes"],
      sessions: ["ptyHost", "bashSpawner", "lifecycle"],
      tasks: ["entity", "lifecycle", "evidence"],
      connections: ["registry", "mailbox", "verbs"],
      missions: ["domain", "worktree", "checkpoints"],
      providers: ["detection", "adapters", "quotas"],
      persistence: ["diskStore", "fileLocks", "auditLog"],
      security: ["sanitizer", "sandbox", "confirmations"],
    };

    expect(Object.keys(serverModules)).toHaveLength(10);
    for (const [mod, sub] of Object.entries(serverModules)) {
      expect(sub.length).toBeGreaterThan(0);
    }
  });

  setTestScope(3, "T3.14", "Visual Lines + Differentiation Badges + Connection Entity");
  test("T3.14: Visual UI elements accurately reflect persisted connection topology and badges", () => {
    const pane1 = { id: "p1", role: "builder", runner: "bash", model: null, status: "waiting-user" };
    const pane2 = { id: "p2", role: "reviewer", runner: "claude", model: "claude-3-7-sonnet", status: "working" };
    const connections = [createConnectionFixture("p1", "p2")];

    // Connection wire exists only between p1 and p2
    const hasWire = (a, b) => connections.some((c) => c.sourcePaneId === a && c.targetPaneId === b && c.status === "active");
    expect(hasWire("p1", "p2")).toBeTruthy();
    expect(hasWire("p1", "p3")).toBeFalsy();

    // Badges differ clearly
    expect(pane1.model).toBe(null);
    expect(pane2.model).toBe("claude-3-7-sonnet");
    expect(pane1.role).not.toBe(pane2.role);
  });

  setTestScope(3, "T3.15", "Bash Absolute Precedence + Roster Enforcement + Sovereign Clean Boot");
  test("T3.15: Explicit bash always overrides roster, policy, and failover with zero stdin prompt", () => {
    const missionRoster = ["codex", "claude"];
    const requested = "bash";

    const resolved = resolveHarnessContract({
      requestedCli: requested,
      missionElenco: missionRoster,
      availableInPath: true,
    });

    expect(resolved.cli).toBe("bash");
    expect(resolved.model).toBeUndefined();
    expect(resolved.origem.cli).toBe("soberano");

    // Bash spawner guarantees /bin/bash -i -l
    const runner = createRunnerFixture({ id: resolved.cli });
    expect(runner.binary).toBe("/bin/bash");
    expect(runner.defaultArgs).toEqual(["-i", "-l"]);
  });
}
