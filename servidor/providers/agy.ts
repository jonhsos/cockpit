import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolverExecutavel } from "./providers.ts";

/**
 * A Antigravity ignora --model em sessão interativa e lê o modelo de
 * settings.json. Antes de cada spawn gravamos a preferência no diretório do
 * perfil ativo (JETSKI_APP_DATA_DIR/HOME), para painéis concorrentes não
 * sobrescreverem o modelo uns dos outros.
 */

const SETTINGS = join(homedir(), ".gemini", "antigravity-cli", "settings.json");

let mapa: Map<string, string> | null = null;

/** id do modelo -> nome de exibição, que é o que o settings.json guarda. */
function carregarModelos(): Map<string, string> {
  if (mapa) return mapa;
  mapa = new Map();
  try {
    const executavel = resolverExecutavel("agy");
    if (!executavel) return mapa;
    const saida = execFileSync(executavel, ["models"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    });
    for (const linha of saida.split(/\r?\n/)) {
      const [id, nome] = linha.split("\t");
      if (id && nome) mapa.set(id.trim(), nome.trim());
    }
  } catch {
    // Sem rede ou sem login: seguimos sem trocar o modelo.
  }
  return mapa;
}

const MODELOS_PADRAO: Record<string, string> = {
  "gemini-3.8-flash-high": "Gemini 3.8 Flash (High)",
  "gemini-3.8-flash-medium": "Gemini 3.8 Flash (Medium)",
  "gemini-3.8-flash-low": "Gemini 3.8 Flash (Low)",
  "gemini-3.7-flash-high": "Gemini 3.7 Flash (High)",
  "gemini-3.7-flash-medium": "Gemini 3.7 Flash (Medium)",
  "gemini-3.7-flash-low": "Gemini 3.7 Flash (Low)",
  "gemini-3.6-flash-high": "Gemini 3.6 Flash (High)",
  "gemini-3.6-flash-medium": "Gemini 3.6 Flash (Medium)",
  "gemini-3.6-flash-low": "Gemini 3.6 Flash (Low)",
  "gemini-3.1-pro-high": "Gemini 3.1 Pro (High)",
  "gemini-3.1-pro-low": "Gemini 3.1 Pro (Low)",
  "claude-sonnet-4-6": "Claude Sonnet 4.6 (Thinking)",
  "claude-opus-4-6-thinking": "Claude Opus 4.6 (Thinking)",
  "gpt-oss-120b-medium": "GPT-OSS 120B (Medium)",
};

function resolverCaminhosSettings(targetHome?: string): string[] {
  if (!targetHome) return [SETTINGS];
  const resolved = targetHome
    .replace(/^~(?=$|\/)/, homedir())
    .replace(/^\$HOME(?=$|\/)/, homedir());

  const caminhos: string[] = [];
  if (
    resolved.includes(".gemini") ||
    resolved.includes("antigravity-cli") ||
    resolved.includes("profiles")
  ) {
    caminhos.push(join(resolved, "settings.json"));
    caminhos.push(join(resolved, ".gemini", "antigravity-cli", "settings.json"));
  } else {
    caminhos.push(join(resolved, ".gemini", "antigravity-cli", "settings.json"));
    caminhos.push(join(resolved, "settings.json"));
  }
  return caminhos;
}

export function definirModelo(modelId: string | undefined, targetHome?: string): void {
  if (!modelId) return;
  const nome = carregarModelos().get(modelId) ?? MODELOS_PADRAO[modelId] ?? modelId;
  if (!nome) return;

  const caminhos = resolverCaminhosSettings(targetHome);
  for (const settingsPath of caminhos) {
    let c: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try {
        c = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
      } catch {
        continue; // arquivo do usuário ilegível: não é nosso lugar de reescrever
      }
    }
    if (c.model === nome) continue;
    c.model = nome;
    try {
      mkdirSync(dirname(settingsPath), { recursive: true });
      writeFileSync(settingsPath, JSON.stringify(c, null, 2));
    } catch {
      // Ignora erro de escrita se diretório não for acessível
    }
  }
}
