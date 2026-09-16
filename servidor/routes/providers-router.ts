import { Router } from "express";
import type { RouterContext } from "./types.ts";
import { modelosDoCli, parseCliBackend } from "../config.ts";
import { resolverHarness, type Pedido } from "../orchestration/harness.ts";
import { listarProviders, listarProvidersAtualizados, esquecerCache } from "../providers/providers.ts";
import { conectar, desconectar, criarAgente, testar, PRESETS, type Conexao } from "../providers/conectar.ts";
import {
  listarPontes,
  statusPonte,
  guardarChaveDaPonte,
  sincronizarModelos,
  testarPonte,
} from "../providers/ponte.ts";
import {
  atualizarDshApiModelos,
  descobrirDshApiModelos,
  guardarChaveDshApi,
  invalidarCatalogoDshGateway,
  listarDshGateway,
  listarDshApis,
  removerDshApi,
  salvarDshApi,
  atualizarDshGatewayModelos,
} from "../providers/dsh-api.ts";
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

  router.get("/providers", async (req, res) => {
    // ?rescan=1 ignora a validade do cache: é o "procurar de novo" da tela,
    // para quando você acabou de instalar um CLI.
    if (req.query.rescan === "1") {
      esquecerCache();
      invalidarCatalogoDshGateway();
    }
    res.json({ providers: await listarProvidersAtualizados(), presets: PRESETS, autoAprovar: ctx.config.autoAprovar !== false });
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

  router.post("/providers/:id/backend", (req, res) => {
    try {
      const cli = req.params.id;
      if (!ctx.config.clis[cli]) {
        throw new Error(`Provedor "${cli}" não encontrado`);
      }
      const backend = parseCliBackend(req.body?.backend);
      ctx.config.clis[cli].backend = backend;
      ctx.salvarConfig();
      res.json({ ok: true, cli, backend });
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

  // ---------- APIs diretas do DSH ----------
  router.get("/dsh-apis", (_req, res) => res.json({ apis: listarDshApis() }));

  router.get("/dsh-gateway", (req, res) => {
    listarDshGateway().then(
      (status) => res.json({ gateway: status }),
      (err: Error) => fail(res, err),
    );
  });

  router.post("/dsh-gateway/modelos", (_req, res) => {
    atualizarDshGatewayModelos().then(
      (gateway) => {
        esquecerCache();
        res.json({ ok: true, gateway });
      },
      (err: Error) => fail(res, err),
    );
  });

  router.post("/dsh-apis/modelos", (req, res) => {
    descobrirDshApiModelos({
      provider: String(req.body?.provider ?? ""),
      api: req.body?.api ?? null,
      baseURL: req.body?.baseURL ?? null,
      chave: req.body?.chave ?? null,
    }).then(
      (modelos) => res.json({ ok: true, modelos }),
      (err: Error) => fail(res, err),
    );
  });

  router.post("/dsh-apis", (req, res) => {
    try {
      const api = salvarDshApi(req.body ?? {});
      esquecerCache();
      res.json({ ok: true, api });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/dsh-apis/:id/modelos", (req, res) => {
    atualizarDshApiModelos(req.params.id).then(
      (api) => {
        esquecerCache();
        res.json({ ok: true, api, modelos: api.modelos });
      },
      (err: Error) => fail(res, err),
    );
  });

  router.post("/dsh-apis/:id/chave", (req, res) => {
    try {
      guardarChaveDshApi(req.params.id, String(req.body?.chave ?? ""));
      esquecerCache();
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete("/dsh-apis/:id", (req, res) => {
    try {
      removerDshApi(req.params.id);
      esquecerCache();
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
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
      const lista = modelosDoCli(id);
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
