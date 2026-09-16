import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";

import { config, backendDo, parseCliBackend, type AgentSpec } from "../config.ts";
import { CASA } from "../state.ts";
import { confiar } from "../confianca.ts";
import { definirModelo, materializarPerfilAgy } from "../agy.ts";
import { resolverHarness, type Pedido } from "../harness.ts";
import { identidadeVisualDoPapel, promptInicialDoPapel, roleContractFor, type RoleContractInput } from "../orchestration/roles.ts";
import { pathComExecutaveisLocais, providerDisponivel, resolverExecutavel } from "../providers.ts";
import { argsDaPonte, envDaPonte, pontede } from "../ponte.ts";
import { dshApiDoCli, envDaDshApi } from "../providers/dsh-api.ts";
import { getDefaultPaneStore } from "../persistence/index.ts";
import { accountPool } from "../providers/account-pool.ts";
import { getDshManager } from "./dsh-backend/dsh-manager.ts";
import { checkDshAvailability } from "./dsh-backend/dsh-availability.ts";
import { hasSignificantTerminalOutput } from "./terminal-activity.ts";

function assertExecutorDisponivel(cli: string, backendOverride?: string): void {
  const backend = backendOverride ? parseCliBackend(backendOverride) : backendDo(cli);
  if (backend === "dsh") {
    const dsh = checkDshAvailability();
    if (!dsh.available) {
      throw new Error(`Engine DSH indisponível: ${dsh.error ?? "bin/home"}`);
    }
    if (!providerDisponivel(cli)) {
      throw new Error(
        `Worker "${cli}" necessário para o subagent DSH, mas não está no PATH (cota/auth continuam do CLI)`,
      );
    }
    return;
  }
  if (!providerDisponivel(cli)) {
    throw new Error(`Executor "${cli}" não disponível no sistema`);
  }
}

import {
  type PaneState,
  type PaneStatus,
  normalizePaneStatus,
  transitionPane,
} from "./pane-state.ts";
import {
  isCleanShell,
  getCleanShellCommand,
  sanitizeCleanShellEnv,
  assertCleanShellInvariants,
  enforceBashPrecedence,
  BASH_PATH,
} from "./clean-shell.ts";
import { PaneActivityTracker, DEFAULT_SPARKLINE_SLOTS, DEFAULT_IDLE_TIMEOUT_MS } from "./tracker.ts";
import { PtyClient } from "./pty-client.ts";
import { PtyHost, getDefaultSocketPath } from "./pty-host.ts";

export type { PaneState, PaneStatus };

export type SpawnOpts = {
  agent: string;
  label?: string;
  /** Tipo para contexto e overrides explícitos de execução. */
  harness?: Omit<Pedido, "agent">;
  cwd: string;
  projectId: string | null;
  missionId: string | null;
  objetivo?: string;
  /** Skills que a missão pediu, além das do agente. */
  skills?: string[];
  /** Primeira mensagem do painel. Vai como argumento, não digitada. */
  tarefa?: string;
  /** Override: força o painel a ser maestro mesmo que o agente não seja. */
  maestro?: boolean;
  porta: number;
  role?: string;
  roleDefinition?: RoleContractInput;
  runner?: string;
  /** Conta preferida do pool (agy/codex/grok/…); omitido = LRU automático */
  preferredAccountId?: string;
  /** Se true, failover intra-pool não troca esta conta */
  accountPinned?: boolean;
  /** Override de backend: força "dsh" ou "pty" independente do config global */
  backend?: "pty" | "dsh";
  /** Argumentos de login executados diretamente no CLI, sem shell. */
  loginArgs?: string[];
};

export interface ManagerPaneEntry {
  state: PaneState;
  onOutput?: (data: string) => void;
  onExit?: (code: number) => void;
  lastData: number;
  acumulado: number;
  inputBuffer: string;
}

const MCP_SCRIPT = fileURLToPath(new URL("../mcp-maestro.ts", import.meta.url));
const BRIDGE_SCRIPT = fileURLToPath(new URL("../maestro-cli.ts", import.meta.url));

function expandEnvPaths(env: Record<string, string>): Record<string, string> {
  const home = homedir();
  const expanded: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") {
      expanded[k] = v.replace(/^~(?=$|\/)/, home).replace(/^\$HOME(?=$|\/)/, home);
    }
  }
  return expanded;
}

type ManualRunner = "codex" | "agy" | "grok" | "claude";

function runnerFromText(text: string): ManualRunner | null {
  if (/ask codex to do anything|openai codex|codex build/i.test(text)) return "codex";
  if (/antigravity cli|google ai pro|gemini \d/i.test(text)) return "agy";
  if (/grok build|\bgrok\b/i.test(text)) return "grok";
  if (/claude code|anthropic/i.test(text)) return "claude";
  return null;
}

function runnerFromCommand(text: string): ManualRunner | null {
  const lastLine = text.split(/[\r\n]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, " ") ?? "";
  const match = /^\s*(codex|agy|grok|claude)(?:\s|$)/i.exec(lastLine);
  return (match?.[1]?.toLowerCase() as ManualRunner | undefined) ?? null;
}

