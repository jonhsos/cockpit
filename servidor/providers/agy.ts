import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A Antigravity aceita --model em modo print, mas em sessão interativa ignora
 * a flag e usa o modelo salvo nas preferências. Para o cockpit poder ter um
 * painel com Gemini Flash e outro com Opus 4.6 ao mesmo tempo, escrevemos a
 * preferência logo antes de cada spawn.
 *
 * Consequência: dois painéis agy abertos no mesmo instante disputariam o
 * arquivo. Por isso o squad espaça a subida deles.
 */

const SETTINGS = join(homedir(), ".gemini", "antigravity-cli", "settings.json");

let mapa: Map<string, string> | null = null;

/** id do modelo -> nome de exibição, que é o que o settings.json guarda. */
function carregarModelos(): Map<string, string> {
  if (mapa) return mapa;
  mapa = new Map();
  try {
    const saida = execFileSync("agy", ["models"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    });
    for (const linha of saida.split(/\r?\n/)) {
      const [id, nome] = linha.split("\t");
      if (id && nome) mapa.set(id.trim(), nome.trim());
    }
  } catch {
    // Sem rede ou sem login: seguimos sem trocar o modelo.
  }
  return mapa;
}

export function definirModelo(modelId: string | undefined): void {
  if (!modelId) return;
  const nome = carregarModelos().get(modelId);
  if (!nome) return;

  let c: Record<string, unknown> = {};
  if (existsSync(SETTINGS)) {
    try {
      c = JSON.parse(readFileSync(SETTINGS, "utf8")) as Record<string, unknown>;
    } catch {
      return; // arquivo do usuário ilegível: não é nosso lugar de reescrever
    }
  }
  if (c.model === nome) return;
  c.model = nome;
  mkdirSync(dirname(SETTINGS), { recursive: true });
  writeFileSync(SETTINGS, JSON.stringify(c, null, 2));
}
