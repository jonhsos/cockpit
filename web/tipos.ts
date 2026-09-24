/**
 * Unified Contracts & Types for Cockpit Frontend (Milestone M5)
 * 
 * Strict decoupling of:
 * - Role: Identidade funcional semântica (Orquestrador, Explorador, Arquiteto, Construtor, Depurador, Revisor, Verificador, Finalizador)
 * - Runner: Execution harness (bash, codex, claude, agy, openrouter)
 * - Model: LLM configuration / combo
 * - Pane: Sovereign live PTY process
 * - Connection: Real persisted inter-pane link
 * - Task: Structured work unit (13 canonical fields, 6 formal states)
 * - Handoff: Inter-agent contextual transfer
 */

import type {
  Usage,
  PaneState as ApiPaneState,
  Project,
  Mission as ApiMission,
  AgentSpec,
  SquadSpec,
  Provider,
  AccountPoolItemView,
  AccountPoolView,
  Elenco,
  Nota,
  No,
} from "./api.ts";

export type {
  Usage,
  Project,
  AgentSpec,
  SquadSpec,
  Provider,
  AccountPoolItemView,
  AccountPoolView,
  Elenco,
  Nota,
  No,
};

// ============================================================================
// 1. Roles & Catalog
// ============================================================================

export interface RoleDefinition {
  id: string;
  label: string;
  color: string;
  category: "coordenacao" | "engenharia" | "design" | "qualidade" | "pesquisa" | "midia" | "custom";
  description: string;
  icon: string;
  baseAgent?: string;
  outcome: string;
  owns: string[];
  doesNotOwn: string[];
  qualityGates: string[];
  deliverables: string[];
  incorporates?: string[];
  primary?: boolean;
  systemPrompt?: string;
  suggestedRunners?: RunnerId[];
}

