import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config, salvarConfig } from "../config.ts";
import { CASA, acharSkill, listarSkills } from "./skills.ts";

/**
 * Marketplace: de onde vêm skills e MCPs novos.
 *
 * Não há catálogo inventado aqui. As fontes são repositórios git no formato
 * de marketplace do Claude Code (`.claude-plugin/marketplace.json`) — os
 * mesmos que o `/plugin` usa, incluindo o oficial que você já tem
 * configurado, com centenas de plugins.
 *
 * O manifesto lista muito mais do que está baixado: quase todo plugin aponta
 * para outro repositório. Então o catálogo mostra tudo, marcando o que já
 * está em disco; baixar só acontece quando você manda instalar.
 *
 * Instalar copia a skill para o acervo do cockpit. É o que faz ela valer para
 * agy e codex também, e não só para o CLI onde ela nasceu.
 */

const CLONES = join(CASA, "marketplaces");
const BAIXADOS = join(CASA, "plugins");

export type SkillDoPlugin = { nome: string; descricao: string; instalada: boolean };

export type PluginAchado = {
  id: string;
  nome: string;
  descricao: string;
  categoria: string | null;
  marketplace: string;
  /** Vazio enquanto `local` for false: o conteúdo ainda está no repositório. */
  skills: SkillDoPlugin[];
  mcps: string[];
  /** true quando os arquivos estão em disco e dá para ler as skills. */
  local: boolean;
  /** Repositório de onde baixar, quando não é local. */
  remoto: { url: string; caminho?: string; ref?: string } | null;
  homepage: string | null;
};

export type Fonte = {
  id: string;
  url: string | null;
  /** "cockpit" (clonado aqui) ou "claude" (já estava configurado lá). */
  origem: string;
  plugins: number;
  caminho: string;
};

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
  });
}

function pastasDeFonte(): { id: string; origem: string; dir: string }[] {
  const fontes: { id: string; origem: string; dir: string }[] = [];
  const doClaude = join(homedir(), ".claude", "plugins", "marketplaces");
  if (existsSync(doClaude)) {
    for (const entrada of readdirSync(doClaude)) {
      const dir = join(doClaude, entrada);
      if (statSync(dir).isDirectory()) fontes.push({ id: entrada, origem: "claude", dir });
    }
  }
  if (existsSync(CLONES)) {
    for (const entrada of readdirSync(CLONES)) {
      const dir = join(CLONES, entrada);
      if (statSync(dir).isDirectory()) fontes.push({ id: entrada, origem: "cockpit", dir });
    }
  }
  return fontes;
}

const lerJson = <T,>(caminho: string): T | null => {
  try {
    return JSON.parse(readFileSync(caminho, "utf8")) as T;
  } catch {
    return null;
  }
};

