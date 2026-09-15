import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { config } from "../config.ts";
import { chaveDaPonte, pontede } from "./ponte.ts";

/**
 * Quais CLIs existem de verdade nesta máquina.
 *
 * Sem isto o cockpit oferece agentes que falham ao abrir — o `codex` estava
 * no catálogo e nunca esteve instalado. Melhor mostrar apagado e dizer como
 * instalar do que deixar você descobrir com um painel morto.
 */

import { accountPool, type AccountPoolView } from "./account-pool.ts";

export type Provider = {
  id: string;
  comando: string;
  disponivel: boolean;
  caminho: string | null;
  modelos: string[];
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
  /** Pool de contas multicontas configurado para este provedor */
  pool?: AccountPoolView;
};

const COMO_INSTALAR: Record<string, string> = {
  claude: "npm i -g @anthropic-ai/claude-code",
  agy: "baixe a Antigravity CLI em antigravity.google",
  codex: "npm i -g @openai/codex",
  gemini: "npm i -g @google/gemini-cli",
  grok: "curl -sSfL https://x.ai/grok/install.sh | sh",
};

/**
 * O PATH muda quando você instala um CLI com o cockpit aberto, então a
 * detecção tem validade curta. Sem isso a tela seguia dizendo "não
 * encontrado" para algo que acabou de ser instalado.
 */
const VALIDADE = 10_000;
const cache = new Map<string, { caminho: string | null; quando: number }>();

function achar(comando: string): string | null {
  const guardado = cache.get(comando);
  if (guardado && Date.now() - guardado.quando < VALIDADE) return guardado.caminho;
  let caminho: string | null = null;
  if (/[\\/]/.test(comando)) {
    caminho = existsSync(comando) ? comando : null;
  } else {
    try {
      const linhas = execFileSync(process.platform === "win32" ? "where" : "which", [comando], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).split(/\r?\n/);
      caminho = linhas.find((l) => l.trim())?.trim() ?? null;
    } catch {
      caminho = null;
    }
  }
  cache.set(comando, { caminho, quando: Date.now() });
  return caminho;
}

/** Força uma varredura nova, sem esperar a validade. */
export function esquecerCache(): void {
  cache.clear();
}

export function listarProviders(): Provider[] {
  return Object.entries(config.clis).map(([id, spec]) => {
    const caminho = achar(spec.command);
    const ponte = pontede(id);
    // Uma ponte com o binário no lugar mas sem chave não está disponível: ela
    // abriria o painel e morreria autenticando. Disponível = dá para usar.
    const credencial = ponte ? chaveDaPonte(id) : null;
    return {
      id,
      comando: spec.command,
      disponivel: caminho !== null && (!ponte || credencial!.valor !== null),
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
      caminho,
      modelos: config.modelos?.[id] ?? [],
      efforts: config.efforts?.[id] ?? [],
      agentes: Object.entries(config.agents)
        .filter(([, a]) => a.cli === id)
        .map(([chave]) => chave),
      instalar: caminho
        ? ponte && credencial!.valor === null
          ? `ponha a chave em Ajustes → Grátis (ou exporte ${ponte.spec.chaveEnv})`
          : undefined
        : (COMO_INSTALAR[id] ?? (ponte ? COMO_INSTALAR[spec.command] : undefined)),
      pool: accountPool.hasPool(id) ? accountPool.getView(id)[id] : undefined,
    };
  });
}

export function providerDisponivel(id: string): boolean {
  if (id === "bash") return true;
  if (achar(config.clis[id]?.command ?? id) === null) return false;
  const ponte = pontede(id);
  return !ponte || chaveDaPonte(id).valor !== null;
}
