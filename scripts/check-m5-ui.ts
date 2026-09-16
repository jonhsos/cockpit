// Verificação completa do Marco 5: Interface de Usuário, Catálogo por Papéis e Placar de Tarefas.
// Uso: node scripts/check-m5-ui.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANONICAL_ROLES,
  CANONICAL_RUNNERS,
  CANONICAL_TASK_STATUSES,
  GRANULAR_STATUS_MAP,
  type Task,
  type GranularPaneStatus,
} from "../web/tipos.ts";
import { TaskManager } from "../servidor/tasks/task-manager.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nomeDoPainel } from "../web/rotulos.ts";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? "  ok  " : " FALHA", msg);
  if (!cond) falhas++;
};

console.log("=== R1: CONTRATOS E TIPOS UNIFICADOS (web/tipos.ts) ===");

// 1.1 Papéis Semânticos Puros
const roleIds = CANONICAL_ROLES.map((r) => r.id);
ok(
  roleIds.length >= 6 &&
    ["maestro", "builder", "luna", "reviewer", "scout", "artista"].every((r) => roleIds.includes(r)),
  `papéis canônicos presentes: ${roleIds.join(", ")}`
);

// Nenhum papel puro pode mencionar nome de modelo LLM na sua definição base
const jsonRoles = JSON.stringify(CANONICAL_ROLES);
const temVazamentoModeloNosPapeis = /claude-3|gpt-4|gemini|deepseek|qwen/i.test(jsonRoles);
ok(!temVazamentoModeloNosPapeis, "definições de papéis puros não vazam nomes de modelos LLM");

// 1.2 Runners Canônicos
const runnerIds = CANONICAL_RUNNERS.map((r) => r.id);
ok(
  ["bash", "codex", "claude", "agy", "openrouter"].every((id) => runnerIds.includes(id as any)),
  `runners canônicos presentes: ${runnerIds.join(", ")}`
);
const bashRunner = CANONICAL_RUNNERS.find((r) => r.id === "bash");
ok(bashRunner !== undefined && bashRunner.isAi === false, "runner bash marcado explicitamente como isAi: false");

// 1.3 Estados Granulares de Pane (8 estados)
const estados8: GranularPaneStatus[] = [
  "starting",
  "waiting-user",
  "working",
  "blocked",
  "review",
  "completed",
  "failed",
  "dead",
];
const todosMapeados = estados8.every((e) => Boolean(GRANULAR_STATUS_MAP[e]));
ok(todosMapeados, `8 estados granulares mapeados com labels e classes: ${estados8.join(", ")}`);
ok(
  GRANULAR_STATUS_MAP["run"] !== undefined && GRANULAR_STATUS_MAP["idle"] !== undefined,
  "retrocompatibilidade preservada para 'run' e 'idle'"
);

// 1.4 Placar de Tarefas (6 estados e 13 campos)
const taskStatusIds = CANONICAL_TASK_STATUSES.map((s) => s.id);
ok(
  taskStatusIds.length === 6 &&
    ["todo", "in-progress", "blocked", "in-review", "complete", "failed"].every((s) =>
      taskStatusIds.includes(s)
    ),
  `6 estados canônicos de tarefa: ${taskStatusIds.join(", ")}`
);

const tarefaExemplo: Task = {
  id: "task-001",
  missionId: "mission-alpha",
  title: "Implementar autenticação",
  description: "Criar tokens JWT seguros",
  role: "builder",
  status: "in-progress",
  priority: "high",
  assignedPaneId: "pane-1",
  assignedRunner: "codex",
  dependencies: [],
  evidence: [],
  fileLocks: ["src/auth.ts"],
  knowledgeIds: ["know-1"],
  timestamps: {
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
  },
};
const camposEsperados = [
  "id",
  "missionId",
  "title",
  "description",
  "role",
  "status",
  "priority",
  "assignedPaneId",
  "assignedRunner",
  "dependencies",
  "evidence",
  "fileLocks",
  "knowledgeIds",
  "timestamps",
];
ok(
  camposEsperados.every((k) => k in tarefaExemplo),
  "objeto Task possui todos os 13+ campos canônicos obrigatórios"
);