/** Frontmatter só para nome e descrição — o corpo não interessa aqui. */
function resumoDaSkill(dir: string): { nome: string; descricao: string } | null {
  const arquivo = join(dir, "SKILL.md");
  if (!existsSync(arquivo)) return null;
  const texto = readFileSync(arquivo, "utf8").slice(0, 4000);
  const nome = /^name:\s*(.+)$/m.exec(texto)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const desc = /^description:\s*(.+)$/m.exec(texto)?.[1]?.trim().replace(/^["'|>]\s*/, "");
  return { nome: nome || dir.split(/[\\/]/).pop()!, descricao: (desc ?? "").slice(0, 300) };
}

/**
 * Skills de um plugin em disco. Procura em `skills/` e na raiz.
 *
 * `instaladas` vem pronto de fora de propósito: perguntar "já tenho esta?"
 * uma vez por skill relia o acervo inteiro a cada pergunta, e com 289 plugins
 * isso custava sete segundos por listagem.
 */
function skillsEm(dir: string, instaladas: Set<string>): SkillDoPlugin[] {
  const achadas: SkillDoPlugin[] = [];
  for (const base of [join(dir, "skills"), dir]) {
    if (!existsSync(base)) continue;
    for (const entrada of readdirSync(base)) {
      const caminho = join(base, entrada);
      if (!statSync(caminho).isDirectory()) continue;
      const r = resumoDaSkill(caminho);
      if (r && !achadas.some((x) => x.nome === r.nome)) {
        achadas.push({ ...r, instalada: instaladas.has(r.nome) });
      }
    }
    if (achadas.length > 0) break;
  }
  return achadas;
}

const nomesInstalados = (): Set<string> => new Set(listarSkills().map((s) => s.nome));

function mcpsEm(dir: string): string[] {
  const m = lerJson<{ mcpServers?: Record<string, unknown> }>(join(dir, ".mcp.json"));
  return Object.keys(m?.mcpServers ?? {});
}

type FonteRemota = { source?: string; url?: string; path?: string; ref?: string };
type EntradaPlugin = {
  name?: string;
  source?: string | FonteRemota;
  description?: string;
  category?: string;
  homepage?: string;
};
type Manifesto = { name?: string; plugins?: EntradaPlugin[] };

const seguro = (s: string): string => s.replace(/[^a-zA-Z0-9._-]/g, "-");

/** Onde os arquivos de um plugin baixado por nós ficam. */
const pastaBaixada = (id: string): string => join(BAIXADOS, seguro(id));

/**
 * Resolve uma entrada do manifesto: se os arquivos estão aqui, aponta a
 * pasta; se apontam para outro repositório, guarda o endereço para depois.
 */
function resolver(raizDoManifesto: string, p: EntradaPlugin): { dir: string | null; remoto: PluginAchado["remoto"] } {
  const fonte = p.source;
  const nome = typeof p.name === "string" ? p.name : "";

  if (typeof fonte === "object" && fonte?.url) {
    const baixado = pastaBaixada(`${nome}`);
    const alvo = fonte.path ? join(baixado, fonte.path) : baixado;
    return {
      dir: existsSync(alvo) ? alvo : null,
      remoto: { url: fonte.url, caminho: fonte.path, ref: fonte.ref },
    };
  }

  const candidatos = [
    typeof fonte === "string" && fonte !== "./" ? join(raizDoManifesto, fonte) : null,
    join(raizDoManifesto, "plugins", nome),
    join(raizDoManifesto, nome),
    raizDoManifesto,
  ].filter((x): x is string => x !== null);

  return { dir: candidatos.find((c) => existsSync(c)) ?? null, remoto: null };
}

/** Todo manifesto dentro de uma fonte — repositórios aninham plugins. */
function navegar(raiz: string, instaladas: Set<string>): PluginAchado[] {
  const achados: PluginAchado[] = [];
  const vistos = new Set<string>();

  const descer = (dir: string, profundidade: number) => {
    if (profundidade > 3 || !existsSync(dir)) return;
    const manifesto = join(dir, ".claude-plugin", "marketplace.json");
    if (existsSync(manifesto)) {
      const m = lerJson<Manifesto>(manifesto);
      const nomeFonte = m?.name ?? dir.split(/[\\/]/).pop()!;
      for (const p of m?.plugins ?? []) {
        if (typeof p.name !== "string" || !p.name) continue;
        const id = `${nomeFonte}/${p.name}`;
        if (vistos.has(id)) continue;
        vistos.add(id);
        const { dir: pasta, remoto } = resolver(dir, p);
        achados.push({
          id,
          nome: p.name,
          descricao: p.description ?? "",
          categoria: p.category ?? null,
          marketplace: nomeFonte,
          skills: pasta ? skillsEm(pasta, instaladas) : [],
          mcps: pasta ? mcpsEm(pasta) : [],
          local: pasta !== null,
          remoto,
          homepage: p.homepage ?? null,
        });
      }
    }
    for (const entrada of readdirSync(dir)) {
      if (entrada.startsWith(".") || entrada === "node_modules") continue;
      const caminho = join(dir, entrada);
      if (statSync(caminho).isDirectory()) descer(caminho, profundidade + 1);
    }
  };

  descer(raiz, 0);
  return achados;
}

/**
 * Varrer 289 plugins toca milhares de arquivos. A validade é curta porque o
 * catálogo só muda quando você instala, baixa ou conecta uma fonte — e nesses
 * três casos a gente esquece na hora.
 */
const VALIDADE = 60_000;
let guardado: { quando: number; fontes: Fonte[]; plugins: PluginAchado[] } | null = null;

export const esquecerCatalogo = (): void => {
  guardado = null;
};

function varrerTudo(): { fontes: Fonte[]; plugins: PluginAchado[] } {
  if (guardado && Date.now() - guardado.quando < VALIDADE) return guardado;

  const instaladas = nomesInstalados();
  const registradas = new Map((config.marketplaces ?? []).map((m) => [m.id, m.url]));
  const fontes: Fonte[] = [];
  const plugins: PluginAchado[] = [];
  const vistos = new Set<string>();

  for (const { id, origem, dir } of pastasDeFonte()) {
    const daFonte = navegar(dir, instaladas);
    fontes.push({ id, url: registradas.get(id) ?? null, origem, plugins: daFonte.length, caminho: dir });
    for (const p of daFonte) {
      if (vistos.has(p.id)) continue;
      vistos.add(p.id);
      plugins.push(p);
    }
  }
  // Quem já está em disco vem primeiro: dá para ver o conteúdo agora.
  plugins.sort((a, b) => Number(b.local) - Number(a.local) || a.id.localeCompare(b.id));

  guardado = { quando: Date.now(), fontes, plugins };
  return guardado;
}

export const listarFontes = (): Fonte[] => varrerTudo().fontes;

/** Tudo que dá para instalar, de todas as fontes. */
export const catalogo = (): PluginAchado[] => varrerTudo().plugins;

const acharPlugin = (id: string): PluginAchado => {
  const p = catalogo().find((x) => x.id === id);
  if (!p) throw new Error(`não achei o plugin "${id}"`);
  return p;
};

/**
 * Traz os arquivos de um plugin remoto. Clone raso, sem histórico: queremos
 * as skills, não o repositório.
 */
export function baixarPlugin(id: string): PluginAchado {
  const p = acharPlugin(id);
  if (p.local) return p;
  if (!p.remoto) throw new Error(`"${id}" não diz de onde baixar`);

  const destino = pastaBaixada(p.nome);
  mkdirSync(BAIXADOS, { recursive: true });
  if (existsSync(destino)) rmSync(destino, { recursive: true, force: true });
  try {
    const ref = p.remoto.ref ? ["--branch", p.remoto.ref] : [];
    git(["clone", "--depth", "1", ...ref, p.remoto.url, destino]);
  } catch (err) {
    rmSync(destino, { recursive: true, force: true });
    throw new Error(`não consegui baixar ${p.remoto.url}: ${(err as Error).message.split("\n")[0]}`);
  }

  esquecerCatalogo();
  const agora = acharPlugin(id);
  if (!agora.local) throw new Error(`baixei ${p.remoto.url} mas não achei o plugin dentro dele`);
  return agora;
}

/**
 * Instalar = copiar a skill para o acervo do cockpit, com os arquivos de
 * apoio (scripts, referências). A cópia é o que faz a skill valer para
 * qualquer CLI, e não só para aquele onde o plugin estava.
 */
export function instalarSkill(pluginId: string, nomeSkill: string): { nome: string } {
  const plugin = plugin_em_disco(pluginId);
  const bases = [join(plugin.caminho, "skills"), plugin.caminho].filter((d) => existsSync(d));
  let origem: string | undefined;
  for (const base of bases) {
    origem = readdirSync(base)
      .map((e) => join(base, e))
      .filter((c) => statSync(c).isDirectory())
      .find((c) => resumoDaSkill(c)?.nome === nomeSkill);
    if (origem) break;
  }
  if (!origem) throw new Error(`"${nomeSkill}" não está em ${pluginId}`);

  const destino = join(CASA, "skills", nomeSkill);
  if (existsSync(destino)) throw new Error(`"${nomeSkill}" já está instalada`);
  mkdirSync(join(CASA, "skills"), { recursive: true });
  cpSync(origem, destino, { recursive: true });
  esquecerCatalogo();
  return { nome: nomeSkill };
}

/** Garante os arquivos em disco, baixando se preciso, e devolve a pasta. */
function plugin_em_disco(id: string): PluginAchado & { caminho: string } {
  const p = acharPlugin(id).local ? acharPlugin(id) : baixarPlugin(id);
  // `resolver` já validou que a pasta existe quando local é true.
  const raiz = p.remoto
    ? p.remoto.caminho
      ? join(pastaBaixada(p.nome), p.remoto.caminho)
      : pastaBaixada(p.nome)
    : pastaDoLocal(p);
  return { ...p, caminho: raiz };
}

/** Recalcula a pasta de um plugin que já estava em disco na fonte. */
function pastaDoLocal(p: PluginAchado): string {
  for (const { dir } of pastasDeFonte()) {
    const achar = (base: string, profundidade: number): string | null => {
      if (profundidade > 3 || !existsSync(base)) return null;
      const manifesto = join(base, ".claude-plugin", "marketplace.json");
      if (existsSync(manifesto)) {
        const m = lerJson<Manifesto>(manifesto);
        if ((m?.name ?? base.split(/[\\/]/).pop()) === p.marketplace) {
          const entrada = m?.plugins?.find((x) => x.name === p.nome);
          if (entrada) {
            const { dir: pasta } = resolver(base, entrada);
            if (pasta) return pasta;
          }
        }
      }
      for (const e of readdirSync(base)) {
        if (e.startsWith(".") || e === "node_modules") continue;
        const c = join(base, e);
        if (statSync(c).isDirectory()) {
          const r = achar(c, profundidade + 1);
          if (r) return r;
        }
      }
      return null;
    };
    const r = achar(dir, 0);
    if (r) return r;
  }
  throw new Error(`perdi os arquivos de "${p.id}"`);
}

/** O plugin inteiro de uma vez, pulando o que já existe. */
export function instalarPlugin(pluginId: string): { instaladas: string[]; puladas: string[] } {
  const plugin = plugin_em_disco(pluginId);
  const skills = skillsEm(plugin.caminho, nomesInstalados());
  if (skills.length === 0) {
    throw new Error(
      plugin.mcps.length > 0
        ? `"${pluginId}" traz MCP (${plugin.mcps.join(", ")}) mas nenhuma skill`
        : `"${pluginId}" não traz skill nenhuma`,
    );
  }
  const instaladas: string[] = [];
  const puladas: string[] = [];
  for (const s of skills) {
    try {
      instalarSkill(pluginId, s.nome);
      instaladas.push(s.nome);
    } catch {
      puladas.push(s.nome);
    }
  }
  return { instaladas, puladas };
}

export function adicionarFonte(url: string): Fonte {
  const limpa = url.trim();
  if (!/^(https?:\/\/|git@)/.test(limpa)) {
    throw new Error("informe a URL de um repositório git (https:// ou git@)");
  }
  const id = seguro((limpa.split("/").pop() ?? "fonte").replace(/\.git$/, ""));
  const dir = join(CLONES, id);
  mkdirSync(CLONES, { recursive: true });

  if (existsSync(dir)) git(["pull", "--ff-only"], dir);
  else git(["clone", "--depth", "1", limpa, dir]);

  esquecerCatalogo();
  if (navegar(dir, nomesInstalados()).length === 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(
      "esse repositório não tem `.claude-plugin/marketplace.json` — não é um marketplace",
    );
  }
  config.marketplaces ??= [];
  if (!config.marketplaces.some((m) => m.id === id)) config.marketplaces.push({ id, url: limpa });
  salvarConfig();
  esquecerCatalogo();
  return listarFontes().find((f) => f.id === id)!;
}

export function atualizarFonte(id: string): void {
  const dir = join(CLONES, id);
  if (!existsSync(dir)) throw new Error(`"${id}" não foi clonado aqui — atualize pelo Claude Code`);
  git(["pull", "--ff-only"], dir);
  esquecerCatalogo();
}

/** Quantas skills existem por origem — o resumo que a tela mostra em cima. */
export function resumoDoAcervo(): { total: number; porOrigem: Record<string, number> } {
  const skills = listarSkills();
  const porOrigem: Record<string, number> = {};
  for (const s of skills) porOrigem[s.origem] = (porOrigem[s.origem] ?? 0) + 1;
  return { total: skills.length, porOrigem };
}