export function resolveCli(cli: string, extra: string[]): { file: string; args: string[] } {
  const spec = config.clis[cli] ?? { command: cli };
  const args = [...(spec.args ?? []), ...extra];
  const executable = resolverExecutavel(spec.command);
  if (executable) return { file: executable, args };
  if (process.platform !== "win32" && /[\\/]/.test(spec.command)) return { file: spec.command, args };
  if (process.platform !== "win32") return { file: spec.command, args };
  if (/[\\/]/.test(spec.command) || spec.command.toLowerCase().endsWith(".exe")) {
    return { file: spec.command, args };
  }
  const comspec = process.env.ComSpec ?? "cmd.exe";
  return { file: comspec, args: ["/c", spec.command, ...args] };
}

function resolveCliWithoutShell(cli: string, extra: string[]): { file: string; args: string[] } {
  const spec = config.clis[cli] ?? { command: cli };
  const args = [...(spec.args ?? []), ...extra];
  const executable = resolverExecutavel(spec.command);
  if (!executable) {
    throw new Error(`Executor de login "${spec.command}" não encontrado sem usar shell`);
  }
  return { file: executable, args };
}

export const familiaDo = (cli: string): string => config.clis[cli]?.familia ?? cli;

export function agentSpec(agent: string): AgentSpec {
  const spec = config.agents[agent];
  if (!spec) {
    throw new Error(
      `não existe agente "${agent}". Disponíveis: ${Object.keys(config.agents).join(", ")}`,
    );
  }
  return spec;
}

function ambienteLimpo(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm-256color" };
  for (const chave of Object.keys(env)) {
    if (
      chave.startsWith("CLAUDE_CODE_") ||
      chave === "CLAUDECODE" ||
      chave.toLowerCase().startsWith("npm_")
    ) {
      delete env[chave];
    }
  }
  return env;
}

function mcpsPessoaisDoCodex(customHome?: string): string[] {
  const customCodexHome = (customHome || process.env.CODEX_HOME || config.clis?.codex?.env?.CODEX_HOME || "")
    .replace(/^~(?=$|\/)/, homedir())
    .replace(/^\$HOME(?=$|\/)/, homedir());
  const arquivo = join(customCodexHome || join(homedir(), ".codex"), "config.toml");
  if (!existsSync(arquivo)) return [];
  const nomes = new Set<string>();
  for (const linha of readFileSync(arquivo, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*\[mcp_servers\.(?:"((?:\\.|[^"])*)"|'([^']*)'|([A-Za-z0-9_-]+))(?:\.|\])?/);
    if (!m) continue;
    try {
      nomes.add(m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : (m[2] ?? m[3])!);
    } catch {
      // Ignored
    }
  }
  return [...nomes];
}

/**
 * PtyManager coordinates the decoupled PTY daemon, sovereign clean bash shells,
 * and 8-state granular pane machines.
 */
export class PtyManager {
  private ptys = new Map<string, ManagerPaneEntry>();
  private counter: number = 0;
  private client: PtyClient;
  private isConnecting: boolean = false;
  private initialized: boolean = false;
  private globalOutputListeners = new Set<(paneId: string, data: string) => void>();
  private globalExitListeners = new Set<(paneId: string, code: number, pane?: PaneState) => void>();
  /** Reaps DSH iniciados por killPty síncrono — flushDshKills() espera todos. */
  private pendingDshKills: Promise<void>[] = [];
  private agyMcpHomes = new Map<string, string>();
  private grokMcpHomes = new Map<string, string>();

  private mcpEnv(paneId: string, opts: SpawnOpts, agent: AgentSpec, maestro: boolean): Record<string, string> {
    return {
      COCKPIT_PORT: String(opts.porta),
      COCKPIT_MISSION: opts.missionId ?? "",
      COCKPIT_PROJECT: opts.projectId ?? "",
      COCKPIT_AGENT: agent.label,
      COCKPIT_PANE: paneId,
      COCKPIT_MAESTRO: maestro ? "1" : "0",
    };
  }

  constructor(socketPath: string = getDefaultSocketPath()) {
    this.client = new PtyClient(socketPath);
    this.setupClientEvents();
  }

  public getRawMap(): Map<string, ManagerPaneEntry> {
    return this.ptys;
  }

  public getClient(): PtyClient {
    return this.client;
  }

  public onOutput(listener: (paneId: string, data: string) => void): () => void {
    this.globalOutputListeners.add(listener);
    return () => this.globalOutputListeners.delete(listener);
  }

  public onExit(listener: (paneId: string, code: number, pane?: PaneState) => void): () => void {
    this.globalExitListeners.add(listener);
    return () => this.globalExitListeners.delete(listener);
  }

  public setGlobalHandlers(
    onOutput: (paneId: string, data: string) => void,
    onExit: (paneId: string, code: number, pane?: PaneState) => void,
  ): void {
    this.globalOutputListeners.add(onOutput);
    this.globalExitListeners.add(onExit);
  }

