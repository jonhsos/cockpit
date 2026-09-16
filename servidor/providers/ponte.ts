import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, limparModelosRuntime, modelosDoCli, salvarConfig, type PonteSpec } from "../config.ts";
import { chaveDe, guardarChave } from "../cofre.ts";
import { CASA } from "../state.ts";

/**
 * Ponte: um provedor que não tem CLI próprio e entra pelo binário de outro.
 *
 * O caso que motivou isto é o OpenRouter, que é uma API — não um programa de
 * terminal. Ele reúne dezenas de modelos, e alguns custam zero. Sem ponte,
 * usar um modelo grátis exigiria escrever um agente inteiro do nada; com ela,
 * o painel é o mesmo Codex de sempre, só que apontado para outro servidor.
 *
 * O Codex aceita `model_providers.<id>` na configuração, e isso vale para
 * qualquer endpoint que fale a API de Responses da OpenAI. Então a ponte é
 * genérica: OpenRouter vem pronto, e Groq, DeepSeek, Ollama ou o que aparecer
 * amanhã entram preenchendo os mesmos quatro campos.
 *
 * O que a ponte NÃO faz: prometer que todo modelo grátis se comporta como um
 * modelo de assinatura. O harness do Codex manda dezenas de ferramentas e um
 * prompt de sistema longo; modelo pequeno se perde nisso. Por isso o catálogo
 * é filtrado por suporte a ferramentas e a tela tem um teste que fala com a
 * API de verdade antes de você abrir um painel e descobrir no susto.
 */

export type ModeloPonte = {
  id: string;
  nome: string;
  /** Janela de contexto em tokens, quando o catálogo informa. */
  contexto: number | null;
  /** Sem isto o modelo não roda um agente: só conversa. */
  ferramentas: boolean;
  gratis: boolean;
};

export type StatusPonte = {
  id: string;
  label: string;
  /** O CLI que empresta o binário — hoje sempre o codex. */
  base: string;
  baseDisponivel: boolean;
  baseUrl: string;
  chaveEnv: string;
  chaveEm: string | null;
  pronto: boolean;
  /** Uma linha acionável quando não está pronto. */
  falta: string | null;
  /** Onde se cria a chave, para a tela poder linkar. */
  chaveUrl: string | null;
  modelos: ModeloPonte[];
  modelo: string | null;
  agentes: string[];
  /** Quando o catálogo vivo foi lido pela última vez. */
  catalogoEm: number | null;
  nota: string | null;
};

/** Os provedores do cockpit.json que são ponte, e não CLI de verdade. */
export function listarPontes(): { id: string; spec: PonteSpec; base: string }[] {
  return Object.entries(config.clis)
    .filter(([, c]) => c.ponte)
    .map(([id, c]) => ({ id, spec: c.ponte!, base: c.command }));
}

export function pontede(id: string): { spec: PonteSpec; base: string } | null {
  const c = config.clis[id];
  return c?.ponte ? { spec: c.ponte, base: c.command } : null;
}

export const chaveDaPonte = (id: string): { valor: string | null; onde: string } => {
  const p = pontede(id);
  return p ? chaveDe(id, p.spec.chaveEnv) : { valor: null, onde: "" };
};

/**
 * O ambiente do painel. A chave só existe dentro do processo do CLI: nunca
 * vai para o cockpit.json, nem para a tela, nem para o log.
 */
export function envDaPonte(id: string): NodeJS.ProcessEnv {
  const p = pontede(id);
  if (!p) return {};
  const { valor } = chaveDaPonte(id);
  return valor ? { [p.spec.chaveEnv]: valor } : {};
}

/**
 * Os `-c` que transformam o Codex em cliente de outro servidor.
 *
 * `wire_api` é sempre "responses" por padrão: o Codex 0.154 removeu o "chat"
 * e diz exatamente isso ao subir. Quem só tem chat completions não serve de
 * ponte para este CLI — melhor descobrir na configuração do que no meio de
 * uma missão.
 */
