import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_DSH_REPO_PATH = "/DATA/Projetos/deepseek-harness";
export const DEFAULT_DSH_BIN_RELATIVE = "apps/cli/lib/bin.js";
export const PINNED_DSH_VERSION = "0.1.5-rc.2";

/**
 * Retorna o caminho do binário do DSH pinado no checkout local.
 * Pode ser configurado via DSH_BIN ou DSH_REPO_PATH.
 */
export function getDshBinPath(): string {
  if (process.env.DSH_BIN && process.env.DSH_BIN.trim().length > 0) {
    return resolve(process.env.DSH_BIN.trim());
  }
  const repo = process.env.DSH_REPO_PATH && process.env.DSH_REPO_PATH.trim().length > 0
    ? resolve(process.env.DSH_REPO_PATH.trim())
    : DEFAULT_DSH_REPO_PATH;
  return join(repo, DEFAULT_DSH_BIN_RELATIVE);
}

/**
 * Retorna o caminho do DSH_HOME isolado para o motor do Cockpit.
 * Não pode compartilhar ~/.dsh do dsh web interativo.
 * Default isolado: ~/.cockpit/dsh-home (ou $COCKPIT_HOME/dsh-home).
 */
export function getDshHomePath(): string {
  if (process.env.DSH_HOME && process.env.DSH_HOME.trim().length > 0) {
    return resolve(process.env.DSH_HOME.trim());
  }
  const cockpitHome = process.env.COCKPIT_HOME && process.env.COCKPIT_HOME.trim().length > 0
    ? resolve(process.env.COCKPIT_HOME.trim())
    : join(homedir(), ".cockpit");
  return join(cockpitHome, "dsh-home");
}

/**
 * Verifica se um caminho de DSH_HOME é isolado (i.e. não é ~/.dsh do dsh web).
 */
export function isDshHomeIsolated(homePath: string): boolean {
  if (!homePath || homePath.trim().length === 0) {
    return false;
  }
  const normalized = resolve(homePath.trim());
  const defaultWebDsh = resolve(join(homedir(), ".dsh"));
  return normalized !== defaultWebDsh;
}

export type DshAvailability = {
  available: boolean;
  binPath: string;
  binExists: boolean;
  homePath: string;
  homeExists: boolean;
  isolated: boolean;
  error?: string;
  version?: string;
};

export type CheckDshOptions = {
  binPath?: string;
  homePath?: string;
};

/**
 * Detecta a disponibilidade da engine DeepSeek Harness.
 *
 * Requisitos para disponibilidade:
 * 1. O binário pinado do checkout local deve existir no disco.
 * 2. O DSH_HOME deve ser isolado (NÃO pode ser ~/.dsh do dsh web interativo).
 * 3. O diretório DSH_HOME isolado deve existir no filesystem.
 *
 * Módulo puramente de detecção — sem spawn SDK nem efeitos colaterais.
 */
export function checkDshAvailability(options?: CheckDshOptions): DshAvailability {
  const binPath = options?.binPath ? resolve(options.binPath) : getDshBinPath();
  const homePath = options?.homePath ? resolve(options.homePath) : getDshHomePath();

  let binExists = false;
  try {
    binExists = existsSync(binPath) && statSync(binPath).isFile();
  } catch {
    binExists = false;
  }

  const isolated = isDshHomeIsolated(homePath);

  let homeExists = false;
  try {
    homeExists = existsSync(homePath) && statSync(homePath).isDirectory();
  } catch {
    homeExists = false;
  }

  let version: string | undefined;
  if (binExists) {
    try {
      // Procura package.json subindo a partir do diretório do binário
      let curr = dirname(binPath);
      for (let i = 0; i < 5; i++) {
        const pkgPath = join(curr, "package.json");
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string };
          if (pkg.version) {
            version = pkg.version;
            if (pkg.name === "@deepseek-ai/dsh-root") {
              break;
            }
          }
        }
        const parent = dirname(curr);
        if (parent === curr) break;
        curr = parent;
      }
    } catch {
      // Falha ao ler versão não bloqueia
    }
  }

  let error: string | undefined;
  if (!binExists) {
    error = `Binário DSH não encontrado em: ${binPath}`;
  } else if (!isolated) {
    error = `DSH_HOME não pode ser ~/.dsh (compartilhado com dsh web). É obrigatório usar um DSH_HOME isolado (ex: ${join(homedir(), ".cockpit", "dsh-home")}).`;
  } else if (!homeExists) {
    error = `Diretório isolado DSH_HOME não encontrado em: ${homePath}`;
  }

  const available = binExists && isolated && homeExists;

  return {
    available,
    binPath,
    binExists,
    homePath,
    homeExists,
    isolated,
    ...(error ? { error } : {}),
    ...(version ? { version } : {}),
  };
}
