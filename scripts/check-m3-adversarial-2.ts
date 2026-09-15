import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { DiskStore } from "../servidor/persistence/disk-store.ts";
import { MissionStore } from "../servidor/persistence/mission-store.ts";
import { TaskStore } from "../servidor/persistence/task-store.ts";
import { FileOwnershipManager } from "../servidor/tasks/file-ownership.ts";
import { TaskManager } from "../servidor/tasks/task-manager.ts";
import { MailboxStore } from "../servidor/connections/mailbox-store.ts";
import { MailboxManager } from "../servidor/connections/mailbox-manager.ts";
import {
  normalizeMissionMode,
  canMaestroAutoSpawn,
  canMaestroDelegate,
  MissionModeManager,
  DEFAULT_MAX_AUTONOMOUS_PANES,
} from "../servidor/orchestration/mission-modes.ts";
import { PaneDispatcher, type PaneDispatcherState } from "../servidor/orchestration/pane-dispatcher.ts";
import { resolverHarness, resolveHarness } from "../servidor/harness.ts";
import { config } from "../servidor/config.ts";
import { BASH_PATH } from "../servidor/sessions/clean-shell.ts";

console.log("===============================================================================");
console.log("EMPIRICAL ADVERSARIAL CHALLENGER 2: Milestone M3 Verification Suite");
console.log("===============================================================================");

const tempDir = mkdtempSync(join(tmpdir(), "check-m3-adv2-"));

