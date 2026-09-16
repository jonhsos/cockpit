/**
 * Espelha o subconjunto de PtyManager usado pelos panes DSH (KD-A: 1 SDK/pane).
 * write → session/prompt (não stdin PTY). kill → close/reap. resize → no-op.
 */
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import type { PaneState } from "../pane-state.ts";
import { createDshRuntime, type DshRuntimeHandle } from "./dsh-runtime.ts";
import {
  autoAprovarAtivo,
  resolveCodexHome,
  sandboxDoCli,
  createPaneDshRuntimeConfig,
} from "./dsh-pane-config.ts";
import {
  extractPromptText,
  notificationToTranscript,
  sessionIdForPane,
  textPromptBlocks,
} from "./dsh-session-bridge.ts";

export type DshSpawnOpts = {
  paneId: string;
  state: PaneState;
  cwd: string;
  tarefa?: string | null;
  /** Overlay de env da conta (CODEX_HOME etc.) — propagado ao child DSH. */
  env?: Record<string, string>;
  /** Rota do cérebro no handshake; OmniRoute/modelo do usuário no PR-4. */
  provider?: string;
  model?: string | null;
  onOutput?: (data: string) => void;
  onExit?: (code: number) => void;
};

type ClientWithPrompt = {
  prompt(sessionId: string, contentBlocks: Array<{ type: "text"; text: string }>): Promise<string>;
  subscribe(filter?: (n: { method: string; params: Record<string, unknown> }) => boolean): {
    next(): Promise<{ method: string; params: Record<string, unknown> }>;
    close(): void;
  };
};

type DshPaneEntry = {
  state: PaneState;
  runtime: DshRuntimeHandle;
  patchPath?: string;
  sessionId: string;
  transcript: string;
  promptQueue: Promise<void>;
  pendingPromptCount: number;
  idleGeneration: number;
  recentReceipts: Map<string, number>;
  activeTurn?: {
    messageId?: string;
    receiptGeneration?: number;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  subscriptionCloser?: () => void;
  onOutput?: (data: string) => void;
  onExit?: (code: number) => void;
  closed: boolean;
};

export const MAX_DSH_PROMPT_LENGTH = 64 * 1024;
export const MAX_DSH_PROMPT_QUEUE = 20;
const DSH_TURN_TIMEOUT_MS = 30 * 60 * 1000;

function receiptIds(params: Record<string, unknown>): string[] {
  const event = params.event;
  if (!event || typeof event !== "object") return [];
  const envelope = event as Record<string, unknown>;
  if (envelope.type !== "agent/inbox/spliced") return [];
  const data = envelope.data;
  if (!data || typeof data !== "object") return [];
  const inserted = (data as Record<string, unknown>).inserted;
  if (!Array.isArray(inserted)) return [];
  return inserted.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const id = (message as Record<string, unknown>).id;
    return typeof id === "string" ? [id] : [];
  });
}

export class DshManager {
  private panes = new Map<string, DshPaneEntry>();
  private readonly runtimeFactory: typeof createDshRuntime;

  constructor(runtimeFactory: typeof createDshRuntime = createDshRuntime) {
    this.runtimeFactory = runtimeFactory;
  }

  public has(paneId: string): boolean {
    return this.panes.has(paneId);
  }

  public getTranscript(paneId: string): string {
    return this.panes.get(paneId)?.transcript ?? "";
  }

