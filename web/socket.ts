import type {
  PaneState,
  Usage,
  Task,
  TaskStatus,
  TaskEvidence,
  MailboxMessage,
} from "./api.ts";

export type ServerMessage =
  | { type: "error"; message: string }
  | { type: "maestro"; [key: string]: unknown }
  | { type: "panes"; panes: PaneState[] }
  | { type: "spawned"; pane: PaneState }
  | { type: "output"; paneId: string; data: string }
  | { type: "exit"; paneId: string; code: number }
  | { type: "pulse"; pulsos: { paneId: string; status: PaneState["status"]; atividade: number[]; blockedReason?: string | null }[] }
  | { type: "usage"; usos: { paneId: string; usage: Usage }[] }
  | { type: "memoria"; projectId: string }
  | { type: "fs-change"; path: string; base: string }
  | { type: "task:created"; task: Task }
  | { type: "task:updated"; task: Task }
  | { type: "task:status_changed"; taskId: string; status: TaskStatus }
  | { type: "task:deleted"; taskId: string; missionId?: string }
  | { type: "task:assigned"; taskId: string; paneId: string | null; responsavel?: string; papel?: string }
  | { type: "task:evidence_added"; taskId: string; evidence: TaskEvidence }
  | { type: "fs:collision_warning"; [key: string]: unknown }
  | { type: "inbox:message"; targetPane: string; message: MailboxMessage }
  | { type: "mission:mode_changed"; missionId: string; modo: string }
  | { type: "mission:updated"; missionId: string; nome?: string }
  | { type: "connection:updated"; missionId?: string }
  | { type: "pool:updated"; [key: string]: unknown }
  | { type: "pool:rotated"; cli: string; from: string; to: string; paneId: string; detail?: string }
  | { type: "maestro:reactivated"; missionId: string; especialistas: string };

type OutputHandler = (data: string) => void;

export type ConnectionState = "connecting" | "connected" | "disconnected";

let connection: ConnectionState = "connecting";
const connectionListeners = new Set<() => void>();
const queue: string[] = [];
const outputs = new Map<string, OutputHandler>();
// A saída pode chegar antes do xterm do painel ter montado.
const buffered = new Map<string, string[]>();
const listeners = new Set<(msg: ServerMessage) => void>();
const reconectados = new Set<() => void>();

function updateConnection(state: ConnectionState) {
  if (connection === state) return;
  connection = state;
  for (const listener of connectionListeners) listener();
}

export const getConnection = () => connection;

export function subscribeConnection(listener: () => void) {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

/**
 * Chamado depois de cada reconexão bem-sucedida. Quem escuta recarrega o
 * estado: os painéis podem ter nascido ou morrido enquanto estávamos fora.
 */
export function onReconnect(listener: () => void): () => void {
  reconectados.add(listener);
  return () => {
    reconectados.delete(listener);
  };
}

/**
 * A conexão se reata sozinha.
 *
 * O servidor reinicia toda vez que o cockpit é atualizado, e antes disso era
 * preciso recarregar a página na mão — o app ficava vivo, mudo e sem saber.
 * A espera cresce até 5s para não martelar uma porta que não vai abrir, e
 * volta ao mínimo assim que conecta.
 */
const ESPERA_MIN = 400;
const ESPERA_MAX = 5000;

let ws: WebSocket;
let espera = ESPERA_MIN;
let tentativa: ReturnType<typeof setTimeout> | null = null;
let jaConectou = false;

function conectar(): void {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`);

  ws.addEventListener("open", () => {
    updateConnection("connected");
    espera = ESPERA_MIN;
    for (const raw of queue.splice(0)) ws.send(raw);
    // Na primeira conexão o App já carrega tudo sozinho; só avisamos nas
    // seguintes, que são de fato uma volta.
    if (jaConectou) for (const listener of reconectados) listener();
    jaConectou = true;
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMessage;
    if (msg.type === "output") {
      const handler = outputs.get(msg.paneId);
      if (handler) handler(msg.data);
      else {
        const buf = buffered.get(msg.paneId) ?? [];
        buf.push(msg.data);
        buffered.set(msg.paneId, buf);
      }
      return;
    }
    for (const listener of listeners) listener(msg);
  });

  const caiu = () => {
    updateConnection("disconnected");
    if (tentativa !== null) return;
    tentativa = setTimeout(() => {
      tentativa = null;
      updateConnection("connecting");
      espera = Math.min(espera * 2, ESPERA_MAX);
      conectar();
    }, espera);
  };

  ws.addEventListener("close", caiu);
  ws.addEventListener("error", caiu);
}

conectar();

// Voltar para a aba é o momento em que você repara que caiu: tenta na hora.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && connection === "disconnected" && tentativa !== null) {
    clearTimeout(tentativa);
    tentativa = null;
    espera = ESPERA_MIN;
    updateConnection("connecting");
    conectar();
  }
});

export function send(msg: unknown): void {
  const raw = JSON.stringify(msg);
  if (ws.readyState === WebSocket.OPEN) ws.send(raw);
  else queue.push(raw);
}

export function onMessage(listener: (msg: ServerMessage) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onOutput(paneId: string, handler: OutputHandler): () => void {
  outputs.set(paneId, handler);
  for (const data of buffered.get(paneId) ?? []) handler(data);
  buffered.delete(paneId);
  return () => outputs.delete(paneId);
}
