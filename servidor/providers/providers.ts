import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { config, modelosDoCli } from "../config.ts";
import { chaveDaPonte, pontede } from "./ponte.ts";
import { chaveDaDshApi, dshApiDoCli, sincronizarCatalogoDshGateway } from "./dsh-api.ts";

/**
 * Quais CLIs existem de verdade nesta máquina.
 *
 * Sem isto o cockpit oferece agentes que falham ao abrir — o `codex` estava
 * no catálogo e nunca esteve instalado. Melhor mostrar apagado e dizer como
 * instalar do que deixar você descobrir com um painel morto.
 */

import { accountPool, type AccountPoolView } from "./account-pool.ts";
import { obterMapaModelosAgy, sincronizarModelosAgy } from "./agy.ts";

export type Provider = {
  id: string;
  comando: string;
  backend?: "pty" | "dsh";
  disponivel: boolean;
  caminho: string | null;
  modelos: string[];
  /** Nomes de exibição amigáveis dos modelos (id -> label legível) */
  nomesModelos?: Record<string, string>;
  /** Níveis de esforço aceitos — a tela precisa para fixar um. */
  efforts: string[];
  agentes: string[];
  /** Como instalar, quando não está. */
  instalar?: string;
  /**
   * Este provedor é uma API emprestando o binário de outro CLI. A tela usa
   * para não oferecer "instalar" a quem não se instala, e para mandar você
   * pôr a chave em vez de procurar um comando que nunca vai existir.
   */
  ponte?: { base: string; chaveEnv: string; chaveEm: string | null; gratis: boolean };
  /** API configurada diretamente para o runtime DSH. */
  dshApi?: { label: string; provider: string; chaveEnv: string; chaveEm: string | null };
  /** Pool de contas multicontas configurado para este provedor */
  pool?: AccountPoolView;
};

const COMO_INSTALAR: Record<string, string> = {
  claude: "npm i -g @anthropic-ai/claude-code",
  agy: "baixe a Antigravity CLI em antigravity.google",
  codex: "npm i -g @openai/codex",
  grok: "curl -sSfL https://x.ai/grok/install.sh | sh",
};

const CODEX_MODELOS_PADRAO: Record<string, string> = {
  "gpt-6-astra": "GPT-6 Astra",
  "gpt-reserve": "GPT-Reserve",
  "gpt-5.6-sol": "GPT-5.6 Sol",
  "gpt-5.6-terra": "GPT-5.6 Terra",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "gpt-5.5": "GPT-5.5",
  "codex-auto-review": "Codex Auto Review",
};

export function obterMapaModelosCodex(): Record<string, string> {
  const res: Record<string, string> = { ...CODEX_MODELOS_PADRAO };
  try {
    const cachePath = join(homedir(), ".codex", "models_cache.json");
    if (existsSync(cachePath)) {
      const data = JSON.parse(readFileSync(cachePath, "utf8"));
      if (Array.isArray(data.models)) {
        for (const m of data.models) {
          const id = m.id || m.slug;
          const name = m.name || m.display_name || m.title;
          if (id && name) res[id] = name;
        }
      }
    }
  } catch {
    // Sem cache
  }
  return res;
}

const GROK_MODELOS_PADRAO: Record<string, string> = {
  "grok-4.6": "Grok 4.6",
  "grok-4.5": "Grok 4.5",
};

export function obterMapaModelosGrok(): Record<string, string> {
  const res: Record<string, string> = { ...GROK_MODELOS_PADRAO };
  try {
    const cachePath = join(homedir(), ".grok", "models_cache.json");
    if (existsSync(cachePath)) {
      const data = JSON.parse(readFileSync(cachePath, "utf8"));
      if (data.models && typeof data.models === "object") {
        for (const [id, item] of Object.entries<any>(data.models)) {
          const name = item?.info?.name || item?.name;
          if (id && name) res[id] = name;
        }
      }
    }
  } catch {
    // Sem cache
  }
  return res;
}

const CLAUDE_MODELOS_PADRAO: Record<string, string> = {
  "opus": "Claude Opus (Claude 3.7 / 4)",
  "sonnet": "Claude Sonnet (Claude 3.7)",
  "haiku": "Claude Haiku",
  "claude-opus-4-6-thinking": "Claude Opus 4.6 (Thinking)",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
};

export function obterMapaModelos(id: string, spec: (typeof config.clis)[string]): Record<string, string> | undefined {
  if (id === "agy") return obterMapaModelosAgy();
  if (id === "codex") return obterMapaModelosCodex();
  if (id === "grok") return obterMapaModelosGrok();
  if (id === "claude") return { ...CLAUDE_MODELOS_PADRAO };
  if (spec.dshApi?.modelos) {
    const res: Record<string, string> = {};
    for (const m of spec.dshApi.modelos) {
      if (m.id && m.name) res[m.id] = m.name;
    }
    return res;
  }
  return undefined;
}

/**
 * O PATH muda quando você instala um CLI com o cockpit aberto, então a
 * detecção tem validade curta. Sem isso a tela seguia dizendo "não
 * encontrado" para algo que acabou de ser instalado.
 */
const VALIDADE = 10_000;
const cache = new Map<string, { caminho: string | null; quando: number }>();

