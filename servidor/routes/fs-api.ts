import { Router } from "express";
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import type { FileOwnershipManager } from "../tasks/index.ts";
import { getFileOwnershipManager } from "../tasks/index.ts";

export const IGNORADOS = new Set(["node_modules", ".git", "dist", ".cockpit", ".next"]);

export type No = { nome: string; caminho: string; dir: boolean; filhos?: No[] };

/** Resolve contra a raiz e recusa qualquer caminho que escape dela. */
export function dentroDaRaiz(base: string, relativo: string): string {
  const alvo = resolve(base, relativo || ".");
  const rel = relative(base, alvo);
  if (rel.startsWith("..") || (rel !== "" && resolve(base, rel) !== alvo)) {
    throw new Error("caminho fora da raiz");
  }
  return alvo;
}

function arvore(dir: string, base: string): No[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !IGNORADOS.has(e.name))
    .sort((a, b) =>
      a.isDirectory() === b.isDirectory()
        ? a.name.localeCompare(b.name)
        : a.isDirectory()
          ? -1
          : 1,
    )
    .map((e) => {
      const caminho = join(dir, e.name);
      const rel = relative(base, caminho).split(sep).join("/");
      return e.isDirectory()
        ? { nome: e.name, caminho: rel, dir: true, filhos: arvore(caminho, base) }
        : { nome: e.name, caminho: rel, dir: false };
    });
}

/** `raizDe` resolve o escopo pedido: missão, projeto, ou nada. */
export function criarFsApi(
  raizDe: (missionId: string | null, projectId: string | null) => string | null,
  ownershipManager?: FileOwnershipManager,
): Router {
  const router = Router();
  const om = ownershipManager ?? getFileOwnershipManager();

  const raiz = (q: Record<string, unknown>): string => {
    const base = raizDe(
      typeof q.missionId === "string" && q.missionId ? q.missionId : null,
      typeof q.projectId === "string" && q.projectId ? q.projectId : null,
    );
    if (!base) throw new Error("abra um projeto primeiro");
    return base;
  };

  router.get("/tree", (req, res) => {
    const base = raiz(req.query);
    res.json({ base, tree: existsSync(base) ? arvore(base, base) : [] });
  });

  router.get("/file", (req, res) => {
    try {
      const base = raiz(req.query);
      const alvo = dentroDaRaiz(base, String(req.query.path ?? ""));
      if (!existsSync(alvo)) {
        res.status(404).json({ error: "arquivo não encontrado" });
        return;
      }
      const st = statSync(alvo);
      if (!st.isFile()) {
        res.status(400).json({ error: "o caminho especificado não é um arquivo" });
        return;
      }
      if (st.size > 2_000_000) {
        res.status(413).json({ error: "arquivo grande demais para o editor" });
        return;
      }
      res.json({ path: req.query.path, content: readFileSync(alvo, "utf8") });
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? String(err) });
    }
  });

  router.post("/file", (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object") {
        res.status(400).json({ error: "corpo da requisição inválido" });
        return;
      }
      const body = req.body as {
        path?: string;
        content?: string;
        missionId?: string;
        projectId?: string;
        taskId?: string;
        paneId?: string;
      };
      if (typeof body.path !== "string" || !body.path) {
        res.status(400).json({ error: "caminho do arquivo obrigatório" });
        return;
      }
      const base = raiz(body as Record<string, unknown>);
      const alvo = dentroDaRaiz(base, body.path);

      const missionId = typeof body.missionId === "string" ? body.missionId : "";
      const filePath = body.path;
      if (missionId && filePath) {
        const access = om.checkAccess(missionId, filePath, {
          taskId: body.taskId,
          paneId: body.paneId,
        });
        if (!access.allowed) {
          res.status(409).json({
            ok: false,
            error: access.warning ?? "Arquivo bloqueado em modo isolado por outra tarefa",
            conflict: access.conflict,
          });
          return;
        }
      }

      writeFileSync(alvo, String(body.content ?? ""), "utf8");
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? String(err) });
    }
  });

  return router;
}
