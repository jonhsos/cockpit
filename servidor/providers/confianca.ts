import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { config } from "../config.ts";
import { accountPool } from "./account-pool.ts";

/**
 * Cada CLI pergunta "você confia nesta pasta?" antes de aceitar qualquer
 * coisa. Como toda missão cria um worktree novo, isso reapareceria em cada
 * painel de cada missão e travaria o briefing. Aqui registramos a resposta
 * que você daria, no formato de cada um.
 *
 * Só é chamado para pastas que você mesmo abriu no cockpit, e desliga com
 * "confiarNasPastasQueEuAbrir": false no cockpit.json.
 */

const CLAUDE_JSON = join(homedir(), ".claude.json");
const AGY_JSON = join(homedir(), ".gemini", "antigravity-cli", "settings.json");

function lerJson<T>(caminho: string, vazio: T): T | null {
  if (!existsSync(caminho)) return vazio;
  try {
    return JSON.parse(readFileSync(caminho, "utf8")) as T;
  } catch {
    return null; // arquivo do usuário ilegível: não é nosso lugar de reescrever
  }
}

/** O Claude Code guarda a confiança por pasta, com barras normais. */
function confiarClaude(pasta: string): void {
  type Json = { projects?: Record<string, { hasTrustDialogAccepted?: boolean; allowedTools?: string[] }> };
  const c = lerJson<Json>(CLAUDE_JSON, {});
  if (!c) return;
  const chave = resolve(pasta).replace(/\\/g, "/");
  const auto = config.autoAprovar !== false;
  const proj = c.projects?.[chave];
  const jaAceitou = proj?.hasTrustDialogAccepted === true;
  const jaFerramentas = !auto || proj?.allowedTools?.includes("*");
  if (jaAceitou && jaFerramentas) return;
  c.projects ??= {};
  c.projects[chave] = {
    ...c.projects[chave],
    hasTrustDialogAccepted: true,
    ...(auto ? { allowedTools: ["*"] } : {}),
  };
  writeFileSync(CLAUDE_JSON, JSON.stringify(c, null, 2));
}

/** A Antigravity guarda uma lista, com barras invertidas do Windows. */
function confiarAgy(pasta: string): void {
  type Json = { trustedWorkspaces?: string[] };
  const c = lerJson<Json>(AGY_JSON, {});
  if (!c) return;
  const chave = resolve(pasta);
  c.trustedWorkspaces ??= [];
  if (c.trustedWorkspaces.includes(chave)) return;
  c.trustedWorkspaces.push(chave);
  mkdirSync(dirname(AGY_JSON), { recursive: true });
  writeFileSync(AGY_JSON, JSON.stringify(c, null, 2));
}

/** Grava confiança em um arquivo config.toml do Codex */
function confiarCodexEm(codexDir: string, pasta: string): void {
  const chave = resolve(pasta).toLowerCase();
  const tomlPath = join(codexDir, "config.toml");
  const original = existsSync(tomlPath) ? readFileSync(tomlPath, "utf8") : "";
  const linhas = original.split(/\r?\n/);
  let inicio = -1;
  let fim = linhas.length;

  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i]!.match(/^\s*\[projects\.(?:"((?:\\.|[^"])*)"|'([^']*)')\]\s*$/);
    if (!m) continue;
    let pastaDaSecao: string;
    try { pastaDaSecao = m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : m[2]!; }
    catch { continue; }
    if (pastaDaSecao.toLowerCase() === chave) {
      inicio = i;
      for (let j = i + 1; j < linhas.length; j++) {
        if (/^\s*\[/.test(linhas[j]!)) { fim = j; break; }
      }
      break;
    }
  }

  if (inicio >= 0) {
    for (let i = inicio + 1; i < fim; i++) {
      if (/^\s*trust_level\s*=/.test(linhas[i]!)) {
        if (/^\s*trust_level\s*=\s*["']trusted["']\s*$/.test(linhas[i]!)) return;
        linhas[i] = 'trust_level = "trusted"';
        mkdirSync(codexDir, { recursive: true });
        writeFileSync(tomlPath, linhas.join("\n"), "utf8");
        return;
      }
    }
    linhas.splice(fim, 0, 'trust_level = "trusted"');
  } else {
    if (linhas.length === 1 && linhas[0] === "") linhas.length = 0;
    if (linhas.length > 0 && linhas.at(-1) !== "") linhas.push("");
    linhas.push(`[projects.${JSON.stringify(chave)}]`, 'trust_level = "trusted"', "");
  }
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(tomlPath, linhas.join("\n"), "utf8");
}

/** O Codex guarda a confiança em uma tabela TOML por pasta. Aplica para todas as contas. */
function confiarCodex(pasta: string): void {
  const customCodexHome = (process.env.CODEX_HOME || config.clis?.codex?.env?.CODEX_HOME || "")
    .replace(/^~(?=$|\/)/, homedir())
    .replace(/^\$HOME(?=$|\/)/, homedir());
  const defaultDir = customCodexHome || join(homedir(), ".codex");

  const dirs = new Set<string>([defaultDir]);
  for (const dir of accountPool.getAllEnvDirs("CODEX_HOME")) {
    dirs.add(dir);
  }

  for (const dir of dirs) {
    try {
      confiarCodexEm(dir, pasta);
    } catch {
      // Ignora erro se pasta for inacessível
    }
  }
}

export function confiar(cli: string, pasta: string): void {
  if (cli === "claude") confiarClaude(pasta);
  else if (cli === "agy" || cli === "gemini") confiarAgy(pasta);
  else if (cli === "codex") confiarCodex(pasta);
}