export function argsDaPonte(id: string): string[] {
  const p = pontede(id);
  if (!p) return [];
  const { spec } = p;
  const alvo = spec.provider || id;
  const args = [
    "-c",
    `model_provider=${JSON.stringify(alvo)}`,
    "-c",
    `model_providers.${alvo}.name=${JSON.stringify(spec.label ?? id)}`,
    "-c",
    `model_providers.${alvo}.base_url=${JSON.stringify(spec.base_url)}`,
    "-c",
    `model_providers.${alvo}.env_key=${JSON.stringify(spec.chaveEnv)}`,
    "-c",
    `model_providers.${alvo}.wire_api=${JSON.stringify(spec.wireApi ?? "responses")}`,
  ];
  for (const [chave, valor] of Object.entries(spec.headers ?? {})) {
    args.push("-c", `model_providers.${alvo}.http_headers.${JSON.stringify(chave)}=${JSON.stringify(valor)}`);
  }
  // Escotilha para o dia em que um provedor precisar de mais um ajuste: em vez
  // de mais um campo aqui, é uma linha no cockpit.json.
  for (const [chave, valor] of Object.entries(spec.extra ?? {})) {
    args.push("-c", `${chave}=${JSON.stringify(valor)}`);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Catálogo de modelos
// ---------------------------------------------------------------------------

const CATALOGO = join(CASA, "modelos-ponte.json");
/** Meia hora: o catálogo do OpenRouter muda, mas não de minuto em minuto. */
const VALIDADE = 30 * 60_000;

type Guardado = Record<string, { quando: number; modelos: ModeloPonte[] }>;

const lerGuardado = (): Guardado => {
  try {
    return existsSync(CATALOGO) ? (JSON.parse(readFileSync(CATALOGO, "utf8")) as Guardado) : {};
  } catch {
    return {};
  }
};

function gravarGuardado(id: string, modelos: ModeloPonte[]): void {
  const tudo = lerGuardado();
  tudo[id] = { quando: Date.now(), modelos };
  mkdirSync(CASA, { recursive: true });
  writeFileSync(CATALOGO, JSON.stringify(tudo, null, 2), "utf8");
}

export const catalogoLidoEm = (id: string): number | null => lerGuardado()[id]?.quando ?? null;

/**
 * Preço zero nos dois lados. O OpenRouter devolve preço como string, então
 * "0" e "0.0000000" contam. Um modelo sem preço declarado não é considerado
 * grátis — na dúvida, cobrar é o padrão do mundo.
 */
const semCusto = (preco: unknown): boolean => {
  const p = preco as { prompt?: string; completion?: string } | undefined;
  if (!p || p.prompt === undefined || p.completion === undefined) return false;
  return Number(p.prompt) === 0 && Number(p.completion) === 0;
};

type ModeloCru = {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: unknown;
  supported_parameters?: string[];
};

export function lerCatalogo(bruto: unknown, soGratis: boolean): ModeloPonte[] {
  const lista = (bruto as { data?: ModeloCru[] })?.data;
  if (!Array.isArray(lista)) throw new Error("o catálogo veio sem a lista de modelos");

  const modelos = lista
    .filter((m): m is ModeloCru & { id: string } => typeof m?.id === "string")
    .map((m) => ({
      id: m.id,
      nome: m.name ?? m.id,
      contexto: typeof m.context_length === "number" ? m.context_length : null,
      ferramentas: (m.supported_parameters ?? []).includes("tools"),
      gratis: semCusto(m.pricing),
    }))
    .filter((m) => !soGratis || m.gratis);

  // Quem não aceita ferramentas não roda um agente; fica no fim, e não some,
  // porque você pode querer um deles só para conversar sobre o código.
  return modelos.sort(
    (a, b) =>
      Number(b.ferramentas) - Number(a.ferramentas) ||
      (b.contexto ?? 0) - (a.contexto ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * O catálogo vivo do provedor. Cai para o que está guardado quando a rede
 * falha — um catálogo de meia hora atrás é melhor do que uma lista vazia.
 */
export async function listarModelos(id: string, forcar = false): Promise<ModeloPonte[]> {
  const p = pontede(id);
  if (!p) throw new Error(`"${id}" não é uma ponte`);
  const guardado = lerGuardado()[id];
  if (!forcar && guardado && Date.now() - guardado.quando < VALIDADE) return guardado.modelos;

  const url = p.spec.catalogo ?? `${p.spec.base_url.replace(/\/$/, "")}/models`;
  const { valor } = chaveDaPonte(id);
  try {
    const res = await fetch(url, {
      headers: valor ? { authorization: `Bearer ${valor}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`${url} respondeu ${res.status}`);
    const modelos = lerCatalogo(await res.json(), p.spec.soGratis === true);
    gravarGuardado(id, modelos);
    return modelos;
  } catch (err) {
    if (guardado) return guardado.modelos;
    throw new Error(
      `não consegui ler o catálogo de ${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Passa o catálogo vivo para o cockpit.json.
 *
 * O harness e a distribuição de IA validam modelo contra `config.modelos`. Um
 * modelo que só existisse no catálogo em memória seria recusado na hora de
 * abrir o painel — por isso a lista viva precisa virar configuração salva.
 */
export async function sincronizarModelos(id: string, forcar = true): Promise<ModeloPonte[]> {
  const modelos = await listarModelos(id, forcar);
  const usaveis = modelos.filter((m) => m.ferramentas).map((m) => m.id);
  let lista = usaveis.length > 0 ? usaveis : modelos.map((m) => m.id);
  if (lista.length === 0) return modelos;

  // O primeiro da lista é o padrão de quem não escolheu nada — inclusive do
  // maestro quando migra para cá. Atualizar o catálogo não é hora de trocar
  // essa escolha: se o modelo em uso continua existindo, ele continua na
  // frente. Sem isto, um clique em "Atualizar modelos" mudava o modelo do
  // agente por baixo do pano.
  const atual = modelosDoCli(id)[0];
  if (atual && lista.includes(atual)) lista = [atual, ...lista.filter((m) => m !== atual)];

  config.modelos ??= {};
  config.modelos[id] = lista;
  limparModelosRuntime(id);

  // Um agente apontando para um modelo que saiu do ar trava o painel na
  // primeira chamada; realinhar aqui é mais barato que descobrir lá.
  for (const agente of Object.values(config.agents)) {
    if (agente.cli === id && agente.model && !lista.includes(agente.model)) agente.model = lista[0]!;
  }
  salvarConfig();
  return modelos;
}

// ---------------------------------------------------------------------------
// Estado e teste
// ---------------------------------------------------------------------------

export async function statusPonte(
  id: string,
  temNoPath: (comando: string) => boolean,
): Promise<StatusPonte> {
  const p = pontede(id);
  if (!p) throw new Error(`"${id}" não é uma ponte`);
  const { onde } = chaveDaPonte(id);
  const baseDisponivel = temNoPath(p.base);
  const modelos = await listarModelos(id).catch(() => [] as ModeloPonte[]);
  const agentes = Object.entries(config.agents)
    .filter(([, a]) => a.cli === id)
    .map(([chave]) => chave);

  const falta = !baseDisponivel
    ? `falta o CLI \`${p.base}\`, que é quem roda a ponte`
    : !onde
      ? `falta a chave (${p.spec.chaveEnv})`
      : modelos.length === 0
        ? "não consegui ler o catálogo de modelos deste provedor"
        : null;

  return {
    id,
    label: p.spec.label ?? id,
    base: p.base,
    baseDisponivel,
    baseUrl: p.spec.base_url,
    chaveEnv: p.spec.chaveEnv,
    chaveEm: onde || null,
    pronto: falta === null,
    falta,
    chaveUrl: p.spec.chaveUrl ?? null,
    modelos,
    modelo: modelosDoCli(id)[0] ?? null,
    agentes,
    catalogoEm: catalogoLidoEm(id),
    nota: p.spec.nota ?? null,
  };
}

export type Teste = { ok: boolean; detalhe: string; ms: number; modelo: string };

/**
 * Fala com a API pelo mesmo caminho que o painel vai usar: mesma URL, mesmo
 * verbo, mesmo formato de corpo. Um teste que passasse por outro endpoint
 * provaria só que a chave existe — e o que costuma quebrar numa ponte é
 * justamente o formato.
 */
export async function testarPonte(id: string, modeloPedido?: string): Promise<Teste> {
  const p = pontede(id);
  if (!p) throw new Error(`"${id}" não é uma ponte`);
  const { valor } = chaveDaPonte(id);
  if (!valor) throw new Error(`ponha a chave de ${id} antes de testar`);

  const modelo = modeloPedido || modelosDoCli(id)[0];
  if (!modelo) throw new Error("nenhum modelo escolhido para testar");

  const url = `${p.spec.base_url.replace(/\/$/, "")}/responses`;
  const comecou = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${valor}`,
        ...(p.spec.headers ?? {}),
      },
      body: JSON.stringify({
        model: modelo,
        instructions: "Responda apenas com a palavra PRONTO.",
        input: "diga PRONTO",
        stream: false,
        store: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const ms = Date.now() - comecou;
    const corpo = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const erro = corpo.error as { message?: string } | string | undefined;
      const msg = typeof erro === "string" ? erro : (erro?.message ?? res.statusText);
      return { ok: false, ms, modelo, detalhe: `${res.status}: ${msg}` };
    }
    return {
      ok: true,
      ms,
      modelo,
      detalhe: textoDaResposta(corpo) || "respondeu sem texto, mas respondeu",
    };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - comecou,
      modelo,
      detalhe: err instanceof Error ? err.message : String(err),
    };
  }
}

/** O texto dentro de uma resposta da API de Responses, sem depender do atalho. */
export function textoDaResposta(corpo: unknown): string {
  const c = corpo as { output_text?: unknown; output?: { content?: { text?: string }[] }[] };
  if (typeof c?.output_text === "string") return c.output_text.trim();
  if (Array.isArray(c?.output_text)) return c.output_text.join(" ").trim();
  const pedacos: string[] = [];
  for (const item of c?.output ?? []) {
    for (const parte of item?.content ?? []) if (typeof parte?.text === "string") pedacos.push(parte.text);
  }
  return pedacos.join(" ").trim();
}

export function guardarChaveDaPonte(id: string, valor: string): void {
  if (!pontede(id)) throw new Error(`"${id}" não é uma ponte`);
  guardarChave(id, valor);
}
