/**
 * Backward-Compatible PTY Facade.
 *
 * Delegates all operations to the decoupled PTY Manager in `servidor/sessions/pty-manager.ts`,
 * while guaranteeing 100% backward compatibility for existing callers and exports.
 */

import {
  getDefaultPtyManager,
  resolveCli,
  familiaDo,
  agentSpec,
  type SpawnOpts,
  type ManagerPaneEntry,
} from "./sessions/pty-manager.ts";
import type { PaneState, PaneStatus, GranularPaneStatus } from "./sessions/pane-state.ts";

export type { PaneState, PaneStatus, GranularPaneStatus, SpawnOpts };
export { resolveCli, familiaDo, agentSpec, getDefaultPtyManager };

export {
  isCleanShell,
  getCleanShellCommand,
  sanitizeCleanShellEnv,
  assertCleanShellInvariants,
  enforceBashPrecedence,
  BASH_PATH,
  CLEAN_SHELL_ARGS,
} from "./sessions/clean-shell.ts";

const manager = getDefaultPtyManager();

/**
 * Initializes the PTY Manager and recovers surviving panes.
 */
export async function initializePty(): Promise<void> {
  await manager.initialize();
}

/**
 * Attaches a global listener for terminal output from any active pane.
 */
export function onPtyOutput(listener: (paneId: string, data: string) => void): () => void {
  return manager.onOutput(listener);
}

/**
 * Attaches a global listener for exit events from any active pane.
 */
export function onPtyExit(listener: (paneId: string, code: number, pane?: PaneState) => void): () => void {
  return manager.onExit(listener);
}

/**
 * Global map of active pane entries, preserved for backward compatibility.
 */
export const ptys: Map<string, ManagerPaneEntry> = manager.getRawMap();

/**
 * Spawns a new pane (clean bash or AI agent CLI).
 */
export function spawnPane(
  opts: SpawnOpts,
  onOutput?: (data: string) => void,
  onExit?: (code: number) => void,
): PaneState {
  return manager.spawnPane(opts, onOutput, onExit);
}

/**
 * Writes data / keystrokes into the pane master PTY.
 */
export function writePty(paneId: string, data: string): void {
  manager.writePty(paneId, data);
}

/**
 * Submits structured prompt to DSH manager or target PTY.
 */
export async function submitPrompt(paneId: string, prompt: string): Promise<boolean> {
  return await manager.submitPrompt(paneId, prompt);
}

/**
 * Resizes the master PTY window dimensions.
 */
export function resizePty(paneId: string, cols: number, rows: number): void {
  manager.resizePty(paneId, cols, rows);
}

/**
 * Lists all active panes.
 */
export function listPanes(): PaneState[] {
  return manager.listPanes();
}

/**
 * Gets a pane by ID.
 */
export function getPane(paneId: string): PaneState | undefined {
  return manager.getPane(paneId);
}

/**
 * Updates properties of a pane.
 */
export function updatePane(paneId: string, patch: Partial<PaneState>): PaneState | undefined {
  return manager.updatePane(paneId, patch);
}

/**
 * Terminates a pane.
 */
export function killPty(paneId: string): void {
  manager.killPty(paneId);
}

/**
 * Waits for pane process tree to exit.
 */
export async function stopPane(paneId: string): Promise<void> {
  await manager.stopPane(paneId);
}

/** Aguarda reaps DSH enfileirados por killPty (missão/kill em lote). */
export async function flushDshKills(): Promise<void> {
  await manager.flushDshKills();
}

/**
 * Periodic 1-second pulse for activity tracking and state transitions.
 */
export function tick(onPulse: (state: PaneState) => void): void {
  manager.tick(onPulse);
}

/**
 * Replays terminal output from the 256KB circular ring buffer.
 */
export async function replayPane(paneId: string): Promise<string> {
  return await manager.replayPane(paneId);
}

/* ========================================================================= */
/* Portuguese Aliases for Complete Compatibility                              */
/* ========================================================================= */

export const abrirPainel = spawnPane;
export const escreverPainel = writePty;
export const redimensionarPainel = resizePty;
export const fecharPainel = killPty;
export const listarPaineis = listPanes;
export const obterPainel = getPane;
export const atualizarPainel = updatePane;