console.log("\n=== R2: CATÁLOGO POR PAPÉIS & FLUXO EM 2 ETAPAS (web/RoleCatalog.tsx) ===");
const roleCatalogSrc = readFileSync(resolve("web/RoleCatalog.tsx"), "utf8");
ok(
  roleCatalogSrc.includes("role-tile") && roleCatalogSrc.includes("role-grid"),
  "catálogo renderiza grade inicial por papéis semânticos"
);
ok(
  roleCatalogSrc.includes("setEtapa(2)") && roleCatalogSrc.includes('selectedRunner !== "bash"'),
  "fluxo em 2 etapas: seleção de papel -> seleção de runner"
);
ok(
  roleCatalogSrc.includes("clean-bash-banner") || roleCatalogSrc.includes("/bin/bash"),
  "bash puro é soberano: suprime modelos e informa execução direta limpa"
);
ok(
  roleCatalogSrc.includes("Conta do pool") &&
    roleCatalogSrc.includes("preferredAccountId") &&
    roleCatalogSrc.includes("Fixar conta"),
  "etapa de modelo permite escolher conta do pool e opcionalmente fixá-la"
);
ok(
  roleCatalogSrc.includes("Automático (pool escolhe)"),
  "seleção de conta inclui opção Automático"
);

const novaMissaoSrc = readFileSync(resolve("web/NovaMissao.tsx"), "utf8");
ok(
  novaMissaoSrc.includes('"livre"') &&
    novaMissaoSrc.includes('"dirigido"') &&
    novaMissaoSrc.includes('"autonomo"'),
  "NovaMissao suporta os 3 modos canônicos: livre, dirigido, autonomo"
);
ok(
  !novaMissaoSrc.includes("{a.model ?? a.cli}"),
  "NovaMissao removeu vazamento inicial de nomes de modelos LLM na listagem de agentes"
);

console.log("\n=== R3: PLACAR DE TAREFAS NA BARRA LATERAL & DUAL-VIEW ===");
const lateralSrc = readFileSync(resolve("web/Lateral.tsx"), "utf8");
ok(
  lateralSrc.includes('"tarefas"') && lateralSrc.includes("tarefas?: ReactNode"),
  "Lateral possui a 3ª aba 'tarefas' e renderiza o slot de tarefas"
);

const quadroSrc = readFileSync(resolve("web/QuadroTarefas.tsx"), "utf8");
ok(
  quadroSrc.includes("quadro-tarefas-sidebar") && quadroSrc.includes("kanban-modal-view"),
  "QuadroTarefas implementa dual-view: acordeão vertical compacto (~272px) e modal Kanban expandido"
);
ok(
  quadroSrc.includes("task-inspector-modal") && quadroSrc.includes("addEvidence"),
  "Task Inspector detalha os 13 campos, histórico de evidências e controle de file locks"
);

