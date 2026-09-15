import { useState } from "react";
import { Icon } from "./Icon.tsx";
import type { AgentSpec, Mission, PaneState, Project } from "./api.ts";

/**
 * Projetos e missões, numa janela só.
 *
 * Antes isto ocupava 220px permanentes de barra lateral para uma escolha que
 * se faz uma vez e depois fica parada. Virou janela: você abre, escolhe,
 * fecha, e a tela inteira volta a ser terminal.
 *
 * Projetos e missões moram juntos de propósito — trocar de projeto é a mesma
 * decisão de trocar de missão, só num degrau acima.
 */

export function Workspace({
  projects,
  projectId,
  missions,
  activeId,
  panes,
  agents,
  busy,
  escolhendo,
  onTrocarProjeto,
  onProcurarPasta,
  onFecharProjeto,
  onSelectMission,
  onCreateMission,
  onArquivarMissao,
  onFechar,
}: {
  projects: Project[];
  projectId: string | null;
  missions: Mission[];
  activeId: string | null;
  panes: PaneState[];
  agents: Record<string, AgentSpec>;
  busy: boolean;
  escolhendo: boolean;
  onTrocarProjeto: (id: string) => void;
  onProcurarPasta: () => void;
  onFecharProjeto: (id: string) => void;
  onSelectMission: (id: string) => void;
  onCreateMission: () => void;
  onArquivarMissao: (id: string) => void;
  onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  // Apagar missão isolada leva worktree e branch: pede confirmação na linha.
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [fechandoProjeto, setFechandoProjeto] = useState<string | null>(null);

  const alvo = busca.trim().toLocaleLowerCase();
  const encontradas = alvo
    ? missions.filter((m) => `${m.nome} ${m.objetivo}`.toLocaleLowerCase().includes(alvo))
    : missions;

  const projeto = projects.find((p) => p.id === projectId);

  return (
    <div className="ajustes janela">
      <nav className="abas">
        <span className="aba-titulo">
          <Icon name="grid" size={15} /> Projetos e missões
        </span>
        <span className="spacer" />
        <button className="icon-btn" onClick={onFechar} aria-label="Fechar projetos" title="Fechar">
          ✕
        </button>
      </nav>

      <div className="aba-corpo">
        <div className="wizard-corpo">
          <div className="campo-bloco">
            <span className="rotulo">
              Projetos
              <button className="btn" disabled={busy} onClick={onProcurarPasta}>
                <Icon name="plus" size={13} /> Abrir pasta
              </button>
            </span>
            {escolhendo && <p className="dica sem-margem">escolha a pasta na janela que apareceu…</p>}

            <div className="lista-skills curta">
              {projects.length === 0 && <p className="vazio-nota">Nenhum projeto aberto ainda.</p>}
              {projects.map((p) => {
                const quantas = p.id === projectId ? missions.length : null;
                if (fechandoProjeto === p.id) {
                  return (
                    <div key={p.id} className="linha confirma">
                      <span className="nome">fechar {p.nome}?</span>
                      <span className="prov-cmd">as missões continuam guardadas</span>
                      <span className="spacer" />
                      <button
                        className="btn mini perigo"
                        onClick={() => {
                          onFecharProjeto(p.id);
                          setFechandoProjeto(null);
                        }}
                      >
                        fechar
                      </button>
                      <button className="btn mini" onClick={() => setFechandoProjeto(null)}>
                        não
                      </button>
                    </div>
                  );
                }
                return (
                  <div key={p.id} className={`linha${p.id === projectId ? " on" : ""}`}>
                    <button className="linha-toque" onClick={() => onTrocarProjeto(p.id)} title={p.root}>
                      <Icon name="folder" size={15} />
                      <b>{p.nome}</b>
                      <span className="caminho">{p.root}</span>
                    </button>
                    {!p.git && <span className="tipo-chip" title="sem git: as missões dividem a pasta">sem git</span>}
                    {quantas !== null && <span className="prov-cmd">{quantas} missão(ões)</span>}
                    <button
                      className="icon-btn apagar"
                      disabled={busy}
                      title="Fechar projeto no cockpit"
                      onClick={() => setFechandoProjeto(p.id)}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="campo-bloco cresce">
            <span className="rotulo">
              Missões {projeto && <em>— em {projeto.nome}</em>}
              <button className="btn solid" disabled={busy || !projectId} onClick={onCreateMission}>
                <Icon name="plus" size={13} /> Nova missão
              </button>
            </span>

            {missions.length > 6 && (
              <input
                className="campo"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar missão…"
                aria-label="Buscar missão"
              />
            )}

            <div className="lista-skills">
              {!projectId && <p className="vazio-nota">Abra um projeto para começar.</p>}
              {projectId && missions.length === 0 && <p className="vazio-nota">Nenhuma ainda.</p>}
              {missions.length > 0 && encontradas.length === 0 && (
                <p className="vazio-nota">Nenhuma missão encontrada.</p>
              )}
              {encontradas.map((m) => {
                const tripulacao = panes.filter((p) => p.missionId === m.id);
                if (confirmando === m.id) {
                  return (
                    <div key={m.id} className="linha confirma">
                      <span className="nome">apagar {m.nome}?</span>
                      <span className="spacer" />
                      <button
                        className="btn mini perigo"
                        onClick={() => {
                          onArquivarMissao(m.id);
                          setConfirmando(null);
                        }}
                      >
                        {m.isolada ? "apagar e descartar o branch" : "apagar"}
                      </button>
                      <button className="btn mini" onClick={() => setConfirmando(null)}>
                        não
                      </button>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={`linha${m.id === activeId ? " on" : ""}`}>
                    <button
                      className="linha-toque"
                      aria-current={m.id === activeId ? "page" : undefined}
                      onClick={() => {
                        onSelectMission(m.id);
                        onFechar();
                      }}
                      title={m.objetivo || m.worktree}
                    >
                      <Icon name="terminal" size={15} />
                      <b>{m.nome}</b>
                      <span className="caminho">{m.objetivo}</span>
                    </button>
                    {m.squad && <span className="squad-flag">{m.squad.squad}</span>}
                    {m.branch && <span className="branch">{m.branch}</span>}
                    <span className="crew">
                      {tripulacao.length === 0 ? (
                        <i className="nenhum">—</i>
                      ) : (
                        tripulacao.map((p) => (
                          <i
                            key={p.paneId}
                            style={{ background: agents[p.agent]?.cor ?? p.cor }}
                            title={p.label}
                          />
                        ))
                      )}
                    </span>
                    <button
                      className="icon-btn apagar"
                      onClick={() => setConfirmando(m.id)}
                      disabled={busy}
                      title="Apagar missão"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
