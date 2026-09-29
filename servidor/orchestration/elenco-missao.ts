export type JanelaDaMissao = {
  paneId: string;
  label?: string;
  role?: string;
  agent?: string;
  cli?: string;
  runner?: string;
  model?: string | null;
  maestro?: boolean;
  connected?: boolean;
  status?: string;
  canAcceptTask?: boolean;
};

export type EspecialistaDaMissao = {
  id: string;
  label: string;
  papel: string;
  cli: string;
  modelo?: string | null;
  effort?: string | null;
  permitido: boolean;
  aberto: boolean;
  paneId?: string;
  delegarComo: string;
  aceita_delegar?: boolean;
  maestro?: boolean;
  nota?: string;
  escopo?: string;
};

export function janelaViva(pane: JanelaDaMissao): boolean {
  return pane.connected !== false && pane.status !== "dead" && pane.status !== "failed";
}

export function formatarEquipeAberta(janelas: JanelaDaMissao[]): string {
  const vivos = janelas.filter(janelaViva);
  if (vivos.length === 0) return "(nenhuma janela de especialista aberta)";
  return vivos
    .map((j) => {
      const papel = j.role || j.agent || j.paneId;
      const label = j.label || papel;
      const cli = j.cli || j.runner || "?";
      return `- ${label} · papel ${papel} · painel ${j.paneId} · ${cli} · delegarComo: ${papel}`;
    })
    .join("\n");
}

/** Regras de canal injetadas no spawn de qualquer CLI (Claude, Codex, Grok, Agy). */
export function regrasDeCanalCockpit(opts: {
  maestro?: boolean;
  modo?: string;
  janelas?: JanelaDaMissao[];
}): string {
  const modo = (opts.modo || "dirigido").trim().toLowerCase() || "dirigido";
  const dirigido = modo === "dirigido" ? " Só delegue às janelas listadas." : "";
  const linhas = [
    "Canal real do Cockpit: cockpit_list / cockpit_ask / cockpit_inbox / delegar.",
    "As janelas abertas nesta missão são os verdadeiros especialistas. NUNCA crie subagentes internos do CLI (Task, Agent, invoke_subagent, define_subagent, jion_explorer, jion_worker, jion_verifier, /agents, /boost).",
    `Modo da missão: ${modo.toUpperCase()}.${dirigido}`,
    "Equipe aberta agora:",
    formatarEquipeAberta(opts.janelas ?? []),
  ];
  if (opts.maestro) {
    linhas.push(
      "Primeira ação: listar_especialistas (itens com aberto=true). Depois delegar. Pare e aguarde o Cockpit acordar você com o resultado.",
    );
  }
  return linhas.join("\n");
}

/** Equipe real primeiro (janelas abertas), depois o catálogo que ainda não está no palco. */
export function montarEspecialistasDaMissao(
  janelas: JanelaDaMissao[],
  catalogo: Omit<EspecialistaDaMissao, "aberto" | "delegarComo">[],
): EspecialistaDaMissao[] {
  const abertos: EspecialistaDaMissao[] = janelas.filter(janelaViva).map((pane) => {
    const papel = pane.role || pane.agent || pane.paneId;
    const label = pane.label || papel;
    return {
      id: papel,
      label,
      papel,
      cli: pane.cli || pane.runner || "bash",
      modelo: pane.model ?? null,
      permitido: true,
      aberto: true,
      paneId: pane.paneId,
      delegarComo: papel,
      aceita_delegar: pane.canAcceptTask === true,
      maestro: pane.maestro === true,
    };
  });

  const cobertos = new Set(
    abertos.flatMap((item) => [item.id, item.label, item.paneId].map((v) => v?.trim().toLowerCase()).filter(Boolean) as string[]),
  );

  const extras = catalogo
    .filter((item) => !cobertos.has(item.id.trim().toLowerCase()) && !cobertos.has(item.label.trim().toLowerCase()))
    .map((item) => ({
      ...item,
      aberto: false,
      delegarComo: item.id,
      nota:
        item.nota ??
        "Não há janela deste papel aberta nesta missão. No modo Dirigido só use as janelas_abertas.",
    }));

  return [...abertos, ...extras];
}
