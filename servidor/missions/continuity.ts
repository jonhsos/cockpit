import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

export type LimitSignal = { state: "warning" | "blocked"; detail: string; remaining?: number };

// Only explicit quota messages count. Token totals and context percentages
// are not subscription limits. This is best-effort terminal detection.
export function detectLimit(raw: string): LimitSignal | null {
  const text = stripVTControlCharacters(raw);
  const blocked = text.split(/\r?\n/).find(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // Ignora linhas com indentação de código/markdown ou itens de lista
    if ((/^\s{2,}|\t|^\s*[-*]\s/.test(line)) && !/^(?:error|erro|fatal|fail|[!⚠●■✕×›>])/i.test(trimmed)) {
      return false;
    }
    return (
      /\b(?:http\s*429|status(?:\s+code)?\s*429|429\s+too\s+many\s+requests)\b/i.test(trimmed) ||
      /\b(?:ResourceExhausted(?::\s*429\s+Quota\s+exceeded)?|RESOURCE_EXHAUSTED)\b/i.test(trimmed) ||
      /^(?:[!⚠●■✕×›>]+\s*)?(?:(?:error|erro|fatal):\s*)?(?:you(?:'ve| have) (?:hit|reached|exceeded) your (?:usage |rate )?limit|(?:rate|usage) limit (?:reached|exceeded)|quota (?:exhausted|exceeded))\b/i.test(trimmed) ||
      /^(?:[!⚠●■✕×›>]+\s*)?(?:(?:error|erro|fatal):\s*)?(?:limite de uso (?:atingido|excedido)|voc[êe] atingiu seu limite(?: de uso)?|cota (?:esgotada|excedida))\b/i.test(trimmed)
    );
  });
  if (blocked) return { state: "blocked", detail: blocked.trim().slice(0, 240) };
  const warning = text.match(/(?:5h|weekly|weekly usage|session usage|usage limit)[^\n\r]{0,30}?(\d{1,3})%\s+(?:left|remaining)/i);
  if (warning && Number(warning[1]) <= 10) return { state: "warning", remaining: Number(warning[1]), detail: warning[0] };
  return null;
}

export class Continuity {
  private root: string;
  constructor(root: string) { this.root = root; }
  path(mission: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(mission)) throw Error("missão inválida");
    return join(this.root, mission);
  }
  record(mission: string, pane: string, kind: string, text: string) {
    const dir = this.path(mission);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "history.jsonl"), JSON.stringify({ at: Date.now(), pane, kind, text: stripVTControlCharacters(text) }) + "\n");
  }
  checkpoint(mission: string, text: string) {
    const dir = this.path(mission);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "checkpoint.md"), text, "utf8");
  }
  readCheckpoint(mission: string) {
    const file = join(this.path(mission), "checkpoint.md");
    return existsSync(file) ? readFileSync(file, "utf8") : "Ainda não há resumo estruturado. Consulte o histórico e os arquivos antes de continuar.";
  }
  handoff(mission: string, objective: string, panes: unknown): string {
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
