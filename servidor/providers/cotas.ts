import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveCli } from "../pty.ts";
import { chaveDaPonte, listarPontes } from "./ponte.ts";
import { accountPool } from "./account-pool.ts";

/**
 * Redline: quanto resta de cada assinatura.
 *
 * Cada provedor conta de um jeito, e a régua honesta é a que mostra isso em
 * vez de fingir um número único:
 *
 *   codex  — duas janelas em porcentagem (5h e 7 dias), pela conta.
 *   claude — o que o próprio CLI guardou depois da última resposta.
 *   agy    — não publica porcentagem; publica o bloqueio e quando volta.
 *   ponte  — o provedor da API responde crédito e limite; OpenRouter conta
 *            requisições por dia na conta gratuita, não porcentagem de plano.
 *
 * Nada aqui adivinha. Sem dado, o estado é "desconhecido" — que é diferente
 * de "livre", e é a distinção que evita você confiar num painel errado.
 */

export type Janela = {
  rotulo: string;
  /** 0–100. */
  usadoPct: number;
  /** Epoch em ms, ou null quando o provedor não diz. */
  voltaEm: number | null;
};

export type Cota = {
  cli: string;
  estado: "livre" | "apertado" | "bloqueado" | "desconhecido";
  janelas: Janela[];
  plano: string | null;
  /** Uma linha explicando, quando não há número. */
  detalhe: string | null;
  fonte: string;
  lidoEm: number;
};

const APERTADO = 15;

const estadoPor = (janelas: Janela[]): Cota["estado"] => {
  if (janelas.length === 0) return "desconhecido";
  const pior = Math.max(...janelas.map((j) => j.usadoPct));
  if (pior >= 100) return "bloqueado";
  return 100 - pior <= APERTADO ? "apertado" : "livre";
};

// ---------------------------------------------------------------------------
// codex — RPC de leitura na conta, sem gastar turno
// ---------------------------------------------------------------------------

type BucketCodex = {
  primary?: { usedPercent?: number; windowDurationMins?: number; resetsAt?: number };
  secondary?: { usedPercent?: number; windowDurationMins?: number; resetsAt?: number };
  planType?: string;
};