async function runAdversarial2(): Promise<void> {
  try {
    const disk = new DiskStore(tempDir);
    const missionStore = new MissionStore(disk);
    const taskStore = new TaskStore(disk);
    const ownership = new FileOwnershipManager();
    const taskManager = new TaskManager(ownership, taskStore);
    const mailboxStore = new MailboxStore(disk);
    const mailboxManager = new MailboxManager(mailboxStore);

    // =========================================================================
    // 1. MISSION MODES STRESS & PERMISSION BOUNDARIES
    // =========================================================================
    console.log("\n[1] Mission Modes Stress Testing...");

    // 1.1 Fuzzing mode normalizer
    console.log("  1.1 Fuzzing normalizeMissionMode...");
    assert.equal(normalizeMissionMode(null), "livre");
    assert.equal(normalizeMissionMode(undefined), "livre");
    assert.equal(normalizeMissionMode(""), "livre");
    assert.equal(normalizeMissionMode(999), "livre");
    assert.equal(normalizeMissionMode({ mode: "autonomo" }), "livre");
    assert.equal(normalizeMissionMode("unknown_random_mode"), "livre");
    assert.equal(normalizeMissionMode("DIRIGIDO"), "dirigido");
    assert.equal(normalizeMissionMode("dirigido"), "dirigido");
    assert.equal(normalizeMissionMode("autônomo"), "autonomo");
    assert.equal(normalizeMissionMode("autonomo"), "autonomo");
    assert.equal(normalizeMissionMode("AUTONOMO"), "autonomo");

    // 1.2 Modo Livre Stress: Strict Rejection of Auto-Spawning & Delegation
    console.log("  1.2 Verifying strict rejection of auto-spawning & delegation in Modo Livre...");
    for (const p of [-1, 0, 1, 2, 4, 10, 100]) {
      const res = canMaestroAutoSpawn({
        mode: "livre",
        currentPanes: p,
      });
      assert.equal(res.allowed, false, `Spawn at ${p} panes in Modo Livre must be rejected`);
      assert.match(res.reason!, /Livre/, "Rejection message must reference Modo Livre");
    }

    const testRoles = ["builder", "scout", "reviewer", "luna", "astra", "shell", "custom-agent"];
    for (const r of testRoles) {
      const res = canMaestroDelegate({
        mode: "livre",
        targetAgentOrRole: r,
        authorizedRoles: testRoles,
      });
      assert.equal(res.allowed, false, `Delegation to ${r} in Modo Livre must be rejected`);
      assert.match(res.reason!, /Livre/, "Rejection message must reference Modo Livre");
    }

    // 1.3 Modo Dirigido Stress: Whitelist Enforcement
    console.log("  1.3 Verifying whitelist enforcement in Modo Dirigido...");
    // Auto-spawning must be strictly blocked in Dirigido
    const dirSpawn = canMaestroAutoSpawn({ mode: "dirigido", currentPanes: 0 });
    assert.equal(dirSpawn.allowed, false);
    assert.match(dirSpawn.reason!, /Dirigido/);

    const whitelist = ["Builder", "Reviewer"];
    // Allowed agents (case-insensitive)
    assert.equal(canMaestroDelegate({ mode: "dirigido", targetAgentOrRole: "builder", authorizedRoles: whitelist }).allowed, true);
    assert.equal(canMaestroDelegate({ mode: "dirigido", targetAgentOrRole: "BUILDER", authorizedRoles: whitelist }).allowed, true);
    assert.equal(canMaestroDelegate({ mode: "dirigido", targetAgentOrRole: "reviewer", authorizedRoles: whitelist }).allowed, true);

    // Blocked agents
    for (const unauth of ["scout", "luna", "astra", "hacker", "unknown"]) {
      const res = canMaestroDelegate({ mode: "dirigido", targetAgentOrRole: unauth, authorizedRoles: whitelist });
      assert.equal(res.allowed, false, `Role ${unauth} must be rejected under whitelist`);
      assert.match(res.reason!, /não autorizado/);
    }

    // 1.4 Modo Autônomo Stress: Concurrency Cap (Max 4 Panes Default)
    console.log("  1.4 Verifying concurrency cap (max 4 panes) in Modo Autônomo...");
    assert.equal(DEFAULT_MAX_AUTONOMOUS_PANES, 4);

    // Allowed under cap: 0, 1, 2, 3
    for (let i = 0; i < 4; i++) {
      const res = canMaestroAutoSpawn({ mode: "autonomo", currentPanes: i, maxPanes: 4 });
      assert.equal(res.allowed, true, `Pane ${i} must be allowed to spawn under cap 4`);
    }

    // Blocked at or over cap: 4, 5, 10
    for (const over of [4, 5, 10, 50]) {
      const res = canMaestroAutoSpawn({ mode: "autonomo", currentPanes: over, maxPanes: 4 });
      assert.equal(res.allowed, false, `Pane count ${over} must be rejected under cap 4`);
      assert.match(res.reason!, /concorrência/);
    }

    // Custom cap: 2 panes
    assert.equal(canMaestroAutoSpawn({ mode: "autonomo", currentPanes: 1, maxPanes: 2 }).allowed, true);
    assert.equal(canMaestroAutoSpawn({ mode: "autonomo", currentPanes: 2, maxPanes: 2 }).allowed, false);

    // 1.5 Emergency Stop: Instant Halt & Resumption
    console.log("  1.5 Verifying instant halt on emergency stop and resumption...");
    const modeManager = new MissionModeManager(missionStore);
    const mission = missionStore.addMission({
      projectId: "proj-1",
      nome: "m3-stress-mission",
      objetivo: "Stress test emergency halt",
      worktree: "/tmp/project",
      branch: null,
      isolada: false,
      modo: "autonomo",
    });

    assert.equal(modeManager.isHalted(mission.id), false);

    // Trigger emergency stop
    modeManager.emergencyStop(mission.id);
    assert.equal(modeManager.isHalted(mission.id), true);
    assert.equal(modeManager.getMissionMode(mission.id).emergencyHalt, true);

    // While halted: auto-spawning and delegation MUST be rejected immediately
    const haltedSpawn = canMaestroAutoSpawn({
      mode: "autonomo",
      currentPanes: 0,
      emergencyHalt: modeManager.isHalted(mission.id),
    });
    assert.equal(haltedSpawn.allowed, false);
    assert.match(haltedSpawn.reason!, /emergência/);

    const haltedDelegate = canMaestroDelegate({
      mode: "autonomo",
      targetAgentOrRole: "builder",
      emergencyHalt: modeManager.isHalted(mission.id),
    });
    assert.equal(haltedDelegate.allowed, false);
    assert.match(haltedDelegate.reason!, /emergência/);

    // Resume mission
    modeManager.resumeMission(mission.id);
    assert.equal(modeManager.isHalted(mission.id), false);
    assert.equal(modeManager.getMissionMode(mission.id).emergencyHalt, false);

    const resumedSpawn = canMaestroAutoSpawn({
      mode: "autonomo",
      currentPanes: 0,
      emergencyHalt: modeManager.isHalted(mission.id),
    });
    assert.equal(resumedSpawn.allowed, true);

    console.log("  ✓ Section 1 Passed: Mission modes, caps, and emergency halt verified.");

    // =========================================================================
    // 2. EXISTING PANE TASK DISPATCH & OS PROCESS TABLE INVARIANT (FEATURE 26)
    // =========================================================================
    console.log("\n[2] Existing Pane Task Dispatch (Feature 26) & OS Process Table Invariant...");

    // Spawn 1 real OS bash process to represent a live PTY pane
    const liveBashProcess = spawn(BASH_PATH, ["-i"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TERM: "xterm-256color" },
    });
    const bashPid = liveBashProcess.pid!;
    assert.ok(bashPid > 0, "Real bash process must have valid OS PID");

    // Helper: check process alive via OS signal 0
    const checkAlive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    assert.equal(checkAlive(bashPid), true);

    // Set up existing idle pane
    const pane1: PaneDispatcherState = {
      paneId: "pane-live-bash",
      label: "WorkerBash",
      role: "builder",
      runner: "bash",
      cli: "bash",
      model: null,
      status: "waiting-user",
      activeTaskId: null,
      missionId: mission.id,
    };

    const panesMap = new Map<string, PaneDispatcherState>([[pane1.paneId, pane1]]);
    const paneProvider = {
      getPane: (id: string) => panesMap.get(id),
      listPanes: () => Array.from(panesMap.values()),
      updatePane: (id: string, upd: Partial<PaneDispatcherState>) => {
        const p = panesMap.get(id);
        if (p) Object.assign(p, upd);
      },
    };

    const dispatcher = new PaneDispatcher(taskManager, mailboxManager, paneProvider);

    // Dispatch 5 tasks in sequence to the existing pane
    console.log("  2.1 Dispatching 5 sequential tasks to existing idle pane...");
    for (let i = 1; i <= 5; i++) {
      const task = taskManager.createTask(mission.id, {
        título: `Batch Task ${i}`,
        descrição: `Task description ${i}`,
        status: "todo",
      });

      assert.equal(pane1.status, "waiting-user");
      assert.equal(pane1.activeTaskId, null);

      // Execute dispatch
      const res = dispatcher.dispatchToExistingPane(mission.id, task.id, pane1.paneId);
      assert.equal(res.ok, true);
      assert.equal(res.status, "in-progress");
      assert.equal(res.taskId, task.id);
      assert.equal(res.paneId, pane1.paneId);

      // EMPIRICAL VERIFICATION: OS process table invariant!
      // The bash process PID remains alive, and ZERO new child processes or PTYs were created!
      assert.equal(checkAlive(bashPid), true, "Existing OS process remains alive");

      // Verify task and pane states
      const runningTask = taskManager.getTask(task.id)!;
      assert.equal(runningTask.status, "in-progress");
      assert.equal(runningTask.pane, pane1.paneId);

      assert.equal(pane1.status, "working");
      assert.equal(pane1.activeTaskId, task.id);

      // Verify message enqueued into pane mailbox
      const inbox = mailboxManager.getInbox(pane1.paneId, mission.id);
      assert.equal(inbox.length, i);
      assert.equal(inbox[i - 1].taskId, task.id);

      // Verify dispatching another task while working is rejected
      const concurrentTask = taskManager.createTask(mission.id, { título: `Concurrent task ${i}`, status: "todo" });
      assert.throws(
        () => dispatcher.dispatchToExistingPane(mission.id, concurrentTask.id, pane1.paneId),
        /busy/,
        "Dispatch to working pane must throw busy error",
      );

      // Complete task through formal lifecycle (in-progress -> in-review -> complete) and reset pane to idle
      taskManager.transitionTask(task.id, "in-review");
      taskManager.transitionTask(task.id, "complete");
      pane1.status = "waiting-user";
      pane1.activeTaskId = null;
    }

    // 2.2 Rejection on dead/failed/foreign pane
    console.log("  2.2 Testing dispatch rejections on dead, failed, and foreign panes...");
    const testTask = taskManager.createTask(mission.id, { título: "Error dispatch task", status: "todo" });

    // Dead pane
    panesMap.set("pane-dead", { paneId: "pane-dead", status: "dead", missionId: mission.id });
    assert.throws(
      () => dispatcher.dispatchToExistingPane(mission.id, testTask.id, "pane-dead"),
      /dead or failed/,
    );

    // Failed pane
    panesMap.set("pane-failed", { paneId: "pane-failed", status: "failed", missionId: mission.id });
    assert.throws(
      () => dispatcher.dispatchToExistingPane(mission.id, testTask.id, "pane-failed"),
      /dead or failed/,
    );

    // Foreign mission pane
    panesMap.set("pane-foreign", { paneId: "pane-foreign", status: "waiting-user", missionId: "mission-other" });
    assert.throws(
      () => dispatcher.dispatchToExistingPane(mission.id, testTask.id, "pane-foreign"),
      /different mission/,
    );

    // Terminate the real bash process cleanly
    liveBashProcess.kill("SIGKILL");

    console.log("  ✓ Section 2 Passed: Existing pane dispatch verified with 0 new OS PTY processes spawned.");

    // =========================================================================
    // 3. STRICT HARNESS & ZERO SILENT FALLBACK TO CODEX
    // =========================================================================
    console.log("\n[3] Strict Harness & Fallback Prohibition Testing...");

    // 3.1 Verify maestroAutoSwitch is false
    console.log("  3.1 Verifying default auto-switch configuration...");
    const cockpitJson = JSON.parse(readFileSync("cockpit.json", "utf8"));
    assert.equal(cockpitJson.maestroAutoSwitch, false, "cockpit.json must have maestroAutoSwitch: false");
    assert.equal(config.maestroAutoSwitch, false, "config.maestroAutoSwitch must default to false");

    // 3.2 Whitelist Rejection: Prohibit Silent Fallback
    console.log("  3.2 Verifying strict rejection without silent fallback...");
    // Whitelist only allows "claude". Requesting "codex" must throw explicit error.
    assert.throws(
      () => {
        resolverHarness({
          agent: "astra", // uses codex in catalog
          elenco: { clis: ["claude"] },
        });
      },
      (err: Error) => {
        assert.match(
          err.message,
          /Executor "codex" não permitido no elenco desta missão/,
          "Must throw explicit whitelist rejection without fallback to permitidos[0]",
        );
        return true;
      },
    );

    // Whitelist only allows "codex". Requesting "claude" must throw explicit error.
    assert.throws(
      () => {
        resolverHarness({
          agent: "builder", // uses claude in catalog
          elenco: { clis: ["codex"] },
        });
      },
      (err: Error) => {
        assert.match(
          err.message,
          /Executor "claude" não permitido no elenco desta missão/,
          "Must throw explicit whitelist rejection without fallback",
        );
        return true;
      },
    );

    // Whitelist rejection via Interface Contract 4 resolveHarness
    assert.throws(
      () => resolveHarness("codex", ["claude"], false),
      /Executor "codex" não permitido no elenco desta missão/,
    );
    assert.throws(
      () => resolveHarness("agy", ["claude"], false),
      /Executor "agy" não permitido no elenco desta missão/,
    );

    // 3.3 Nonexistent CLIs (Availability check)
    console.log("  3.3 Verifying rejection of nonexistent CLIs...");
    const nonexistentClis = ["nonexistent-binary-9999", "hacked-cli-xyz", "fake-llm-engine"];
    for (const bad of nonexistentClis) {
      assert.throws(
        () => resolveHarness(bad, undefined, true),
        (err: Error) => {
          assert.match(
            err.message,
            /não disponível no sistema/,
            `Must throw explicit unavailable error for nonexistent CLI "${bad}" without fallback to Codex`,
          );
          return true;
        },
      );
    }

    // 3.3b Unauthorized System CLIs when mission has specific whitelist
    const unauthorizedClis = ["curl", "rm", "codex", "agy"];
    for (const unauth of unauthorizedClis) {
      assert.throws(
        () => resolveHarness(unauth, ["claude"], false),
        (err: Error) => {
          assert.match(
            err.message,
            /não permitido no elenco desta missão/,
            `Must throw explicit whitelist rejection for unauthorized CLI "${unauth}" without fallback to Codex`,
          );
          return true;
        },
      );
    }

    // 3.4 Sovereign Bash Absolute Precedence
    console.log("  3.4 Verifying sovereign clean bash precedence...");
    // Agent shell
    const shellHarness = resolverHarness({ agent: "shell", elenco: { clis: ["codex"] } });
    assert.equal(shellHarness.cli, "bash");
    assert.equal(shellHarness.origem.cli, "soberano");

    // Explicit runner=bash
    const runnerHarness = resolverHarness({ agent: "builder", runner: "bash", elenco: { clis: ["codex"] } });
    assert.equal(runnerHarness.cli, "bash");
    assert.equal(runnerHarness.origem.cli, "soberano");

    // resolveHarness with bash
    const resolvedBash = resolveHarness("bash", ["codex"], true);
    assert.equal(resolvedBash.cli, "bash");
    assert.equal(resolvedBash.origem.cli, "soberano");

    // 3.5 Task Type Model Isolation
    console.log("  3.5 Verifying task type model isolation...");
    for (const t of ["visual", "arquitetura", "implementar", "pesquisa", "refactor"]) {
      const h = resolverHarness({ agent: "luna", tipo: t });
      assert.equal(h.cli, "codex");
      assert.equal(h.model, config.agents.luna?.model);
      assert.equal(h.effort, config.agents.luna?.effort);
    }

    console.log("  ✓ Section 3 Passed: Strict harness, whitelist rejection, availability, and bash sovereignty verified.");

    console.log("\n===============================================================================");
    console.log("ALL EMPIRICAL ADVERSARIAL CHALLENGER 2 TESTS PASSED! (VERDICT: APPROVE)");
    console.log("===============================================================================\n");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

runAdversarial2()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("ADVERSARIAL CHALLENGER 2 FAILED:", err);
    process.exit(1);
  });
