import type { WebSocket } from "ws";
import type { ClientManager } from "./client-manager.ts";
import type { TerminalHandler } from "./terminal-handler.ts";
import type { ClientMessage } from "./ws-events.ts";
import type { WsServerContext } from "./ws-server.ts";
import type { WsValidationResult } from "./ws-types.ts";

export const MAX_WS_PAYLOAD_BYTES = 1024 * 1024; // 1 MB

const FORBIDDEN_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

/** Detects prototype pollution keys in object hierarchies */
export function hasPrototypePollution(obj: unknown, depth = 0): boolean {
  if (!obj || typeof obj !== "object" || depth > 5) return false;
  if (Array.isArray(obj)) {
    return obj.some((item) => hasPrototypePollution(item, depth + 1));
  }
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    return true;
  }
  const keys = Object.getOwnPropertyNames(obj);
  for (const key of keys) {
    if (FORBIDDEN_PROPERTIES.has(key)) return true;
    try {
      const val = (obj as Record<string, unknown>)[key];
      if (val && typeof val === "object" && hasPrototypePollution(val, depth + 1)) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

/** Validates and parses a raw WebSocket frame into a strictly typed ClientMessage */
export function validateAndParseClientMessage(raw: unknown): WsValidationResult<ClientMessage> {
  // 1. Buffer / string size enforcement
  if (Buffer.isBuffer(raw)) {
    if (raw.length > MAX_WS_PAYLOAD_BYTES) {
      return { ok: false, error: `Payload excede o tamanho máximo permitido (${MAX_WS_PAYLOAD_BYTES} bytes)` };
    }
  } else if (typeof raw === "string") {
    if (Buffer.byteLength(raw, "utf8") > MAX_WS_PAYLOAD_BYTES) {
      return { ok: false, error: `Payload excede o tamanho máximo permitido (${MAX_WS_PAYLOAD_BYTES} bytes)` };
    }
  }

  // 2. Decode raw data into string
  let text: string;
  try {
    if (Buffer.isBuffer(raw)) {
      text = raw.toString("utf8");
    } else if (typeof raw === "string") {
      text = raw;
    } else if (raw instanceof ArrayBuffer) {
      text = Buffer.from(raw).toString("utf8");
    } else if (Array.isArray(raw)) {
      text = Buffer.concat(raw).toString("utf8");
    } else {
      text = String(raw);
    }
  } catch {
    return { ok: false, error: "Falha ao decodificar buffer da mensagem WebSocket" };
  }

  // 3. Fast prototype pollution detection in raw text
  if (/"(?:__proto__|constructor|prototype)"\s*:/i.test(text)) {
    return { ok: false, error: "Payload contém propriedades proibidas (prototype pollution detectado)" };
  }

  // 4. JSON parsing
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON inválido ou malformado" };
  }

  // 5. Verify root object
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Mensagem deve ser um objeto JSON não-nulo" };
  }

  // 6. Deep prototype pollution verification
  if (hasPrototypePollution(parsed)) {
    return { ok: false, error: "Payload contém propriedades proibidas (prototype pollution detectado)" };
  }

  const msg = parsed as Record<string, unknown>;

  // 7. Verify message 'type' field
  if (typeof msg.type !== "string" || !msg.type.trim()) {
    return { ok: false, error: "Campo 'type' obrigatório e deve ser uma string não-vazia" };
  }

  const type = msg.type.trim();

  // 8. Field-level type verification per message type
  switch (type) {
    case "spawn": {
      if (typeof msg.agent !== "string" || !msg.agent.trim()) {
        return { ok: false, error: "Campo 'agent' obrigatório e deve ser string não-vazia para spawn" };
      }
      if (typeof msg.missionId !== "string" || !msg.missionId.trim()) {
        return { ok: false, error: "Campo 'missionId' obrigatório e deve ser string não-vazia para spawn" };
      }
      if (msg.tipo !== undefined && typeof msg.tipo !== "string") {
        return { ok: false, error: "Campo 'tipo' para spawn deve ser string quando fornecido" };
      }
      if (msg.tarefa !== undefined && typeof msg.tarefa !== "string") {
        return { ok: false, error: "Campo 'tarefa' para spawn deve ser string quando fornecido" };
      }
      if (msg.cli !== undefined && typeof msg.cli !== "string") {
        return { ok: false, error: "Campo 'cli' para spawn deve ser string quando fornecido" };
      }
      if (msg.maestro !== undefined && typeof msg.maestro !== "boolean") {
        return { ok: false, error: "Campo 'maestro' para spawn deve ser boolean quando fornecido" };
      }
      return {
        ok: true,
        message: {
          type: "spawn",
          agent: msg.agent.trim(),
          missionId: msg.missionId.trim(),
          tipo: typeof msg.tipo === "string" ? msg.tipo : undefined,
          tarefa: typeof msg.tarefa === "string" ? msg.tarefa : undefined,
          cli: typeof msg.cli === "string" ? msg.cli : undefined,
          model: typeof msg.model === "string" ? msg.model : null,
          effort: typeof msg.effort === "string" ? msg.effort : null,
          role: typeof msg.role === "string" ? msg.role : undefined,
          runner: typeof msg.runner === "string" ? msg.runner : undefined,
          maestro: typeof msg.maestro === "boolean" ? msg.maestro : undefined,
        },
      };
    }

    case "input": {
      if (typeof msg.paneId !== "string" || !msg.paneId.trim()) {
        return { ok: false, error: "Campo 'paneId' obrigatório e deve ser string não-vazia para input" };
      }
      if (typeof msg.data !== "string") {
        return { ok: false, error: "Campo 'data' obrigatório e deve ser string para input" };
      }
      return {
        ok: true,
        message: {
          type: "input",
          paneId: msg.paneId.trim(),
          data: msg.data,
        },
      };
    }

    case "resize": {
      if (typeof msg.paneId !== "string" || !msg.paneId.trim()) {
        return { ok: false, error: "Campo 'paneId' obrigatório e deve ser string não-vazia para resize" };
      }
      const cols = Number(msg.cols);
      const rows = Number(msg.rows);
      if (!Number.isInteger(cols) || cols <= 0 || cols > 1000) {
        return { ok: false, error: "Campo 'cols' deve ser um número inteiro positivo entre 1 e 1000" };
      }
      if (!Number.isInteger(rows) || rows <= 0 || rows > 1000) {
        return { ok: false, error: "Campo 'rows' deve ser um número inteiro positivo entre 1 e 1000" };
      }
      return {
        ok: true,
        message: {
          type: "resize",
          paneId: msg.paneId.trim(),
          cols,
          rows,
        },
      };
    }

    case "kill": {
      if (typeof msg.paneId !== "string" || !msg.paneId.trim()) {
        return { ok: false, error: "Campo 'paneId' obrigatório e deve ser string não-vazia para kill" };
      }
      return {
        ok: true,
        message: {
          type: "kill",
          paneId: msg.paneId.trim(),
        },
      };
    }

    case "replay":
    case "attach": {
      if (typeof msg.paneId !== "string" || !msg.paneId.trim()) {
        return { ok: false, error: `Campo 'paneId' obrigatório e deve ser string não-vazia para ${type}` };
      }
      return {
        ok: true,
        message: {
          type,
          paneId: msg.paneId.trim(),
        },
      };
    }

    default:
      return { ok: false, error: `Tipo de mensagem desconhecido ou não suportado: "${type}"` };
  }
}