const duracao = (mins: number | undefined): string => {
  if (!mins) return "janela";
  if (mins % 1440 === 0) return `${mins / 1440} dia${mins / 1440 > 1 ? "s" : ""}`;
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${mins}min`;
};

export function lerBucketCodex(bruto: unknown): Cota | null {
  const r = bruto as { rateLimitsByLimitId?: Record<string, BucketCodex>; rateLimits?: BucketCodex };
  const b = r?.rateLimitsByLimitId?.codex ?? r?.rateLimits;
  if (!b) return null;

  const janelas: Janela[] = [];
  for (const [chave, w] of [["primary", b.primary], ["secondary", b.secondary]] as const) {
    if (typeof w?.usedPercent !== "number" || w.usedPercent < 0 || w.usedPercent > 100) continue;
    janelas.push({
      rotulo: duracao(w.windowDurationMins) + (chave === "primary" ? "" : " "),
      usadoPct: w.usedPercent,
      voltaEm: typeof w.resetsAt === "number" ? w.resetsAt * 1000 : null,
    });
  }
  if (janelas.length === 0) return null;

  return {
    cli: "codex",
    estado: estadoPor(janelas),
    janelas: janelas.map((j) => ({ ...j, rotulo: j.rotulo.trim() })),
    plano: b.planType ?? null,
    detalhe: null,
    fonte: "conta (app-server)",
    lidoEm: Date.now(),
  };
}

function cotaCodex(): Promise<Cota | null> {
  return new Promise((resolve) => {
    let cmd: { file: string; args: string[] };
    try {
      cmd = resolveCli("codex", []);
    } catch {
      return resolve(null);
    }
    const child = spawn(cmd.file, [...cmd.args, "app-server"], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    let pronto = false;
    const terminar = (c: Cota | null) => {
      if (pronto) return;
      pronto = true;
      clearTimeout(prazo);
      child.stdin.end();
      child.kill();
      resolve(c);
    };
    const prazo = setTimeout(() => terminar(null), 15_000);
    child.on("error", () => terminar(null));

    const escrever = (o: unknown) => child.stdin.write(JSON.stringify(o) + "\n");
    createInterface({ input: child.stdout }).on("line", (linha) => {
      let m: { id?: number; result?: unknown };
      try {
        m = JSON.parse(linha);
      } catch {
        return;
      }
      if (m.id === 1) {
        escrever({ jsonrpc: "2.0", method: "initialized", params: {} });
        escrever({ jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: {} });
      } else if (m.id === 2) {
        terminar(lerBucketCodex(m.result));
      }
    });
    escrever({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "cockpit", version: "1.0.0" } },
    });
  });
}

// ---------------------------------------------------------------------------
// claude — o que o CLI guardou da última resposta
// ---------------------------------------------------------------------------

/**
 * O arquivo é o de credenciais do Claude Code. Lemos SÓ o ramo de limite:
 * nenhum token sai daqui, nem para log, nem para a interface.
 */
export function extrairLimiteClaude(bruto: unknown): Cota | null {
  const achar = (v: unknown, fundo = 0): Record<string, unknown> | null => {
    if (fundo > 4 || !v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    for (const [k, x] of Object.entries(o)) {
      if (/rate_?limit/i.test(k) && x && typeof x === "object") return x as Record<string, unknown>;
      const dentro = achar(x, fundo + 1);
      if (dentro) return dentro;
    }
    return null;
  };
  const lim = achar(bruto);
  if (!lim) return null;

  /**
   * Só nomes de chave e tipos — nunca valores. Serve para o dia em que o
   * Claude Code mudar o formato: em vez de sumir calado, o painel diz o que
   * encontrou e dá para consertar sem adivinhar.
   */
  const forma = Object.entries(lim)
    .map(([k, v]) => `${k}:${Array.isArray(v) ? "array" : typeof v}`)
    .join(" ");

  const num = (...chaves: string[]): number | null => {
    for (const c of chaves) {
      const v = lim[c];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return null;
  };
  const txt = (...chaves: string[]): string | null => {
    for (const c of chaves) if (typeof lim[c] === "string") return lim[c] as string;
    return null;
  };

  // O reset pode vir em segundos ou milissegundos; normalizamos.
  const cru = num("resetsAt", "resets_at", "resetAt", "reset");
  const voltaEm = cru === null ? null : cru > 1e11 ? cru : cru * 1000;

  const usado = num("usedPercent", "used_percent", "utilization");
  const restante = num("remaining", "remainingPercent", "remaining_percent");
  const status = txt("status", "state");

  const janelas: Janela[] = [];
  if (usado !== null) janelas.push({ rotulo: "sessão", usadoPct: usado, voltaEm });
  else if (restante !== null && restante <= 100) {
    janelas.push({ rotulo: "sessão", usadoPct: 100 - restante, voltaEm });
  }

  const bloqueado = /exceed|limit|throttl|block/i.test(status ?? "");
  // Sem número nem status: reporta a forma em vez de sumir calado.
  if (janelas.length === 0 && !status && voltaEm === null) {
    return {
      cli: "claude",
      estado: "desconhecido",
      janelas: [],
      plano: null,
      detalhe: `o Claude Code guardou um limite que eu não sei ler (${forma})`,
      fonte: "estado local do Claude Code",
      lidoEm: Date.now(),
    };
  }

  return {
    cli: "claude",
    estado: janelas.length > 0 ? estadoPor(janelas) : bloqueado ? "bloqueado" : "desconhecido",
    janelas,
    plano: txt("plan", "planType", "subscriptionType"),
    detalhe:
      janelas.length > 0
        ? null
        : bloqueado
          ? `o Claude Code marcou limite atingido${voltaEm ? "" : " (sem hora de volta)"}`
          : "o Claude Code não guardou porcentagem desta conta",
    fonte: "estado local do Claude Code",
    lidoEm: Date.now(),
  };
}

/**
 * O Claude Code não grava porcentagem em disco — o `/usage` consulta a conta
 * na hora. Então a régua dele vive do que o próprio painel disser: quando o
 * CLI avisa que bateu o limite, o cockpit lê no terminal e marca aqui.
 */
function cotaClaude(): Cota {
  const arquivo = join(homedir(), ".claude", ".credentials.json");
  if (existsSync(arquivo)) {
    try {
      const c = extrairLimiteClaude(JSON.parse(readFileSync(arquivo, "utf8")));
      if (c) return c;
    } catch {
      // arquivo ilegível: cai no desconhecido
    }
  }
  return {
    cli: "claude",
    estado: "desconhecido",
    janelas: [],
    plano: null,
    detalhe: "o Claude Code não guarda porcentagem em disco — o aviso vem do painel",
    fonte: "aviso do painel",
    lidoEm: Date.now(),
  };
}

/**
 * Um aviso vindo do terminal vale mais que a falta de dado: se o painel
 * disse que bateu o limite, o painel está certo.
 */
export function aplicarSinal(
  cotas: Cota[],
  sinais: Map<string, { state: string; remaining?: number; detail?: string }>,
): Cota[] {
  return cotas.map((c) => {
    const s = sinais.get(c.cli);
    if (!s) return c;
    if (s.state === "blocked") {
      return { ...c, estado: "bloqueado", detalhe: s.detail ?? c.detalhe, fonte: "aviso do painel" };
    }
    if (s.state === "warning" && typeof s.remaining === "number") {
      // Um aviso com número supera "desconhecido", mas não a conta.
      if (c.janelas.length > 0) return { ...c, estado: "apertado" };
      return {
        ...c,
        estado: "apertado",
        janelas: [{ rotulo: "sessão", usadoPct: 100 - s.remaining, voltaEm: null }],
        detalhe: s.detail ?? c.detalhe,
        fonte: "aviso do painel",
      };
    }
    return c;
  });
}

// ---------------------------------------------------------------------------
// agy — não publica porcentagem; publica o bloqueio
// ---------------------------------------------------------------------------

/**
 * A Antigravity busca a cota, mas não a grava em lugar nenhum legível: o
 * quota_manager guarda em memória. O que sobra em disco é o 429, e ele traz
 * a hora de volta — que é o dado acionável.
 */
export function lerBloqueioAgy(texto: string, agora = Date.now()): Cota | null {
  // "RESOURCE_EXHAUSTED (code 429): Individual quota reached. … Resets in 3h44m55s."
  const linhas = texto.split(/\r?\n/).filter((l) => /RESOURCE_EXHAUSTED|code 429|quota reached/i.test(l));
  const ultima = linhas.at(-1);
  if (!ultima) return null;

  const quando = /I(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/.exec(ultima);
  const espera = /Resets? in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i.exec(ultima);
  if (!espera) return null;

  const segundos =
    Number(espera[1] ?? 0) * 3600 + Number(espera[2] ?? 0) * 60 + Number(espera[3] ?? 0);

  // A hora do log é local e sem ano; montamos a data de hoje com ela.
  let carimbo: number | null = null;
  if (quando) {
    const d = new Date();
    d.setMonth(Number(quando[1]!.slice(0, 2)) - 1, Number(quando[1]!.slice(2)));
    d.setHours(Number(quando[2]), Number(quando[3]), Number(quando[4]), 0);
    carimbo = d.getTime();
    // Log de ontem que "aconteceria" no futuro: puxa um ano para trás.
    if (carimbo > agora + 86_400_000) carimbo -= 365 * 86_400_000;
  }

  const voltaEm = carimbo === null ? null : carimbo + segundos * 1000;
  // Bloqueio vencido não é bloqueio: some.
  if (voltaEm !== null && voltaEm < agora) return null;

  return {
    cli: "agy",
    estado: "bloqueado",
    janelas: [],
    plano: null,
    detalhe: "cota individual atingida — a Antigravity não informa porcentagem, só o bloqueio",
    fonte: "log do CLI",
    lidoEm: Date.now(),
  };
}

function coletarLogsAgyEm(base: string, destino: string[]): void {
  const atual = join(base, "cli.log");
  if (existsSync(atual)) destino.push(atual);

  const pasta = join(base, "log");
  if (!existsSync(pasta)) return;
  try {
    const recentes = readdirSync(pasta)
      .filter((n) => n.endsWith(".log"))
      .map((n) => join(pasta, n))
      .map((c) => ({ c, quando: statSync(c).mtimeMs }))
      .sort((a, b) => b.quando - a.quando)
      .slice(0, 3)
      .map((x) => x.c);
    destino.push(...recentes);
  } catch {
    // pasta rotacionando / inacessível
  }
}

function cotaAgy(): Cota | null {
  const candidatos: string[] = [];
  const bases = new Set<string>([join(homedir(), ".gemini", "antigravity-cli")]);

  // Perfis isolados do pool: logs ficam em app_data_dir e/ou HOME/.gemini/antigravity-cli.
  for (const dir of [
    ...accountPool.getAllEnvDirs("JETSKI_APP_DATA_DIR"),
    ...accountPool.getAllEnvDirs("HOME"),
  ]) {
    bases.add(dir);
    bases.add(join(dir, ".gemini", "antigravity-cli"));
  }

  for (const base of bases) {
    coletarLogsAgyEm(base, candidatos);
  }

  for (const arquivo of candidatos) {
    try {
      // O bloqueio fica no fim; ler 200KB basta e não trava com log gigante.
      const tamanho = statSync(arquivo).size;
      const texto = readFileSync(arquivo, "utf8").slice(Math.max(0, tamanho - 200_000));
      const c = lerBloqueioAgy(texto);
      if (c) return c;
    } catch {
      // log rotacionado no meio da leitura: tenta o próximo
    }
  }

  return {
    cli: "agy",
    estado: "desconhecido",
    janelas: [],
    plano: null,
    detalhe: "a Antigravity não expõe cota; sem bloqueio recente no log",
    fonte: "log do CLI",
    lidoEm: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// pontes — o provedor da API diz quanto sobrou
// ---------------------------------------------------------------------------

type ChaveOpenRouter = {
  data?: {
    label?: string;
    usage?: number;
    limit?: number | null;
    limit_remaining?: number | null;
    is_free_tier?: boolean;
    rate_limit?: { requests?: number; interval?: string };
  };
};

/**
 * O /key do OpenRouter fala de crédito comprado, não de plano. Numa conta
 * gratuita não há teto em dólar — o limite é de requisições por dia, e o
 * endpoint não devolve quantas você já fez. Então o honesto é dizer o que
 * existe e marcar "desconhecido" em vez de inventar uma porcentagem.
 */
export function lerChaveOpenRouter(cli: string, bruto: unknown): Cota {
  const d = (bruto as ChaveOpenRouter)?.data ?? {};
  const janelas: Janela[] = [];
  const gasto = typeof d.usage === "number" ? d.usage : null;
  const teto = typeof d.limit === "number" ? d.limit : null;

  if (teto !== null && teto > 0 && gasto !== null) {
    janelas.push({ rotulo: "crédito", usadoPct: Math.min(100, (gasto / teto) * 100), voltaEm: null });
  }

  const partes: string[] = [];
  if (d.is_free_tier) partes.push("conta gratuita");
  if (d.rate_limit?.requests) {
    partes.push(`${d.rate_limit.requests} requisições por ${d.rate_limit.interval ?? "janela"}`);
  }
  if (teto === null && gasto !== null) partes.push(`US$ ${gasto.toFixed(4)} gastos até agora`);

  return {
    cli,
    estado: janelas.length > 0 ? estadoPor(janelas) : "desconhecido",
    janelas,
    plano: d.is_free_tier ? "gratuito" : (d.label ?? null),
    detalhe:
      janelas.length > 0
        ? null
        : partes.length > 0
          ? `${partes.join(" · ")} — o OpenRouter não informa quantas você já usou hoje`
          : "o OpenRouter não informou limite para esta chave",
    fonte: "conta (API do provedor)",
    lidoEm: Date.now(),
  };
}

async function cotaDaPonte(id: string, url: string): Promise<Cota | null> {
  const { valor } = chaveDaPonte(id);
  if (!valor) return null;
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${valor}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`respondeu ${res.status}`);
    return lerChaveOpenRouter(id, await res.json());
  } catch (err) {
    return {
      cli: id,
      estado: "desconhecido",
      janelas: [],
      plano: null,
      detalhe: `não consegui consultar a conta: ${err instanceof Error ? err.message : String(err)}`,
      fonte: "conta (API do provedor)",
      lidoEm: Date.now(),
    };
  }
}

const cotasDasPontes = (): Promise<(Cota | null)[]> =>
  Promise.all(
    listarPontes()
      .filter((p) => p.spec.cota)
      .map((p) => cotaDaPonte(p.id, p.spec.cota!).catch(() => null)),
  );

// ---------------------------------------------------------------------------

const VALIDADE = 60_000;
let guardadas: { quando: number; cotas: Cota[] } | null = null;
let emCurso: Promise<Cota[]> | null = null;

export const esquecerCotas = (): void => {
  guardadas = null;
};

/** Todas, com validade curta: consultar o Codex sobe um processo. */
export function lerCotas(): Promise<Cota[]> {
  if (guardadas && Date.now() - guardadas.quando < VALIDADE) return Promise.resolve(guardadas.cotas);
  if (emCurso) return emCurso;

  emCurso = (async () => {
    const [codex, pontes] = await Promise.all([
      cotaCodex().catch(() => null),
      cotasDasPontes(),
    ]);
    const cotas = [codex, cotaClaude(), cotaAgy(), ...pontes].filter((c): c is Cota => c !== null);
    guardadas = { quando: Date.now(), cotas };
    emCurso = null;
    return cotas;
  })();
  return emCurso;
}
