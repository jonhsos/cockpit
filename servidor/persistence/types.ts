export type {
  TaskStatus,
  TaskPriority,
  EvidenceType,
  TaskEvidence,
  TaskTimestamps,
  Task,
  TaskBoardData,
  LockMode,
} from "../tasks/task-types.ts";

export interface TaskResult {
  resumo: string;
  sucesso: boolean;
  artefatos?: string[];
  concluidoPor?: string;
  concluidoEm: number;
}

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

export type FileOwnershipMode = "shared" | "isolated";

export interface FileLock {
  id: string;
  file: string;                        // Normalized POSIX relative path
  filePath?: string;                   // Alias for backward compatibility
  missionId: string;
  taskId: string;
  paneId: string | null;
  owner: string;                       // Role or agent name
  mode: FileOwnershipMode;
  acquiredAt: number;
}

export interface FileOwnershipState {
  missionId: string;
  mode: FileOwnershipMode;
  locks: Record<string, FileLock>;
  collisionWarnings: {
    filePath: string;
    taskIds: string[];
    paneIds: string[];
    timestamp: number;
  }[];
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

export type PaneStatus =
  | "starting"
  | "waiting-user"
  | "working"
  | "blocked"
  | "review"
  | "completed"
  | "failed"
  | "dead";

export interface PaneRecord {
  paneId: string;
  missionId: string;
  projectId: string | null;
  label: string;
  role: string;
  runner: string;
  model: string | null;
  effort: string | null;
  cwd: string;
  maestro: boolean;
  status: PaneStatus;
  iniciadoEm: number;
  atualizadoEm: number;
}

export type MissionMode = "livre" | "dirigido" | "autonomo";

export interface MissionRecord {
  id: string;
  projectId: string;
  nome: string;
  customName?: string;
  objetivo: string;
  worktree: string;
  branch: string | null;
  isolada: boolean;
  panes: string[];
  modo: MissionMode;
  ownershipMode: FileOwnershipMode;
  skills?: string[];
  receita?: string;
  elenco?: Record<string, unknown>;
  criadaEm: number;
  atualizadaEm: number;
}

export interface ProjectRecord {
  id: string;
  nome: string;
  root: string;
  git: boolean;
  abertoEm: number;
}

export type Colunas = "auto" | "1" | "2" | "3";

export interface LayoutRecord {
  missionId: string;
  colunas: Colunas;
  paneOrder: string[];
  selectedPaneId: string | null;
  sidebarTab: "missoes" | "tarefas" | "arquivos";
  taskBoardCollapsed: boolean;
  atualizadoEm: number;
}

export interface AuditEvent {
  id: string;
  timestamp: number;
  missionId?: string;
  paneId?: string;
  actor: string;
  action: string;
  details: Record<string, unknown>;
  tokens?: { prompt?: number; completion?: number; total?: number };
  cost?: number;
  error?: string;
}

export interface Nota {
  quando: number;
  quem: string;
  texto: string;
}
