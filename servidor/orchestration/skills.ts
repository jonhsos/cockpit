import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { config, salvarConfig, type AgentSpec } from "../config.ts";
import { CASA } from "../state.ts";

/**
 * Skills: instrução instalável.
 *
 * Uma skill é um arquivo de texto que muda como o agente trabalha, sem mexer
 * em código. O cockpit é dono do acervo — assim a mesma skill serve claude,
 * agy e codex, que guardam skill de jeitos diferentes (ou não guardam).
 *
 * O que entra no prompt é o ÍNDICE, não o texto inteiro. Doze painéis com
 * cinco skills coladas por extenso queimariam token à toa; o agente lê o
 * arquivo quando a skill for do assunto. É a mesma economia do harness,
 * aplicada a instrução em vez de modelo.
 */

// A casa é uma só, e respeita COCKPIT_HOME — sem isto um teste isolado
// escreveria no acervo de verdade.
export { CASA };
const ACERVO = join(CASA, "skills");

export type Skill = {
  nome: string;
  /** Uma linha: é por ela que o agente decide se vale abrir o arquivo. */
  descricao: string;
  /** Papéis que recebem esta skill sozinhos ao nascer: builder, reviewer… */
  papeis?: string[];
  corpo: string;
  caminho: string;
  /** De onde veio: "cockpit" (própria) ou o id do CLI onde foi descoberta. */
  origem: string;
  /** Skills descobertas em outro CLI são só de leitura aqui. */
  editavel: boolean;
};

/** Frontmatter YAML simples: só `chave: valor` e listas em uma linha. */
function lerFrontmatter(texto: string): { campos: Record<string, string>; corpo: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(texto);
  if (!m) return { campos: {}, corpo: texto };
  const campos: Record<string, string> = {};
  let chave = "";
  for (const linha of m[1]!.split(/\r?\n/)) {
    const par = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(linha);
    if (par) {
      chave = par[1]!;
      campos[chave] = par[2]!.trim();
    } else if (chave && linha.trim()) {
      // Continuação de um bloco `descrição: |` — vira uma linha só.
      campos[chave] = `${campos[chave]} ${linha.trim()}`.trim();
    }
  }
  return { campos, corpo: texto.slice(m[0].length) };
}

