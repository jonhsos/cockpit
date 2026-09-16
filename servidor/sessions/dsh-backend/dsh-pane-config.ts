/**
 * Config por pane para workers DSH (KD-C + KD-omniroute).
 * Não hardcodar nome de modelo — só `spec.model` / escolha do usuário.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../../config.ts";
import { readCodexGatewayConfig, type CodexGatewayConfig } from "../../providers/codex-config.ts";
import { dshApiDoCli } from "../../providers/dsh-api.ts";

export type PaneDshRoute = {
  /** cli do pane: codex | claude (familia). */
  cli: string;
  model?: string | null;
  /** CODEX_HOME efetivo (pool ou clis.codex.env). */
  codexHome?: string | null;
  autoAprovar: boolean;
  sandbox?: string | null;
};

export type PaneDshRuntimeConfig = {
  patchPath: string;
  provider: string;
  model: string;
  credentialEnv: string;
};

const DSH_GATEWAY_PROVIDER = "cockpit-codex-gateway";

function resolveCodexGateway(codexHome?: string | null): CodexGatewayConfig {
  const configuredHome = resolveCodexHome(config.clis.codex?.env ?? {});
  const candidates = [codexHome, configuredHome].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  );
  for (const candidate of candidates) {
    const gateway = readCodexGatewayConfig(candidate);
    if (gateway) return gateway;
  }
  throw new Error(
    "DSH requer um gateway OpenAI-compatible no config.toml do CODEX_HOME (model_provider, base_url, env_key e wire_api)",
  );
}

/**
 * Mapeia sandbox/autoAprovar do Cockpit → permissionMode do subagent.
 * Escolha documentada: workspace-write + autoAprovar → `never` (Codex) /
 * `dontAsk` (Claude) — unattended mais próximo sem bypass total.
 */
export function permissionModeFor(route: PaneDshRoute): string {
  const sandbox = route.sandbox ?? "workspace-write";
  const familia = config.clis[route.cli]?.familia ?? route.cli;

  if (!route.autoAprovar) {
    return familia === "claude" ? "dontAsk" : "never";
  }
  if (sandbox === "danger-full-access") {
    return familia === "claude"
      ? "bypassPermissions"
      : "dangerously-bypass-approvals-and-sandbox";
  }
  // autoAprovar + workspace-write (ou default)
  return familia === "claude" ? "dontAsk" : "never";
}

export function resolveCodexHome(cliEnv: Record<string, string>): string | undefined {
  const raw = cliEnv.CODEX_HOME;
  return raw && raw.trim() ? raw.trim() : undefined;
}

/**
 * Gera patch Cordis temporário por pane: provider + tool já no profile;
 * aqui só overlay de env/permissionMode/model no provider.
 */
export function writePaneCordisPatch(route: PaneDshRoute): string | null {
  const familia = config.clis[route.cli]?.familia ?? route.cli;
  const isCodex = familia === "codex";
  const isClaude = familia === "claude";
  if (!isCodex && !isClaude) return null;

  const providerId = isCodex ? "subagent-codex" : "subagent-claude-code";
  const providerName = isCodex ? "@deepseek-ai/dsh-subagent-codex" : "@deepseek-ai/dsh-subagent-claude-code";
  const mode = permissionModeFor(route);

  const cfg: Record<string, unknown> = {
    permissionMode: mode,
  };
  if (route.model && route.model.trim()) {
    cfg.model = route.model.trim();
  }
  if (isCodex && route.codexHome) {
    cfg.env = { CODEX_HOME: route.codexHome };
  }

  const yaml = [
    `# Overlay por pane Cockpit — gerado; não editar.`,
    `- id: ${providerId}`,
    `  name: ${JSON.stringify(providerName)}`,
    `  config:`,
    `    permissionMode: ${JSON.stringify(mode)}`,
  ];
  if (cfg.model) {
    yaml.push(`    model: ${JSON.stringify(cfg.model)}`);
  }
  if (isCodex && route.codexHome) {
    yaml.push(`    env:`);
    yaml.push(`      CODEX_HOME: ${JSON.stringify(route.codexHome)}`);
  }
  yaml.push("");

  const dir = mkdtempSync(join(tmpdir(), "cockpit-dsh-pane-"));
  const path = join(dir, "pane.cordis.yml");
  writeFileSync(path, yaml.join("\n"), "utf8");
  return path;
}

/**
 * Configura o LLM principal do DSH pela API escolhida no Cockpit. Sem uma API
 * direta, preserva o gateway configurado para o Codex como compatibilidade.
 */
export function createPaneDshRuntimeConfig(route: PaneDshRoute): PaneDshRuntimeConfig | null {
  const familia = config.clis[route.cli]?.familia ?? route.cli;
  const isCodex = familia === "codex";
  const isClaude = familia === "claude";
  if (!isCodex && !isClaude) return null;

  const directApi = dshApiDoCli(route.cli);
  const gateway = directApi ? null : resolveCodexGateway(route.codexHome);
  const model = route.model?.trim() || gateway?.model?.trim();
  if (!model) {
    throw new Error("DSH requer um modelo explícito no painel ou no config.toml do Codex");
  }
  const patchPath = writePaneCordisPatch(route);
  if (!patchPath) return null;

  const deepseekOfficial = directApi?.provider === "deepseek-official" && !directApi.api && !directApi.baseURL;
  const providerPatch = deepseekOfficial ? [
    `- id: llm-deepseek`,
    `  config:`,
    `    apiKeyEnv: ${JSON.stringify(directApi!.chaveEnv)}`,
    `    models:`,
    `      - id: ${JSON.stringify(model)}`,
    `        name: ${JSON.stringify(model)}`,
    "",
  ].join("\n") : [
    `- id: llm-pi-ai`,
    `  config:`,
    `    providers:`,
    `      ${directApi?.provider ?? DSH_GATEWAY_PROVIDER}:`,
    `        displayName: ${JSON.stringify(directApi?.label ?? `Cockpit via ${gateway!.provider}`)}`,
    `        apiKeyEnv: ${JSON.stringify(directApi?.chaveEnv ?? gateway!.credentialEnv)}`,
    ...(directApi?.api ? [`        api: ${directApi.api}`] : gateway ? [`        api: ${gateway.api}`] : []),
    ...(directApi?.baseURL ? [`        baseURL: ${JSON.stringify(directApi.baseURL)}`] : gateway ? [`        baseURL: ${JSON.stringify(gateway.baseUrl)}`] : []),
    `        models:`,
    `          - id: ${JSON.stringify(model)}`,
    `            name: ${JSON.stringify(model)}`,
    "",
  ].join("\n");
  writeFileSync(patchPath, `${readFileSync(patchPath, "utf8")}\n${providerPatch}`, "utf8");
  return {
    patchPath,
    provider: directApi?.provider ?? DSH_GATEWAY_PROVIDER,
    model,
    credentialEnv: directApi?.chaveEnv ?? gateway!.credentialEnv,
  };
}

export function autoAprovarAtivo(): boolean {
  return config.autoAprovar !== false;
}

export function sandboxDoCli(cli: string): string | undefined {
  return config.clis[cli]?.sandbox;
}
