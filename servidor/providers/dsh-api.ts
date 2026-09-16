import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  config,
  definirModelosRuntime,
  limparModelosRuntime,
  modelosDoCli,
  salvarConfig,
  type DshApiSpec,
} from "../config.ts";
import { chaveDe, guardarChave } from "../cofre.ts";
import { getDshRepoPath } from "../sessions/dsh-backend/dsh-availability.ts";
import { readCodexGatewayConfig, type CodexGatewayConfig } from "./codex-config.ts";
import type { DshApiModel } from "../config.ts";

const ID = /^[a-z0-9][a-z0-9_-]{0,62}$/i;
const ENV = /^[A-Z_][A-Z0-9_]*$/;
const PROVIDER = /^[a-z0-9][a-z0-9_-]{0,80}$/i;
export const DSH_API_PROTOCOLS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;
type DshApiProtocol = (typeof DSH_API_PROTOCOLS)[number];

export type DshApiInput = {
  id: string;
  label: string;
  provider: string;
  model?: string;
  chave: string;
  api?: DshApiProtocol | null;
  baseURL?: string | null;
  chaveUrl?: string | null;
  modelos?: DshApiModel[];
};

export type DshApiDiscoveryInput = {
  provider: string;
  api?: DshApiProtocol | null;
  baseURL?: string | null;
  chave?: string | null;
};

export type DshApiStatus = {
  id: string;
  label: string;
  provider: string;
  model: string | null;
  modelos: DshApiModel[];
  api: DshApiProtocol | null;
  baseURL: string | null;
  chaveEnv: string;
  chaveEm: string | null;
  pronto: boolean;
  falta: string | null;
  chaveUrl: string | null;
};

export type DshGatewayStatus = {
  configurado: boolean;
  provider: string | null;
  label: string | null;
  baseURL: string | null;
  api: DshApiProtocol | null;
  model: string | null;
  chaveEnv: string | null;
  credencialDisponivel: boolean;
  modelos: DshApiModel[];
  erro: string | null;
};

const specDo = (id: string): DshApiSpec | null => config.clis[id]?.dshApi ?? null;
const cofreId = (id: string) => `dsh-api:${id}`;
const MAX_CATALOG_MODELS = 1000;
const MODEL_ID = /^[^\0\r\n]{1,160}$/;
const MAX_DISCOVERY_MS = 20_000;
const MAX_GATEWAY_SYNC_MS = 5_000;
const GATEWAY_CATALOG_TTL_MS = 60_000;
const GATEWAY_CATALOG_FAILURE_TTL_MS = 10_000;

let gatewayCatalogCache: { modelos: DshApiModel[]; expiresAt: number } | null = null;
let gatewayCatalogRequest: Promise<DshApiModel[]> | null = null;

type DshDeepSeekModule = {
  resolveAdapterOptions: (options: { apiKeyEnv?: string }) => { models?: readonly unknown[] };
};

type DshPiAiModule = {
  discoverModels: (request: {
    baseURL?: string;
    api?: string;
    apiKey?: string;
    signal?: AbortSignal;
  }) => Promise<readonly unknown[]>;
};

const moduleCache = new Map<string, Promise<{ deepseek: DshDeepSeekModule; piAi: DshPiAiModule }>>();

function dshModules(): Promise<{ deepseek: DshDeepSeekModule; piAi: DshPiAiModule }> {
  const repo = getDshRepoPath();
  const cached = moduleCache.get(repo);
  if (cached) return cached;
  const loaded = Promise.all([
    import(pathToFileURL(join(repo, "packages/llm/llm-deepseek/lib/index.js")).href),
    import(pathToFileURL(join(repo, "packages/llm/llm-pi-ai/src/discovery.ts")).href),
  ]).then(([deepseek, piAi]) => ({
    deepseek: deepseek as DshDeepSeekModule,
    piAi: piAi as DshPiAiModule,
  })).catch((error) => {
    moduleCache.delete(repo);
    throw new Error(`Não foi possível carregar o catálogo do DSH: ${error instanceof Error ? error.message : String(error)}`);
  });
  moduleCache.set(repo, loaded);
  return loaded;
}

