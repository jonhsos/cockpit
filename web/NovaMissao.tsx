import { useMemo, useState, type CSSProperties } from "react";
import type { AgentSpec, Elenco, Provider, Receita, SquadSpec, TipoTarefa } from "./api.ts";
import { CATALOG_ROLES, type RoleDefinition } from "./tipos.ts";
import {
  ROLE_CATEGORY_ORDER,
  roleCategoryLabel,
  roleDefinitionFor,
  roleIdFromAgent,
  agentForRole,
} from "./role-contract.ts";

export type Modo = "livre" | "dirigido" | "autonomo" | "squad" | "agentico";

export type Plano = {
  nome: string;
  objetivo: string;
  modo: Modo;
  squad: string;
  /** IDs dos perfis de execução escolhidos pelo resolvedor semântico. */
  agentes: string[];
  /** Papéis canônicos correspondentes, em paralelo a `agentes`. */
  papeis: string[];
  /** Executor efetivo correspondente, em paralelo a `agentes`. */
  runners: string[];
  tipo: string;
  receita?: string;
  skills?: string[];
  elenco?: Elenco;
};

const NOME_CLI: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  agy: "Antigravity",
  bash: "Terminal",
  grok: "Grok",
  openrouter: "OpenRouter",
};

const MODOS: { id: Modo; label: string; explica: string }[] = [
  { id: "livre", label: "Livre", explica: "Você escolhe os papéis e abre painéis sob seu comando." },
  { id: "dirigido", label: "Dirigido", explica: "O Orquestrador coordena, mas só usa os papéis autorizados nesta missão." },
  { id: "autonomo", label: "Autônomo", explica: "O Orquestrador pode decompor e instanciar trabalho dentro do objetivo." },
  { id: "agentico", label: "Agêntico", explica: "O Orquestrador conduz ciclos de planejamento, execução e verificação." },
  { id: "squad", label: "Squad", explica: "Uma formação com fases e responsáveis previamente definidos." },
];

const QUANTIDADES = [1, 2, 4, 8, 12];

const FORMACOES: { id: string; label: string; explica: string; monta: (ligados: string[]) => Elenco }[] = [
  {
    id: "claude-gpt",
    label: "Claude + Codex",
    explica: "Dois executores para raciocínio e implementação; o Gemini fica opcional para mídia.",
    monta: (ligados) => ({ clis: ["claude", "codex", "agy"].filter((cli) => ligados.includes(cli)), soVisual: ligados.includes("agy") ? ["agy"] : [] }),
  },
  { id: "so-claude", label: "Só Claude", explica: "A missão usa somente Claude para trabalho de IA.", monta: () => ({ clis: ["claude"] }) },
  { id: "tudo", label: "Todos", explica: "Todo executor disponível pode receber trabalho.", monta: (ligados) => ({ clis: ligados }) },
];

function juntarElenco(atual: Elenco, receita: Elenco): Elenco {
  const clis = [...new Set(receita.clis)];
  const porCli: Record<string, { model?: string; effort?: string }> = {};
  for (const cli of clis) {
    const fixo = atual.porCli?.[cli] ?? receita.porCli?.[cli];
    if (fixo?.model || fixo?.effort) porCli[cli] = fixo;
  }
  return {
    clis,
    ...(Object.keys(porCli).length > 0 ? { porCli } : {}),
    ...(receita.soVisual?.length ? { soVisual: receita.soVisual.filter((cli) => clis.includes(cli)) } : {}),
  };
}

function Resolvido({ rotulo, valor, nota, onMudar }: { rotulo: string; valor: string; nota?: string; onMudar: () => void }) {
  return <div className="resolvido"><span className="rotulo">{rotulo}</span><b>{valor}</b>{nota && <span className="prov-cmd">{nota}</span>}<span className="spacer" /><button type="button" className="btn mini" onClick={onMudar}>mudar</button></div>;
}

