import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { DiskStore } from "./disk-store.ts";
import type {
  MissionRecord,
  ProjectRecord,
  MissionMode,
  FileOwnershipMode,
} from "./types.ts";

export interface RootStateSchema {
  schemaVersion?: number;
  projects: ProjectRecord[];
  missions: MissionRecord[];
  migratedAt?: number;
}

export class MissionStore {
  private disk: DiskStore;
  private stateFile: string;
  private cachedProjects: ProjectRecord[] = [];
  private cachedMissions: MissionRecord[] = [];

  constructor(disk: DiskStore) {
    this.disk = disk;
    this.stateFile = join(disk.getBaseDir(), "state.json");
    this.load();
  }

  public load(): void {
    const raw = this.disk.readJson<RootStateSchema>(this.stateFile, {
      schemaVersion: 2,
      projects: [],
      missions: [],
    });

    this.cachedProjects = raw.projects ?? [];

    // Load missions from per-mission dirs if present, or fallback to root state
    const missionsMap = new Map<string, MissionRecord>();

    // First load from root state
    for (const m of raw.missions ?? []) {
      missionsMap.set(m.id, m);
    }

    // Then check if per-mission files exist and have more updated records
    const missionsBaseDir = join(this.disk.getBaseDir(), "missions");
    for (const m of missionsMap.values()) {
      const perMissionFile = join(missionsBaseDir, m.id, "mission.json");
      if (existsSync(perMissionFile)) {
        const diskM = this.disk.readJson<MissionRecord | null>(perMissionFile, null);
        if (diskM && diskM.id === m.id) {
          missionsMap.set(m.id, { ...m, ...diskM });
        }
      }
    }

    this.cachedMissions = Array.from(missionsMap.values());
  }

  public persist(): void {
    const payload: RootStateSchema = {
      schemaVersion: 2,
      projects: this.cachedProjects,
      missions: this.cachedMissions,
    };
    this.disk.writeJsonAtomic(this.stateFile, payload);

    // Also persist individual mission.json files
    const missionsBaseDir = join(this.disk.getBaseDir(), "missions");
    for (const m of this.cachedMissions) {
      const perMissionFile = join(missionsBaseDir, m.id, "mission.json");
      this.disk.writeJsonAtomic(perMissionFile, m);
    }
  }

  public listProjects(): ProjectRecord[] {
    return [...this.cachedProjects];
  }

  public getProject(projectId: string): ProjectRecord | undefined {
    return this.cachedProjects.find((p) => p.id === projectId);
  }

  public addProject(caminho: string): ProjectRecord {
    const root = resolve(caminho);
    if (!existsSync(root)) throw new Error(`pasta não encontrada: ${root}`);
    if (!statSync(root).isDirectory()) throw new Error(`${root} não é uma pasta`);

    const existente = this.cachedProjects.find((p) => p.root === root);
    if (existente) return existente;

    const project: ProjectRecord = {
      id: "proj" + createHash("sha1").update(root.toLowerCase()).digest("hex").slice(0, 12),
      nome: basename(root),
      root,
      git: existsSync(join(root, ".git")),
      abertoEm: Date.now(),
    };

    this.cachedProjects.push(project);
    this.persist();
    return project;
  }

  public closeProject(projectId: string): MissionRecord[] {
    const guardadas = this.cachedMissions.filter((m) => m.projectId === projectId);
    this.cachedProjects = this.cachedProjects.filter((p) => p.id !== projectId);
    this.persist();
    return guardadas;
  }

  public marcarGit(projectId: string, temGit: boolean): void {
    const project = this.getProject(projectId);
    if (!project) return;
    project.git = temGit;
    this.persist();
  }

  public listMissions(projectId?: string): MissionRecord[] {
    return projectId
      ? this.cachedMissions.filter((m) => m.projectId === projectId)
      : [...this.cachedMissions];
  }

  public getMission(missionId: string): MissionRecord | undefined {
    return this.cachedMissions.find((m) => m.id === missionId);
  }

  public saveMission(mission: MissionRecord): void {
    const idx = this.cachedMissions.findIndex((m) => m.id === mission.id);
    mission.atualizadaEm = Date.now();
    if (idx >= 0) {
      this.cachedMissions[idx] = mission;
    } else {
      this.cachedMissions.push(mission);
    }
    this.persist();
  }

  public addMission(
    m: Omit<MissionRecord, "id" | "criadaEm" | "atualizadaEm"> & { id?: string; panes?: string[] }
  ): MissionRecord {
    const now = Date.now();
    const missionId = m.id ?? `m${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const mission: MissionRecord = {
      ...m,
      id: missionId,
      panes: m.panes ? [...m.panes] : [],
      modo: (m.modo as MissionMode) ?? "livre",
      ownershipMode: (m.ownershipMode as FileOwnershipMode) ?? "shared",
      criadaEm: now,
      atualizadaEm: now,
    };
    this.cachedMissions.push(mission);
    this.persist();
    return mission;
  }

  public removeMission(missionId: string): void {
    this.cachedMissions = this.cachedMissions.filter((m) => m.id !== missionId);
    this.persist();
  }

  public renameMission(missionId: string, newName: string): MissionRecord | undefined {
    const mission = this.getMission(missionId);
    if (!mission) return undefined;
    mission.nome = newName;
    mission.customName = newName;
    mission.atualizadaEm = Date.now();
    this.persist();
    return mission;
  }

  public attachPane(missionId: string, paneId: string): void {
    const mission = this.getMission(missionId);
    if (!mission || mission.panes.includes(paneId)) return;
    mission.panes.push(paneId);
    this.persist();
  }

  public detachPane(paneId: string): void {
    let changed = false;
    for (const mission of this.cachedMissions) {
      const i = mission.panes.indexOf(paneId);
      if (i !== -1) {
        mission.panes.splice(i, 1);
        changed = true;
      }
    }
    if (changed) {
      this.persist();
    }
  }
}
