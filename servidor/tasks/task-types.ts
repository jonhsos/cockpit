/**
 * Formal 6-state Task Lifecycle (R6)
 */
export type TaskStatus =
  | "todo"
  | "in-progress"
  | "blocked"
  | "in-review"
  | "complete"
  | "failed";

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
  id: string;                          // Unique ID: e.g. "ev-1726245600000-abcd"
  tipo: EvidenceType;                  // Evidence category
  descricao: string;                   // Human-readable summary
  caminho?: string;                    // Target file path (if applicable)
  conteudo?: string;                   // Text snippet, log output, or notes
  diff?: string;                       // Unified diff text
  status?: "passed" | "failed";        // Result for test runs
  autor?: string;                      // Agent ID, pane ID, or user
  timestamp: number;                   // Epoch ms when recorded
  metadata?: Record<string, unknown>;  // Extensible metadata
}

export interface TaskTimestamps {
  criadaEm: number;                    // Epoch ms when created
  iniciadaEm?: number;                 // Epoch ms when first moved to "in-progress"
  concluidaEm?: number;                // Epoch ms when moved to "complete" or "failed"
  atualizadaEm: number;                // Epoch ms of last status or attribute change
}

/**
 * Canonical 13-field Task Entity (R6)
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

/**
 * Input payload for Task creation, supporting ASCII aliases
 */
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

/**
 * File Ownership & Locking Types (R7)
 */
export type LockMode = "shared" | "isolated";

export interface FileLock {
  id: string;
  file: string;                        // Normalized POSIX relative path
  filePath?: string;                   // Alias for backward compatibility
  missionId: string;
  taskId: string;
  paneId: string | null;
  owner: string;                       // Role or agent name
  mode: LockMode;
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

/**
 * Task Board Data Structure for Cockpit Sidebar (R6)
 */
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
