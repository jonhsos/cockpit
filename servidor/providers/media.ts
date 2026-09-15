import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, salvarConfig, type MediaProvider } from "../config.ts";
import { chaveDe as chaveDoCofre, guardarChave } from "../cofre.ts";

/** O cofre agora é compartilhado; media.ts continua sendo a porta de entrada. */
export { guardarChave };

/**
 * Media: imagem, vídeo e áudio gerados de dentro do cockpit.
 *
 * Cada provedor é ou um comando local, ou uma API com chave. O cockpit não
 * inventa provedor: ele detecta o que existe nesta máquina e diz o que falta
 * para o resto funcionar. Provedor sem chave aparece apagado, com a instrução
 * de como ligar — nunca some da lista, senão você não descobre que existe.
 */

/** A chave em uso: a que você guardou no cofre, ou a que já está no ambiente. */
const chaveDe = (id: string, spec: MediaProvider) => chaveDoCofre(id, spec.chaveEnv);

const achado = new Map<string, string | null>();
function noPath(comando: string): string | null {
  if (achado.has(comando)) return achado.get(comando)!;
  let caminho: string | null = null;
  try {
    const saida = execFileSync(process.platform === "win32" ? "where" : "which", [comando], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    caminho = saida.split(/\r?\n/).find((l) => l.trim())?.trim() ?? null;
  } catch {
    caminho = null;
  }
  achado.set(comando, caminho);
  return caminho;
}

export const esquecerMedia = (): void => achado.clear();

export type MediaStatus = {
  id: string;
  label: string;
  faz: string[];
  via: "cli" | "http";
  /** "assinatura" não pede chave nenhuma; "chave" pede uma API key. */
  pagamento: "assinatura" | "chave";
  pronto: boolean;
  /** Por que não está pronto, em uma linha acionável. */
  falta: string | null;
  chaveEm: string | null;
  modelos: string[];
  modelo: string | null;
  modeloPorTipo: Record<string, string>;
  instalar: string | null;
  /** true quando o cockpit sabe instalar sozinho. */
  instalavel: boolean;
  nota: string | null;
};

export function listarMedia(): MediaStatus[] {
  const lista = Object.entries(config.media ?? {}).map(([id, spec]) => {
    const pagamento = spec.pagamento ?? (spec.via === "cli" ? "assinatura" : "chave");
    let pronto = false;
    let falta: string | null = null;
    let chaveEm: string | null = null;

    if (spec.via === "cli") {
      pronto = !!spec.comando && noPath(spec.comando) !== null;
      if (!pronto) falta = `o comando \`${spec.comando}\` não está instalado`;
    } else {
      const { valor, onde } = chaveDe(id, spec);
      pronto = valor !== null;
      chaveEm = onde || null;
      if (!pronto) falta = `falta a chave (${spec.chaveEnv ?? "API key"})`;
    }

    // Com o CLI na mão, o catálogo verdadeiro é o da conta, não o do cockpit.
    const vivos = id === "higgsfield" && pronto ? modelosDoHiggsfield(spec.comando!) : [];
    const modelos = vivos.length > 0 ? vivos : (spec.modelos ?? []);

    return {
      id,
      label: spec.label,
      faz: spec.faz,
      via: spec.via,
      pagamento,
      pronto,
      falta,
      chaveEm,
      modelos,
      modelo: spec.modelo ?? modelos[0] ?? null,
      modeloPorTipo: spec.modeloPorTipo ?? {},
      instalar: spec.instalar ?? null,
      instalavel: (spec.instalarComando?.length ?? 0) > 0,
      nota: spec.nota ?? null,
    };
  });

  // Quem cobra da assinatura vem primeiro: é o caminho sem chave de API.
  return lista.sort(
    (a, b) =>
      Number(b.pronto) - Number(a.pronto) ||
      Number(a.pagamento === "chave") - Number(b.pagamento === "chave"),
  );
}

/**
 * Instala um provedor de CLI por você. Só roda o comando que está declarado
 * no cockpit.json — nada vem do pedido, então não há como injetar outro.
 */
export function instalarProvedor(id: string): { saida: string } {
  const spec = config.media?.[id];
  if (!spec) throw new Error(`não existe provedor de media "${id}"`);
  const cmd = spec.instalarComando;
  if (!cmd || cmd.length === 0) throw new Error(`${id} não tem instalação automática`);
  try {
    const saida = execFileSync(cmd[0]!, cmd.slice(1), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10 * 60_000,
      windowsHide: true,
      shell: process.platform === "win32",
    });
    esquecerMedia();
    return { saida: saida.trim().split("\n").slice(-4).join("\n") };
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string };
    throw new Error(`a instalação falhou: ${(e.stderr || e.stdout || e.message).trim().slice(-400)}`);
  }
}

