/**
 * 8-State Granular Pane State Machine (Requirement R10).
 *
 * Granular Lifecycle:
 * - `starting`: PTY process initialized, child process booting.
 * - `waiting-user`: Process idle, awaiting user keystrokes / prompt response.
 * - `working`: Actively streaming data or executing work.
 * - `blocked`: Execution paused due to quota exhaustion, lock conflict, or missing approval.
 * - `review`: Pane work completed and awaiting manual/automated review.
 * - `completed`: Associated task or mission completed successfully.
 * - `failed`: Process terminated with error code (non-zero) or unhandled fault.
 * - `dead`: PTY closed / process terminated cleanly (exit 0) or killed.
 *
 * Backward Compatibility:
 * - "run" maps to "working"
 * - "idle" maps to "waiting-user"
 */

export type GranularPaneStatus =
  | "starting"
  | "waiting-user"
  | "working"
  | "blocked"
  | "review"
  | "completed"
  | "failed"
  | "dead";

export type PaneStatus = GranularPaneStatus | "run" | "idle";

export interface PaneState {
  paneId: string;
  agent: string;
  label: string;
  cor: string;
  cli: string;
  role?: string;
  runner?: string;
  connected?: boolean;
  attachedRunner?: string | null;
  /** O que o harness resolveu de verdade, não o padrão do catálogo. */
  model: string | null;
  effort: string | null;
  tipo: string | null;
  tarefa?: string | null;
  cwd: string;
  projectId: string | null;
  missionId: string | null;
  sessionId: string | null;
  maestro: boolean;
  accountId?: string | null;
  accountLabel?: string | null;
  /** Se true, cota blocked não rotaciona para outra conta do pool */
  accountPinned?: boolean;
  backend?: "pty" | "dsh";
  status: PaneStatus;
  blockedReason?: string | null;
  exitCode?: number | null;
  bytesIn: number;
  bytesOut: number;
  iniciadoEm: number;
  atualizadoEm?: number;
  /** Bytes emitidos por segundo, 40 slots por padrão (mais novo por último). */
  atividade: number[];
}

export const GRANULAR_PANE_STATES: readonly GranularPaneStatus[] = [
  "starting",
  "waiting-user",
  "working",
  "blocked",
  "review",
  "completed",
  "failed",
  "dead",
] as const;

/**
 * Normalizes any legacy or granular status to the canonical 8 granular statuses.
 */
export function normalizePaneStatus(status: PaneStatus): GranularPaneStatus {
  if (status === "run") return "working";
  if (status === "idle") return "waiting-user";
  return status;
}

/**
 * Transition rules defining which states can legally transition into which target states.
 */
export const ALLOWED_TRANSITIONS: Record<GranularPaneStatus, readonly GranularPaneStatus[]> = {
  starting: ["working", "waiting-user", "blocked", "failed", "dead"],
  "waiting-user": ["working", "blocked", "review", "completed", "failed", "dead"],
  working: ["waiting-user", "blocked", "review", "completed", "failed", "dead"],
  blocked: ["working", "waiting-user", "failed", "dead"],
  review: ["working", "waiting-user", "completed", "failed", "dead"],
  completed: ["working", "waiting-user", "dead"],
  failed: ["starting", "working", "waiting-user", "dead"],
  dead: ["starting"],
};

/**
 * Validates whether a state transition from `current` to `target` is allowed.
 */
export function canTransitionPane(current: PaneStatus, target: PaneStatus): boolean {
  const normCurrent = normalizePaneStatus(current);
  const normTarget = normalizePaneStatus(target);

  if (normCurrent === normTarget) return true;
  const allowed = ALLOWED_TRANSITIONS[normCurrent];
  return allowed ? allowed.includes(normTarget) : false;
}

/**
 * Executes a valid state transition on a PaneState instance.
 * Throws an error if the transition is invalid, ensuring state machine integrity.
 */
export function transitionPane(
  state: PaneState,
  target: PaneStatus,
  options?: { reason?: string; exitCode?: number },
): boolean {
  const normCurrent = normalizePaneStatus(state.status);
  const normTarget = normalizePaneStatus(target);

  if (normCurrent === normTarget) {
    if (options?.reason !== undefined) state.blockedReason = options.reason;
    if (options?.exitCode !== undefined) state.exitCode = options.exitCode;
    state.atualizadoEm = Date.now();
    return true;
  }

  if (!canTransitionPane(normCurrent, normTarget)) {
    throw new Error(
      `Invalid PaneState transition: cannot transition pane "${state.paneId}" from "${normCurrent}" to "${normTarget}"`,
    );
  }

  state.status = normTarget;
  state.atualizadoEm = Date.now();

  if (normTarget === "blocked") {
    state.blockedReason = options?.reason ?? "Process blocked";
  } else if (state.blockedReason) {
    state.blockedReason = null;
  }

  if (options?.exitCode !== undefined) {
    state.exitCode = options.exitCode;
  }

  return true;
}

/**
 * Checks if the status represents an active, living process.
 */
export function isPaneActive(status: PaneStatus): boolean {
  const norm = normalizePaneStatus(status);
  return norm !== "dead" && norm !== "failed";
}

/**
 * Human-readable Portuguese descriptions for UI status badges.
 */
export function getPaneStatusLabel(status: PaneStatus): string {
  const norm = normalizePaneStatus(status);
  switch (norm) {
    case "starting":
      return "Inicializando";
    case "waiting-user":
      return "Aguardando Usuário";
    case "working":
      return "Em Atividade";
    case "blocked":
      return "Bloqueado";
    case "review":
      return "Em Revisão";
    case "completed":
      return "Concluído";
    case "failed":
      return "Falha";
    case "dead":
      return "Encerrado";
  }
}
