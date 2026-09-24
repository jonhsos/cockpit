/**
 * Servidor MCP (stdio) de cada painel da missão — Maestro e especialistas.
 * Orquestração pesada (delegar, marketplace) só no Maestro.
 * Comunicação entre painéis (list/ask/inbox/reply) em todos.
 */
import { createInterface } from "node:readline";

const PORTA = process.env.COCKPIT_PORT ?? "3000";
const MISSAO = process.env.COCKPIT_MISSION ?? "";
const PROJETO = process.env.COCKPIT_PROJECT ?? "";
const EU = process.env.COCKPIT_AGENT ?? "maestro";
const EU_PANE = process.env.COCKPIT_PANE ?? "";
const SOU_MAESTRO = process.env.COCKPIT_MAESTRO === "1";
const QUEM = EU_PANE || EU;

const base = `http://127.0.0.1:${PORTA}`;

async function api(caminho: string, corpo?: unknown): Promise<unknown> {
  const res = await fetch(base + caminho, {
    method: corpo ? "POST" : "GET",
    headers: corpo ? { "content-type": "application/json" } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(dados.error ?? res.statusText);
  return dados;
}

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, string>) => Promise<string>;
  /** Só o painel Maestro enxerga: evita scout/revisor saírem orquestrando. */
  maestroOnly?: boolean;
};

const texto = (v: unknown) => JSON.stringify(v, null, 2);

