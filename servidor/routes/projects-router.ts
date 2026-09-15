import { Router } from "express";
import { homedir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { RouterContext } from "./types.ts";
import {
  listProjects,
  addProject,
  getProject,
  closeProject,
  marcarGit,
  lerMemoria,
  anotar,
  esquecer,
} from "../state.ts";
import { escolherPasta } from "../pasta.ts";
import { observar, parar } from "../missions/watcher.ts";
import { prepararGit, temCommit } from "../missions/git.ts";
import { listMissions } from "../missions/missions.ts";
import { encerrarRun } from "../orchestration/squad.ts";
import { killPty, stopPane, flushDshKills } from "../pty.ts";

export function createProjectsRouter(ctx: RouterContext): Router {
  const router = Router();

  const fail = (res: any, err: unknown) =>
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });

  const avisarMudanca = (path: string, base: string) =>
    ctx.broadcast({ type: "fs-change", path, base });

  router.get("/projects", (_req, res) => res.json({ projects: listProjects() }));

  /** Abre o seletor nativo ou sinaliza ao frontend para usar o navegador embutido. */
  router.post("/escolher-pasta", (_req, res) => {
    escolherPasta().then(
      (resultado: unknown) => res.json(resultado),
      (err: Error) => fail(res, err),
    );
  });

  /** Lista subdiretórios para o navegador de pastas embutido. */
  router.post("/listar-diretorios", (req, res) => {
    try {
      const caminho = String(req.body.path || homedir());
      const absoluto = resolve(caminho);
      if (!existsSync(absoluto)) {
        res.json({ path: absoluto, dirs: [], parent: dirname(absoluto) });
        return;
      }
      const entradas = readdirSync(absoluto, { withFileTypes: true })
        .filter((e) => {
          if (!e.isDirectory()) return false;
          if (e.name.startsWith(".")) return false;
          // Verifica se temos permissão de leitura
          try {
            readdirSync(join(absoluto, e.name));
            return true;
          } catch {
            return false;
          }
        })
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
      res.json({ path: absoluto, dirs: entradas, parent: dirname(absoluto) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/projects", (req, res) => {
    try {
      const project = addProject(String(req.body.root ?? ""));
      observar(project.root, avisarMudanca);
      res.json(project);
    } catch (err) {
      fail(res, err);
    }
  });

  /** Liga o isolamento por missão numa pasta que ainda não tem git. Só a pedido. */
  router.post("/projects/:id/git", async (req, res) => {
    try {
      const project = getProject(req.params.id);
      if (!project) throw new Error("projeto não encontrado");
      await prepararGit(project.root);
      marcarGit(project.id, true);
      res.json({ ok: true, pronto: await temCommit(project.root) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete("/projects/:id", async (req, res) => {
    try {
      const project = getProject(req.params.id);
      if (!project) throw new Error("projeto não encontrado");
      // Fechar é tirar da lista, não destruir: os worktrees e branches ficam
      // no disco e voltam quando você reabrir a mesma pasta. Só os painéis
      // morrem, porque são processos.
      parar(project.root);
      for (const mission of listMissions(project.id)) {
        parar(mission.worktree);
        encerrarRun(mission.id);
        for (const paneId of mission.panes) {
          await stopPane(paneId);
          ctx.broadcast({ type: "exit", paneId, code: 0 });
        }
      }
      await flushDshKills();
      closeProject(project.id);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  // ---------- memória compartilhada ----------

  router.get("/projects/:id/memoria", (req, res) => res.json(lerMemoria(req.params.id)));

  router.post("/projects/:id/memoria", (req, res) => {
    try {
      const id = String(req.params.id || "");
      if (!id) throw new Error("id do projeto obrigatório");
      const nota = anotar(id, String(req.body?.quem ?? "você"), String(req.body?.texto ?? ""));
      ctx.broadcast({ type: "memoria", projectId: id });
      res.json(nota);
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete("/projects/:id/memoria/:quando", (req, res) => {
    try {
      const id = String(req.params.id || "");
      const quando = Number(req.params.quando);
      if (!id) throw new Error("id do projeto obrigatório");
      if (isNaN(quando)) throw new Error("parâmetro 'quando' inválido");
      esquecer(id, quando);
      ctx.broadcast({ type: "memoria", projectId: id });
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