function limparId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!ID.test(id) || id === "bash") throw new Error("O identificador aceita letras, números, hífen e sublinhado.");
  return id;
}

function limparTexto(value: string, field: string, max: number): string {
  const clean = value.trim();
  if (!clean || clean.length > max || /[\0\r\n]/.test(clean)) throw new Error(`${field} inválido.`);
  return clean;
}

function limparModelo(value: string): string {
  const clean = value.trim();
  if (!MODEL_ID.test(clean)) throw new Error("Modelo inválido.");
  return clean;
}

function limparChave(value: string): string {
  const clean = value.trim();
  if (clean.length > 4096 || /[\0\r\n]/.test(clean)) throw new Error("A chave da API é inválida.");
  return clean;
}

function inteiroPositivo(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function catalogoSeguro(value: readonly unknown[]): DshApiModel[] {
  const seen = new Set<string>();
  const modelos: DshApiModel[] = [];
  for (const item of value.slice(0, MAX_CATALOG_MODELS)) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== "string") continue;
    let id: string;
    try {
      id = limparModelo(candidate.id);
    } catch {
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const name = typeof candidate.name === "string" && !/[\0\r\n]/.test(candidate.name)
      ? candidate.name.trim().slice(0, 160) || undefined
      : undefined;
    const contextWindow = inteiroPositivo(candidate.contextWindow);
    const maxTokens = inteiroPositivo(candidate.maxTokens);
    modelos.push({
      id,
      ...(name ? { name } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
    });
  }
  if (modelos.length === 0) throw new Error("A fonte não retornou nenhum modelo utilizável.");
  return modelos;
}

function catalogoComPadraoPrimeiro(modelos: DshApiModel[], padrao: string | undefined): DshApiModel[] {
  if (!padrao) return modelos;
  const indice = modelos.findIndex((modelo) => modelo.id === padrao);
  if (indice <= 0) return modelos;
  return [modelos[indice]!, ...modelos.slice(0, indice), ...modelos.slice(indice + 1)];
}

function validarUrl(value: string | null | undefined): string | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  let url: URL;
  try {
    url = new URL(clean);
  } catch {
    throw new Error("A URL da API é inválida.");
  }
  if (url.username || url.password) throw new Error("A URL da API não pode conter credenciais.");
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("A URL da API deve usar HTTPS; HTTP só é aceito para localhost.");
  }
  return url.toString().replace(/\/$/, "");
}

function expandirHome(value: string): string {
  return value
    .trim()
    .replace(/^~(?=$|\/)/, homedir())
    .replace(/^\$HOME(?=$|\/)/, homedir());
}

function gatewayCodexGlobal(): { home: string; gateway: CodexGatewayConfig } | null {
  const rawHome = config.clis.codex?.env?.CODEX_HOME?.trim() || process.env.CODEX_HOME?.trim();
  if (!rawHome) return null;
  const home = expandirHome(rawHome);
  const gateway = readCodexGatewayConfig(home);
  return gateway ? { home, gateway } : null;
}

function clisComGatewayDsh(): string[] {
  return Object.entries(config.clis)
    .filter(([id, cli]) => cli.backend === "dsh" && !dshApiDoCli(id))
    .map(([id]) => id);
}

const statusGatewayVazio = (erro: string | null = null): DshGatewayStatus => ({
  configurado: false,
  provider: null,
  label: null,
  baseURL: null,
  api: null,
  model: null,
  chaveEnv: null,
  credencialDisponivel: false,
  modelos: [],
  erro,
});

