import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { config, salvarConfig, type ContaPoolSpec } from "../config.ts";
import { readCodexGatewayConfig } from "./codex-config.ts";

export interface AccountRuntime {
  id: string;
  label: string;
  cli: string;
  env: Record<string, string>;
  args: string[];
  activePanes: Set<string>;
  lastUsedAt: number;
  consecutiveUseCount: number;
  limitedUntil: number | null;
  lastLimitDetail: string | null;
}

export interface AccountPoolItemView {
  id: string;
  label: string;
  status: "livre" | "ocupada" | "cooldown";
  painelId?: string;
  painelLabel?: string;
  limitedUntil?: number;
  lastLimitDetail?: string;
  env?: Record<string, string>;
  /** true se a pasta isolada parece ter credencial de login */
  authenticated?: boolean;
}

export interface AccountPoolView {
  cli: string;
  contas: AccountPoolItemView[];
  total: number;
  ativas: number;
  emCooldown: number;
}

function expandPath(val: string): string {
  const home = homedir();
  return val
    .replace(/^~(?=$|\/)/, home)
    .replace(/^\$HOME(?=$|\/)/, home);
}

function expandEnv(env: Record<string, string> = {}): Record<string, string> {
  const expanded: Record<string, string> = {};
  if (!env || typeof env !== "object") return expanded;
  for (const [key, val] of Object.entries(env)) {
    if (typeof val === "string") {
      expanded[key] = expandPath(val);
    }
  }
  return expanded;
}

const PUBLIC_ACCOUNT_ENV_KEYS = new Set([
  "HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "JETSKI_APP_DATA_DIR",
  "GROK_HOME",
]);

function publicAccountEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(expandEnv(env)).filter(([key]) => PUBLIC_ACCOUNT_ENV_KEYS.has(key)),
  );
}

/**
 * Heurística genérica por pastas do env da conta (não por produto na UI).
 * Sem sinal conhecido → true (não esconde conta sem motivo).
 */
export function contaAutenticada(cli: string, env: Record<string, string>): boolean {
  const expanded = expandEnv(env);
  const familia = config?.clis?.[cli]?.familia ?? cli;

  if (familia === "agy") {
    const jetski = expanded.JETSKI_APP_DATA_DIR || expanded.HOME;
    if (jetski && (expanded.JETSKI_APP_DATA_DIR || /antigravity-cli|profiles\/conta_/i.test(jetski))) {
      return (
        existsSync(join(jetski, "antigravity-oauth-token")) ||
        existsSync(join(jetski, ".gemini", "antigravity-cli", "antigravity-oauth-token"))
      );
    }
    return false;
  }

  if (familia === "codex") {
    if (expanded.OPENAI_API_KEY || expanded.CODEX_API_KEY) {
      return true;
    }
    const codexHome = expanded.CODEX_HOME || (expanded.HOME ? join(expanded.HOME, ".codex") : null);
    if (codexHome) {
      if (existsSync(join(codexHome, "auth.json")) || existsSync(join(codexHome, ".credentials.json"))) {
        return true;
      }
      try {
        const gateway = readCodexGatewayConfig(codexHome);
        return Boolean(gateway && (expanded[gateway.credentialEnv] || process.env[gateway.credentialEnv]));
      } catch {
        return false;
      }
    }
    const globalHome = config?.clis?.codex?.env?.CODEX_HOME
      ? expandPath(config.clis.codex.env.CODEX_HOME)
      : join(homedir(), ".codex");
    return (
      existsSync(join(globalHome, "auth.json")) ||
      existsSync(join(globalHome, ".credentials.json")) ||
      Boolean(process.env.OPENAI_API_KEY)
    );
  }

  if (familia === "claude") {
    if (expanded.ANTHROPIC_API_KEY || expanded.CLAUDE_API_KEY) {
      return true;
    }
    const configDirs = [
      expanded.CLAUDE_CONFIG_DIR,
      expanded.HOME ? join(expanded.HOME, ".config", "claude-code") : null,
      expanded.HOME,
    ].filter(Boolean) as string[];

    if (configDirs.length > 0) {
      for (const dir of configDirs) {
        if (
          existsSync(join(dir, "auth.json")) ||
          existsSync(join(dir, ".credentials.json"))
        ) {
          return true;
        }
      }
      return false;
    }
    if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) {
      return true;
    }
    const globalConfigDir = config?.clis?.claude?.env?.CLAUDE_CONFIG_DIR
      ? expandPath(config.clis.claude.env.CLAUDE_CONFIG_DIR)
      : null;
    if (globalConfigDir) {
      return (
        existsSync(join(globalConfigDir, "auth.json")) ||
        existsSync(join(globalConfigDir, ".credentials.json"))
      );
    }
    const homeDir = homedir();
    return (
      existsSync(join(homeDir, ".credentials.json")) ||
      existsSync(join(homeDir, ".claude", "auth.json")) ||
      existsSync(join(homeDir, ".config", "claude-code", "auth.json"))
    );
  }

  if (familia === "grok") {
    if (expanded.XAI_API_KEY || expanded.GROK_API_KEY) {
      return true;
    }
    if (expanded.GROK_HOME) {
      return existsSync(join(expanded.GROK_HOME, "auth.json"));
    }
    return (
      existsSync(join(homedir(), ".grok", "auth.json")) ||
      Boolean(process.env.XAI_API_KEY || process.env.GROK_API_KEY)
    );
  }

  return true;
}