  /**
   * Sobe 1 processo SDK, initialize, opcionalmente primeira prompt (tarefa).
   */
  public async spawn(opts: DshSpawnOpts): Promise<void> {
    const sessionId = sessionIdForPane(opts.paneId);
    opts.state.sessionId = sessionId;
    opts.state.status = "starting";

    const cli = opts.state.cli;
    const codexHome = opts.env ? resolveCodexHome(opts.env) : undefined;
    const paneRuntime = createPaneDshRuntimeConfig({
      cli,
      model: opts.model ?? opts.state.model,
      codexHome,
      autoAprovar: autoAprovarAtivo(),
      sandbox: sandboxDoCli(cli),
    });

    if (paneRuntime && !opts.env?.[paneRuntime.credentialEnv]) {
      rmSync(dirname(paneRuntime.patchPath), { recursive: true, force: true });
      throw new Error(`Credencial ${paneRuntime.credentialEnv} não está disponível para o gateway DSH`);
    }

    let runtime: DshRuntimeHandle;
    try {
      runtime = await this.runtimeFactory({
        cwd: opts.cwd,
        env: opts.env as NodeJS.ProcessEnv | undefined,
        provider: opts.provider ?? paneRuntime?.provider,
        model: paneRuntime?.model ?? opts.model ?? opts.state.model ?? undefined,
        patches: paneRuntime ? [paneRuntime.patchPath] : undefined,
      });
    } catch (error) {
      if (paneRuntime) rmSync(dirname(paneRuntime.patchPath), { recursive: true, force: true });
      throw error;
    }

    const entry: DshPaneEntry = {
      state: opts.state,
      runtime,
      patchPath: paneRuntime?.patchPath,
      sessionId,
      transcript: "",
      promptQueue: Promise.resolve(),
      pendingPromptCount: 0,
      idleGeneration: 0,
      recentReceipts: new Map(),
      onOutput: opts.onOutput,
      onExit: opts.onExit,
      closed: false,
    };
    this.panes.set(opts.paneId, entry);

    try {
      const init = await runtime.start();
      this.emit(opts.paneId, `\r\n[dsh] runtime ${init.serverInfo.name} (${runtime.pinnedVersion})\r\n`);
      opts.state.status = "waiting-user";

      const client = runtime.getClient() as unknown as ClientWithPrompt;
      const sub = client.subscribe();
      let pump = true;
      entry.subscriptionCloser = () => {
        pump = false;
        try {
          sub.close();
        } catch {
          /* ignore */
        }
      };
      void (async () => {
        while (pump && !entry.closed) {
          try {
            const n = await sub.next();
            const notificationSessionId = typeof n.params?.sessionId === "string" ? n.params.sessionId : null;
            const line = notificationToTranscript(n.method, n.params ?? {});
            if (line) {
              opts.state.status = "working";
              opts.state.blockedReason = null;
              opts.state.atualizadoEm = Date.now();
              this.emit(opts.paneId, line.endsWith("\n") ? line : `${line}`);
            }

            if (n.method === "session.event" && notificationSessionId === entry.sessionId) {
              for (const messageId of receiptIds(n.params ?? {})) {
                entry.recentReceipts.set(messageId, entry.idleGeneration);
                if (entry.recentReceipts.size > MAX_DSH_PROMPT_QUEUE * 2) {
                  const oldest = entry.recentReceipts.keys().next().value;
                  if (oldest) entry.recentReceipts.delete(oldest);
                }
                if (entry.activeTurn?.messageId === messageId) {
                  entry.activeTurn.receiptGeneration = entry.idleGeneration;
                }
              }
            }

            if (
              n.method === "session.status" &&
              notificationSessionId === entry.sessionId &&
              n.params?.status === "idle"
            ) {
              entry.idleGeneration += 1;
              opts.state.status = "waiting-user";
              opts.state.atualizadoEm = Date.now();
              const turn = entry.activeTurn;
              if (turn?.receiptGeneration !== undefined && entry.idleGeneration > turn.receiptGeneration) {
                clearTimeout(turn.timer);
                entry.activeTurn = undefined;
                turn.resolve();
              }
            }
          } catch (err) {
            const turn = entry.activeTurn;
            if (turn) {
              clearTimeout(turn.timer);
              entry.activeTurn = undefined;
              turn.reject(err instanceof Error ? err : new Error(String(err)));
            }
            break;
          }
        }
      })();

      if (opts.tarefa && opts.tarefa.trim()) {
        await this.submitPrompt(opts.paneId, opts.tarefa.trim());
      }
    } catch (err) {
      opts.state.status = "failed";
      opts.state.blockedReason = err instanceof Error ? err.message : String(err);
      this.emit(opts.paneId, `\r\n[dsh:failed] ${opts.state.blockedReason}\r\n`);
      await this.kill(opts.paneId, 1);
      throw err;
    }
  }

  /** Enfileira session/prompt — não é stdin PTY. */
  public write(paneId: string, data: string): void {
    const entry = this.panes.get(paneId);
    if (!entry || entry.closed) return;
    const text = extractPromptText(data);
    const clean = text.trim();
    if (!clean || clean.length > MAX_DSH_PROMPT_LENGTH || entry.pendingPromptCount >= MAX_DSH_PROMPT_QUEUE) return;
    void this.enqueuePrompt(paneId, clean).catch(() => {});
  }

  /** resize: no-op no path DSH (documentado). */
  public resize(paneId: string, _cols: number, _rows: number): void {
    const entry = this.panes.get(paneId);
    if (!entry) return;
    // Transcript note once per pane would be noisy; silent no-op.
  }

