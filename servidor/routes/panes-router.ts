import { Router } from "express";
import type { RouterContext } from "./types.ts";
import { getPane, listPanes, updatePane, replayPane, writePty, submitPrompt } from "../pty.ts";
import { MAX_DSH_PROMPT_LENGTH } from "../sessions/dsh-backend/dsh-manager.ts";
import { readUsage } from "../usage.ts";

export function createPanesRouter(ctx: RouterContext): Router {
  const router = Router();

  router.get("/panes", (req, res) => {
    const missionId = typeof req.query.missionId === "string" ? req.query.missionId : null;
    res.json({
      panes: listPanes()
        .filter((p) => !missionId || p.missionId === missionId)
        .map((p) => {
          const raw = ctx.outputTails?.get(p.paneId) ?? "";
          const clean = raw
            .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
            .replace(/\x1b\].*?(\x07|\x1b\\)/g, "")
            .replace(/\x1b[()][AB012]/g, "")
            .replace(/\r/g, "")
            .trim();
          const lines = clean.split("\n").filter((l) => l.trim().length > 0);
          const saida_recente = lines.slice(-25).join("\n");
          return {
            ...p,
            saida_recente: saida_recente || undefined,
            usage: readUsage(p.sessionId),
          };
        }),
    });
  });

  router.post("/panes/:paneId/papel", (req, res) => {
    try {
      const pane = getPane(req.params.paneId);
      if (!pane) throw new Error("painel não encontrado");
      const novoMaestro = Boolean(req.body.maestro);
      const novoAgente = typeof req.body.agent === "string" ? req.body.agent : pane.agent;
      if (!ctx.config.agents[novoAgente]) throw new Error("agente inválido");
      if (pane.cli === "bash" && ctx.config.agents[novoAgente]?.maestro) {
        throw new Error("um Shell pode receber função de especialista; Maestro é outro painel");
      }
      const novoLabel =
        typeof req.body.label === "string"
          ? req.body.label
          : (ctx.config.agents[novoAgente]?.label ?? pane.label);
      const novaCor =
        typeof req.body.cor === "string"
          ? req.body.cor
          : (ctx.config.agents[novoAgente]?.cor ?? pane.cor);

      // Se estiver promovendo a maestro, desativa maestro de outros painéis da mesma missão
      if (novoMaestro && pane.missionId) {
        for (const outro of listPanes()) {
          if (outro.missionId === pane.missionId && outro.paneId !== pane.paneId && outro.maestro) {
            updatePane(outro.paneId, { maestro: false });
          }
        }
      }

      const atualizado = updatePane(pane.paneId, {
        maestro: novoMaestro,
        agent: novoAgente,
        label: novoLabel,
        cor: novaCor,
      });
      ctx.broadcast({ type: "panes", panes: listPanes() });
      res.json({ ok: true, pane: atualizado });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/panes/:paneId/prompt", async (req, res) => {
    try {
      const paneId = req.params.paneId;
      const pane = getPane(paneId);
      if (!pane) {
        return res.status(404).json({ ok: false, error: "painel não encontrado" });
      }
      if (pane.backend !== "dsh") {
        return res.status(409).json({ ok: false, error: "entrada estruturada é exclusiva de painéis DSH" });
      }
      const prompt = req.body?.prompt;
      if (typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({ ok: false, error: "campo 'prompt' é obrigatório e deve ser não-vazio" });
      }
      if (prompt.trim().length > MAX_DSH_PROMPT_LENGTH) {
        return res.status(413).json({ ok: false, error: `prompt excede ${MAX_DSH_PROMPT_LENGTH} caracteres` });
      }
      if (pane.missionId) {
        ctx.continuity?.record(pane.missionId, pane.paneId, "input", prompt);
      }
      const ok = await submitPrompt(paneId, prompt);
      if (!ok) return res.status(409).json({ ok: false, error: "painel DSH indisponível" });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/panes/:id/replay", async (req, res) => {
    try {
      const scrollback = await replayPane(req.params.id);
      res.json({ paneId: req.params.id, scrollback });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  return router;
}
