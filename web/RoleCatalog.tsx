import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Mascote } from "./Mascote.tsx";
import { Icon } from "./Icon.tsx";
import {
  CATALOG_ROLES,
  CANONICAL_RUNNERS,
  type RoleDefinition,
  type RunnerId,
} from "./tipos.ts";
import {
  roleCategoryLabel,
  roleContractPayload,
  roleDefinitionFor,
  type RoleContractPayload,
} from "./role-contract.ts";
import { type Provider, type StatusPonte, type Elenco, openLoginTerminal } from "./api.ts";

export interface RoleCatalogProps {
  onLaunch: (params: {
    role: string;
    model: string | null;
    runner: RunnerId;
    effort?: string | null;
    tarefa?: string;
    label?: string;
    customRole?: RoleDefinition;
    roleDefinition?: RoleContractPayload;
    preferredAccountId?: string;
    accountPinned?: boolean;
    backend?: "pty" | "dsh";
  }) => void;
  onCancel: () => void;
  providers?: Provider[];
  pontes?: StatusPonte[];
  elenco?: Elenco;
  defaultRole?: string;
  defaultRunner?: RunnerId;
  missionId?: string;
}

const FALLBACK_EFFORTS = ["low", "medium", "high", "xhigh"];

function firstModel(provider: Provider | undefined): string {
  return provider?.modelos?.[0] ?? "";
}

function splitLines(value: string, fallback: string[]): string[] {
  const items = value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  return items.length > 0 ? items : fallback;
}

function ContractList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="role-contract-list">
      <b>{title}</b>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

