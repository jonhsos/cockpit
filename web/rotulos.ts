import type { AgentSpec, PaneState } from "./api.ts";

const LABELS_LEGADOS: Record<string, string> = {
  BUILDER: "CONSTRUTOR",
  REVIEWER: "REVISOR",
  SCOUT: "EXPLORADOR",
  ARCHITECT: "ARQUITETO",
  DEBUGGER: "DEPURADOR",
  VERIFIER: "VERIFICADOR",
  FINALIZER: "FINALIZADOR",
};

function traduzirLabel(label: string): string {
  return LABELS_LEGADOS[label.trim().toUpperCase()] ?? label;
}

/**
 * O nome que um agente carrega em toda a interface.
 *
 * A lateral, o cabeçalho do terminal e os rótulos de acessibilidade precisam
 * dizer a mesma coisa: duas sessões do mesmo agente só se diferenciam por um
 * sufixo estável, derivado da ordem em que entraram na missão — nunca da
 * posição na tela.
 */
export function nomeDoPainel(pane: PaneState, irmaos: PaneState[], agents: Record<string, AgentSpec>): string {
  const nome = traduzirLabel(pane.label?.trim() || agents[pane.agent]?.label || pane.agent);
  const mesmos = irmaos.filter(outro => outro.missionId === pane.missionId && outro.agent === pane.agent);
  return mesmos.length > 1 ? `${nome} · ${mesmos.indexOf(pane) + 1}` : nome;
}

export function estadoDoPainel(pane: PaneState, conectado: boolean): string {
  if (!conectado) return "Sem conexão";
  return pane.status === "run" ? "Em atividade" : pane.status === "dead" ? "Encerrado" : "Sem atividade recente";
}
