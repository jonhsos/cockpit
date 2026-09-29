import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatarEquipeAberta, type JanelaDaMissao } from "../orchestration/elenco-missao.ts";

export const AGENTE_AGY_ORQUESTRADOR = "cockpit-orquestrador";
export const AGENTE_AGY_ESPECIALISTA = "cockpit-especialista";

export type JanelaOverlayAgy = {
  paneId: string;
  label: string;
  role: string;
  cli: string;
};

export function nomeDoAgenteAgy(maestro: boolean): string {
  return maestro ? AGENTE_AGY_ORQUESTRADOR : AGENTE_AGY_ESPECIALISTA;
}

export function textoRegrasCockpitAgy(opts: {
  label: string;
  papel?: string;
  maestro: boolean;
  modo?: string;
  janelas?: JanelaOverlayAgy[];
}): string {
  const modo = (opts.modo || "dirigido").toUpperCase();
  const lista = formatarEquipeAberta((opts.janelas ?? []) as JanelaDaMissao[]);

  return [
    `# Cockpit — ${opts.label.toUpperCase()}`,
    opts.papel?.trim() || "",
    "",
    "## Precedência",
    "Estas regras do Cockpit prevalecem sobre AGENTS.md, GEMINI.md, skills e subagentes do repositório (incluindo jion_explorer, jion_worker, jion_verifier, jion_reviewer, deep-debugger).",
    "A equipe da missão são as janelas/painéis reais abertos no Cockpit. Não são subagentes do Antigravity.",
    "",
    "## Proibido",
    "- invoke_subagent, define_subagent, manage_subagents, /agents, /teamwork-preview, /boost como substituto da equipe",
    "- criar ou reutilizar subagentes internos do CLI",
    "- implementar, editar código, explorar o repo ou rodar testes na sessão do Orquestrador",
    "",
    "## Obrigatório",
    "- listar_especialistas ou cockpit_list para ver quem está aberto",
    "- delegar (ou cockpit_ask) para entregar trabalho numa janela aberta",
    "- no modo DIRIGIDO: só os painéis já abertos; não inventar especialista",
    "",
    `## Modo da missão: ${modo}`,
    opts.maestro
      ? "Você coordena. Primeira ação útil: listar_especialistas. Depois delegar. Espere o Cockpit acordar você com o resultado."
      : "Você executa o contrato deste papel até terminar e reporta com COCKPIT_STATUS: complete ou cockpit_reply.",
    "",
    "## Janelas desta missão",
    lista,
  ].join("\n");
}

function yamlAgente(nome: string, descricao: string, corpo: string): string {
  return [
    "---",
    `name: ${nome}`,
    `description: ${descricao}`,
    "inheritCustomizations: false",
    "inheritMcp: true",
    "---",
    "",
    corpo,
    "",
  ].join("\n");
}

/** Customizações que o Antigravity realmente carrega (plugin + agente + GEMINI.md). */
export function gravarOverlayCockpitAgy(
  home: string,
  opts: {
    label: string;
    papel?: string;
    maestro: boolean;
    modo?: string;
    janelas?: JanelaOverlayAgy[];
  },
): string {
  const regras = textoRegrasCockpitAgy(opts);
  const nome = nomeDoAgenteAgy(opts.maestro);
  const descricao = opts.maestro
    ? "Orquestrador do Cockpit. Delega só para janelas abertas via MCP delegar/cockpit_list."
    : "Especialista do Cockpit. Executa o papel da janela e reporta ao Orquestrador; não cria subagentes.";

  mkdirSync(join(home, ".gemini", "rules"), { recursive: true });
  writeFileSync(join(home, ".gemini", "rules", "cockpit.md"), regras);
  writeFileSync(join(home, "GEMINI.md"), regras);
  mkdirSync(join(home, ".gemini"), { recursive: true });
  writeFileSync(join(home, ".gemini", "GEMINI.md"), regras);

  for (const pluginDir of [
    join(home, ".agents", "plugins", "cockpit-orquestracao"),
    join(home, ".gemini", "antigravity-cli", "plugins", "cockpit-orquestracao"),
  ]) {
    mkdirSync(join(pluginDir, "rules"), { recursive: true });
    writeFileSync(join(pluginDir, "plugin.json"), `${JSON.stringify({ name: "cockpit-orquestracao" }, null, 2)}\n`);
    writeFileSync(join(pluginDir, "rules", "AGENTS.md"), regras);
  }

  const agenteDir = join(home, ".agents", "agents", nome);
  mkdirSync(agenteDir, { recursive: true });
  writeFileSync(join(agenteDir, "agent.md"), yamlAgente(nome, descricao, regras));

  return nome;
}