  /** shutdown + reap; remove do mapa. */
  public async kill(paneId: string, code = 0): Promise<void> {
    const entry = this.panes.get(paneId);
    if (!entry) return;
    if (entry.closed) {
      this.panes.delete(paneId);
      return;
    }
    entry.closed = true;
    const turn = entry.activeTurn;
    if (turn) {
      clearTimeout(turn.timer);
      entry.activeTurn = undefined;
      turn.reject(new Error("Painel DSH encerrado durante a execução do prompt"));
    }
    entry.subscriptionCloser?.();
    try {
      await entry.runtime.close();
    } catch {
      /* reap best-effort */
    }
    if (entry.patchPath) {
      try {
        rmSync(dirname(entry.patchPath), { recursive: true, force: true });
      } catch {
        /* limpeza best-effort */
      }
    }
    entry.state.status = "dead";
    entry.state.exitCode = code;
    this.panes.delete(paneId);
    entry.onExit?.(code);
  }

  /** Submete instrução estruturada de prompt para o painel DSH. */
  public async submitPrompt(paneId: string, text: string): Promise<boolean> {
    const entry = this.panes.get(paneId);
    if (!entry || entry.closed) return false;
    const clean = text.trim();
    if (!clean) return false;
    if (clean.length > MAX_DSH_PROMPT_LENGTH) {
      throw new Error(`Prompt excede o limite de ${MAX_DSH_PROMPT_LENGTH} caracteres`);
    }
    if (entry.pendingPromptCount >= MAX_DSH_PROMPT_QUEUE) {
      throw new Error(`Fila DSH cheia (${MAX_DSH_PROMPT_QUEUE} prompts pendentes)`);
    }
    entry.state.bytesIn += clean.length;
    const task = this.enqueuePrompt(paneId, clean);
    void task.catch(() => {});
    return true;
  }

  private enqueuePrompt(paneId: string, text: string): Promise<void> {
    const entry = this.panes.get(paneId);
    if (!entry || entry.closed) return Promise.resolve();
    entry.pendingPromptCount += 1;
    const run = entry.promptQueue
      .catch(() => {})
      .then(async () => {
        if (entry.closed) return;
        entry.state.status = "working";
        entry.state.blockedReason = null;
        entry.state.atualizadoEm = Date.now();
        const formattedPrompt = text
          .split(/\r?\n/)
          .map((line) => `> ${line}`)
          .join("\r\n");
        this.emit(paneId, `\r\n${formattedPrompt}\r\n`);
        const client = entry.runtime.getClient() as unknown as ClientWithPrompt;
        const completion = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            if (entry.activeTurn?.timer !== timer) return;
            entry.activeTurn = undefined;
            reject(new Error(`Turno DSH excedeu ${Math.round(DSH_TURN_TIMEOUT_MS / 60_000)} minutos`));
          }, DSH_TURN_TIMEOUT_MS);
          entry.activeTurn = { resolve, reject, timer };
        });
        // O painel pode ser encerrado enquanto client.prompt() ainda aguarda o ACK.
        // Instale o handler já para não criar uma rejeição temporariamente não tratada.
        void completion.catch(() => {});

        try {
          const messageId = await client.prompt(entry.sessionId, textPromptBlocks(text));
          const turn = entry.activeTurn;
          if (!turn) throw new Error("Turno DSH encerrado antes da confirmação do prompt");
          turn.messageId = messageId;
          const receiptGeneration = entry.recentReceipts.get(messageId);
          if (receiptGeneration !== undefined) {
            turn.receiptGeneration = receiptGeneration;
            entry.recentReceipts.delete(messageId);
            if (entry.idleGeneration > receiptGeneration) {
              clearTimeout(turn.timer);
              entry.activeTurn = undefined;
              turn.resolve();
            }
          }
          await completion;
        } catch (err) {
          const turn = entry.activeTurn;
          if (turn) {
            clearTimeout(turn.timer);
            entry.activeTurn = undefined;
            turn.reject(err instanceof Error ? err : new Error(String(err)));
          }
          void completion.catch(() => {});
          throw err;
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.emit(paneId, `\r\n[dsh:prompt-error] ${msg}\r\n`);
        if (!entry.closed) {
          entry.state.status = "waiting-user";
          entry.state.blockedReason = msg;
          entry.state.atualizadoEm = Date.now();
        }
        throw err;
      })
      .finally(() => {
        entry.pendingPromptCount = Math.max(0, entry.pendingPromptCount - 1);
      });
    entry.promptQueue = run.catch(() => {});
    return run;
  }

  private emit(paneId: string, data: string): void {
    const entry = this.panes.get(paneId);
    if (!entry) return;
    entry.transcript += data;
    if (entry.transcript.length > 512 * 1024) {
      entry.transcript = entry.transcript.slice(-512 * 1024);
    }
    if (!entry.onOutput) {
      entry.state.bytesOut += data.length;
    }
    entry.state.atualizadoEm = Date.now();
    entry.onOutput?.(data);
  }
}

let defaultManager: DshManager | null = null;

export function getDshManager(): DshManager {
  if (!defaultManager) defaultManager = new DshManager();
  return defaultManager;
}
