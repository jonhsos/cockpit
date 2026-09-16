import type { TaskEvidence } from "../tasks/task-types.ts";
import type { Connection, ConnectionStatus, Handoff, HandoffStatus } from "../persistence/types.ts";
import type { PaneStatus } from "../sessions/pane-state.ts";

export type { Connection, ConnectionStatus, Handoff, HandoffStatus };

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

export interface PaneSummary {
  id: string;
  label: string;
  role: string;
  runner: string;
  model: string | null;
  status: PaneStatus;
  activeTaskId?: string | null;
  cwd: string;
  missionId: string | null;
  inboxCount?: number;
  isBusy?: boolean;
  canAcceptTask?: boolean;
}
