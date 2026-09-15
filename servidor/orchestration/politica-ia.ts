import { config, type ExecucaoIA, type PoliticaIA } from "../config.ts";

export function execucaoDoPapel(agent: string): ExecucaoIA | undefined {
  if (config.agents[agent]?.cli === "bash") return undefined;
  const p = config.politicaIA;
  return p?.modo === "unica" ? p.unica : p?.modo === "dividida" ? p.papeis?.[agent] : undefined;
}

export function validarPoliticaIA(value: unknown): PoliticaIA {
  if (!value || typeof value !== "object") throw Error("Configuração de IA inválida.");
  const p = value as PoliticaIA;
  if (!["padrao", "unica", "dividida"].includes(p.modo)) throw Error("Modo de IA inválido.");
  const validar = (e: ExecucaoIA): ExecucaoIA => {
    if (!e || !config.clis[e.cli] || !config.modelos?.[e.cli]?.includes(e.model) || !config.efforts?.[e.cli]?.includes(e.effort)) throw Error("Provedor, modelo ou esforço inválido.");
    return { cli: e.cli, model: e.model, effort: e.effort };
  };
  if (p.modo === "unica") return { modo: p.modo, unica: validar(p.unica!) };
  if (p.modo === "dividida") {
    if (!p.papeis || typeof p.papeis !== "object" || Array.isArray(p.papeis)) throw Error("Papéis inválidos.");
    const papeis: Record<string, ExecucaoIA> = {};
    for (const [id, e] of Object.entries(p.papeis)) {
      if (!Object.hasOwn(config.agents, id) || config.agents[id]?.cli === "bash") throw Error("Papel inválido.");
      papeis[id] = validar(e);
    }
    return { modo: p.modo, papeis };
  }
  return { modo: "padrao" };
}