/** Quem sabe fazer isto e está pronto agora. */
export const provedoresDe = (tipo: string): MediaStatus[] =>
  listarMedia().filter((p) => p.pronto && p.faz.includes(tipo));

export function definirModelo(id: string, modelo: string): void {
  const spec = config.media?.[id];
  if (!spec) throw new Error(`não existe provedor de media "${id}"`);
  if (spec.modelos?.length && !spec.modelos.includes(modelo)) {
    throw new Error(`"${modelo}" não é um modelo de ${id}. Tem: ${spec.modelos.join(", ")}`);
  }
  spec.modelo = modelo;
  salvarConfig();
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

export type Pedido = {
  tipo: "image" | "video" | "audio";
  prompt: string;
  /** Pasta da missão: o arquivo nasce junto do trabalho, não num limbo. */
  destino: string;
  provedor?: string;
  modelo?: string;
  /** Imagem de entrada, para image-to-image e image-to-video. */
  referencia?: string;
};

export type Gerado = { arquivo: string; provedor: string; modelo: string | null };

const EXTENSAO: Record<string, string> = { image: "png", video: "mp4", audio: "mp3" };

function nomeNovo(destino: string, tipo: string): string {
  const pasta = join(destino, "media");
  mkdirSync(pasta, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return join(pasta, `${tipo}-${carimbo}-${randomBytes(2).toString("hex")}.${EXTENSAO[tipo]}`);
}

async function json(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const corpo = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const erro = corpo.error as { message?: string } | string | undefined;
    const msg = typeof erro === "string" ? erro : (erro?.message ?? res.statusText);
    throw new Error(`${url.replace(/\?.*/, "")} respondeu ${res.status}: ${msg}`);
  }
  return corpo;
}

const baixar = async (url: string, arquivo: string): Promise<void> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`não consegui baixar o resultado (${res.status})`);
  writeFileSync(arquivo, Buffer.from(await res.arrayBuffer()));
};

/** Gemini devolve a imagem embutida em base64 na própria resposta. */
async function gemini(chave: string, modelo: string, p: Pedido, arquivo: string): Promise<void> {
  const partes: Record<string, unknown>[] = [{ text: p.prompt }];
  if (p.referencia && existsSync(p.referencia)) {
    partes.push({
      inline_data: { mime_type: "image/png", data: readFileSync(p.referencia).toString("base64") },
    });
  }
  const corpo = await json(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify({ contents: [{ parts: partes }] }),
    },
  );
  const candidatos = corpo.candidates as { content?: { parts?: Record<string, unknown>[] } }[] | undefined;
  for (const parte of candidatos?.[0]?.content?.parts ?? []) {
    const dados = (parte.inline_data ?? parte.inlineData) as { data?: string } | undefined;
    if (dados?.data) {
      writeFileSync(arquivo, Buffer.from(dados.data, "base64"));
      return;
    }
  }
  throw new Error("o Gemini respondeu sem imagem — o prompt pode ter sido recusado");
}

async function openaiImagem(chave: string, modelo: string, p: Pedido, arquivo: string): Promise<void> {
  const corpo = await json("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${chave}` },
    body: JSON.stringify({ model: modelo, prompt: p.prompt, n: 1 }),
  });
  const item = (corpo.data as { b64_json?: string; url?: string }[] | undefined)?.[0];
  if (item?.b64_json) writeFileSync(arquivo, Buffer.from(item.b64_json, "base64"));
  else if (item?.url) await baixar(item.url, arquivo);
  else throw new Error("a OpenAI respondeu sem imagem");
}

