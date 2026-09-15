import { addWorktree, removeWorktree, temCommit } from "./git.ts";
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
 * Com git e ao menos um commit, a missão ganha worktree e branch próprios.
 * Sem isso, ela roda na própria pasta do projeto — funciona igual, mas as
 * missões dividem os mesmos arquivos.
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

  if (project.git && (await temCommit(project.root))) {
    const { worktree, branch } = await addWorktree(project.root, slugify(project.nome), nome);
    return addMission({ projectId, nome, objetivo: objetivo.trim(), worktree, branch, isolada: true, ...extra });
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
  killPane: (paneId: string) => void,
): Promise<void> {
  const mission = getMission(missionId);
  if (!mission) throw new Error("missão não encontrada");
  const project = getProject(mission.projectId);

  for (const paneId of mission.panes) killPane(paneId);

  // Só existe pasta para apagar se ela foi criada por nós. Uma missão não
  // isolada aponta para a pasta do projeto: arquivar nunca pode tocar nela.
  if (
    mission.isolada &&
    mission.branch &&
    project &&
    mission.worktree !== project.root
  ) {
    await removeWorktree(project.root, mission.worktree, mission.branch);
  }

  removeMission(missionId);
}
