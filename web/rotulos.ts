import type { AgentSpec, PaneState } from "./api.ts";
import { resolveRoleId, roleDefinitionFor } from "./role-contract.ts";

const LABELS_LEGADOS: Record<string, string> = {
  BUILDER: "CONSTRUTOR",
  REVIEWER: "REVISOR",
  SCOUT: "EXPLORADOR",
  ARCHITECT: "ARQUITETO",
  DEBUGGER: "DEPURADOR",
  VERIFIER: "VERIFICADOR",
  FINALIZER: "FINALIZADOR",
  ORQUESTRADOR: "ORQUESTRADOR",
};

function traduzirLabel(label: string): string {
  return LABELS_LEGADOS[label.trim().toUpperCase()] ?? label;
}

export function sementeDoPainel(pane: Pick<PaneState, "role" | "agent" | "maestro">): string {
  if (pane.maestro) return "maestro";
  return pane.role?.trim() || pane.agent;
}

export function corDoPainel(pane: Pick<PaneState, "role" | "cor">): string {
  const roleId = pane.role ? resolveRoleId(pane.role) : undefined;
  if (roleId) return roleDefinitionFor(roleId).color;
  return pane.cor;
}

function rotuloDoPapel(pane: Pick<PaneState, "role" | "maestro">): string | null {
  const roleId = pane.maestro ? "maestro" : pane.role ? resolveRoleId(pane.role) : undefined;
  if (!roleId) return null;
  return traduzirLabel(roleDefinitionFor(roleId).label.toUpperCase());
}

/**
 * O nome que um agente carrega em toda a interface.
 *
 * A identidade visível é o PAPEL (Arquiteto ≠ Construtor), mesmo quando os dois
 * compartilham o perfil de execução. Duas sessões do mesmo papel só se
 * diferenciam por um sufixo estável — nunca da posição na tela.
 */
export function nomeDoPainel(pane: PaneState, irmaos: PaneState[], agents: Record<string, AgentSpec>): string {
  const agentNome = traduzirLabel(agents[pane.agent]?.label || pane.agent);
  const papelNome = rotuloDoPapel(pane);
  const gravado = pane.label?.trim() ?? "";
  const padraoDoExecutor = !gravado || gravado === agentNome || gravado.toUpperCase() === agentNome.toUpperCase();
  const padraoDoPapel = Boolean(papelNome && gravado.toUpperCase() === papelNome);
  const nome = papelNome && (padraoDoExecutor || padraoDoPapel)
    ? papelNome
    : traduzirLabel(gravado || agentNome);
  const chave = sementeDoPainel(pane).toLowerCase();
  const mesmos = irmaos.filter((outro) => outro.missionId === pane.missionId && sementeDoPainel(outro).toLowerCase() === chave);
  return mesmos.length > 1 ? `${nome} · ${mesmos.indexOf(pane) + 1}` : nome;
}

export function estadoDoPainel(pane: PaneState, conectado: boolean): string {
  if (!conectado) return "Sem conexão";
  return pane.status === "run" ? "Em atividade" : pane.status === "dead" ? "Encerrado" : "Sem atividade recente";
}

export function formatarTempoSessao(ms: number): string {
  if (!ms || ms <= 0 || isNaN(ms)) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const segRestantes = s % 60;
  if (m < 60) return segRestantes > 0 ? `${m}m ${segRestantes}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const minRestantes = m % 60;
  return minRestantes > 0 ? `${h}h ${minRestantes}m` : `${h}h`;
}

export function formatarTempoCompleto(ms: number): string {
  if (!ms || ms <= 0 || isNaN(ms)) return "0s";
  const totalS = Math.floor(ms / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  const partes: string[] = [];
  if (h > 0) partes.push(`${h}h`);
  if (m > 0 || h > 0) partes.push(`${m}m`);
  partes.push(`${s}s`);
  return partes.join(" ");
}

export function formatarHoraInicio(timestamp: number): string {
  if (!timestamp) return "—";
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "—";
  }
}
