import type { Elenco } from "../config.ts";
import {
  addMission,
  getMission,
  getProject,
  listMissions,
  removeMission,
  slugify,
  type Mission,
} from "../state.ts";

export type { Mission };
export { getMission, listMissions, persistir, getProject } from "../state.ts";

/**
 * Missões são organização lógica. Todos os agentes trabalham diretamente na
 * pasta que o usuário abriu; Git não cria cópias nem troca branches sozinho.
 */
export async function createMission(
  projectId: string,
  nomeBruto: string,
  objetivo: string,
  /** Skills, receita, elenco e modo da missão. */
  extra: {
    skills?: string[];
    receita?: string;
    elenco?: Elenco;
    modo?: string;
    ownershipMode?: string;
  } = {},
): Promise<Mission> {
  const project = getProject(projectId);
  if (!project) throw new Error("projeto não encontrado");

  const nome = slugify(nomeBruto);
  if (!nome) throw new Error("nome inválido");
  if (listMissions(projectId).some((m) => m.nome === nome)) {
    throw new Error(`a missão "${nome}" já existe em ${project.nome}`);
  }

  return addMission({
    projectId,
    nome,
    objetivo: objetivo.trim(),
    worktree: project.root,
    branch: null,
    isolada: false,
    ...extra,
  });
}

export async function archiveMission(
  missionId: string,
  killPane: (paneId: string) => void | Promise<void>,
): Promise<void> {
  const mission = getMission(missionId);
  if (!mission) throw new Error("missão não encontrada");
  // Aguarda reap de panes DSH (KD-A) — kill síncrono fire-and-forget deixava zumbi.
  await Promise.all(mission.panes.map((paneId) => Promise.resolve(killPane(paneId))));

  removeMission(missionId);
}

/**
 * Missões novas usam a pasta real. Worktrees antigos continuam apontando para
 * seu diretório até serem resgatados explicitamente, evitando perda de dados.
 */
export function cwdDaMissao(mission: Mission): string {
  const project = getProject(mission.projectId);
  if (!project) throw new Error("projeto não encontrado");
  return mission.isolada && mission.worktree !== project.root
    ? mission.worktree
    : project.root;
}
