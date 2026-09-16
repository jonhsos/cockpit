import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Ponte: um provedor que é uma API, não um programa. O cockpit empresta o
 * binário de outro CLI (`command`) e aponta ele para outro servidor. Assim o
 * OpenRouter — e qualquer endpoint compatível — vira um painel normal.
 */
export type PonteSpec = {
  /** Nome do provedor dentro do CLI base (model_providers.<id>). */
  provider?: string;
  label?: string;
  base_url: string;
  /** Variável de ambiente onde a chave entra, só no processo do painel. */
  chaveEnv: string;
  /** "responses" é o padrão; o Codex 0.154 não aceita mais "chat". */
  wireApi?: string;
  /** Cabeçalhos fixos — o OpenRouter usa para saber de onde vem o tráfego. */
  headers?: Record<string, string>;
  /** Onde buscar o catálogo, quando não é <base_url>/models. */
  catalogo?: string;
  /** Endpoint que informa crédito e limite, quando o provedor tem um. */
  cota?: string;
  /** Página onde se cria a chave, para a tela poder mandar você direto. */
  chaveUrl?: string;
  /** Só listar modelos de preço zero. É isto que faz a aba "Grátis". */
  soGratis?: boolean;
  /** Ajustes soltos do CLI base, em pares chave=valor de configuração. */
  extra?: Record<string, string>;
  nota?: string;
};

/**
 * Uma rota de API usada diretamente pelo cérebro do DSH. Diferente de uma
 * ponte, ela não tenta transformar a API em CLI: o Harness fala com ela pelo
 * protocolo que o próprio DSH suporta.
 */
export type DshApiSpec = {
  /** Chave da rota no catálogo do DSH, por exemplo `deepseek-official`. */
  provider: string;
  label: string;
  /** Nome da variável entregue somente ao processo DSH do painel. */
  chaveEnv: string;
  /** Omitido para uma rota nativa do catálogo do DSH. */
  api?: "openai-completions" | "openai-responses" | "anthropic-messages";
  /** Omitido para usar a URL oficial conhecida pelo DSH. */
  baseURL?: string;
  chaveUrl?: string;
  /** Último catálogo confirmado pelo DSH ou pelo endpoint da API. */
  modelos?: DshApiModel[];
};

export type DshApiModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
};

export type ContaPoolSpec = {
  id: string;
  label?: string;
  env?: Record<string, string>;
  args?: string[];
};

export type CliBackend = "pty" | "dsh";

export type CliSpec = {
  command: string;
  args?: string[];
  /**
   * Transporte de execução do CLI:
   * - "pty": processo direto via node-pty (padrão legado do Cockpit)
   * - "dsh": engine DeepSeek Harness via profile sdk
   * Default: "pty" quando omitido.
   */
  backend?: CliBackend;
  /**
   * De que família este CLI é. Ausente = ele mesmo. Serve para um provedor
   * que roda pelo binário de outro herdar o mesmo tratamento de argumentos.
   */
  familia?: string;
  ponte?: PonteSpec;
  dshApi?: DshApiSpec;
  env?: Record<string, string>;
  sandbox?: string;
  /** Pool de contas para concorrência e failover transparente */
  pool?: ContaPoolSpec[];
};

export type AgentSpec = {
  label: string;
  cor: string;
  cli: string;
  model?: string;
  effort?: string;
  args?: string[];
  papel?: string;
  /** Recebe as ferramentas do cockpit para delegar aos outros. */
  maestro?: boolean;
  /** Skills que este agente sempre carrega. */
  skills?: string[];
  /**
   * Lista fechada de skills. Ausente = sem restrição; presente = só estas,
   * mesmo que outra se auto-instale pelo papel. Vazia = nenhuma.
   */
  allowedSkills?: string[];
  /** Papel para auto-instalação de skills: builder, reviewer, scout… */
  papel_id?: string;
};

/**
 * Receita: uma formação de harness que já se provou certa para um tipo de
 * objetivo — agente + skills + cli + modelo + esforço, junto. Serve para não
 * remontar o time do zero a cada missão parecida.
 */
