import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DiskStore,
  MissionStore,
  PaneStore,
  TaskStore,
  ConnectionStore,
  OwnershipStore,
  HandoffStore,
  LayoutStore,
  HistoryStore,
  runMigrationIfNeeded,
  recoverOnBoot,
} from "../servidor/persistence/index.ts";

console.log("Running check-persistence.ts...");

const testHome = mkdtempSync(join(tmpdir(), "cockpit-test-persistence-"));

try {
  const disk = new DiskStore(testHome);

  // 1. Test Atomic Writes & Directory Management
  const testFile = join(testHome, "sub", "test-atomic.json");
  disk.writeJsonAtomic(testFile, { message: "atomic_ok", counter: 42 });

  const readBack = disk.readJson<{ message: string; counter: number }>(testFile, { message: "", counter: 0 });
  assert.equal(readBack.message, "atomic_ok");
  assert.equal(readBack.counter, 42);

  // Verify no temp files left in directory
  const filesInSub = readdirSync(join(testHome, "sub"));
  assert.equal(filesInSub.filter((f) => f.includes(".tmp.")).length, 0);
  console.log("  ✓ 1. Atomic writes and tmp file cleanup validated");

  // 2. Test Mission Store & Pane Preservation (Anti-Destructive Reload)
  const missionStore = new MissionStore(disk);
  const project = missionStore.addProject(testHome);
  assert.ok(project.id);

  const mission = missionStore.addMission({
    projectId: project.id,
    nome: "Missão Alfa",
    objetivo: "Construir persistência",
    worktree: testHome,
    branch: "main",
    isolada: true,
    modo: "dirigido",
    ownershipMode: "isolated",
    panes: ["pane-101", "pane-102"],
  });

  assert.ok(mission.id);
  assert.equal(mission.nome, "Missão Alfa");
  assert.deepEqual(mission.panes, ["pane-101", "pane-102"]);

  // Re-instantiate MissionStore to simulate server restart
  const missionStoreReloaded = new MissionStore(disk);
  const reloadedMission = missionStoreReloaded.getMission(mission.id);
  assert.ok(reloadedMission, "Mission must exist after restart");
  assert.deepEqual(
    reloadedMission.panes,
    ["pane-101", "pane-102"],
    "Panes MUST NOT be wiped on restart (reversing legacy destructive bug)"
  );
  console.log("  ✓ 2. MissionStore & Pane preservation on reload validated");

  // 3. Test Pane Store Persistence
  const paneStore = new PaneStore(disk);
  paneStore.savePane({
    paneId: "pane-101",
    missionId: mission.id,
    projectId: project.id,
    label: "Terminal Principal",
    role: "builder",
    runner: "bash",
    model: null,
    effort: null,
    cwd: testHome,
    maestro: false,
    status: "working",
    iniciadoEm: Date.now(),
    atualizadoEm: Date.now(),
  });

  const paneReloaded = new PaneStore(disk).getPane("pane-101");
  assert.ok(paneReloaded);
  assert.equal(paneReloaded.role, "builder");
  assert.equal(paneReloaded.runner, "bash");
  assert.equal(paneReloaded.status, "working");
  console.log("  ✓ 3. PaneStore persistence validated");

  // 4. Test Task Store Persistence
  const taskStore = new TaskStore(disk);
  const now = Date.now();
  taskStore.saveTask({
    id: "task-persisted-1",
    missionId: mission.id,
    título: "Salvar no disco",
    descrição: "Garantir crash-safety",
    responsável: "agent-1",
    papel: "builder",
    pane: "pane-101",
    "arquivos permitidos": ["storage.ts"],
    dependências: [],
    prioridade: "urgente",
    status: "in-progress",
    evidências: [],
    resultado: null,
    timestamps: {
      criadaEm: now,
      iniciadaEm: now,
      atualizadaEm: now,
    },
  });

  const taskReloaded = new TaskStore(disk).getTask("task-persisted-1", mission.id);
  assert.ok(taskReloaded);
  assert.equal(taskReloaded.título, "Salvar no disco");
  assert.equal(taskReloaded.status, "in-progress");
  assert.deepEqual(taskReloaded["arquivos permitidos"], ["storage.ts"]);
  console.log("  ✓ 4. TaskStore 13-field entity persistence validated");

  // 5. Test Connection Store
  const connectionStore = new ConnectionStore(disk);
  connectionStore.saveConnection({
    id: "conn-1",
    missionId: mission.id,
    sourcePaneId: "pane-101",
    targetPaneId: "pane-102",
    criadaEm: Date.now(),
    status: "active",
  });

  const connReloaded = new ConnectionStore(disk).getConnection("conn-1", mission.id);
  assert.ok(connReloaded);
  assert.equal(connReloaded.sourcePaneId, "pane-101");
  assert.equal(connReloaded.targetPaneId, "pane-102");
  console.log("  ✓ 5. ConnectionStore persistence validated");

  // 6. Test Ownership Store
  const ownershipStore = new OwnershipStore(disk);
  ownershipStore.saveLock({
    id: "lock-1",
    file: "src/core.ts",
    filePath: "src/core.ts",
    missionId: mission.id,
    taskId: "task-persisted-1",
    paneId: "pane-101",
    owner: "builder",
    mode: "isolated",
    acquiredAt: Date.now(),
  });

  const ownershipReloaded = new OwnershipStore(disk).getOwnershipState(mission.id);
  assert.ok(ownershipReloaded.locks["src/core.ts"]);
  assert.equal(ownershipReloaded.locks["src/core.ts"].taskId, "task-persisted-1");
  console.log("  ✓ 6. OwnershipStore lock persistence validated");

  // 7. Test Handoff Store
  const handoffStore = new HandoffStore(disk);
  handoffStore.saveHandoff({
    id: "hoff-1",
    missionId: mission.id,
    sourcePaneId: "pane-101",
    targetPaneId: "pane-102",
    taskId: "task-persisted-1",
    context: "Finalizei a camada de persistência. Iniciar revisão.",
    dependencies: [],
    evidenceIds: [],
    timestamp: Date.now(),
    status: "pending",
  });

  const handoffReloaded = new HandoffStore(disk).getHandoff("hoff-1", mission.id);
  assert.ok(handoffReloaded);
  assert.equal(handoffReloaded.taskId, "task-persisted-1");
  assert.equal(handoffReloaded.status, "pending");
  console.log("  ✓ 7. HandoffStore persistence validated");

  // 8. Test Layout Store
  const layoutStore = new LayoutStore(disk);
  layoutStore.saveLayout({
    missionId: mission.id,
    colunas: "2",
    paneOrder: ["pane-101", "pane-102"],
    selectedPaneId: "pane-101",
    sidebarTab: "tarefas",
    taskBoardCollapsed: false,
    atualizadoEm: Date.now(),
  });

  const layoutReloaded = new LayoutStore(disk).getLayout(mission.id);
  assert.equal(layoutReloaded.colunas, "2");
  assert.equal(layoutReloaded.sidebarTab, "tarefas");
  console.log("  ✓ 8. LayoutStore persistence validated");

  // 9. Test History & Memory Store
  const historyStore = new HistoryStore(disk);
  historyStore.appendAudit({
    actor: "system",
    action: "test:action",
    missionId: mission.id,
    details: { foo: "bar" },
  });

  const audits = historyStore.queryAudit({ missionId: mission.id });
  assert.ok(audits.length >= 1);
  assert.equal(audits[audits.length - 1].action, "test:action");

  historyStore.addMemoryNote(project.id, "scout", "Descoberta arquitetural importante");
  const notes = historyStore.readMemory(project.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].texto, "Descoberta arquitetural importante");
  console.log("  ✓ 9. HistoryStore & Memory notes validated");

  // 10. Test Schema Migration (v1 -> v2)
  const migrationDir = mkdtempSync(join(tmpdir(), "cockpit-test-migration-"));
  const legacyStateFile = join(migrationDir, "state.json");
  writeFileSync(
    legacyStateFile,
    JSON.stringify({
      projects: [{ id: "p-legacy", nome: "leg-proj", root: migrationDir, git: false, abertoEm: 100 }],
      missions: [
        {
          id: "m-legacy",
          projectId: "p-legacy",
          nome: "Legacy Mission",
          objetivo: "Migrate me",
          worktree: migrationDir,
          branch: null,
          isolada: false,
          panes: ["p-1"],
          criadaEm: 200,
        },
      ],
    })
  );

  const migrationDisk = new DiskStore(migrationDir);
  const migrated = runMigrationIfNeeded(migrationDisk);
  assert.equal(migrated, true, "Migration must run for legacy schema");

  // Check backup file exists
  const filesInMigrated = readdirSync(migrationDir);
  const backupFound = filesInMigrated.some((f) => f.startsWith("state.json.bak.v1."));
  assert.ok(backupFound, "Backup file state.json.bak.v1.* must be created");

  // Check state.json upgraded to schemaVersion: 2
  const upgradedState = migrationDisk.readJson<any>(legacyStateFile, {});
  assert.equal(upgradedState.schemaVersion, 2);

  // Check mission directory created
  const migratedMissionFile = join(migrationDir, "missions", "m-legacy", "mission.json");
  assert.ok(existsSync(migratedMissionFile), "Mission directory and mission.json must exist");
  const migratedMission = migrationDisk.readJson<any>(migratedMissionFile, {});
  assert.equal(migratedMission.nome, "Legacy Mission");
  assert.deepEqual(migratedMission.panes, ["p-1"]);

  // Running again should be no-op
  const secondRun = runMigrationIfNeeded(migrationDisk);
  assert.equal(secondRun, false, "Second migration run must be no-op");
  console.log("  ✓ 10. Schema v1 to v2 migration engine validated");

  // 11. Test Boot Recovery Hooks & Orphan Cleanup
  const recoveryDir = mkdtempSync(join(tmpdir(), "cockpit-test-recovery-"));
  const recoveryDisk = new DiskStore(recoveryDir);

  // Plant a stale tmp file older than 5 minutes
  const staleTmp = join(recoveryDir, ".stale.tmp.999.123");
  writeFileSync(staleTmp, "abandoned");
  // Set mtime to 10 minutes ago
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const { utimesSync } = await import("node:fs");
  utimesSync(staleTmp, tenMinutesAgo, tenMinutesAgo);

  const report = recoverOnBoot(recoveryDisk);
  assert.equal(report.orphansCleaned, true);
  assert.equal(existsSync(staleTmp), false, "Stale tmp file must be cleaned up on boot recovery");
  console.log("  ✓ 11. Boot recovery hooks and orphan cleanup validated");

  console.log("\nPASS: all persistence checks passed.");
} finally {
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}
