import { config, modelosDoCli, type Elenco } from "../config.ts";
import { Continuity, detectLimit, resetDoLimite, type LimitSignal } from "../missions/continuity.ts";
import { readCodexQuota, type Quota } from "../providers/codex-quota.ts";
import {
  resolveCli,
  familiaDo,
  listPanes,
  getPane,
  stopPane,
  updatePane,
  spawnPane,
  isCleanShell,
  writePty,
  type PaneState,
} from "../pty.ts";
import { normalizePaneStatus } from "../sessions/pane-state.ts";
import { hasSignificantTerminalOutput } from "../sessions/terminal-activity.ts";
import { getMission, getProject, detachPane, attachPane } from "../state.ts";
import { cwdDaMissao } from "../missions/missions.ts";
import { auditLogger } from "../security/audit.ts";
import { execucaoDoPapel } from "./politica-ia.ts";
import { listarPontes } from "../providers/ponte.ts";
import { listarProviders } from "../providers/providers.ts";
import { resolverHarness, type Pedido } from "./harness.ts";
import { identidadeVisualDoPapel } from "./roles.ts";
import { accountPool } from "../providers/account-pool.ts";
import { transferirSessaoCodex, ultimoModeloCodex } from "../providers/codex-sessions.ts";
import { pastaDoClaude, transferirSessaoClaude, ultimoModeloClaude } from "../providers/claude-sessions.ts";
import { getDefaultBridge } from "../connections/index.ts";
import { getTaskManager, type TaskManager } from "../tasks/index.ts";
import type { MailboxMessage } from "../connections/connection-types.ts";

export interface MaestroCoordinatorDeps {
  continuity: Continuity;
  broadcast: (msg: unknown) => void;
  porta: number;
  taskManager?: TaskManager;
}

/** Como abrir o painel substituto: conta, e de onde continuar. */
export type TrocaOpts = {
  preferredAccountId?: string;
  accountPinned?: boolean;
  /** Painel que bateu no limite: dele vêm a conversa e o último modelo usado. */
  origem?: PaneState;
  resumeSessionId?: string;
};

/** Sem horário de reset no texto, tenta de novo depois disso. */
const ESPERA_PADRAO_MS = 30 * 60 * 1000;
const ESTABILIDADE_RELATORIO_MS = 10_000;
const ALERTA_SEM_RELATORIO_MS = 60_000;

function relatorioConcluido(output: string): boolean {
  const clean = output.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  return /^\s*COCKPIT_STATUS:\s*complete\s*$/im.test(clean);
}

export class MaestroCoordinator {
  public limits = new Map<string, LimitSignal>();
  public outputTails = new Map<string, string>();
  public seenSignals = new Map<string, string>();
  public switching = new Set<string>();
  /** Último modelo/esforço aberto em cada CLI — a troca entre provedores volta nele. */
  private ultimoModeloPorCli = new Map<string, { model?: string; effort?: string }>();

  public codexQuota: Quota | null = null;
  public quotaError: string | null = null;
  private quotaPromise: Promise<void> | null = null;
  private lastQuotaCheck = 0;

  private pendingDelegations = new Map<
    string,
    Map<
      string,
      {
        paneId: string;
        agent: string;
        taskId?: string;
        correlationId?: string;
        replyResult?: string;
        delegatedAt: number;
        lastActiveAt?: number;
        lastOutputAt?: number;
        notifiedStall?: boolean;
      }
    >
  >();

  private deps: MaestroCoordinatorDeps;

  constructor(deps: MaestroCoordinatorDeps) {
    this.deps = deps;
  }

  public trackDelegation(missionId: string, paneId: string, agent?: string, taskId?: string, correlationId?: string): void {
    if (!missionId || !paneId) return;
    // Um painel recém-criado pode produzir o relatório antes deste registro.
    const pane = getPane(paneId);
    if (!pane || Date.now() - pane.iniciadoEm > 5000) this.outputTails.delete(paneId);
    let map = this.pendingDelegations.get(missionId);
    if (!map) {
      map = new Map();
      this.pendingDelegations.set(missionId, map);
    }
    map.set(paneId, {
      paneId,
      agent: agent || paneId,
      taskId,
      correlationId,
      delegatedAt: Date.now(),
    });
  }

  /** Resposta correlacionada confirma entrega; processamento aguarda Maestro ficar livre. */
  public acceptReply(message: MailboxMessage): boolean {
    if (message.type !== "reply" || !message.correlationId || !message.result?.trim()) return false;
    const info = this.pendingDelegations.get(message.missionId)?.get(message.from);
    if (!info || info.correlationId !== message.correlationId) return false;
    const maestro = listPanes().find((pane) => pane.missionId === message.missionId && pane.maestro);
    if (!maestro || message.to !== maestro.paneId && message.to !== "maestro") return false;
    info.replyResult = message.result;
    return true;
  }

