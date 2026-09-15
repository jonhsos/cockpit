import { Router } from "express";
import type { RouterContext } from "./types.ts";
import {
  listarSkills,
  acharSkill,
  salvarSkill,
  apagarSkill,
  skillsDoAgente,
} from "../orchestration/skills.ts";
import { esquecerCatalogo, resumoDoAcervo } from "../orchestration/marketplace.ts";
import {
  listarReceitas,
  salvarReceita,
  aplicarReceita,
  apagarReceita,
} from "../orchestration/receitas.ts";

export function createSkillsRouter(ctx: RouterContext): Router {
  const router = Router();

  const fail = (res: any, err: unknown) =>
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });

  // ---------- skills ----------

  router.get("/skills", (_req, res) => {
    // O corpo não vai na listagem: são 45 arquivos e a tela só precisa da linha.
    const skills = listarSkills().map(({ corpo, ...resto }) => ({ ...resto, tamanho: corpo.length }));
    res.json({ skills, acervo: resumoDoAcervo() });
  });

  router.get("/skills/:nome", (req, res) => {
    const s = acharSkill(req.params.nome);
    if (!s) return fail(res, new Error(`não existe skill "${req.params.nome}"`));
    res.json(s);
  });

  router.post("/skills", (req, res) => {
    try {
      res.json(
        salvarSkill({
          nome: String(req.body.nome ?? ""),
          descricao: String(req.body.descricao ?? ""),
          papeis: Array.isArray(req.body.papeis) ? (req.body.papeis as string[]) : [],
          corpo: String(req.body.corpo ?? ""),
        }),
      );
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete("/skills/:nome", (req, res) => {
    try {
      apagarSkill(req.params.nome);
      esquecerCatalogo();
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  /** Quais skills um agente carrega, e por quê — o "explique" desta tela. */
  router.get("/agents/:id/skills", (req, res) => {
    const spec = ctx.config.agents[req.params.id];
    if (!spec) return fail(res, new Error(`não existe agente "${req.params.id}"`));
    res.json({
      skills: skillsDoAgente(req.params.id, spec).map((s) => ({ nome: s.nome, descricao: s.descricao })),
      fixas: spec.skills ?? [],
      allowedSkills: spec.allowedSkills ?? null,
      papel_id: spec.papel_id ?? req.params.id,
    });
  });

  router.post("/agents/:id/skills", (req, res) => {
    try {
      const spec = ctx.config.agents[req.params.id];
      if (!spec) throw new Error(`não existe agente "${req.params.id}"`);
      if (Array.isArray(req.body.skills)) spec.skills = req.body.skills as string[];
      // null tira a trava; array vazio é "nenhuma skill", que é diferente.
      if (req.body.allowedSkills === null) delete spec.allowedSkills;
      else if (Array.isArray(req.body.allowedSkills)) spec.allowedSkills = req.body.allowedSkills as string[];
      ctx.salvarConfig();
      res.json({ ok: true, skills: skillsDoAgente(req.params.id, spec).map((s) => s.nome) });
    } catch (err) {
      fail(res, err);
    }
  });

  // ---------- receitas ----------

  router.get("/receitas", (_req, res) => res.json({ receitas: listarReceitas() }));

  router.post("/receitas", (req, res) => {
    try {
      const { id, ...resto } = req.body as { id: string } & Record<string, unknown>;
      res.json(salvarReceita(String(id ?? ""), resto as never));
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/receitas/:id/aplicar", (req, res) => {
    try {
      res.json(aplicarReceita(req.params.id));
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete("/receitas/:id", (req, res) => {
    try {
      apagarReceita(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