export class AccountPoolManager {
  private pools = new Map<string, Map<string, AccountRuntime>>();
  private paneToAccount = new Map<string, { cli: string; accountId: string }>();
  private sessionAffinity = new Map<string, string>();

  constructor() {
    this.refreshFromConfig();
  }

  public refreshFromConfig(): void {
    const existingActive = new Map<string, Set<string>>();
    const existingCooldowns = new Map<string, { until: number | null; detail: string | null }>();
    const existingStats = new Map<string, { lastUsedAt: number; consecutiveUseCount: number }>();

    for (const [cli, accMap] of this.pools.entries()) {
      for (const [accId, acc] of accMap.entries()) {
        const key = `${cli}:${accId}`;
        existingActive.set(key, acc.activePanes);
        existingCooldowns.set(key, { until: acc.limitedUntil, detail: acc.lastLimitDetail });
        existingStats.set(key, { lastUsedAt: acc.lastUsedAt, consecutiveUseCount: acc.consecutiveUseCount });
      }
    }

    this.pools.clear();

    for (const [cli, spec] of Object.entries(config.clis ?? {})) {
      if (!spec.pool || !Array.isArray(spec.pool) || spec.pool.length === 0) continue;

      const accMap = new Map<string, AccountRuntime>();
      for (let i = 0; i < spec.pool.length; i++) {
        const item = spec.pool[i];
        const id = item.id || `acc-${i + 1}`;
        const label = item.label || id;
        const key = `${cli}:${id}`;

        accMap.set(id, {
          id,
          label,
          cli,
          env: item.env ? { ...item.env } : {},
          args: item.args ? [...item.args] : [],
          activePanes: existingActive.get(key) ?? new Set<string>(),
          lastUsedAt: existingStats.get(key)?.lastUsedAt ?? 0,
          consecutiveUseCount: existingStats.get(key)?.consecutiveUseCount ?? 0,
          limitedUntil: existingCooldowns.get(key)?.until ?? null,
          lastLimitDetail: existingCooldowns.get(key)?.detail ?? null,
        });
      }
      this.pools.set(cli, accMap);
    }
  }

  public hasPool(cli: string): boolean {
    return (this.pools.get(cli)?.size ?? 0) > 0;
  }

  public getAccounts(cli: string): AccountRuntime[] {
    const map = this.pools.get(cli);
    return map ? Array.from(map.values()) : [];
  }

