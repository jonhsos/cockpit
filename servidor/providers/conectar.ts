import { execFile } from "node:child_process";
import { config, salvarConfig } from "../config.ts";
import { listarProviders, esquecerCache, type Provider } from "./providers.ts";

/**
 * Conectar um provedor é registrar o comando dele no cockpit.json e conferir
 * que ele responde. Não guardamos credencial: cada CLI já é autenticado por
 * fora, com a assinatura que você paga. O cockpit só sabe chamá-los.
 */

export type Preset = {
  id: string;
  label: string;
  comando: string;
  instalar?: string;
  /** Vazio quando o CLI escolhe o modelo sozinho ou a lista é dinâmica. */
  modelos: string[];
  nota?: string;
};

/**
 * Atalhos para o que é comum. Só preencho o comando de instalação onde tenho
 * certeza; o resto fica em branco para você completar em vez de eu inventar.
 */
export const PRESETS: Preset[] = [
  {
    id: "claude",
    label: "Claude Code",
    comando: "claude",
    instalar: "npm i -g @anthropic-ai/claude-code",
    modelos: ["opus", "sonnet", "haiku"],
    nota: "autentique com `claude` no terminal, uma vez",
  },
  {
    id: "agy",
    label: "Antigravity (Gemini)",
    comando: "agy",
    modelos: [
      "gemini-3.8-flash-high",
      "gemini-3.8-flash-medium",
      "gemini-3.1-pro-high",
      "claude-opus-4-6-thinking",
      "claude-sonnet-4-6",
      "gpt-oss-120b-medium",
    ],
    nota: "rode `agy models` para ver a lista atual da sua conta",
  },
  {
    id: "codex",
    label: "Codex",
    comando: "codex",
    instalar: "npm i -g @openai/codex",
    modelos: [],
    nota: "o Codex escolhe o modelo pela própria configuração",
  },
  {
    id: "kimi",
    label: "Kimi",
    comando: "kimi",
    modelos: [],
    nota: "preencha o comando e os modelos conforme a instalação que você usa",
  },
  {
    id: "opencode",
    label: "OpenCode",
    comando: "opencode",
    modelos: [],
  },
  {
    id: "grok",
    label: "Grok",
    comando: "grok",
    instalar: "curl -sSfL https://x.ai/grok/install.sh | sh",
    modelos: ["grok-4.6", "grok-4.5"],
    nota: "autentique com `grok` no terminal, uma vez",
  },
];

const CORES = ["#e2703a", "#4fb286", "#9d7bd8", "#4a9fd8", "#c9628f", "#5bb8a8", "#d9a441"];

/**
 * Um provedor conectado sem agente não aparece em lugar nenhum — o agente é
 * quem junta CLI, modelo, esforço e papel. Isto cria o mínimo viável para o
 * provedor virar utilizável; o resto você afina no cockpit.json.
 */
export function criarAgente(providerId: string): { id: string; label: string } {
  const spec = config.clis[providerId];
  if (!spec) throw new Error("provedor não registrado");
  if (Object.values(config.agents).some((a) => a.cli === providerId)) {
    throw new Error("já existe um agente usando esse provedor");
  }
  const id = providerId.toLowerCase();
  if (config.agents[id]) throw new Error(`já existe um agente chamado "${id}"`);

  const usadas = new Set(Object.values(config.agents).map((a) => a.cor));
  const cor = CORES.find((x) => !usadas.has(x)) ?? "#7d8894";
  const modelo = config.modelos?.[providerId]?.[0];

  config.agents[id] = {
    label: id.toUpperCase(),
    cor,
    cli: providerId,
    ...(modelo ? { model: modelo } : {}),
    papel: `Você roda pelo CLI ${providerId}. Faça o que for pedido no seu painel.`,
  };
  salvarConfig();
  return { id, label: id.toUpperCase() };
}

export type Conexao = {
  id: string;
  comando: string;
  modelos?: string[];
  args?: string[];
};

export function conectar(c: Conexao): Provider {
  const id = c.id.trim();
  if (!/^[a-z0-9_-]+$/i.test(id)) {
    throw new Error("o nome do provedor aceita só letras, números, hífen e sublinhado");
  }
  if (!c.comando.trim()) throw new Error("informe o comando do CLI");

  config.clis[id] = { command: c.comando.trim(), ...(c.args?.length ? { args: c.args } : {}) };
  config.modelos ??= {};
  if (c.modelos && c.modelos.length > 0) config.modelos[id] = c.modelos;
  salvarConfig();
  esquecerCache();

  const achado = listarProviders().find((p) => p.id === id);
  if (!achado) throw new Error("não consegui reler o provedor recém-salvo");
  return achado;
}

export function desconectar(id: string): void {
  const usados = Object.entries(config.agents).filter(([, a]) => a.cli === id);
  if (usados.length > 0) {
    throw new Error(
      `não dá para desconectar: ${usados.map(([k]) => k).join(", ")} usam esse provedor`,
    );
  }
  delete config.clis[id];
  if (config.modelos) delete config.modelos[id];
  salvarConfig();
  esquecerCache();
}

/** Roda o CLI com --version só para provar que ele responde. */
export function testar(id: string): Promise<{ ok: boolean; saida: string }> {
  const spec = config.clis[id];
  if (!spec) return Promise.reject(new Error("provedor não registrado"));
  return new Promise((resolve) => {
    execFile(
      spec.command,
      ["--version"],
      { timeout: 20_000, windowsHide: true, shell: process.platform === "win32" },
      (err, stdout, stderr) => {
        const saida = (stdout || stderr || "").trim().split("\n")[0] ?? "";
        resolve({ ok: !err, saida: saida || (err ? err.message : "sem resposta") });
      },
    );
  });
}