const limpar = (v: string): string => v.replace(/^["'|>]\s*/, "").replace(/["']$/, "").trim();

const lista = (v: string | undefined): string[] =>
  (v ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((x) => limpar(x))
    .filter(Boolean);

function lerSkill(dir: string, nome: string, origem: string, editavel: boolean): Skill | null {
  const caminho = join(dir, "SKILL.md");
  if (!existsSync(caminho)) return null;
  const bruto = readFileSync(caminho, "utf8");
  const { campos, corpo } = lerFrontmatter(bruto);
  return {
    nome: limpar(campos.name ?? "") || nome,
    descricao: limpar(campos.description ?? "").slice(0, 400),
    papeis: lista(campos.papeis ?? campos.roles),
    corpo,
    caminho,
    origem,
    editavel,
  };
}

/** Onde cada CLI guarda as skills dele — para reaproveitar o que já existe. */
function pastasDeCli(): { origem: string; dir: string }[] {
  const casa = homedir();
  return [
    { origem: "claude", dir: join(casa, ".claude", "skills") },
    { origem: "codex", dir: join(casa, ".codex", "skills") },
    { origem: "agy", dir: join(casa, ".gemini", "skills") },
  ];
}

function varrer(dir: string, origem: string, editavel: boolean): Skill[] {
  if (!existsSync(dir)) return [];
  const achadas: Skill[] = [];
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (!statSync(caminho).isDirectory()) continue;
    const s = lerSkill(caminho, entrada, origem, editavel);
    if (s) achadas.push(s);
  }
  return achadas;
}

/** Skills dentro dos plugins instalados no Claude Code. */
function varrerPlugins(): Skill[] {
  const raiz = join(homedir(), ".claude", "plugins", "cache");
  if (!existsSync(raiz)) return [];
  const achadas: Skill[] = [];
  // cache/<marketplace>/<plugin>/<versão>/skills/<skill>/SKILL.md
  const descer = (dir: string, profundidade: number) => {
    if (profundidade > 4 || !existsSync(dir)) return;
    for (const entrada of readdirSync(dir)) {
      const caminho = join(dir, entrada);
      if (!statSync(caminho).isDirectory()) continue;
      if (entrada === "skills") {
        for (const s of varrer(caminho, "claude", false)) achadas.push(s);
      } else {
        descer(caminho, profundidade + 1);
      }
    }
  };
  descer(raiz, 0);
  return achadas;
}

/**
 * Tudo que existe, sem repetir nome. O acervo do cockpit ganha do que foi
 * descoberto: se você editou uma skill aqui, é a sua versão que vale.
 */
export function listarSkills(): Skill[] {
  const por = new Map<string, Skill>();
  for (const s of varrerPlugins()) por.set(s.nome, s);
  for (const { origem, dir } of pastasDeCli()) {
    for (const s of varrer(dir, origem, false)) por.set(s.nome, s);
  }
  for (const s of varrer(ACERVO, "cockpit", true)) por.set(s.nome, s);
  return [...por.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

export const acharSkill = (nome: string): Skill | undefined =>
  listarSkills().find((s) => s.nome === nome);

export function salvarSkill(s: { nome: string; descricao: string; papeis?: string[]; corpo: string }): Skill {
  const nome = s.nome.trim();
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(nome)) {
    throw new Error("o nome da skill aceita só letras, números, hífen e sublinhado");
  }
  const dir = join(ACERVO, nome);
  mkdirSync(dir, { recursive: true });
  const frente = [
    "---",
    `name: ${nome}`,
    `description: ${s.descricao.replace(/\r?\n/g, " ").trim()}`,
    ...(s.papeis?.length ? [`papeis: ${s.papeis.join(", ")}`] : []),
    "---",
    "",
  ].join("\n");
  writeFileSync(join(dir, "SKILL.md"), frente + s.corpo.trimStart(), "utf8");
  return acharSkill(nome)!;
}

export function apagarSkill(nome: string): void {
  const s = acharSkill(nome);
  if (!s) throw new Error(`não existe skill "${nome}"`);
  if (!s.editavel) {
    throw new Error(
      `"${nome}" veio de ${s.origem} e é só de leitura aqui. Remova pelo próprio CLI.`,
    );
  }
  rmSync(join(ACERVO, nome), { recursive: true, force: true });
  // Some também das listas dos agentes, senão fica um nome órfão.
  for (const spec of Object.values(config.agents)) {
    if (spec.skills) spec.skills = spec.skills.filter((x) => x !== nome);
    if (spec.allowedSkills) spec.allowedSkills = spec.allowedSkills.filter((x) => x !== nome);
  }
  salvarConfig();
}

/**
 * Quais skills este agente carrega ao nascer.
 *
 * Três fontes se somam: as fixadas no agente, as que se auto-instalam pelo
 * papel dele, e as que a missão pediu. `allowedSkills` corta no fim — lista
 * fechada é lista fechada, não pedido educado.
 */
export function skillsDoAgente(agentId: string, spec: AgentSpec, extras: string[] = []): Skill[] {
  const todas = listarSkills();
  const papel = spec.papel_id ?? agentId;
  const querem = new Set<string>([...(spec.skills ?? []), ...extras]);
  for (const s of todas) {
    if (s.papeis?.length && s.papeis.includes(papel)) querem.add(s.nome);
  }
  const permitidas = spec.allowedSkills;
  return todas.filter(
    (s) => querem.has(s.nome) && (permitidas === undefined || permitidas.includes(s.nome)),
  );
}

/**
 * O bloco que entra no system prompt: nome, para que serve e onde ler.
 * Nunca o texto inteiro — quem decide abrir é o agente.
 */
export function indiceParaPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const linhas = skills.map(
    (s) => `- ${s.nome}: ${s.descricao || "sem descrição"}\n  arquivo: ${resolve(s.caminho)}`,
  );
  return [
    "Skills disponíveis para você nesta missão. Cada uma é um arquivo de instrução.",
    "Quando a tarefa for do assunto de uma delas, LEIA o arquivo antes de agir e siga o que ele diz.",
    "Não leia todas por precaução — só a que serve.",
    "",
    ...linhas,
  ].join("\n");
}