export const CANONICAL_ROLES: RoleDefinition[] = [
  {
    id: "maestro",
    label: "Orquestrador",
    color: "#00b4ff",
    category: "coordenacao",
    description: "Entende o objetivo, escolhe o fluxo mínimo necessário e coordena as funções certas na ordem certa. Não executa o trabalho de outra função.",
    icon: "team",
    outcome: "Uma missão organizada, com fluxo proporcional ao risco, responsáveis claros e evidências de progresso.",
    owns: ["entender o objetivo", "decidir o fluxo", "delegar por competência", "evitar agentes desnecessários", "acompanhar bloqueios", "validar handoffs"],
    doesNotOwn: [
      "implementar o trabalho principal",
      "editar arquivos por conta própria",
      "trocar o contrato de outro papel",
      "declarar sucesso sem evidência",
      "fazer polling repetido ou checagens contínuas enquanto especialistas trabalham (aguardar notificação passiva)",
    ],
    qualityGates: ["cada etapa tem escopo e critério de aceite", "a ordem respeita dependências", "bloqueios e decisões ficam registrados", "a síntese final cita evidências"],
    deliverables: ["fluxo de execução", "delegações autossuficientes", "checkpoints", "decisões e bloqueios", "síntese de resultados"],
    incorporates: ["Orquestrador", "Planejador"],
    primary: true,
    suggestedRunners: ["claude", "codex", "agy", "bash"],
  },
  {
    id: "builder",
    label: "Construtor",
    color: "#4fb286",
    category: "engenharia",
    description: "Executa o trabalho principal: implementa, integra e entrega o artefato solicitado respeitando o contexto e os contratos existentes.",
    icon: "code",
    outcome: "Um resultado funcional e integrado, com mudanças rastreáveis e validação reproduzível.",
    owns: ["implementar mudanças", "corrigir defeitos conhecidos", "integrar partes", "preservar contratos", "executar verificações relevantes", "explicar decisões técnicas"],
    doesNotOwn: ["redesenhar o produto sem pedido", "alterar arquivos fora do escopo", "ignorar falhas de validação", "substituir revisão independente"],
    qualityGates: ["diff mínimo e coerente", "integração preserva interfaces", "testes ou verificação equivalente executados", "erros e limitações declarados"],
    deliverables: ["arquivos ou artefatos alterados", "integrações concluídas", "testes e validações", "resumo técnico", "riscos remanescentes"],
    incorporates: ["Construtor / Executor", "Integrador"],
    primary: true,
    suggestedRunners: ["codex", "claude", "agy", "bash"],
  },
  {
    id: "architect",
    label: "Arquiteto",
    color: "#b58cff",
    category: "engenharia",
    description: "Transforma contexto em uma solução organizada, definindo fronteiras, interfaces, dependências, riscos e critérios de aceite.",
    icon: "layers",
    baseAgent: "builder",
    outcome: "Um desenho implementável, proporcional ao problema e alinhado aos contratos existentes.",
    owns: ["decompor o problema", "definir componentes e fronteiras", "decidir interfaces", "explicitar trade-offs", "definir critérios de aceite", "antecipar riscos"],
    doesNotOwn: ["implementar toda a solução", "inventar requisitos", "reescrever o sistema sem necessidade", "substituir evidência por preferência pessoal"],
    qualityGates: ["cada decisão tem justificativa", "dependências e impactos estão explícitos", "o plano pode ser executado por outro agente", "há caminho de verificação"],
    deliverables: ["decisão arquitetural", "plano de etapas", "interfaces e fronteiras", "critérios de aceite", "riscos e alternativas"],
    incorporates: ["Arquiteto", "Planejador"],
    primary: true,
    suggestedRunners: ["codex", "claude", "agy", "bash"],
  },
  {
    id: "debugger",
    label: "Depurador",
    color: "#f08a5d",
    category: "qualidade",
    description: "Investiga falhas de forma causal: reproduz o comportamento, isola a origem, propõe a menor correção e comprova o reparo.",
    icon: "bug",
    baseAgent: "builder",
    outcome: "Uma causa raiz identificada e uma correção comprovada sem mascarar sintomas ou ampliar o escopo.",
    owns: ["reproduzir a falha", "coletar sinais", "formular hipóteses", "isolar a causa raiz", "aplicar ou orientar a correção", "validar a regressão"],
    doesNotOwn: ["alterar código sem reprodução ou hipótese", "tratar sintoma como causa", "ampliar o escopo sem autorização", "declarar correção sem cenário de falha e sucesso"],
    qualityGates: ["o problema é reproduzível ou a limitação é declarada", "a causa é distinguida do sintoma", "a correção é mínima", "o caso original e os casos adjacentes são verificados"],
    deliverables: ["passo de reprodução", "causa raiz", "correção ou recomendação", "evidências antes/depois", "riscos de regressão"],
    incorporates: ["Depurador", "Especialista"],
    primary: true,
    suggestedRunners: ["codex", "claude", "agy", "bash"],
  },
  {
    id: "verifier",
    label: "Verificador",
    color: "#39c0ba",
    category: "qualidade",
    description: "Confirma de forma independente se o resultado atende ao objetivo, aos critérios de aceite e aos cenários importantes.",
    icon: "check",
    baseAgent: "builder",
    outcome: "Um veredito sustentado por testes e evidências, incluindo o que foi e o que não foi comprovado.",
    owns: ["ler o pedido original", "definir cenários de aceitação", "executar testes", "tentar quebrar o resultado", "comparar promessa e realidade", "registrar limitações"],
    doesNotOwn: ["corrigir silenciosamente o trabalho", "aprovar sem executar verificação", "confundir compilação com atendimento do objetivo", "omitir falhas por conveniência"],
    qualityGates: ["o objetivo original é coberto", "casos felizes e adversariais são tentados", "evidências são reproduzíveis", "falhas e lacunas ficam explícitas"],
    deliverables: ["matriz de aceitação", "testes executados", "evidências", "falhas encontradas", "veredito e limitações"],
    incorporates: ["Verificador", "Testador", "Auditor"],
    primary: true,
    suggestedRunners: ["codex", "claude", "agy", "bash"],
  },
  {
    id: "finalizer",
    label: "Finalizador",
    color: "#e1b84c",
    category: "coordenacao",
    description: "Fecha o ciclo com disciplina: organiza a entrega, registra decisões essenciais e apresenta claramente o estado final.",
    icon: "flag",
    baseAgent: "builder",
    outcome: "Uma entrega limpa, rastreável e compreensível, sem resíduos ou promessas não comprovadas.",
    owns: ["conferir o estado final", "organizar artefatos", "remover resíduos permitidos", "registrar decisões", "documentar uso e limitações", "apresentar a entrega"],
    doesNotOwn: ["esconder falhas", "remover arquivos sem autorização", "alterar o escopo no fechamento", "declarar concluído o que não foi verificado"],
    qualityGates: ["a entrega corresponde ao pedido", "arquivos temporários são tratados com segurança", "documentação não promete além das evidências", "o estado final é explícito"],
    deliverables: ["entrega organizada", "resumo final", "documentação essencial", "evidências e limitações", "próximos passos"],
    incorporates: ["Finalizador", "Documentador"],
    primary: true,
    suggestedRunners: ["claude", "codex", "agy", "bash"],
  },
  {
    id: "luna",
    label: "Especialista de UX",
    color: "#e2703a",
    category: "design",
    description: "Arquitetura de interface, design de interação, acessibilidade, CSS refinado e polimento visual.",
    icon: "sparkles",
    baseAgent: "builder",
    outcome: "Uma experiência de interface clara, acessível, responsiva e coerente com o produto.",
    owns: ["hierarquia visual", "fluxos e estados", "microcopy de interface", "acessibilidade", "responsividade", "polimento no código da UI"],
    doesNotOwn: ["inventar regra de negócio", "alterar backend sem necessidade", "entregar mockup no lugar da implementação", "escolher modelo ou provedor"],
    qualityGates: ["fluxo principal é compreensível sem explicação", "estados vazio, carregando, erro e sucesso existem", "teclado, foco e contraste foram considerados", "desktop e mobile não quebram"],
    deliverables: ["decisão de composição", "componentes/estilos implementados", "estados de interface", "notas de acessibilidade"],
    incorporates: ["Especialista de UX"],
    suggestedRunners: ["claude", "codex", "agy", "bash"],
  },
  {
    id: "reviewer",
    label: "Revisor",
    color: "#9d7bd8",
    category: "qualidade",
    description: "Analisa o trabalho produzido com independência, procurando erros, regressões, desvios arquiteturais e riscos de segurança.",
    icon: "check-shield",
    outcome: "Um relatório independente e priorizado, com evidências para corrigir problemas reais antes da entrega.",
    owns: ["ler diff e contexto", "procurar regressões", "avaliar arquitetura", "avaliar segurança", "conferir testes", "priorizar severidade"],
    doesNotOwn: ["editar produção durante a revisão", "aprovar por simpatia", "inventar falhas sem evidência", "assumir que teste verde prova tudo"],
    qualityGates: ["cada achado tem localização", "impacto e reprodução são descritos", "falsos positivos são descartados", "o escopo revisado é declarado"],
    deliverables: ["achados por severidade", "evidências arquivo:linha", "lacunas de teste", "riscos de segurança", "veredito de risco"],
    incorporates: ["Revisor", "Revisor de Segurança"],
    primary: true,
    suggestedRunners: ["claude", "codex", "bash"],
  },
  {
    id: "scout",
    label: "Explorador",
    color: "#4a9fd8",
    category: "pesquisa",
    description: "Investiga o ambiente antes de agir: repositório, documentos, dependências, fontes externas e sinais do problema.",
    icon: "search",
    baseAgent: "builder",
    outcome: "Um mapa confiável do contexto, das evidências e das incertezas, sem alterações indevidas.",
    owns: ["localizar arquivos e fontes", "seguir dependências", "comparar padrões", "reproduzir diagnóstico sem editar", "pesquisar referências atuais", "registrar incertezas"],
    doesNotOwn: ["modificar arquivos", "executar comandos destrutivos", "prescrever implementação sem evidência", "fingir que pesquisou uma fonte"],
    qualityGates: ["fatos, hipóteses e lacunas são separados", "caminhos e fontes são citados", "a investigação é reproduzível", "nenhuma alteração fica no working tree"],
    deliverables: ["mapa do ambiente", "fontes e caminhos relevantes", "causa ou hipótese provável", "evidências", "próximos passos"],
    incorporates: ["Explorador", "Pesquisador"],
    primary: true,
    suggestedRunners: ["codex", "claude", "agy", "bash"],
  },
  {
    id: "artista",
    label: "Artista",
    color: "#d9a441",
    category: "midia",
    description: "Geração de ativos visuais, ilustrações, ícones, mockups e mídia para a aplicação.",
    icon: "media",
    outcome: "Arquivos de mídia utilizáveis no produto, com caminho, dimensões e finalidade documentados.",
    owns: ["planejar o ativo", "gerar ou editar mídia", "inspecionar o resultado", "iterar quando necessário", "salvar no diretório pedido"],
    doesNotOwn: ["desenhar a interface em código", "decidir layout do produto", "alterar lógica da aplicação", "entregar apenas uma descrição quando foi pedido um arquivo"],
    qualityGates: ["arquivo existe e abre", "dimensões e formato são informados", "o ativo atende ao briefing", "limitações de geração são declaradas"],
    deliverables: ["arquivo final", "caminho do arquivo", "dimensões e formato", "descrição de uso"],
    incorporates: ["Especialista de mídia"],
    suggestedRunners: ["agy", "openrouter"],
  },
];

