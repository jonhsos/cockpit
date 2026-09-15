/**
 * Secret & API Key Sanitizer (R11)
 * Redacts Anthropic, OpenAI, OpenRouter, Google, Bearer tokens,
 * and dynamically registered vault credentials.
 */

export const REDACTED_MARKER = "[REDACTED_API_KEY]";

export const SECRET_PATTERNS = {
  anthropic: /\bsk-ant-(?:api\d{2}-|admin\d{2}-)?[A-Za-z0-9_\-]{20,}\b/g,
  openai: /\bsk-(?:proj-|admin-|none-)?[A-Za-z0-9_\-]{20,}\b/g,
  openrouter: /\bsk-or-v1-[a-fA-F0-9]{32,}\b/g,
  google: /\bAIza[0-9A-Za-z_\-]{35}\b/g,
  bearer: /(?<=[Bb][Ee][Aa][Rr][Ee][Rr]\s+)[A-Za-z0-9._~+\-/]{20,}={0,2}/g,
  keyValueSecret: /(?:api[_-]?key|secret|password|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?([a-zA-Z0-9_\-.~+/]{16,})["']?/gi,
};

export class SecretRegistry {
  private static literalSecrets = new Set<string>();

  public static register(secret: string | null | undefined): void {
    if (typeof secret === "string" && secret.trim().length >= 6) {
      this.literalSecrets.add(secret.trim());
    }
  }

  public static unregister(secret: string): void {
    this.literalSecrets.delete(secret.trim());
  }

  public static getAll(): Set<string> {
    return new Set(this.literalSecrets);
  }

  public static clear(): void {
    this.literalSecrets.clear();
  }
}

/**
 * Sanitize a single string in-memory
 */
export function sanitize(text: string): string {
  if (!text || typeof text !== "string") return text;

  let sanitized = text;

  // 1. Anthropic API keys
  sanitized = sanitized.replace(SECRET_PATTERNS.anthropic, REDACTED_MARKER);

  // 2. OpenRouter keys (before OpenAI, since it starts with sk-or-)
  sanitized = sanitized.replace(SECRET_PATTERNS.openrouter, REDACTED_MARKER);

  // 3. OpenAI keys
  sanitized = sanitized.replace(SECRET_PATTERNS.openai, REDACTED_MARKER);

  // 4. Google API keys
  sanitized = sanitized.replace(SECRET_PATTERNS.google, REDACTED_MARKER);

  // 5. Bearer tokens
  sanitized = sanitized.replace(SECRET_PATTERNS.bearer, REDACTED_MARKER);

  // 6. Generic key-value secrets (api_key=..., password=..., secret=...)
  sanitized = sanitized.replace(
    SECRET_PATTERNS.keyValueSecret,
    (match, val) => {
      const idx = match.lastIndexOf(val);
      if (idx === -1) return match;
      return match.slice(0, idx) + REDACTED_MARKER + match.slice(idx + val.length);
    }
  );

  // 7. Registered literal secrets from vault or env
  for (const literal of SecretRegistry.getAll()) {
    if (sanitized.includes(literal)) {
      sanitized = sanitized.split(literal).join(REDACTED_MARKER);
    }
  }

  return sanitized;
}

/**
 * Recursively sanitize strings inside arrays, objects, and audit records
 */
export function sanitizeObject<T>(val: T): T {
  if (val === null || val === undefined) return val;

  if (typeof val === "string") {
    return sanitize(val) as T;
  }

  if (Array.isArray(val)) {
    return val.map((item) => sanitizeObject(item)) as unknown as T;
  }

  if (typeof val === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
      result[key] = sanitizeObject(value);
    }
    return result as T;
  }

  return val;
}

/**
 * Stateful stream sanitizer for continuous PTY and WebSocket output.
 * Accumulates trailing un-delimited word/token characters into the carry buffer (up to 128 chars).
 * When new chunks arrive, prepends carry buffer, runs full regex redaction, flushes confirmed
 * text up to the last word/whitespace boundary, and holds trailing word fragment.
 */
export class StreamSanitizer {
  private carryBuffer: string = "";
  private readonly maxPrefixLen: number;

  constructor(maxPrefixLen = 128) {
    this.maxPrefixLen = maxPrefixLen;
  }

  public process(chunk: string): string {
    const combined = this.carryBuffer + chunk;
    if (!combined) {
      this.carryBuffer = "";
      return "";
    }

    // 1. Run full regex redaction on combined content
    const sanitized = sanitize(combined);

    // 2. Identify trailing partial secret / un-delimited token characters
    let splitIndex = -1;

    // 1. Partial Anthropic, OpenAI, OpenRouter prefix (e.g. "s", "sk", "sk-", "sk-ant-...")
    const skMatch = /(?:^|[\s=;,:])(s(?:k(?:-(?:[A-Za-z0-9_\-]*)?)?)?)$/i.exec(sanitized);
    if (skMatch && skMatch[1]) {
      const matchStart = sanitized.length - skMatch[1].length;
      const candidateLen = skMatch[1].length;
      if (candidateLen > 0 && candidateLen <= this.maxPrefixLen) {
        splitIndex = matchStart;
      }
    }

    // 2. Partial Google Gemini prefix (e.g. "A", "AI", "AIz", "AIza...")
    if (splitIndex === -1) {
      const googleMatch = /(?:^|[\s=;,:])(A(?:I(?:z(?:a[0-9A-Za-z_\-]*)?)?)?)$/.exec(sanitized);
      if (googleMatch && googleMatch[1]) {
        const matchStart = sanitized.length - googleMatch[1].length;
        const candidateLen = googleMatch[1].length;
        if (candidateLen > 0 && candidateLen <= this.maxPrefixLen) {
          splitIndex = matchStart;
        }
      }
    }

    // 3. Partial Bearer prefix (e.g. "B", "Be", "Bearer", "Bearer ", "Bearer eyJ...")
    if (splitIndex === -1) {
      const bearerMatch = /(?:^|[\s=;,:])([Bb](?:[Ee](?:[Aa](?:[Rr](?:[Ee](?:[Rr](?:\s+[A-Za-z0-9._~+\-/=]*)?)?)?)?)?)?)$/.exec(sanitized);
      if (bearerMatch && bearerMatch[1]) {
        const matchStart = sanitized.length - bearerMatch[1].length;
        const candidateLen = bearerMatch[1].length;
        if (candidateLen > 0 && candidateLen <= this.maxPrefixLen) {
          splitIndex = matchStart;
        }
      }
    }

    // 4. Partial key-value prefix (e.g. api_key=..., secret=...)
    if (splitIndex === -1) {
      const kvMatch = /(?:api[_-]?key|secret|password|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9_\-.~+/=]*$/i.exec(sanitized);
      if (kvMatch && kvMatch.index !== undefined) {
        const candidateLen = sanitized.length - kvMatch.index;
        if (candidateLen > 0 && candidateLen <= this.maxPrefixLen) {
          splitIndex = kvMatch.index;
        }
      }
    }

    // 5. Registered literal secrets prefix down to length 1
    if (splitIndex === -1) {
      for (const literal of SecretRegistry.getAll()) {
        const checkLen = Math.min(literal.length - 1, this.maxPrefixLen);
        for (let len = checkLen; len >= 1; len--) {
          const prefix = literal.slice(0, len);
          if (sanitized.endsWith(prefix)) {
            splitIndex = sanitized.length - len;
            break;
          }
        }
        if (splitIndex !== -1) break;
      }
    }

    if (splitIndex !== -1) {
      const safeChunk = sanitized.slice(0, splitIndex);
      this.carryBuffer = sanitized.slice(splitIndex);
      return safeChunk;
    }

    this.carryBuffer = "";
    return sanitized;
  }

  public flush(): string {
    const remaining = this.carryBuffer;
    this.carryBuffer = "";
    return sanitize(remaining);
  }

  public reset(): void {
    this.carryBuffer = "";
  }
}
