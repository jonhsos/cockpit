import { Router } from "express";
import type { RouterContext } from "./types.ts";
import {
  getMission,
  listMissions,
  createMission,
  archiveMission,
  cwdDaMissao,
  persistir,
} from "../missions/missions.ts";
import { getProject, lerMemoria, anotar } from "../state.ts";
import { listPanes, killPty, stopPane, replayPane, flushDshKills } from "../pty.ts";
import { branchStatus } from "../missions/git.ts";
import { readUsage, somaUsage } from "../providers/usage.ts";
import { getRun, iniciarSquad, avancarFase, encerrarRun } from "../orchestration/squad.ts";
import { observar } from "../missions/watcher.ts";
import {
  normalizeMissionMode,
  canMaestroDelegate,
  canMaestroAutoSpawn,
} from "../orchestration/mission-modes.ts";
import { tiposDeTarefa } from "../orchestration/harness.ts";
import { skillsDoAgente } from "../orchestration/skills.ts";
import { gerar } from "../providers/media.ts";

export function createMissionsRouter(ctx: RouterContext): Router {
  const router = Router();

  const fail = (res: any, err: unknown) =>
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });

  const avisarMudanca = (path: string, base: string) =>
    ctx.broadcast({ type: "fs-change", path, base });

  router.post("/missions/:id/maestro", async (req, res) => {
    try {
      res.json(await ctx.switchMaestro(req.params.id, String(req.body.cli)));
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/missions/:id/checkpoint", (req, res) => {
    try {
      if (!getMission(req.params.id)) throw Error("Missão não encontrada.");
      res.json(ctx.saveCheckpoint(req.params.id, req.body.texto));
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/missions/:id/tools", (req, res) => {
    try {
      const mission = getMission(req.params.id);
      if (!mission || !getProject(mission.projectId)) throw Error("Missão indisponível.");
      const args = req.body.args ?? {};
      switch (req.body.tool) {
        case "listar_especialistas":
          res.json(ctx.especialistasDaMissao(mission.id));
          break;
        case "listar_paineis":
          res.json(ctx.paneDispatcher.listAvailablePanes(mission.id));
          break;
        case "atribuir_tarefa":
          res.json(ctx.paneDispatcher.dispatchToExistingPane(mission.id, String(args.taskId), String(args.paneId)));
          break;
        case "situacao":
          res.json(listPanes().filter((p) => p.missionId === mission.id));
          break;
        case "tipos_de_tarefa":
          res.json(tiposDeTarefa());
          break;
        case "lembrar":
          res.json(lerMemoria(mission.projectId));
          break;
        case "anotar":
          anotar(mission.projectId, "maestro", String(args.texto));
          res.json({ ok: true });
          break;
        case "checkpoint":
          res.json(ctx.saveCheckpoint(mission.id, args.texto));
          break;
        case "delegar": {
          const modeInfo = ctx.missionModeManager.getMissionMode(mission.id, normalizeMissionMode(mission.modo));
          if (modeInfo.emergencyHalt) throw Error("Parada de emergência ativa. Ações bloqueadas.");
          if (modeInfo.modo === "livre") {
            throw Error("Delegação autônoma desativada no modo Livre. Controle manual do usuário.");
          }
          if (modeInfo.modo === "dirigido") {
            const elencoClis = mission.elenco?.clis ?? [];
            const authorizedAgents = Object.entries(ctx.config.agents)
              .filter(([, a]) => elencoClis.length === 0 || elencoClis.includes((a as any).cli))
              .map(([k]) => k);
            const openPaneTargets = ctx.paneDispatcher.listAvailablePanes(mission.id).flatMap(p => [p.label, p.role]);
            const guard = canMaestroDelegate({
              mode: modeInfo.modo,
              targetAgentOrRole: String(args.agente),
              authorizedRoles: Array.from(new Set([...authorizedAgents, ...openPaneTargets])),
              emergencyHalt: modeInfo.emergencyHalt,
            });
            if (!guard.allowed) throw Error(guard.reason);
          }
          const requestedAgent = String(args.agente);
          const existing = ctx.paneDispatcher.findExistingPane(mission.id, requestedAgent);
          if (existing?.connected && existing.status !== "dead" && existing.status !== "failed") {
            if (existing.status === "starting") {
              throw Error(`Painel ${existing.label} (${existing.paneId}) ainda está inicializando. Espere e chame delegar de novo — não abra outro painel.`);
            }
            if (existing.canAcceptTask) {
              const task = ctx.taskManager.createTask(mission.id, {
                título: String(args.tarefa ?? "").slice(0, 80),
                descrição: String(args.tarefa ?? ""),
                papel: requestedAgent,
                status: "todo",
              });
              const dispatched = ctx.paneDispatcher.dispatchToExistingPane(mission.id, task.id, existing.paneId);
              ctx.trackDelegation?.(mission.id, existing.paneId, existing.label || requestedAgent);
              res.json({
                paneId: existing.paneId,
                label: existing.label,
                cli: existing.runner,
                dispatchedToExisting: true,
                taskId: task.id,
                deliveredToTerminal: dispatched.deliveredToTerminal === true,
              });
              break;
            }
            const queued = ctx.bridge.ask("maestro", existing.paneId, String(args.tarefa ?? ""), undefined, mission.id);
            res.json({
              paneId: existing.paneId,
              label: existing.label,
              cli: existing.runner,
              dispatchedToExisting: true,
              queued: true,
              deliveredToTerminal: false,
              result: queued,
              reason: `Painel ocupado${existing.activeTaskId ? ` com ${existing.activeTaskId}` : ""}. Tarefa foi para a inbox e NÃO foi colada no terminal. Chame delegar de novo quando situacao mostrar parado.`,
            });
            break;
          }
          const currentPanesCount = listPanes().filter((p) => p.missionId === mission.id).length;
          const spawnGuard = canMaestroAutoSpawn({
            mode: modeInfo.modo,
            currentPanes: currentPanesCount,
            maxPanes: modeInfo.maxPanes,
            emergencyHalt: modeInfo.emergencyHalt,
          });
          if (!spawnGuard.allowed) throw Error(spawnGuard.reason);
          const spawned = ctx.abrirPainel(String(args.agente), mission.id, String(args.tarefa), { tipo: args.tipo });
          ctx.trackDelegation?.(mission.id, spawned.paneId, String(args.agente));
          res.json(spawned);
          break;
        }
        case "cockpit_list":
          res.json(ctx.bridge.list(mission.id));
          break;
        case "cockpit_connect":
          res.json(ctx.bridge.connect(String(args.origem), String(args.destino), mission.id));
          break;
        case "cockpit_ask":
          res.json(ctx.bridge.ask(String(args.from ?? "maestro"), String(args.destino), String(args.tarefa), args.taskId ? String(args.taskId) : undefined, mission.id, { force: Boolean(args.force) }));
          break;
        case "cockpit_reply":
          res.json(ctx.bridge.reply(String(args.from ?? "maestro"), String(args.destino), String(args.correlationId), String(args.resultado), Array.isArray(args.evidence) ? args.evidence : [], mission.id));
          break;
        case "cockpit_handoff":
          res.json(ctx.bridge.handoff(String(args.origem), String(args.destino), String(args.taskId), args.contexto ? String(args.contexto) : undefined, Boolean(args.force), mission.id));
          break;
        case "cockpit_inbox":
          res.json(ctx.bridge.inbox(String(args.paneId ?? args.painel ?? "maestro"), mission.id, Boolean(args.naoLidas)));
          break;
        default:
          throw Error("Ferramenta desconhecida.");
      }
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/missions/:id/media", async (req, res) => {
    try {
      const mission = getMission(req.params.id);
      if (!mission) throw new Error("missão não encontrada");
      const tipo = String(req.body.tipo ?? "image");
      if (!["image", "video", "audio"].includes(tipo)) throw new Error(`tipo "${tipo}" não existe`);
      const feito = await gerar({
        tipo: tipo as "image" | "video" | "audio",
        prompt: String(req.body.prompt ?? ""),
        destino: cwdDaMissao(mission),
        provedor: req.body.provedor ? String(req.body.provedor) : undefined,
        modelo: req.body.modelo ? String(req.body.modelo) : undefined,
        referencia: req.body.referencia ? String(req.body.referencia) : undefined,
      });
      res.json(feito);
    } catch (err) {
      fail(res, err);
    }
  });

  router.get("/missions", async (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const panes = listPanes();
    const missions = await Promise.all(
      listMissions(projectId).map(async (m: any) => ({
        ...m,
        git: await branchStatus(cwdDaMissao(m)),
        usage: somaUsage(
          panes.filter((p) => p.missionId === m.id).map((p) => readUsage(p.sessionId)),
        ),
        squad: getRun(m.id) ?? null,
      })),
    );
    res.json({ missions });
  });

  router.post("/missions", async (req, res) => {
    try {
      const modo = normalizeMissionMode(req.body.modo);
      const ownershipMode = req.body.ownershipMode === "isolated" ? "isolated" : "shared";
      const mission = await createMission(
        String(req.body.projectId ?? ""),
        String(req.body.nome ?? ""),
        String(req.body.objetivo ?? ""),
        {
          skills: Array.isArray(req.body.skills) ? (req.body.skills as string[]) : undefined,
          receita: req.body.receita ? String(req.body.receita) : undefined,
          elenco: ctx.limparElenco(req.body.elenco),
          modo,
          ownershipMode,
        },
      );
      ctx.missionModeManager.setMissionMode(mission.id, modo);
      observar(cwdDaMissao(mission), avisarMudanca);
      res.json(mission);
    } catch (err) {
      fail(res, err);
    }
  });

  router.get("/missions/:id/modo", (req, res) => {
    try {
      const mission = getMission(req.params.id);
      if (!mission) throw new Error("missão não encontrada");
      const info = ctx.missionModeManager.getMissionMode(mission.id, normalizeMissionMode(mission.modo));
      res.json({ ok: true, ...info });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/missions/:id/modo", (req, res) => {
    try {
      const mission = getMission(req.params.id);
      if (!mission) throw new Error("missão não encontrada");
      const novoModo = ctx.missionModeManager.setMissionMode(mission.id, req.body.modo);
      mission.modo = novoModo;
      persistir();
      ctx.broadcast({ type: "mission:mode_changed", missionId: mission.id, modo: novoModo });
      res.json({ ok: true, modo: novoModo });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/missions/:id/emergency-stop", (req, res) => {
    try {
      const mission = getMission(req.params.id);
      if (!mission) throw new Error("missão não encontrada");
      ctx.missionModeManager.emergencyStop(mission.id);
      ctx.broadcast({ type: "mission:emergency_stop", missionId: mission.id, halted: true });
      res.json({ ok: true, emergencyHalt: true });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/missions/:id/resume", (req, res) => {
    try {
      const mission = getMission(req.params.id);
      if (!mission) throw new Error("missão não encontrada");
      ctx.missionModeManager.resumeMission(mission.id);
      ctx.broadcast({ type: "mission:resumed", missionId: mission.id, halted: false });
      res.json({ ok: true, emergencyHalt: false });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/missions/:id/nome", (req, res) => {
    try {
      const mission = getMission(req.params.id);
      if (!mission) throw new Error("missão não encontrada");
      const nome = String(req.body.nome ?? "").trim();
      if (!nome) throw new Error("nome da missão é obrigatório");
      if (nome.length > 120) throw new Error("nome da missão deve ter no máximo 120 caracteres");
      mission.nome = nome;
      persistir();
      res.json({ mission });
    } catch (err) {
      fail(res, err);
    }
  });

  router.get("/missions/:id/elenco", (req, res) => {
    const mission = getMission(req.params.id);
    if (!mission) return fail(res, new Error("missão não encontrada"));
    res.json({
      elenco: mission.elenco ?? null,
      especialistas: ctx.especialistasDaMissao(mission.id),
      tarefas: tiposDeTarefa(),
    });
  });

  router.post("/missions/:id/elenco", (req, res) => {
    try {
      const mission = getMission(req.params.id);
      if (!mission) throw new Error("missão não encontrada");
      mission.elenco = ctx.limparElenco(req.body.elenco);
      persistir();
      res.json({ elenco: mission.elenco ?? null });
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete("/missions/:id", async (req, res) => {
    try {
      encerrarRun(req.params.id);
      await archiveMission(req.params.id, async (paneId) => {
        // stopPane aguarda reap do runtime DSH; killPty sozinho era fire-and-forget.
        await stopPane(paneId);
        ctx.broadcast({ type: "exit", paneId, code: 0 });
      });
      await flushDshKills();
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/missions/:id/delegar", (req, res) => {
    try {
      const missionId = req.params.id;
      const mission = getMission(missionId);
      if (!mission) throw new Error("missão não encontrada");

      const modeInfo = ctx.missionModeManager.getMissionMode(missionId, normalizeMissionMode(mission.modo));
      if (modeInfo.emergencyHalt) throw new Error("Parada de emergência ativa. Delegações bloqueadas.");
      if (modeInfo.modo === "livre") {
        throw new Error("Delegação autônoma desativada no modo Livre. O usuário mantém controle manual.");
      }
      if (modeInfo.modo === "dirigido") {
        const elencoClis = mission.elenco?.clis ?? [];
        const authorizedAgents = Object.entries(ctx.config.agents)
          .filter(([, a]) => elencoClis.length === 0 || elencoClis.includes((a as any).cli))
          .map(([k]) => k);
        const openPaneTargets = ctx.paneDispatcher.listAvailablePanes(missionId).flatMap((p) => [p.label, p.role]);
        const guard = canMaestroDelegate({
          mode: modeInfo.modo,
          targetAgentOrRole: String(req.body.agent ?? ""),
          authorizedRoles: [...authorizedAgents, ...openPaneTargets],
          emergencyHalt: modeInfo.emergencyHalt,
        });
        if (!guard.allowed) throw Error(guard.reason);
      }

      const requestedAgent = String(req.body.agent ?? "");
      const existing = ctx.paneDispatcher.findExistingPane(missionId, requestedAgent);
      if (existing?.connected && existing.status !== "dead" && existing.status !== "failed") {
        if (existing.status === "starting") {
          throw new Error(`Painel ${existing.label} (${existing.paneId}) ainda está inicializando. Espere e chame delegar de novo — não abra outro painel.`);
        }
        if (existing.canAcceptTask) {
          const task = ctx.taskManager.createTask(missionId, {
            título: String(req.body.tarefa ?? "").slice(0, 80),
            descrição: String(req.body.tarefa ?? ""),
            papel: requestedAgent,
            status: "todo",
          });
          const dispatched = ctx.paneDispatcher.dispatchToExistingPane(missionId, task.id, existing.paneId);
          ctx.trackDelegation?.(missionId, existing.paneId, existing.label || requestedAgent);
          res.json({
            paneId: existing.paneId,
            label: existing.label,
            cli: existing.runner,
            dispatchedToExisting: true,
            taskId: task.id,
            deliveredToTerminal: dispatched.deliveredToTerminal === true,
            skills: [],
          });
          return;
        }
        const queued = ctx.bridge.ask("maestro", existing.paneId, String(req.body.tarefa ?? ""), undefined, missionId);
        res.json({
          paneId: existing.paneId,
          label: existing.label,
          cli: existing.runner,
          dispatchedToExisting: true,
          queued: true,
          deliveredToTerminal: false,
          result: queued,
          skills: [],
          reason: `Painel ocupado${existing.activeTaskId ? ` com ${existing.activeTaskId}` : ""}. Tarefa foi para a inbox e NÃO foi colada no terminal. Chame delegar de novo quando situacao mostrar parado.`,
        });
        return;
      }

      // Auto-spawn check
      const currentPanesCount = listPanes().filter((p) => p.missionId === missionId).length;
      const spawnGuard = canMaestroAutoSpawn({
        mode: modeInfo.modo,
        currentPanes: currentPanesCount,
        maxPanes: modeInfo.maxPanes,
        emergencyHalt: modeInfo.emergencyHalt,
      });
      if (!spawnGuard.allowed) throw Error(spawnGuard.reason);

      const state = ctx.abrirPainel(
        String(req.body.agent ?? ""),
        req.params.id,
        String(req.body.tarefa ?? ""),
        {
          tipo: typeof req.body.tipo === "string" ? req.body.tipo : undefined,
          ...(typeof req.body.provedor === "string" && req.body.provedor
            ? { invoke: { cli: String(req.body.provedor) } }
            : {}),
        },
        Array.isArray(req.body.skills) ? (req.body.skills as string[]) : [],
      );
      ctx.trackDelegation?.(req.params.id, state.paneId, state.label || String(req.body.agent));
      res.json({
        paneId: state.paneId,
        label: state.label,
        cli: state.cli,
        skills: skillsDoAgente(state.agent, ctx.config.agents[state.agent]!, [
          ...(getMission(req.params.id)?.skills ?? []),
          ...(Array.isArray(req.body.skills) ? (req.body.skills as string[]) : []),
        ]).map((s) => s.nome),
      });
    } catch (err) {
      fail(res, err);
    }
  });

  router.get("/missions/:id/resultado/:painel", async (req, res) => {
    try {
      const missionId = req.params.id;
      const target = decodeURIComponent(req.params.painel).toLowerCase();
      const panes = listPanes().filter((p) => p.missionId === missionId);
      const pane = panes.find(
        (p) =>
          p.paneId.toLowerCase() === target ||
          p.label.toLowerCase() === target ||
          p.agent.toLowerCase() === target ||
          (p.role && p.role.toLowerCase() === target),
      );
      if (!pane) {
        res.status(404).json({ error: `Painel ou especialista '${req.params.painel}' não encontrado nesta missão.` });
        return;
      }
      let scrollback = "";
      try {
        scrollback = await replayPane(pane.paneId);
      } catch {
        scrollback = ctx.outputTails?.get(pane.paneId) ?? "";
      }
      const clean = scrollback
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
        .replace(/\x1b\].*?(\x07|\x1b\\)/g, "")
        .replace(/\x1b[()][AB012]/g, "")
        .replace(/\r/g, "")
        .trim();
      res.json({
        paneId: pane.paneId,
        agente: pane.label,
        cli: pane.cli,
        saida: clean,
      });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/missions/:id/squad", (req, res) => {
    try {
      const mission = getMission(req.params.id);
      if (!mission) throw new Error("missão não encontrada");
      const r = iniciarSquad(
        mission,
        String(req.body.squad ?? ""),
        String(req.body.brief ?? ""),
        (a, tarefa, h) => ctx.abrirPainel(a, mission.id, tarefa, h),
      );
      res.json(r);
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/missions/:id/squad/avancar", (req, res) => {
    try {
      const mission = getMission(req.params.id);
      if (!mission) throw new Error("missão não encontrada");
      res.json(
        avancarFase(mission, (a, tarefa, h) => ctx.abrirPainel(a, mission.id, tarefa, h)),
      );
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
