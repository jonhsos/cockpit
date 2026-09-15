import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskStore } from "../servidor/persistence/disk-store.ts";
import { MissionStore } from "../servidor/persistence/mission-store.ts";
import {
  normalizeMissionMode,
  canMaestroAutoSpawn,
  canMaestroDelegate,
  MissionModeManager,
} from "../servidor/orchestration/mission-modes.ts";

console.log("Starting check-mission-modes.ts verification...");

const tempDir = mkdtempSync(join(tmpdir(), "check-modes-"));

try {
  const disk = new DiskStore(tempDir);
  const missionStore = new MissionStore(disk);
  const modeManager = new MissionModeManager(missionStore);

  // -------------------------------------------------------------
  // Test 1: Modo Livre (Default) & Normalization
  // -------------------------------------------------------------
  console.log("Test 1: Modo Livre (Default) & Normalization...");
  assert.equal(normalizeMissionMode("livre"), "livre");
  assert.equal(normalizeMissionMode("DIRIGIDO"), "dirigido");
  assert.equal(normalizeMissionMode("autônomo"), "autonomo");
  assert.equal(normalizeMissionMode("autonomo"), "autonomo");
  assert.equal(normalizeMissionMode("invalid-mode"), "livre");
  assert.equal(normalizeMissionMode(undefined), "livre");
  assert.equal(normalizeMissionMode(null), "livre");

  // In Modo Livre, autonomous auto-spawn is strictly rejected
  const spawnInLivre = canMaestroAutoSpawn({
    mode: "livre",
    currentPanes: 0,
  });
  assert.equal(spawnInLivre.allowed, false);
  assert.match(spawnInLivre.reason!, /Livre/);

  // In Modo Livre, autonomous delegation is strictly rejected
  const delegateInLivre = canMaestroDelegate({
    mode: "livre",
    targetAgentOrRole: "builder",
  });
  assert.equal(delegateInLivre.allowed, false);
  assert.match(delegateInLivre.reason!, /Livre/);

  // -------------------------------------------------------------
  // Test 2: Mode Transitions & Persistence
  // -------------------------------------------------------------
  console.log("Test 2: Mode Transitions & Persistence...");
  // Create mission in store
  const mission = missionStore.addMission({
    projectId: "proj-1",
    nome: "mission-test-modes",
    objetivo: "Test mission modes",
    worktree: "/tmp/project",
    branch: null,
    isolada: false,
    modo: "livre",
  });

  assert.equal(modeManager.getMissionMode(mission.id).modo, "livre");

  // Transition to dirigido
  modeManager.setMissionMode(mission.id, "dirigido");
  assert.equal(modeManager.getMissionMode(mission.id).modo, "dirigido");

  // Transition to autonomo
  modeManager.setMissionMode(mission.id, "autonomo");
  assert.equal(modeManager.getMissionMode(mission.id).modo, "autonomo");

  // Verify reloaded from disk store
  const freshManager = new MissionModeManager(missionStore);
  assert.equal(freshManager.getMissionMode(mission.id).modo, "autonomo");

  // -------------------------------------------------------------
  // Test 3: Modo Dirigido (Whitelist Delegation)
  // -------------------------------------------------------------
  console.log("Test 3: Modo Dirigido...");
  const authorized = ["builder", "reviewer"];

  // Delegating to authorized agent is allowed
  const delegateAllowed = canMaestroDelegate({
    mode: "dirigido",
    targetAgentOrRole: "builder",
    authorizedRoles: authorized,
  });
  assert.equal(delegateAllowed.allowed, true);

  // Delegating to unauthorized agent is rejected
  const delegateDenied = canMaestroDelegate({
    mode: "dirigido",
    targetAgentOrRole: "hacker",
    authorizedRoles: authorized,
  });
  assert.equal(delegateDenied.allowed, false);
  assert.match(delegateDenied.reason!, /não autorizado/);

  // Arbitrary autonomous spawn in dirigido is rejected
  const spawnInDirigido = canMaestroAutoSpawn({
    mode: "dirigido",
    currentPanes: 1,
  });
  assert.equal(spawnInDirigido.allowed, false);
  assert.match(spawnInDirigido.reason!, /Dirigido/);

  // -------------------------------------------------------------
  // Test 4: Modo Autônomo & Concurrency Cap (max 4 panes)
  // -------------------------------------------------------------
  console.log("Test 4: Modo Autônomo & Concurrency Cap...");
  // Delegating in autonomo is allowed
  const delegateAutonomo = canMaestroDelegate({
    mode: "autonomo",
    targetAgentOrRole: "scout",
  });
  assert.equal(delegateAutonomo.allowed, true);

  // Spawning under cap (0, 1, 2, 3 panes) is allowed
  for (let p = 0; p < 4; p++) {
    const res = canMaestroAutoSpawn({
      mode: "autonomo",
      currentPanes: p,
      maxPanes: 4,
    });
    assert.equal(res.allowed, true, `Spawning at pane ${p} should be allowed`);
  }

  // Spawning at or above cap (4 panes) is rejected
  const capReached = canMaestroAutoSpawn({
    mode: "autonomo",
    currentPanes: 4,
    maxPanes: 4,
  });
  assert.equal(capReached.allowed, false);
  assert.match(capReached.reason!, /concorrência/);

  // Custom maxPanes cap
  const customCap = canMaestroAutoSpawn({
    mode: "autonomo",
    currentPanes: 2,
    maxPanes: 2,
  });
  assert.equal(customCap.allowed, false);
  assert.match(customCap.reason!, /concorrência/);

  // -------------------------------------------------------------
  // Test 5: Emergency Stop
  // -------------------------------------------------------------
  console.log("Test 5: Emergency Stop...");
  modeManager.emergencyStop(mission.id);
  assert.equal(modeManager.isHalted(mission.id), true);
  assert.equal(modeManager.getMissionMode(mission.id).emergencyHalt, true);

  // When halted, all spawns and delegations are blocked immediately
  const haltedSpawn = canMaestroAutoSpawn({
    mode: "autonomo",
    currentPanes: 0,
    emergencyHalt: true,
  });
  assert.equal(haltedSpawn.allowed, false);
  assert.match(haltedSpawn.reason!, /emergência/);

  const haltedDelegate = canMaestroDelegate({
    mode: "autonomo",
    targetAgentOrRole: "builder",
    emergencyHalt: true,
  });
  assert.equal(haltedDelegate.allowed, false);
  assert.match(haltedDelegate.reason!, /emergência/);

  // Resuming mission re-allows autonomous operations
  modeManager.resumeMission(mission.id);
  assert.equal(modeManager.isHalted(mission.id), false);
  assert.equal(modeManager.getMissionMode(mission.id).emergencyHalt, false);

  const resumedSpawn = canMaestroAutoSpawn({
    mode: "autonomo",
    currentPanes: 0,
    emergencyHalt: false,
  });
  assert.equal(resumedSpawn.allowed, true);

  console.log("PASS: check-mission-modes.ts — all modes (livre, dirigido, autonomo), caps, and emergency stop verified!");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
