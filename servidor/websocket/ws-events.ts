import type { PaneState } from "../sessions/pane-state.ts";
import type { Usage } from "../usage.ts";
import type { Task, TaskStatus, TaskEvidence } from "../tasks/task-types.ts";
import type { MailboxMessage } from "../connections/connection-types.ts";
import type { RoleContractInput } from "../orchestration/roles.ts";

export type ClientMessage =
  | { type: "spawn"; agent: string; missionId: string; tipo?: string; tarefa?: string; cli?: string; model?: string | null; effort?: string | null; role?: string; roleDefinition?: RoleContractInput; runner?: string; maestro?: boolean; preferredAccountId?: string; accountPinned?: boolean; backend?: "pty" | "dsh" }
  | { type: "input"; paneId: string; data: string }
  | { type: "prompt"; paneId: string; prompt: string }
  | { type: "resize"; paneId: string; cols: number; rows: number }
  | { type: "kill"; paneId: string }
  | { type: "replay"; paneId: string }
  | { type: "attach"; paneId: string };

export type ServerMessage =
  | { type: "error"; message: string }
  | { type: "maestro"; [key: string]: unknown }
  | { type: "panes"; panes: PaneState[] }
  | { type: "spawned"; pane: PaneState }
  | { type: "output"; paneId: string; data: string }
  | { type: "exit"; paneId: string; code: number }
  | { type: "pulse"; pulsos: Array<{ paneId: string; status: string; atividade: number[]; blockedReason?: string | null }> }
  | { type: "usage"; usos: Array<{ paneId: string; usage: Usage }> }
  | { type: "memoria"; projectId: string }
  | { type: "fs-change"; path: string; base: string }
  | { type: "limit"; paneId: string; cli: string; state: string; detail: string }
  | { type: "replay"; paneId: string; scrollback: string }
  | { type: "mission:mode_changed"; missionId: string; modo: string }
  | { type: "mission:emergency_stop"; missionId: string; halted: boolean }
  | { type: "mission:resumed"; missionId: string; halted: boolean }
  | { type: "inbox:message"; targetPane: string; message: MailboxMessage }
  | { type: "task:created"; task: Task }
  | { type: "task:updated"; task: Task }
  | { type: "task:status_changed"; taskId: string; status: TaskStatus }
  | { type: "task:deleted"; taskId: string }
  | { type: "task:assigned"; taskId: string; paneId: string | null; responsavel?: string; papel?: string }
  | { type: "task:evidence_added"; taskId: string; evidence: TaskEvidence }
  | { type: "fs:collision_warning"; [key: string]: unknown };