const PRIMARY_ROLE_IDS = ["maestro", "scout", "architect", "builder", "debugger", "reviewer", "verifier", "finalizer"];
export const PRIMARY_ROLES = PRIMARY_ROLE_IDS
  .map((id) => CANONICAL_ROLES.find((role) => role.id === id))
  .filter((role): role is RoleDefinition => Boolean(role));
export const AUXILIARY_ROLES = CANONICAL_ROLES.filter((role) => !role.primary);
export const CATALOG_ROLES = [...PRIMARY_ROLES, ...AUXILIARY_ROLES];

// ============================================================================
// 2. Runners & Models
// ============================================================================

/** Inclui executores cadastrados pelo usuário, como APIs diretas do DSH. */
export type RunnerId = string;

export interface RunnerOption {
  id: RunnerId;
  label: string;
  badge: string;
  description: string;
  installed: boolean;
  isAi: boolean;
  icon: string;
}

export const CANONICAL_RUNNERS: RunnerOption[] = [
  {
    id: "bash",
    label: "SHELL Limpo",
    badge: "Soberano · /bin/bash -i -l",
    description: "Terminal Linux vazio e isolado. Sem injeção de prompt, sem LLM no boot. Você comanda manualmente com soberania total.",
    installed: true,
    isAi: false,
    icon: "terminal",
  },
  {
    id: "codex",
    label: "Codex CLI",
    badge: "CLI Host",
    description: "Execução via CLI oficial do OpenAI Codex no host.",
    installed: true,
    isAi: true,
    icon: "codex",
  },
  {
    id: "claude",
    label: "Claude Code",
    badge: "CLI Host",
    description: "Execução via CLI oficial do Anthropic Claude Code no host.",
    installed: true,
    isAi: true,
    icon: "claude",
  },
  {
    id: "agy",
    label: "Antigravity",
    badge: "CLI Host",
    description: "Execução via CLI do Google Gemini / Antigravity no host.",
    installed: true,
    isAi: true,
    icon: "gemini",
  },
  {
    id: "grok",
    label: "Grok",
    badge: "CLI Host",
    description: "Execução via CLI oficial do Grok (xAI) no host.",
    installed: true,
    isAi: true,
    icon: "terminal",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    badge: "Ponte Multi-Modelo",
    description: "Execução de modelos abertos e proprietários via chave OpenRouter.",
    installed: true,
    isAi: true,
    icon: "network",
  },
];

