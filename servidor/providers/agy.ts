import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { definirModelosRuntime } from "../config.ts";
import { resolverExecutavel } from "./providers.ts";

/**
 * A Antigravity ignora --model em sessão interativa e lê o modelo de
 * settings.json. Antes de cada spawn gravamos a preferência no diretório do
 * perfil ativo (JETSKI_APP_DATA_DIR/HOME), para painéis concorrentes não
 * sobrescreverem o modelo uns dos outros.
 */

const SETTINGS = join(homedir(), ".gemini", "antigravity-cli", "settings.json");
const TOKEN_FILE = "antigravity-oauth-token";
const SETTINGS_FILE = "settings.json";

/** Onde o `agy` lê token e settings quando HOME aponta para o perfil isolado. */
export function appDataDirDoAgy(profileDir: string): string {
  return join(profileDir, ".gemini", "antigravity-cli");
}

/**
 * O onboarding grava o OAuth na raiz do perfil. Com HOME=perfil o CLI procura
 * em `$HOME/.gemini/antigravity-cli/`. Sem este espelho o painel abre pedindo
 * login mesmo com a conta autenticada em Ajustes.
 */
export function materializarPerfilAgy(profileDir: string | undefined): void {
  if (!profileDir) return;
  const appData = appDataDirDoAgy(profileDir);
  try {
    mkdirSync(appData, { recursive: true });
  } catch {
    return;
  }
  for (const nome of [TOKEN_FILE, SETTINGS_FILE]) {
    const origem = join(profileDir, nome);
    const destino = join(appData, nome);
    if (!existsSync(origem) || existsSync(destino)) continue;
    try {
      copyFileSync(origem, destino);
    } catch {
      // perfil inacessível: o spawn segue; o CLI vai pedir login
    }
  }
}

let mapa: Map<string, string> | null = null;

/** id do modelo -> nome de exibição, que é o que o settings.json guarda. */
export function carregarModelos(forcar = false): Map<string, string> {
  if (mapa && !forcar) return mapa;
  mapa = new Map();
  try {
    const executavel = resolverExecutavel("agy");
    if (!executavel) return mapa;
    const saida = execFileSync(executavel, ["models"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
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

export const MODELOS_PADRAO: Record<string, string> = {
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
  // Aliases comuns para conveniência
  "gemini-3.7-high": "Gemini 3.7 Flash (High)",
  "gemini-3.7": "Gemini 3.7 Flash (High)",
  "gemini-3.8-high": "Gemini 3.8 Flash (High)",
  "gemini-3.8": "Gemini 3.8 Flash (High)",
  "gemini-3.1-high": "Gemini 3.1 Pro (High)",
  "gemini-3.1": "Gemini 3.1 Pro (High)",
};

export function obterMapaModelosAgy(): Record<string, string> {
  const map = carregarModelos();
  const res: Record<string, string> = { ...MODELOS_PADRAO };
  for (const [id, nome] of map.entries()) {
    res[id] = nome;
  }
  return res;
}

export function modelosAgy(): string[] {
  const map = carregarModelos();
  if (map.size > 0) {
    return Array.from(map.keys());
  }
  return [
    "gemini-3.8-flash-high",
    "gemini-3.8-flash-medium",
    "gemini-3.8-flash-low",
    "gemini-3.7-flash-high",
    "gemini-3.7-flash-medium",
    "gemini-3.7-flash-low",
    "gemini-3.6-flash-high",
    "gemini-3.6-flash-medium",
    "gemini-3.6-flash-low",
    "gemini-3.1-pro-high",
    "gemini-3.1-pro-low",
    "claude-sonnet-4-6",
    "claude-opus-4-6-thinking",
    "gpt-oss-120b-medium",
  ];
}

export function sincronizarModelosAgy(): string[] {
  const modelos = modelosAgy();
  definirModelosRuntime("agy", modelos);
  return modelos;
}

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
  const mapaCarregado = carregarModelos();
  let nome = MODELOS_PADRAO[modelId] ?? mapaCarregado.get(modelId);
  if (!nome) {
    const todosNomes = new Set([...Object.values(MODELOS_PADRAO), ...mapaCarregado.values()]);
    if (todosNomes.has(modelId)) {
      nome = modelId;
    } else {
      const match = Array.from(todosNomes).find((n) => n.toLowerCase() === modelId.toLowerCase());
      nome = match ?? modelId;
    }
  }
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
