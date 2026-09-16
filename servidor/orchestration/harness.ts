import { config, type AgentSpec, type Elenco, type TipoTarefa } from "../config.ts";
import { execucaoDoPapel } from "./politica-ia.ts";
import type { RoleContractInput } from "./roles.ts";
import { providerDisponivel } from "../providers/providers.ts";

/**
 * Harness: o bundle de execução de um painel — cli + modelo + effort.
 *
 * O usuário escolhe agente, provedor e, quando aplicável, o elenco. O tipo
 * descreve trabalho para organização e contexto; nunca troca modelo ou
 * esforço. Assim LUNA continua LUNA mesmo numa tarefa marcada Arquitetura.
 *
 * A resolução é determinística, por precedência:
 *   1. o que o elenco da missão fixa    (mais forte — é a sua escolha)
 *   2. o que o roster do time fixa
 *   3. o que a invocação pede
 *   4. o default do agente no catálogo  (mais fraco)
 *
 * O elenco é um portão: um provedor fora dele não abre painel nenhum. O
 * sem elenco, provedor do agente é respeitado. Se agente escolhido pertence a
 * um CLI fora do elenco, painel usa primeiro provedor liberado pelo usuário.
 */

export type Harness = {
  cli: string;
  model?: string;
  effort?: string;
  /** De onde veio cada peça, para a interface poder mostrar. */
  origem: { cli: string; model: string; effort: string };
  /** Preenchido quando o elenco trocou o provedor do agente. */
  trocado?: { de: string; porque: string };
};

export type Pedido = {
  agent: string;
  /** Runner explícito (ex: bash, codex, claude). */
  runner?: string;
  /** Role/papel funcional explícito. */
  role?: string;
  /** Contrato temporário de papel criado na interface. */
  roleDefinition?: RoleContractInput;
  /** Backend explícito (pty ou dsh). */
  backend?: "pty" | "dsh";
  /** Argumentos de login executados diretamente, sem interpolação de shell. */
  loginArgs?: string[];
  /** Tipo da tarefa: chave de harness.tipos no cockpit.json. */
  tipo?: string;
  /** O que o roster do time fixou para este agente nesta fase. */
  roster?: Partial<Pick<Harness, "cli" | "model" | "effort">>;
  /** O que a chamada pediu explicitamente. */
  invoke?: Partial<Pick<Harness, "cli" | "model" | "effort">>;
  /** Quais IAs esta missão liberou. */
  elenco?: Elenco;
  /** Validar se o executor está disponível no PATH do host. */
  checkAvailability?: boolean;
};

export const tiposDeTarefa = (): Record<string, TipoTarefa> => config.harness?.tipos ?? {};

/**
 * O valor pertence a este CLI? Sem lista declarada, aceitamos qualquer um.
 * A comparação é exata de propósito: "claude-opus-4-6-thinking" contém
 * "opus", e uma checagem por substring deixaria um modelo do Claude passar
 * por modelo da Antigravity.
 */
function aceita(lista: string[] | undefined, valor: string | undefined): boolean {
  if (!valor) return false;
  if (!lista || lista.length === 0) return true;
  return lista.includes(valor);
}

/** Primeiro valor definido na ordem da precedência, com o nome da fonte. */
function escolher(candidatos: [string, string | undefined][]): [string | undefined, string] {
  for (const [fonte, valor] of candidatos) {
    if (valor) return [valor, fonte];
  }
  return [undefined, "nada"];
}

/**
 * Elenco é única restrição automática de provedor. Tipo não filtra provedor,
 * modelo nem esforço: usuário escolhe agente e trabalho independentemente.
 */
function liberados(elenco: Elenco | undefined): string[] | null {
  // O portão é somente do elenco, escolhido pelo usuário.
  if (!elenco || elenco.clis.length === 0) return null;
  return elenco.clis;
}

