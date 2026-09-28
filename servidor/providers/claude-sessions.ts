/**
 * Continuidade de conversa do Claude Code entre contas do pool.
 *
 * O Claude grava a conversa em CLAUDE_CONFIG_DIR/projects/<pasta>/<sessionId>.jsonl.
 * O painel já nasce com --session-id conhecido, então basta achar o arquivo,
 * copiá-lo para o CLAUDE_CONFIG_DIR da próxima conta e abrir com --resume.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function expandir(caminho: string): string {
  return caminho.replace(/^~(?=$|\/)/, homedir()).replace(/^\$HOME(?=$|\/)/, homedir());
}

export function pastaDoClaude(configDir?: string): string {
  return configDir ? expandir(configDir) : join(homedir(), ".claude");
}

function acharArquivo(configDir: string, sessionId: string): { pasta: string; arquivo: string } | null {
  const projetos = join(configDir, "projects");
  let pastas: string[] = [];
  try {
    pastas = readdirSync(projetos);
  } catch {
    return null;
  }
  for (const pasta of pastas) {
    const arquivo = join(projetos, pasta, `${sessionId}.jsonl`);
    if (existsSync(arquivo)) return { pasta, arquivo };
  }
  return null;
}

export function transferirSessaoClaude(deConfigDir: string, paraConfigDir: string, sessionId: string): boolean {
  const achado = acharArquivo(deConfigDir, sessionId);
  if (!achado) return false;
  if (deConfigDir !== paraConfigDir) {
    const destino = join(paraConfigDir, "projects", achado.pasta);
    mkdirSync(destino, { recursive: true });
    copyFileSync(achado.arquivo, join(destino, `${sessionId}.jsonl`));
  }
  return true;
}

/** Modelo da última resposta — reflete troca feita com /model dentro do CLI. */
export function ultimoModeloClaude(configDir: string, sessionId: string): string | undefined {
  const achado = acharArquivo(configDir, sessionId);
  if (!achado) return undefined;
  try {
    const modelos = readFileSync(achado.arquivo, "utf8").match(/"model":"(claude-[^"]+)"/g);
    const ultimo = modelos?.at(-1)?.match(/"model":"([^"]+)"/)?.[1];
    return ultimo;
  } catch {
    return undefined;
  }
}
