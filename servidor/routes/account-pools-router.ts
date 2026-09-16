import { Router } from "express";
import type { RouterContext } from "./types.ts";
import { accountPool, argumentosDeLogin } from "../providers/account-pool.ts";
import { AgyOnboardingService } from "../providers/agy-onboarding.ts";
import { getMission, listMissions, listProjects } from "../state.ts";
import { listPanes } from "../pty.ts";
import { createMission } from "../missions/missions.ts";

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
      const familia = ctx.config.clis[cli]?.familia ?? cli;
      if (familia !== "codex" && familia !== "claude") {
        throw new Error(`Login assistido não é suportado para o provedor "${cli}"`);
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

  router.post("/account-pools/login-terminal", async (req, res) => {
    try {
      const cli = String(req.body?.cli || "");
      const accountId = String(req.body?.accountId || "");
      if (!cli || !accountId) {
        throw new Error("Parâmetros 'cli' e 'accountId' são obrigatórios");
      }
      const accounts = accountPool.getAccounts(cli);
      const account = accounts.find((a) => a.id === accountId);
      if (!account) {
        throw new Error(`Conta "${accountId}" não encontrada no pool de ${cli}`);
      }

      let missionId = typeof req.body?.missionId === "string" && req.body.missionId.trim() ? req.body.missionId.trim() : undefined;
      if (missionId) {
        const targetMission = getMission(missionId);
        if (!targetMission) {
          missionId = undefined;
        } else {
          const activeInProject = listPanes().find((p) => {
            if (!p.missionId || p.missionId === missionId) return false;
            const m = getMission(p.missionId);
            return m?.projectId === targetMission.projectId;
          });
          if (activeInProject?.missionId) {
            missionId = activeInProject.missionId;
          }
        }
      }
      if (!missionId) {
        const activePane = listPanes().find((p) => p.missionId && getMission(p.missionId));
        if (activePane?.missionId) {
          missionId = activePane.missionId;
        } else {
          const openProjects = new Set(listProjects().map((p) => p.id));
          const missoes = listMissions().filter((m) => openProjects.has(m.projectId));
          if (missoes.length > 0) {
            missionId = missoes[0].id;
          } else {
            const projetos = listProjects();
            if (projetos.length > 0) {
              const novaMissao = await createMission(projetos[0].id, "Autenticação", "Terminal de autenticação de contas");
              missionId = novaMissao.id;
            } else {
              throw new Error("Nenhum projeto aberto. Abra uma pasta de projeto antes de iniciar o terminal de login.");
            }
          }
        }
      }

      const pane = ctx.abrirPainel(
        "shell",
        missionId,
        undefined,
        {
          runner: cli,
          backend: "pty",
          loginArgs: argumentosDeLogin(cli),
        },
        [],
        false,
        {
          preferredAccountId: account.id,
          accountPinned: true,
        },
      );

      res.json({ ok: true, paneId: pane.paneId, pane });
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
