import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFile, execFileSync } from "node:child_process";

import { config, backendDo, type AgentSpec } from "../config.ts";
import { CASA } from "../state.ts";
import { confiar } from "../confianca.ts";
import { definirModelo } from "../agy.ts";
import { resolverHarness, type Pedido } from "../harness.ts";
import { providerDisponivel } from "../providers.ts";
import { argsDaPonte, envDaPonte, pontede } from "../ponte.ts";
import { getDefaultPaneStore } from "../persistence/index.ts";
import { accountPool } from "../providers/account-pool.ts";
import { getDshManager } from "./dsh-backend/dsh-manager.ts";

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
  runner?: string;
};

export interface ManagerPaneEntry {
  state: PaneState;
  onOutput?: (data: string) => void;
  onExit?: (code: number) => void;
  lastData: number;
  acumulado: number;
}

const MCP_SCRIPT = fileURLToPath(new URL("../mcp-maestro.ts", import.meta.url));
const BRIDGE_SCRIPT = fileURLToPath(new URL("../maestro-cli.ts", import.meta.url));

const executaveis = new Map<string, string | null>();

function acharExe(comando: string): string | null {
  if (!executaveis.has(comando)) {
    let achado: string | null = null;
    try {
      const linhas = execFileSync("where", [comando], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).split(/\r?\n/);
      achado = linhas.find((l) => l.trim().toLowerCase().endsWith(".exe"))?.trim() ?? null;

      if (!achado && comando.toLowerCase() === "codex") {
        const shim = linhas.find((l) => l.trim().toLowerCase().endsWith("codex.cmd"))?.trim();
        const plataforma = process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
        const alvo = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
        const nativo =
          shim &&
          join(
            dirname(shim),
            "node_modules",
            "@openai",
            "codex",
            "node_modules",
            "@openai",
            plataforma,
            "vendor",
            alvo,
            "bin",
            "codex.exe",
          );
        if (nativo && existsSync(nativo)) achado = nativo;
      }
    } catch {
      achado = null;
    }
    executaveis.set(comando, achado);
  }
  return executaveis.get(comando) ?? null;
}