function validarDiscoveryInput(input: DshApiDiscoveryInput): { provider: string; api?: DshApiProtocol; baseURL?: string; chave?: string } {
  const provider = limparTexto(input.provider, "Rota do DSH", 100);
  if (!PROVIDER.test(provider)) throw new Error("A rota do DSH aceita letras, números, hífen e sublinhado.");
  const apiValue = input.api?.trim() || undefined;
  if (apiValue && !DSH_API_PROTOCOLS.includes(apiValue as DshApiProtocol)) throw new Error("Protocolo DSH não suportado por esta versão.");
  const api = apiValue as DshApiProtocol | undefined;
  const baseURL = validarUrl(input.baseURL);
  if (Boolean(api) !== Boolean(baseURL)) {
    throw new Error("Para uma API personalizada, informe o protocolo e a URL. Para o catálogo oficial do DSH, deixe ambos vazios.");
  }
  const chave = input.chave === undefined || input.chave === null ? undefined : limparChave(input.chave);
  return { provider, ...(api ? { api } : {}), ...(baseURL ? { baseURL } : {}), ...(chave ? { chave } : {}) };
}

async function descobrirModelosDaRota(input: DshApiDiscoveryInput, timeoutMs = MAX_DISCOVERY_MS): Promise<DshApiModel[]> {
  const route = validarDiscoveryInput(input);
  if (route.provider === "deepseek-official" && !route.api && !route.baseURL) {
    const { deepseek } = await dshModules();
    const resolved = deepseek.resolveAdapterOptions({});
    return catalogoSeguro(resolved.models ?? []);
  }
  if (!route.baseURL || !route.api) {
    throw new Error(`A rota "${route.provider}" não tem catálogo nativo conhecido; informe protocolo e URL para consultar a API.`);
  }
  const { piAi } = await dshModules();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const discovered = await piAi.discoverModels({
      baseURL: route.baseURL,
      api: route.api,
      ...(route.chave ? { apiKey: route.chave } : {}),
      signal: controller.signal,
    });
    return catalogoSeguro(discovered);
  } finally {
    clearTimeout(timer);
  }
}

