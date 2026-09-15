import { config } from "../config.ts";
import type { Mission } from "../state.ts";
import type { PaneState } from "../pty.ts";
import type { Roster } from "../config.ts";

export type Fase = { nome: string; agentes: string[]; tipo?: string; roster?: Roster };

export type SquadRun = {
  missionId: string;
  squad: string;
  brief: string;
  fases: Fase[];
  faseAtual: number;
  iniciadaEm: number;
};

const runs = new Map<string, SquadRun>();

export const getRun = (missionId: string): SquadRun | undefined => runs.get(missionId);
export const encerrarRun = (missionId: string): void => void runs.delete(missionId);

/**
 * O tipo da tarefa vem da fase, e o roster pode trocá-lo por agente: na fase
 * de construção o builder implementa, mas o artista faz trabalho visual.
 */
function harnessDe(fase: Fase, agent: string): { tipo?: string; roster?: Roster[string] } {
  const roster = fase.roster?.[agent];
  return { tipo: roster?.tipo ?? fase.tipo, roster };
}

/** O papel e o objetivo já viajam no system prompt; aqui vai só a tarefa. */
function tarefaPara(agent: string, brief: string, fase: string): string {
  return config.agents[agent]?.maestro && config.politicaIA?.modo !== "unica"
    ? `${brief}\n\nVocê é o maestro desta missão: divida isto entre os especialistas com as ferramentas do cockpit e acompanhe cada um.`
    : `[fase: ${fase}] ${brief}`;
}

/**
 * Sobe o primeiro agente na hora e escalona os demais. O espaçamento existe
 * por dois motivos: a Antigravity guarda o modelo escolhido num arquivo só, e
 * quatro CLIs subindo no mesmo instante brigam por CPU. Os painéis atrasados
 * chegam ao navegador pelo evento "spawned", como qualquer outro.
 */
function dispararFase(
  run: SquadRun,
  spawn: (agent: string, tarefa: string, harness?: { tipo?: string; roster?: Roster[string] }) => PaneState,
): PaneState[] {
  const fase = run.fases[run.faseAtual];
  if (!fase) return [];
  const [primeiro, ...resto] = fase.agentes;
  if (!primeiro) return [];

  resto.forEach((agent, i) => {
    setTimeout(
      () => {
        try {
          spawn(agent, tarefaPara(agent, run.brief, fase.nome), harnessDe(fase, agent));
        } catch (err) {
          console.error("[cockpit] falhou ao subir", agent, err);
        }
      },
      (i + 1) * 2000,
    );
  });

  return [spawn(primeiro, tarefaPara(primeiro, run.brief, fase.nome), harnessDe(fase, primeiro))];
}

export function iniciarSquad(
  mission: Mission,
  squadNome: string,
  brief: string,
  spawn: (agent: string, tarefa: string, harness?: { tipo?: string; roster?: Roster[string] }) => PaneState,
): { run: SquadRun; panes: PaneState[] } {
  const spec = config.squads[squadNome];
  if (!spec) throw new Error(`o time "${squadNome}" não existe`);
  if (!brief.trim()) throw new Error("escreva o que o time precisa fazer");

  const run: SquadRun = {
    missionId: mission.id,
    squad: squadNome,
    brief: brief.trim(),
    fases: spec.fases,
    faseAtual: 0,
    iniciadaEm: Date.now(),
  };
  runs.set(mission.id, run);
  return { run, panes: dispararFase(run, spawn) };
}

/** O portão: você decide quando a próxima fase entra. */
export function avancarFase(
  mission: Mission,
  spawn: (agent: string, tarefa: string, harness?: { tipo?: string; roster?: Roster[string] }) => PaneState,
): { run: SquadRun; panes: PaneState[] } {
  const run = runs.get(mission.id);
  if (!run) throw new Error("nenhum time em andamento nessa missão");
  if (run.faseAtual >= run.fases.length - 1) throw new Error("o time já está na última fase");
  run.faseAtual += 1;
  return { run, panes: dispararFase(run, spawn) };
}