export type Receita = {
  label: string;
  descricao: string;
  /** Modo da missão: livre, squad ou agentico. */
  modo?: string;
  squad?: string;
  agent?: string;
  tipo?: string;
  cli?: string;
  model?: string;
  effort?: string;
  skills?: string[];
  /** Elenco de IAs que a receita já traz pronto. */
  elenco?: Elenco;
  /** Quantos painéis a missão abre. */
  paineis?: number;
  /** Receita da casa não some numa atualização; a sua é sua. */
  daCasa?: boolean;
};

export type MediaProvider = {
  label: string;
  /** image | video | audio — o que este provedor sabe fazer. */
  faz: string[];
  /** Como o cockpit chama: "cli" (comando local) ou "http" (API com chave). */
  via: "cli" | "http";
  /** Comando a procurar no PATH, quando via=cli. */
  comando?: string;
  /** Variável de ambiente que carrega a chave, quando via=http. */
  chaveEnv?: string;
  modelos?: string[];
  modelo?: string;
  /** Modelo por tipo — imagem, vídeo e áudio usam IDs diferentes. */
  modeloPorTipo?: Record<string, string>;
  /** Como o cockpit paga: "assinatura" (login no CLI) ou "chave" (API). */
  pagamento?: "assinatura" | "chave";
  /** Comando de instalação que o cockpit pode rodar por você. */
  instalarComando?: string[];
  /** Argumentos do comando, com {prompt} {saida} {modelo}. */
  args?: string[];
  /** Como habilitar, quando falta algo. */
  instalar?: string;
  nota?: string;
};

export type Roster = Record<string, { cli?: string; model?: string; effort?: string; tipo?: string }>;

/**
 * Elenco: quais IAs entram nesta missão, e em que configuração.
 *
 * Sem isto quem decide o provedor é o catálogo do agente, e uma missão de site
 * terminava com o Gemini escrevendo front-end. O elenco é a decisão do dono da
 * missão: estes provedores, neste modelo, neste esforço — e quem só serve para
 * imagem só entra quando a tarefa for visual.
 */
export type Elenco = {
  /** Provedores liberados, na ordem de preferência. Vazio = todos. */
  clis: string[];
  /** Modelo e esforço fixados por provedor. Fixado ganha do perfil do agente. */
  porCli?: Record<string, { model?: string; effort?: string }>;
  /** Provedores que só entram em tarefa visual — imagem, vídeo, mockup. */
  soVisual?: string[];
};

export type SquadSpec = {
  label: string;
  descricao: string;
  fases: { nome: string; agentes: string[]; tipo?: string; roster?: Roster }[];
};

export type TipoTarefa = {
  label: string;
  descricao: string;
  /** Provedor ao qual pertencem os defaults; não substitui o CLI do agente. */
  cli?: string;
  model?: string;
  effort?: string;
  /** O equivalente da tarefa em cada provedor: opus no claude, astra no codex. */
  porCli?: Record<string, { model?: string; effort?: string }>;
  /** Só estes provedores fazem este tipo de tarefa. Ausente = qualquer um. */
  clis?: string[];
  /** Tarefa de imagem/vídeo: quem é do elenco só para visual pode pegar. */
  visual?: boolean;
};

export type Preco = { in: number; out: number; cacheWrite: number; cacheRead: number };

export type ExecucaoIA = { cli: string; model: string; effort: string };
export type PoliticaIA = { modo: "padrao" | "unica" | "dividida"; unica?: ExecucaoIA; papeis?: Record<string, ExecucaoIA> };

export type CockpitConfig = {
  politicaIA?: PoliticaIA;
  maestroAutoSwitch?: boolean;
  port: number;
  /** Marca as pastas que você abre como confiáveis para o Claude Code. */
  confiarNasPastasQueEuAbrir?: boolean;
  /** Auto-aprova comandos e ferramentas nos CLIs (--dangerously-skip-permissions, --ask-for-approval never, etc.). */
  autoAprovar?: boolean;
  workspace?: {
    modo?: "pasta-real";
    worktreesAutomaticos?: boolean;
    umaMissaoEscritoraPorProjeto?: boolean;
    bloquearPastasCockpitWorktrees?: boolean;
  };
  /** Idioma do ditado: portuguese, english, spanish… */
  vozIdioma?: string;
  /** Colado no prompt de todo agente: fatos desta máquina. */
  instrucoesGerais?: string;
  clis: Record<string, CliSpec>;
  agents: Record<string, AgentSpec>;
  squads: Record<string, SquadSpec>;
  precos: Record<string, Preco>;
  /** Modelos que cada CLI aceita — o harness usa para não cruzar provedores. */
  modelos?: Record<string, string[]>;
  /** Níveis de esforço que cada CLI aceita. */
  efforts?: Record<string, string[]>;
  harness?: { tipos: Record<string, TipoTarefa> };
  receitas?: Record<string, Receita>;
  /** Provedores de imagem, vídeo e áudio. */
  media?: Record<string, MediaProvider>;
  /** Repositórios git no formato de marketplace do Claude Code. */
  marketplaces?: { id: string; url: string }[];
};

