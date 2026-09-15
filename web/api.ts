import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskEvidence,
  EvidenceType,
  TaskTimestamps,
  CreateTaskParams,
  UpdateTaskParams,
  TaskBoardData,
  FileLock,
  LockMode,
  LockResult,
  Connection,
  ConnectionStatus,
  Handoff,
  HandoffStatus,
  MailboxMessage,
  MailboxMessageType,
  RoleDefinition,
  RunnerId,
  RunnerOption,
  ModelOption,
  GranularPaneStatus,
  MissionMode,
} from "./tipos.ts";

export type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskEvidence,
  EvidenceType,
  TaskTimestamps,
  CreateTaskParams,
  UpdateTaskParams,
  TaskBoardData,
  FileLock,
  LockMode,
  LockResult,
  Connection,
  ConnectionStatus,
  Handoff,
  HandoffStatus,
  MailboxMessage,
  MailboxMessageType,
  RoleDefinition,
  RunnerId,
  RunnerOption,
  ModelOption,
  GranularPaneStatus,
  MissionMode,
};

export type Usage = {
  in: number;
  out: number;
  cacheWrite: number;
  cacheRead: number;
  custo: number;
  turnos: number;
  model: string | null;
};

export type PaneState = {
  paneId: string;
  agent: string;
  label: string;
  cor: string;
  cli: string;
  model: string | null;
  effort: string | null;
  tipo: string | null;
  cwd: string;
  projectId: string | null;
  missionId: string | null;
  sessionId: string | null;
  maestro: boolean;
  role?: string;
  runner?: string;
  status:
    | "starting"
    | "waiting-user"
    | "working"
    | "blocked"
    | "review"
    | "completed"
    | "failed"
    | "dead"
    | "run"
    | "idle";
  blockedReason?: string | null;
  bytesIn: number;
  bytesOut: number;
  iniciadoEm: number;
  atividade: number[];
};

export type Project = { id: string; nome: string; root: string; git: boolean; abertoEm: number };

export type Nota = { quando: number; quem: string; texto: string };

export type SquadRun = {
  missionId: string;
  squad: string;
  brief: string;
  fases: { nome: string; agentes: string[] }[];
  faseAtual: number;
  iniciadaEm: number;
};

export type Mission = {
  id: string;
  projectId: string;
  nome: string;
  objetivo: string;
  worktree: string;
  branch: string | null;
  isolada: boolean;
  panes: string[];
  elenco?: Elenco;
  criadaEm: number;
  git: { dirty: number; head: string | null };
  usage: Usage;
  squad: SquadRun | null;
  modo?: string;
  ownershipMode?: string;
};

export type AgentSpec = {
  label: string;
  cor: string;
  cli: string;
  model?: string;
  effort?: string;
  papel?: string;
  maestro?: boolean;
};

export type SquadSpec = {
  label: string;
  descricao: string;
  fases: { nome: string; agentes: string[] }[];
};

export type PorModelo = {
  model: string;
  in: number;
  out: number;
  cacheWrite: number;
  cacheRead: number;
  turnos: number;
  custo: number;
};

export type Consumo = {
  claude: {
    total: PorModelo;
    porModelo: PorModelo[];
    porDia: { dia: string; tokens: number; custo: number }[];
    sessoes: number;
    desde: string | null;
  };
  agy: { conversas: number; pedidos: number; ultima: string | null };
};

export type AccountPoolItemView = {
  id: string;
  label: string;
  status: "livre" | "ocupada" | "cooldown";
  painelId?: string;
  painelLabel?: string;
  limitedUntil?: number;
  lastLimitDetail?: string;
  env?: Record<string, string>;
};

export type AccountPoolView = {
  cli: string;
  contas: AccountPoolItemView[];
  total: number;
  ativas: number;
  emCooldown: number;
};

export type Provider = {
  id: string;
  comando: string;
  disponivel: boolean;
  caminho: string | null;
  modelos: string[];
  /** Pode faltar quando o servidor ainda é de uma versão anterior. */
  efforts?: string[];
  agentes: string[];
  instalar?: string;
  /** Presente quando o provedor é uma API rodando pelo binário de outro CLI. */
  ponte?: { base: string; chaveEnv: string; chaveEm: string | null; gratis: boolean };
  /** Pool de contas multicontas configurado para este provedor */
  pool?: AccountPoolView;
};

/**
 * Elenco: quais IAs entram na missão. "porCli" fixa modelo e esforço — o que
 * for fixado ganha do perfil do agente. "soVisual" marca quem só entra para
 * imagem: é assim que o Gemini desenha sem escrever o site.
 */