export interface ModelOption {
  id: string;
  label: string;
  provider: RunnerId | string;
  effortSupport?: boolean;
  description?: string;
  gratis?: boolean;
}

// ============================================================================
// 3. Granular Pane States (8 States Machine)
// ============================================================================

export type GranularPaneStatus =
  | "starting"
  | "waiting-user"
  | "working"
  | "blocked"
  | "review"
  | "completed"
  | "failed"
  | "dead"
  | "run"   // Backward compatibility
  | "idle";  // Backward compatibility

export interface GranularStatusInfo {
  status: GranularPaneStatus;
  label: string;
  color: string;
  icon: string;
  description: string;
}

export const GRANULAR_STATUS_MAP: Record<GranularPaneStatus, GranularStatusInfo> = {
  starting: {
    status: "starting",
    label: "Iniciando",
    color: "#e3b341",
    icon: "dots",
    description: "Iniciando processo e daemon PTY...",
  },
  "waiting-user": {
    status: "waiting-user",
    label: "Aguardando",
    color: "#58a6ff",
    icon: "user",
    description: "Aguardando interação ou comando do usuário",
  },
  working: {
    status: "working",
    label: "Executando",
    color: "#3fb950",
    icon: "play",
    description: "Executando tarefas ativas no terminal",
  },
  blocked: {
    status: "blocked",
    label: "Bloqueado",
    color: "#f85149",
    icon: "alert",
    description: "Processo impedido por conflito de lock, cota ou dependência",
  },
  review: {
    status: "review",
    label: "Revisão",
    color: "#bc8cff",
    icon: "eye",
    description: "Aguardando revisão ou validação de entregas",
  },
  completed: {
    status: "completed",
    label: "Concluído",
    color: "#2ea043",
    icon: "check",
    description: "Trabalho finalizado com sucesso",
  },
  failed: {
    status: "failed",
    label: "Falha",
    color: "#da3633",
    icon: "close",
    description: "Processo encerrou com código de erro diferente de zero",
  },
  dead: {
    status: "dead",
    label: "Encerrado",
    color: "#8b949e",
    icon: "square",
    description: "Terminal desconectado ou finalizado",
  },
  run: {
    status: "run",
    label: "Ativo",
    color: "#3fb950",
    icon: "play",
    description: "Executando",
  },
  idle: {
    status: "idle",
    label: "Ocioso",
    color: "#8b949e",
    icon: "pause",
    description: "Sem atividade recente",
  },
};