export function resolveCli(cli: string, extra: string[]): { file: string; args: string[] } {
  const spec = config.clis[cli] ?? { command: cli };
  const args = [...(spec.args ?? []), ...extra];
  if (process.platform !== "win32") return { file: spec.command, args };
  if (/[\\/]/.test(spec.command) || spec.command.toLowerCase().endsWith(".exe")) {
    return { file: spec.command, args };
  }
  const exe = acharExe(spec.command);
  if (exe) return { file: exe, args };
  const comspec = process.env.ComSpec ?? "cmd.exe";
  return { file: comspec, args: ["/c", spec.command, ...args] };
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
  private globalExitListeners = new Set<(paneId: string, code: number) => void>();

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

  public onExit(listener: (paneId: string, code: number) => void): () => void {
    this.globalExitListeners.add(listener);
    return () => this.globalExitListeners.delete(listener);
  }

  public setGlobalHandlers(
    onOutput: (paneId: string, data: string) => void,
    onExit: (paneId: string, code: number) => void,
  ): void {
    this.globalOutputListeners.add(onOutput);
    this.globalExitListeners.add(onExit);
  }

  private setupClientEvents(): void {
    this.client.on("output", (paneId: string, data: string) => {
      const entry = this.ptys.get(paneId);
      if (entry) {
        entry.lastData = Date.now();
        entry.acumulado += data.length;
        entry.state.bytesOut += data.length;
        if (normalizePaneStatus(entry.state.status) === "starting" || normalizePaneStatus(entry.state.status) === "waiting-user") {
          try {
            transitionPane(entry.state, "working");
          } catch {
            // Ignored
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
      accountPool.release(paneId);
      const entry = this.ptys.get(paneId);
      if (entry) {
        try {
          transitionPane(entry.state, status, { exitCode: code });
        } catch {
          entry.state.status = status;
          entry.state.exitCode = code;
        }
        this.savePaneToDisk(entry.state);
        if (entry.onExit) entry.onExit(code);
        this.ptys.delete(paneId);
      }
      for (const listener of this.globalExitListeners) {
        try {
          listener(paneId, code);
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
        this.savePaneToDisk(entry.state);
      }
    });

    this.client.on("pulse", (pulses: Array<{ paneId: string; status: PaneStatus; atividade: number[]; bytesIn: number; bytesOut: number }>) => {
      for (const p of pulses) {
        const entry = this.ptys.get(p.paneId);
        if (entry) {
          entry.state.status = p.status;
          entry.state.atividade = p.atividade;
          entry.state.bytesIn = p.bytesIn;
          entry.state.bytesOut = p.bytesOut;
        }
      }
    });

    this.client.on("connected", async () => {
      await this.syncSurvivingPanes();
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
        let entry = this.ptys.get(pane.paneId);
        if (!entry) {
          entry = {
            state: pane,
            lastData: Date.now(),
            acumulado: 0,
          };
          this.ptys.set(pane.paneId, entry);
        } else {
          entry.state = pane;
        }
        this.savePaneToDisk(entry.state);
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
        status: normalizePaneStatus(state.status),
        iniciadoEm: state.iniciadoEm,
        atualizadoEm: Date.now(),
      });
    } catch {
      // Persistence store might be mock or uninitialized
    }
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
    let env: Record<string, string>;
    let bundle: { cli: string; model?: string; effort?: string } = { cli: "bash" };
    let sessionId: string | null = null;
    let maestro = opts.maestro ?? false;
    let allocatedAccount: { id: string; label: string; env: Record<string, string>; args: string[] } | null = null;

    let isBash = initialClean;
    if (!isBash) {
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
      } else if (!providerDisponivel(bundle.cli)) {
        throw new Error(`Executor "${bundle.cli}" não disponível no sistema`);
      }
    }

    if (isBash) {
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
    } else {
      // LLM Specialist or Maestro
      const perfil = agentSpec(opts.agent);
      if (!bundle.model && !bundle.effort) {
        bundle = resolverHarness({ agent: opts.agent, runner: opts.runner, ...(opts.harness ?? {}) });
      }
      if (!providerDisponivel(bundle.cli)) {
        throw new Error(`Executor "${bundle.cli}" não disponível no sistema`);
      }
      const spec: AgentSpec = { ...perfil, cli: bundle.cli, model: bundle.model, effort: bundle.effort };
      if (!isBash) {
        allocatedAccount = accountPool.acquire(spec.cli, paneId);
      }
      const args: string[] = [...(spec.args ?? []), ...(allocatedAccount?.args ?? [])];
      const familia = familiaDo(spec.cli);
      maestro = opts.maestro ?? spec.maestro === true;

      const ponte = pontede(spec.cli);
      if (ponte && !envDaPonte(spec.cli)[ponte.spec.chaveEnv]) {
        throw new Error(
          `${spec.cli} precisa de uma chave antes de abrir painel — ponha em Ajustes → Grátis, ou exporte ${ponte.spec.chaveEnv}`,
        );
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

        if (maestro && opts.missionId) {
          const caminho = join(CASA, "mcp", `${opts.missionId}.json`);
          mkdirSync(dirname(caminho), { recursive: true });
          writeFileSync(
            caminho,
            JSON.stringify({
              mcpServers: {
                cockpit: {
                  command: process.execPath,
                  args: [MCP_SCRIPT],
                  env: {
                    COCKPIT_PORT: String(opts.porta),
                    COCKPIT_MISSION: opts.missionId,
                    COCKPIT_PROJECT: opts.projectId ?? "",
                    COCKPIT_AGENT: spec.label,
                  },
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

      let promptInicial = opts.tarefa;

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
        if (spec.effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(spec.effort)}`);
        if (spec.papel) {
          promptInicial = promptInicial ? `${spec.papel}\n\n${promptInicial}` : spec.papel;
        }
        if (maestro && opts.missionId) {
          args.push("-c", `mcp_servers.cockpit.command=${JSON.stringify(process.execPath.replaceAll("\\", "/"))}`);
          args.push("-c", `mcp_servers.cockpit.args=${JSON.stringify([MCP_SCRIPT.replaceAll("\\", "/")])}`);
          for (const [key, value] of Object.entries({
            COCKPIT_PORT: String(opts.porta),
            COCKPIT_MISSION: opts.missionId,
            COCKPIT_PROJECT: opts.projectId ?? "",
            COCKPIT_AGENT: spec.label,
          })) {
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
        if (spec.papel) args.push("--rules", spec.papel);
      }

      const porArgumento = Boolean(promptInicial) && ["claude", "agy", "codex", "grok"].includes(familia);
      if (porArgumento) {
        if (familia === "agy") args.push("--prompt-interactive", promptInicial!);
        else args.push(promptInicial!);
      }

      const resolved = resolveCli(spec.cli, args);
      file = resolved.file;
      argv = resolved.args;
      const cliEnv = { ...(config.clis[spec.cli]?.env ?? {}), ...(allocatedAccount?.env ?? {}) };
      if (cliEnv.CODEX_HOME) {
        cliEnv.CODEX_HOME = cliEnv.CODEX_HOME
          .replace(/^~(?=$|\/)/, homedir())
          .replace(/^\$HOME(?=$|\/)/, homedir());
      }
      if (cliEnv.JETSKI_APP_DATA_DIR) {
        cliEnv.JETSKI_APP_DATA_DIR = cliEnv.JETSKI_APP_DATA_DIR
          .replace(/^~(?=$|\/)/, homedir())
          .replace(/^\$HOME(?=$|\/)/, homedir());
      }
      if (cliEnv.HOME) {
        cliEnv.HOME = cliEnv.HOME
          .replace(/^~(?=$|\/)/, homedir())
          .replace(/^\$HOME(?=$|\/)/, homedir());
      }
      if (cliEnv.GROK_HOME) {
        cliEnv.GROK_HOME = cliEnv.GROK_HOME
          .replace(/^~(?=$|\/)/, homedir())
          .replace(/^\$HOME(?=$|\/)/, homedir());
      }
      const binDir = resolve(process.cwd(), "bin");
      const currentPath = process.env.PATH ?? "";
      const pathWithBin = currentPath.includes(binDir) ? currentPath : `${binDir}:${currentPath}`;
      env = {
        ...ambienteLimpo(),
        ...cliEnv,
        ...envDaPonte(spec.cli),
        PATH: pathWithBin,
        COCKPIT_PORT: String(opts.porta),
        COCKPIT_MISSION: opts.missionId ?? "",
        COCKPIT_PROJECT: opts.projectId ?? "",
        COCKPIT_AGENT: spec.label,
        COCKPIT_PANE: paneId,
        COCKPIT_MAESTRO_BRIDGE: BRIDGE_SCRIPT,
      } as Record<string, string>;
    }

    const state: PaneState = {
      paneId,
      agent: opts.agent,
      label: isBash
        ? (opts.agent === "shell" ? "Shell" : (opts.label ?? opts.agent))
        : (opts.label ?? config.agents[opts.agent]?.label ?? opts.agent),
      cor: isBash ? "#4ade80" : config.agents[opts.agent]?.cor ?? "#94a3b8",
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
    };
    this.ptys.set(paneId, entry);
    this.savePaneToDisk(state);

    // Seam DSH: depois de harness/pool/papel/env/PaneState, antes do spawn PTY.
    // cockpit.json continua pty implícito até PR-4; só entra aqui com backend:"dsh".
    if (!isBash && backendDo(state.cli) === "dsh") {
      const dsh = getDshManager();
      const emit = (data: string) => {
        entry.state.bytesOut += data.length;
        entry.state.atualizadoEm = Date.now();
        entry.lastData = Date.now();
        if (entry.onOutput) entry.onOutput(data);
        for (const listener of this.globalOutputListeners) listener(paneId, data);
      };
      void dsh
        .spawn({
          paneId,
          state,
          cwd: opts.cwd,
          tarefa: opts.tarefa,
          env,
          model: state.model,
          onOutput: emit,
          onExit: (code) => {
            accountPool.release(paneId);
            entry.state.status = "dead";
            entry.state.exitCode = code;
            this.savePaneToDisk(entry.state);
            if (entry.onExit) entry.onExit(code);
            for (const listener of this.globalExitListeners) listener(paneId, code);
          },
        })
        .catch((err) => {
          accountPool.release(paneId);
          state.status = "failed";
          state.blockedReason = err instanceof Error ? err.message : String(err);
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
          },
        }),
      )
      .catch((err) => {
        accountPool.release(paneId);
        state.status = "failed";
        state.blockedReason = err.message;
        if (onExit) onExit(1);
      });

    return state;
  }

  public writePty(paneId: string, data: string): void {
    const entry = this.ptys.get(paneId);
    if (!entry || entry.state.status === "dead") return;
    entry.state.bytesIn += data.length;
    if (getDshManager().has(paneId)) {
      getDshManager().write(paneId, data);
      return;
    }
    this.client.input(paneId, data).catch(() => {
      entry.state.status = "dead";
    });
  }

  public resizePty(paneId: string, cols: number, rows: number): void {
    const entry = this.ptys.get(paneId);
    if (!entry || entry.state.status === "dead") return;
    if (getDshManager().has(paneId)) {
      getDshManager().resize(paneId, cols, rows);
      return;
    }
    this.client.resize(paneId, cols, rows).catch(() => {
      entry.state.status = "dead";
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
      void getDshManager().kill(paneId, 0);
      entry.state.status = "dead";
      this.ptys.delete(paneId);
      this.savePaneToDisk(entry.state);
      return;
    }
    entry.state.status = "dead";
    this.ptys.delete(paneId);
    this.savePaneToDisk(entry.state);
    this.client.kill(paneId).catch(() => {});
  }

  public async stopPane(paneId: string): Promise<void> {
    accountPool.release(paneId);
    const entry = this.ptys.get(paneId);
    if (!entry) return;
    if (getDshManager().has(paneId)) {
      await getDshManager().kill(paneId, 0);
      entry.state.status = "dead";
      this.ptys.delete(paneId);
      this.savePaneToDisk(entry.state);
      return;
    }
    entry.state.status = "dead";
    this.ptys.delete(paneId);
    this.savePaneToDisk(entry.state);
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
        if (norm === "working" && isIdle) {
          try {
            transitionPane(entry.state, "waiting-user");
          } catch {
            // Ignored
          }
        } else if (norm === "waiting-user" && !isIdle && entry.state.bytesOut > 0) {
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
