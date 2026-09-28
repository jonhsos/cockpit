/**
 * Continuidade de conversa do Codex entre contas do pool.
 *
 * Cada conta tem seu CODEX_HOME, e o Codex grava cada conversa em
 * CODEX_HOME/sessions/AAAA/MM/DD/rollout-…-<uuid>.jsonl. Copiar esse arquivo
 * para o CODEX_HOME da próxima conta basta para `codex resume <uuid>` retomar a
 * mesma conversa logado na outra conta.
 *
 * Várias janelas podem usar a mesma conta, então "a sessão mais recente" não
 * serve: o painel grava a marca abaixo nas developer_instructions (que vão para
 * o rollout), e a busca procura por ela.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

export function marcaDoPainel(paneId: string): string {
  return `[cockpit-pane:${paneId}]`;
}

function expandir(caminho: string): string {
  return caminho.replace(/^~(?=$|\/)/, homedir()).replace(/^\$HOME(?=$|\/)/, homedir());
}

/** Rollouts modificados desde `desde`, mais recentes primeiro. */
function rolloutsRecentes(codexHome: string, desde: number): { arquivo: string; mtime: number }[] {
  const raiz = join(expandir(codexHome), "sessions");
  if (!existsSync(raiz)) return [];
  const achados: { arquivo: string; mtime: number }[] = [];
  const listar = (dir: string) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };
  // AAAA/MM/DD é o dia em que a conversa começou: pula dias anteriores ao painel
  // (com um dia de folga para fuso e virada de meia-noite).
  const piso = new Date(desde - 86_400_000);
  const pisoDia = piso.getFullYear() * 10_000 + (piso.getMonth() + 1) * 100 + piso.getDate();
  for (const ano of listar(raiz)) {
    for (const mes of listar(join(raiz, ano))) {
      for (const dia of listar(join(raiz, ano, mes))) {
        if (Number(ano) * 10_000 + Number(mes) * 100 + Number(dia) < pisoDia) continue;
        const pasta = join(raiz, ano, mes, dia);
        for (const nome of listar(pasta)) {
          if (!/^rollout-.*\.jsonl$/.test(nome)) continue;
          try {
            const mtime = statSync(join(pasta, nome)).mtimeMs;
            if (mtime >= desde) achados.push({ arquivo: join(pasta, nome), mtime });
          } catch {}
        }
      }
    }
  }
  return achados.sort((a, b) => b.mtime - a.mtime);
}

function rolloutPorId(codexHome: string, sessionId: string): string | null {
  const raiz = join(expandir(codexHome), "sessions");
  const listar = (dir: string) => {
    try {
      return readdirSync(dir).sort().reverse();
    } catch {
      return [];
    }
  };
  for (const ano of listar(raiz))
    for (const mes of listar(join(raiz, ano)))
      for (const dia of listar(join(raiz, ano, mes))) {
        const nome = listar(join(raiz, ano, mes, dia)).find((n) => n.endsWith(`-${sessionId}.jsonl`));
        if (nome) return join(raiz, ano, mes, dia, nome);
      }
  return null;
}

/**
 * `sessionId` conhecido (painel que já nasceu de um resume) vence a marca: a
 * conversa retomada carrega a marca do painel antigo, não a do novo.
 */
export function acharSessaoCodex(
  codexHome: string,
  paneId: string,
  desde: number,
  sessionId?: string | null,
): { id: string; arquivo: string } | null {
  const marca = marcaDoPainel(paneId);
  if (sessionId) {
    // A conversa retomada fica na pasta do dia em que começou, que pode ser antiga.
    const arquivo = rolloutPorId(codexHome, sessionId);
    if (arquivo) return { id: sessionId, arquivo };
  }
  for (const { arquivo } of rolloutsRecentes(codexHome, desde - 60_000)) {
    const id = arquivo.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1];
    if (!id) continue;
    try {
      // A marca vem nas primeiras linhas (session_meta + developer message).
      const inicio = readFileSync(arquivo, "utf8").slice(0, 400_000);
      if (inicio.includes(marca)) return { id, arquivo };
    } catch {}
  }
  return null;
}

/** Copia a conversa do painel para outra conta. Devolve o id para `codex resume`. */
export function transferirSessaoCodex(
  deCodexHome: string,
  paraCodexHome: string,
  paneId: string,
  desde: number,
  sessionId?: string | null,
): string | null {
  const sessao = acharSessaoCodex(deCodexHome, paneId, desde, sessionId);
  if (!sessao) return null;
  const origem = join(expandir(deCodexHome), "sessions");
  const destino = join(expandir(paraCodexHome), "sessions", relative(origem, sessao.arquivo));
  if (expandir(deCodexHome) !== expandir(paraCodexHome)) {
    mkdirSync(dirname(destino), { recursive: true });
    copyFileSync(sessao.arquivo, destino);
  }
  return sessao.id;
}

/** Último modelo/esforço registrado na conversa (o turn_context reflete /model). */
export function ultimoModeloCodex(
  codexHome: string,
  paneId: string,
  desde: number,
  sessionId?: string | null,
): { model?: string; effort?: string } {
  const sessao = acharSessaoCodex(codexHome, paneId, desde, sessionId);
  if (!sessao) return {};
  try {
    const linhas = readFileSync(sessao.arquivo, "utf8").split("\n");
    for (let i = linhas.length - 1; i >= 0; i--) {
      if (!linhas[i].includes('"turn_context"')) continue;
      const payload = JSON.parse(linhas[i]).payload ?? {};
      return {
        model: typeof payload.model === "string" ? payload.model : undefined,
        effort: typeof payload.effort === "string" ? payload.effort : undefined,
      };
    }
  } catch {}
  return {};
}