const TOOLS: Tool[] = [
  {
    maestroOnly: true,
    name: "checkpoint",
    description: "Salva o resumo de continuidade da missão após cada etapa: objetivo, decisões, progresso, arquivos alterados, tarefas delegadas, testes e próximos passos. Permite que outro provedor continue sem recomeçar.",
    inputSchema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"], additionalProperties: false },
    run: async (args) => texto(await api(`/api/missions/${MISSAO}/checkpoint`, { texto: args.texto })),
  },
  {
    maestroOnly: true,
    name: "listar_especialistas",
    description:
      "Lista os especialistas reais abertos ou disponíveis para delegação nas janelas desta missão, com seus papéis, provedores e modelos. NUNCA crie subagentes internos do seu próprio CLI: delegue sempre para estes especialistas da missão via 'delegar' ou 'cockpit_ask'. Chame antes de delegar.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => texto(await api(`/api/missions/${MISSAO}/elenco`)),
  },
  {
    maestroOnly: true,
    name: "tipos_de_tarefa",
    description:
      "Lista os tipos de tarefa do harness. Tipo descreve e organiza trabalho; não escolhe modelo, esforço ou provedor. Quem delega escolhe o agente, e o perfil daquele agente é preservado.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const cfg = (await api("/api/config")) as { tarefas: Record<string, unknown> };
      return texto(cfg.tarefas);
    },
  },
  {
    maestroOnly: true,
    name: "delegar",
    description:
      "Entrega uma tarefa a um especialista JÁ ABERTO nesta missão (EXPLORADOR, REVISOR, CONSTRUTOR, VERIFICADOR, etc.), colando o texto no terminal dele. Esta é a ferramenta oficial de delegação do Cockpit. REGRA OBRIGATÓRIA: NUNCA utilize subagentes do seu próprio CLI (como define_subagent, invoke_subagent); delegue SEMPRE através desta ferramenta para os painéis reais abertos no Cockpit. Só abre painel novo se aquele papel ainda não existir e a missão permitir. Não use cockpit_ask no lugar disto: ask sozinho não acorda o CLI. A tarefa deve ser autossuficiente. Após delegar, NÃO faça polling nem fique enviando mensagens repetidas de checagem. Aguarde em silêncio: o Cockpit acordará você automaticamente com a entrega completa assim que o especialista terminar. Se a resposta disser deliveredToTerminal=false, o alvo está ocupado — espere situacao e chame de novo.",
    inputSchema: {
      type: "object",
      properties: {
        agente: { type: "string", description: "id, rótulo ou papel: scout, EXPLORADOR, reviewer, p3-…" },
        tarefa: { type: "string", description: "instrução completa e autossuficiente" },
        skills: {
          type: "array",
          items: { type: "string" },
          description:
            "skills que este especialista deve carregar, pelo nome. Veja listar_skills. Ele recebe o índice delas e lê o arquivo quando for do assunto.",
        },
        tipo: {
          type: "string",
          description:
            "tipo da tarefa: mecanico, explorar, implementar, site, arquitetura, auditoria, visual ou volume. Opcional.",
        },
        provedor: {
          type: "string",
          description:
            "provedor em que este especialista deve rodar: claude, codex (GPT) ou agy (Gemini). Use para alternar Claude e GPT de propósito — o mesmo trabalho visto por dois modelos diferentes. Só vale se estiver no elenco da missão; fora dele o cockpit troca pelo provedor liberado.",
        },
      },
      required: ["agente", "tarefa"],
      additionalProperties: false,
    },
    run: async (a) => {
      const skills = Array.isArray(a.skills) ? (a.skills as unknown as string[]) : [];
      const r = (await api(`/api/missions/${MISSAO}/delegar`, {
        agent: a.agente,
        tarefa: a.tarefa,
        tipo: a.tipo,
        provedor: a.provedor,
        skills,
      })) as {
        paneId: string;
        label: string;
        cli: string;
        skills?: string[];
        deliveredToTerminal?: boolean;
        queued?: boolean;
        reason?: string;
        dispatchedToExisting?: boolean;
      };
      const comSkills = r.skills?.length ? ` Carregou: ${r.skills.join(", ")}.` : "";
      if (r.queued && r.deliveredToTerminal === false) {
        return `NÃO entregue no terminal. ${r.reason ?? "Painel ocupado."} Painel ${r.paneId} (${r.label}).`;
      }
      const onde = r.dispatchedToExisting ? "no painel existente" : "em painel novo";
      const cola = r.deliveredToTerminal === false ? " Inbox só — o texto NÃO foi colado no terminal." : " Texto colado no terminal.";
      return `Tarefa entregue ${onde}: ${r.paneId} ${r.label} (${r.cli}).${cola}${comSkills}`;
    },
  },
  {
    name: "situacao",
    description:
      "Mostra cada painel: status real (waiting-user = parado no prompt e pode receber delegar; working com tarefa = ocupado de verdade), se aceita tarefa agora, mensagens não lidas na inbox e tarefa ativa. Use depois de delegar para confirmar entrega.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const list = (await api(`/api/missions/${MISSAO}/cockpit/list`)) as {
        panes: {
          id: string;
          label: string;
          role: string;
          runner: string;
          status: string;
          activeTaskId?: string | null;
          inboxCount?: number;
          isBusy?: boolean;
          canAcceptTask?: boolean;
        }[];
      };
      const r = (await api(`/api/panes?missionId=${MISSAO}`)) as {
        panes: {
          paneId: string;
          label: string;
          cli: string;
          status: string;
          tarefa?: string;
          saida_recente?: string;
          usage?: { custo: number };
        }[];
      };
      const extra = new Map(list.panes.map((p) => [p.id, p]));
      return texto(
        r.panes.map((p) => {
          const c = extra.get(p.paneId);
          const ocupado = c?.isBusy === true || ((p.status === "run" || p.status === "working") && Boolean(c?.activeTaskId));
          return {
            painel: p.paneId,
            funcao: p.label,
            papel: c?.role,
            terminal: p.cli,
            status: p.status,
            estado: ocupado ? "ocupado" : p.status === "starting" ? "inicializando" : "pronto_no_prompt",
            aceita_delegar: c?.canAcceptTask === true,
            tarefa_ativa: c?.activeTaskId ?? p.tarefa ?? undefined,
            inbox_nao_lida: c?.inboxCount ?? 0,
            entrega_recente: p.saida_recente ?? undefined,
            custo: p.usage?.custo ?? 0,
          };
        }),
      );
    },
  },
  {
    name: "ler_resultado",
    description:
      "Lê o relatório completo ou a saída do terminal de um especialista da missão (ex: 'builder', 'scout' ou pelo ID do painel). Chame para obter os dados detalhados do que o especialista produziu, descobriu ou modificou.",
    inputSchema: {
      type: "object",
      properties: {
        painel: {
          type: "string",
          description: "ID do painel ou nome/papel do especialista (ex: 'scout', 'builder')",
        },
      },
      required: ["painel"],
      additionalProperties: false,
    },
    run: async (a) => {
      const r = (await api(`/api/missions/${MISSAO}/resultado/${encodeURIComponent(a.painel)}`)) as {
        agente: string;
        saida: string;
      };
      return `=== RESULTADO DE ${r.agente} ===\n${r.saida || "(sem saída registrada)"}`;
    },
  },
  {
    name: "anotar",
    description:
      "Grava um fato na memória compartilhada do projeto. Todo agente que abrir depois — nesta missão ou em qualquer outra do mesmo projeto — recebe essa anotação. Use para decisões, convenções e armadilhas do código. Não use para status ou log de progresso. NUNCA anote orientações para usar subagentes do CLI (como invoke_subagent), pois no Cockpit a orquestração ocorre exclusivamente através dos painéis abertos.",
    inputSchema: {
      type: "object",
      properties: { texto: { type: "string", description: "o fato, em uma ou duas frases" } },
      required: ["texto"],
      additionalProperties: false,
    },
    run: async (a) => {
      await api(`/api/projects/${PROJETO}/memoria`, { quem: EU, texto: a.texto });
      return "Anotado na memória do projeto.";
    },
  },
  {
    name: "lembrar",
    description:
      "Lê a memória compartilhada do projeto. As anotações já entram no seu prompt inicial; use isto para reler durante a conversa.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => texto(await api(`/api/projects/${PROJETO}/memoria`)),
  },

  // ---------- skills ----------
  {
    name: "listar_skills",
    description:
      "Lista as skills do acervo: nome, para que serve e o arquivo de cada uma. Skills são instruções que mudam como um agente trabalha. Use antes de delegar, para passar a skill certa a quem for executar.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const r = (await api("/api/skills")) as { skills: { nome: string; descricao: string; caminho: string }[] };
      return texto(r.skills.map((s) => ({ nome: s.nome, descricao: s.descricao, arquivo: s.caminho })));
    },
  },
  {
    name: "ler_skill",
    description:
      "Lê o conteúdo inteiro de uma skill. Chame quando a tarefa for do assunto dela — não leia todas por precaução.",
    inputSchema: {
      type: "object",
      properties: { nome: { type: "string" } },
      required: ["nome"],
      additionalProperties: false,
    },
    run: async (a) => {
      const r = (await api(`/api/skills/${encodeURIComponent(a.nome)}`)) as { corpo: string };
      return r.corpo;
    },
  },

  // ---------- receitas ----------
  {
    name: "listar_receitas",
    description:
      "Lista as receitas: formações prontas de agente + skills + modelo + esforço já provadas para um tipo de objetivo. Use para montar o time sem escolher peça por peça.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => texto(await api("/api/receitas")),
  },
  {
    maestroOnly: true,
    name: "salvar_receita",
    description:
      "Guarda a formação que funcionou nesta missão como receita reutilizável. Passe só o que importa fixar.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        label: { type: "string" },
        descricao: { type: "string" },
        agent: { type: "string" },
        tipo: { type: "string" },
        model: { type: "string" },
        effort: { type: "string" },
        squad: { type: "string" },
      },
      required: ["id", "label", "descricao"],
      additionalProperties: false,
    },
    run: async (a) => texto(await api("/api/receitas", a)),
  },

  // ---------- media ----------
  {
    name: "provedores_de_media",
    description:
      "Lista quem pode gerar imagem, vídeo e áudio agora, e o que falta nos que não estão prontos. Chame antes de gerar: provedor sem chave falha.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => texto(await api("/api/media")),
  },
  {
    name: "gerar_imagem",
    description:
      "Gera uma imagem a partir de um prompt e salva na pasta media/ da missão. Passe `referencia` com o caminho de uma imagem para editar em vez de criar do zero. Devolve o caminho do arquivo.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        provedor: { type: "string" },
        modelo: { type: "string" },
        referencia: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    run: async (a) => texto(await api(`/api/missions/${MISSAO}/media`, { tipo: "image", ...a })),
  },
  {
    name: "gerar_video",
    description:
      "Gera um vídeo a partir de um prompt e salva na pasta media/ da missão. Passe `referencia` para animar uma imagem. Pode levar minutos. Devolve o caminho do arquivo.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        provedor: { type: "string" },
        modelo: { type: "string" },
        referencia: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    run: async (a) => texto(await api(`/api/missions/${MISSAO}/media`, { tipo: "video", ...a })),
  },
  {
    name: "gerar_audio",
    description:
      "Gera áudio (fala ou som) a partir de um texto e salva na pasta media/ da missão. Devolve o caminho do arquivo.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        provedor: { type: "string" },
        modelo: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    run: async (a) => texto(await api(`/api/missions/${MISSAO}/media`, { tipo: "audio", ...a })),
  },

  // ---------- marketplace ----------
  {
    maestroOnly: true,
    name: "procurar_no_marketplace",
    description:
      "Procura skills e MCPs nos marketplaces conectados. Passe `busca` para filtrar por nome ou descrição.",
    inputSchema: {
      type: "object",
      properties: { busca: { type: "string" } },
      additionalProperties: false,
    },
    run: async (a) => {
      const r = (await api("/api/marketplace")) as {
        plugins: { id: string; descricao: string; skills: { nome: string; descricao: string; instalada: boolean }[] }[];
      };
      const alvo = (a.busca ?? "").toLowerCase();
      const achados = alvo
        ? r.plugins.filter((p) =>
            `${p.id} ${p.descricao} ${p.skills.map((s) => `${s.nome} ${s.descricao}`).join(" ")}`
              .toLowerCase()
              .includes(alvo),
          )
        : r.plugins;
      return texto(achados.slice(0, 40));
    },
  },
  {
    maestroOnly: true,
    name: "instalar_skill",
    description:
      "Instala uma skill do marketplace no acervo do cockpit, deixando-a disponível para qualquer CLI. Passe o id do plugin e o nome da skill.",
    inputSchema: {
      type: "object",
      properties: { plugin: { type: "string" }, skill: { type: "string" } },
      required: ["plugin", "skill"],
      additionalProperties: false,
    },
    run: async (a) => texto(await api("/api/marketplace/instalar", { plugin: a.plugin, skill: a.skill })),
  },

  // ---------- cockpit inter-agent communication tools ----------
  {
    name: "cockpit_list",
    description: "Lista os outros painéis e janelas reais de especialistas desta missão (Agy, Grok, Codex, Claude… com papéis EXPLORADOR, ARQUITETO, CONSTRUTOR, REVISOR, VERIFICADOR, etc.) com status e inbox. NUNCA crie subagentes do seu CLI: use esta lista para identificar as janelas abertas e delegar para elas via 'delegar' ou 'cockpit_ask'.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => texto(await api(`/api/missions/${MISSAO}/cockpit/list`)),
  },
  {
    name: "cockpit_connect",
    description: "Cria uma conexão persistente entre dois painéis existentes na missão.",
    inputSchema: {
      type: "object",
      properties: {
        origem: { type: "string", description: "ID do painel de origem" },
        destino: { type: "string", description: "ID do painel de destino" },
      },
      required: ["origem", "destino"],
      additionalProperties: false,
    },
    run: async (a) => texto(await api(`/api/missions/${MISSAO}/cockpit/connect`, { sourcePaneId: a.origem, targetPaneId: a.destino })),
  },
  {
    name: "cockpit_ask",
    description:
      "Fala com outro painel/janela aberto nesta missão (ID, rótulo ou papel: EXPLORADOR, REVISOR, CONSTRUTOR, VERIFICADOR, grok, p3-…). Cola o texto no terminal dele. Os verdadeiros agentes da missão são as janelas/painéis reais do Cockpit, NUNCA subagentes locais ou internos do CLI. Se deliveredToTerminal=false, ele está ocupado — espere e tente de novo. Não simule a conversa e não crie subagentes: esta tool é o canal real.",
    inputSchema: {
      type: "object",
      properties: {
        destino: { type: "string", description: "ID, rótulo ou papel do destinatário (ex: EXPLORADOR, scout, p3-…)" },
        tarefa: { type: "string", description: "Instrução estruturada de trabalho" },
        taskId: { type: "string", description: "ID opcional da tarefa persistida associada" },
        force: { type: "boolean", description: "Colar no terminal mesmo se o painel estiver ocupado" },
      },
      required: ["destino", "tarefa"],
      additionalProperties: false,
    },
    run: async (a) => texto(await api(`/api/missions/${MISSAO}/cockpit/ask`, { from: QUEM, to: a.destino, task: a.tarefa, taskId: a.taskId, force: String(a.force ?? "") === "true" })),
  },
  {
    name: "cockpit_reply",
    description: "Responde a uma solicitação recebida na caixa de entrada com resultado estruturado correspondente ao correlationId.",
    inputSchema: {
      type: "object",
      properties: {
        destino: { type: "string", description: "ID do painel que fez a pergunta" },
        correlationId: { type: "string", description: "ID de correlação da mensagem recebida" },
        resultado: { type: "string", description: "Resultado ou resposta do trabalho" },
      },
      required: ["destino", "correlationId", "resultado"],
      additionalProperties: false,
    },
    run: async (a) => texto(await api(`/api/missions/${MISSAO}/cockpit/reply`, { from: QUEM, to: a.destino, correlationId: a.correlationId, result: a.resultado })),
  },
  {
    maestroOnly: true,
    name: "cockpit_handoff",
    description: "Realiza a transferência estruturada (handoff) de uma tarefa e seu contexto de um painel para outro, anexando evidências.",
    inputSchema: {
      type: "object",
      properties: {
        origem: { type: "string", description: "ID do painel de origem da tarefa" },
        destino: { type: "string", description: "ID do painel que assumirá a tarefa" },
        taskId: { type: "string", description: "ID da tarefa transferida" },
        contexto: { type: "string", description: "Resumo do contexto, progresso e orientações para o sucessor" },
        force: { type: "boolean", description: "Forçar transferência mesmo se o painel de origem não possuir lock exclusivo" },
      },
      required: ["origem", "destino", "taskId"],
      additionalProperties: false,
    },
    run: async (a) => texto(await api(`/api/missions/${MISSAO}/cockpit/handoff`, {
      sourcePaneId: a.origem,
      targetPaneId: a.destino,
      taskId: a.taskId,
      context: a.contexto,
      force: Boolean(a.force),
    })),
  },
  {
    name: "cockpit_inbox",
    description: "Lê as mensagens da caixa de entrada deste painel (resolvido pelo ID do painel, não pelo rótulo).",
    inputSchema: {
      type: "object",
      properties: {
        naoLidas: { type: "boolean", description: "Se true, filtra apenas mensagens não lidas" },
      },
      additionalProperties: false,
    },
    run: async (a) => {
      return texto(await api(`/api/missions/${MISSAO}/panes/${encodeURIComponent(QUEM)}/inbox${a.naoLidas ? "?unread=1" : ""}`));
    },
  },
];