  /**
   * Inspired by OmniRoute's compareLruConnections & sessionAffinityPin:
   * 1. Filters out accounts in cooldown (limitedUntil > Date.now()).
   * 2. Prefers completely free accounts (activePanes.size === 0).
   * 3. Among free accounts, picks LRU (least recently used: lowest lastUsedAt).
   * 4. If all healthy accounts are busy, picks the one with fewest activePanes.
   */
  public acquire(cli: string, paneId: string, preferredAccountId?: string): {
    id: string;
    label: string;
    env: Record<string, string>;
    args: string[];
  } | null {
    if (this.paneToAccount.has(paneId)) {
      this.release(paneId);
    }

    const accMap = this.pools.get(cli);
    if (!accMap || accMap.size === 0) return null;

    const now = Date.now();
    const candidates = Array.from(accMap.values()).filter(
      (a) => a.limitedUntil === null || a.limitedUntil <= now,
    );

    if (candidates.length === 0) {
      // All accounts in cooldown!
      return null;
    }

    let selected: AccountRuntime | null = null;

    const targetAccountId = preferredAccountId || this.sessionAffinity.get(paneId);
    if (targetAccountId) {
      selected = candidates.find((c) => c.id === targetAccountId) ?? null;
    }

    if (!selected) {
      candidates.sort((a, b) => {
        // 1. Least active panes (concurrency first)
        if (a.activePanes.size !== b.activePanes.size) {
          return a.activePanes.size - b.activePanes.size;
        }
        // 2. Among equally loaded: prefer authenticated profiles
        const authA = contaAutenticada(cli, a.env) ? 1 : 0;
        const authB = contaAutenticada(cli, b.env) ? 1 : 0;
        if (authA !== authB) return authB - authA;
        // 3. LRU: least recently used
        if (a.lastUsedAt !== b.lastUsedAt) {
          return a.lastUsedAt - b.lastUsedAt;
        }
        // 4. Consecutive usage count
        return (a.consecutiveUseCount || 0) - (b.consecutiveUseCount || 0);
      });
      selected = candidates[0];
    }

    selected.activePanes.add(paneId);
    selected.lastUsedAt = now;
    selected.consecutiveUseCount = (selected.consecutiveUseCount || 0) + 1;

    this.paneToAccount.set(paneId, { cli, accountId: selected.id });
    this.sessionAffinity.set(paneId, selected.id);

    return {
      id: selected.id,
      label: selected.label,
      env: expandEnv(selected.env),
      args: [...selected.args],
    };
  }

  public release(paneId: string): void {
    const link = this.paneToAccount.get(paneId);
    if (!link) return;

    this.paneToAccount.delete(paneId);
    const acc = this.pools.get(link.cli)?.get(link.accountId);
    if (acc) {
      acc.activePanes.delete(paneId);
    }
  }

  public getAccountForPane(paneId: string): AccountRuntime | null {
    const link = this.paneToAccount.get(paneId);
    if (!link) return null;
    return this.pools.get(link.cli)?.get(link.accountId) ?? null;
  }

  public markLimited(
    cli: string,
    accountId: string,
    detailOrDuration?: string | number,
    durationOrDetail?: number | string,
  ): void {
    const acc = this.pools.get(cli)?.get(accountId);
    if (!acc) return;

    const detail = typeof detailOrDuration === "string" ? detailOrDuration : typeof durationOrDetail === "string" ? durationOrDetail : "Limite de cota atingido";
    const durationMs = typeof detailOrDuration === "number" ? detailOrDuration : typeof durationOrDetail === "number" ? durationOrDetail : 15 * 60 * 1000;

    acc.limitedUntil = Date.now() + durationMs;
    acc.lastLimitDetail = String(detail).slice(0, 240);
  }

  public resetLimit(cli: string, accountId?: string): void {
    const accMap = this.pools.get(cli);
    if (!accMap) return;

    if (accountId) {
      const acc = accMap.get(accountId);
      if (acc) {
        acc.limitedUntil = null;
        acc.lastLimitDetail = null;
      }
    } else {
      for (const acc of accMap.values()) {
        acc.limitedUntil = null;
        acc.lastLimitDetail = null;
      }
    }
  }