  public clearDelegations(missionId?: string): void {
    if (missionId) {
      this.pendingDelegations.delete(missionId);
    } else {
      this.pendingDelegations.clear();
    }
  }

  public hasPendingDelegation(missionId: string, paneId: string): boolean {
    return this.pendingDelegations.get(missionId)?.has(paneId) === true;
  }

  public checkDelegations(): void {
    const agora = Date.now();
    for (const [missionId, delegations] of Array.from(this.pendingDelegations.entries())) {
      if (delegations.size === 0) {
        this.pendingDelegations.delete(missionId);
        continue;
      }

      const allPanes = listPanes();
      const maestro = allPanes.find((p) => p.missionId === missionId && p.maestro);
      if (!maestro || maestro.connected === false || maestro.status === "dead" || maestro.status === "failed") continue;

      const maestroNorm = normalizePaneStatus(maestro.status);
      if (maestroNorm === "working" || maestro.status === "starting") {
        continue;
      }

      const completedAgents: string[] = [];
      const interruptedAgents: string[] = [];
      const completedPaneIds = new Set<string>();
      const deadPaneIds = new Set<string>();
      const actionablePaneIds = new Set<string>();

      for (const [paneId, info] of delegations.entries()) {
        const pane = allPanes.find((p) => p.paneId === paneId);
        const raw = this.outputTails.get(paneId) ?? "";
        const quietSince = Math.max(info.delegatedAt, info.lastActiveAt ?? 0, info.lastOutputAt ?? 0);
        if (info.replyResult || (relatorioConcluido(raw) &&
          (!pane || pane.status === "dead" || pane.status === "failed" ||
            normalizePaneStatus(pane.status) !== "working" && agora - quietSince >= ESTABILIDADE_RELATORIO_MS))) {
          completedPaneIds.add(paneId);
          actionablePaneIds.add(paneId);
          completedAgents.push(pane?.label || info.agent || paneId);
          continue;
        }
        if (!pane || pane.status === "dead" || pane.status === "failed") {
          deadPaneIds.add(paneId);
          actionablePaneIds.add(paneId);
          interruptedAgents.push(pane?.label || info.agent || paneId);
          continue;
        }

        const norm = normalizePaneStatus(pane.status);
        if (norm === "working") {
          info.lastActiveAt = agora;
          continue;
        }

        if (pane.status === "starting") {
          continue;
        }
        if (agora - quietSince >= ALERTA_SEM_RELATORIO_MS && !info.notifiedStall) {
          actionablePaneIds.add(paneId);
          interruptedAgents.push(pane.label || info.agent || paneId);
        }
      }

      if (actionablePaneIds.size > 0) {
        const nomes = [...completedAgents, ...interruptedAgents].join(", ");

        const entregas: string[] = [];
        const outcomes: { paneId: string; info: { taskId?: string; replyResult?: string; notifiedStall?: boolean }; pane: PaneState | undefined; relatorio: string; concluido: boolean }[] = [];
        for (const [paneId, info] of delegations.entries()) {
          if (!actionablePaneIds.has(paneId)) continue;
          const pane = allPanes.find((p) => p.paneId === paneId);
          const nomeAgente = (pane?.label || info.agent || paneId).toUpperCase();
          const raw = info.replyResult ?? this.outputTails.get(paneId) ?? "";
          const clean = raw
            .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
            .replace(/\x1b\].*?(\x07|\x1b\\)/g, "")
            .replace(/\x1b[()][AB012]/g, "")
            .replace(/\r/g, "")
            .trim();
          const lines = clean.split("\n").filter((l) => l.trim().length > 0);
          const resumo = lines.slice(-25).join("\n") || "(nenhuma saída no terminal)";
          const concluido = completedPaneIds.has(paneId);
          entregas.push(`=== [${nomeAgente}] ${concluido ? "CONCLUÍDO" : "SEM CONFIRMAÇÃO"} ===\n${resumo}`);
          outcomes.push({ paneId, info, pane, relatorio: clean, concluido });
        }

        const notification = `\x1b[200~[Cockpit] Atualização dos especialistas (${nomes}). Concluídos: ${completedAgents.length}; sem confirmação: ${interruptedAgents.length}.\n\n${entregas.join("\n\n")}\n\n[Cockpit] Confira as tarefas sem confirmação e retome ou redistribua o trabalho. Use "ler_resultado" para a íntegra ou "situacao" para o estado dos painéis.\x1b[201~\r`;

        try {
          if (writePty(maestro.paneId, notification) === false) continue;
          const tm = this.deps.taskManager ?? getTaskManager();
          for (const { paneId, info, pane, relatorio, concluido } of outcomes) {
            if (!concluido && !deadPaneIds.has(paneId)) {
              info.notifiedStall = true;
              continue;
            }
            const taskId = info.taskId || pane?.activeTaskId;
            if (taskId) {
              try {
                const currentTask = tm.getTask(taskId);
                if (currentTask && currentTask.status !== "complete" && currentTask.status !== "failed") {
                  if (concluido) {
                    if (currentTask.status !== "in-review") {
                      tm.transitionTask(taskId, "in-review", { force: currentTask.status !== "in-progress" });
                    }
                    tm.transitionTask(taskId, "complete", { resultado: relatorio });
                  } else {
                    tm.transitionTask(taskId, "blocked", { reason: "Painel encerrado sem relatório final", force: true });
                  }
                }
              } catch (err) {
                console.error(`[MaestroCoordinator] Falha ao atualizar tarefa ${taskId}:`, err);
              }
            }
            if (pane) updatePane(paneId, { activeTaskId: null });
            delegations.delete(paneId);
          }
          if (delegations.size === 0) this.pendingDelegations.delete(missionId);
          this.deps.broadcast({
            type: "maestro:reactivated",
            missionId,
            especialistas: nomes,
          });
        } catch (err) {
          console.error(`[MaestroCoordinator] Falha ao reativar maestro ${maestro.paneId}:`, err);
        }
      }
    }
  }

  public presetsDoMaestro(): Record<string, { model: string; effort: string }> {
    const presets: Record<string, { model: string; effort: string }> = {};
    for (const id of Object.keys(config.modelos ?? {})) {
      const modelos = modelosDoCli(id);
      if (modelos && modelos.length > 0) {
        const effort = config.efforts?.[id]?.includes("high") ? "high" : (config.efforts?.[id]?.[0] ?? "medium");
        presets[id] = { model: modelos[0], effort };
      }
    }
    for (const { id } of listarPontes()) {
      const model = modelosDoCli(id)[0];
      const effort = config.efforts?.[id]?.includes("high") ? "high" : config.efforts?.[id]?.[0];
      if (model && effort) presets[id] = { model, effort };
    }
    return presets;
  }

  public maestroStatus() {
    const presets = this.presetsDoMaestro();
    return {
      agent: config.agents.maestro,
      auto: config.maestroAutoSwitch === true,
      limits: Object.fromEntries(this.limits),
      codexQuota: this.codexQuota,
      quotaError: this.quotaError,
      providers: listarProviders().filter((p) => p.id in presets),
    };
  }

  public notifyMaestro(): void {
    this.deps.broadcast({ type: "maestro", ...this.maestroStatus() });
  }

  public refreshQuota(): Promise<void> {
    if (this.quotaPromise) return this.quotaPromise;
    if (Date.now() - this.lastQuotaCheck < 60000) return Promise.resolve();
    this.lastQuotaCheck = Date.now();
    const command = resolveCli("codex", []);
    this.quotaPromise = readCodexQuota(command.file, command.args)
      .then((quota) => {
        this.codexQuota = quota;
        this.quotaError = quota ? null : "A conta não informou a cota.";
        if (quota) {
          if (quota.remaining <= 10) {
            const signal: LimitSignal = {
              state: quota.remaining <= 0 ? "blocked" : "warning",
              remaining: quota.remaining,
              detail: `Codex: ${quota.remaining}% de cota restante (consulta da conta).`,
            };
            this.limits.set("codex", signal);
          } else {
            this.limits.delete("codex");
          }
        }
      })
      .catch((err) => {
        this.codexQuota = null;
        this.quotaError = String(err);
      })
      .finally(() => {
        this.quotaPromise = null;
        this.notifyMaestro();
      });
    return this.quotaPromise;
  }

  /**
   * Ordem em que os provedores assumem quando um esgota. `ordemDeTroca` no
   * cockpit.json manda; sem ela, Codex → Claude → Grok → AGY → pontes, e depois
   * qualquer outro CLI configurado. Shell nunca entra.
   */
  public ordemDeTroca(): string[] {
    const preferida = Array.isArray(config.ordemDeTroca) && config.ordemDeTroca.length
      ? config.ordemDeTroca
      : ["codex", "claude", "grok", "agy", ...listarPontes().map((p) => p.id)];
    const todos = [...preferida, ...Object.keys(config.clis)];
    return [...new Set(todos)].filter((cli) => config.clis[cli] && familiaDo(cli) !== "bash" && cli !== "bash");
  }

  /** Limite ainda valendo? Limite com prazo vencido é esquecido aqui. */
  public limiteAtivo(cli: string): boolean {
    const limite = this.limits.get(cli);
    if (!limite) return false;
    if (limite.ate !== undefined && limite.ate <= Date.now()) {
      this.limits.delete(cli);
      this.notifyMaestro();
      return false;
    }
    return true;
  }

  /** O CLI pode receber o trabalho agora: instalado, sem limite e com conta livre no pool. */
  public podeAssumir(cli: string): boolean {
    if (this.limiteAtivo(cli)) return false;
    if (!listarProviders().some((p) => p.id === cli && p.disponivel)) return false;
    if (accountPool.hasPool(cli) && !accountPool.nextAvailable(cli)) return false;
    return true;
  }

  private homeDaConta(cli: string, accountId: string | null | undefined, chave: string): string | undefined {
    const conta = accountId ? accountPool.getAccounts(cli).find((a) => a.id === accountId) : undefined;
    return conta?.env?.[chave] ?? config.clis[cli]?.env?.[chave];
  }

  /**
   * O que o painel substituto herda do que bateu no limite:
   * - mesmo CLI: o último modelo usado na conversa (vale /model) e, trocando de
   *   conta, a própria conversa copiada para a conta nova (resume);
   * - outro CLI: o último modelo que o usuário usou naquele CLI.
   */
  private continuacao(origem: PaneState | undefined, cli: string, contaNova?: string) {
    const lembrado = this.ultimoModeloPorCli.get(cli) ?? {};
    if (!origem || origem.cli !== cli) return { ...this.presetsDoMaestro()[cli], ...lembrado };

    const familia = familiaDo(cli);
    let model = origem.model ?? undefined;
    let effort = origem.effort ?? undefined;
    let resumeSessionId: string | undefined;
    try {
      if (familia === "codex") {
        const deHome = this.homeDaConta(cli, origem.accountId, "CODEX_HOME") ?? "~/.codex";
        const naSessao = ultimoModeloCodex(deHome, origem.paneId, origem.iniciadoEm, origem.sessionId);
        model = naSessao.model ?? model;
        effort = naSessao.effort ?? effort;
        if (contaNova) {
          const paraHome = this.homeDaConta(cli, contaNova, "CODEX_HOME") ?? "~/.codex";
          resumeSessionId = transferirSessaoCodex(deHome, paraHome, origem.paneId, origem.iniciadoEm, origem.sessionId) ?? undefined;
        }
      } else if (familia === "claude" && origem.sessionId) {
        const deDir = pastaDoClaude(this.homeDaConta(cli, origem.accountId, "CLAUDE_CONFIG_DIR"));
        model = ultimoModeloClaude(deDir, origem.sessionId) ?? model;
        if (contaNova) {
          const paraDir = pastaDoClaude(this.homeDaConta(cli, contaNova, "CLAUDE_CONFIG_DIR"));
          if (transferirSessaoClaude(deDir, paraDir, origem.sessionId)) resumeSessionId = origem.sessionId;
        }
      }
    } catch (err) {
      console.error("[MaestroCoordinator] Falha ao recuperar a conversa para a troca de conta:", err);
    }
    return { model, effort, resumeSessionId };
  }

  private static readonly TAREFA_RETOMADA =
    "[Cockpit] A conta anterior atingiu o limite de uso. Esta é a mesma conversa, agora em outra conta. Continue exatamente de onde parou, sem refazer o que já foi feito.";

  public raizDe(missionId: string | null, projectId: string | null): string | null {
    if (missionId) {
      const mission = getMission(missionId);
      if (!mission || !getProject(mission.projectId) || (projectId && mission.projectId !== projectId)) return null;
      return cwdDaMissao(mission);
    }
    if (projectId) return getProject(projectId)?.root ?? null;
    return null;
  }

  public abrirPainel(
    agent: string,
    missionId: string,
    tarefa?: string,
    harness?: Omit<Pedido, "agent"> & { backend?: "pty" | "dsh"; loginArgs?: string[]; role?: string },
    skills: string[] = [],
    maestroOverride?: boolean,
    accountOpts?: TrocaOpts,
  ): PaneState {
    const mission = getMission(missionId);
    if (!mission) throw new Error("missão não encontrada");
    const project = getProject(mission.projectId);
    if (!project) throw new Error("projeto fechado");
    if (config.workspace?.umaMissaoEscritoraPorProjeto !== false) {
      const outraMissaoAtiva = listPanes().find((pane) => {
        if (!pane.missionId) return false;
        if (pane.missionId === missionId) return false;
        const outraMissao = getMission(pane.missionId);
        return outraMissao?.projectId === mission.projectId;
      });
      if (outraMissaoAtiva) {
        const outraMissao = outraMissaoAtiva.missionId
          ? getMission(outraMissaoAtiva.missionId)
          : undefined;
        throw new Error(
          `o projeto já está sendo trabalhado pela missão "${outraMissao?.nome ?? outraMissaoAtiva.missionId}"; encerre seus painéis antes de iniciar outra missão`,
        );
      }
    }
    const ehMaestro = maestroOverride ?? config.agents[agent]?.maestro === true;
    if (ehMaestro && listPanes().some((p) => p.missionId === missionId && p.maestro)) {
      throw new Error("Já existe um maestro nesta missão. Use Trocar maestro.");
    }
    if (ehMaestro && !harness?.invoke?.cli && !harness?.roster?.cli) {
      const profile = config.agents[agent]!;
      harness = {
        ...harness,
        invoke: { cli: profile.cli, model: profile.model, effort: profile.effort, ...harness?.invoke },
      };
    }
    harness = { ...harness, elenco: mission.elenco };

    const clean = isCleanShell(agent);
    const tarefaLimpa = clean ? undefined : tarefa;

    const visual = identidadeVisualDoPapel(harness?.role, harness?.roleDefinition);
    const state = spawnPane({
      agent,
      label: harness?.label ?? visual?.label,
      harness,
      cwd: cwdDaMissao(mission),
      projectId: mission.projectId,
      missionId: mission.id,
      objetivo: mission.objetivo,
      skills: [...(mission.skills ?? []), ...skills],
      tarefa: tarefaLimpa,
      maestro: maestroOverride,
      porta: this.deps.porta,
      role: harness?.role,
      roleDefinition: harness?.roleDefinition,
      runner: harness?.runner,
      preferredAccountId: accountOpts?.preferredAccountId,
      accountPinned: accountOpts?.accountPinned,
      backend: harness?.backend,
      loginArgs: harness?.loginArgs,
      resumeSessionId: accountOpts?.resumeSessionId,
    });
    if (state.cli !== "bash" && (state.model || state.effort)) {
      this.ultimoModeloPorCli.set(state.cli, { model: state.model ?? undefined, effort: state.effort ?? undefined });
    }
    attachPane(mission.id, state.paneId);
    this.deps.continuity.record(
      mission.id,
      state.paneId,
      "start",
      JSON.stringify({ agent, tarefa, objetivo: mission.objetivo, cli: state.cli }),
    );
    this.deps.broadcast({ type: "spawned", pane: state });

    // Conexão direta automática com o Orquestrador (Maestro) da missão
    try {
      const bridge = getDefaultBridge();
      if (state.maestro) {
        // Se este painel é o Maestro recém-criado, conecta a todos os especialistas já existentes na missão
        const especialistas = listPanes().filter(
          (p) =>
            p.missionId === mission.id &&
            !p.maestro &&
            p.paneId !== state.paneId &&
            p.status !== "dead" &&
            p.status !== "failed",
        );
        for (const esp of especialistas) {
          bridge.connect(state.paneId, esp.paneId, mission.id);
        }
        if (especialistas.length > 0) {
          this.deps.broadcast({ type: "connection:updated" });
        }
      } else {
        // Se este painel é um especialista (Arquiteto, Explorador, Construtor, Verificador, etc.), conecta ao Maestro existente
        const maestro = listPanes().find(
          (p) =>
            p.missionId === mission.id &&
            p.maestro &&
            p.paneId !== state.paneId &&
            p.status !== "dead" &&
            p.status !== "failed",
        );
        if (maestro) {
          bridge.connect(maestro.paneId, state.paneId, mission.id);
          this.deps.broadcast({ type: "connection:updated" });
        }
      }
    } catch {
      // Ignora falhas de auto-conexão silenciosamente
    }

    return state;
  }

  public saveCheckpoint(missionId: string, value: unknown): { ok: boolean; instruction?: string } {
    const text = String(value ?? "").trim();
    if (!text || text.length > 40000) throw Error("Checkpoint vazio ou muito grande.");
    const mission = getMission(missionId);
    if (!mission || !getProject(mission.projectId)) throw Error("Missão indisponível.");
    this.deps.continuity.checkpoint(missionId, text);
    const maestro = listPanes().find((p) => p.missionId === missionId && p.maestro);
    if (maestro && config.maestroAutoSwitch && this.limiteAtivo(maestro.cli) && !this.switching.has(missionId)) {
      const fixo = execucaoDoPapel("maestro");
      if (fixo) {
        this.deps.broadcast({
          type: "error",
          message: `O Maestro (${maestro.cli}) atingiu aviso de cota, mas está fixado na Distribuição de IA. Altere em Maestro → Quem faz o trabalho para trocar de provedor.`,
        });
        return { ok: true };
      }
      const cli = this.clisDaMissao(missionId, this.ordemDeTroca()).find(
        (c) => c !== maestro.cli && this.podeAssumir(c) && Boolean(this.presetsDoMaestro()[c]),
      );
      if (cli) {
        setTimeout(() => {
          if (getPane(maestro.paneId) && config.maestroAutoSwitch) {
            void this.switchMaestro(missionId, cli).catch((err) =>
              this.deps.broadcast({ type: "error", message: String(err) }),
            );
          }
        }, 1500);
        return {
          ok: true,
          instruction:
            "Checkpoint salvo. O cockpit vai transferir a coordenação agora por cota baixa. Encerre este turno sem executar mais ações.",
        };
      }
    }
    return { ok: true };
  }

  public async switchMaestro(
    missionId: string,
    cli: string,
    accountOpts?: TrocaOpts,
  ): Promise<PaneState> {
    const fixo = execucaoDoPapel("maestro");
    if (fixo && fixo.cli !== cli) {
      throw Error("Altere a distribuição de IA antes de trocar este papel de provedor.");
    }
    if (this.switching.has(missionId)) throw Error("Troca de maestro já em andamento.");
    if (!this.presetsDoMaestro()[cli] || !listarProviders().some((p) => p.id === cli && p.disponivel)) {
      throw Error("Provedor não disponível nesta máquina.");
    }
    if (!fixo && !this.clisDaMissao(missionId, [cli]).includes(cli)) {
      throw Error("Este provedor não está no elenco da missão.");
    }
    const mission = getMission(missionId);
    if (!mission || !getProject(mission.projectId)) throw Error("Abra o projeto antes de continuar.");
    this.switching.add(missionId);
    try {
      const previous = listPanes().filter((p) => p.missionId === missionId && p.maestro);
      const task = this.deps.continuity.handoff(
        missionId,
        mission.objetivo,
        listPanes().filter((p) => p.missionId === missionId && !p.maestro),
      );
      for (const pane of previous) {
        await stopPane(pane.paneId);
        detachPane(pane.paneId);
        this.deps.broadcast({ type: "exit", paneId: pane.paneId, code: 0 });
      }
      // Só depois de parar: o CLI termina de gravar a conversa antes da cópia.
      const origem = accountOpts?.origem ?? previous[0];
      const continuar = this.continuacao(origem, cli, accountOpts?.preferredAccountId);
      auditLogger.logExecutorChange(previous[0]?.cli ?? "unknown", cli, "Troca de provedor do Maestro", {
        missionId,
        paneId: previous[0]?.paneId,
      });
      return this.abrirPainel(
        "maestro",
        missionId,
        continuar.resumeSessionId ? MaestroCoordinator.TAREFA_RETOMADA : task,
        { invoke: { cli, model: continuar.model, effort: continuar.effort } },
        [],
        undefined,
        { ...accountOpts, resumeSessionId: continuar.resumeSessionId },
      );
    } finally {
      this.switching.delete(missionId);
    }
  }

  public async switchSpecialist(
    pane: PaneState,
    cli: string,
    accountOpts?: TrocaOpts,
  ): Promise<void> {
    const fixo = execucaoDoPapel(pane.agent);
    if (fixo && fixo.cli !== cli) {
      throw Error("Este papel tem uma IA fixa. Altere a distribuição de IA para trocar de provedor.");
    }
    if (!pane.missionId || this.switching.has(pane.paneId) || !getPane(pane.paneId)) return;
    const mission = getMission(pane.missionId);
    if (!mission || !getProject(mission.projectId)) return;
    this.switching.add(pane.paneId);
    try {
      const task = `Continue somente a responsabilidade do painel ${pane.paneId} (${pane.label}). Consulte a entrada start desse painel no histórico para recuperar a tarefa original. Não assuma as tarefas dos outros agentes.\n\n${this.deps.continuity.handoff(mission.id, mission.objetivo, listPanes().filter((p) => p.missionId === mission.id && p.paneId !== pane.paneId))}`;
      await stopPane(pane.paneId);
      detachPane(pane.paneId);
      this.deps.broadcast({ type: "exit", paneId: pane.paneId, code: 0 });
      auditLogger.logExecutorChange(pane.cli, cli, "Troca de provedor do Especialista", {
        missionId: pane.missionId,
        paneId: pane.paneId,
      });
      const continuar = this.continuacao(accountOpts?.origem ?? pane, cli, accountOpts?.preferredAccountId);
      const newPane = this.abrirPainel(
        pane.agent,
        mission.id,
        continuar.resumeSessionId ? MaestroCoordinator.TAREFA_RETOMADA : task,
        { invoke: { cli, model: continuar.model, effort: continuar.effort }, role: pane.role },
        [],
        undefined,
        { ...accountOpts, resumeSessionId: continuar.resumeSessionId },
      );
      const delegations = this.pendingDelegations.get(mission.id);
      if (delegations && delegations.has(pane.paneId)) {
        const info = delegations.get(pane.paneId)!;
        delegations.delete(pane.paneId);
        delegations.set(newPane.paneId, { ...info, delegatedAt: Date.now() });
      }
    } finally {
      this.switching.delete(pane.paneId);
    }
  }

  public observeOutput(pane: PaneState, data: string): void {
    if (!pane.missionId) return;
    if (hasSignificantTerminalOutput(data)) {
      this.deps.continuity.record(pane.missionId, pane.paneId, "output", data);
    }
    const tail = ((this.outputTails.get(pane.paneId) ?? "") + data).slice(-64_000);
    this.outputTails.set(pane.paneId, tail);
    if (hasSignificantTerminalOutput(data)) {
      const info = this.pendingDelegations.get(pane.missionId)?.get(pane.paneId);
      if (info) {
        info.lastOutputAt = Date.now();
      }
    }
    if (!/429|quota|limit|exhausted|cota|limite|RESOURCE/i.test(data) && !/429|quota|limit|exhausted|cota|limite|RESOURCE/i.test(tail.slice(-400))) {
      return;
    }
    const signal = detectLimit(data) ?? detectLimit(tail);
    if (!signal || this.seenSignals.get(pane.paneId) === signal.detail) return;
    this.seenSignals.set(pane.paneId, signal.detail);

    // 1. Marca limite na conta do pool vinculada a este painel, até o reset
    //    que o próprio CLI anunciou (ou a espera padrão, sem pista no texto).
    const reset = resetDoLimite(data) ?? resetDoLimite(tail.slice(-1500));
    const esperaMs = reset && reset > Date.now() ? reset - Date.now() : ESPERA_PADRAO_MS;
    const currentAcc = accountPool.getAccountForPane(pane.paneId);
    if (currentAcc) {
      accountPool.markLimited(pane.cli, currentAcc.id, signal.detail, esperaMs);
    }

    if (signal.state === "warning" && pane.maestro) {
      this.deps.broadcast({
        type: "error",
        message: `${pane.cli}: cota próxima do limite. Salve um checkpoint e use Trocar maestro para continuar em outro provedor.`,
      });
    }

    if (signal.state === "blocked") {
      // Conta fixada pelo usuário: não rotaciona intra-pool
      if (pane.accountPinned) {
        updatePane(pane.paneId, { status: "blocked", blockedReason: signal.detail });
        this.deps.broadcast({
          type: "limit",
          paneId: pane.paneId,
          cli: pane.cli,
          state: "blocked",
          detail: signal.detail,
        });
        this.deps.broadcast({
          type: "error",
          message: `${pane.label} (${pane.cli}) atingiu limite na conta fixada "${currentAcc?.label ?? currentAcc?.id ?? pane.accountLabel}". Rotação automática desativada para este painel.`,
        });
        return;
      }

      // 2. Tenta failover intra-pool na mesma IA antes de qualquer outra coisa
      const nextAcc = accountPool.nextAvailable(pane.cli, currentAcc?.id);
      if (nextAcc && !this.switching.has(pane.maestro ? pane.missionId : pane.paneId)) {
        this.deps.broadcast({
          type: "pool:rotated",
          cli: pane.cli,
          from: currentAcc?.label ?? currentAcc?.id ?? "desconhecida",
          to: nextAcc.label || nextAcc.id,
          paneId: pane.paneId,
          detail: signal.detail,
        });
        this.deps.broadcast({
          type: "notice",
          message: `[Cockpit Pool] ${pane.label} atingiu limite na conta "${currentAcc?.label ?? currentAcc?.id}". Rotacionando automaticamente para "${nextAcc.label || nextAcc.id}"...`,
        });

        const rotateOpts: TrocaOpts = { preferredAccountId: nextAcc.id, origem: pane };
        void (pane.maestro
          ? this.switchMaestro(pane.missionId, pane.cli, rotateOpts)
          : this.switchSpecialist(pane, pane.cli, rotateOpts)
        ).catch((err) =>
          this.deps.broadcast({ type: "error", message: `Falha na rotação do pool: ${String(err)}` }),
        );
        return;
      }

      // Todas as contas do pool daquele CLI esgotaram (ou sem pool): o CLI fica
      // fora até a primeira conta voltar — aí ele pode assumir de novo.
      const voltas = accountPool.getAccounts(pane.cli).map((a) => a.limitedUntil ?? 0).filter((t) => t > Date.now());
      const ate = voltas.length ? Math.min(...voltas) : Date.now() + esperaMs;
      this.limits.set(pane.cli, { ...signal, ate });
      this.notifyMaestro();

      if (config.maestroAutoSwitch && !this.switching.has(pane.maestro ? pane.missionId : pane.paneId)) {
        const fixo = pane.maestro ? execucaoDoPapel("maestro") : execucaoDoPapel(pane.agent);
        if (fixo) {
          this.deps.broadcast({
            type: "error",
            message: `${pane.label} (${pane.cli}) atingiu limite de cota, mas este papel está fixado na Distribuição de IA (${fixo.cli}). Altere em Maestro → Quem faz o trabalho se desejar trocar de provedor.`,
          });
          return;
        }
        const target = this.clisDaMissao(pane.missionId, this.ordemDeTroca()).find(
          (cli) => cli !== pane.cli && this.podeAssumir(cli) && Boolean(this.presetsDoMaestro()[cli]),
        );
        if (target) {
          this.deps.broadcast({
            type: "notice",
            message: `[Cockpit] ${pane.label}: todas as contas de ${pane.cli} no limite. Continuando em ${target}...`,
          });
          const trocaOpts: TrocaOpts = { origem: pane };
          void (pane.maestro
            ? this.switchMaestro(pane.missionId, target, trocaOpts)
            : this.switchSpecialist(pane, target, trocaOpts)
          ).catch((err) =>
            this.deps.broadcast({ type: "error", message: `Falha na continuidade: ${String(err)}` }),
          );
        } else {
          this.deps.broadcast({
            type: "error",
            message:
              "Nenhum provedor alternativo disponível sem aviso de limite. Missão preservada; escolha um provedor após a renovação da cota.",
          });
        }
      } else if (!config.maestroAutoSwitch) {
        updatePane(pane.paneId, { status: "blocked" });
        this.deps.broadcast({
          type: "limit",
          paneId: pane.paneId,
          cli: pane.cli,
          state: "blocked",
          detail: signal.detail,
        });
        this.deps.broadcast({
          type: "error",
          message: `${pane.label} (${pane.cli}) atingiu limite de cota. Failover automático desativado. Autorização explícita necessária para trocar de provedor.`,
        });
      }
    }
  }

  public limparElenco(bruto: unknown): Elenco | undefined {
    if (!bruto || typeof bruto !== "object") return undefined;
    const e = bruto as Partial<Elenco>;
    const clis = (Array.isArray(e.clis) ? e.clis : []).filter((c) => typeof c === "string" && config.clis[c]);
    if (clis.length === 0) return undefined;

    const porCli: Record<string, { model?: string; effort?: string }> = {};
    for (const [cli, fixo] of Object.entries(e.porCli ?? {})) {
      if (!clis.includes(cli) || !fixo) continue;
      const model = modelosDoCli(cli).includes(String(fixo.model)) ? String(fixo.model) : undefined;
      const effort = config.efforts?.[cli]?.includes(String(fixo.effort)) ? String(fixo.effort) : undefined;
      if (model || effort) porCli[cli] = { ...(model && { model }), ...(effort && { effort }) };
    }

    const soVisual = (Array.isArray(e.soVisual) ? e.soVisual : []).filter((c) => clis.includes(c));
    if (soVisual.length === clis.length) return { clis, ...(Object.keys(porCli).length && { porCli }) };
    return {
      clis,
      ...(Object.keys(porCli).length > 0 && { porCli }),
      ...(soVisual.length > 0 && { soVisual }),
    };
  }

  public elencoDa(missionId: string | null): Elenco | undefined {
    return (missionId ? getMission(missionId)?.elenco : undefined) ?? undefined;
  }

  public clisDaMissao(missionId: string | null, padrao: string[]): string[] {
    if (config.politicaIA?.modo === "unica") return [config.politicaIA.unica!.cli];
    const elenco = this.elencoDa(missionId);
    if (!elenco || elenco.clis.length === 0) return padrao;
    const soVisual = new Set(elenco.soVisual ?? []);
    const uteis = elenco.clis.filter((c) => !soVisual.has(c));
    return uteis.length > 0 ? uteis : elenco.clis;
  }

  public especialistasDaMissao(missionId: string): any[] {
    const elenco = this.elencoDa(missionId);
    const soVisual = new Set(elenco?.soVisual ?? []);
    return Object.entries(config.agents)
      .filter(([, a]) => !a.maestro)
      .map(([id, a]) => {
        try {
          const bundle = resolverHarness({ agent: id, elenco });
          return {
            id,
            label: a.label,
            papel: a.papel,
            cli: bundle.cli,
            modelo: bundle.model,
            effort: bundle.effort,
            permitido: true,
            ...(soVisual.has(a.cli) && {
              escopo:
                "só produz arquivos de imagem, vídeo e áudio que vão dentro do produto — foto, ilustração, ícone, textura, render. Não desenha telas, layout nem mockup de interface.",
            }),
            ...(bundle.trocado && {
              nota: `o catálogo diz ${bundle.trocado.de}, mas nesta missão roda em ${bundle.cli}: ${bundle.trocado.porque}`,
            }),
          };
        } catch {
          return {
            id,
            label: a.label,
            papel: a.papel,
            cli: a.cli,
            modelo: a.model,
            effort: a.effort,
            permitido: false,
            nota: `${a.cli} não faz parte do elenco desta missão`,
          };
        }
      });
  }
}