export async function listarDshGateway(discoveryTimeoutMs = MAX_DISCOVERY_MS): Promise<DshGatewayStatus> {
  let resolved: { home: string; gateway: CodexGatewayConfig } | null;
  try {
    resolved = gatewayCodexGlobal();
  } catch (error) {
    return statusGatewayVazio(error instanceof Error ? error.message : String(error));
  }
  if (!resolved) {
    return statusGatewayVazio(
      "Nenhum gateway DSH foi encontrado no CODEX_HOME global do Cockpit.",
    );
  }

  const { gateway } = resolved;
  const credencial = process.env[gateway.credentialEnv] ?? "";
  let modelos: DshApiModel[] = [];
  let erro: string | null = null;
  if (!credencial) {
    erro = `falta a credencial ${gateway.credentialEnv} no ambiente do servidor`;
  } else {
    try {
      modelos = catalogoComPadraoPrimeiro(await descobrirModelosDaRota({
        provider: gateway.provider,
        api: gateway.api,
        baseURL: gateway.baseUrl,
        chave: credencial,
      }, discoveryTimeoutMs), gateway.model);
    } catch (error) {
      erro = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    configurado: true,
    provider: gateway.provider,
    label: gateway.provider,
    baseURL: gateway.baseUrl,
    api: gateway.api,
    model: gateway.model ?? null,
    chaveEnv: gateway.credentialEnv,
    credencialDisponivel: Boolean(credencial),
    modelos,
    erro,
  };
}

/**
 * Atualiza somente o catálogo público do Codex. A credencial nunca é salva
 * no cockpit.json e a rotação de contas continua sendo responsabilidade do
 * gateway configurado no CODEX_HOME global.
 */
export async function atualizarDshGatewayModelos(): Promise<DshGatewayStatus> {
  invalidarCatalogoDshGateway();
  const status = await listarDshGateway();
  if (!status.configurado) throw new Error(status.erro ?? "Gateway DSH não configurado.");
  if (status.modelos.length === 0) {
    throw new Error(status.erro ?? "O gateway DSH não retornou nenhum modelo.");
  }
  config.clis.codex ??= { command: "codex" };
  config.clis.codex.backend = "dsh";
  config.modelos ??= {};
  config.modelos.codex = catalogoComPadraoPrimeiro(status.modelos, status.model ?? undefined).map(({ id }) => id);
  limparModelosRuntime("codex");
  salvarConfig();
  return status;
}

export function invalidarCatalogoDshGateway(): void {
  gatewayCatalogCache = null;
  for (const cli of clisComGatewayDsh()) limparModelosRuntime(cli);
}

/**
 * Descobre o catálogo do gateway uma vez por janela curta e disponibiliza-o
 * para as respostas do Cockpit e para o resolvedor interno de harnesses.
 * Falhas nunca apagam o catálogo salvo: a UI continua usando o fallback.
 */
export async function sincronizarCatalogoDshGateway(): Promise<DshApiModel[]> {
  if (gatewayCatalogCache && gatewayCatalogCache.expiresAt > Date.now()) {
    return gatewayCatalogCache.modelos;
  }
  if (gatewayCatalogRequest) return gatewayCatalogRequest;

  gatewayCatalogRequest = listarDshGateway(MAX_GATEWAY_SYNC_MS)
    .then((status) => {
      const modelos = status.modelos;
      gatewayCatalogCache = {
        modelos,
        expiresAt: Date.now() + (modelos.length > 0 ? GATEWAY_CATALOG_TTL_MS : GATEWAY_CATALOG_FAILURE_TTL_MS),
      };
      if (modelos.length > 0) {
        const ids = modelos.map(({ id }) => id);
        for (const cli of clisComGatewayDsh()) definirModelosRuntime(cli, ids);
      }
      return modelos;
    })
    .catch(() => {
      gatewayCatalogCache = { modelos: [], expiresAt: Date.now() + GATEWAY_CATALOG_FAILURE_TTL_MS };
      return [];
    })
    .finally(() => {
      gatewayCatalogRequest = null;
    });

  return gatewayCatalogRequest;
}

export function dshApiDoCli(id: string): DshApiSpec | null {
  return specDo(id);
}

export function chaveDaDshApi(id: string): { valor: string | null; onde: string } {
  const spec = specDo(id);
  return spec ? chaveDe(cofreId(id), spec.chaveEnv) : { valor: null, onde: "" };
}

export function envDaDshApi(id: string): NodeJS.ProcessEnv {
  const spec = specDo(id);
  if (!spec) return {};
  const { valor } = chaveDaDshApi(id);
  return valor ? { [spec.chaveEnv]: valor } : {};
}

export function listarDshApis(): DshApiStatus[] {
  return Object.entries(config.clis)
    .filter(([, cli]) => Boolean(cli.dshApi))
    .map(([id, cli]) => {
      const spec = cli.dshApi!;
      const chave = chaveDaDshApi(id);
      const ids = modelosDoCli(id);
      const modelos = spec.modelos?.length
        ? spec.modelos
        : ids.map((modelId) => ({ id: modelId, name: modelId }));
      const model = ids[0] ?? modelos[0]?.id ?? null;
      const falta = !chave.valor
        ? `falta a chave (${spec.chaveEnv})`
        : !model
          ? "informe ao menos um modelo"
          : null;
      return {
        id,
        label: spec.label,
        provider: spec.provider,
        model,
        modelos,
        api: spec.api ?? null,
        baseURL: spec.baseURL ?? null,
        chaveEnv: spec.chaveEnv,
        chaveEm: chave.onde || null,
        pronto: falta === null,
        falta,
        chaveUrl: spec.chaveUrl ?? null,
      };
    });
}

export async function descobrirDshApiModelos(input: DshApiDiscoveryInput): Promise<DshApiModel[]> {
  return descobrirModelosDaRota(input);
}

export async function atualizarDshApiModelos(id: string): Promise<DshApiStatus> {
  const spec = specDo(id);
  if (!spec) throw new Error("API DSH não encontrada.");
  const { valor } = chaveDaDshApi(id);
  const modelos = await descobrirModelosDaRota({
    provider: spec.provider,
    api: spec.api ?? null,
    baseURL: spec.baseURL ?? null,
    chave: valor,
  });
  spec.modelos = modelos;
  config.modelos ??= {};
  config.modelos[id] = modelos.map(({ id: modelId }) => modelId);
  salvarConfig();
  return listarDshApis().find((item) => item.id === id)!;
}

export function salvarDshApi(input: DshApiInput): DshApiStatus {
  const id = limparId(input.id);
  const label = limparTexto(input.label, "Nome", 80);
  const provider = limparTexto(input.provider, "Rota do DSH", 100);
  if (!PROVIDER.test(provider)) throw new Error("A rota do DSH aceita letras, números, hífen e sublinhado.");
  const model = limparModelo(input.model ?? "");
  const apiValue = input.api?.trim() || undefined;
  if (apiValue && !DSH_API_PROTOCOLS.includes(apiValue as DshApiProtocol)) throw new Error("Protocolo DSH não suportado por esta versão.");
  const api = apiValue as DshApiProtocol | undefined;
  const baseURL = validarUrl(input.baseURL);
  if (Boolean(api) !== Boolean(baseURL)) {
    throw new Error("Para uma API personalizada, informe o protocolo e a URL. Para o catálogo oficial do DSH, deixe ambos vazios.");
  }
  const previous = specDo(id);
  if (previous && !previous.provider.startsWith("cockpit-") && previous.provider !== provider) {
    throw new Error("Esta rota pertence a uma configuração existente e não pode ser sobrescrita.");
  }
  const chaveEnv = previous?.chaveEnv ?? `COCKPIT_DSH_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  const chaveUrl = validarUrl(input.chaveUrl);
  const sameRoute = Boolean(previous && previous.provider === provider && (previous.api ?? undefined) === api && (previous.baseURL ?? undefined) === baseURL);
  const catalogoInformado = input.modelos?.length ? catalogoSeguro(input.modelos) : [];
  const catalogoAnterior = catalogoInformado.length > 0
    ? catalogoInformado
    : sameRoute
      ? previous?.modelos ?? (config.modelos?.[id] ?? []).map((modelId) => ({ id: modelId, name: modelId }))
      : [];
  const modelos = [
    { id: model, name: model },
    ...catalogoAnterior.filter((item) => item.id !== model),
  ];

  config.clis[id] = {
    command: "codex",
    familia: "codex",
    backend: "dsh",
    dshApi: { provider, label, chaveEnv, ...(api ? { api } : {}), ...(baseURL ? { baseURL } : {}), ...(chaveUrl ? { chaveUrl } : {}), modelos },
  };
  config.modelos ??= {};
  config.modelos[id] = [model, ...modelos.map(({ id: modelId }) => modelId).filter((modelId) => modelId !== model)];
  limparModelosRuntime(id);
  const chave = limparChave(input.chave ?? "");
  if (chave || !previous) guardarChave(cofreId(id), chave);
  salvarConfig();
  return listarDshApis().find((item) => item.id === id)!;
}

export function guardarChaveDshApi(id: string, chave: string): void {
  const spec = specDo(id);
  if (!spec) throw new Error("API DSH não encontrada.");
  guardarChave(cofreId(id), limparChave(chave));
}

export function removerDshApi(id: string): void {
  if (!specDo(id)) throw new Error("API DSH não encontrada.");
  const emUso = Object.entries(config.agents).filter(([, agent]) => agent.cli === id);
  if (emUso.length) throw new Error(`Não dá para remover: ${emUso.map(([agent]) => agent).join(", ")} usam esta API.`);
  delete config.clis[id];
  if (config.modelos) delete config.modelos[id];
  limparModelosRuntime(id);
  guardarChave(cofreId(id), "");
  salvarConfig();
}
