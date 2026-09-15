import type { CockpitConfig, Elenco } from "../config.ts";
import type { TaskManager, FileOwnershipManager } from "../tasks/index.ts";
import type { InterAgentBridge, MailboxManager } from "../connections/index.ts";
import type { MissionModeManager, PaneDispatcher } from "../orchestration/index.ts";
import type { Continuity, LimitSignal } from "../missions/continuity.ts";
import type { PaneState } from "../pty.ts";
import type { Pedido } from "../orchestration/harness.ts";

export interface RouterContext {
  config: CockpitConfig;
  salvarConfig: () => void;
  porta: number;

  // Singletons de domínio
  taskManager: TaskManager;
  ownershipManager: FileOwnershipManager;
  bridge: InterAgentBridge;
  mailboxManager: MailboxManager;
  missionModeManager: MissionModeManager;
  paneDispatcher: PaneDispatcher;
  continuity: Continuity;

  // Broadcast e notificações
  broadcast: (msg: unknown) => void;
  notifyMaestro: () => void;

  // Funções de coordenação e ciclo de vida
  abrirPainel: (
    agent: string,
    missionId: string,
    tarefa?: string,
    harness?: Omit<Pedido, "agent">,
    skills?: string[],
    maestroOverride?: boolean,
    accountOpts?: { preferredAccountId?: string; accountPinned?: boolean },
  ) => PaneState;
  switchMaestro: (
    missionId: string,
    cli: string,
    accountOpts?: { preferredAccountId?: string; accountPinned?: boolean },
  ) => Promise<PaneState>;
  saveCheckpoint: (missionId: string, value: unknown) => { ok: boolean; instruction?: string };
  raizDe: (missionId: string | null, projectId: string | null) => string | null;

  // Limites e cotas
  limits: Map<string, LimitSignal>;
  refreshQuota: () => Promise<void>;
  maestroStatus: () => Record<string, unknown>;
  presetsDoMaestro: () => Record<string, { model: string; effort: string }>;
  especialistasDaMissao: (missionId: string) => any[];
  limparElenco: (bruto: unknown) => Elenco | undefined;
  trackDelegation?: (missionId: string, paneId: string, agent?: string) => void;
  outputTails?: Map<string, string>;
}
