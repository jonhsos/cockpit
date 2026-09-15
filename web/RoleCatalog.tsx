import { useState, useMemo, type CSSProperties } from "react";
import { Mascote } from "./Mascote.tsx";
import { Icon } from "./Icon.tsx";
import {
  CANONICAL_ROLES,
  CANONICAL_RUNNERS,
  type RoleDefinition,
  type RunnerId,
  type RunnerOption,
} from "./tipos.ts";
import type { Provider, StatusPonte, Elenco } from "./api.ts";

export interface RoleCatalogProps {
  onLaunch: (params: {
    role: string;
    runner: RunnerId;
    model: string | null;
    effort?: string | null;
    tarefa?: string;
    label?: string;
    customRole?: RoleDefinition;
  }) => void;
  onCancel: () => void;
  providers?: Provider[];
  pontes?: StatusPonte[];
  elenco?: Elenco;
  defaultRole?: string;
  defaultRunner?: RunnerId;
}

export function RoleCatalog({
  onLaunch,
  onCancel,
  providers = [],
  pontes = [],
  elenco,
  defaultRole = "builder",
  defaultRunner = "bash",
}: RoleCatalogProps) {
  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [selectedRole, setSelectedRole] = useState<string>(defaultRole);
  const [selectedRunner, setSelectedRunner] = useState<RunnerId>(defaultRunner);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [customModel, setCustomModel] = useState<string>("");
  const [selectedEffort, setSelectedEffort] = useState<string>("");
  const [tarefa, setTarefa] = useState<string>("");
  const [customRoles, setCustomRoles] = useState<RoleDefinition[]>([]);
  const [criandoCustom, setCriandoCustom] = useState(false);

  // Custom role form state
  const [customLabel, setCustomLabel] = useState("");
  const [customCategory, setCustomCategory] = useState<RoleDefinition["category"]>("custom");
  const [customDesc, setCustomDesc] = useState("");
  const [customColor, setCustomColor] = useState("#388bfd");

  const allRoles = useMemo(
    () => [...CANONICAL_ROLES, ...customRoles],
    [customRoles]
  );

  const currentRole = useMemo(
    () => allRoles.find((r) => r.id === selectedRole) || allRoles[0],
    [allRoles, selectedRole]
  );

  // Determine available models for selected runner
  const availableModels = useMemo<string[]>(() => {
    if (selectedRunner === "bash") return [];

    if (selectedRunner === "openrouter") {
      const ponte = pontes.find((p) => p.id === "openrouter");
      if (ponte && ponte.modelos.length > 0) {
        return ponte.modelos.map((m) => m.id);
      }
      return ["openrouter/free", "google/gemma-4", "anthropic/claude-3.7-sonnet", "openai/gpt-5"];
    }

    const prov = providers.find((p) => p.id === selectedRunner);
    if (prov && prov.modelos.length > 0) {
      return prov.modelos;
    }

    // Fallbacks per runner
    if (selectedRunner === "claude") {
      return ["opus", "sonnet", "haiku"];
    }
    if (selectedRunner === "codex") {
      return ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-reserve", "gpt-5.5"];
    }
    if (selectedRunner === "agy") {
      return ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.1-pro-high", "claude-opus-4-6-thinking", "claude-sonnet-4-6"];
    }
    if (selectedRunner === "grok") {
      return ["grok-4.6", "grok-4.5"];
    }

    return [];
  }, [selectedRunner, providers, pontes]);

  // When runner changes, set a sensible default model
  const handleSelectRunner = (runnerId: RunnerId) => {
    setSelectedRunner(runnerId);
    if (runnerId === "bash") {
      setSelectedModel("");
      setCustomModel("");
    } else {
      const prov = providers.find((p) => p.id === runnerId);
      const first = prov?.modelos[0] || (
        runnerId === "claude"
          ? "sonnet"
          : runnerId === "codex"
          ? "gpt-5.6-sol"
          : runnerId === "agy"
          ? "gemini-3.8-flash-high"
          : runnerId === "grok"
          ? "grok-4.6"
          : "openrouter/free"
      );
      setSelectedModel(first);
    }
  };

  const handleSalvarCustomRole = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customLabel.trim()) return;

    const id = `custom-${Date.now().toString(36)}`;
    const novaRole: RoleDefinition = {
      id,
      label: customLabel.trim(),
      category: customCategory,
      description: customDesc.trim() || "Papel customizado definido pelo usuário.",
      color: customColor,
      icon: "agent",
    };

    setCustomRoles((prev) => [...prev, novaRole]);
    setSelectedRole(id);
    setCriandoCustom(false);
    setCustomLabel("");
    setCustomDesc("");
  };

  const handleFinish = () => {
    const finalModel = selectedRunner === "bash" ? null : customModel.trim() || selectedModel || null;
    const isCustom = customRoles.find((r) => r.id === currentRole.id);

    onLaunch({
      role: currentRole.id,
      runner: selectedRunner,
      model: finalModel,
      effort: selectedEffort || null,
      tarefa: tarefa.trim() || undefined,
      label: currentRole.label,
      customRole: isCustom,
    });
  };

  return (
    <div className="role-catalog-wizard">
      {/* Wizard Step Breadcrumbs */}
      <nav className="catalog-breadcrumbs" aria-label="Progresso da criação de agente">
        <button
          type="button"
          className={`crumb${etapa === 1 ? " active" : ""}${etapa > 1 ? " completed" : ""}`}
          onClick={() => setEtapa(1)}
        >
          <span className="crumb-num">1</span>
          <span className="crumb-text">
            Papel: <b>{currentRole.label}</b>
          </span>
        </button>

        <span className="crumb-sep">›</span>

        <button
          type="button"
          className={`crumb${etapa === 2 ? " active" : ""}${etapa > 2 ? " completed" : ""}`}
          onClick={() => setEtapa(2)}
        >
          <span className="crumb-num">2</span>
          <span className="crumb-text">
            Executor: <b>{selectedRunner === "bash" ? "SHELL Limpo" : selectedRunner}</b>
          </span>
        </button>

        {selectedRunner !== "bash" && (
          <>
            <span className="crumb-sep">›</span>
            <button
              type="button"
              className={`crumb${etapa === 3 ? " active" : ""}`}
              onClick={() => setEtapa(3)}
            >
              <span className="crumb-num">3</span>
              <span className="crumb-text">
                Modelo: <b>{customModel || selectedModel || "Padrão"}</b>
              </span>
            </button>
          </>
        )}
      </nav>

      {/* =================================================================== */}
      {/* ETAPA 1: SELEÇÃO DE PAPEL FUNCIONAL (SEM NOMES DE MODELO!)          */}
      {/* =================================================================== */}
      {etapa === 1 && !criandoCustom && (
        <section className="catalog-step" aria-label="Escolha de papel funcional">
          <div className="step-header">
            <h3>Qual papel funcional entra na missão?</h3>
            <p>
              Papéis representam competências e responsabilidades puras. O executor e o modelo são desacoplados e definidos na etapa seguinte.
            </p>
          </div>

          <div className="role-grid" role="radiogroup" aria-label="Catálogo de Papéis">
            {allRoles.map((role) => {
              const isSelected = selectedRole === role.id;
              return (
                <button
                  key={role.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`role-tile${isSelected ? " selected" : ""}`}
                  style={{ "--role-color": role.color } as CSSProperties}
                  onClick={() => setSelectedRole(role.id)}
                >
                  <div className="role-tile-top">
                    <Mascote semente={role.id} cor={role.color} estado="neutro" tamanho={38} />
                    <div className="role-tile-title">
                      <span className="role-name">{role.label}</span>
                      <span className="role-category">{role.category}</span>
                    </div>
                  </div>
                  <p className="role-desc">{role.description}</p>
                </button>
              );
            })}

            <button
              type="button"
              className="role-tile custom-trigger"
              onClick={() => setCriandoCustom(true)}
            >
              <div className="custom-plus-icon">
                <Icon name="plus" size={24} />
              </div>
              <span className="role-name">Criar Papel Customizado</span>
              <p className="role-desc">Defina um novo papel com título, categoria e propósito sob medida.</p>
            </button>
          </div>

          <footer className="catalog-actions">
            <button type="button" className="btn quiet" onClick={onCancel}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn solid"
              onClick={() => setEtapa(2)}
            >
              Continuar com {currentRole.label} →
            </button>
          </footer>
        </section>
      )}

      {/* Modal / Inline form for Custom Role */}
      {criandoCustom && (
        <form className="custom-role-form" onSubmit={handleSalvarCustomRole}>
          <div className="step-header">
            <h3>Criar Papel Customizado</h3>
            <p>Nomeie o papel e forneça a sua diretiva funcional.</p>
          </div>

          <label className="campo-bloco">
            <span className="rotulo">Nome do Papel</span>
            <input
              type="text"
              autoFocus
              className="campo"
              placeholder="ex: Arquiteto de Dados, QA Automatizado, Tradutor"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              required
            />
          </label>

          <div className="custom-row">
            <label className="campo-bloco" style={{ flex: 1 }}>
              <span className="rotulo">Categoria</span>
              <select
                className="campo"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value as RoleDefinition["category"])}
              >
                <option value="engenharia">Engenharia</option>
                <option value="design">Design / UX</option>
                <option value="qualidade">Qualidade / Revisão</option>
                <option value="pesquisa">Pesquisa / Análise</option>
                <option value="midia">Mídia / Ativos</option>
                <option value="coordenacao">Coordenação</option>
                <option value="custom">Customizado</option>
              </select>
            </label>

            <label className="campo-bloco" style={{ width: 140 }}>
              <span className="rotulo">Cor de Identidade</span>
              <input
                type="color"
                className="campo campo-color"
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
              />
            </label>
          </div>

          <label className="campo-bloco">
            <span className="rotulo">Descrição / Propósito Funcional</span>
            <textarea
              className="campo area"
              rows={3}
              placeholder="Descreva o escopo e responsabilidades deste papel..."
              value={customDesc}
              onChange={(e) => setCustomDesc(e.target.value)}
            />
          </label>

          <footer className="catalog-actions">
            <button
              type="button"
              className="btn quiet"
              onClick={() => setCriandoCustom(false)}
            >
              Voltar ao Catálogo
            </button>
            <button
              type="submit"
              className="btn solid"
              disabled={!customLabel.trim()}
            >
              Salvar e Usar Papel
            </button>
          </footer>
        </form>
      )}

      {/* =================================================================== */}
      {/* ETAPA 2: SELEÇÃO DE EXECUTOR (RUNNER / HARNESS)                    */}
      {/* =================================================================== */}
      {etapa === 2 && (
        <section className="catalog-step" aria-label="Escolha de executor">
          <div className="step-header">
            <h3>Onde <b>{currentRole.label}</b> vai rodar?</h3>
            <p>
              Selecione o executor. A escolha explícita de <b>SHELL</b> tem precedência soberana absoluta e inicia um terminal Linux vazio (/bin/bash -i -l).
            </p>
          </div>

          <div className="runner-grid" role="radiogroup" aria-label="Executores">
            {CANONICAL_RUNNERS.map((opt) => {
              const isSelected = selectedRunner === opt.id;
              // Check whitelist if active mission has elenco (bash is sovereign and never excluded)
              const foraDoElenco =
                opt.id !== "bash" &&
                elenco?.clis &&
                elenco.clis.length > 0 &&
                !elenco.clis.includes(opt.id);

              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`runner-tile${isSelected ? " selected" : ""}${
                    foraDoElenco ? " disabled" : ""
                  }`}
                  onClick={() => {
                    if (!foraDoElenco) handleSelectRunner(opt.id);
                  }}
                  disabled={Boolean(foraDoElenco)}
                >
                  <div className="runner-tile-head">
                    <span className="runner-tile-label">{opt.label}</span>
                    <span className={`runner-badge ${opt.id}`}>{opt.badge}</span>
                  </div>
                  <p className="runner-desc">{opt.description}</p>
                  {foraDoElenco && (
                    <span className="runner-warning">Fora do elenco desta missão</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* SOBERANO CLEAN BASH NOTICE (Requirement R1) */}
          {selectedRunner === "bash" && (
            <div className="sovereign-bash-banner">
              <div className="banner-icon">
                <Icon name="terminal" size={20} />
              </div>
              <div className="banner-content">
                <strong>Terminal Bash Soberano Selecionado</strong>
                <p>
                  Inicia estritamente como <code>/bin/bash -i -l</code>. Sem injeção de prompt, sem LLM no boot, sem instruções ocultas. Se desejar invocar IA, você fará manualmente dentro do terminal.
                </p>
              </div>
            </div>
          )}

          <footer className="catalog-actions">
            <button type="button" className="btn quiet" onClick={() => setEtapa(1)}>
              ← Voltar ao Papel
            </button>

            {selectedRunner === "bash" ? (
              <button
                type="button"
                className="btn solid bash-launch"
                onClick={handleFinish}
              >
                Abrir Shell Limpo ({currentRole.label})
              </button>
            ) : (
              <button
                type="button"
                className="btn solid"
                onClick={() => setEtapa(3)}
              >
                Avançar para Seleção de Modelo →
              </button>
            )}
          </footer>
        </section>
      )}

      {/* =================================================================== */}
      {/* ETAPA 3: SELEÇÃO DE MODELO E DIRETIVA (APENAS PARA RUNNERS IA)      */}
      {/* =================================================================== */}
      {etapa === 3 && selectedRunner !== "bash" && (
        <section className="catalog-step" aria-label="Configuração de modelo e parâmetros">
          <div className="step-header">
            <h3>Configurar Modelo para {currentRole.label} ({selectedRunner})</h3>
            <p>Selecione o modelo de linguagem e parâmetros de execução.</p>
          </div>

          <label className="campo-bloco">
            <span className="rotulo">Modelo Principal</span>
            <select
              className="campo"
              value={selectedModel}
              onChange={(e) => {
                setSelectedModel(e.target.value);
                setCustomModel("");
              }}
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="campo-bloco">
            <span className="rotulo">Ou digite um Modelo Customizado</span>
            <input
              type="text"
              className="campo"
              placeholder="ex: gpt-5, claude-3-7-sonnet, deepseek-r1"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
            />
          </label>

          <label className="campo-bloco">
            <span className="rotulo">Nível de Raciocínio / Esforço (opcional)</span>
            <select
              className="campo"
              value={selectedEffort}
              onChange={(e) => setSelectedEffort(e.target.value)}
            >
              <option value="">Padrão do Provedor</option>
              <option value="low">Baixo (low)</option>
              <option value="medium">Médio (medium)</option>
              <option value="high">Alto (high)</option>
              <option value="xhigh">Máximo (xhigh)</option>
            </select>
          </label>

          <label className="campo-bloco">
            <span className="rotulo">
              Direcionamento / Tarefa Inicial <small style={{ opacity: 0.7 }}>(opcional)</small>
            </span>
            <textarea
              className="campo area"
              rows={3}
              placeholder={`Instrução inicial para ${currentRole.label} (ex: "Analise os arquivos de teste", "Implemente a API de autenticação")...`}
              value={tarefa}
              onChange={(e) => setTarefa(e.target.value)}
            />
          </label>

          <footer className="catalog-actions">
            <button type="button" className="btn quiet" onClick={() => setEtapa(2)}>
              ← Voltar ao Executor
            </button>
            <button type="button" className="btn solid" onClick={handleFinish}>
              Abrir Agente ({currentRole.label} · {customModel || selectedModel || selectedRunner})
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
