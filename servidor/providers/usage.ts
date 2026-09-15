import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config.ts";

export type Usage = {
  in: number;
  out: number;
  cacheWrite: number;
  cacheRead: number;
  custo: number;
  turnos: number;
  model: string | null;
};

const VAZIO: Usage = {
  in: 0,
  out: 0,
  cacheWrite: 0,
  cacheRead: 0,
  custo: 0,
  turnos: 0,
  model: null,
};

const PROJETOS = join(homedir(), ".claude", "projects");

// O nome do diretório de projeto é derivado do cwd de um jeito que varia entre
// versões; achar o arquivo pelo uuid da sessão é estável.
function sessionFile(sessionId: string): string | null {
  if (!existsSync(PROJETOS)) return null;
  for (const dir of readdirSync(PROJETOS)) {
    const caminho = join(PROJETOS, dir, `${sessionId}.jsonl`);
    if (existsSync(caminho)) return caminho;
  }
  return null;
}

type Linha = {
  type?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
};

export function readUsage(sessionId: string | null): Usage {
  if (!sessionId) return VAZIO;
  const caminho = sessionFile(sessionId);
  if (!caminho) return VAZIO;

  const total: Usage = { ...VAZIO };
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    if (!linha) continue;
    let obj: Linha;
    try {
      obj = JSON.parse(linha) as Linha;
    } catch {
      continue; // a última linha pode estar sendo escrita agora
    }
    const uso = obj.message?.usage;
    if (obj.type !== "assistant" || !uso) continue;
    total.in += uso.input_tokens ?? 0;
    total.out += uso.output_tokens ?? 0;
    total.cacheWrite += uso.cache_creation_input_tokens ?? 0;
    total.cacheRead += uso.cache_read_input_tokens ?? 0;
    total.turnos += 1;
    if (obj.message?.model) total.model = obj.message.model;
  }

  const preco = total.model ? config.precos[total.model] : undefined;
  if (preco) {
    total.custo =
      (total.in * preco.in +
        total.out * preco.out +
        total.cacheWrite * preco.cacheWrite +
        total.cacheRead * preco.cacheRead) /
      1_000_000;
  }
  return total;
}

export function somaUsage(usos: Usage[]): Usage {
  return usos.reduce(
    (acc, u) => ({
      in: acc.in + u.in,
      out: acc.out + u.out,
      cacheWrite: acc.cacheWrite + u.cacheWrite,
      cacheRead: acc.cacheRead + u.cacheRead,
      custo: acc.custo + u.custo,
      turnos: acc.turnos + u.turnos,
      model: u.model ?? acc.model,
    }),
    { ...VAZIO },
  );
}