function executavelValido(caminho: string): boolean {
  try {
    if (!statSync(caminho).isFile()) return false;
    accessSync(caminho, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function diretoriosLocais(): string[] {
  const home = homedir();
  return [
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".cargo", "bin"),
    join(home, ".grok", "bin"),
    join(home, ".kimi-code", "bin"),
  ];
}

function candidatosDoPath(comando: string, pathValue: string): string[] {
  const dirs = [...pathValue.split(delimiter).filter(Boolean), ...diretoriosLocais()];
  return [...new Set(dirs)].map((dir) => join(dir, comando));
}

function validarComando(comando: string): string {
  if (typeof comando !== "string" || !comando.trim() || comando.includes("\0")) {
    throw new Error("Comando de executor inválido");
  }
  return comando.trim();
}

/** Resolve CLIs mesmo quando o serviço foi iniciado sem o PATH interativo do usuário. */
export function resolverExecutavel(comando: string): string | null {
  const nome = validarComando(comando);
  const guardado = cache.get(nome);
  if (guardado && Date.now() - guardado.quando < VALIDADE) return guardado.caminho;

  const pathValue = process.env.PATH ?? "";
  let caminho: string | null = null;
  if (/[\\/]/.test(nome)) {
    const candidato = isAbsolute(nome) ? nome : resolve(nome);
    caminho = executavelValido(candidato) ? candidato : null;
  } else {
    try {
      caminho = execFileSync(process.platform === "win32" ? "where" : "which", [nome], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, PATH: pathValue },
      })
        .split(/\r?\n/)
        .map((linha) => linha.trim())
        .find((candidato) => executavelValido(candidato)) ?? null;
    } catch {
      caminho = null;
    }

    if (!caminho) {
      caminho = candidatosDoPath(nome, pathValue).find((candidato) => executavelValido(candidato)) ?? null;
    }
  }
  cache.set(nome, { caminho, quando: Date.now() });
  return caminho;
}

export function pathComExecutaveisLocais(pathValue = process.env.PATH ?? ""): string {
  const dirs = [join(process.cwd(), "bin"), ...diretoriosLocais(), ...pathValue.split(delimiter).filter(Boolean)];
  return [...new Set(dirs)].join(delimiter);
}

/** Força uma varredura nova, sem esperar a validade. */
export function esquecerCache(): void {
  cache.clear();
}

export function listarProviders(): Provider[] {
  return Object.entries(config.clis).map(([id, spec]) => {
    const caminho = resolverExecutavel(spec.command);
    const ponte = pontede(id);
    // Uma ponte com o binário no lugar mas sem chave não está disponível: ela
    // abriria o painel e morreria autenticando. Disponível = dá para usar.
    const dshApi = dshApiDoCli(id);
    const credencial = ponte ? chaveDaPonte(id) : dshApi ? chaveDaDshApi(id) : null;
    return {
      id,
      comando: spec.command,
      backend: spec.backend ?? "pty",
      disponivel: caminho !== null && (!ponte && !dshApi || credencial!.valor !== null),
      ...(ponte
        ? {
            ponte: {
              base: spec.command,
              chaveEnv: ponte.spec.chaveEnv,
              chaveEm: credencial!.onde || null,
              gratis: ponte.spec.soGratis === true,
            },
          }
        : {}),
      ...(dshApi
        ? {
            dshApi: {
              label: dshApi.label,
              provider: dshApi.provider,
              chaveEnv: dshApi.chaveEnv,
              chaveEm: credencial!.onde || null,
            },
          }
        : {}),
      caminho,
      modelos: modelosDoCli(id),
      nomesModelos: obterMapaModelos(id, spec),
      efforts: config.efforts?.[id] ?? [],
      agentes: Object.entries(config.agents)
        .filter(([, a]) => a.cli === id)
        .map(([chave]) => chave),
      instalar: caminho
        ? ponte && credencial!.valor === null
          ? `ponha a chave em Ajustes → Grátis (ou exporte ${ponte.spec.chaveEnv})`
          : undefined
        : (COMO_INSTALAR[id] ?? ((ponte || dshApi) ? COMO_INSTALAR[spec.command] : undefined)),
      pool: accountPool.hasPool(id) ? accountPool.getView(id)[id] : undefined,
    };
  });
}

/**
 * Retorna os provedores com o catálogo atual do gateway DSH quando ele
 * estiver configurado. Se a descoberta falhar, mantém o catálogo salvo.
 */
export async function listarProvidersAtualizados(): Promise<Provider[]> {
  if (Object.entries(config.clis).some(([id, cli]) => cli.backend === "dsh" && !dshApiDoCli(id))) {
    await sincronizarCatalogoDshGateway();
  }
  if (config.clis["agy"]) {
    try {
      sincronizarModelosAgy();
    } catch {
      // CLI agy não disponível ou sem login: segue com catálogo padrão
    }
  }
  return listarProviders();
}

export function providerDisponivel(id: string): boolean {
  if (id === "bash") return true;
  if (resolverExecutavel(config.clis[id]?.command ?? id) === null) return false;
  const ponte = pontede(id);
  const dshApi = dshApiDoCli(id);
  return !ponte && !dshApi || (ponte ? chaveDaPonte(id).valor !== null : chaveDaDshApi(id).valor !== null);
}