export function resolverHarness(pedido: Pedido): Harness {
  // Explicit bash selection (runner, invoke, roster) has absolute precedence (soberano).
  const explicitBash =
    pedido.runner === "bash" ||
    pedido.invoke?.cli === "bash" ||
    pedido.roster?.cli === "bash";

  if (explicitBash) {
    return {
      cli: "bash",
      origem: { cli: "soberano", model: "não se aplica", effort: "não se aplica" },
    };
  }

  const spec: AgentSpec | undefined = config.agents[pedido.agent];
  if (!spec) {
    if ((pedido.agent === "shell" || pedido.agent === "bash") && !pedido.invoke?.cli && !pedido.roster?.cli) {
      return {
        cli: "bash",
        origem: { cli: "soberano", model: "não se aplica", effort: "não se aplica" },
      };
    }
    throw new Error(
      `não existe agente "${pedido.agent}". Disponíveis: ${Object.keys(config.agents).join(", ")}`,
    );
  }

  // SHELL sem provedor escolhido não é uma IA. O elenco da missão lista IAs
  // permitidas e antes tratava "bash" como um provedor barrado, trocando-o
  // pela primeira IA do elenco (frequentemente Codex). Só um override
  // explícito da tela pode transformar o SHELL em agente.
  if (spec.cli === "bash" && !pedido.roster?.cli && !pedido.invoke?.cli) {
    return {
      cli: "bash",
      origem: { cli: "soberano", model: "não se aplica", effort: "não se aplica" },
    };
  }

  const fixo = execucaoDoPapel(pedido.agent);
  if (fixo) return { ...fixo, origem: { cli: "configuração de IA", model: "configuração de IA", effort: "configuração de IA" } };

  // O CLI é decidido primeiro: ele define quais modelos e esforços existem.
  const [cli, deCli] = escolher([
    ["roster", pedido.roster?.cli],
    ["invocação", pedido.invoke?.cli],
    ["catálogo", spec.cli],
  ]);
  let finalCli = cli ?? spec.cli;
  let deFinalCli = deCli;
  let trocado: Harness["trocado"];

  // O portão do elenco. O elenco atua estritamente como lista de executores permitidos.
  // Fallback silencioso removido: se não permitido, lança erro claro.
  const permitidos = liberados(pedido.elenco);
  if (permitidos && !permitidos.map((c) => c.toLowerCase()).includes(finalCli.toLowerCase())) {
    throw new Error(`Executor "${finalCli}" não permitido no elenco desta missão`);
  }

  if (finalCli !== "bash" && (pedido.checkAvailability || !config.clis[finalCli])) {
    if (!providerDisponivel(finalCli)) {
      throw new Error(`Executor "${finalCli}" não disponível no sistema`);
    }
  }

  // Bash é terminal puro. Papel nomeia o painel, mas nunca pode puxar o
  // modelo/effort do catálogo para dentro do Shell.
  if (finalCli === "bash") {
    return {
      cli: "bash",
      origem: { cli: "soberano", model: "não se aplica", effort: "não se aplica" },
      trocado,
    };
  }

  const fixado = pedido.elenco?.porCli?.[finalCli];
  // A lista da tela pode escolher onde um papel roda. Nesse caso o papel não
  // carrega seu modelo antigo para o novo CLI: modelo sem escolha explícita é
  // decisão do próprio CLI/servidor (por exemplo, combo OmniRoute).
  const execucaoEscolhida = Boolean(pedido.invoke?.cli);

  const [model, deModel] = escolher([
    ["invocação", pedido.invoke?.model],
    ["elenco da missão", fixado?.model],
    ["roster", pedido.roster?.model],
    ["catálogo", execucaoEscolhida ? undefined : spec.model],
  ]);

  const [effort, deEffort] = escolher([
    ["invocação", pedido.invoke?.effort],
    ["elenco da missão", fixado?.effort],
    ["roster", pedido.roster?.effort],
    ["catálogo", execucaoEscolhida ? undefined : spec.effort],
  ]);

  // Rede de segurança: se sobrou valor de outro provedor, desce para o do
  // agente. Zerar seria pior — sem modelo o CLI usa o que estiver salvo nele,
  // e um agente chamado ASTRA viraria "o que o Codex tiver guardado".
  //
  const modelos = config.modelos?.[finalCli];
  const efforts = config.efforts?.[finalCli];

  let finalModel = model;
  let deFinalModel = deModel;
  if (!aceita(modelos, finalModel) && !(execucaoEscolhida && !finalModel)) {
    const alternativa = aceita(modelos, spec.model)
      ? spec.model
      : modelos?.[0];
    finalModel = alternativa;
    deFinalModel = finalModel ? `padrão de ${finalCli} (o pedido não serve nele)` : "nenhum que sirva";
  }

  let finalEffort = effort;
  let deFinalEffort = deEffort;
  if (!aceita(efforts, finalEffort) && !(execucaoEscolhida && !finalEffort)) {
    const alternativa = aceita(efforts, spec.effort)
      ? spec.effort
      : efforts?.[0];
    finalEffort = alternativa;
    deFinalEffort = finalEffort
      ? `padrão de ${finalCli} (${effort ?? "—"} não existe nele)`
      : "nenhum que sirva";
  }

  return {
    cli: finalCli,
    model: finalModel,
    effort: finalEffort,
    origem: { cli: deFinalCli, model: deFinalModel, effort: deFinalEffort },
    trocado,
  };
}

/**
 * Preço de saída por milhão de tokens, só para comparar opções.
 * Não é previsão de gasto: é a régua que mostra o que é caro e o que é barato.
 */
export function precoRelativo(cli: string, model: string | undefined): number | null {
  if (cli !== "claude" || !model) return null;
  const chave = Object.keys(config.precos).find((k) => k.includes(model));
  const p = chave ? config.precos[chave] : undefined;
  return p ? p.out : null;
}

export type HarnessResult = Harness;

/**
 * Interface Contract 4: servidor/orchestration/harness ↔ Providers
 * resolveHarness(requestedCli, missionElenco, checkAvailability)
 */
export function resolveHarness(
  requestedCli: string,
  missionElenco?: string[],
  checkAvailability = true,
): HarnessResult {
  const cliLower = requestedCli.toLowerCase();
  if (cliLower === "bash") {
    return {
      cli: "bash",
      origem: { cli: "soberano", model: "não se aplica", effort: "não se aplica" },
    };
  }

  if (checkAvailability && !providerDisponivel(cliLower)) {
    throw new Error(`Executor "${requestedCli}" não disponível no sistema`);
  }

  if (
    missionElenco &&
    missionElenco.length > 0 &&
    !missionElenco.map((c) => c.toLowerCase()).includes(cliLower)
  ) {
    throw new Error(`Executor "${requestedCli}" não permitido no elenco desta missão`);
  }

  const agentEntry = Object.entries(config.agents).find(
    ([, a]) => a.cli.toLowerCase() === cliLower,
  );
  const agentKey = agentEntry ? agentEntry[0] : "shell";

  const elencoObj: Elenco | undefined = missionElenco
    ? { clis: missionElenco }
    : undefined;

  return resolverHarness({
    agent: agentKey,
    invoke: { cli: cliLower },
    elenco: elencoObj,
    checkAvailability: false,
  });
}
