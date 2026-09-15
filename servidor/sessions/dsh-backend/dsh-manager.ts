/**
 * Espelha o subconjunto de PtyManager usado pelos panes DSH (KD-A: 1 SDK/pane).
 * write → session/prompt (não stdin PTY). kill → close/reap. resize → no-op.
 */
import type { PaneState } from "../pane-state.ts";
import { createDshRuntime, type DshRuntimeHandle } from "./dsh-runtime.ts";
import {
  autoAprovarAtivo,
  resolveCodexHome,
  sandboxDoCli,
  writePaneCordisPatch,
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
  sessionId: string;
  transcript: string;
  promptQueue: Promise<void>;
  subscriptionCloser?: () => void;
  onOutput?: (data: string) => void;
  onExit?: (code: number) => void;
  closed: boolean;
};

export class DshManager {
  private panes = new Map<string, DshPaneEntry>();

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
    const patch = writePaneCordisPatch({
      cli,
      model: opts.model ?? opts.state.model,
      codexHome,
      autoAprovar: autoAprovarAtivo(),
      sandbox: sandboxDoCli(cli),
    });

    const runtime = await createDshRuntime({
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv | undefined,
      provider: opts.provider,
      // Handshake do cérebro: não hardcodar OmniRoute — model do pane se houver.
      model: opts.model ?? opts.state.model ?? undefined,
      patches: patch ? [patch] : undefined,
    });

    const entry: DshPaneEntry = {
      state: opts.state,
      runtime,
      sessionId,
      transcript: "",
      promptQueue: Promise.resolve(),
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
            const line = notificationToTranscript(n.method, n.params ?? {});
            if (line) {
              opts.state.status = "working";
              this.emit(opts.paneId, line.endsWith("\n") ? line : `${line}`);
            }
            if (n.method === "agent.idle" || n.method.endsWith(".idle")) {
              opts.state.status = "waiting-user";
            }
          } catch {
            break;
          }
        }
      })();

      if (opts.tarefa && opts.tarefa.trim()) {
        await this.enqueuePrompt(opts.paneId, opts.tarefa.trim());
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
    if (!text.trim()) return;
    entry.state.bytesIn += data.length;
    void this.enqueuePrompt(paneId, text);
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
    entry.subscriptionCloser?.();
    try {
      await entry.runtime.close();
    } catch {
      /* reap best-effort */
    }
    entry.state.status = "dead";
    entry.state.exitCode = code;
    this.panes.delete(paneId);
    entry.onExit?.(code);
  }

  private enqueuePrompt(paneId: string, text: string): Promise<void> {
    const entry = this.panes.get(paneId);
    if (!entry || entry.closed) return Promise.resolve();
    entry.promptQueue = entry.promptQueue
      .then(async () => {
        if (entry.closed) return;
        entry.state.status = "working";
        const client = entry.runtime.getClient() as unknown as ClientWithPrompt;
        await client.prompt(entry.sessionId, textPromptBlocks(text));
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.emit(paneId, `\r\n[dsh:prompt-error] ${msg}\r\n`);
        entry.state.status = "waiting-user";
      });
    return entry.promptQueue;
  }

  private emit(paneId: string, data: string): void {
    const entry = this.panes.get(paneId);
    if (!entry) return;
    entry.transcript += data;
    entry.state.bytesOut += data.length;
    entry.state.atualizadoEm = Date.now();
    entry.onOutput?.(data);
  }
}

let defaultManager: DshManager | null = null;

export function getDshManager(): DshManager {
  if (!defaultManager) defaultManager = new DshManager();
  return defaultManager;
}