export const CLI_BACKENDS: readonly CliBackend[] = ["pty", "dsh"] as const;

export function isCliBackend(value: unknown): value is CliBackend {
  return value === "pty" || value === "dsh";
}

/**
 * Valida e converte um valor de backend para CliBackend.
 * Se omitido/indefinido/null, retorna o padrão "pty".
 * Se valor desconhecido, lança erro.
 */
export function parseCliBackend(value: unknown): CliBackend {
  if (value === undefined || value === null) {
    return "pty";
  }
  if (isCliBackend(value)) {
    return value;
  }
  throw new Error(`Valor inválido para backend de CLI: "${String(value)}". Valores suportados: "pty" | "dsh"`);
}

/**
 * Retorna o backend efetivo para um CLI ou CliSpec.
 * Retorna "pty" como fallback quando omitido.
 */
export function backendDo(cli: CliSpec | string | undefined | null): CliBackend {
  if (!cli) return "pty";
  if (typeof cli === "string") {
    const spec = config?.clis?.[cli];
    return spec?.backend ?? "pty";
  }
  return cli.backend ?? "pty";
}

export const resolveCliBackend = backendDo;

const ARQUIVO = process.env.COCKPIT_CONFIG ?? fileURLToPath(new URL("../cockpit.json", import.meta.url));

export const ler = (): CockpitConfig => {
  const cfg = JSON.parse(readFileSync(ARQUIVO, "utf8")) as CockpitConfig;
  if (cfg.maestroAutoSwitch === undefined) cfg.maestroAutoSwitch = false;
  cfg.workspace = {
    modo: "pasta-real",
    worktreesAutomaticos: false,
    umaMissaoEscritoraPorProjeto: true,
    bloquearPastasCockpitWorktrees: true,
    ...cfg.workspace,
  };
  if (cfg.clis) {
    for (const [id, cli] of Object.entries(cfg.clis)) {
      if (cli && typeof cli === "object" && cli.backend !== undefined) {
        cli.backend = parseCliBackend(cli.backend);
      }
    }
  }
  return cfg;
};

/**
 * O objeto é sempre o mesmo, mutado no lugar: todos os módulos que já
 * importaram `config` enxergam a mudança sem reiniciar o servidor.
 */
export const config: CockpitConfig = ler();

const modelosRuntime: Record<string, string[]> = {};

/**
 * Catálogos descobertos durante a execução não são configuração persistente.
 * Isto permite que o gateway atualize a UI e as validações sem transformar
 * uma simples abertura do Cockpit em uma gravação de catálogo possivelmente
 * grande e já desatualizado no cockpit.json.
 */
export function modelosDoCli(id: string): string[] {
  return modelosRuntime[id] ?? config.modelos?.[id] ?? [];
}

export function definirModelosRuntime(id: string, modelos: string[]): void {
  modelosRuntime[id] = [...modelos];
}

export function limparModelosRuntime(id?: string): void {
  if (id) {
    delete modelosRuntime[id];
    return;
  }
  for (const key of Object.keys(modelosRuntime)) delete modelosRuntime[key];
}

export function salvarConfig(): void {
  writeFileSync(ARQUIVO, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function recarregarConfig(): void {
  const novo = ler() as unknown as Record<string, unknown>;
  const alvo = config as unknown as Record<string, unknown>;
  for (const k of Object.keys(alvo)) delete alvo[k];
  Object.assign(alvo, novo);
  limparModelosRuntime();
}