export interface PaneState extends ApiPaneState {
  role?: string;
  runner?: string;
  activeTaskId?: string | null;
}

// ============================================================================
// 4. Task Entity & Formal 6-State Machine (R6)
// ============================================================================

export type TaskStatus =
  | "todo"
  | "in-progress"
  | "blocked"
  | "in-review"
  | "complete"
  | "failed";

export const CANONICAL_TASK_STATUSES: { id: TaskStatus; label: string; color: string; icon: string }[] = [
  { id: "todo", label: "A Fazer", color: "#8b949e", icon: "circle" },
  { id: "in-progress", label: "Em Andamento", color: "#58a6ff", icon: "play" },
  { id: "blocked", label: "Bloqueado", color: "#f85149", icon: "alert" },
  { id: "in-review", label: "Em Revisão", color: "#bc8cff", icon: "eye" },
  { id: "complete", label: "Concluído", color: "#3fb950", icon: "check" },
  { id: "failed", label: "Falhou", color: "#da3633", icon: "close" },
];

export type TaskPriority =
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "baixa"
  | "normal"
  | "alta"
  | "urgente";

export type EvidenceType =
  | "diff"
  | "test_run"
  | "test"
  | "log"
  | "note"
  | "artifact"
  | "knowledge"
  | "handoff";