  public nextAvailable(cli: string, currentAccountId?: string): {
    id: string;
    label: string;
    env: Record<string, string>;
    args: string[];
  } | null {
    const accMap = this.pools.get(cli);
    if (!accMap) return null;

    const now = Date.now();
    const candidates = Array.from(accMap.values())
      .filter((a) => a.id !== currentAccountId)
      .filter((a) => a.limitedUntil === null || a.limitedUntil <= now);

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      if (a.activePanes.size !== b.activePanes.size) {
        return a.activePanes.size - b.activePanes.size;
      }
      const authA = contaAutenticada(cli, a.env) ? 1 : 0;
      const authB = contaAutenticada(cli, b.env) ? 1 : 0;
      if (authA !== authB) return authB - authA;
      return a.lastUsedAt - b.lastUsedAt;
    });

    const chosen = candidates[0];
    return {
      id: chosen.id,
      label: chosen.label,
      env: expandEnv(chosen.env),
      args: [...chosen.args],
    };
  }

  public getView(cliFilter?: string): Record<string, AccountPoolView> {
    const result: Record<string, AccountPoolView> = {};
    const now = Date.now();

    for (const [cli, accMap] of this.pools.entries()) {
      if (cliFilter && cli !== cliFilter) continue;

      const contas: AccountPoolItemView[] = [];
      let ativas = 0;
      let emCooldown = 0;

      for (const acc of accMap.values()) {
        const isCooldown = acc.limitedUntil !== null && acc.limitedUntil > now;
        const isBusy = acc.activePanes.size > 0;

        let status: "livre" | "ocupada" | "cooldown" = "livre";
        if (isCooldown) {
          status = "cooldown";
          emCooldown++;
        } else if (isBusy) {
          status = "ocupada";
          ativas++;
        }

        const firstPaneId = acc.activePanes.size > 0 ? Array.from(acc.activePanes)[0] : undefined;

        contas.push({
          id: acc.id,
          label: acc.label,
          status,
          painelId: firstPaneId,
          limitedUntil: isCooldown ? acc.limitedUntil! : undefined,
          lastLimitDetail: acc.lastLimitDetail ?? undefined,
          env: publicAccountEnv(acc.env),
          authenticated: contaAutenticada(cli, acc.env),
        });
      }

      result[cli] = {
        cli,
        contas,
        total: accMap.size,
        ativas,
        emCooldown,
      };
    }

    return result;
  }

  public addAccount(cli: string, conta: ContaPoolSpec): void {
    config.clis[cli] ??= { command: cli };
    config.clis[cli].pool ??= [];

    const existingIdx = config.clis[cli].pool!.findIndex((c) => c.id === conta.id);
    if (existingIdx >= 0) {
      config.clis[cli].pool![existingIdx] = { ...conta };
    } else {
      config.clis[cli].pool!.push({ ...conta });
    }

    salvarConfig();
    this.refreshFromConfig();
  }

  public removeAccount(cli: string, accountId: string): void {
    if (!config.clis[cli]?.pool) return;
    config.clis[cli].pool = config.clis[cli].pool!.filter((c) => c.id !== accountId);
    salvarConfig();
    this.refreshFromConfig();
  }

  /**
   * Helper to collect all directories for a specific env var across all pools (e.g. CODEX_HOME)
   */
  public getAllEnvDirs(envVarName: string): string[] {
    const dirs = new Set<string>();
    const home = homedir();

    for (const accMap of this.pools.values()) {
      for (const acc of accMap.values()) {
        const raw = acc.env[envVarName];
        if (raw) {
          dirs.add(raw.replace(/^~(?=$|\/)/, home).replace(/^\$HOME(?=$|\/)/, home));
        }
      }
    }

    return Array.from(dirs);
  }
}

export const accountPool = new AccountPoolManager();
