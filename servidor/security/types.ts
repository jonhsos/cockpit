export type PermissionMode = "workspace-write" | "danger-full-access";

export type AuditCategory =
  | "activity"
  | "cost"
  | "token"
  | "admin"
  | "executor_change"
  | "handoff"
  | "file_change"
  | "test_run"
  | "error"
  | "security";

export type AuditSeverity = "info" | "warn" | "error" | "critical";

export interface AuditActor {
  type: "user" | "agent" | "system";
  id: string;
  label?: string;
  ip?: string;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  isoDate: string;
  category: AuditCategory;
  severity: AuditSeverity;
  action: string;
  actor: AuditActor;
  missionId?: string;
  paneId?: string;
  taskId?: string;
  details: Record<string, unknown>;
  metadata?: {
    cost?: {
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
      provider?: string;
      model?: string;
    };
    executionTimeMs?: number;
    status?: string;
    [key: string]: unknown;
  };
}

export type DestructiveActionType =
  | "kill_pane"
  | "merge_worktree"
  | "lock_override"
  | "executor_switch"
  | "danger_full_access_opt_in"
  | "delete_resource";

export type ConfirmationStatus = "pending" | "approved" | "rejected" | "expired" | "consumed";

export interface ConfirmationRequest {
  id: string;
  action: DestructiveActionType;
  title: string;
  description: string;
  severity: "warn" | "danger" | "critical";
  target: {
    missionId?: string;
    paneId?: string;
    taskId?: string;
    path?: string;
    oldCli?: string;
    newCli?: string;
    [key: string]: unknown;
  };
  requestedBy: AuditActor;
  createdAt: number;
  expiresAt: number;
  status: ConfirmationStatus;
  resolvedAt?: number;
  resolvedBy?: string;
  reason?: string;
}
