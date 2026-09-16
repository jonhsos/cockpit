export const ROLE_ALIASES: Record<string, string> = {
  maestro: "maestro",
  orchestrator: "maestro",
  orquestrador: "maestro",
  scout: "scout",
  explorer: "scout",
  explorador: "scout",
  pesquisador: "scout",
  architect: "architect",
  arquiteto: "architect",
  planejador: "architect",
  builder: "builder",
  construtor: "builder",
  executor: "builder",
  integrador: "builder",
  debugger: "debugger",
  depurador: "debugger",
  especialista: "debugger",
  reviewer: "reviewer",
  revisor: "reviewer",
  verifier: "verifier",
  verificador: "verifier",
  testador: "verifier",
  tester: "verifier",
  auditor: "verifier",
  finalizer: "finalizer",
  finalizador: "finalizer",
  documentador: "finalizer",
  artista: "artista",
  media: "artista",
};

export interface PaneRef {
  paneId: string;
  label?: string;
  role?: string;
  runner?: string;
  cli?: string;
  attachedRunner?: string | null;
  connected?: boolean;
  status?: string;
  activeTaskId?: string | null;
  missionId?: string | null;
}

export function normalizarAlvo(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  return ROLE_ALIASES[normalized] ?? normalized;
}

export function correspondeAoAlvo(pane: PaneRef, alvo: string): boolean {
  const alvoNormalizado = normalizarAlvo(alvo);
  if (!alvoNormalizado) return false;
  if (pane.paneId === alvo.trim()) return true;
  return [pane.label, pane.role, pane.runner, pane.cli, pane.paneId]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizarAlvo(value) === alvoNormalizado);
}

export function shellPodeReceberTarefa(pane: PaneRef): boolean {
  const isBash = pane.cli === "bash" || pane.runner === "bash";
  if (!isBash) return true;
  if (pane.attachedRunner) return true;
  return pane.role?.trim().toLowerCase() === "shell" && pane.label?.trim().toLowerCase() !== "shell";
}

export function paneEstaOcupadoDeVerdade(pane: PaneRef): boolean {
  const status = pane.status || "waiting-user";
  return status === "working" && Boolean(pane.activeTaskId);
}

export function panePodeReceberColaNoTerminal(pane: PaneRef): boolean {
  if (pane.connected === false) return false;
  const status = pane.status || "waiting-user";
  if (status === "dead" || status === "failed" || status === "starting") return false;
  if (paneEstaOcupadoDeVerdade(pane)) return false;
  return shellPodeReceberTarefa(pane);
}

export function formatarColaNoTerminal(prompt: string): string {
  return `\x1b[200~${prompt}\x1b[201~\r`;
}

export function resolvePaneRef<T extends PaneRef>(
  ref: string,
  panes: T[],
  missionId?: string,
): T | undefined {
  const raw = ref.trim();
  if (!raw) return undefined;
  const scoped = missionId ? panes.filter((p) => !p.missionId || p.missionId === missionId) : panes;
  const exact = scoped.find((p) => p.paneId === raw);
  if (exact) return exact;
  const matches = scoped.filter((p) => correspondeAoAlvo(p, raw));
  if (matches.length === 0) return undefined;
  const living = matches.filter((p) => p.connected !== false && p.status !== "dead" && p.status !== "failed");
  const pool = living.length > 0 ? living : matches;
  return pool.find((p) => !paneEstaOcupadoDeVerdade(p)) ?? pool[0];
}
