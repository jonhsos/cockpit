import { Router } from "express";
import type { RouterContext } from "./types.ts";
import {
  listarMedia,
  esquecerMedia,
  guardarChave,
  instalarProvedor,
  definirModelo,
} from "../providers/media.ts";

export function createMediaRouter(_ctx: RouterContext): Router {
  const router = Router();

  const fail = (res: any, err: unknown) =>
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });

  router.get("/media", (req, res) => {
    if (req.query.rescan === "1") esquecerMedia();
    res.json({ provedores: listarMedia() });
  });

  router.post("/media/:id/chave", (req, res) => {
    try {
      // A chave entra e não sai: nenhuma rota devolve o valor, só se está posta.
      guardarChave(req.params.id, String(req.body.chave ?? ""));
      esquecerMedia();
      res.json({ ok: true, provedores: listarMedia() });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/media/:id/instalar", (req, res) => {
    try {
      res.json({ ...instalarProvedor(req.params.id), provedores: listarMedia() });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/media/:id/modelo", (req, res) => {
    try {
      definirModelo(req.params.id, String(req.body.modelo ?? ""));
      res.json({ ok: true, provedores: listarMedia() });
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