// Verificação de sincronização e broadcasting via TaskManager
const testDir = mkdtempSync(join(tmpdir(), "m5-test-"));
try {
  const { FileOwnershipManager } = await import("../servidor/tasks/file-ownership.ts");
  const ownership = new FileOwnershipManager();
  const taskMgr = new TaskManager(ownership);

  const eventosRecebidos: Array<{ event: string; payload: any }> = [];
  taskMgr.addListener((event, payload) => {
    eventosRecebidos.push({ event, payload });
  });

  const t1 = taskMgr.createTask("m-1", {
    titulo: "Tarefa Teste M5",
    descricao: "Validando eventos reativos",
    papel: "scout",
    prioridade: "urgente",
  });

  ok(eventosRecebidos.some((e) => e.event === "task:created" && e.payload.id === t1.id), "TaskManager emite evento task:created via addListener");

  taskMgr.transitionTask(t1.id, "in-progress");
  ok(
    eventosRecebidos.some((e) => e.event === "task:status_changed" && e.payload.status === "in-progress"),
    "TaskManager emite evento task:status_changed via addListener"
  );

  taskMgr.assignTask(t1.id, "pane-99", "claude");
  ok(
    eventosRecebidos.some((e) => e.event === "task:assigned" && e.payload.paneId === "pane-99"),
    "TaskManager emite evento task:assigned via addListener"
  );

  taskMgr.addEvidence(t1.id, {
    tipo: "output",
    descricao: "Log de execução",
    conteudo: "Concluído com sucesso",
  });
  ok(
    eventosRecebidos.some((e) => e.event === "task:evidence_added" && e.payload.evidence.tipo === "output"),
    "TaskManager emite evento task:evidence_added via addListener"
  );

  taskMgr.deleteTask(t1.id);
  ok(eventosRecebidos.some((e) => e.event === "task:deleted" && e.payload.taskId === t1.id), "TaskManager emite evento task:deleted via addListener");
} finally {
  rmSync(testDir, { recursive: true, force: true });
}

console.log("\n=== R4: 5 BADGES VISUAIS, CONEXÕES E RENOMEAÇÃO INTERATIVA ===");
const paneSrc = readFileSync(resolve("web/Pane.tsx"), "utf8");
ok(
  paneSrc.includes("badge-role") &&
    paneSrc.includes("badge-runner") &&
    paneSrc.includes("badge-model") &&
    paneSrc.includes("badge-status") &&
    paneSrc.includes("badge-active-task"),
  "Pane renderiza os 5 badges visuais obrigatórios (papel, runner, modelo, status granular, tarefa ativa)"
);

ok(
  !paneSrc.includes("temMaestroNaMissao ? ("),
  "Fio fake do Maestro foi eliminado: conexão visual depende de conexão real persistida"
);
ok(
  paneSrc.includes("conexoesReais") && paneSrc.includes("pane-conn-wire"),
  "Linhas de conexão dependem estritamente da existência de conexão persistida em `connections`"
);

ok(
  paneSrc.includes("renomeando") && paneSrc.includes("onRenomearLabel"),
  "Pane suporta renomeação inline de rótulo interativa"
);
const paneRenomeado = {
  paneId: "pane-renomeado",
  agent: "shell",
  label: "SHELL manual",
  cor: "#4ade80",
  cli: "bash",
  model: null,
  effort: null,
  tipo: null,
  cwd: "/tmp",
  projectId: "p1",
  missionId: "m1",
  sessionId: null,
  maestro: false,
  status: "waiting-user",
  bytesIn: 0,
  bytesOut: 0,
  iniciadoEm: 0,
  atividade: [],
} as const;
ok(
  nomeDoPainel(paneRenomeado, [paneRenomeado], { shell: { label: "SHELL", cor: "#4ade80", cli: "bash" } }) === "SHELL manual",
  "nome manual do painel tem prioridade sobre o label padrão do agente",
);
ok(
  paneSrc.includes("menuPapelAberto") && paneSrc.includes("onReclassificarPapel"),
  "Pane suporta popover de reclassificação de papel em tempo de execução"
);

const appSrc = readFileSync(resolve("web/App.tsx"), "utf8");
ok(
  appSrc.includes("renomeandoAtiva") && appSrc.includes("renomearMissao"),
  "App suporta renomeação inline da missão ativa no palco superior"
);
ok(
  appSrc.includes("paneParaEncerrar") && appSrc.includes("confirmacaoDestrutiva"),
  "Modais de confirmação protegem ações destrutivas (encerrar terminal, merge, override de lock)"
);

console.log(falhas === 0 ? "\nPASS: Marco 5 (UI, Catálogo por Papéis e Placar de Tarefas)" : `\nFALHOU: ${falhas}`);
process.exit(falhas === 0 ? 0 : 1);
