/**
 * Config por pane para workers DSH (KD-C + KD-omniroute).
 * Não hardcodar nome de modelo — só `spec.model` / escolha do usuário.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../../config.ts";

export type PaneDshRoute = {
  /** cli do pane: codex | claude (familia). */
  cli: string;
  model?: string | null;
  /** CODEX_HOME efetivo (pool ou clis.codex.env). */
  codexHome?: string | null;
  autoAprovar: boolean;
  sandbox?: string | null;
};

/**
 * Mapeia sandbox/autoAprovar do Cockpit → permissionMode do subagent.
 * Escolha documentada: workspace-write + autoAprovar → `never` (Codex) /
 * `dontAsk` (Claude) — unattended mais próximo sem bypass total.
 */
export function permissionModeFor(route: PaneDshRoute): string {
  const sandbox = route.sandbox ?? "workspace-write";
  const familia = route.cli === "codex" || route.cli === "claude" ? route.cli : route.cli;

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
  const isCodex = route.cli === "codex";
  const isClaude = route.cli === "claude";
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

export function autoAprovarAtivo(): boolean {
  return config.autoAprovar !== false;
}

export function sandboxDoCli(cli: string): string | undefined {
  return config.clis[cli]?.sandbox;
}
