import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config.ts";

/**
 * Quanto já foi gasto, lido dos arquivos que os CLIs deixam no disco.
 *
 * Claude: cada sessão grava um .jsonl com o `usage` de cada turno, então os
 * números são exatos. Antigravity: os transcripts não registram tokens (os
 * blobs são protobuf sem schema público), então dá para contar conversas e
 * passos, não consumo. Preferimos mostrar menos a inventar.
 */

export type PorModelo = {
  model: string;
  in: number;
  out: number;
  cacheWrite: number;
  cacheRead: number;
  turnos: number;
  custo: number;
};

export type PorDia = { dia: string; tokens: number; custo: number };

export type Consumo = {
  claude: {
    total: PorModelo;
    porModelo: PorModelo[];
    porDia: PorDia[];
    sessoes: number;
    desde: string | null;
  };
  agy: {
    conversas: number;
    pedidos: number;
    ultima: string | null;
    /** A Antigravity não expõe contagem de tokens no disco. */
    tokensIndisponiveis: true;
  };
};

const vazio = (model: string): PorModelo => ({
  model,
  in: 0,
  out: 0,
  cacheWrite: 0,
  cacheRead: 0,
  turnos: 0,
  custo: 0,
});

function custoDe(m: PorModelo): number {
  const p = config.precos[m.model];
  if (!p) return 0;
  return (
    (m.in * p.in + m.out * p.out + m.cacheWrite * p.cacheWrite + m.cacheRead * p.cacheRead) /
    1_000_000
  );
}

const PROJETOS = join(homedir(), ".claude", "projects");

function lerClaude(dias: number): Consumo["claude"] {
  const porModelo = new Map<string, PorModelo>();
  const porDia = new Map<string, { tokens: number; custo: number }>();
  const corte = Date.now() - dias * 86_400_000;
  let sessoes = 0;
  let desde: number | null = null;

  if (!existsSync(PROJETOS)) {
    return { total: vazio("—"), porModelo: [], porDia: [], sessoes: 0, desde: null };
  }

  for (const projeto of readdirSync(PROJETOS)) {
    const pasta = join(PROJETOS, projeto);
    let arquivos: string[];
    try {
      arquivos = readdirSync(pasta).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const arquivo of arquivos) {
      const caminho = join(pasta, arquivo);
      let info;
      try {
        info = statSync(caminho);
      } catch {
        continue;
      }
      if (info.mtimeMs < corte) continue;
      sessoes += 1;

      for (const linha of readFileSync(caminho, "utf8").split("\n")) {
        if (!linha || !linha.includes('"usage"')) continue;
        let o: {
          type?: string;
          timestamp?: string;
          message?: { model?: string; usage?: Record<string, number> };
        };
        try {
          o = JSON.parse(linha);
        } catch {
          continue;
        }
        const u = o.message?.usage;
        if (o.type !== "assistant" || !u) continue;

        const model = o.message?.model ?? "desconhecido";
        const m = porModelo.get(model) ?? vazio(model);
        m.in += u.input_tokens ?? 0;
        m.out += u.output_tokens ?? 0;
        m.cacheWrite += u.cache_creation_input_tokens ?? 0;
        m.cacheRead += u.cache_read_input_tokens ?? 0;
        m.turnos += 1;
        porModelo.set(model, m);

        const quando = o.timestamp ? Date.parse(o.timestamp) : info.mtimeMs;
        if (!Number.isNaN(quando)) {
          if (desde === null || quando < desde) desde = quando;
          const dia = new Date(quando).toISOString().slice(0, 10);
          const d = porDia.get(dia) ?? { tokens: 0, custo: 0 };
          d.tokens +=
            (u.input_tokens ?? 0) +
            (u.output_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0);
          porDia.set(dia, d);
        }
      }
    }
  }

  const lista = [...porModelo.values()].map((m) => ({ ...m, custo: custoDe(m) }));
  lista.sort((a, b) => b.custo - a.custo || b.turnos - a.turnos);

  const total = lista.reduce((acc, m) => {
    acc.in += m.in;
    acc.out += m.out;
    acc.cacheWrite += m.cacheWrite;
    acc.cacheRead += m.cacheRead;
    acc.turnos += m.turnos;
    acc.custo += m.custo;
    return acc;
  }, vazio("todos"));

  // O custo por dia sai da proporção de tokens: os preços variam por modelo,
  // e um dia pode ter misturado vários.
  const totalTokens = total.in + total.out + total.cacheWrite + total.cacheRead || 1;
  const dias_ = [...porDia.entries()]
    .map(([dia, d]) => ({ dia, tokens: d.tokens, custo: (d.tokens / totalTokens) * total.custo }))
    .sort((a, b) => a.dia.localeCompare(b.dia));

  return {
    total,
    porModelo: lista,
    porDia: dias_,
    sessoes,
    desde: desde ? new Date(desde).toISOString().slice(0, 10) : null,
  };
}

const AGY = join(homedir(), ".gemini", "antigravity-cli");

/**
 * O banco de resumos da Antigravity fica praticamente vazio, e os passos são
 * protobuf sem schema. O que é sólido: o history.jsonl com um registro por
 * pedido seu, e os arquivos de conversa no disco.
 */
function lerAgy(dias: number): Consumo["agy"] {
  const zero = { conversas: 0, pedidos: 0, ultima: null, tokensIndisponiveis: true } as const;
  if (!existsSync(AGY)) return zero;
  const corte = Date.now() - dias * 86_400_000;
  let pedidos = 0;
  let ultima = 0;

  const historico = join(AGY, "history.jsonl");
  if (existsSync(historico)) {
    for (const linha of readFileSync(historico, "utf8").split("\n")) {
      if (!linha) continue;
      try {
        const o = JSON.parse(linha) as { timestamp?: number; type?: string };
        if (typeof o.timestamp !== "number") continue;
        if (o.timestamp > ultima) ultima = o.timestamp;
        if (o.timestamp >= corte && o.type !== "slash_command") pedidos += 1;
      } catch {
        /* linha pela metade */
      }
    }
  }

  let conversas = 0;
  const pasta = join(AGY, "conversations");
  if (existsSync(pasta)) {
    for (const f of readdirSync(pasta)) {
      if (!f.endsWith(".db")) continue;
      try {
        const info = statSync(join(pasta, f));
        if (info.mtimeMs >= corte) conversas += 1;
        if (info.mtimeMs > ultima) ultima = info.mtimeMs;
      } catch {
        /* arquivo sumiu no meio */
      }
    }
  }

  return {
    conversas,
    pedidos,
    ultima: ultima ? new Date(ultima).toISOString().slice(0, 10) : null,
    tokensIndisponiveis: true,
  };
}

export function lerConsumo(dias = 30): Consumo {
  return { claude: lerClaude(dias), agy: lerAgy(dias) };
}
