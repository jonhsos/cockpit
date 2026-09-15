import { Router } from "express";
import type { RouterContext } from "./types.ts";
import { accountPool } from "../providers/account-pool.ts";
import { AgyOnboardingService } from "../providers/agy-onboarding.ts";

export function createAccountPoolsRouter(ctx: RouterContext): Router {
  const router = Router();
  AgyOnboardingService.setBroadcaster(ctx.broadcast);

  const fail = (res: any, err: unknown) =>
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });

  router.get("/account-pools", (_req, res) => {
    try {
      res.json({ ok: true, pools: accountPool.getView() });
    } catch (err) {
      fail(res, err);
    }
  });

  // --- Onboarding Automático (Google OAuth / AGY) ---

  // Iniciar sessão de onboarding
  const handleOnboardStart = async (req: any, res: any) => {
    try {
      const cli = req.body?.cli || "agy";
      // preferredPort is intentionally ignored from the public API (ephemeral :0 only).
      const result = await AgyOnboardingService.startSession({ cli });
      res.json({
        ok: true,
        sessionId: result.sessionId,
        authUrl: result.authUrl,
        loopbackPort: result.port,
        expiresAt: result.expiresAt,
      });
    } catch (err) {
      fail(res, err);
    }
  };
  router.post("/account-pools/onboard", handleOnboardStart);
  router.post("/account-pools/onboard/start", handleOnboardStart);

  // Status de sessão de onboarding via query ou param
  router.get("/account-pools/onboard/status", (req, res) => {
    try {
      const sessionId = String(req.query.sessionId || "");
      const session = AgyOnboardingService.getSession(sessionId);
      if (!session) {
        return res.status(404).json({
          ok: false,
          error: "Sessão de onboarding não encontrada ou expirada",
        });
      }
      res.json({
        ok: true,
        sessionId: session.id,
        status: session.status,
        error: session.error || null,
        account: session.account || null,
      });
    } catch (err) {
      fail(res, err);
    }
  });

  router.get("/account-pools/onboard/:sessionId", (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = AgyOnboardingService.getSession(sessionId);
      if (!session) {
        return res.status(404).json({
          ok: false,
          error: "Sessão de onboarding não encontrada ou expirada",
        });
      }
      res.json({
        ok: true,
        sessionId: session.id,
        status: session.status,
        error: session.error || null,
        account: session.account || null,
      });
    } catch (err) {
      fail(res, err);
    }
  });

  // Cancelar sessão de onboarding e liberar servidor loopback
  router.delete("/account-pools/onboard/:sessionId", (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = AgyOnboardingService.getSession(sessionId);
      if (session) {
        AgyOnboardingService.cleanupSession(sessionId, "cancelled");
      }
      res.json({ ok: true, message: "Sessão cancelada com sucesso" });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/account-pools/onboard/cancel", (req, res) => {
    try {
      const sessionId = req.body?.sessionId;
      if (sessionId) {
        AgyOnboardingService.cleanupSession(sessionId, "cancelled");
      }
      res.json({ ok: true, message: "Sessão cancelada com sucesso" });
    } catch (err) {
      fail(res, err);
    }
  });

  // Callback manual (fallback para ambientes remotos/VPS sem túnel direto)
  const handleManualCallback = async (req: any, res: any) => {
    try {
      const sessionId = req.params.sessionId || req.body?.sessionId;
      if (!sessionId) {
        throw new Error("Parâmetro 'sessionId' é obrigatório");
      }
      const urlOrCode = req.body?.url || req.body?.code || req.body?.callbackUrl;
      if (!urlOrCode) {
        throw new Error("Parâmetro 'url' ou 'code' é obrigatório");
      }
      const account = await AgyOnboardingService.handleManualCallback(sessionId, urlOrCode);
      res.json({ ok: true, account });
    } catch (err) {
      fail(res, err);
    }
  };
  router.post("/account-pools/onboard/callback", handleManualCallback);
  router.post("/account-pools/onboard/:sessionId/callback", handleManualCallback);

  // --- Rotas Pré-existentes de Gestão do Pool ---

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