const TOOLS_ATIVAS = TOOLS.filter((t) => SOU_MAESTRO || !t.maestroOnly);

// ---------- JSON-RPC ----------

function responder(id: unknown, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function falhar(id: unknown, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n");
}

createInterface({ input: process.stdin }).on("line", (linha) => {
  if (!linha.trim()) return;
  let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(linha);
  } catch {
    return;
  }
  const { id, method, params } = msg;

  if (method === "initialize") {
    responder(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "cockpit-maestro", version: "1.0.0" },
    });
    return;
  }
  if (method === "tools/list") {
    responder(
      id,
      { tools: TOOLS_ATIVAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
    );
    return;
  }
  if (method === "tools/call") {
    const nome = params?.name as string;
    const tool = TOOLS_ATIVAS.find((t) => t.name === nome);
    if (!tool) return falhar(id, `ferramenta desconhecida: ${nome}`);
    tool
      .run((params?.arguments ?? {}) as Record<string, string>)
      .then((saida) => responder(id, { content: [{ type: "text", text: saida }] }))
      .catch((err: Error) =>
        responder(id, { content: [{ type: "text", text: `Falhou: ${err.message}` }], isError: true }),
      );
    return;
  }
  // notifications/* não pedem resposta
  if (id !== undefined && method) falhar(id, `método não suportado: ${method}`);
});