  private setupClientEvents(): void {
    this.client.on("output", (paneId: string, data: string) => {
      const entry = this.ptys.get(paneId);
      if (entry) {
        this.registrarRunnerManual(entry, data);
        entry.state.bytesOut += data.length;
        const significant = hasSignificantTerminalOutput(data);
        if (significant) {
          entry.lastData = Date.now();
          entry.acumulado += data.length;
          const norm = normalizePaneStatus(entry.state.status);
          if (norm === "starting" || norm === "waiting-user") {
            try {
              transitionPane(entry.state, "working");
            } catch {
              // Ignored
            }
          }
        }
        if (entry.onOutput) entry.onOutput(data);
      }
      for (const listener of this.globalOutputListeners) {
        try {
          listener(paneId, data);
        } catch (err) {
          console.error(`[PtyManager] error in global output listener:`, err);
        }
      }
    });

    this.client.on("exit", (paneId: string, code: number, status: PaneStatus) => {
      const entry = this.ptys.get(paneId);
      const exitedPane = entry?.state;
      accountPool.release(paneId);
      if (entry) {
        entry.state.connected = false;
        try {
          transitionPane(entry.state, status, { exitCode: code });
        } catch {
          entry.state.status = status;
          entry.state.exitCode = code;
        }
        this.savePaneToDisk(entry.state);
        this.limparMcpAgy(paneId);
        if (entry.onExit) entry.onExit(code);
        this.ptys.delete(paneId);
      }
      for (const listener of this.globalExitListeners) {
        try {
          listener(paneId, code, exitedPane);
        } catch (err) {
          console.error(`[PtyManager] error in global exit listener:`, err);
        }
      }
    });

    this.client.on("status_update", (paneId: string, status: PaneStatus, reason?: string | null) => {
      const entry = this.ptys.get(paneId);
      if (entry) {
        try {
          transitionPane(entry.state, status, { reason: reason ?? undefined });
        } catch {
          entry.state.status = status;
        }
        if (status === "dead" || status === "failed") entry.state.connected = false;
        this.savePaneToDisk(entry.state);
      }
    });

    this.client.on("pulse", (pulses: Array<{ paneId: string; status: PaneStatus; atividade: number[]; bytesIn: number; bytesOut: number }>) => {
      for (const p of pulses) {
        const entry = this.ptys.get(p.paneId);
        if (entry) {
          entry.state.status = p.status;
          entry.state.connected = p.status !== "dead" && p.status !== "failed";
          entry.state.atividade = p.atividade;
          entry.state.bytesIn = p.bytesIn;
          entry.state.bytesOut = p.bytesOut;
        }
      }
    });

    this.client.on("connected", async () => {
      await this.syncSurvivingPanes();
    });

    this.client.on("disconnected", () => {
      for (const entry of this.ptys.values()) entry.state.connected = false;
    });
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      await this.client.connect();
    } catch (err) {
      // Ephemeral fallback: start in-process PtyHost on a fallback temporary socket
      try {
        const fallbackSocket = join(tmpdir(), `cockpit-pty-fallback-${process.pid}.sock`);
        const fallbackHost = new PtyHost(fallbackSocket);
        await fallbackHost.start();
        this.client = new PtyClient(fallbackSocket);
        this.setupClientEvents();
        await this.client.connect();
      } catch (fallbackErr) {
        console.error("PTY Manager initialization and fallback failed:", fallbackErr);
      }
    }
  }

  /**
   * Recovers surviving panes from the decoupled PTY daemon on Express web server startup.
   */
  public async syncSurvivingPanes(): Promise<void> {
    try {
      const surviving = await this.client.list();
      for (const pane of surviving) {
        if (["dead", "completed", "failed"].includes(normalizePaneStatus(pane.status))) {
          continue;
        }
        let entry = this.ptys.get(pane.paneId);
        if (!entry) {
          entry = {
            state: pane,
            lastData: Date.now(),
            acumulado: 0,
            inputBuffer: "",
          };
          this.ptys.set(pane.paneId, entry);
        } else {
          entry.state = pane;
        }
        this.savePaneToDisk(entry.state);
        if (isCleanShell(entry.state) && !entry.state.attachedRunner) {
          try {
            this.registrarRunnerManual(entry, await this.client.replay(pane.paneId));
          } catch {
            // O painel pode encerrar enquanto o replay é lido.
          }
        }
      }
    } catch {
      // Best effort
    }
  }

  private savePaneToDisk(state: PaneState): void {
    try {
      const store = getDefaultPaneStore();
      store.savePane({
        paneId: state.paneId,
        missionId: state.missionId ?? "",
        projectId: state.projectId,
        label: state.label,
        role: state.role ?? state.agent,
        runner: state.runner ?? state.cli,
        model: state.model,
        effort: state.effort,
        cwd: state.cwd,
        maestro: state.maestro,
        accountId: state.accountId,
        accountLabel: state.accountLabel,
        accountPinned: state.accountPinned,
        status: normalizePaneStatus(state.status),
        iniciadoEm: state.iniciadoEm,
        atualizadoEm: Date.now(),
      });
    } catch {
      // Persistence store might be mock or uninitialized
    }
  }

  /** Grava o MCP no perfil da conta. Não inventa HOME vazio — o token OAuth mora no HOME do perfil. */
  private gravarMcpAgyNoPerfil(paneId: string, opts: SpawnOpts, agent: AgentSpec, maestro: boolean, profileDir: string): void {
    const caminho = join(profileDir, ".gemini", "config", "mcp_config.json");
    mkdirSync(dirname(caminho), { recursive: true });
    writeFileSync(
      caminho,
      JSON.stringify(
        {
          mcpServers: {
            cockpit: {
              command: process.execPath,
              args: [MCP_SCRIPT],
              env: this.mcpEnv(paneId, opts, agent, maestro),
            },
          },
        },
        null,
        2,
      ),
    );
  }

  private criarMcpAgyIsolado(paneId: string, opts: SpawnOpts, agent: AgentSpec, maestro: boolean): string {
    const home = mkdtempSync(join(tmpdir(), "cockpit-agy-mcp-"));
    this.gravarMcpAgyNoPerfil(paneId, opts, agent, maestro, home);
    this.agyMcpHomes.set(paneId, home);
    return home;
  }

  private criarMcpGrokIsolado(paneId: string, opts: SpawnOpts, agent: AgentSpec, maestro: boolean, realHome: string): string {
    const home = mkdtempSync(join(tmpdir(), "cockpit-grok-mcp-"));
    if (existsSync(realHome)) {
      for (const nome of readdirSync(realHome)) {
        if (nome === "config.toml") continue;
        try {
          symlinkSync(join(realHome, nome), join(home, nome));
        } catch {
          // Melhor pular um arquivo do que perder o MCP.
        }
      }
    }
    const original = existsSync(join(realHome, "config.toml"))
      ? readFileSync(join(realHome, "config.toml"), "utf8")
      : "";
    const stripped = original.replace(/^\[mcp_servers\.cockpit\][\s\S]*?(?=^\[|\z)/gm, "").trimEnd();
    const env = this.mcpEnv(paneId, opts, agent, maestro);
    const envToml = Object.entries(env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ");
    writeFileSync(
      join(home, "config.toml"),
      `${stripped}\n\n[mcp_servers.cockpit]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([MCP_SCRIPT])}\nenv = { ${envToml} }\nenabled = true\n`,
    );
    this.grokMcpHomes.set(paneId, home);
    return home;
  }

  private limparMcpAgy(paneId: string): void {
    for (const map of [this.agyMcpHomes, this.grokMcpHomes]) {
      const home = map.get(paneId);
      if (!home) continue;
      map.delete(paneId);
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        // Best effort.
      }
    }
  }

  private registrarRunnerManual(entry: ManagerPaneEntry, text: string): void {
    if (!isCleanShell(entry.state) || entry.state.attachedRunner) return;
    const runner = runnerFromText(text);
    if (!runner) return;
    entry.state.attachedRunner = runner;
    entry.state.atualizadoEm = Date.now();
    this.savePaneToDisk(entry.state);
  }

  private registrarEntradaManual(entry: ManagerPaneEntry, data: string): void {
    if (!isCleanShell(entry.state)) return;
    entry.inputBuffer = `${entry.inputBuffer}${data}`.slice(-512);
    if (entry.state.attachedRunner) {
      const lastLine = entry.inputBuffer.split(/[\r\n]/).at(-1)?.trim().toLowerCase();
      if (lastLine === "exit") {
        entry.state.attachedRunner = null;
        entry.state.atualizadoEm = Date.now();
        this.savePaneToDisk(entry.state);
      }
      return;
    }
    const runner = runnerFromCommand(entry.inputBuffer);
    if (!runner) return;
    entry.state.attachedRunner = runner;
    entry.state.atualizadoEm = Date.now();
    this.savePaneToDisk(entry.state);
  }

  /**
   * Spawns a new pane (Requirement R1 for Clean Shell or LLM for AI agents).
   */
  public spawnPane(
    opts: SpawnOpts,
    onOutput?: (data: string) => void,
    onExit?: (code: number) => void,
  ): PaneState {
    const paneId = `p${++this.counter}-${randomUUID().slice(0, 8)}`;
    const initialClean = isCleanShell(opts);

    let file: string;
    let argv: string[];
    let env: Record<string, string> = {};
    let bundle: { cli: string; model?: string; effort?: string } = { cli: "bash" };
    let sessionId: string | null = null;
    let maestro = opts.maestro ?? false;
    let allocatedAccount: { id: string; label: string; env: Record<string, string>; args: string[] } | null = null;
    let dshInitialPrompt = opts.tarefa;
    let effectiveBackend: "pty" | "dsh" = "pty";

    let isBash = initialClean;
    if (opts.loginArgs) {
      const cliTarget = opts.runner ?? opts.agent;
      const requestedAccount = opts.preferredAccountId
        ? accountPool.getAccounts(cliTarget).find((account) => account.id === opts.preferredAccountId)
        : undefined;
      if (requestedAccount && requestedAccount.activePanes.size > 0) {
        throw new Error(`Conta "${requestedAccount.label}" está em uso; encerre o painel antes de autenticar novamente`);
      }
      if (requestedAccount?.limitedUntil && requestedAccount.limitedUntil > Date.now()) {
        throw new Error(`Conta "${requestedAccount.label}" está em cooldown; aguarde ou resete a cota antes do login`);
      }
      allocatedAccount = accountPool.acquire(cliTarget, paneId, opts.preferredAccountId);
      if (!allocatedAccount) {
        throw new Error(`Conta "${opts.preferredAccountId ?? cliTarget}" indisponível para autenticação`);
      }
      const resolvedLogin = resolveCliWithoutShell(cliTarget, opts.loginArgs);
      file = resolvedLogin.file;
      argv = resolvedLogin.args;
      const cliConfigEnv = config.clis[cliTarget]?.env ?? {};
      const accountEnv = expandEnvPaths({ ...cliConfigEnv, ...(allocatedAccount?.env ?? {}) });
      if (familiaDo(cliTarget) === "agy") {
        materializarPerfilAgy(accountEnv.HOME || accountEnv.JETSKI_APP_DATA_DIR);
      }
      const currentPath = process.env.PATH ?? "";
      const pathWithBin = pathComExecutaveisLocais(currentPath);
      env = {
        ...ambienteLimpo(),
        ...accountEnv,
        ...envDaPonte(cliTarget),
        PATH: pathWithBin,
        TERM: "xterm-256color",
        SHELL: BASH_PATH,
        COCKPIT_PORT: String(opts.porta),
        COCKPIT_MISSION: opts.missionId ?? "",
        COCKPIT_PROJECT: opts.projectId ?? "",
        COCKPIT_PANE: paneId,
        COCKPIT_AGENT: `Login (${cliTarget})`,
      } as Record<string, string>;
      bundle = { cli: cliTarget };
      isBash = false;
    } else if (!isBash) {
      bundle = resolverHarness({
        agent: opts.agent,
        runner: opts.runner,
        tipo: opts.harness?.tipo,
        invoke: opts.harness?.invoke,
        roster: opts.harness?.roster,
        elenco: opts.harness?.elenco,
        checkAvailability: false,
      });
      if (bundle.cli === "bash") {
        isBash = true;
      } else {
        effectiveBackend = opts.backend ? parseCliBackend(opts.backend) : backendDo(bundle.cli);
        assertExecutorDisponivel(bundle.cli, effectiveBackend);
      }
    }

    if (isBash && !opts.loginArgs) {
      // R1: Sovereign Clean Shell
      const precedence = enforceBashPrecedence(opts.runner ?? opts.agent);
      const cmd = getCleanShellCommand();
      // Safely discard tarefa for bash panes
      assertCleanShellInvariants(cmd, undefined);

      file = cmd.file;
      argv = cmd.args;
      env = sanitizeCleanShellEnv(process.env, {
        porta: opts.porta,
        missionId: opts.missionId,
        projectId: opts.projectId,
        paneId,
        label: opts.agent === "shell" ? "Shell" : (opts.label ?? opts.agent),
        cwd: opts.cwd,
      }) as Record<string, string>;
      bundle = { cli: "bash" };
    } else if (!opts.loginArgs) {
      // LLM Specialist or Maestro
      const perfil = agentSpec(opts.agent);
      if (!bundle.model && !bundle.effort) {
        bundle = resolverHarness({ agent: opts.agent, runner: opts.runner, ...(opts.harness ?? {}) });
      }
      assertExecutorDisponivel(bundle.cli, opts.backend);
      const spec: AgentSpec = { ...perfil, cli: bundle.cli, model: bundle.model, effort: bundle.effort };
      const visualDoPapel = identidadeVisualDoPapel(opts.role, opts.roleDefinition);
      if (visualDoPapel && visualDoPapel.id !== opts.agent) {
        const contrato = roleContractFor(opts.role, opts.agent, opts.roleDefinition);
        spec.papel = [`Você é o ${contrato.label.toUpperCase()}. ${contrato.description}`, spec.papel]
          .filter((parte): parte is string => Boolean(parte?.trim()))
          .join("\n\n");
        spec.label = visualDoPapel.label;
        spec.cor = visualDoPapel.cor;
      }
      const promptInicial = promptInicialDoPapel({
        role: opts.role,
        agent: opts.agent,
        objetivo: opts.objetivo,
        tarefa: opts.tarefa,
        custom: opts.roleDefinition,
      });
      dshInitialPrompt = promptInicial;
      effectiveBackend = opts.backend ? parseCliBackend(opts.backend) : backendDo(spec.cli);
      if (effectiveBackend !== "dsh") {
        allocatedAccount = accountPool.acquire(spec.cli, paneId, opts.preferredAccountId);
      }
      const args: string[] = [...(spec.args ?? []), ...(allocatedAccount?.args ?? [])];
      const familia = familiaDo(spec.cli);
      maestro = opts.maestro ?? spec.maestro === true;

      const ponte = pontede(spec.cli);
      const dshApi = dshApiDoCli(spec.cli);
      if (ponte && !envDaPonte(spec.cli)[ponte.spec.chaveEnv]) {
        throw new Error(
          `${spec.cli} precisa de uma chave antes de abrir painel — ponha em Ajustes → Grátis, ou exporte ${ponte.spec.chaveEnv}`,
        );
      }
      if (dshApi && !envDaDshApi(spec.cli)[dshApi.chaveEnv]) {
        throw new Error(`${spec.cli} precisa de uma chave antes de abrir painel — ponha em Ajustes → APIs DSH.`);
      }

      if (config.confiarNasPastasQueEuAbrir !== false) confiar(familiaDo(spec.cli), opts.cwd);
      const autoAprovar = config.autoAprovar !== false;

      if (familia === "claude") {
        sessionId = randomUUID();
        if (autoAprovar && !args.includes("--dangerously-skip-permissions")) {
          args.push("--dangerously-skip-permissions");
        }
        if (spec.model) args.push("--model", spec.model);
        if (spec.effort) args.push("--effort", spec.effort);

        if (opts.missionId) {
          const caminho = join(CASA, "mcp", `${opts.missionId}-${paneId}.json`);
          mkdirSync(dirname(caminho), { recursive: true });
          writeFileSync(
            caminho,
            JSON.stringify({
              mcpServers: {
                cockpit: {
                  command: process.execPath,
                  args: [MCP_SCRIPT],
                  env: this.mcpEnv(paneId, opts, spec, maestro),
                },
              },
            }),
          );
          args.push("--strict-mcp-config", "--mcp-config", caminho);
        }
        args.push("--session-id", sessionId);
      }

      if (familia === "agy") {
        const rawTargetDir =
          allocatedAccount?.env?.JETSKI_APP_DATA_DIR ||
          allocatedAccount?.env?.HOME ||
          config.clis[spec.cli]?.env?.JETSKI_APP_DATA_DIR ||
          config.clis[spec.cli]?.env?.HOME;
        const targetDir = rawTargetDir
          ? rawTargetDir
              .replace(/^~(?=$|\/)/, homedir())
              .replace(/^\$HOME(?=$|\/)/, homedir())
          : undefined;

        definirModelo(spec.model, targetDir);
        if (autoAprovar && !args.includes("--dangerously-skip-permissions")) {
          args.push("--dangerously-skip-permissions");
        }
        if (spec.model) args.push("--model", spec.model);
        if (spec.effort) args.push("--effort", spec.effort);
      }

      if (familia === "codex") {
        args.push(...argsDaPonte(spec.cli));
        const sandboxMode = config.clis[spec.cli]?.sandbox ?? "workspace-write";
        if (autoAprovar) {
          args.push("--sandbox", sandboxMode, "--ask-for-approval", "never");
        } else {
          args.push("--sandbox", sandboxMode);
        }

        args.push("--disable", "plugins");
        const effectiveCodexHome = allocatedAccount?.env?.CODEX_HOME || config.clis[spec.cli]?.env?.CODEX_HOME;
        for (const nome of mcpsPessoaisDoCodex(effectiveCodexHome)) {
          const segmento = /^[A-Za-z0-9_-]+$/.test(nome) ? nome : JSON.stringify(nome);
          args.push("-c", `mcp_servers.${segmento}.enabled=false`);
        }
        if (spec.model) args.push("--model", spec.model);
        if (opts.missionId) {
          args.push("-c", `mcp_servers.cockpit.command=${JSON.stringify(process.execPath.replaceAll("\\", "/"))}`);
          args.push("-c", `mcp_servers.cockpit.args=${JSON.stringify([MCP_SCRIPT.replaceAll("\\", "/")])}`);
          for (const [key, value] of Object.entries(this.mcpEnv(paneId, opts, spec, maestro))) {
            args.push("-c", `mcp_servers.cockpit.env.${key}=${JSON.stringify(value)}`);
          }
        }
      }

      if (familia === "grok") {
        if (autoAprovar) {
          args.push("--always-approve");
        }
        if (spec.model) args.push("-m", spec.model);
        if (spec.effort) args.push("--reasoning-effort", spec.effort);
        const regras = [
          spec.papel,
          "Canal real: cockpit_list / cockpit_ask / cockpit_inbox. Se houver Maestro, reporte a ele; sem Maestro, fale com os colegas. Não simule conversa nem leia o código do Cockpit.",
        ].filter((parte): parte is string => Boolean(parte?.trim()));
        if (regras.length) args.push("--rules", regras.join("\n\n"));
      }

      const porArgumento = Boolean(promptInicial) && ["claude", "agy", "codex", "grok"].includes(familia);
      if (porArgumento) {
        if (familia === "agy") args.push("--prompt-interactive", promptInicial!);
        else args.push(promptInicial!);
      }

      const resolved = resolveCli(spec.cli, args);
      file = resolved.file;
      argv = resolved.args;
      const rawCliEnv = { ...(config.clis[spec.cli]?.env ?? {}), ...(allocatedAccount?.env ?? {}) };
      const cliEnv = expandEnvPaths(rawCliEnv);
      if (familia === "agy") {
        const perfil =
          cliEnv.HOME ||
          cliEnv.JETSKI_APP_DATA_DIR ||
          allocatedAccount?.env?.HOME ||
          allocatedAccount?.env?.JETSKI_APP_DATA_DIR ||
          config.clis[spec.cli]?.env?.HOME ||
          config.clis[spec.cli]?.env?.JETSKI_APP_DATA_DIR;
        const perfilResolvido = perfil
          ? perfil.replace(/^~(?=$|\/)/, homedir()).replace(/^\$HOME(?=$|\/)/, homedir())
          : "";
        if (perfilResolvido) {
          materializarPerfilAgy(perfilResolvido);
          cliEnv.HOME = perfilResolvido;
          if (!cliEnv.JETSKI_APP_DATA_DIR) cliEnv.JETSKI_APP_DATA_DIR = perfilResolvido;
          if (opts.missionId) {
            this.gravarMcpAgyNoPerfil(paneId, opts, spec, maestro, perfilResolvido);
          }
        } else if (opts.missionId) {
          cliEnv.HOME = this.criarMcpAgyIsolado(paneId, opts, spec, maestro);
        }
      }
      if (familia === "grok" && opts.missionId) {
        const realHome =
          cliEnv.GROK_HOME ||
          allocatedAccount?.env?.GROK_HOME ||
          config.clis[spec.cli]?.env?.GROK_HOME ||
          join(homedir(), ".grok");
        const resolvedHome = realHome.replace(/^~(?=$|\/)/, homedir()).replace(/^\$HOME(?=$|\/)/, homedir());
        cliEnv.GROK_HOME = this.criarMcpGrokIsolado(paneId, opts, spec, maestro, resolvedHome);
      }
      const currentPath = process.env.PATH ?? "";
      const pathWithBin = pathComExecutaveisLocais(currentPath);
      env = {
        ...ambienteLimpo(),
        ...cliEnv,
        ...envDaPonte(spec.cli),
        ...envDaDshApi(spec.cli),
        PATH: pathWithBin,
        COCKPIT_PORT: String(opts.porta),
        COCKPIT_MISSION: opts.missionId ?? "",
        COCKPIT_PROJECT: opts.projectId ?? "",
        COCKPIT_AGENT: spec.label,
        COCKPIT_PANE: paneId,
        COCKPIT_MAESTRO: maestro ? "1" : "0",
        COCKPIT_MAESTRO_BRIDGE: BRIDGE_SCRIPT,
      } as Record<string, string>;
    }

    const visualDoPapel = !opts.loginArgs
      ? identidadeVisualDoPapel(opts.role, opts.roleDefinition)
      : undefined;
    const state: PaneState = {
      paneId,
      agent: opts.agent,
      label: opts.loginArgs
        ? (opts.label ?? `Login (${bundle.cli}): ${allocatedAccount?.label || allocatedAccount?.id || bundle.cli}`)
        : visualDoPapel?.label
          ?? opts.label
          ?? (isBash ? (opts.agent === "shell" ? "Shell" : opts.agent) : (config.agents[opts.agent]?.label ?? opts.agent)),
      cor: isBash ? "#4ade80" : visualDoPapel?.cor ?? config.agents[opts.agent]?.cor ?? "#94a3b8",
      cli: isBash ? "bash" : bundle.cli,
      role: opts.role ?? (isBash ? "shell" : opts.agent),
      runner: opts.runner ?? (isBash ? "bash" : bundle.cli),
      model: isBash ? null : bundle.model ?? null,
      effort: isBash ? null : bundle.effort ?? null,
      tipo: opts.harness?.tipo ?? null,
      tarefa: opts.tarefa ?? null,
      cwd: opts.cwd,
      projectId: opts.projectId,
      missionId: opts.missionId,
      sessionId,
      maestro,
      accountId: allocatedAccount?.id ?? null,
      accountLabel: allocatedAccount?.label ?? null,
      accountPinned: Boolean(opts.accountPinned && allocatedAccount?.id),
      backend: effectiveBackend,
      connected: true,
      attachedRunner: null,
      status: "starting",
      bytesIn: 0,
      bytesOut: 0,
      iniciadoEm: Date.now(),
      atualizadoEm: Date.now(),
      atividade: PaneActivityTracker.createInitialSparkline(DEFAULT_SPARKLINE_SLOTS),
    };

    const entry: ManagerPaneEntry = {
      state,
      onOutput,
      onExit,
      lastData: Date.now(),
      acumulado: 0,
      inputBuffer: "",
    };
    this.ptys.set(paneId, entry);
    this.savePaneToDisk(state);

    // Seam DSH: depois de harness/pool/papel/env/PaneState, antes do spawn PTY.
    if (!isBash && state.backend === "dsh") {
      const dsh = getDshManager();
      const emit = (data: string) => {
        entry.state.bytesOut += data.length;
        entry.state.atualizadoEm = Date.now();
        if (hasSignificantTerminalOutput(data)) {
          entry.lastData = Date.now();
          entry.acumulado += data.length;
          const norm = normalizePaneStatus(entry.state.status);
          if (norm === "starting" || norm === "waiting-user") {
            try {
              transitionPane(entry.state, "working");
            } catch {
              // Ignored
            }
          }
        }
        if (entry.onOutput) entry.onOutput(data);
        for (const listener of this.globalOutputListeners) listener(paneId, data);
      };
      void dsh
        .spawn({
          paneId,
          state,
          cwd: opts.cwd,
          tarefa: dshInitialPrompt,
          env,
          model: state.model,
          onOutput: emit,
          onExit: (code) => {
            accountPool.release(paneId);
            entry.state.connected = false;
            entry.state.status = "dead";
            entry.state.exitCode = code;
            this.savePaneToDisk(entry.state);
            this.limparMcpAgy(paneId);
            if (entry.onExit) entry.onExit(code);
            for (const listener of this.globalExitListeners) listener(paneId, code, entry.state);
          },
        })
        .catch((err) => {
          accountPool.release(paneId);
          state.connected = false;
          state.status = "failed";
          state.blockedReason = err instanceof Error ? err.message : String(err);
          this.limparMcpAgy(paneId);
          this.savePaneToDisk(state);
          if (onExit) onExit(1);
        });
      return state;
    }

    // Forward spawn request to decoupled PTY host daemon
    this.client
      .connect()
      .then(() =>
        this.client.spawn({
          paneId,
          file,
          args: argv,
          cwd: opts.cwd,
          env,
          initialState: {
            agent: state.agent,
            label: state.label,
            cor: state.cor,
            cli: state.cli,
            role: state.role,
            runner: state.runner,
            model: state.model,
            effort: state.effort,
            tipo: state.tipo,
            projectId: state.projectId,
            missionId: state.missionId,
            sessionId: state.sessionId,
            maestro: state.maestro,
            accountId: state.accountId,
            accountLabel: state.accountLabel,
            accountPinned: state.accountPinned,
            backend: state.backend,
            connected: state.connected,
            attachedRunner: state.attachedRunner,
          },
        }),
      )
      .catch((err) => {
        accountPool.release(paneId);
        state.connected = false;
        state.status = "failed";
        state.blockedReason = err.message;
        this.limparMcpAgy(paneId);
        this.savePaneToDisk(state);
        if (onExit) onExit(1);
      });

    return state;
  }

  public writePty(paneId: string, data: string): void {
    const entry = this.ptys.get(paneId);
    if (!entry || entry.state.status === "dead" || entry.state.connected === false) return;
    this.registrarEntradaManual(entry, data);
    entry.state.bytesIn += data.length;
    entry.lastData = Date.now();
    entry.state.atualizadoEm = Date.now();
    if (getDshManager().has(paneId)) {
      getDshManager().write(paneId, data);
      return;
    }
    this.client.input(paneId, data).catch(() => {
      entry.state.status = "dead";
      entry.state.connected = false;
      this.limparMcpAgy(paneId);
    });
  }

  public async submitPrompt(paneId: string, prompt: string): Promise<boolean> {
    const entry = this.ptys.get(paneId);
    if (!entry || entry.state.status === "dead" || entry.state.connected === false) return false;
    const clean = prompt.trim();
    if (!clean) return false;
    if (entry.state.backend !== "dsh" || !getDshManager().has(paneId)) return false;
    return await getDshManager().submitPrompt(paneId, clean);
  }

  public resizePty(paneId: string, cols: number, rows: number): void {
    const entry = this.ptys.get(paneId);
    if (!entry || entry.state.status === "dead" || entry.state.connected === false) return;
    if (getDshManager().has(paneId)) {
      getDshManager().resize(paneId, cols, rows);
      return;
    }
    this.client.resize(paneId, cols, rows).catch(() => {
      entry.state.status = "dead";
      entry.state.connected = false;
      this.limparMcpAgy(paneId);
    });
  }

  public listPanes(): PaneState[] {
    return Array.from(this.ptys.values()).map((e) => e.state);
  }

  public getPane(paneId: string): PaneState | undefined {
    return this.ptys.get(paneId)?.state;
  }

  public updatePane(paneId: string, patch: Partial<PaneState>): PaneState | undefined {
    const entry = this.ptys.get(paneId);
    if (!entry) return undefined;
    Object.assign(entry.state, patch);
    entry.state.atualizadoEm = Date.now();
    this.savePaneToDisk(entry.state);
    return entry.state;
  }

  public killPty(paneId: string): void {
    accountPool.release(paneId);
    const entry = this.ptys.get(paneId);
    if (!entry) return;
    if (getDshManager().has(paneId)) {
      // Não fire-and-forget puro: enfileira reap para flushDshKills / stopPane.
      this.pendingDshKills.push(
        getDshManager()
          .kill(paneId, 0)
          .catch(() => {}),
      );
      entry.state.status = "dead";
      entry.state.connected = false;
      this.ptys.delete(paneId);
      this.savePaneToDisk(entry.state);
      this.limparMcpAgy(paneId);
      return;
    }
    entry.state.status = "dead";
    entry.state.connected = false;
    this.ptys.delete(paneId);
    this.savePaneToDisk(entry.state);
    this.limparMcpAgy(paneId);
    this.client.kill(paneId).catch(() => {});
  }

  /** Espera todos os reaps DSH pendentes de killPty (anti-zumbi). */
  public async flushDshKills(): Promise<void> {
    const pending = this.pendingDshKills.splice(0);
    if (pending.length === 0) return;
    await Promise.allSettled(pending);
  }

  public async stopPane(paneId: string): Promise<void> {
    accountPool.release(paneId);
    const entry = this.ptys.get(paneId);
    if (!entry) return;
    if (getDshManager().has(paneId)) {
      await getDshManager().kill(paneId, 0);
      entry.state.status = "dead";
      entry.state.connected = false;
      this.ptys.delete(paneId);
      this.savePaneToDisk(entry.state);
      this.limparMcpAgy(paneId);
      return;
    }
    entry.state.status = "dead";
    entry.state.connected = false;
    this.ptys.delete(paneId);
    this.savePaneToDisk(entry.state);
    this.limparMcpAgy(paneId);
    await this.client.kill(paneId);
  }

  public async replayPane(paneId: string): Promise<string> {
    if (getDshManager().has(paneId)) {
      return getDshManager().getTranscript(paneId);
    }
    return await this.client.replay(paneId);
  }

  public tick(onPulse: (state: PaneState) => void): void {
    const agora = Date.now();
    for (const entry of this.ptys.values()) {
      if (entry.state.status !== "dead") {
        if (!entry.state.atividade || entry.state.atividade.length !== DEFAULT_SPARKLINE_SLOTS) {
          entry.state.atividade = new Array<number>(DEFAULT_SPARKLINE_SLOTS).fill(0);
        }
        entry.state.atividade.push(entry.acumulado);
        if (entry.state.atividade.length > DEFAULT_SPARKLINE_SLOTS) {
          entry.state.atividade.shift();
        }
        entry.acumulado = 0;

        const isIdle = agora - entry.lastData > DEFAULT_IDLE_TIMEOUT_MS;
        const norm = normalizePaneStatus(entry.state.status);
        if ((norm === "working" || norm === "starting") && isIdle) {
          try {
            transitionPane(entry.state, "waiting-user");
          } catch {
            // Ignored
          }
        } else if (norm === "waiting-user" && !isIdle) {
          try {
            transitionPane(entry.state, "working");
          } catch {
            // Ignored
          }
        }

        onPulse(entry.state);
      }
    }
  }
}

// Global default singleton manager
let defaultPtyManager: PtyManager | null = null;

export function getDefaultPtyManager(): PtyManager {
  if (!defaultPtyManager) {
    defaultPtyManager = new PtyManager();
  }
  return defaultPtyManager;
}
