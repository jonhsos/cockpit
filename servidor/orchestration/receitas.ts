import { config, salvarConfig, type Receita } from "../config.ts";
import { acharSkill } from "./skills.ts";

/**
 * Receitas: formações prontas.
 *
 * A diferença para um squad é o escopo. Squad é a coreografia — quem trabalha
 * em qual fase. Receita é o preenchimento: modo, agente, tipo de tarefa,
 * modelo, esforço e skills já respondidos para um tipo de objetivo. No
 * assistente de missão ela adianta os campos que cobre e você só completa o
 * resto.
 */

export const listarReceitas = (): Record<string, Receita> => config.receitas ?? {};

export function salvarReceita(id: string, r: Receita): Receita {
  const chave = id.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(chave)) {
    throw new Error("o id da receita aceita só letras minúsculas, números, hífen e sublinhado");
  }
  if (!r.label?.trim()) throw new Error("dê um nome à receita");
  if (r.agent && !config.agents[r.agent]) throw new Error(`não existe agente "${r.agent}"`);
  if (r.squad && !config.squads[r.squad]) throw new Error(`não existe squad "${r.squad}"`);
  if (r.tipo && !config.harness?.tipos?.[r.tipo]) throw new Error(`não existe tipo "${r.tipo}"`);
  for (const s of r.skills ?? []) {
    if (!acharSkill(s)) throw new Error(`não existe skill "${s}"`);
  }
  const antiga = config.receitas?.[chave];
  if (antiga?.daCasa) throw new Error(`"${chave}" é uma receita da casa. Salve com outro id.`);

  config.receitas ??= {};
  config.receitas[chave] = { ...r, label: r.label.trim(), daCasa: false };
  salvarConfig();
  return config.receitas[chave]!;
}

export function apagarReceita(id: string): void {
  const r = config.receitas?.[id];
  if (!r) throw new Error(`não existe receita "${id}"`);
  if (r.daCasa) throw new Error(`"${id}" é uma receita da casa e não se apaga.`);
  delete config.receitas![id];
  salvarConfig();
}

/**
 * O que a receita já responde do assistente. Devolve só campos preenchidos,
 * para o formulário saber quais perguntas pular sem apagar o que você digitou.
 */
export function aplicarReceita(id: string): Partial<Receita> & { receita: string } {
  const r = config.receitas?.[id];
  if (!r) throw new Error(`não existe receita "${id}"`);
  const preenchido: Partial<Receita> & { receita: string } = { receita: id };
  for (const k of ["modo", "squad", "agent", "tipo", "cli", "model", "effort", "paineis"] as const) {
    const v = r[k];
    if (v !== undefined && v !== "") (preenchido as Record<string, unknown>)[k] = v;
  }
  if (r.skills?.length) preenchido.skills = r.skills;
  if (r.elenco?.clis?.length) preenchido.elenco = r.elenco;
  return preenchido;
}
