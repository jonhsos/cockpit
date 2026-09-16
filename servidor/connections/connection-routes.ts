import { Router, type Request, type Response } from "express";
import type { InterAgentBridge } from "./inter-agent-bridge.ts";

export function createConnectionRoutes(bridge: InterAgentBridge): Router {
  const router = Router();

  const fail = (res: Response, err: unknown, status = 400) => {
    res.status(status).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  };

  const param = (p: string | string[] | undefined): string => (Array.isArray(p) ? p[0] : (p ?? ""));

  // GET /api/cockpit/list
  router.get("/cockpit/list", (req: Request, res: Response) => {
    try {
      const missionId = typeof req.query.mission === "string" ? req.query.mission : undefined;
      const result = bridge.list(missionId);
      res.json(result);
    } catch (err) {
      fail(res, err);
    }
  });

  // GET /api/missions/:missionId/cockpit/list
  router.get("/missions/:missionId/cockpit/list", (req: Request, res: Response) => {
    try {
      const missionId = param(req.params.missionId);
      const result = bridge.list(missionId);
      res.json(result);
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /api/missions/:missionId/cockpit/connect
  router.post("/missions/:missionId/cockpit/connect", (req: Request, res: Response) => {
    try {
      const missionId = param(req.params.missionId);
      const body = req.body || {};
      const src = body.sourcePaneId || body.from;
      const dst = body.targetPaneId || body.to;
      if (!src || !dst) {
        throw new Error("sourcePaneId e targetPaneId são obrigatórios");
      }
      const conn = bridge.connect(String(src), String(dst), missionId);
      res.json({ ok: true, connection: conn });
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /api/missions/:missionId/cockpit/ask
  router.post("/missions/:missionId/cockpit/ask", (req: Request, res: Response) => {
    try {
      const missionId = param(req.params.missionId);
      const body = req.body || {};
      const { from, to, task, taskId } = body;
      if (!to || !task) {
        throw new Error("to e task são obrigatórios");
      }
      const result = bridge.ask(
        String(from || "user"),
        String(to),
        String(task),
        taskId ? String(taskId) : undefined,
        missionId,
        { force: Boolean(body.force) },
      );
      res.json({ ok: true, result });
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /api/missions/:missionId/cockpit/reply
  router.post("/missions/:missionId/cockpit/reply", (req: Request, res: Response) => {
    try {
      const missionId = param(req.params.missionId);
      const body = req.body || {};
      const { from, to, correlationId, result, evidence } = body;
      if (!to || !correlationId) {
        throw new Error("to e correlationId são obrigatórios");
      }
      const resMsg = bridge.reply(
        String(from || "user"),
        String(to),
        String(correlationId),
        String(result ?? ""),
        evidence,
        missionId,
      );
      res.json({ ok: true, result: resMsg });
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /api/missions/:missionId/cockpit/handoff
  router.post("/missions/:missionId/cockpit/handoff", (req: Request, res: Response) => {
    try {
      const missionId = param(req.params.missionId);
      const body = req.body || {};
      const { sourcePaneId, targetPaneId, from, to, taskId, context, force } = body;
      const src = sourcePaneId || from;
      const dst = targetPaneId || to;
      if (!src || !dst || !taskId) {
        throw new Error("sourcePaneId, targetPaneId e taskId são obrigatórios");
      }
      const handoff = bridge.handoff(
        String(src),
        String(dst),
        String(taskId),
        context ? String(context) : undefined,
        Boolean(force),
        missionId,
      );
      res.json({ ok: true, handoff });
    } catch (err) {
      fail(res, err);
    }
  });

  // GET /api/missions/:missionId/panes/:paneId/inbox
  router.get("/missions/:missionId/panes/:paneId/inbox", (req: Request, res: Response) => {
    try {
      const missionId = param(req.params.missionId);
      const paneId = param(req.params.paneId);
      const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
      const inbox = bridge.inbox(paneId, missionId, unreadOnly);
      res.json({ ok: true, inbox, total: inbox.length });
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /api/missions/:missionId/panes/:paneId/inbox/:msgId/read
  router.post("/missions/:missionId/panes/:paneId/inbox/:msgId/read", (req: Request, res: Response) => {
    try {
      const missionId = param(req.params.missionId);
      const paneId = param(req.params.paneId);
      const msgId = param(req.params.msgId);
      const marked = bridge.getMailboxManager().markRead(paneId, msgId, missionId);
      res.json({ ok: true, marked });
    } catch (err) {
      fail(res, err);
    }
  });

  // GET /api/missions/:missionId/connections
  router.get("/missions/:missionId/connections", (req: Request, res: Response) => {
    try {
      const missionId = param(req.params.missionId);
      const conns = bridge.getConnectionManager().listConnections(missionId);
      res.json({ ok: true, connections: conns });
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /api/missions/:missionId/connections
  router.post("/missions/:missionId/connections", (req: Request, res: Response) => {
    try {
      const missionId = param(req.params.missionId);
      const body = req.body || {};
      const src = body.sourcePaneId || body.from;
      const dst = body.targetPaneId || body.to;
      if (!src || !dst) {
        throw new Error("sourcePaneId e targetPaneId são obrigatórios");
      }
      const conn = bridge.connect(String(src), String(dst), missionId);
      res.json({ ok: true, connection: conn });
    } catch (err) {
      fail(res, err);
    }
  });

  // DELETE /api/missions/:missionId/connections/:id
  router.delete("/missions/:missionId/connections/:id", (req: Request, res: Response) => {
    try {
      const missionId = param(req.params.missionId);
      const id = param(req.params.id);
      const ok = bridge.getConnectionManager().disconnectPanes(id, missionId);
      res.json({ ok });
    } catch (err) {
      fail(res, err);
    }
  });

  // GET /api/missions/:missionId/handoffs
  router.get("/missions/:missionId/handoffs", (req: Request, res: Response) => {
    try {
      const missionId = param(req.params.missionId);
      const handoffs = bridge.getHandoffManager().listHandoffs(missionId);
      res.json({ ok: true, handoffs });
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
