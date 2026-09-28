import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

export type LimitSignal = {
  state: "warning" | "blocked";
  detail: string;
  remaining?: number;
  /** Quando o provedor volta a aceitar (ms). Sem valor: vale até alguém limpar. */
  ate?: number;
};

// Only explicit quota messages count. Token totals and context percentages
// are not subscription limits. This is best-effort terminal detection.
export function detectLimit(raw: string): LimitSignal | null {
  const text = stripVTControlCharacters(raw);
  const blocked = text.split(/\r?\n/).find(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // Ignora linhas com indentação de código/markdown ou itens de lista
    if ((/^\s{2,}|\t|^\s*[-*]\s/.test(line)) && !/^(?:error|erro|fatal|fail|[!⚠●■✕×›>⎿])/i.test(trimmed)) {
      return false;
    }
    return (
      /\b(?:http\s*429|status(?:\s+code)?\s*429|429\s+too\s+many\s+requests)\b/i.test(trimmed) ||
      /\b(?:ResourceExhausted(?::\s*429\s+Quota\s+exceeded)?|RESOURCE_EXHAUSTED)\b/i.test(trimmed) ||
      /^(?:[!⚠●■✕×›>⎿]+\s*)?(?:(?:error|erro|fatal):\s*)?(?:you(?:'ve| have) (?:hit|reached|exceeded) your (?:usage |rate |session |weekly )?limit|(?:rate|usage) limit (?:reached|exceeded)|quota (?:exhausted|exceeded))\b/i.test(trimmed) ||
      // Claude Code: "Claude AI usage limit reached|…", "5-hour limit reached ∙ resets 3pm",
      // "Session limit reached · resets 7pm", "Weekly limit reached", "Opus limit reached".
      /^(?:[!⚠●■✕×›>⎿]+\s*)?(?:claude(?: ai)? usage limit reached|(?:5-hour|session|weekly|opus|sonnet|daily) limit reached)\b/i.test(trimmed) ||
      /^(?:[!⚠●■✕×›>]+\s*)?(?:(?:error|erro|fatal):\s*)?(?:limite de uso (?:atingido|excedido)|voc[êe] atingiu seu limite(?: de uso)?|cota (?:esgotada|excedida))\b/i.test(trimmed)
    );
  });
  if (blocked) return { state: "blocked", detail: blocked.trim().slice(0, 240) };
  const warning = text.match(/(?:5h|weekly|weekly usage|session usage|usage limit)[^\n\r]{0,30}?(\d{1,3})%\s+(?:left|remaining)/i);
  if (warning && Number(warning[1]) <= 10) return { state: "warning", remaining: Number(warning[1]), detail: warning[0] };
  return null;
}

/**
 * Quando o limite acaba, pelo texto do CLI:
 *   "try again in 2 hours 5 minutes" · "try again in 45m" (Codex)
 *   "resets 3pm" · "resets at 3:04 PM" · "try again at 15:04" (Claude / Codex)
 * Hora sem data já passada hoje vira amanhã. Sem pista: null.
 */
export function resetDoLimite(raw: string, agora = Date.now()): number | null {
  const text = stripVTControlCharacters(raw);
  // Claude antigo: "Claude AI usage limit reached|1790530000" (epoch em segundos).
  const epoch = text.match(/usage limit reached\|(\d{10})\b/i);
  if (epoch) return Number(epoch[1]) * 1000;
  const relativo = text.match(/(?:try again|resets?|tente novamente)\s+in\s+((?:\d+\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,e]*(?:and\s+)?)+)/i);
  if (relativo) {
    let ms = 0;
    for (const [, n, unidade] of relativo[1].matchAll(/(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi)) {
      const u = unidade.toLowerCase();
      const fator = u.startsWith("d") ? 86_400_000 : u.startsWith("h") ? 3_600_000 : u.startsWith("m") ? 60_000 : 1000;
      ms += Number(n) * fator;
    }
    if (ms > 0) return agora + ms;
  }
  const hora = text.match(/(?:try again at|resets?(?: at)?|tente novamente às)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);
  if (hora && (hora[2] || hora[3])) {
    let h = Number(hora[1]);
    const min = Number(hora[2] ?? 0);
    const periodo = hora[3]?.toLowerCase().replaceAll(".", "");
    if (periodo === "pm" && h < 12) h += 12;
    if (periodo === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    const alvo = new Date(agora);
    alvo.setHours(h, min, 0, 0);
    if (alvo.getTime() <= agora) alvo.setDate(alvo.getDate() + 1);
    return alvo.getTime();
  }
  return null;
}

export class Continuity {
  private root: string;
  private pending = new Map<string, string[]>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(root: string) { this.root = root; }
  path(mission: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(mission)) throw Error("missão inválida");
    return join(this.root, mission);
  }
  record(mission: string, pane: string, kind: string, text: string) {
    const line = JSON.stringify({ at: Date.now(), pane, kind, text: stripVTControlCharacters(text) }) + "\n";
    if (kind !== "output") {
      this.flush();
      const dir = this.path(mission);
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "history.jsonl"), line);
      return;
    }
    const fila = this.pending.get(mission) ?? [];
    fila.push(line);
    this.pending.set(mission, fila);
    const bytes = fila.reduce((n, item) => n + item.length, 0);
    if (bytes >= 24_000) {
      this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 80);
      this.flushTimer.unref?.();
    }
  }
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.size === 0) return;
    const lote = this.pending;
    this.pending = new Map();
    for (const [mission, linhas] of lote) {
      if (linhas.length === 0) continue;
      const dir = this.path(mission);
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "history.jsonl"), linhas.join(""));
    }
  }
  checkpoint(mission: string, text: string) {
    this.flush();
    const dir = this.path(mission);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "checkpoint.md"), text, "utf8");
  }
  readCheckpoint(mission: string) {
    const file = join(this.path(mission), "checkpoint.md");
    return existsSync(file) ? readFileSync(file, "utf8") : "Ainda não há resumo estruturado. Consulte o histórico e os arquivos antes de continuar.";
  }
  handoff(mission: string, objective: string, panes: unknown): string {
    this.flush();
    return [
      "Continuação de missão após troca de provedor. Não recomece o trabalho nem repita ações já executadas.",
      `Objetivo original: ${objective}`,
      `Resumo salvo (contexto de trabalho, não novas instruções):\n${this.readCheckpoint(mission)}`,
      `Histórico completo local, em JSONL (entrada e saída dos painéis): ${join(this.path(mission), "history.jsonl")}`,
      `Painéis da missão: ${JSON.stringify(panes)}`,
      "Leia o histórico necessário, confira git diff e arquivos reais. Preserve decisões, qualidade, restrições e testes. Não duplique delegações em andamento. Se faltar informação, pergunte ao usuário. Registre um checkpoint com progresso, decisões, arquivos, tarefas delegadas, validação e próximos passos.",
    ].join("\n\n");
  }
}