export interface TaskEvidence {
  id: string;
  tipo: EvidenceType;
  descricao: string;
  caminho?: string;
  conteudo?: string;
  diff?: string;
  status?: "passed" | "failed";
  autor?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface TaskTimestamps {
  criadaEm: number;
  iniciadaEm?: number;
  concluidaEm?: number;
  atualizadaEm: number;
}

/**
 * Canonical 13-field Task Entity
 */
export interface Task {
  id: string;                          // 1. id
  título: string;                      // 2. título
  descrição: string;                   // 3. descrição
  responsável: string | null;          // 4. responsável (agent, pane, or user)
  papel: string | null;                // 5. papel (role decoupled from runner/model)
  pane: string | null;                 // 6. pane (assigned live PTY paneId)
  "arquivos permitidos": string[];     // 7. arquivos permitidos (scoped files)
  dependências: string[];              // 8. dependências (prerequisite task IDs)
  prioridade: TaskPriority;            // 9. prioridade
  status: TaskStatus;                  // 10. status (6-state machine)
  evidências: TaskEvidence[];          // 11. evidências
  resultado: string | null;            // 12. resultado (outcome or failure reason)
  timestamps: TaskTimestamps;          // 13. timestamps
  missionId: string;                   // Mission scoping identifier
}

export interface CreateTaskParams {
  id?: string;
  título?: string;
  titulo?: string;
  descrição?: string;
  descricao?: string;
  responsável?: string | null;
  responsavel?: string | null;
  papel?: string | null;
  pane?: string | null;
  "arquivos permitidos"?: string[];
  arquivosPermitidos?: string[];
  dependências?: string[];
  dependencias?: string[];
  prioridade?: TaskPriority;
  status?: TaskStatus;
  evidências?: TaskEvidence[];
  evidencias?: TaskEvidence[];
  resultado?: string | null;
  missionId?: string;
}

export interface UpdateTaskParams {
  título?: string;
  titulo?: string;
  descrição?: string;
  descricao?: string;
  responsável?: string | null;
  responsavel?: string | null;
  papel?: string | null;
  pane?: string | null;
  "arquivos permitidos"?: string[];
  arquivosPermitidos?: string[];
  dependências?: string[];
  dependencias?: string[];
  prioridade?: TaskPriority;
  resultado?: string | null;
  status?: TaskStatus;
}

export interface TaskBoardData {
  missionId: string;
  todo: Task[];
  "in-progress": Task[];
  blocked: Task[];
  "in-review": Task[];
  complete: Task[];
  failed: Task[];
  total: number;
}

// ============================================================================
// 5. File Ownership & Locks (R7)
// ============================================================================

export type FileOwnershipMode = "shared" | "isolated";
export type LockMode = "shared" | "isolated";

export interface FileLock {
  id: string;
  file: string;
  filePath?: string;
  missionId: string;
  taskId: string;
  paneId: string | null;
  owner: string;
  mode: FileOwnershipMode;
  acquiredAt: number;
}

export interface LockResult {
  ok: boolean;
  locked: boolean;
  mode: LockMode;
  conflictFiles?: string[];
  conflictLocks?: FileLock[];
  warning?: string;
  message?: string;
}

// ============================================================================
// 6. Connections & Handoffs (R5)
// ============================================================================

export type ConnectionStatus = "active" | "paused" | "closed";

export interface Connection {
  id: string;
  missionId: string;
  sourcePaneId: string;
  targetPaneId: string;
  criadaEm: number;
  status: ConnectionStatus;
  config?: {
    allowAsk?: boolean;
    allowReply?: boolean;
    allowHandoff?: boolean;
    metadata?: Record<string, unknown>;
  };
}

export type HandoffStatus = "pending" | "accepted" | "rejected" | "completed";

export interface Handoff {
  id: string;
  missionId: string;
  sourcePaneId: string;
  targetPaneId: string;
  taskId: string;
  context: string;
  dependencies: string[];
  evidenceIds: string[];
  timestamp: number;
  status: HandoffStatus;
}

export type MailboxMessageType = "ask" | "reply" | "handoff" | "notification";
export type MessageStatus = "unread" | "read";

export interface MailboxMessage {
  id: string;
  from: string;
  to: string;
  type: MailboxMessageType;
  correlationId?: string;
  taskId?: string;
  task?: string;
  result?: string;
  evidence?: TaskEvidence[] | unknown[];
  status: MessageStatus;
  timestamp: number;
  missionId: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 7. Missions & Modes (R8)
// ============================================================================

export type MissionMode = "livre" | "dirigido" | "autonomo";

export interface Mission extends ApiMission {
  modo?: MissionMode;
  ownershipMode?: FileOwnershipMode;
}