async function elevenlabs(chave: string, modelo: string, p: Pedido, arquivo: string): Promise<void> {
  // Voz padrão da conta; trocar de voz é assunto do painel, não do MCP.
  const voz = "21m00Tcm4TlvDq8ikWAM";
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}`, {
    method: "POST",
    headers: { "content-type": "application/json", "xi-api-key": chave },
    body: JSON.stringify({ text: p.prompt, model_id: modelo }),
  });
  if (!res.ok) throw new Error(`ElevenLabs respondeu ${res.status}: ${await res.text()}`);
  writeFileSync(arquivo, Buffer.from(await res.arrayBuffer()));
}

/** Replicate é assíncrono: cria a predição e espera ela sair do "processing". */
async function replicate(chave: string, modelo: string, p: Pedido, arquivo: string): Promise<void> {
  const cabecalho = { "content-type": "application/json", authorization: `Bearer ${chave}` };
  const entrada: Record<string, unknown> = { prompt: p.prompt };
  if (p.referencia && existsSync(p.referencia)) {
    entrada.image = `data:image/png;base64,${readFileSync(p.referencia).toString("base64")}`;
  }
  let pred = await json(`https://api.replicate.com/v1/models/${modelo}/predictions`, {
    method: "POST",
    headers: { ...cabecalho, prefer: "wait" },
    body: JSON.stringify({ input: entrada }),
  });

  const limite = Date.now() + 15 * 60_000;
  while (pred.status === "starting" || pred.status === "processing") {
    if (Date.now() > limite) throw new Error("o vídeo passou de 15 minutos e eu parei de esperar");
    await new Promise((r) => setTimeout(r, 3000));
    const urls = pred.urls as { get?: string } | undefined;
    if (!urls?.get) throw new Error("o Replicate não devolveu onde acompanhar a predição");
    pred = await json(urls.get, { headers: cabecalho });
  }
  if (pred.status !== "succeeded") {
    throw new Error(`o Replicate falhou: ${String(pred.error ?? pred.status)}`);
  }
  const saida = pred.output;
  const url = Array.isArray(saida) ? (saida.at(-1) as string) : (saida as string);
  if (typeof url !== "string") throw new Error("o Replicate respondeu sem arquivo");
  await baixar(url, arquivo);
}

/**
 * Higgsfield: geração pela assinatura, sem chave de API.
 *
 * O CLI já é autenticado por fora (`higgsfield auth login`) e cobra créditos
 * da conta — é o caminho que não pede chave nenhuma. A sintaxe é
 *   higgsfield generate create <modelo> --prompt "…" [--image ref] --wait --json
 * e `--wait` bloqueia até o job terminar, devolvendo o objeto final.
 */
async function higgsfield(comando: string, modelo: string, p: Pedido, arquivo: string): Promise<void> {
  const args = ["generate", "create", modelo, "--prompt", p.prompt];
  if (p.referencia && existsSync(p.referencia)) {
    // Imagem parte de uma referência; vídeo parte de um primeiro quadro.
    args.push(p.tipo === "video" ? "--start-image" : "--image", p.referencia);
  }
  args.push("--wait", "--wait-timeout", "20m", "--json");

  let saida: string;
  try {
    saida = execFileSync(comando, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 21 * 60_000,
      windowsHide: true,
    });
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string };
    const detalhe = (e.stderr || e.stdout || e.message).trim().split("\n").slice(-3).join(" ");
    throw new Error(
      /auth|login|expired|unauthor/i.test(detalhe)
        ? `a sessão do Higgsfield expirou — rode \`higgsfield auth login\` no terminal`
        : `higgsfield falhou: ${detalhe}`,
    );
  }

  const url = acharUrl(saida);
  if (!url) throw new Error(`o higgsfield terminou mas não devolveu arquivo: ${saida.slice(-300)}`);
  await baixar(url, arquivo);
}

