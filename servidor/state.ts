import { homedir } from "node:os";
import { join } from "node:path";
import type { Elenco } from "./config.ts";
import {
  getDefaultDiskStore,
  getDefaultMissionStore,
  getDefaultHistoryStore,
  recoverOnBoot,
} from "./persistence/index.ts";
import type {
  ProjectRecord as Project,
  Nota,
} from "./persistence/types.ts";

export type { Project, Nota };

export type Mission = {
  id: string;
  projectId: string;
  nome: string;
  objetivo: string;
  /** Pasta onde os agentes desta missão trabalham. */
  worktree: string;
  /** Legado: missões novas nunca criam branch automaticamente. */
  branch: string | null;
  /** Legado: true apenas para worktrees antigos ainda não migrados. */
  isolada: boolean;
  panes: string[];
  /** Skills que todo agente desta missão carrega, além das próprias. */
  skills?: string[];
  /** Receita que preencheu a missão, para a tela poder mostrar. */
  receita?: string;
  /** Quais IAs esta missão liberou, e em que configuração. */
  elenco?: Elenco;
  criadaEm: number;
  customName?: string;
  modo?: string;
  ownershipMode?: string;
  atualizadaEm?: number;
};

// O estado vive fora dos repositórios: um projeto não é dono do cockpit.
export const CASA = process.env.COCKPIT_HOME ?? join(homedir(), ".cockpit");

function getStores() {
  const currentHome = process.env.COCKPIT_HOME ?? CASA;
  const disk = getDefaultDiskStore(currentHome);
  return {
    disk,
    missionStore: getDefaultMissionStore(disk),
    historyStore: getDefaultHistoryStore(disk),
  };
}

// Initial recovery on boot for the default CASA
recoverOnBoot(getDefaultDiskStore(CASA));

export function persistir(): void {
  getStores().missionStore.persist();
}

export function slugify(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------- projetos ----------

export const listProjects = (): Project[] => getStores().missionStore.listProjects();

export const getProject = (projectId: string): Project | undefined =>
  getStores().missionStore.getProject(projectId);

export function addProject(caminho: string): Project {
  return getStores().missionStore.addProject(caminho);
}

export function closeProject(projectId: string): Mission[] {
  return getStores().missionStore.closeProject(projectId) as unknown as Mission[];
}

export function marcarGit(projectId: string, temGit: boolean): void {
  getStores().missionStore.marcarGit(projectId, temGit);
}

// ---------- missões ----------

export const listMissions = (projectId?: string): Mission[] =>
  getStores().missionStore.listMissions(projectId) as unknown as Mission[];

export const getMission = (missionId: string): Mission | undefined =>
  getStores().missionStore.getMission(missionId) as unknown as Mission;

export function addMission(m: Omit<Mission, "id" | "panes" | "criadaEm">): Mission {
  return getStores().missionStore.addMission(m as any) as unknown as Mission;
}

export function removeMission(missionId: string): void {
  getStores().missionStore.removeMission(missionId);
}

export function attachPane(missionId: string, paneId: string): void {
  getStores().missionStore.attachPane(missionId, paneId);
}

export function detachPane(paneId: string): void {
  getStores().missionStore.detachPane(paneId);
}

// ---------- memória compartilhada ----------

export function lerMemoria(projectId: string): Nota[] {
  return getStores().historyStore.readMemory(projectId);
}

export function sanitizarTextoMemoria(texto: string): string {
  if (/invoke_subagent|define_subagent/i.test(texto)) {
    return texto.replace(
      /\b(?:via\s+)?(?:invoke_subagent|define_subagent)\b/gi,
      "via janelas/painéis abertos do Cockpit (delegar / cockpit_ask), NUNCA subagentes locais do CLI",
    );
  }
  return texto;
}

export function anotar(projectId: string, quem: string, texto: string): Nota {
  const textoLimpo = sanitizarTextoMemoria(texto);
  return getStores().historyStore.addMemoryNote(projectId, quem, textoLimpo);
}

export function esquecer(projectId: string, quando: number): void {
  getStores().historyStore.removeMemoryNote(projectId, quando);
}
