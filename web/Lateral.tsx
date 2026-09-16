import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { corDoPainel, estadoDoPainel, nomeDoPainel, sementeDoPainel } from "./rotulos.ts";
import { Mascote } from "./Mascote.tsx";
import type { AgentSpec, Mission, PaneState, Project } from "./api.ts";
import {
  aplicarOrdem,
  chaveMissoes,
  chavePaineis,
  gravarOrdem,
  lerOrdem,
  metadeDepois,
  moverAntesOuDepois,
  onOrdem,
  useOrdem,
} from "./ordem.ts";

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
 *
 * No desktop a lateral pode recolher (só ícones / setinha) para liberar o
 * palco; o rodapé de ferramentas também tem setinha própria.
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
  onFecharJanelas,
  onMudarModo,
  busy = false,
  aberta,
  onFechar,
  recolhida,
  onRecolher,
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
  onFecharJanelas?: (missionId: string | "todas") => void;
  onMudarModo?: (missionId: string, modo: string) => void;
  busy?: boolean;
  aberta: boolean;
  onFechar: () => void;
  recolhida: boolean;
  onRecolher: (recolhida: boolean) => void;
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
  const [ferramentasAbertas, setFerramentasAbertas] = useState(() => {
    try {
      return localStorage.getItem("cockpit.ferramentas") !== "0";
    } catch {
      return true;
    }
  });
  const anterior = useRef(activeId);
  const [arrasto, setArrasto] = useState<{ tipo: "missao" | "painel"; id: string; missao?: string; sobre?: string; depois?: boolean } | null>(null);
  const arrastoRef = useRef(arrasto);
  arrastoRef.current = arrasto;
  const [, setOrdemTick] = useState(0);
  const idsMissoes = missions.map((m) => m.id);
  const [ordemMissoes, setOrdemMissoes] = useOrdem(project ? chaveMissoes(project.id) : null, idsMissoes);
  const missoesOrdenadas = aplicarOrdem(idsMissoes, ordemMissoes)
    .map((id) => missions.find((m) => m.id === id))
    .filter((m): m is Mission => Boolean(m));

  useEffect(() => onOrdem(() => setOrdemTick((n) => n + 1)), []);

  useEffect(() => {
    if (activeId && activeId !== anterior.current) setAbertas(prev => new Set(prev).add(activeId));
    anterior.current = activeId;
  }, [activeId]);

  useEffect(() => {
    localStorage.setItem("cockpit.ferramentas", ferramentasAbertas ? "1" : "0");
  }, [ferramentasAbertas]);

  const alternar = (id: string) => setAbertas(prev => {
    const proximo = new Set(prev);
    if (!proximo.delete(id)) proximo.add(id);
    return proximo;
  });

  return (
    <aside
      className={`sidebar${aberta ? " aberta" : ""}${recolhida ? " recolhida" : ""}`}
      aria-label="Projeto, missões e agentes"
    >
      <div className="sidebar-top">
        <button className="brand-button" onClick={onProjetos} title="Projetos e missões">
          <span className="brand-mark"><Icon name="cockpit" size={20} /></span>
          <span className="project-name">{project?.nome ?? "Projetos"}</span>
          <Icon name="chevron" size={14} />
        </button>
        <button
          className="icon-btn recolher-lateral"
          aria-label={recolhida ? "Expandir lateral" : "Recolher lateral"}
          title={recolhida ? "Expandir lateral" : "Recolher lateral"}
          aria-pressed={recolhida}
          onClick={() => onRecolher(!recolhida)}
        >
          <Icon name="panel" size={16} />
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
          {project && panes.length > 0 && onFecharJanelas && (
            <button
              type="button"
              className="sidebar-fechar-todas"
              title="Encerrar todas as janelas abertas"
              onClick={() => onFecharJanelas("todas")}
            >
              Fechar todas
            </button>
          )}
          {project && <button className="icon-btn" aria-label="Nova missão" title="Nova missão" onClick={onNovaMissao}><Icon name="plus" size={15} /></button>}
        </div>

        {!project && <p className="sidebar-vazio">Abra um projeto para ver as missões.</p>}
        {project && !missions.length && <p className="sidebar-vazio">Nenhuma missão ainda.</p>}

        {missoesOrdenadas.map(m => {
          const daMissao = panes.filter(p => p.missionId === m.id);
          const idsPaineis = aplicarOrdem(daMissao.map((p) => p.paneId), lerOrdem(chavePaineis(m.id)));
          const paineisOrdenados = idsPaineis
            .map((id) => daMissao.find((p) => p.paneId === id))
            .filter((p): p is PaneState => Boolean(p));
          const expandida = abertas.has(m.id);
          const alvoMissao = arrasto?.tipo === "missao" && arrasto.sobre === m.id;
          return (
            <div
              className={`mission-node${arrasto?.tipo === "missao" && arrasto.id === m.id ? " arrastando" : ""}${alvoMissao ? (arrasto?.depois ? " alvo-depois" : " alvo-antes") : ""}`}
              key={m.id}
              onDragOver={(event: DragEvent<HTMLDivElement>) => {
                if (arrastoRef.current?.tipo !== "missao") return;
                event.preventDefault();
                const depois = metadeDepois(event, event.currentTarget.getBoundingClientRect(), "y");
                setArrasto((atual) => {
                  const base = atual ?? arrastoRef.current;
                  return base && base.tipo === "missao" ? { ...base, sobre: m.id, depois } : atual;
                });
              }}
              onDrop={(event) => {
                event.preventDefault();
                const atual = arrastoRef.current;
                if (atual?.tipo !== "missao") return;
                const proxima = moverAntesOuDepois(ordemMissoes.length ? ordemMissoes : idsMissoes, atual.id, m.id, Boolean(atual.depois));
                setOrdemMissoes(proxima);
                setArrasto(null);
              }}
            >
              <div className={`mission-row${activeId === m.id ? " ativa" : ""}`}>
                <span
                  className="arrasto-pega"
                  draggable
                  title="Arrastar para reordenar"
                  aria-label={`Arrastar missão ${m.nome}`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", `missao:${m.id}`);
                    event.dataTransfer.effectAllowed = "move";
                    const proximo = { tipo: "missao" as const, id: m.id };
                    arrastoRef.current = proximo;
                    setArrasto(proximo);
                  }}
                  onDragEnd={() => setArrasto(null)}
                >
                  <Icon name="grip" size={12} />
                </span>
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
                {daMissao.length > 0 && onFecharJanelas && (
                  <button
                    type="button"
                    className="mission-rename-btn"
                    aria-label={`Fechar janelas de ${m.nome}`}
                    title="Fechar todas as janelas desta missão"
                    onClick={() => onFecharJanelas(m.id)}
                  >
                    fechar
                  </button>
                )}
                <button className="mission-rename-btn" aria-label={`Renomear ${m.nome}`} title="Renomear missão" onClick={() => { setRenomeando(m.id); setNomeEmEdicao(m.nome); }}>✏️</button>
              </div>

              {expandida && (
                <div className="mission-ajuste">
                  <select
                    className="mission-modo"
                    value={m.modo ?? "livre"}
                    disabled={busy || !onMudarModo}
                    aria-label={`Modo da missão ${m.nome}`}
                    title="Modo de execução da missão"
                    onChange={(event) => onMudarModo?.(m.id, event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <option value="livre">Livre</option>
                    <option value="dirigido">Dirigido</option>
                    <option value="autonomo">Autônomo</option>
                  </select>
                  {m.branch && <span className="mission-branch" title={`Branch: ${m.branch}`}>{m.branch}</span>}
                </div>
              )}

              {expandida && <div className="mission-agents">
                {paineisOrdenados.map(p => {
                  const alvoPainel = arrasto?.tipo === "painel" && arrasto.missao === m.id && arrasto.sobre === p.paneId;
                  const nome = nomeDoPainel(p, panes, agents);
                  return (
                  <div
                    key={p.paneId}
                    className={`agent-row${selectedId === p.paneId && activeId === m.id ? " selecionado" : ""}${arrasto?.tipo === "painel" && arrasto.id === p.paneId ? " arrastando" : ""}${alvoPainel ? (arrasto?.depois ? " alvo-depois" : " alvo-antes") : ""}`}
                    style={{ "--identity": corDoPainel(p) } as CSSProperties}
                    onDragOver={(event) => {
                      if (arrastoRef.current?.tipo !== "painel" || arrastoRef.current.missao !== m.id) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const depois = metadeDepois(event, event.currentTarget.getBoundingClientRect(), "y");
                      setArrasto((atual) => {
                        const base = atual ?? arrastoRef.current;
                        return base && base.tipo === "painel" ? { ...base, sobre: p.paneId, depois } : atual;
                      });
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const atual = arrastoRef.current;
                      if (atual?.tipo !== "painel" || atual.missao !== m.id) return;
                      const proxima = moverAntesOuDepois(idsPaineis, atual.id, p.paneId, Boolean(atual.depois));
                      gravarOrdem(chavePaineis(m.id), proxima);
                      setArrasto(null);
                    }}
                  >
                    <span
                      className="arrasto-pega"
                      draggable
                      title="Arrastar para reordenar"
                      aria-label={`Arrastar ${nome}`}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", `painel:${m.id}:${p.paneId}`);
                        event.dataTransfer.effectAllowed = "move";
                        const proximo = { tipo: "painel" as const, id: p.paneId, missao: m.id };
                        arrastoRef.current = proximo;
                        setArrasto(proximo);
                      }}
                      onDragEnd={() => setArrasto(null)}
                    >
                      <Icon name="grip" size={12} />
                    </span>
                    <button
                      type="button"
                      className="agent-row-nome"
                      aria-current={selectedId === p.paneId && activeId === m.id ? "true" : undefined}
                      onClick={() => onSelectPane(m.id, p.paneId)}
                      title={`${nome} · ${estadoDoPainel(p, connected)}`}
                    >
                      <Mascote semente={sementeDoPainel(p)} cor={corDoPainel(p)} estado={connected ? p.status : "off"} tamanho={20} />
                      <span>{nome}</span>
                    </button>
                  </div>
                  );
                })}
                <button className="agent-row novo" disabled={!connected} onClick={() => onAddAgente(m.id)}>
                  <Icon name="plus" size={14} /><span>Adicionar agente</span>
                </button>
              </div>}
            </div>
          );
        })}
        </>}
        </div>
        {/* As ferramentas moram na mesma ilha, separadas por um fio — com setinha para recolher. */}
        <div className={`sidebar-foot${ferramentasAbertas ? "" : " recolhido"}`}>
          <button
            type="button"
            className="sidebar-foot-toggle"
            aria-expanded={ferramentasAbertas}
            aria-controls="sidebar-ferramentas"
            onClick={() => setFerramentasAbertas((v) => !v)}
          >
            <span>Ferramentas</span>
            <Icon name="chevron" size={13} />
          </button>
          <div id="sidebar-ferramentas" className="sidebar-foot-corpo" hidden={!ferramentasAbertas}>
            {rodape}
          </div>
        </div>
        </section>
      </div>

      {/* Trilho recolhido: só marca + setinha para expandir de novo. */}
      <div className="sidebar-rail" aria-hidden={!recolhida}>
        <button className="brand-mark rail-brand" onClick={onProjetos} title="Projetos e missões">
          <Icon name="cockpit" size={18} />
        </button>
        <button
          className="icon-btn rail-expand"
          aria-label="Expandir lateral"
          title="Expandir lateral"
          onClick={() => onRecolher(false)}
        >
          <Icon name="chevron" size={16} style={{ transform: "rotate(-90deg)" }} />
        </button>
        <div className="rail-spacer" />
        <button
          className="icon-btn"
          aria-label="Missões"
          title="Missões"
          onClick={() => { onRecolher(false); onPagina("missoes"); }}
        >
          <Icon name="team" size={16} />
        </button>
        <button
          className="icon-btn"
          aria-label="Tarefas"
          title="Tarefas"
          onClick={() => { onRecolher(false); onPagina("tarefas"); }}
        >
          <Icon name="grid" size={16} />
        </button>
        <button
          className="icon-btn"
          aria-label="Arquivos"
          title="Arquivos"
          onClick={() => { onRecolher(false); onPagina("arquivos"); }}
        >
          <Icon name="folder" size={16} />
        </button>
        <button
          className="icon-btn"
          aria-label="Ajustes"
          title="Expandir e abrir ferramentas"
          onClick={() => { onRecolher(false); setFerramentasAbertas(true); }}
        >
          <Icon name="settings" size={16} />
        </button>
      </div>
    </aside>
  );
}