export type Elenco = {
  clis: string[];
  porCli?: Record<string, { model?: string; effort?: string }>;
  soVisual?: string[];
};

export type Preset = {
  id: string;
  label: string;
  comando: string;
  instalar?: string;
  modelos: string[];
  nota?: string;
};

export type TipoTarefa = {
  label: string;
  descricao: string;
  cli?: string;
  model?: string;
  effort?: string;
};

export type No = { nome: string; caminho: string; dir: boolean; filhos?: No[] };

async function json<T>(res: Response): Promise<T> {
  // Uma resposta que não é JSON quase sempre quer dizer que o servidor em
  // execução é mais antigo que esta tela. O `web/dist` é lido do disco a cada
  // pedido, então a interface se atualiza sozinha depois de um build enquanto
  // o processo continua sendo o de antes — e a rota nova cai na página 404 do
  // Express, que é HTML. Sem isto a tela dizia "Unexpected token '<'", que não
  // diz a ninguém o que fazer.
  if (!res.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      res.status === 404
        ? "O servidor do cockpit está desatualizado: esta tela pede uma rota que ele ainda não tem. Feche o cockpit e rode `npm start` de novo."
        : `O servidor respondeu ${res.status} sem JSON. Olhe o terminal onde o cockpit está rodando.`,
    );
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const del = (url: string) => fetch(url, { method: "DELETE" });

export const fetchConfig = () =>
  fetch("/api/config").then(
    json<{
      agents: Record<string, AgentSpec>;
      squads: Record<string, SquadSpec>;
      tarefas: Record<string, TipoTarefa>;
      providers: Provider[];
      receitas: Record<string, Receita>;
      autoAprovar?: boolean;
    }>,
  );

// projetos
export const fetchProjects = () => fetch("/api/projects").then(json<{ projects: Project[] }>);
export const postProject = (root: string) => post("/api/projects", { root }).then(json<Project>);
export const escolherPasta = () =>
  post("/api/escolher-pasta", {}).then(json<{ caminho: string | null; navegar?: boolean }>);
export const listarDiretorios = (path?: string) =>
  post("/api/listar-diretorios", { path: path ?? "" }).then(
    json<{ path: string; dirs: string[]; parent: string }>,
  );
export const closeProject = (id: string) => del(`/api/projects/${id}`).then(json<{ ok: true }>);
export const prepararGit = (id: string) =>
  post(`/api/projects/${id}/git`, {}).then(json<{ ok: true; pronto: boolean }>);

// provedores
export const fetchProviders = (rescan = false) =>
  fetch(`/api/providers${rescan ? "?rescan=1" : ""}`).then(
    json<{ providers: Provider[]; presets: Preset[]; autoAprovar?: boolean }>,
  );
export const salvarAutoAprovar = (autoAprovar: boolean) =>
  post("/api/config/auto-aprovar", { autoAprovar }).then(
    json<{ ok: true; autoAprovar: boolean }>,
  );
export const conectarProvider = (c: { id: string; comando: string; modelos?: string[] }) =>
  post("/api/providers", c).then(json<Provider>);
export const desconectarProvider = (id: string) =>
  del(`/api/providers/${id}`).then(json<{ ok: true }>);
export const criarAgenteProvider = (id: string) =>
  post(`/api/providers/${id}/agente`, {}).then(json<{ id: string; label: string }>);
export const testarProvider = (id: string) =>
  post(`/api/providers/${id}/testar`, {}).then(json<{ ok: boolean; saida: string }>);

// memória
export const fetchMemoria = (projectId: string) =>
  fetch(`/api/projects/${projectId}/memoria`).then(json<Nota[]>);
export const postNota = (projectId: string, texto: string) =>
  post(`/api/projects/${projectId}/memoria`, { quem: "você", texto }).then(json<Nota>);
export const deleteNota = (projectId: string, quando: number) =>
  del(`/api/projects/${projectId}/memoria/${quando}`).then(json<{ ok: true }>);

export const fetchConsumo = (dias: number) =>
  fetch(`/api/consumo?dias=${dias}`).then(json<Consumo>);

// missões
export const fetchMissions = (projectId: string) =>
  fetch(`/api/missions?projectId=${projectId}`).then(json<{ missions: Mission[] }>);
export const postMission = (
  projectId: string,
  nome: string,
  objetivo: string,
  skills?: string[],
  receita?: string,
  elenco?: Elenco,
) => post("/api/missions", { projectId, nome, objetivo, skills, receita, elenco }).then(json<Mission>);

export const salvarElenco = (missionId: string, elenco: Elenco | null) =>
  post("/api/missions/" + missionId + "/elenco", { elenco }).then(json<{ elenco: Elenco | null }>);
export const renomearMissao = (missionId: string, nome: string) =>
  post(`/api/missions/${missionId}/nome`, { nome }).then(json<{ mission: Mission }>);
export const deleteMission = (id: string) => del(`/api/missions/${id}`).then(json<{ ok: true }>);
export const mudarModo = (missionId: string, modo: string) =>
  post(`/api/missions/${missionId}/modo`, { modo }).then(json<{ ok: true; modo: string }>);

// tarefas (R6)
export const fetchTasks = (missionId: string) =>
  fetch(`/api/missions/${missionId}/tasks`).then(json<{ ok: boolean; tasks: Task[] }>);

export const fetchTaskBoard = (missionId: string) =>
  fetch(`/api/missions/${missionId}/tasks/board`).then(json<{ ok: boolean; board: TaskBoardData }>);

export const fetchTask = (missionId: string, taskId: string) =>
  fetch(`/api/missions/${missionId}/tasks/${taskId}`).then(json<{ ok: boolean; task: Task }>);

export const createTask = (missionId: string, params: CreateTaskParams) =>
  post(`/api/missions/${missionId}/tasks`, params).then(json<{ ok: boolean; task: Task }>);

export const updateTask = (missionId: string, taskId: string, params: UpdateTaskParams) =>
  fetch(`/api/missions/${missionId}/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  }).then(json<{ ok: boolean; task: Task }>);

export const transitionTask = (
  missionId: string,
  taskId: string,
  status: TaskStatus,
  context?: { reason?: string; resultado?: string; evidence?: TaskEvidence; force?: boolean },
) =>
  post(`/api/missions/${missionId}/tasks/${taskId}/status`, { status, ...context }).then(
    json<{ ok: boolean; task: Task }>,
  );

export const assignTask = (
  missionId: string,
  taskId: string,
  paneId: string | null,
  responsavel?: string,
  papel?: string,
) =>
  post(`/api/missions/${missionId}/tasks/${taskId}/atribuir`, { paneId, responsavel, papel }).then(
    json<{ ok: boolean; task: Task }>,
  );

export const addEvidence = (
  missionId: string,
  taskId: string,
  evidence: Partial<TaskEvidence>,
) =>
  post(`/api/missions/${missionId}/tasks/${taskId}/evidencia`, evidence).then(
    json<{ ok: boolean; evidence: TaskEvidence }>,
  );

export const recordKnowledge = (
  missionId: string,
  taskId: string,
  descricao: string,
  conteudo?: string,
  autor?: string,
) =>
  post(`/api/missions/${missionId}/tasks/${taskId}/conhecimento`, { descricao, conteudo, autor }).then(
    json<{ ok: boolean; evidence: TaskEvidence }>,
  );

export const deleteTask = (missionId: string, taskId: string) =>
  del(`/api/missions/${missionId}/tasks/${taskId}`).then(json<{ ok: true }>);

// file locks (R7)
export const fetchLocks = (missionId: string) =>
  fetch(`/api/missions/${missionId}/locks`).then(json<{ ok: boolean; locks: FileLock[] }>);

export const acquireLock = (
  missionId: string,
  params: { taskId: string; paneId?: string | null; files: string[]; mode: LockMode; owner: string },
) =>
  post(`/api/missions/${missionId}/locks/acquire`, params).then(json<LockResult>);

export const releaseLock = (missionId: string, params: { taskId: string; files?: string[] }) =>
  post(`/api/missions/${missionId}/locks/release`, params).then(json<{ ok: true }>);

// conexões e handoffs (R5)
export const fetchConnections = (missionId: string) =>
  fetch(`/api/missions/${missionId}/connections`).then(json<{ ok: boolean; connections: Connection[] }>);

export const createConnection = (missionId: string, sourcePaneId: string, targetPaneId: string) =>
  post(`/api/missions/${missionId}/connections`, { sourcePaneId, targetPaneId }).then(
    json<{ ok: boolean; connection: Connection }>,
  );

export const deleteConnection = (missionId: string, id: string) =>
  del(`/api/missions/${missionId}/connections/${id}`).then(json<{ ok: boolean }>);

export const fetchHandoffs = (missionId: string) =>
  fetch(`/api/missions/${missionId}/handoffs`).then(json<{ ok: boolean; handoffs: Handoff[] }>);

// painéis e times
export const fetchPanes = () =>
  fetch("/api/panes").then(json<{ panes: (PaneState & { usage: Usage })[] }>);
export const postPapelPainel = (
  paneId: string,
  dados: { maestro: boolean; agent?: string; label?: string; cor?: string },
) => post(`/api/panes/${paneId}/papel`, dados).then(json<{ ok: true; pane: PaneState }>);
export const postSquad = (id: string, squad: string, brief: string) =>
  post(`/api/missions/${id}/squad`, { squad, brief }).then(json<{ run: SquadRun }>);
export const postAvancarFase = (id: string) =>
  post(`/api/missions/${id}/squad/avancar`, {}).then(json<{ run: SquadRun }>);

// arquivos
const escopo = (missionId: string | null, projectId: string | null) =>
  `missionId=${missionId ?? ""}&projectId=${projectId ?? ""}`;

export const fetchTree = (missionId: string | null, projectId: string | null) =>
  fetch(`/api/tree?${escopo(missionId, projectId)}`).then(json<{ base: string; tree: No[] }>);

export const fetchFile = (missionId: string | null, projectId: string | null, path: string) =>
  fetch(`/api/file?${escopo(missionId, projectId)}&path=${encodeURIComponent(path)}`).then(
    json<{ path: string; content: string }>,
  );

export const saveFile = (
  missionId: string | null,
  projectId: string | null,
  path: string,
  content: string,
) => post("/api/file", { missionId, projectId, path, content }).then(json<{ ok: true }>);

// ---------------------------------------------------------------------------
// skills, receitas, marketplace e media
// ---------------------------------------------------------------------------

export type Skill = {
  nome: string;
  descricao: string;
  papeis?: string[];
  caminho: string;
  origem: string;
  editavel: boolean;
  tamanho: number;
};

export type Acervo = { total: number; porOrigem: Record<string, number> };

export type SkillsDoAgente = {
  skills: { nome: string; descricao: string }[];
  fixas: string[];
  allowedSkills: string[] | null;
  papel_id: string;
};

export type Receita = {
  label: string;
  descricao: string;
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
  paineis?: number;
  daCasa?: boolean;
};

export type PluginAchado = {
  id: string;
  nome: string;
  descricao: string;
  categoria: string | null;
  marketplace: string;
  skills: { nome: string; descricao: string; instalada: boolean }[];
  mcps: string[];
  local: boolean;
  remoto: { url: string; caminho?: string; ref?: string } | null;
  homepage: string | null;
};

export type Fonte = { id: string; url: string | null; origem: string; plugins: number; caminho: string };

export type MediaProvider = {
  id: string;
  label: string;
  faz: string[];
  via: "cli" | "http";
  /** "assinatura" não pede chave nenhuma; "chave" pede uma API key. */
  pagamento: "assinatura" | "chave";
  pronto: boolean;
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

export const fetchSkills = () =>
  fetch("/api/skills").then(json<{ skills: Skill[]; acervo: Acervo }>);

export const fetchSkill = (nome: string) =>
  fetch(`/api/skills/${encodeURIComponent(nome)}`).then(json<Skill & { corpo: string }>);

export const salvarSkill = (s: { nome: string; descricao: string; papeis: string[]; corpo: string }) =>
  post("/api/skills", s).then(json<Skill>);

export const apagarSkill = (nome: string) =>
  del(`/api/skills/${encodeURIComponent(nome)}`).then(json<{ ok: true }>);

export const fetchSkillsDoAgente = (id: string) =>
  fetch(`/api/agents/${id}/skills`).then(json<SkillsDoAgente>);

export const salvarSkillsDoAgente = (
  id: string,
  corpo: { skills?: string[]; allowedSkills?: string[] | null },
) => post(`/api/agents/${id}/skills`, corpo).then(json<{ ok: true; skills: string[] }>);

export const fetchReceitas = () =>
  fetch("/api/receitas").then(json<{ receitas: Record<string, Receita> }>);

export const salvarReceita = (id: string, r: Receita) =>
  post("/api/receitas", { id, ...r }).then(json<Receita>);

export const apagarReceita = (id: string) => del(`/api/receitas/${id}`).then(json<{ ok: true }>);

export const aplicarReceita = (id: string) =>
  post(`/api/receitas/${id}/aplicar`, {}).then(json<Partial<Receita> & { receita: string }>);

export const fetchMarketplace = () =>
  fetch("/api/marketplace").then(json<{ fontes: Fonte[]; plugins: PluginAchado[] }>);

export const baixarPlugin = (plugin: string) =>
  post("/api/marketplace/baixar", { plugin }).then(json<PluginAchado>);

export const instalarDoMarketplace = (plugin: string, skill?: string) =>
  post("/api/marketplace/instalar", { plugin, skill }).then(
    json<{ nome?: string; instaladas?: string[]; puladas?: string[] }>,
  );

export const adicionarFonte = (url: string) =>
  post("/api/marketplace/fonte", { url }).then(json<Fonte>);

export const fetchMedia = (rescan = false) =>
  fetch(`/api/media${rescan ? "?rescan=1" : ""}`).then(json<{ provedores: MediaProvider[] }>);

export const salvarChaveMedia = (id: string, chave: string) =>
  post(`/api/media/${id}/chave`, { chave }).then(json<{ ok: true; provedores: MediaProvider[] }>);

export const definirModeloMedia = (id: string, modelo: string) =>
  post(`/api/media/${id}/modelo`, { modelo }).then(json<{ ok: true; provedores: MediaProvider[] }>);

export const gerarMedia = (
  missionId: string,
  corpo: { tipo: string; prompt: string; provedor?: string; modelo?: string; referencia?: string },
) => post(`/api/missions/${missionId}/media`, corpo).then(json<{ arquivo: string; provedor: string; modelo: string | null }>);

export const instalarProvedorMedia = (id: string) =>
  post(`/api/media/${id}/instalar`, {}).then(
    json<{ saida: string; provedores: MediaProvider[] }>,
  );

// ---------------------------------------------------------------------------
// pontes — provedores que são API, não programa (OpenRouter e afins)
// ---------------------------------------------------------------------------

export type ModeloPonte = {
  id: string;
  nome: string;
  contexto: number | null;
  /** Sem ferramentas o modelo não roda um agente: só conversa. */
  ferramentas: boolean;
  gratis: boolean;
};

export type StatusPonte = {
  id: string;
  label: string;
  base: string;
  baseDisponivel: boolean;
  baseUrl: string;
  chaveEnv: string;
  chaveEm: string | null;
  pronto: boolean;
  falta: string | null;
  chaveUrl: string | null;
  modelos: ModeloPonte[];
  modelo: string | null;
  agentes: string[];
  catalogoEm: number | null;
  nota: string | null;
};

export type TestePonte = { ok: boolean; detalhe: string; ms: number; modelo: string };

export const fetchPontes = () => fetch("/api/pontes").then(json<{ pontes: StatusPonte[] }>);

export const salvarChavePonte = (id: string, chave: string) =>
  post(`/api/pontes/${id}/chave`, { chave }).then(json<{ ok: true }>);

export const sincronizarModelosPonte = (id: string) =>
  post(`/api/pontes/${id}/modelos`, {}).then(
    json<{ modelos: ModeloPonte[]; status: StatusPonte }>,
  );

// account pools
export const fetchAccountPools = () =>
  fetch("/api/account-pools").then(json<{ ok: boolean; pools: Record<string, AccountPoolView> }>);

export const resetAccountCooldown = (cli: string, accountId?: string) =>
  post("/api/account-pools/reset-limit", { cli, accountId }).then(json<{ ok: boolean }>);

export const addAccountToPool = (cli: string, account: { id: string; label?: string; env?: Record<string, string> }) =>
  post("/api/account-pools/account", { cli, account }).then(json<{ ok: boolean; pool: AccountPoolView }>);

export const removeAccountFromPool = (cli: string, accountId: string) =>
  del(`/api/account-pools/account?cli=${encodeURIComponent(cli)}&accountId=${encodeURIComponent(accountId)}`).then(json<{ ok: boolean; pool: AccountPoolView }>);


export const testarPonte = (id: string, modelo?: string) =>
  post(`/api/pontes/${id}/testar`, { modelo }).then(json<TestePonte>);

export const definirModeloPonte = (id: string, modelo: string) =>
  post(`/api/pontes/${id}/modelo`, { modelo }).then(json<{ ok: true }>);

export type Janela = { rotulo: string; usadoPct: number; voltaEm: number | null };

export type Cota = {
  cli: string;
  estado: "livre" | "apertado" | "bloqueado" | "desconhecido";
  janelas: Janela[];
  plano: string | null;
  detalhe: string | null;
  fonte: string;
  lidoEm: number;
};

export const fetchCotas = (rescan = false) =>
  fetch(`/api/cotas${rescan ? "?rescan=1" : ""}`).then(json<{ cotas: Cota[] }>);
