import { existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import type { DiskStore } from "./disk-store.ts";
import type { MissionRecord, FileOwnershipMode, MissionMode } from "./types.ts";

export function runMigrationIfNeeded(disk: DiskStore): boolean {
  const baseDir = disk.getBaseDir();
  const stateFile = join(baseDir, "state.json");
  if (!existsSync(stateFile)) return false;

  const raw = disk.readJson<any>(stateFile, null);
  if (!raw) return false;

  // If already at schemaVersion >= 2, no migration needed
  if (raw.schemaVersion && raw.schemaVersion >= 2) {
    return false;
  }

  console.log("[Migration] Legacy state.json detected. Backing up and migrating to schema v2...");

  // Create backup
  const backupFile = join(baseDir, `state.json.bak.v1.${Date.now()}`);
  copyFileSync(stateFile, backupFile);

  const projects = raw.projects ?? [];
  const missions = raw.missions ?? [];

  // Migrate each mission to its own directory structure
  for (const m of missions) {
    const missionDir = join(baseDir, "missions", m.id);
    const missionRecord: MissionRecord = {
      id: m.id,
      projectId: m.projectId,
      nome: m.nome,
      customName: m.customName ?? m.nome,
      objetivo: m.objetivo ?? "",
      worktree: m.worktree ?? "",
      branch: m.branch ?? null,
      isolada: Boolean(m.isolada),
      panes: Array.isArray(m.panes) ? m.panes : [],
      modo: (m.modo as MissionMode) ?? "livre",
      ownershipMode: (m.ownershipMode as FileOwnershipMode) ?? "shared",
      skills: m.skills,
      receita: m.receita,
      elenco: m.elenco,
      criadaEm: m.criadaEm ?? Date.now(),
      atualizadaEm: Date.now(),
    };

    disk.writeJsonAtomic(join(missionDir, "mission.json"), missionRecord);

    // Initialize tasks.json if missing
    const tasksFile = join(missionDir, "tasks.json");
    if (!existsSync(tasksFile)) {
      disk.writeJsonAtomic(tasksFile, []);
    }

    // Initialize connections.json if missing
    const connFile = join(missionDir, "connections.json");
    if (!existsSync(connFile)) {
      disk.writeJsonAtomic(connFile, []);
    }

    // Initialize ownership.json if missing
    const ownerFile = join(missionDir, "ownership.json");
    if (!existsSync(ownerFile)) {
      disk.writeJsonAtomic(ownerFile, {
        missionId: m.id,
        mode: missionRecord.ownershipMode,
        locks: {},
        collisionWarnings: [],
      });
    }

    // Initialize layout.json if missing
    const layoutFile = join(missionDir, "layout.json");
    if (!existsSync(layoutFile)) {
      disk.writeJsonAtomic(layoutFile, {
        missionId: m.id,
        colunas: "auto",
        paneOrder: missionRecord.panes,
        selectedPaneId: missionRecord.panes[0] ?? null,
        sidebarTab: "missoes",
        taskBoardCollapsed: false,
        atualizadoEm: Date.now(),
      });
    }
  }

  // Update root state.json with schemaVersion: 2
  disk.writeJsonAtomic(stateFile, {
    schemaVersion: 2,
    migratedAt: Date.now(),
    projects,
    missions: missions.map((m: any) => ({
      id: m.id,
      projectId: m.projectId,
      nome: m.nome,
      customName: m.customName ?? m.nome,
      objetivo: m.objetivo ?? "",
      worktree: m.worktree ?? "",
      branch: m.branch ?? null,
      isolada: Boolean(m.isolada),
      panes: Array.isArray(m.panes) ? m.panes : [],
      modo: (m.modo as MissionMode) ?? "livre",
      ownershipMode: (m.ownershipMode as FileOwnershipMode) ?? "shared",
      skills: m.skills,
      receita: m.receita,
      elenco: m.elenco,
      criadaEm: m.criadaEm ?? Date.now(),
      atualizadaEm: Date.now(),
    })),
  });

  console.log(`[Migration] Migrated ${missions.length} missions to schema v2.`);
  return true;
}
