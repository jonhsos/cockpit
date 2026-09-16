import {
  CANONICAL_ROLES,
  CATALOG_ROLES,
  type AgentSpec,
  type RoleDefinition,
  type RunnerId,
} from "./tipos.ts";

export const ROLE_CATEGORY_LABELS: Record<RoleDefinition["category"], string> = {
  coordenacao: "Coordenação",
  engenharia: "Engenharia",
  design: "Design & UX",
  qualidade: "Qualidade",
  pesquisa: "Pesquisa",
  midia: "Mídia",
  custom: "Customizado",
};

export const ROLE_CATEGORY_ORDER: RoleDefinition["category"][] = [
  "coordenacao",
  "engenharia",
  "design",
  "qualidade",
  "pesquisa",
  "midia",
  "custom",
];

export type RoleContractPayload = Pick<
  RoleDefinition,
  "id" | "label" | "description" | "outcome" | "owns" | "doesNotOwn" | "qualityGates" | "deliverables" | "incorporates"
> & { baseAgent?: string };

export const PRIMARY_ROLE_ORDER = [
  "maestro",
  "scout",
  "architect",
  "builder",
  "debugger",
  "reviewer",
  "verifier",
  "finalizer",
] as const;

export const PRIMARY_ROLE_LABELS: Record<(typeof PRIMARY_ROLE_ORDER)[number], string> = {
  maestro: "Orquestrador",
  scout: "Explorador",
  architect: "Arquiteto",
  builder: "Construtor",
  debugger: "Depurador",
  reviewer: "Revisor",
  verifier: "Verificador",
  finalizer: "Finalizador",
};

export const PRIMARY_CATALOG_ROLES = PRIMARY_ROLE_ORDER
  .map((id) => CATALOG_ROLES.find((role) => role.id === id))
  .filter((role): role is RoleDefinition => Boolean(role));

export function roleCategoryLabel(category: RoleDefinition["category"]): string {
  return ROLE_CATEGORY_LABELS[category];
}

export function roleContractPayload(role: RoleDefinition): RoleContractPayload {
  return {
    id: role.id,
    label: role.label,
    description: role.description,
    outcome: role.outcome,
    owns: role.owns,
    doesNotOwn: role.doesNotOwn,
    qualityGates: role.qualityGates,
    deliverables: role.deliverables,
    ...(role.incorporates?.length ? { incorporates: role.incorporates } : {}),
    ...(role.baseAgent ? { baseAgent: role.baseAgent } : {}),
  };
}

const ROLE_ID_ALIASES: Record<string, string> = {
  orchestrator: "maestro",
  orquestrador: "maestro",
  maestro: "maestro",
  explorer: "scout",
  explorador: "scout",
  scout: "scout",
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
  "revisor de segurança": "reviewer",
  "security reviewer": "reviewer",
  "security-reviewer": "reviewer",
  verifier: "verifier",
  verificador: "verifier",
  testador: "verifier",
  tester: "verifier",
  auditor: "verifier",
  finalizer: "finalizer",
  finalizador: "finalizer",
  documentador: "finalizer",
  luna: "luna",
  ux: "luna",
  "especialista de ux": "luna",
  artista: "artista",
  media: "artista",
  "especialista de mídia": "artista",
};

function normalizedRoleId(value: string): string {
  const normalized = value.trim().toLowerCase();
  return ROLE_ID_ALIASES[normalized] ?? normalized;
}

export function roleDefinitionFor(
  roleId: string,
  customRoles: RoleDefinition[] = [],
): RoleDefinition {
  const normalized = normalizedRoleId(roleId);
  return (
    [...CANONICAL_ROLES, ...customRoles].find((role) => role.id === roleId || role.id === normalized) ??
    CANONICAL_ROLES.find((role) => role.id === "builder")!
  );
}

/**
 * Config agents are execution profiles. This mapping is the only bridge from
 * a semantic role to one of those profiles in the mission wizard.
 */
export function roleIdFromAgent(agentId: string, agent: AgentSpec): string {
  if (agent.maestro || agentId === "maestro" || agent.papel_id === "orquestrar" || agent.papel_id === "orquestrador") return "maestro";
  if (agentId === "luna") return "builder";

  switch (agent.papel_id) {
    case "revisar":
    case "reviewer":
      return "reviewer";
    case "revisor de segurança":
    case "security reviewer":
    case "security-reviewer":
      return "reviewer";
    case "pesquisar":
    case "scout":
      return "scout";
    case "explorer":
    case "explorador":
      return "scout";
    case "pesquisador":
      return "scout";
    case "architect":
    case "arquiteto":
      return "architect";
    case "planejador":
      return "architect";
    case "debugger":
    case "depurador":
      return "debugger";
    case "especialista":
      return "debugger";
    case "verifier":
    case "verificador":
      return "verifier";
    case "testador":
    case "tester":
    case "auditor":
      return "verifier";
    case "finalizer":
    case "finalizador":
      return "finalizer";
    case "documentador":
      return "finalizer";
    case "media":
    case "artista":
      return "artista";
    case "executar":
    case "builder":
      return "builder";
    default:
      break;
  }

  if (["reviewer", "scout", "artista", "builder", "architect", "debugger", "verifier", "finalizer"].includes(agentId)) return agentId;
  return "builder";
}

export function agentForRole(
  agents: Record<string, AgentSpec>,
  role: RoleDefinition,
  allowedRunners: Set<string> = new Set(),
): string | undefined {
  const semanticRole = role.baseAgent ?? role.id;
  const candidates = Object.entries(agents).filter(([agentId, agent]) => {
    if (agent.cli === "bash") return false;
    if (allowedRunners.size > 0 && !allowedRunners.has(agent.cli)) return false;
    return roleIdFromAgent(agentId, agent) === semanticRole;
  });

  candidates.sort(([leftId, leftAgent], [rightId, rightAgent]) => {
    const leftRank = leftId === semanticRole ? 0 : leftAgent.maestro && semanticRole === "maestro" ? 1 : 2;
    const rightRank = rightId === semanticRole ? 0 : rightAgent.maestro && semanticRole === "maestro" ? 1 : 2;
    return leftRank - rightRank || leftId.localeCompare(rightId);
  });
  return candidates[0]?.[0];
}

export function suggestedRoleRunner(role: RoleDefinition, runners: RunnerId[]): RunnerId | undefined {
  return role.suggestedRunners?.find((runner) => runners.includes(runner));
}