export class WsDispatcher {
  private clientManager: ClientManager;
  private terminalHandler: TerminalHandler;
  private context: WsServerContext;

  constructor(
    clientManager: ClientManager,
    terminalHandler: TerminalHandler,
    context: WsServerContext,
  ) {
    this.clientManager = clientManager;
    this.terminalHandler = terminalHandler;
    this.context = context;
  }

  public async dispatch(raw: unknown, ws: WebSocket): Promise<boolean> {
    const result = validateAndParseClientMessage(raw);

    if (!result.ok || !result.message) {
      const errorMsg = result.error ?? "Mensagem inválida";
      this.clientManager.send(ws, { type: "error", message: errorMsg });
      return false;
    }

    const msg = result.message;

    try {
      switch (msg.type) {
        case "spawn":
          try {
            this.context.abrirPainel(
              msg.agent,
              msg.missionId,
              msg.tarefa,
              {
                tipo: msg.tipo,
                invoke: {
                  cli: msg.cli,
                  model: msg.model || undefined,
                  effort: msg.effort || undefined,
                },
                runner: msg.runner,
              },
              [],
              msg.maestro,
            );
          } catch (err) {
            this.clientManager.send(ws, {
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            });
          }
          break;

        case "input":
          this.terminalHandler.handleInput(msg.paneId, msg.data);
          break;

        case "resize":
          this.terminalHandler.handleResize(msg.paneId, msg.cols, msg.rows);
          break;

        case "kill":
          this.terminalHandler.handleKill(msg.paneId);
          break;

        case "replay":
        case "attach":
          await this.terminalHandler.handleAttachOrReplay(ws, msg.paneId);
          break;
      }
      return true;
    } catch (err) {
      this.clientManager.send(ws, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}
