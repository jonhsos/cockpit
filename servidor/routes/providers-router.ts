import { Router } from "express";
import type { RouterContext } from "./types.ts";
import { resolverHarness, type Pedido } from "../orchestration/harness.ts";
import { listarProviders, esquecerCache } from "../providers/providers.ts";
import { conectar, desconectar, criarAgente, testar, PRESETS, type Conexao } from "../providers/conectar.ts";
import {
  listarPontes,
  statusPonte,
  guardarChaveDaPonte,
  sincronizarModelos,
  testarPonte,
} from "../providers/ponte.ts";
import { lerCotas, esquecerCotas, aplicarSinal } from "../providers/cotas.ts";
import { lerConsumo } from "../providers/consumo.ts";

export function createProvidersRouter(ctx: RouterContext): Router {
  const router = Router();

  const fail = (res: any, err: unknown) =>
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });

  /** Mostra o bundle que o harness escolheria, sem abrir painel nenhum. */
  router.post("/harness", (req, res) => {
    try {
      res.json(resolverHarness(req.body as Pedido));
    } catch (err) {
      fail(res, err);
    }
  });

  // ---------- provedores ----------

  router.get("/providers", (req, res) => {
    // ?rescan=1 ignora a validade do cache: é o "procurar de novo" da tela,
    // para quando você acabou de instalar um CLI.
    if (req.query.rescan === "1") esquecerCache();
    res.json({ providers: listarProviders(), presets: PRESETS, autoAprovar: ctx.config.autoAprovar !== false });
  });

  router.post("/providers", (req, res) => {
    try {
      res.json(conectar(req.body as Conexao));
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete("/providers/:id", (req, res) => {
    try {
      desconectar(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/providers/:id/agente", (req, res) => {
    try {
      res.json(criarAgente(req.params.id));
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/providers/:id/testar", (req, res) => {
    testar(req.params.id).then(
      (r) => res.json(r),
      (err: Error) => fail(res, err),
    );
  });

  // ---------- pontes (OpenRouter e outras APIs sem CLI) ----------

  const temNoPath = (comando: string): boolean =>
    listarProviders().some((p) => p.comando === comando && p.caminho !== null);

  router.get("/pontes", async (_req, res) => {
    try {
      res.json({ pontes: await Promise.all(listarPontes().map((p) => statusPonte(p.id, temNoPath))) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/pontes/:id/chave", (req, res) => {
    try {
      // A chave entra e não sai: nenhuma rota devolve o valor, só de onde veio.
      guardarChaveDaPonte(req.params.id, String(req.body.chave ?? "").trim());
      esquecerCache();
      esquecerCotas();
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  /** Relê o catálogo do provedor e passa a lista viva para o cockpit.json. */
  router.post("/pontes/:id/modelos", async (req, res) => {
    try {
      const modelos = await sincronizarModelos(req.params.id);
      res.json({ modelos, status: await statusPonte(req.params.id, temNoPath) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/pontes/:id/testar", async (req, res) => {
    try {
      res.json(await testarPonte(req.params.id, req.body?.modelo ? String(req.body.modelo) : undefined));
    } catch (err) {
      fail(res, err);
    }
  });

  /** Fixa o modelo padrão da ponte: é o que o agente dela usa por omissão. */
  router.post("/pontes/:id/modelo", (req, res) => {
    try {
      const id = req.params.id;
      const modelo = String(req.body.modelo ?? "");
      const lista = ctx.config.modelos?.[id] ?? [];
      if (!lista.includes(modelo)) throw Error(`"${modelo}" não está no catálogo de ${id}.`);
      ctx.config.modelos![id] = [modelo, ...lista.filter((m: string) => m !== modelo)];
      for (const agente of Object.values(ctx.config.agents) as any[]) {
        if (agente.cli === id) agente.model = modelo;
      }
      ctx.salvarConfig();
      ctx.notifyMaestro();
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  // ---------- consumo ----------

  router.get("/cotas", async (req, res) => {
    if (req.query.rescan === "1") esquecerCotas();
    // O aviso vindo do painel sobrepõe a leitura da conta: ele é mais novo.
    res.json({ cotas: aplicarSinal(await lerCotas(), ctx.limits) });
  });

  router.get("/consumo", (req, res) => {
    const dias = Number(req.query.dias) || 30;
    try {
      res.json(lerConsumo(dias));
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