/** O CLI devolve um objeto de job; o que interessa é a URL do resultado. */
export function acharUrl(saida: string): string | null {
  try {
    const achados: string[] = [];
    const varrer = (v: unknown): void => {
      if (typeof v === "string") {
        if (/^https?:\/\//.test(v) && !/\.(json|txt)$/i.test(v)) achados.push(v);
      } else if (Array.isArray(v)) v.forEach(varrer);
      else if (v && typeof v === "object") Object.values(v).forEach(varrer);
    };
    varrer(JSON.parse(saida));
    // A última costuma ser o render final; as anteriores são entradas.
    if (achados.length > 0) return achados.at(-1)!;
  } catch {
    // Não veio JSON: o CLI ainda imprime a URL em texto.
  }
  return /https?:\/\/\S+/.exec(saida)?.[0]?.replace(/[.,)\]]+$/, "") ?? null;
}

/**
 * O catálogo vivo da conta. Sem isto ficaríamos com nomes de modelo que a
 * skill escreveu meses atrás; o servidor sabe o que existe hoje.
 */
export function modelosDoHiggsfield(comando: string): string[] {
  try {
    const saida = execFileSync(comando, ["model", "list", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
      windowsHide: true,
    });
    const ids: string[] = [];
    const varrer = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(varrer);
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        for (const chave of ["jst", "id", "model", "name"]) {
          if (typeof o[chave] === "string" && /^[a-z0-9_]+$/.test(o[chave])) {
            ids.push(o[chave] as string);
            return;
          }
        }
        Object.values(o).forEach(varrer);
      }
    };
    varrer(JSON.parse(saida));
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

export async function gerar(p: Pedido): Promise<Gerado> {
  const candidatos = provedoresDe(p.tipo);
  if (candidatos.length === 0) {
    const todos = listarMedia().filter((x) => x.faz.includes(p.tipo));
    const como = todos.map((x) => `${x.id}: ${x.falta}`).join("; ");
    throw new Error(
      todos.length === 0
        ? `nenhum provedor de ${p.tipo} está cadastrado`
        : `nenhum provedor de ${p.tipo} está pronto. ${como}`,
    );
  }
  const escolhido = p.provedor ? candidatos.find((x) => x.id === p.provedor) : candidatos[0];
  if (!escolhido) {
    throw new Error(
      `"${p.provedor}" não está pronto para ${p.tipo}. Prontos: ${candidatos.map((x) => x.id).join(", ")}`,
    );
  }

  const spec = config.media![escolhido.id]!;
  // Imagem, vídeo e áudio usam modelos diferentes no mesmo provedor.
  const modelo = p.modelo ?? spec.modeloPorTipo?.[p.tipo] ?? escolhido.modelo;
  if (escolhido.modelos.length > 0 && modelo && !escolhido.modelos.includes(modelo)) {
    throw new Error(
      `"${modelo}" não é modelo de ${escolhido.id}. Tem: ${escolhido.modelos.slice(0, 12).join(", ")}`,
    );
  }
  const arquivo = nomeNovo(p.destino, p.tipo);

  if (spec.via === "cli") {
    if (escolhido.id === "higgsfield") {
      if (!modelo) throw new Error("escolha um modelo do Higgsfield para este tipo");
      await higgsfield(spec.comando!, modelo, p, arquivo);
      return { arquivo, provedor: escolhido.id, modelo };
    }
    // Outro CLI qualquer: os argumentos vêm do cockpit.json.
    const args = (spec.args ?? []).map((a) =>
      a.replace("{prompt}", p.prompt).replace("{saida}", arquivo).replace("{modelo}", modelo ?? ""),
    );
    execFileSync(spec.comando!, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 15 * 60_000 });
    if (!existsSync(arquivo)) throw new Error(`${escolhido.id} rodou mas não escreveu o arquivo`);
    return { arquivo, provedor: escolhido.id, modelo: modelo ?? null };
  }

  const { valor: chave } = chaveDe(escolhido.id, spec);
  if (!chave) throw new Error(`${escolhido.id} está sem chave`);

  switch (escolhido.id) {
    case "gemini-image": await gemini(chave, modelo!, p, arquivo); break;
    case "gpt-image": await openaiImagem(chave, modelo!, p, arquivo); break;
    case "elevenlabs": await elevenlabs(chave, modelo!, p, arquivo); break;
    case "replicate": await replicate(chave, modelo!, p, arquivo); break;
    default: throw new Error(`não sei falar com "${escolhido.id}" ainda`);
  }
  return { arquivo, provedor: escolhido.id, modelo: modelo ?? null };
}
