import { Router } from "express";
import type { RouterContext } from "./types.ts";
import { validarPoliticaIA } from "../orchestration/politica-ia.ts";
import { modelosDoCli } from "../config.ts";
import { listarProvidersAtualizados } from "../providers/providers.ts";
import { listarReceitas } from "../orchestration/receitas.ts";
import { tiposDeTarefa } from "../orchestration/harness.ts";

export function createConfigRouter(ctx: RouterContext): Router {
  const router = Router();

  const fail = (res: any, err: unknown) =>
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });

  router.get("/config", async (_req, res) => {
    const providers = await listarProvidersAtualizados();
    res.json({
      agents: ctx.config.agents,
      squads: ctx.config.squads,
      tarefas: tiposDeTarefa(),
      providers,
      receitas: listarReceitas(),
      autoAprovar: ctx.config.autoAprovar !== false,
    });
  });

  router.post("/config/auto-aprovar", (req, res) => {
    try {
      ctx.config.autoAprovar = Boolean(req.body.autoAprovar);
      ctx.salvarConfig();
      res.json({ ok: true, autoAprovar: ctx.config.autoAprovar });
    } catch (err) {
      fail(res, err);
    }
  });

  router.get("/politica-ia", async (_req, res) => {
    const providers = await listarProvidersAtualizados();
    res.json({
      politica: ctx.config.politicaIA ?? { modo: "padrao" },
      agents: ctx.config.agents,
      providers,
    });
  });

  router.post("/politica-ia", (req, res) => {
    try {
      ctx.config.politicaIA = validarPoliticaIA(req.body);
      ctx.salvarConfig();
      ctx.notifyMaestro();
      res.json(ctx.config.politicaIA);
    } catch (err) {
      fail(res, err);
    }
  });

  router.get("/maestro", (_req, res) => {
    res.json(ctx.maestroStatus());
  });

  router.post("/maestro/refresh", async (_req, res) => {
    await ctx.refreshQuota();
    res.json(ctx.maestroStatus());
  });

  router.post("/maestro", (req, res) => {
    try {
      const cli = String(req.body.cli);
      const presets = ctx.presetsDoMaestro();
      if (!presets[cli]) throw Error("Provedor inválido.");
      const model = String(req.body.model ?? presets[cli].model);
      const effort = String(req.body.effort ?? presets[cli].effort);
      if (!modelosDoCli(cli).includes(model) || !ctx.config.efforts?.[cli]?.includes(effort)) {
        throw Error("Modelo ou esforço inválido para o provedor.");
      }
      ctx.config.agents.maestro = { ...ctx.config.agents.maestro!, cli, model, effort, maestro: true };
      ctx.config.maestroAutoSwitch = req.body.auto === true;
      ctx.salvarConfig();
      ctx.notifyMaestro();
      res.json(ctx.maestroStatus());
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/maestro/reset-limit", (req, res) => {
    ctx.limits.delete(String(req.body.cli));
    ctx.notifyMaestro();
    res.json(ctx.maestroStatus());
  });

  return router;
}