function Elencar({ providers, elenco, onMudar }: { providers: Provider[]; elenco: Elenco; onMudar: (elenco: Elenco) => void }) {
  const ligados = providers.filter((provider) => provider.disponivel && provider.id !== "bash");
  const ativo = (cli: string) => elenco.clis.includes(cli);
  const visual = (cli: string) => (elenco.soVisual ?? []).includes(cli);
  const alternar = (cli: string) => {
    const clis = ativo(cli) ? elenco.clis.filter((item) => item !== cli) : [...elenco.clis, cli];
    onMudar({ ...elenco, clis, soVisual: (elenco.soVisual ?? []).filter((item) => clis.includes(item)) });
  };
  const alternarVisual = (cli: string) => onMudar({ ...elenco, soVisual: visual(cli) ? (elenco.soVisual ?? []).filter((item) => item !== cli) : [...(elenco.soVisual ?? []), cli] });
  const fixar = (cli: string, campo: "model" | "effort", valor: string) => {
    const anterior = elenco.porCli?.[cli] ?? {};
    const proximo = { ...anterior, [campo]: valor || undefined };
    const porCli = { ...(elenco.porCli ?? {}), [cli]: proximo };
    if (!proximo.model && !proximo.effort) delete porCli[cli];
    onMudar({ ...elenco, porCli });
  };

  return <section className="mission-roster"><div className="mission-section-heading"><div><h3>Distribuição de IA</h3><p>Define quais executores a missão pode usar. Não define o papel nem autoriza um papel a fugir do contrato.</p></div></div><div className="roster-presets">{FORMACOES.map((formacao) => <button type="button" key={formacao.id} className="pilula" title={formacao.explica} onClick={() => onMudar(formacao.monta(ligados.map((provider) => provider.id)))}>{formacao.label}</button>)}</div><div className="elenco">{ligados.map((provider) => { const fixo = elenco.porCli?.[provider.id] ?? {}; return <div key={provider.id} className={`elenco-linha${ativo(provider.id) ? " on" : ""}`}><button type="button" className="elenco-nome" onClick={() => alternar(provider.id)}><i /><b>{NOME_CLI[provider.id] ?? provider.id}</b></button>{ativo(provider.id) && <div className="elenco-ajuste"><select className="campo mini" value={fixo.model ?? ""} onChange={(event) => fixar(provider.id, "model", event.target.value)}><option value="">modelo do perfil</option>{provider.modelos.map((model) => { const label = provider.nomesModelos?.[model]; return <option key={model} value={model}>{label && label !== model ? `${label} (${model})` : model}</option>; })}</select><select className="campo mini" value={fixo.effort ?? ""} onChange={(event) => fixar(provider.id, "effort", event.target.value)}><option value="">esforço do perfil</option>{(provider.efforts ?? []).map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select>{provider.id === "agy" && <button type="button" className={`pilula${visual(provider.id) ? " on" : ""}`} onClick={() => alternarVisual(provider.id)}>somente mídia</button>}</div>}</div>; })}</div>{elenco.clis.length === 0 && <p className="dica">Nenhum executor fixado: cada papel usará o perfil padrão correspondente.</p>}{elenco.clis.length > 0 && elenco.clis.every((cli) => (elenco.soVisual ?? []).includes(cli)) && <p className="dica">A distribuição só tem executores de mídia; escolha um executor de implementação para papéis de engenharia.</p>}</section>;
}

function RoleChooser({ roles, selected, onToggle }: { roles: RoleDefinition[]; selected: string[]; onToggle: (id: string) => void }) {
  return <section className="mission-role-picker"><div className="mission-section-heading"><div><h3>Composição por papel</h3><p>Escolha competências, não perfis de modelo. As 8 posições principais cobrem o fluxo completo; especializações auxiliares entram quando necessário.</p></div><span className="selection-count">{selected.length} selecionado{selected.length === 1 ? "" : "s"}</span></div><div className="mission-role-grid">{ROLE_CATEGORY_ORDER.map((category) => { const categoryRoles = roles.filter((role) => role.category === category); if (categoryRoles.length === 0) return null; return <div className="mission-role-group" key={category}><span className="mission-role-group-title">{roleCategoryLabel(category)}</span>{categoryRoles.map((role) => <button type="button" key={role.id} className={`mission-role-card${selected.includes(role.id) ? " on" : ""}${role.primary ? " primary" : " auxiliary"}`} style={{ "--role-color": role.color } as CSSProperties} onClick={() => onToggle(role.id)}><span className="mission-role-card-top"><span className="mission-role-dot" /><b>{role.label}</b></span><span>{role.description}</span><small>Abrange: {(role.incorporates ?? []).join(" · ")}</small>{role.id === "maestro" && <small>Nos modos autônomo e agêntico, entra automaticamente.</small>}<small>Entrega: {role.deliverables[0]}</small></button>)}</div>; })}</div></section>;
}

export function NovaMissao({ agents, squads, tarefas, providers, receitas, onCriar, onCancelar }: { agents: Record<string, AgentSpec>; squads: Record<string, SquadSpec>; tarefas: Record<string, TipoTarefa>; providers: Provider[]; receitas: Record<string, Receita>; onCriar: (plano: Plano) => void; onCancelar: () => void }) {
  const ligados = useMemo(() => providers.filter((provider) => provider.disponivel && provider.id !== "bash"), [providers]);
  const roleOptions = useMemo(() => CATALOG_ROLES, []);
  const recommendedRoleOptions = useMemo(() => {
    const preferred = ["builder", "scout", "architect", "debugger", "reviewer", "verifier", "finalizer", "maestro"];
    return preferred.map((id) => roleOptions.find((role) => role.id === id)).filter((role): role is RoleDefinition => Boolean(role));
  }, [roleOptions]);
  const availableProfiles = useMemo(() => Object.entries(agents).filter(([, agent]) => agent.cli !== "bash" && providers.some((provider) => provider.id === agent.cli && provider.disponivel)), [agents, providers]);
  const [nome, setNome] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [modo, setModo] = useState<Modo>("livre");
  const [squad, setSquad] = useState(Object.keys(squads)[0] ?? "");
  const [tipo, setTipo] = useState("");
  const [quantos, setQuantos] = useState(1);
  const [papeisSelecionados, setPapeisSelecionados] = useState<string[]>([]);
  const [elenco, setElenco] = useState<Elenco>(() => ({ clis: ["claude", "codex", "agy"].filter((cli) => providers.some((provider) => provider.id === cli && provider.disponivel)), soVisual: providers.some((provider) => provider.id === "agy" && provider.disponivel) ? ["agy"] : [] }));
  const [receita, setReceita] = useState("");
  const [cobertos, setCobertos] = useState<Set<string>>(new Set());

  const cobre = (campo: string) => cobertos.has(campo);
  const usarReceita = (id: string, formacao: Receita) => {
    setReceita(id);
    const respondidos = new Set<string>();
    if (formacao.modo) { setModo(formacao.modo as Modo); respondidos.add("modo"); }
    if (formacao.squad) { setSquad(formacao.squad); respondidos.add("squad"); }
    if (formacao.tipo) { setTipo(formacao.tipo); respondidos.add("tipo"); }
    if (formacao.paineis) { setQuantos(formacao.paineis); respondidos.add("paineis"); }
    if (formacao.agent) { const source = agents[formacao.agent]; setPapeisSelecionados([source ? roleIdFromAgent(formacao.agent, source) : "builder"]); respondidos.add("papeis"); }
    if (formacao.elenco) setElenco((current) => juntarElenco(current, formacao.elenco!));
    setCobertos(respondidos);
  };
  const alternarPapel = (id: string) => setPapeisSelecionados((current) => current.includes(id) ? current.filter((role) => role !== id) : [...current, id]);

  const papeisFinais = useMemo(() => {
    if (modo === "autonomo" || modo === "agentico") return ["maestro"];
    if (modo === "squad") return (squads[squad]?.fases[0]?.agentes ?? []).map((agentId) => { const source = agents[agentId]; return source ? roleIdFromAgent(agentId, source) : "builder"; });
    if (papeisSelecionados.length > 0) return papeisSelecionados;
    return recommendedRoleOptions.slice(0, quantos).map((role) => role.id);
  }, [agents, modo, papeisSelecionados, quantos, recommendedRoleOptions, squad, squads]);
  const executorForRole = (role: RoleDefinition): string | undefined => {
    const allowed = new Set(elenco.clis);
    const candidate = agentForRole(agents, role);
    const available = ligados.map((provider) => provider.id).filter((cli) => allowed.size === 0 || allowed.has(cli));
    const visualOnly = new Set(elenco.soVisual ?? []);
    const eligible = available.filter((cli) => role.id === "artista" || !visualOnly.has(cli));
    const ordered = (role.suggestedRunners ?? []).filter((runner) => eligible.includes(runner));
    const candidateRunner = candidate ? agents[candidate]?.cli : undefined;
    return ordered[0] ?? (candidateRunner && eligible.includes(candidateRunner) ? candidateRunner : eligible[0]);
  };
  const resolved = papeisFinais.map((roleId) => {
    const role = roleDefinitionFor(roleId);
    const runner = executorForRole(role);
    const agent = agentForRole(agents, role, runner ? new Set([runner]) : new Set());
    return { role, agent, runner };
  });
  const agentesFinais = resolved.map((item) => item.agent).filter((agent): agent is string => Boolean(agent));
  const runnersFinais = resolved.map((item) => item.runner ?? "");
  const pronto = nome.trim().length > 0 && resolved.length > 0 && resolved.every((item) => Boolean(item.agent && item.runner));

  return <div className="wizard mission-wizard"><header className="wizard-topo"><div><span className="wizard-kicker">ORQUESTRAÇÃO</span><h2>Nova missão</h2><p>Defina o objetivo, a autoridade e a formação. Os papéis continuam soberanos dentro da missão.</p></div><button type="button" className="btn quiet" onClick={onCancelar} aria-label="Fechar nova missão">✕</button></header><div className="wizard-corpo">
    {Object.keys(receitas).length > 0 && <section className="mission-recipe-strip"><div className="mission-section-heading"><div><h3>Começar de uma receita</h3><p>Uma formação comprovada preenche decisões; você pode revisar qualquer uma delas.</p></div></div><div className="receitas-linha"><button type="button" className={`carta${receita === "" ? " on" : ""}`} onClick={() => { setReceita(""); setCobertos(new Set()); }}><b>Do zero</b><span>Definir o plano manualmente.</span></button>{Object.entries(receitas).map(([id, formacao]) => <button type="button" key={id} className={`carta${receita === id ? " on" : ""}`} onClick={() => usarReceita(id, formacao)}><b>{formacao.label}</b><span>{formacao.descricao}</span></button>)}</div></section>}
    <div className="mission-brief-grid"><label className="campo-bloco"><span className="rotulo">Nome da missão</span><input className="campo" autoFocus placeholder="auth-refactor" value={nome} onChange={(event) => setNome(event.target.value)} maxLength={120} /></label><label className="campo-bloco"><span className="rotulo">Objetivo <em>é o contexto compartilhado</em></span><textarea className="campo area" rows={3} placeholder="O resultado que precisa existir ao final da missão." value={objetivo} onChange={(event) => setObjetivo(event.target.value)} maxLength={64000} /></label></div>
    <Elencar providers={providers} elenco={elenco} onMudar={setElenco} />
    {cobre("modo") ? <Resolvido rotulo="Modo" valor={MODOS.find((item) => item.id === modo)?.label ?? modo} onMudar={() => setCobertos((current) => new Set([...current].filter((item) => item !== "modo")))} /> : <section className="mission-mode-picker"><div className="mission-section-heading"><div><h3>Modo de coordenação</h3><p>Escolha quanta autonomia o Orquestrador possui. O modo não altera os contratos dos papéis.</p></div></div><div className="modo-grid">{MODOS.map((item) => <button type="button" key={item.id} className={`carta${modo === item.id ? " on" : ""}`} onClick={() => setModo(item.id)}><b>{item.label}</b><span>{item.explica}</span></button>)}</div></section>}
    {modo === "squad" && (cobre("squad") ? <Resolvido rotulo="Squad" valor={squads[squad]?.label ?? squad} onMudar={() => setCobertos((current) => new Set([...current].filter((item) => item !== "squad")))} /> : <section className="mission-squad-picker"><div className="mission-section-heading"><div><h3>Formação do squad</h3><p>As fases existentes continuam responsáveis por montar seus próprios painéis.</p></div></div><div className="cartas">{Object.entries(squads).map(([id, formation]) => <button type="button" key={id} className={`carta${squad === id ? " on" : ""}`} onClick={() => setSquad(id)}><b>{formation.label}</b><span>{formation.descricao}</span><small className="fases-mini">{formation.fases.map((phase) => phase.nome).join(" → ")}</small></button>)}</div></section>)}
    {modo !== "squad" && <RoleChooser roles={roleOptions} selected={papeisSelecionados} onToggle={alternarPapel} />}
    {modo !== "squad" && <section className="mission-panel-count"><div><h3>{papeisSelecionados.length > 0 ? "Papéis escolhidos" : "Formação recomendada"}</h3><p>{papeisSelecionados.length > 0 ? "Um painel será aberto para cada papel selecionado." : "Escolha uma quantidade para preencher com papéis diferentes; depois você pode ajustar a composição."}</p></div>{papeisSelecionados.length === 0 && <div className="pilulas">{QUANTIDADES.map((quantity) => <button type="button" key={quantity} className={`pilula${quantos === quantity ? " on" : ""}`} onClick={() => setQuantos(quantity)}>{quantity}</button>)}</div>}</section>}
    {modo !== "squad" && <section className="mission-resolution"><div className="mission-section-heading"><div><h3>Resolução antes de abrir</h3><p>O papel é semântico; o Cockpit só então escolhe o perfil e o executor permitido.</p></div></div><div className="mission-resolution-list">{resolved.map((item, index) => <div className="mission-resolution-row" key={`${item.role.id}-${index}`}><span className="mission-resolution-role" style={{ "--role-color": item.role.color } as React.CSSProperties}><i />{item.role.label}</span><span className="mission-resolution-arrow">→</span><b>{item.agent ? (agents[item.agent]?.label ?? item.agent) : "perfil indisponível"}</b><span className="mission-resolution-runner">{item.runner ? (NOME_CLI[item.runner] ?? item.runner) : "executor indisponível"}</span></div>)}</div></section>}
    <section className="mission-profile-note"><div className="mission-section-heading"><div><h3>Perfis técnicos encontrados</h3><p>Esta lista é apenas a infraestrutura interna; a missão continua sendo definida pelos papéis acima.</p></div></div><div className="agentes">{availableProfiles.map(([id, a]) => <span className="mission-profile" key={id}><b>{a.label}</b><small>{a.papel ?? a.label}</small></span>)}</div></section>
    {modo !== "squad" && cobre("tipo") ? <Resolvido rotulo="Contexto de tarefa" valor={tarefas[tipo]?.label ?? tipo} nota="não troca papel nem modelo" onMudar={() => setCobertos((current) => new Set([...current].filter((item) => item !== "tipo")))} /> : <section className="mission-task-type"><div className="mission-section-heading"><div><h3>Contexto do trabalho <em>opcional</em></h3><p>Ajuda a organizar a missão, mas não pode substituir o papel nem escolher um modelo por você.</p></div></div><div className="pilulas"><button type="button" className={`pilula${tipo === "" ? " on" : ""}`} onClick={() => setTipo("")}>padrão</button>{Object.entries(tarefas).map(([id, task]) => <button type="button" key={id} className={`pilula${tipo === id ? " on" : ""}`} onClick={() => setTipo(id)} title={task.descricao}>{task.label}</button>)}</div>{tipo && tarefas[tipo] && <p className="dica">{tarefas[tipo]!.descricao}</p>}</section>}
    <div className="mission-final-summary"><span className="summary-status" data-ready={pronto ? "yes" : "no"}>{pronto ? "Pronto para abrir" : "Falta definir a formação"}</span><span>{resolved.map((item) => item.role.label).join(" · ") || "Nenhum papel selecionado"}</span></div>
  </div><footer className="wizard-pe"><button type="button" className="btn quiet" onClick={onCancelar}>Cancelar</button><button type="button" className="btn solid" disabled={!pronto} onClick={() => onCriar({ nome: nome.trim(), objetivo: objetivo.trim(), modo, squad, agentes: agentesFinais, papeis: resolved.map((item) => item.role.id), runners: runnersFinais, tipo, receita: receita || undefined, skills: receitas[receita]?.skills, elenco: elenco.clis.length > 0 ? elenco : undefined })}>Criar missão <span>→</span></button></footer></div>;
}
