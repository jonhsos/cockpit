/**
 * Runtime SDK do Cockpit sobre DeepSeek Harness (profile sdk).
 *
 * Pin: deepseek-harness 0.1.5-rc.2 via checkout local + dshBin.
 * Não importa @deepseek-ai/dsh-sdk-client pelo npm (workspace:*); carrega o
 * cliente compilado do checkout pinado.
 *
 * Riscos aceitos do SDK (documentar no fio):
 * - Sem session/cancel — cancel = close()/matar o processo (KD-A).
 * - Sem list/resume/close de primeira classe — sessionId = paneId no PR-3.
 * - Preview com breaking changes — pin de versão obrigatório.
 */
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  getDshBinPath,
  getDshHomePath,
  isDshHomeIsolated,
  PINNED_DSH_VERSION,
  DEFAULT_DSH_REPO_PATH,
} from "./dsh-availability.ts";

/** Caminho do entry compilado do SDK client pinado (0.1.5-rc.2). */
export function getDshSdkClientEntry(repoPath = DEFAULT_DSH_REPO_PATH): string {
  return join(repoPath, "packages/sdk/client/lib/index.js");
}

type HarnessClientLike = {
  start(): void;
  initialize(params: {
    cwd: string;
    provider: string;
    model: string;
    reasoningEffort?: string;
    maxTokens?: number;
  }): Promise<{ serverInfo: { name: string; version: string } }>;
  close(): Promise<void>;
};

type SdkModule = {
  HarnessClient: new (options?: Record<string, unknown>) => HarnessClientLike;
};

let sdkModulePromise: Promise<SdkModule> | null = null;

async function loadSdkModule(repoPath = DEFAULT_DSH_REPO_PATH): Promise<SdkModule> {
  if (!sdkModulePromise) {
    const entry = getDshSdkClientEntry(repoPath);
    sdkModulePromise = import(pathToFileURL(entry).href) as Promise<SdkModule>;
  }
  return sdkModulePromise;
}

export type DshRuntimeOptions = {
  /** Workspace cwd gravado no initialize (default: process.cwd()). */
  cwd?: string;
  dshHome?: string;
  dshBin?: string;
  dshRepoPath?: string;
  /**
   * Rota do cérebro do harness no handshake.
   * Não hardcodar modelo de produto OmniRoute aqui — PR-4 passa override por pane.
   * Smoke/PR-2 pode usar defaults só para provar o fio.
   */
  provider?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
  initializeTimeoutMs?: number;
};

export type DshRuntimeHandle = {
  /** Pin documentado. */
  readonly pinnedVersion: string;
  readonly dshBin: string;
  readonly dshHome: string;
  /** start + initialize. Idempotente se já iniciado. */
  start(): Promise<{ serverInfo: { name: string; version: string } }>;
  /** shutdown + reap (EOF → SIGTERM → SIGKILL). Idempotente. */
  close(): Promise<void>;
  /** Cliente bruto para PR-3 (prompt/subscribe). */
  getClient(): HarnessClientLike;
  isStarted(): boolean;
};

/**
 * Cria um runtime SDK (KD-A: um processo por handle; PR-3 amarra 1 handle/pane).
 */
export async function createDshRuntime(options: DshRuntimeOptions = {}): Promise<DshRuntimeHandle> {
  const dshBin = options.dshBin ? options.dshBin : getDshBinPath();
  const dshHome = options.dshHome ? options.dshHome : getDshHomePath();
  const repoPath = options.dshRepoPath ?? DEFAULT_DSH_REPO_PATH;

  if (!isDshHomeIsolated(dshHome)) {
    throw new Error(
      `DSH_HOME não pode ser ~/.dsh (compartilhado com dsh web). Use um home isolado (ex: ${getDshHomePath()}).`,
    );
  }

  const sdk = await loadSdkModule(repoPath);
  const client = new sdk.HarnessClient({
    dshBin,
    profile: "sdk",
    dshHome,
    // Substitui o env do child: herda o parent e força DSH_HOME isolado.
    env: {
      ...(options.env ?? process.env),
      DSH_HOME: dshHome,
    },
    initializeTimeoutMs: options.initializeTimeoutMs ?? 20_000,
  });

  let started = false;
  let initResult: { serverInfo: { name: string; version: string } } | null = null;

  const handle: DshRuntimeHandle = {
    pinnedVersion: PINNED_DSH_VERSION,
    dshBin,
    dshHome,
    isStarted: () => started,
    getClient: () => client,
    async start() {
      if (started && initResult) return initResult;
      client.start();
      // Handshake exige provider+model. Defaults só para o fio; OmniRoute/PR-4 sobrescreve.
      initResult = await client.initialize({
        cwd: options.cwd ?? process.cwd(),
        provider: options.provider ?? "deepseek-official",
        model: options.model ?? "deepseek-v4-flash",
      });
      started = true;
      return initResult;
    },
    async close() {
      await client.close();
      started = false;
      initResult = null;
    },
  };

  return handle;
}

/** Resolve o diretório do repo a partir do bin pinado (útil em scripts). */
export function resolveDshRepoFromBin(binPath = getDshBinPath()): string {
  // apps/cli/lib/bin.js → repo root sobe 3 níveis
  return dirname(dirname(dirname(dirname(binPath))));
}
