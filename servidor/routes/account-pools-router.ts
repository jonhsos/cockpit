import { Router } from "express";
import type { RouterContext } from "./types.ts";
import { accountPool } from "../providers/account-pool.ts";

export function createAccountPoolsRouter(ctx: RouterContext): Router {
  const router = Router();

  const fail = (res: any, err: unknown) =>
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });

  router.get("/account-pools", (_req, res) => {
    try {
      res.json({ ok: true, pools: accountPool.getView() });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/account-pools/reset-limit", (req, res) => {
    try {
      const { cli, accountId } = req.body as { cli?: string; accountId?: string };
      if (!cli) {
        throw new Error("Parâmetro 'cli' é obrigatório");
      }
      accountPool.resetLimit(cli, accountId);
      ctx.limits.delete(cli);
      ctx.notifyMaestro();
      ctx.broadcast({ type: "pool:updated", pools: accountPool.getView() });
      res.json({ ok: true, pools: accountPool.getView() });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/account-pools/mark-limit", (req, res) => {
    try {
      const { cli, accountId, detail, duration } = req.body as {
        cli?: string;
        accountId?: string;
        detail?: string;
        duration?: number;
      };
      if (!cli || !accountId) {
        throw new Error("Parâmetros 'cli' e 'accountId' são obrigatórios");
      }
      accountPool.markLimited(cli, accountId, detail ?? "429 Rate Limit Exceeded", duration ?? 60_000);
      ctx.broadcast({ type: "pool:updated", pools: accountPool.getView() });
      res.json({ ok: true, pools: accountPool.getView() });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/account-pools/account", (req, res) => {
    try {
      const { cli, account } = req.body as {
        cli?: string;
        account?: { id: string; label?: string; env?: Record<string, string>; args?: string[] };
      };
      if (!cli || !account || !account.id) {
        throw new Error("Parâmetros 'cli' e 'account.id' são obrigatórios");
      }
      accountPool.addAccount(cli, account);
      ctx.broadcast({ type: "pool:updated", pools: accountPool.getView() });
      res.json({ ok: true, pool: accountPool.getView(cli)[cli] });
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete("/account-pools/account", (req, res) => {
    try {
      const cli = String(req.query.cli || "");
      const accountId = String(req.query.accountId || "");
      if (!cli || !accountId) {
        throw new Error("Parâmetros 'cli' e 'accountId' são obrigatórios");
      }
      accountPool.removeAccount(cli, accountId);
      ctx.broadcast({ type: "pool:updated", pools: accountPool.getView() });
      res.json({ ok: true, pool: accountPool.getView(cli)[cli] });
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
