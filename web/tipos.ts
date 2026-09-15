/**
 * Unified Contracts & Types for Cockpit Frontend (Milestone M5)
 * 
 * Strict decoupling of:
 * - Role: Semantic functional identity (Maestro, Builder, Luna, Reviewer, Scout, Artista, Custom)
 * - Runner: Execution harness (bash, codex, claude, agy, openrouter)
 * - Model: LLM configuration / combo
 * - Pane: Sovereign live PTY process
 * - Connection: Real persisted inter-pane link
 * - Task: Structured work unit (13 canonical fields, 6 formal states)
 * - Handoff: Inter-agent contextual transfer
 */

import type {
  Usage,
  PaneState as ApiPaneState,
  Project,
  Mission as ApiMission,
  AgentSpec,
  SquadSpec,
  Provider,
  AccountPoolItemView,
  AccountPoolView,
  Elenco,
  Nota,
  No,
} from "./api.ts";

export type {
  Usage,
  Project,
  AgentSpec,
  SquadSpec,
  Provider,
  AccountPoolItemView,
  AccountPoolView,
  Elenco,
  Nota,
  No,
};

// ============================================================================
// 1. Roles & Catalog
// ============================================================================

export interface RoleDefinition {
  id: string;
  label: string;
  color: string;
  category: "coordenacao" | "engenharia" | "design" | "qualidade" | "pesquisa" | "midia" | "custom";
  description: string;
  icon: string;
  systemPrompt?: string;
  suggestedRunners?: RunnerId[];
}

export const CANONICAL_ROLES: RoleDefinition[] = [
  {
    id: "maestro",
    label: "Maestro",
    color: "#00b4ff",
    category: "coordenacao",
    description: "Coordena missões, decompõe objetivos em tarefas estruturadas e delega aos especialistas. Nunca escreve código diretamente.",
    icon: "team",
    suggestedRunners: ["claude", "codex", "agy", "bash"],
  },
  {
    id: "builder",
    label: "Builder",
    color: "#4fb286",
    category: "engenharia",
    description: "Engenharia de software full-stack, implementação de funcionalidades, refatoração e correção de defeitos.",
    icon: "code",
    suggestedRunners: ["codex", "claude", "agy", "bash"],
  },
  {
    id: "luna",
    label: "Luna (UX)",
    color: "#e2703a",
    category: "design",
    description: "Arquitetura de interface, design de interação, acessibilidade, CSS refinado e polimento visual.",
    icon: "sparkles",
    suggestedRunners: ["claude", "codex", "agy", "bash"],
  },
  {
    id: "reviewer",
    label: "Reviewer",
    color: "#9d7bd8",
    category: "qualidade",
    description: "Revisão rigorosa de código, conformidade arquitetural, detecção de vulnerabilidades e inspeção de testes.",
    icon: "check-shield",
    suggestedRunners: ["claude", "codex", "bash"],
  },
  {
    id: "scout",
    label: "Scout",
    color: "#4a9fd8",
    category: "pesquisa",
    description: "Reconhecimento do repositório, mapeamento de dependências, diagnóstico e análise estritamente read-only.",
    icon: "search",
    suggestedRunners: ["codex", "claude", "agy", "bash"],
  },
  {
    id: "artista",
    label: "Artista",
    color: "#d9a441",
    category: "midia",
    description: "Geração de ativos visuais, ilustrações, ícones, mockups e mídia para a aplicação.",
    icon: "media",
    suggestedRunners: ["agy", "openrouter"],
  },
];

// ============================================================================
// 2. Runners & Models
// ============================================================================

export type RunnerId = "bash" | "codex" | "claude" | "agy" | "openrouter" | "grok";

export interface RunnerOption {
  id: RunnerId;
  label: string;
  badge: string;
  description: string;
  installed: boolean;
  isAi: boolean;
  icon: string;
}

export const CANONICAL_RUNNERS: RunnerOption[] = [
  {
    id: "bash",
    label: "SHELL Limpo",
    badge: "Soberano · /bin/bash -i -l",
    description: "Terminal Linux vazio e isolado. Sem injeção de prompt, sem LLM no boot. Você comanda manualmente com soberania total.",
    installed: true,
    isAi: false,
    icon: "terminal",
  },
  {
    id: "codex",
    label: "Codex CLI",
    badge: "CLI Host",
    description: "Execução via CLI oficial do OpenAI Codex no host.",
    installed: true,
    isAi: true,
    icon: "codex",
  },
  {
    id: "claude",
    label: "Claude Code",
    badge: "CLI Host",
    description: "Execução via CLI oficial do Anthropic Claude Code no host.",
    installed: true,
    isAi: true,
    icon: "claude",
  },
  {
    id: "agy",
    label: "Antigravity",
    badge: "CLI Host",
    description: "Execução via CLI do Google Gemini / Antigravity no host.",
    installed: true,
    isAi: true,
    icon: "gemini",
  },
  {
    id: "grok",
    label: "Grok",
    badge: "CLI Host",
    description: "Execução via CLI oficial do Grok (xAI) no host.",
    installed: true,
    isAi: true,
    icon: "terminal",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    badge: "Ponte Multi-Modelo",
    description: "Execução de modelos abertos e proprietários via chave OpenRouter.",
    installed: true,
    isAi: true,
    icon: "network",
  },
];

