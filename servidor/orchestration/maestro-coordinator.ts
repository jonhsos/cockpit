import { config, modelosDoCli, type Elenco } from "../config.ts";
import { Continuity, detectLimit, type LimitSignal } from "../missions/continuity.ts";
import { readCodexQuota, type Quota } from "../providers/codex-quota.ts";
import {
  resolveCli,
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
import { getDefaultBridge } from "../connections/index.ts";
import { getTaskManager, type TaskManager } from "../tasks/index.ts";

export interface MaestroCoordinatorDeps {
  continuity: Continuity;
  broadcast: (msg: unknown) => void;
  porta: number;
  taskManager?: TaskManager;
}

export class MaestroCoordinator {
  public limits = new Map<string, LimitSignal>();
  public outputTails = new Map<string, string>();
  public seenSignals = new Map<string, string>();
  public switching = new Set<string>();

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
        delegatedAt: number;
        seenActive: boolean;
        lastActiveAt?: number;
      }
    >
  >();

  private deps: MaestroCoordinatorDeps;

  constructor(deps: MaestroCoordinatorDeps) {
    this.deps = deps;
  }

  public trackDelegation(missionId: string, paneId: string, agent?: string, taskId?: string): void {
    if (!missionId || !paneId) return;
    let map = this.pendingDelegations.get(missionId);
    if (!map) {
      map = new Map();
      this.pendingDelegations.set(missionId, map);
    }
    map.set(paneId, {
      paneId,
      agent: agent || paneId,
      taskId,
      delegatedAt: Date.now(),
      seenActive: false,
    });
  }

  public clearDelegations(missionId?: string): void {
    if (missionId) {
      this.pendingDelegations.delete(missionId);
    } else {
      this.pendingDelegations.clear();
    }
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
      if (!maestro) continue;

      const maestroNorm = normalizePaneStatus(maestro.status);
      if (maestroNorm === "working" || maestro.status === "starting") {
        continue;
      }

      let allDone = true;
      const completedAgents: string[] = [];

      for (const [paneId, info] of delegations.entries()) {
        const pane = allPanes.find((p) => p.paneId === paneId);
        if (!pane || pane.status === "dead" || pane.status === "failed") {
          continue;
        }

        const norm = normalizePaneStatus(pane.status);
        const raw = this.outputTails.get(paneId) ?? "";
        if (raw.trim().length > 0) {
          info.seenActive = true;
        }

        if (norm === "working") {
          info.seenActive = true;
          info.lastActiveAt = agora;
          allDone = false;
          continue;
        }

        if (pane.status === "starting" && agora - info.delegatedAt < 3000) {
          allDone = false;
          continue;
        }

        // Se o especialista ainda não foi visto ativo:
        // LLMs levam de 1 a 5s para iniciar output. Não declare conclusão prematura antes de 15s
        // a não ser que tenha havido saída real no terminal registrada.
        if (!info.seenActive) {
          if (agora - info.delegatedAt < 15000) {
            allDone = false;
            continue;
          }
          if (raw.trim().length === 0) {
            allDone = false;
            continue;
          }
        }

        // Se foi visto ativo, garante uma janela de estabilidade (1500ms) após a última atividade,
        // permitindo que pausas transitórias de tool calls ou compilação não encerrem a tarefa antes da hora.
        if (
          info.seenActive &&
          info.lastActiveAt &&
          agora - info.lastActiveAt < 1500 &&
          agora - info.delegatedAt < 3000
        ) {
          allDone = false;
          continue;
        }

        completedAgents.push(pane.label || info.agent || paneId);
      }

      if (allDone && completedAgents.length > 0) {
        this.pendingDelegations.delete(missionId);
        const nomes = completedAgents.join(", ");

        const tm = this.deps.taskManager ?? getTaskManager();
        const entregas: string[] = [];
        for (const [paneId, info] of delegations.entries()) {
          const pane = allPanes.find((p) => p.paneId === paneId);
          const nomeAgente = (pane?.label || info.agent || paneId).toUpperCase();
          const raw = this.outputTails.get(paneId) ?? "";
          const clean = raw
            .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
            .replace(/\x1b\].*?(\x07|\x1b\\)/g, "")
            .replace(/\x1b[()][AB012]/g, "")
            .replace(/\r/g, "")
            .trim();
          const lines = clean.split("\n").filter((l) => l.trim().length > 0);
          const resumo = lines.slice(-25).join("\n") || "(nenhuma saída no terminal)";
          entregas.push(`=== [${nomeAgente}] ===\n${resumo}`);

          // Transita a tarefa para complete no TaskManager e desocupa o painel
          const taskIdToComplete = info.taskId || pane?.activeTaskId;
          if (taskIdToComplete && tm) {
            try {
              const currentTask = tm.getTask(taskIdToComplete);
              if (currentTask && currentTask.status !== "complete" && currentTask.status !== "failed") {
                tm.transitionTask(taskIdToComplete, "complete", {
                  resultado: resumo,
                });
              }
            } catch {
              // Best effort
            }
          }
          if (pane) {
            updatePane(paneId, { activeTaskId: null });
          }
        }

        const notification = `\x1b[200~[Cockpit] Os especialistas (${nomes}) concluíram suas tarefas com sucesso!\n\n${entregas.join("\n\n")}\n\n[Cockpit] Avalie as informações e entregas acima para continuar o trabalho ou apresentar o resultado ao usuário. Use "ler_resultado" para a íntegra ou "situacao" para o estado dos painéis.\x1b[201~\r\n`;

        try {
          writePty(maestro.paneId, notification);
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

  public ordemDeTroca(): string[] {
    return ["codex", "agy", "claude", ...listarPontes().map((p) => p.id)];
  }

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
    accountOpts?: { preferredAccountId?: string; accountPinned?: boolean },
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
    });
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
    if (maestro && config.maestroAutoSwitch && this.limits.has(maestro.cli) && !this.switching.has(missionId)) {
      const fixo = execucaoDoPapel("maestro");
      if (fixo) {
        this.deps.broadcast({
          type: "error",
          message: `O Maestro (${maestro.cli}) atingiu aviso de cota, mas está fixado na Distribuição de IA. Altere em Maestro → Quem faz o trabalho para trocar de provedor.`,
        });
        return { ok: true };
      }
      const cli = this.clisDaMissao(missionId, this.ordemDeTroca()).find(
        (c) => c !== maestro.cli && !this.limits.has(c) && listarProviders().some((p) => p.id === c && p.disponivel),
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
    accountOpts?: { preferredAccountId?: string; accountPinned?: boolean },
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
      const configured = config.agents.maestro;
      auditLogger.logExecutorChange(previous[0]?.cli ?? "unknown", cli, "Troca de provedor do Maestro", {
        missionId,
        paneId: previous[0]?.paneId,
      });
      return this.abrirPainel(
        "maestro",
        missionId,
        task,
        {
          invoke: {
            cli,
            ...(configured?.cli === cli
              ? { model: configured.model, effort: configured.effort }
              : this.presetsDoMaestro()[cli]),
          },
        },
        [],
        undefined,
        accountOpts,
      );
    } finally {
      this.switching.delete(missionId);
    }
  }

  public async switchSpecialist(
    pane: PaneState,
    cli: string,
    accountOpts?: { preferredAccountId?: string; accountPinned?: boolean },
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
      const newPane = this.abrirPainel(
        pane.agent,
        mission.id,
        task,
        { invoke: { cli, ...this.presetsDoMaestro()[cli] } },
        [],
        undefined,
        accountOpts,
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
    const tail = ((this.outputTails.get(pane.paneId) ?? "") + data).slice(-4000);
    this.outputTails.set(pane.paneId, tail);
    if (!/429|quota|limit|exhausted|cota|limite|RESOURCE/i.test(data) && !/429|quota|limit|exhausted|cota|limite|RESOURCE/i.test(tail.slice(-400))) {
      return;
    }
    const signal = detectLimit(data) ?? detectLimit(tail);
    if (!signal || this.seenSignals.get(pane.paneId) === signal.detail) return;
    this.seenSignals.set(pane.paneId, signal.detail);

    // 1. Marca limite na conta do pool vinculada a este painel
    const currentAcc = accountPool.getAccountForPane(pane.paneId);
    if (currentAcc) {
      accountPool.markLimited(pane.cli, currentAcc.id, signal.detail);
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

        const rotateOpts = { preferredAccountId: nextAcc.id };
        void (pane.maestro
          ? this.switchMaestro(pane.missionId, pane.cli, rotateOpts)
          : this.switchSpecialist(pane, pane.cli, rotateOpts)
        ).catch((err) =>
          this.deps.broadcast({ type: "error", message: `Falha na rotação do pool: ${String(err)}` }),
        );
        return;
      }

      // Todas as contas do pool daquele CLI esgotaram (ou sem pool)
      this.limits.set(pane.cli, signal);
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
          (cli) =>
            cli !== pane.cli &&
            !this.limits.has(cli) &&
            listarProviders().some((p) => p.id === cli && p.disponivel),
        );
        if (target) {
          void (pane.maestro
            ? this.switchMaestro(pane.missionId, target)
            : this.switchSpecialist(pane, target)
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
