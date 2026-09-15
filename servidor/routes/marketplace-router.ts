import { Router } from "express";
import type { RouterContext } from "./types.ts";
import {
  esquecerCatalogo,
  listarFontes,
  catalogo,
  adicionarFonte,
  atualizarFonte,
  baixarPlugin,
  instalarPlugin,
  instalarSkill,
} from "../orchestration/marketplace.ts";

export function createMarketplaceRouter(_ctx: RouterContext): Router {
  const router = Router();

  const fail = (res: any, err: unknown) =>
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });

  router.get("/marketplace", (req, res) => {
    if (req.query.rescan === "1") esquecerCatalogo();
    res.json({ fontes: listarFontes(), plugins: catalogo() });
  });

  router.post("/marketplace/fonte", (req, res) => {
    try {
      res.json(adicionarFonte(String(req.body.url ?? "")));
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/marketplace/fonte/:id/atualizar", (req, res) => {
    try {
      atualizarFonte(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/marketplace/baixar", (req, res) => {
    try {
      res.json(baixarPlugin(String(req.body.plugin ?? "")));
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/marketplace/instalar", (req, res) => {
    try {
      const plugin = String(req.body.plugin ?? "");
      // Sem `skill` instala o plugin inteiro — é o botão "instalar tudo".
      res.json(req.body.skill ? instalarSkill(plugin, String(req.body.skill)) : instalarPlugin(plugin));
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
