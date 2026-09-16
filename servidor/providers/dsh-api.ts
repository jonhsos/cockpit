import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { config, salvarConfig, type DshApiSpec } from "../config.ts";
import { chaveDe, guardarChave } from "../cofre.ts";
import { getDshRepoPath } from "../sessions/dsh-backend/dsh-availability.ts";
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

const specDo = (id: string): DshApiSpec | null => config.clis[id]?.dshApi ?? null;
const cofreId = (id: string) => `dsh-api:${id}`;
const MAX_CATALOG_MODELS = 1000;
const MODEL_ID = /^[^\0\r\n]{1,160}$/;
const MAX_DISCOVERY_MS = 20_000;

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

async function descobrirModelosDaRota(input: DshApiDiscoveryInput): Promise<DshApiModel[]> {
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
  const timer = setTimeout(() => controller.abort(), MAX_DISCOVERY_MS);
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
      const ids = config.modelos?.[id] ?? [];
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
  guardarChave(cofreId(id), "");
  salvarConfig();
}