export interface ModelOption {
  id: string;
  label: string;
  provider: RunnerId | string;
  effortSupport?: boolean;
  description?: string;
  gratis?: boolean;
}

// ============================================================================
// 3. Granular Pane States (8 States Machine)
// ============================================================================

export type GranularPaneStatus =
  | "starting"
  | "waiting-user"
  | "working"
  | "blocked"
  | "review"
  | "completed"
  | "failed"
  | "dead"
  | "run"   // Backward compatibility
  | "idle";  // Backward compatibility

export interface GranularStatusInfo {
  status: GranularPaneStatus;
  label: string;
  color: string;
  icon: string;
  description: string;
}

export const GRANULAR_STATUS_MAP: Record<GranularPaneStatus, GranularStatusInfo> = {
  starting: {
    status: "starting",
    label: "Iniciando",
    color: "#e3b341",
    icon: "dots",
    description: "Iniciando processo e daemon PTY...",
  },
  "waiting-user": {
    status: "waiting-user",
    label: "Aguardando entrada",
    color: "#58a6ff",
    icon: "user",
    description: "Aguardando interação ou comando do usuário",
  },
  working: {
    status: "working",
    label: "Executando",
    color: "#3fb950",
    icon: "play",
    description: "Executando tarefas ativas no terminal",
  },
  blocked: {
    status: "blocked",
    label: "Bloqueado",
    color: "#f85149",
    icon: "alert",
    description: "Processo impedido por conflito de lock, cota ou dependência",
  },
  review: {
    status: "review",
    label: "Em revisão",
    color: "#bc8cff",
    icon: "eye",
    description: "Aguardando revisão ou validação de entregas",
  },
  completed: {
    status: "completed",
    label: "Concluído",
    color: "#2ea043",
    icon: "check",
    description: "Trabalho finalizado com sucesso",
  },
  failed: {
    status: "failed",
    label: "Falha",
    color: "#da3633",
    icon: "close",
    description: "Processo encerrou com código de erro diferente de zero",
  },
  dead: {
    status: "dead",
    label: "Encerrado",
    color: "#8b949e",
    icon: "square",
    description: "Terminal desconectado ou finalizado",
  },
  run: {
    status: "run",
    label: "Em atividade",
    color: "#3fb950",
    icon: "play",
    description: "Executando",
  },
  idle: {
    status: "idle",
    label: "Ocioso",
    color: "#8b949e",
    icon: "pause",
    description: "Sem atividade recente",
  },
};

export interface PaneState extends ApiPaneState {
  role?: string;
  runner?: string;
  activeTaskId?: string | null;
}

// ============================================================================
// 4. Task Entity & Formal 6-State Machine (R6)
// ============================================================================

export type TaskStatus =
  | "todo"
  | "in-progress"
  | "blocked"
  | "in-review"
  | "complete"
  | "failed";

export const CANONICAL_TASK_STATUSES: { id: TaskStatus; label: string; color: string; icon: string }[] = [
  { id: "todo", label: "A Fazer", color: "#8b949e", icon: "circle" },
  { id: "in-progress", label: "Em Andamento", color: "#58a6ff", icon: "play" },
  { id: "blocked", label: "Bloqueado", color: "#f85149", icon: "alert" },
  { id: "in-review", label: "Em Revisão", color: "#bc8cff", icon: "eye" },
  { id: "complete", label: "Concluído", color: "#3fb950", icon: "check" },
  { id: "failed", label: "Falhou", color: "#da3633", icon: "close" },
];

export type TaskPriority =
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "baixa"
  | "normal"
  | "alta"
  | "urgente";

export type EvidenceType =
  | "diff"
  | "test_run"
  | "test"
  | "log"
  | "note"
  | "artifact"
  | "knowledge"
  | "handoff";

