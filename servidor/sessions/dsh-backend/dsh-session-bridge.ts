/**
 * PaneState ↔ sessão DSH.
 * sessionId = paneId (SDK sem list/resume/close de primeira classe).
 * Eventos → texto de transcript para o xterm (fase 1).
 */

export function sessionIdForPane(paneId: string): string {
  return paneId;
}

/** Extrai texto útil de um write do Cockpit (bracketed paste ou teclado). */
export function extractPromptText(data: string): string {
  const bracket = data.match(/\x1b\[200~([\s\S]*?)\x1b\[201~/);
  if (bracket) return bracket[1].replace(/\r/g, "").trimEnd();
  return data
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\r/g, "")
    .trimEnd();
}

type Contentish = { type?: string; text?: string; content?: unknown };

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as Contentish[]) {
    if (!block || typeof block !== "object") continue;
    if (typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("");
}

/**
 * Projeta uma notificação SDK em linha de transcript, ou null se irrelevante.
 */
export function notificationToTranscript(method: string, params: Record<string, unknown>): string | null {
  if (method === "session.event") {
    const event = params.event as Record<string, unknown> | undefined;
    if (!event || typeof event !== "object") return null;
    const type = String(event.type ?? "");
    if (type === "message" || type === "assistant_message" || type === "text") {
      const text =
        textFromContent(event.content) ||
        (typeof event.text === "string" ? event.text : "") ||
        textFromContent((event.message as Contentish | undefined)?.content);
      if (text) return text;
    }
    if (type === "error") {
      const msg = typeof event.message === "string" ? event.message : JSON.stringify(event);
      return `\r\n[dsh:error] ${msg}\r\n`;
    }
    return null;
  }
  if (method === "agent.idle" || method.endsWith(".idle")) {
    return null;
  }
  return null;
}

/** Monta contentBlocks de texto para session/prompt. */
export function textPromptBlocks(text: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text }];
}