export function RoleCatalog({
  onLaunch,
  onCancel,
  providers = [],
  pontes = [],
  elenco,
  defaultRole = "builder",
  defaultRunner = "bash",
  missionId,
}: RoleCatalogProps) {
  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [selectedRole, setSelectedRole] = useState(defaultRole);
  const [selectedRunner, setSelectedRunner] = useState<RunnerId>(defaultRunner);
  const [selectedBackend, setSelectedBackend] = useState<"pty" | "dsh">("pty");
  const [selectedModel, setSelectedModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [selectedEffort, setSelectedEffort] = useState("");
  const [tarefa, setTarefa] = useState("");
  const [preferredAccountId, setPreferredAccountId] = useState("");
  const [accountPinned, setAccountPinned] = useState(false);
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const [customRoles, setCustomRoles] = useState<RoleDefinition[]>([]);
  const [criandoCustom, setCriandoCustom] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customCategory, setCustomCategory] = useState<RoleDefinition["category"]>("custom");
  const [customDescription, setCustomDescription] = useState("");
  const [customOutcome, setCustomOutcome] = useState("");
  const [customOwns, setCustomOwns] = useState("");
  const [customDoesNotOwn, setCustomDoesNotOwn] = useState("");
  const [customGates, setCustomGates] = useState("");
  const [customDeliverables, setCustomDeliverables] = useState("");
  const [customColor, setCustomColor] = useState("#388bfd");

  const allRoles = useMemo(() => [...CATALOG_ROLES, ...customRoles], [customRoles]);
  const currentRole = useMemo(
    () => roleDefinitionFor(selectedRole, customRoles),
    [customRoles, selectedRole],
  );
  const selectedProvider = providers.find((provider) => provider.id === selectedRunner);
  const runners = useMemo(() => [
    ...CANONICAL_RUNNERS,
    ...providers
      .filter((provider) => provider.backend === "dsh" && !CANONICAL_RUNNERS.some((runner) => runner.id === provider.id))
      .map((provider) => ({
        id: provider.id,
        label: provider.dshApi?.label ?? provider.id.replace(/[-_]+/g, " "),
        badge: "API direta · DSH",
        description: "Modelo de API configurado no Cockpit; usa mensagens estruturadas do DSH.",
        installed: provider.disponivel,
        isAi: true,
        icon: "agent",
      })),
  ], [providers]);
  const availableModels = useMemo(() => {
    if (selectedRunner === "bash") return [];
    if (selectedRunner === "openrouter") {
      const bridge = pontes.find((item) => item.id === "openrouter");
      return [...new Set((bridge?.modelos ?? selectedProvider?.modelos ?? []).map((model) => typeof model === "string" ? model.trim() : model.id.trim()).filter(Boolean))];
    }
    return [...new Set((selectedProvider?.modelos ?? []).map((model) => model.trim()).filter(Boolean))];
  }, [pontes, selectedProvider, selectedRunner]);
  const availableEfforts = selectedProvider?.efforts?.length ? selectedProvider.efforts : FALLBACK_EFFORTS;
  const poolDoCockpitAtivo = selectedBackend === "pty";
  const contasPool = poolDoCockpitAtivo ? selectedProvider?.pool?.contas ?? [] : [];
  const contasElegiveis = contasPool.filter((account) => account.status === "livre" && account.authenticated !== false);
  const contasNaoAutenticadas = contasPool.filter((account) => account.authenticated === false);
  const aiDisponivel = (runner: RunnerId) => {
    if (runner === "bash") return true;
    return providers.find((provider) => provider.id === runner)?.disponivel === true;
  };
  const foraDoElenco = (runner: RunnerId) => runner !== "bash" && Boolean(elenco?.clis?.length) && !elenco!.clis.includes(runner);

  useEffect(() => {
    const provider = providers.find((item) => item.id === selectedRunner);
    setSelectedBackend(provider?.backend ?? (selectedRunner === "codex" || selectedRunner === "claude" ? "dsh" : "pty"));
  }, [providers, selectedRunner]);

  useEffect(() => {
    if (selectedRunner === "bash") {
      setSelectedModel("");
      setCustomModel("");
      setSelectedEffort("");
      setPreferredAccountId("");
      setAccountPinned(false);
      return;
    }
    setSelectedModel((current) => current && availableModels.includes(current) ? current : firstModel(selectedProvider));
    setSelectedEffort((current) => current && availableEfforts.includes(current) ? current : "");
  }, [availableEfforts, availableModels, selectedProvider, selectedRunner]);

  const handleSelectRunner = (runner: RunnerId) => {
    if (!aiDisponivel(runner) || foraDoElenco(runner)) return;
    setSelectedRunner(runner);
    setSelectedModel(firstModel(providers.find((provider) => provider.id === runner)));
    setCustomModel("");
    setSelectedEffort("");
    setPreferredAccountId("");
    setAccountPinned(false);
    setLoginMsg(null);
  };

  const handleSaveCustomRole = (event: FormEvent) => {
    event.preventDefault();
    const base = roleDefinitionFor("builder");
    const label = customLabel.trim();
    if (!label) return;
    const id = `custom-${Date.now().toString(36)}`;
    const customRole: RoleDefinition = {
      id,
      label,
      category: customCategory,
      color: customColor,
      icon: "agent",
      description: customDescription.trim() || base.description,
      outcome: customOutcome.trim() || base.outcome,
      owns: splitLines(customOwns, base.owns),
      doesNotOwn: splitLines(customDoesNotOwn, base.doesNotOwn),
      qualityGates: splitLines(customGates, base.qualityGates),
      deliverables: splitLines(customDeliverables, base.deliverables),
      incorporates: ["Especialista customizado"],
      baseAgent: "builder",
    };
    setCustomRoles((roles) => [...roles, customRole]);
    setSelectedRole(id);
    setCriandoCustom(false);
    setCustomLabel("");
    setCustomDescription("");
    setCustomOutcome("");
    setCustomOwns("");
    setCustomDoesNotOwn("");
    setCustomGates("");
    setCustomDeliverables("");
  };

  const handleFinish = () => {
    const finalModel = selectedRunner === "bash" ? null : customModel.trim() || selectedModel || null;
    const customRole = customRoles.find((role) => role.id === currentRole.id);
    onLaunch({
      role: currentRole.id,
      roleDefinition: customRole ? roleContractPayload(customRole) : undefined,
      runner: selectedRunner,
      model: finalModel,
      effort: selectedRunner === "bash" ? null : selectedEffort || null,
      tarefa: tarefa.trim() || undefined,
      label: currentRole.label,
      customRole,
      preferredAccountId: preferredAccountId.trim() || undefined,
      accountPinned: Boolean(preferredAccountId.trim() && accountPinned),
      backend: selectedRunner === "codex" || selectedRunner === "claude" ? selectedBackend : undefined,
    });
  };

  return (
    <div className="role-catalog-wizard">
      <nav className="catalog-breadcrumbs" aria-label="Progresso da configuração">
        <button type="button" className={`crumb${etapa === 1 ? " active" : ""}${etapa > 1 ? " completed" : ""}`} onClick={() => setEtapa(1)}>
          <span className="crumb-num">1</span><span className="crumb-text">Papel <b>{currentRole.label}</b></span>
        </button>
        <span className="crumb-sep">›</span>
        <button type="button" className={`crumb${etapa === 2 ? " active" : ""}${etapa > 2 ? " completed" : ""}`} onClick={() => setEtapa(2)}>
          <span className="crumb-num">2</span><span className="crumb-text">Execução <b>{selectedRunner === "bash" ? "SHELL limpo" : selectedRunner.toUpperCase()}</b></span>
        </button>
        {selectedRunner !== "bash" && <><span className="crumb-sep">›</span><button type="button" className={`crumb${etapa === 3 ? " active" : ""}`} onClick={() => setEtapa(3)}><span className="crumb-num">3</span><span className="crumb-text">Revisão <b>{customModel || selectedModel || "padrão"}</b></span></button></>}
      </nav>

      {etapa === 1 && !criandoCustom && (
        <section className="catalog-step" aria-label="Escolha do papel semântico">
          <div className="step-header"><h3>Qual trabalho este painel possui?</h3><p>Escolha uma identidade funcional. As 8 posições principais cobrem o ciclo completo; cada uma incorpora funções auxiliares sem misturar responsabilidades. Executor, modelo e conta ficam separados.</p></div>
          <div className="role-catalog-layout">
            <div className="role-grid" role="radiogroup" aria-label="Papéis oficiais">
              <div className="role-group role-primary-group">
                <div className="role-group-title">8 posições principais · fluxo de missão</div>
                <div className="role-flow-grid">
                  {allRoles.filter((role) => role.primary).map((role) => <button key={role.id} type="button" role="radio" aria-checked={selectedRole === role.id} className={`role-tile${selectedRole === role.id ? " selected" : ""}`} style={{ "--role-color": role.color } as CSSProperties} onClick={() => setSelectedRole(role.id)}><div className="role-tile-top"><Mascote semente={role.id} cor={role.color} estado="neutro" tamanho={34} /><div className="role-tile-title"><span className="role-name">{role.label}</span><span className="role-category">{roleCategoryLabel(role.category)}</span></div></div><p className="role-desc">{role.description}</p><span className="role-functions">Abrange: {(role.incorporates ?? []).join(" · ")}</span></button>)}
                </div>
              </div>
              {allRoles.some((role) => !role.primary) && <div className="role-group role-auxiliary-group">
                <div className="role-group-title">Especializações auxiliares e customizados</div>
                <div className="role-flow-grid">
                  {allRoles.filter((role) => !role.primary).map((role) => <button key={role.id} type="button" role="radio" aria-checked={selectedRole === role.id} className={`role-tile${selectedRole === role.id ? " selected" : ""}`} style={{ "--role-color": role.color } as CSSProperties} onClick={() => setSelectedRole(role.id)}><div className="role-tile-top"><Mascote semente={role.id} cor={role.color} estado="neutro" tamanho={34} /><div className="role-tile-title"><span className="role-name">{role.label}</span><span className="role-category">{roleCategoryLabel(role.category)}</span></div></div><p className="role-desc">{role.description}</p><span className="role-functions">Abrange: {(role.incorporates ?? []).join(" · ")}</span></button>)}
                  <button type="button" className="role-tile custom-trigger" onClick={() => setCriandoCustom(true)}><div className="custom-plus-icon"><Icon name="plus" size={22} /></div><span className="role-name">Criar papel limitado</span><p className="role-desc">Começa do contrato de Construtor e exige limites explícitos.</p></button>
                </div>
              </div>}
            </div>
            <aside className="role-contract-card" aria-label={`Contrato de ${currentRole.label}`}>
              <div className="role-contract-heading"><Mascote semente={currentRole.id} cor={currentRole.color} estado="neutro" tamanho={28} /><div><span className="role-contract-kicker">Contrato oficial</span><h4>{currentRole.label}</h4></div></div>
              <p className="role-contract-outcome"><b>Resultado:</b> {currentRole.outcome}</p>
              <ContractList title="Funções incorporadas" items={currentRole.incorporates ?? []} />
              <ContractList title="Possui" items={currentRole.owns} />
              <ContractList title="Não possui" items={currentRole.doesNotOwn} />
              <ContractList title="Entrega" items={currentRole.deliverables} />
            </aside>
          </div>
          <footer className="catalog-actions"><button type="button" className="btn quiet" onClick={onCancel}>Cancelar</button><button type="button" className="btn solid" onClick={() => setEtapa(2)}>Continuar com {currentRole.label} <Icon name="arrow" size={15} /></button></footer>
        </section>
      )}

      {criandoCustom && (
        <form className="custom-role-form" onSubmit={handleSaveCustomRole}>
          <div className="step-header"><h3>Defina um papel com limites</h3><p>Um papel customizado sempre herda a execução de Construtor. Descreva o contrato, não o modelo.</p></div>
          <div className="custom-role-grid">
            <label className="campo-bloco"><span className="rotulo">Nome</span><input className="campo" value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} placeholder="ex.: Especialista em migração" maxLength={80} required /></label>
            <label className="campo-bloco"><span className="rotulo">Categoria</span><select className="campo" value={customCategory} onChange={(event) => setCustomCategory(event.target.value as RoleDefinition["category"])}><option value="engenharia">Engenharia</option><option value="design">Design & UX</option><option value="qualidade">Qualidade</option><option value="pesquisa">Pesquisa</option><option value="midia">Mídia</option><option value="coordenacao">Coordenação</option><option value="custom">Customizado</option></select></label>
            <label className="campo-bloco"><span className="rotulo">Cor</span><input type="color" className="campo campo-color" value={customColor} onChange={(event) => setCustomColor(event.target.value)} /></label>
          </div>
          <label className="campo-bloco"><span className="rotulo">Propósito</span><textarea className="campo area" rows={2} value={customDescription} onChange={(event) => setCustomDescription(event.target.value)} placeholder="Qual competência este papel representa?" maxLength={600} /></label>
          <label className="campo-bloco"><span className="rotulo">Resultado esperado</span><textarea className="campo area" rows={2} value={customOutcome} onChange={(event) => setCustomOutcome(event.target.value)} placeholder="Como saberemos que o papel entregou valor?" maxLength={600} /></label>
          <div className="custom-role-grid custom-role-contract-fields">
            <label className="campo-bloco"><span className="rotulo">Possui <em>um item por linha</em></span><textarea className="campo area" rows={4} value={customOwns} onChange={(event) => setCustomOwns(event.target.value)} placeholder="analisar contexto\nimplementar a mudança" maxLength={3000} /></label>
            <label className="campo-bloco"><span className="rotulo">Não possui <em>um item por linha</em></span><textarea className="campo area" rows={4} value={customDoesNotOwn} onChange={(event) => setCustomDoesNotOwn(event.target.value)} placeholder="trocar o escopo\nalterar credenciais" maxLength={3000} /></label>
            <label className="campo-bloco"><span className="rotulo">Critérios de qualidade <em>um item por linha</em></span><textarea className="campo area" rows={4} value={customGates} onChange={(event) => setCustomGates(event.target.value)} placeholder="validar o resultado\nregistrar evidências" maxLength={3000} /></label>
            <label className="campo-bloco"><span className="rotulo">Entregas <em>um item por linha</em></span><textarea className="campo area" rows={4} value={customDeliverables} onChange={(event) => setCustomDeliverables(event.target.value)} placeholder="arquivos alterados\nrelatório final" maxLength={3000} /></label>
          </div>
          <footer className="catalog-actions"><button type="button" className="btn quiet" onClick={() => setCriandoCustom(false)}>Voltar ao catálogo</button><button type="submit" className="btn solid" disabled={!customLabel.trim()}>Salvar papel</button></footer>
        </form>
      )}

      {etapa === 2 && (
        <section className="catalog-step" aria-label="Escolha do executor">
          <div className="step-header"><h3>Onde {currentRole.label} vai executar?</h3><p>O executor é a infraestrutura. Ele não muda o contrato do papel e não pode ser trocado silenciosamente.</p></div>
          <div className="runner-grid" role="radiogroup" aria-label="Executores disponíveis">
            {runners.map((runner) => {
              const unavailable = !aiDisponivel(runner.id);
              const outside = foraDoElenco(runner.id);
              return <button key={runner.id} type="button" role="radio" aria-checked={selectedRunner === runner.id} className={`runner-tile${selectedRunner === runner.id ? " selected" : ""}${unavailable || outside ? " disabled" : ""}`} disabled={unavailable || outside} onClick={() => handleSelectRunner(runner.id)}><div className="runner-tile-head"><span className="runner-tile-label">{runner.label}</span><span className={`runner-badge ${runner.id}`}>{runner.badge}</span></div><p className="runner-desc">{runner.description}</p>{outside && <span className="runner-warning">Fora do elenco desta missão</span>}{unavailable && !outside && <span className="runner-warning">Executor não detectado no host</span>}</button>;
            })}
          </div>
          {(selectedRunner === "codex" || selectedRunner === "claude") && <div className="backend-choice"><div><b>Transporte da sessão</b><p>{selectedBackend === "dsh" ? "DSH recebe prompts como mensagens estruturadas e mantém o Shell separado." : "PTY emula o terminal clássico e preserva a interação direta do CLI."}</p></div><div className="backend-choice-buttons"><button type="button" className={`btn mini${selectedBackend === "dsh" ? " solid" : ""}`} onClick={() => setSelectedBackend("dsh")}>DSH estruturado</button><button type="button" className={`btn mini${selectedBackend === "pty" ? " solid" : ""}`} onClick={() => setSelectedBackend("pty")}>PTY clássico</button></div></div>}
          {selectedProvider?.backend === "dsh" && selectedRunner !== "codex" && selectedRunner !== "claude" && <div className="backend-choice"><div><b>DSH estruturado</b><p>Esta API é exclusiva do DSH. A chave fica no cofre do Cockpit e o modelo recebe prompts estruturados.</p></div></div>}
          {selectedRunner === "bash" && <div className="sovereign-bash-banner"><div className="banner-icon"><Icon name="terminal" size={20} /></div><div className="banner-content"><strong>SHELL limpo e soberano</strong><p>Abre estritamente como <code>/bin/bash -i -l</code>. Sem prompt interno, sem LLM no boot e sem instruções ocultas.</p></div></div>}
          <footer className="catalog-actions"><button type="button" className="btn quiet" onClick={() => setEtapa(1)}>Voltar ao papel</button>{selectedRunner === "bash" ? <button type="button" className="btn solid bash-launch" onClick={handleFinish}>Abrir SHELL limpo</button> : <button type="button" className="btn solid" onClick={() => setEtapa(3)}>Configurar parâmetros <Icon name="arrow" size={15} /></button>}</footer>
        </section>
      )}

      {etapa === 3 && selectedRunner !== "bash" && (
        <section className="catalog-step" aria-label="Revisão da configuração">
          <div className="step-header"><h3>Revise antes de abrir</h3><p>O contrato de {currentRole.label} será aplicado no backend a cada sessão de IA.</p></div>
          <div className="launch-summary"><div><span>Papel</span><b>{currentRole.label}</b><small>{currentRole.outcome}</small></div><div><span>Executor</span><b>{selectedRunner.toUpperCase()} · {selectedBackend.toUpperCase()}</b><small>O executor não redefine responsabilidades.</small></div></div>
          {selectedBackend === "dsh" && <p className="dica dsh-role-note">Este painel usa o DSH. O pool de contas do Cockpit fica reservado ao PTY tradicional; no gateway, a rotação pertence ao provedor configurado.</p>}
          <label className="campo-bloco"><span className="rotulo">Modelo <em>opcional; vazio usa o padrão real do executor</em></span><select className="campo" value={selectedModel} onChange={(event) => { setSelectedModel(event.target.value); setCustomModel(""); }}><option value="">Padrão do executor</option>{availableModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
          <label className="campo-bloco"><span className="rotulo">Ou informar um modelo</span><input className="campo" value={customModel} onChange={(event) => setCustomModel(event.target.value)} placeholder="somente se o executor aceitar" maxLength={160} /></label>
          <label className="campo-bloco"><span className="rotulo">Esforço</span><select className="campo" value={selectedEffort} onChange={(event) => setSelectedEffort(event.target.value)}><option value="">Padrão do provedor</option>{availableEfforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select></label>
          {contasNaoAutenticadas.length > 0 && <div className="aviso-contas-auth"><div className="auth-warning-heading"><b>Autenticação pendente</b><span>{loginMsg}</span></div>{contasNaoAutenticadas.map((account) => <div className="auth-account-row" key={account.id}><span><b>{account.label || account.id}</b><code>{account.id}</code></span><button type="button" className="btn mini" onClick={async () => { setLoginMsg(`Abrindo login para ${account.label || account.id}…`); try { const result = await openLoginTerminal(selectedRunner, account.id, missionId); if (!result.ok) throw new Error(result.error || "falha ao abrir"); setLoginMsg("Terminal de login aberto"); } catch (error) { setLoginMsg(error instanceof Error ? error.message : String(error)); } }}>Fazer login</button></div>)}</div>}
          {contasElegiveis.length > 0 && <><label className="campo-bloco"><span className="rotulo">Conta do pool</span><select className="campo" value={preferredAccountId} onChange={(event) => { setPreferredAccountId(event.target.value); if (!event.target.value) setAccountPinned(false); }}><option value="">Automático (pool escolhe)</option>{contasElegiveis.map((account) => <option key={account.id} value={account.id}>{account.label || account.id}</option>)}</select></label><label className={`account-pin${preferredAccountId ? "" : " disabled"}`}><input type="checkbox" checked={accountPinned} disabled={!preferredAccountId} onChange={(event) => setAccountPinned(event.target.checked)} /><span><b>Fixar conta</b><small>Não fazer rotação automática se a cota acabar.</small></span></label></>}
          <label className="campo-bloco"><span className="rotulo">Tarefa inicial <em>opcional</em></span><textarea className="campo area" rows={3} value={tarefa} onChange={(event) => setTarefa(event.target.value)} placeholder={`O que ${currentRole.label} deve fazer primeiro?`} maxLength={64000} /></label>
          <div className="final-contract-note"><Icon name="agent" size={17} /><span><b>Contrato protegido</b><small>Se a tarefa pedir algo fora do papel, o agente deve explicar o conflito e escalar — não improvisar.</small></span></div>
          <footer className="catalog-actions"><button type="button" className="btn quiet" onClick={() => setEtapa(2)}>Voltar ao executor</button><button type="button" className="btn solid" onClick={handleFinish}>Abrir {currentRole.label}</button></footer>
        </section>
      )}
    </div>
  );
}