export interface TaskEvidence {
  id: string;
  tipo: EvidenceType;
  descricao: string;
  caminho?: string;
  conteudo?: string;
  diff?: string;
  status?: "passed" | "failed";
  autor?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface TaskTimestamps {
  criadaEm: number;
  iniciadaEm?: number;
  concluidaEm?: number;
  atualizadaEm: number;
}

/**
 * Canonical 13-field Task Entity
 */
export interface Task {
  id: string;                          // 1. id
  título: string;                      // 2. título
  descrição: string;                   // 3. descrição
  responsável: string | null;          // 4. responsável (agent, pane, or user)
  papel: string | null;                // 5. papel (role decoupled from runner/model)
  pane: string | null;                 // 6. pane (assigned live PTY paneId)
  "arquivos permitidos": string[];     // 7. arquivos permitidos (scoped files)
  dependências: string[];              // 8. dependências (prerequisite task IDs)
  prioridade: TaskPriority;            // 9. prioridade
  status: TaskStatus;                  // 10. status (6-state machine)
  evidências: TaskEvidence[];          // 11. evidências
  resultado: string | null;            // 12. resultado (outcome or failure reason)
  timestamps: TaskTimestamps;          // 13. timestamps
  missionId: string;                   // Mission scoping identifier
}

export interface CreateTaskParams {
  id?: string;
  título?: string;
  titulo?: string;
  descrição?: string;
  descricao?: string;
  responsável?: string | null;
  responsavel?: string | null;
  papel?: string | null;
  pane?: string | null;
  "arquivos permitidos"?: string[];
  arquivosPermitidos?: string[];
  dependências?: string[];
  dependencias?: string[];
  prioridade?: TaskPriority;
  status?: TaskStatus;
  evidências?: TaskEvidence[];
  evidencias?: TaskEvidence[];
  resultado?: string | null;
  missionId?: string;
}

export interface UpdateTaskParams {
  título?: string;
  titulo?: string;
  descrição?: string;
  descricao?: string;
  responsável?: string | null;
  responsavel?: string | null;
  papel?: string | null;
  pane?: string | null;
  "arquivos permitidos"?: string[];
  arquivosPermitidos?: string[];
  dependências?: string[];
  dependencias?: string[];
  prioridade?: TaskPriority;
  resultado?: string | null;
  status?: TaskStatus;
}

export interface TaskBoardData {
  missionId: string;
  todo: Task[];
  "in-progress": Task[];
  blocked: Task[];
  "in-review": Task[];
  complete: Task[];
  failed: Task[];
  total: number;
}

// ============================================================================
// 5. File Ownership & Locks (R7)
// ============================================================================

export type FileOwnershipMode = "shared" | "isolated";
export type LockMode = "shared" | "isolated";

export interface FileLock {
  id: string;
  file: string;
  filePath?: string;
  missionId: string;
  taskId: string;
  paneId: string | null;
  owner: string;
  mode: FileOwnershipMode;
  acquiredAt: number;
}

export interface LockResult {
  ok: boolean;
  locked: boolean;
  mode: LockMode;
  conflictFiles?: string[];
  conflictLocks?: FileLock[];
  warning?: string;
  message?: string;
}

// ============================================================================
// 6. Connections & Handoffs (R5)
// ============================================================================

export type ConnectionStatus = "active" | "paused" | "closed";

export interface Connection {
  id: string;
  missionId: string;
  sourcePaneId: string;
  targetPaneId: string;
  criadaEm: number;
  status: ConnectionStatus;
  config?: {
    allowAsk?: boolean;
    allowReply?: boolean;
    allowHandoff?: boolean;
    metadata?: Record<string, unknown>;
  };
}

export type HandoffStatus = "pending" | "accepted" | "rejected" | "completed";

export interface Handoff {
  id: string;
  missionId: string;
  sourcePaneId: string;
  targetPaneId: string;
  taskId: string;
  context: string;
  dependencies: string[];
  evidenceIds: string[];
  timestamp: number;
  status: HandoffStatus;
}

export type MailboxMessageType = "ask" | "reply" | "handoff" | "notification";
export type MessageStatus = "unread" | "read";

export interface MailboxMessage {
  id: string;
  from: string;
  to: string;
  type: MailboxMessageType;
  correlationId?: string;
  taskId?: string;
  task?: string;
  result?: string;
  evidence?: TaskEvidence[] | unknown[];
  status: MessageStatus;
  timestamp: number;
  missionId: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 7. Missions & Modes (R8)
// ============================================================================

export type MissionMode = "livre" | "dirigido" | "autonomo";

export interface Mission extends ApiMission {
  modo?: MissionMode;
  ownershipMode?: FileOwnershipMode;
}
