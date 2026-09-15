import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { estadoDoPainel, nomeDoPainel } from "./rotulos.ts";
import { Mascote } from "./Mascote.tsx";
import type { AgentSpec, Mission, PaneState, Project } from "./api.ts";

/**
 * A lateral do cockpit: a pasta do trabalho.
 *
 * Missões ficam aqui pelo mesmo motivo que arquivos ficam numa árvore — são
 * muitas, coexistem, e você entra e sai delas o dia inteiro. Cada missão
 * abre mostrando seus agentes; clicar num agente leva o terminal dele para a
 * tela principal, que não guarda mais nada além disso.
 *
 * Trocar de missão aqui não encerra nada: os terminais das outras continuam
 * montados e recebendo saída, só saem de vista.
 */
export type Pagina = "missoes" | "tarefas" | "arquivos";

export function Lateral({
  project,
  missions,
  activeId,
  panes,
  agents,
  selectedId,
  connected,
  onProjetos,
  onSelectMission,
  onSelectPane,
  onNovaMissao,
  onAddAgente,
  onRenomearMissao,
  aberta,
  onFechar,
  pagina,
  onPagina,
  tarefas,
  arquivos,
  rodape,
}: {
  project: Project | undefined;
  missions: Mission[];
  activeId: string | null;
  panes: PaneState[];
  agents: Record<string, AgentSpec>;
  selectedId: string | null;
  connected: boolean;
  onProjetos: () => void;
  onSelectMission: (id: string) => void;
  onSelectPane: (missionId: string, paneId: string) => void;
  onNovaMissao: () => void;
  onAddAgente: (missionId: string) => void;
  onRenomearMissao: (missionId: string, nome: string) => void;
  aberta: boolean;
  onFechar: () => void;
  pagina: Pagina;
  onPagina: (pagina: Pagina) => void;
  tarefas?: ReactNode;
  arquivos: ReactNode;
  rodape: ReactNode;
}) {
  // Missões abertas na árvore. A ativa entra sozinha; fechar a ativa é
  // legítimo (você quer olhar outra) e por isso o conjunto é livre.
  const [abertas, setAbertas] = useState<Set<string>>(() => new Set(activeId ? [activeId] : []));
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [nomeEmEdicao, setNomeEmEdicao] = useState("");
  const anterior = useRef(activeId);

  useEffect(() => {
    if (activeId && activeId !== anterior.current) setAbertas(prev => new Set(prev).add(activeId));
    anterior.current = activeId;
  }, [activeId]);

  const alternar = (id: string) => setAbertas(prev => {
    const proximo = new Set(prev);
    if (!proximo.delete(id)) proximo.add(id);
    return proximo;
  });

  return (
    <aside className={`sidebar${aberta ? " aberta" : ""}`} aria-label="Projeto, missões e agentes">
      <div className="sidebar-top">
        <button className="brand-button" onClick={onProjetos} title="Projetos e missões">
          <span className="brand-mark"><Icon name="cockpit" size={20} /></span>
          <span className="project-name">{project?.nome ?? "Projetos"}</span>
          <Icon name="chevron" size={14} />
        </button>
        <button className="icon-btn fechar-lateral" aria-label="Fechar lateral" onClick={onFechar}><Icon name="close" /></button>
      </div>

      {/* Três páginas na mesma ilha: o trabalho (missões e agentes), placar de tarefas e arquivos/memória. */}
      {project && <div className="sidebar-paginas" role="tablist" aria-label="Páginas da lateral">
        <button role="tab" aria-selected={pagina === "missoes"} className={pagina === "missoes" ? "on" : undefined} onClick={() => onPagina("missoes")}>Missões</button>
        <button role="tab" aria-selected={pagina === "tarefas"} className={pagina === "tarefas" ? "on" : undefined} onClick={() => onPagina("tarefas")}>Tarefas</button>
        <button role="tab" aria-selected={pagina === "arquivos"} className={pagina === "arquivos" ? "on" : undefined} onClick={() => onPagina("arquivos")}>Arquivos</button>
      </div>}

      <div className="sidebar-scroll">
        <section className="sidebar-island" aria-label={pagina === "arquivos" ? "Arquivos e memória" : pagina === "tarefas" ? "Placar de tarefas" : "Missões do projeto"}>
        <div className="island-corpo">
        {pagina === "arquivos" ? arquivos : pagina === "tarefas" ? (tarefas ?? <p className="sidebar-vazio">Nenhuma tarefa nesta missão.</p>) : <>
        <div className="sidebar-secao">
          <span className="sidebar-titulo">Missões</span>
          {project && <button className="icon-btn" aria-label="Nova missão" title="Nova missão" onClick={onNovaMissao}><Icon name="plus" size={15} /></button>}
        </div>

        {!project && <p className="sidebar-vazio">Abra um projeto para ver as missões.</p>}
        {project && !missions.length && <p className="sidebar-vazio">Nenhuma missão ainda.</p>}

        {missions.map(m => {
          const daMissao = panes.filter(p => p.missionId === m.id);
          const expandida = abertas.has(m.id);
          return (
            <div className="mission-node" key={m.id}>
              <div className={`mission-row${activeId === m.id ? " ativa" : ""}`}>
                <button className="caret-btn" aria-expanded={expandida} aria-label={`${expandida ? "Recolher" : "Expandir"} ${m.nome}`} onClick={() => alternar(m.id)}>
                  <Icon name="chevron" size={13} />
                </button>
                {renomeando === m.id ? (
                  <form className="mission-rename" onSubmit={(event) => { event.preventDefault(); const nome = nomeEmEdicao.trim(); if (nome) onRenomearMissao(m.id, nome); setRenomeando(null); }}>
                    <input autoFocus value={nomeEmEdicao} aria-label="Nome da missão" onChange={(event) => setNomeEmEdicao(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setRenomeando(null); }} />
                  </form>
                ) : <button className="mission-name" aria-current={activeId === m.id ? "true" : undefined} onClick={() => { onSelectMission(m.id); setAbertas(prev => new Set(prev).add(m.id)); }} title={m.objetivo || m.nome}>
                  <span>{m.nome}</span>
                  {daMissao.length > 0 && <em className="mission-count" aria-hidden="true">{daMissao.length}</em>}
                </button>}
                <button className="mission-rename-btn" aria-label={`Renomear ${m.nome}`} title="Renomear missão" onClick={() => { setRenomeando(m.id); setNomeEmEdicao(m.nome); }}>renomear</button>
              </div>

              {expandida && <div className="mission-agents">
                {daMissao.map(p => (
                  <button
                    key={p.paneId}
                    className={`agent-row${selectedId === p.paneId && activeId === m.id ? " selecionado" : ""}`}
                    style={{ "--identity": p.cor } as CSSProperties}
                    aria-current={selectedId === p.paneId && activeId === m.id ? "true" : undefined}
                    onClick={() => onSelectPane(m.id, p.paneId)}
                    title={`${nomeDoPainel(p, panes, agents)} · ${estadoDoPainel(p, connected)}`}
                  >
                    <Mascote semente={p.agent} cor={p.cor} estado={connected ? p.status : "off"} tamanho={20} />
                    <span>{nomeDoPainel(p, panes, agents)}</span>
                  </button>
                ))}
                <button className="agent-row novo" disabled={!connected} onClick={() => onAddAgente(m.id)}>
                  <Icon name="plus" size={14} /><span>Adicionar agente</span>
                </button>
              </div>}
            </div>
          );
        })}
        </>}
        </div>
        {/* As ferramentas moram na mesma ilha, separadas por um fio. */}
        <div className="sidebar-foot">{rodape}</div>
        </section>
      </div>
    </aside>
  );
}
