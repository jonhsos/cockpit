import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type CodexGatewayConfig = {
  provider: string;
  model?: string;
  baseUrl: string;
  credentialEnv: string;
  api: "openai-responses" | "openai-completions";
};

const SAFE_ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

function unquoteToml(value: string): string | undefined {
  const clean = value.trim();
  if (clean.startsWith('"') && clean.endsWith('"')) {
    try {
      const parsed = JSON.parse(clean);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (clean.startsWith("'") && clean.endsWith("'")) return clean.slice(1, -1);
  return undefined;
}

function stripTomlComment(line: string): string {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"' && char === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && !escaped) {
      quote = quote === char ? null : quote ?? char;
    } else if (char === "#" && quote === null) {
      return line.slice(0, index);
    }
    escaped = false;
  }
  return line;
}

export function readCodexGatewayConfig(codexHome: string): CodexGatewayConfig | null {
  const path = join(resolve(codexHome), "config.toml");
  if (!existsSync(path)) return null;

  const root = new Map<string, string>();
  const providers = new Map<string, Map<string, string>>();
  let section = "";
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]!.trim();
      continue;
    }
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!assignment) continue;
    const value = unquoteToml(assignment[2]!);
    if (value === undefined) continue;
    if (!section) {
      root.set(assignment[1]!, value);
      continue;
    }
    const providerMatch = /^model_providers\.([A-Za-z0-9_-]+)$/.exec(section);
    if (!providerMatch) continue;
    const provider = providerMatch[1]!;
    const values = providers.get(provider) ?? new Map<string, string>();
    values.set(assignment[1]!, value);
    providers.set(provider, values);
  }

  const provider = root.get("model_provider");
  if (!provider) return null;
  const values = providers.get(provider);
  const baseUrlRaw = values?.get("base_url");
  const credentialEnv = values?.get("env_key");
  const wireApi = values?.get("wire_api");
  if (!baseUrlRaw || !credentialEnv || !wireApi) return null;
  if (!SAFE_ENV_NAME.test(credentialEnv)) throw new Error(`env_key inválida no Codex: ${credentialEnv}`);

  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlRaw);
  } catch {
    throw new Error(`base_url inválida no Codex: ${baseUrlRaw}`);
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error("base_url do Codex não pode conter credenciais embutidas");
  }
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname);
  if (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && loopback)) {
    throw new Error("base_url do Codex deve usar HTTPS (HTTP é permitido apenas em loopback)");
  }

  const api = wireApi === "responses"
    ? "openai-responses"
    : wireApi === "chat" || wireApi === "completions"
    ? "openai-completions"
    : null;
  if (!api) throw new Error(`wire_api do Codex não suportada pelo DSH: ${wireApi}`);

  return {
    provider,
    model: root.get("model"),
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    credentialEnv,
    api,
  };
}
