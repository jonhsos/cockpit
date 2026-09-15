export * from "./ws-events.ts";

export interface WsErrorResponse {
  type: "error";
  message: string;
}

export interface WsValidationResult<T = unknown> {
  ok: boolean;
  message?: T;
  error?: string;
}
