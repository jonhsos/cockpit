import { type CSSProperties, lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getConnection, onMessage, onReconnect, send, subscribeConnection } from "./socket.ts";
import { Icon } from "./Icon.tsx";
import { Modal } from "./Modal.tsx";
import { Maestro } from "./Maestro.tsx";
import { Workspace } from "./Workspace.tsx";
import { Arquivos } from "./Arquivos.tsx";
import { PaneGrid, type Colunas } from "./PaneGrid.tsx";
import { Lateral, type Pagina } from "./Lateral.tsx";
import { Mascote } from "./Mascote.tsx";
import { SquadBar } from "./SquadBar.tsx";
import { gravar, type EstadoVoz, type Gravacao } from "./voz.ts";
import { Microfone } from "./Microfone.tsx";
import { Consumo } from "./Consumo.tsx";
import { Redline } from "./Redline.tsx";
import { escolherPasta } from "./pasta.ts";
import { NavegadorPastas } from "./NavegadorPastas.tsx";
import { NovaMissao, type Plano } from "./NovaMissao.tsx";
import { Ajustes } from "./Ajustes.tsx";
import { RoleCatalog } from "./RoleCatalog.tsx";
import { QuadroTarefas } from "./QuadroTarefas.tsx";
import { agentForRole, roleDefinitionFor } from "./role-contract.ts";
import {
  closeProject,
  deleteMission,
  deleteNota,
  fetchConfig,
  fetchFile,
  fetchMemoria,
  fetchMissions,
  fetchPanes,
  fetchProjects,
  fetchProviders,
  fetchTree,
  fetchConnections,
  createConnection,
  deleteConnection,
  fetchTasks,
  fetchPontes,
  postAvancarFase,
  postMission,
  postNota,
  postPapelPainel,
  postProject,
  postSquad,
  renomearMissao,
  mudarModo,
  saveFile,
  type AgentSpec,
  type Mission,
  type No,
  type Nota,
  type PaneState,
  type Project,
  type Provider,
  type StatusPonte,
  type Receita,
  type SquadSpec,
  type TipoTarefa,
  type Usage,
  type Connection,
  type Task,
} from "./api.ts";

const Editor = lazy(() => import("./Editor.tsx").then((module) => ({ default: module.Editor })));

export function App() {
  const connection = useSyncExternalStore(subscribeConnection, getConnection);
  const [verWorkspace, setVerWorkspace] = useState(false);
  const [mostrarNavegador, setMostrarNavegador] = useState(false);
  const [verMissao, setVerMissao] = useState(false);
  const [verAgentes, setVerAgentes] = useState(false);
  const [verAtividade, setVerAtividade] = useState(false);
  const [lateralAberta, setLateralAberta] = useState(false);
  const [lateralRecolhida, setLateralRecolhida] = useState(() => {
    try {
      return localStorage.getItem("cockpit.lateral-recolhida") === "1";
    } catch {
      return false;
    }
  });
  const [selectedPane, setSelectedPane] = useState<string | null>(null);
  const [paginaLateral, setPaginaLateral] = useState<Pagina>("missoes");
  // Quantas colunas de terminal. Fica nos Ajustes: a tela principal e terminal.
  const [colunas, setColunas] = useState<Colunas>(() => {
    const salvo = localStorage.getItem("cockpit.colunas");
    return salvo === "1" || salvo === "2" || salvo === "3" ? salvo : "auto";
  });
  const [agents, setAgents] = useState<Record<string, AgentSpec>>({});
  const [squads, setSquads] = useState<Record<string, SquadSpec>>({});
  const [tarefas, setTarefas] = useState<Record<string, TipoTarefa>>({});
  const [providers, setProviders] = useState<Provider[]>([]);
  const [pontes, setPontes] = useState<StatusPonte[]>([]);
  const [receitas, setReceitas] = useState<Record<string, Receita>>({});
  const [criandoMissao, setCriandoMissao] = useState(false);
  const [verConfig, setVerConfig] = useState(false);
  const [verMaestro, setVerMaestro] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panes, setPanes] = useState<PaneState[]>([]);
  const [usos, setUsos] = useState<Record<string, Usage>>({});
  const [memoria, setMemoria] = useState<Nota[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [paneParaEncerrar, setPaneParaEncerrar] = useState<string | null>(null);
  const [renomeandoAtiva, setRenomeandoAtiva] = useState(false);
  const [novoNomeMissao, setNovoNomeMissao] = useState("");
  const [confirmacaoDestrutiva, setConfirmacaoDestrutiva] = useState<{
    titulo: string;
    mensagem: string;
    onConfirmar: () => void;
  } | null>(null);

  const [agent, setAgent] = useState("maestro");
  const [tipoManual, setTipoManual] = useState("");
  const [cliManual, setCliManual] = useState("");
  const [tarefaManual, setTarefaManual] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verConsumo, setVerConsumo] = useState(false);
  const [escolhendo, setEscolhendo] = useState(false);
  // Perfis de provedor (OPUS, FLASH, GRÁTIS) não são papéis. Papel é algo
  // que usuário nomeia; onde ele roda é escolha separada, feita abaixo.
  const papeis = Object.entries(agents).filter(([id]) => !["shell", "flash", "opus46", "gratis"].includes(id));

  // Escolha de provedor do SHELL vale somente para esta abertura. Sem limpar
  // aqui, cancelar depois de escolher Codex deixava a escolha escondida para
  // próxima abertura e o suposto terminal vazio iniciava uma IA.
  const abrirEscolhaAgente = () => {
    setCliManual("bash");
    setTarefaManual("");
    setTipoManual("");
    setVerAgentes(true);
  };
  const fecharEscolhaAgente = () => {
    setCliManual("");
    setTarefaManual("");
    setTipoManual("");
    setVerAgentes(false);
  };

  const [tree, setTree] = useState<No[]>([]);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [conteudo, setConteudo] = useState("");
  const [sujo, setSujo] = useState(false);
  const [tocado, setTocado] = useState<Set<string>>(new Set());

  const [voz, setVoz] = useState<EstadoVoz>("ocioso");
  const [traduzir, setTraduzir] = useState(
    () => localStorage.getItem("cockpit.traduzir") === "1",
  );
  // Qual microfone está gravando: "painel" ou "brief".
  const [vozOnde, setVozOnde] = useState<string | null>(null);
  const gravacao = useRef<Gravacao | null>(null);
  const destino = useRef<((texto: string) => void) | null>(null);

  /**
   * Uma edição pendente não some sozinha.
   *
   * Trocar de arquivo, de missão ou de projeto descartava o texto sem avisar.
   * Agora toda transição passa por aqui: com o editor sujo, a ação fica de
   * lado e você decide salvar, descartar ou ficar.
   */
  const [pendente, setPendente] = useState<(() => void) | null>(null);
  const trocar = (acao: () => void) => {
    if (sujoRef.current) setPendente(() => acao);
    else acao();
  };

  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = projectId;
  const arquivoRef = useRef<string | null>(null);
  arquivoRef.current = arquivo;
  const sujoRef = useRef(false);
  sujoRef.current = sujo;

  const recarregarProjetos = useCallback(async () => {
    const { projects: lista } = await fetchProjects();
    setProjects(lista);
    setProjectId((id) => (id && lista.some((p) => p.id === id) ? id : (lista[0]?.id ?? null)));
  }, []);

  const recarregarMissoes = useCallback(async (pid: string | null) => {
    if (!pid) {
      setMissions([]);
      setActiveId(null);
      return;
    }
    const { missions: lista } = await fetchMissions(pid);
    if (projectIdRef.current !== pid) return;
    setMissions(lista);
    setActiveId((id) => (id && lista.some((m) => m.id === id) ? id : (lista[0]?.id ?? null)));
  }, []);

  const recarregarArvore = useCallback(async (missionId: string | null, pid: string | null) => {
    if (!pid) {
      setTree([]);
      return;
    }
    const result = await fetchTree(missionId, pid);
    if (projectIdRef.current === pid && activeIdRef.current === missionId) setTree(result.tree);
  }, []);

  const recarregarProvedores = useCallback(() => {
    void fetchProviders().then(({ providers: lista }) => setProviders(lista)).catch(() => {});
  }, []);

  useEffect(() => {
    void fetchConfig().then((c) => {
      setAgents(c.agents);
      setSquads(c.squads);
      setTarefas(c.tarefas ?? {});
      setProviders(c.providers ?? []);
      setReceitas(c.receitas ?? {});
      setAgent((a) => (c.agents[a] ? a : (Object.keys(c.agents)[0] ?? a)));
    });
    void fetchPontes().then((r) => setPontes(r.pontes)).catch(() => {});
    const recarregarPaineis = () =>
      fetchPanes().then(({ panes: lista }) => {
        setPanes(lista);
        setUsos(Object.fromEntries(lista.map((p) => [p.paneId, p.usage])));
      });

    void recarregarProjetos();
    void recarregarPaineis();

    // Voltando de uma queda, o servidor é a verdade: painéis podem ter
    // nascido ou morrido enquanto estávamos mudos.
    const soltarReconexao = onReconnect(() => {
      void recarregarPaineis();
      void recarregarProjetos();
      void recarregarMissoes(projectIdRef.current);
      void recarregarArvore(activeIdRef.current, projectIdRef.current);
    });

    const soltarMensagens = onMessage((msg) => {
      switch (msg.type) {
        case "error": setAviso(msg.message); break;
        case "maestro":
          void fetchConfig().then(c => { setAgents(c.agents); setProviders(c.providers ?? []); });
          break;
        case "pool:updated":
        case "pool:rotated":
          recarregarProvedores();
          break;
        case "panes":
          setPanes(msg.panes);
          break;
        case "spawned":
          setPanes((prev) =>
            prev.some((p) => p.paneId === msg.pane.paneId) ? prev : [...prev, msg.pane],
          );
          void recarregarMissoes(projectIdRef.current);
          break;
        case "exit":
          setPanes((prev) => prev.filter((p) => p.paneId !== msg.paneId));
          setConnections((prev) =>
            prev.filter((c) => c.sourcePaneId !== msg.paneId && c.targetPaneId !== msg.paneId)
          );
          if (activeIdRef.current) {
            void fetchConnections(activeIdRef.current).then((res) => {
              if (res.ok && res.connections) setConnections(res.connections);
            }).catch(() => {});
            void fetchTasks(activeIdRef.current).then((res) => {
              if (res.ok && res.tasks) setTasks(res.tasks);
            }).catch(() => {});
          }
          void recarregarMissoes(projectIdRef.current);
          break;
        case "pulse":
          setPanes((prev) =>
            prev.map((p) => {
              const pulso = msg.pulsos.find((x) => x.paneId === p.paneId);
              return pulso
                ? {
                    ...p,
                    status: pulso.status,
                    atividade: pulso.atividade,
                    blockedReason: pulso.blockedReason !== undefined ? pulso.blockedReason : p.blockedReason,
                  }
                : p;
            }),
          );
          break;
        case "usage":
          setUsos((prev) => {
            const proximo = { ...prev };
            for (const u of msg.usos) proximo[u.paneId] = u.usage;
            return proximo;
          });
          break;
        case "memoria":
          if (msg.projectId === projectIdRef.current) {
            void fetchMemoria(msg.projectId).then(notas => { if (msg.projectId === projectIdRef.current) setMemoria(notas); });
          }
          break;
        case "fs-change":
          setTocado((prev) => new Set(prev).add(msg.path));
          void recarregarArvore(activeIdRef.current, projectIdRef.current);
          // Recarrega o editor só se o arquivo aberto mudou por fora e não há
          // edição pendente — trabalho local nunca é sobrescrito.
          if (msg.path === arquivoRef.current && !sujoRef.current) {
            const pid = projectIdRef.current, mid = activeIdRef.current;
            void fetchFile(mid, pid, msg.path).then((f) => {
              if (projectIdRef.current === pid && activeIdRef.current === mid && arquivoRef.current === msg.path && !sujoRef.current) setConteudo(f.content);
            });
          }
          break;
        case "task:created":
        case "task:updated":
        case "task:status_changed":
        case "task:deleted":
        case "task:assigned":
        case "task:evidence_added":
          if (activeIdRef.current) {
            void fetchTasks(activeIdRef.current).then((res) => {
              if (res.ok && res.tasks) setTasks(res.tasks);
            });
          }
          break;
        case "inbox:message":
          if (activeIdRef.current) {
            void fetchConnections(activeIdRef.current).then((res) => {
              if (res.ok && res.connections) setConnections(res.connections);
            });
          }
          break;
        case "mission:updated":
        case "mission:mode_changed":
          void recarregarMissoes(projectIdRef.current);
          break;
        case "connection:updated":
          if (activeIdRef.current) {
            void fetchConnections(activeIdRef.current).then((res) => {
              if (res.ok && res.connections) setConnections(res.connections);
            }).catch(() => {});
          }
          break;
        case "maestro:reactivated":
          setAviso(`Especialistas (${msg.especialistas}) concluíram suas tarefas. Maestro foi reativado para consolidação.`);
          break;
      }
    });

    return () => {
      soltarMensagens();
      soltarReconexao();
    };
  }, [recarregarProjetos, recarregarMissoes, recarregarArvore]);

  // Carrega conexões e tarefas quando a missão ativa muda
  useEffect(() => {
    if (!activeId) {
      setConnections([]);
      setTasks([]);
      return;
    }
    void fetchConnections(activeId).then((res) => {
      if (res.ok && res.connections) setConnections(res.connections);
    }).catch(() => {});
    void fetchTasks(activeId).then((res) => {
      if (res.ok && res.tasks) setTasks(res.tasks);
    }).catch(() => {});
  }, [activeId]);

  useEffect(() => {
    setMissions([]);
    setActiveId(null);
    setTree([]);
    setArquivo(null);
    setConteudo("");
    setMemoria([]);
    void recarregarMissoes(projectId);
    if (projectId) void fetchMemoria(projectId).then((notas) => {
      if (projectIdRef.current === projectId) setMemoria(notas);
    });
    else setMemoria([]);
  }, [projectId, recarregarMissoes]);

  useEffect(() => {
    setSelectedPane(null);
    setVerMissao(false);
    setVerAgentes(false);
  }, [activeId, projectId]);

  // Trocar de missão troca a raiz dos arquivos e fecha o editor.
  useEffect(() => {
    setArquivo(null);
    setConteudo("");
    setSujo(false);
    setTocado(new Set());
    void recarregarArvore(activeId, projectId);
  }, [activeId, projectId, recarregarArvore]);

  /** Cria a missão e já sobe o que o assistente escolheu. */
  const criarMissao = (plano: Plano) =>
    guarded(async () => {
      if (!projectId) return;
      const m = await postMission(
        projectId,
        plano.nome,
        plano.objetivo,
        plano.skills,
        plano.receita,
        plano.elenco,
      );
      await recarregarMissoes(projectId);
      setActiveId(m.id);
      setCriandoMissao(false);

      if (plano.modo === "squad" && plano.objetivo) {
        await postSquad(m.id, plano.squad, plano.objetivo);
        await recarregarMissoes(projectId);
        return;
      }
      // Escalonado: quatro CLIs subindo juntos brigam por CPU.
      plano.agentes.forEach((agent, i) => {
        const papel = plano.papeis[i] ?? "builder";
        setTimeout(
          () => send({
            type: "spawn",
            agent,
            missionId: m.id,
            tipo: plano.tipo || undefined,
            role: papel,
            runner: plano.runners[i] || undefined,
            cli: plano.runners[i] || undefined,
            maestro: papel === "maestro",
          }),
          i * 1800,
        );
      });
    });

  const project = projects.find((p) => p.id === projectId) ?? null;
  const active = missions.find((m) => m.id === activeId && m.projectId === projectId) ?? null;
  const visible = panes.filter((p) => p.missionId === activeId);
  const maestroCli = visible.find(p => p.maestro)?.cli ?? agents.maestro?.cli;
  const custoTotal = missions.reduce((n, m) => n + m.usage.custo, 0);

  const guarded = async (fn: () => Promise<void>) => {
    setBusy(true);
    setAviso(null);
    try {
      await fn();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const aoEscolherPeloNavegador = useCallback(
    (caminho: string) => {
      setMostrarNavegador(false);
      guarded(async () => {
        const p = await postProject(caminho);
        await recarregarProjetos();
        setProjectId(p.id);
      });
    },
    [recarregarProjetos],
  );

  // ---------- voz: aperta, fala, solta ----------

  /** O mesmo ditado serve a vários campos; quem chama diz onde o texto cai. */
  const ditar = (onde: string, aplicar: (texto: string) => void) =>
    guarded(async () => {
      const emCurso = gravacao.current;
      if (emCurso) {
        // Solta a referência antes de esperar: se a transcrição falhar, o
        // botão não pode ficar preso em "ouvindo" para sempre.
        gravacao.current = null;
        const entregar = destino.current;
        destino.current = null;
        const texto = await emCurso.parar();
        if (texto) entregar?.(texto);
        else setAviso("não entendi nada no áudio");
        return;
      }
      destino.current = aplicar;
      setVozOnde(onde);
      gravacao.current = await gravar(traduzir, setVoz);
    }).finally(() => {
      if (!gravacao.current) {
        setVoz("ocioso");
        setVozOnde(null);
      }
    });

  const ditarNoPainel = () =>
    ditar("painel", (texto) => {
      const alvo = visible.find(p => p.paneId === selectedPane) ?? visible[0];
      if (alvo) send({ type: "input", paneId: alvo.paneId, data: texto });
      else setAviso("abra um painel antes de ditar");
    });

  // A missão pode ter agentes antes de você escolher um: o primeiro da lista
  // serve de padrão para a tela principal nunca ficar vazia sem motivo.
  const selecionado = visible.find((p) => p.paneId === selectedPane)?.paneId ?? visible[0]?.paneId ?? null;

  const abrirPainel = (missionId: string, paneId: string) =>
    trocar(() => {
      setActiveId(missionId);
      setSelectedPane(paneId);
      setLateralAberta(false);
    });

  /** A página de arquivos mora dentro da lateral, irmã da página de missões. */
  const paginaArquivos = project ? (
    <Arquivos
      tree={tree}
      memoria={memoria}
      arquivoAberto={arquivo}
      tocado={tocado}
      onOpenFile={(caminho) =>
        trocar(() =>
          guarded(async () => {
            const f = await fetchFile(activeId, projectId, caminho);
            if (activeIdRef.current !== activeId || projectIdRef.current !== projectId) return;
            setArquivo(caminho);
            setConteudo(f.content);
            setSujo(false);
            // No celular a lateral é gaveta: abrir o arquivo revela o editor.
            setLateralAberta(false);
            setTocado((prev) => {
              const proximo = new Set(prev);
              proximo.delete(caminho);
              return proximo;
            });
          }),
        )
      }
      onEsquecer={(quando) =>
        guarded(async () => {
          if (!projectId) return;
          await deleteNota(projectId, quando);
          setMemoria(await fetchMemoria(projectId));
        })
      }
    />
  ) : null;

  const paginaTarefas = (
    <QuadroTarefas
      missionId={active?.id ?? null}
      missionNome={active?.nome}
      panes={panes}
      agents={agents}
      onSelectPane={abrirPainel}
    />
  );

  /** Ferramentas do rodapé da lateral: fora da tela principal, perto do resto. */
  const ferramentas = (
    <>
      {active && <button className="btn quiet" aria-label="Detalhes da missão" onClick={() => setVerMissao(true)}><Icon name="memory" size={16} /> Missão</button>}
      <button className="btn quiet" aria-label="Consumo" onClick={() => setVerAtividade(true)}><Icon name="chart" size={16} /> Atividade</button>
      <button className="btn quiet" aria-label="Configurações" onClick={() => setVerConfig(true)}><Icon name="settings" size={16} /> Ajustes</button>
      {/* Cota só aparece apertada ou bloqueada: alerta real não se esconde
          para a tela ficar limpa, e cota tranquila não vira enfeite. */}
      <Redline compact />
      <div className="sidebar-linha">
        <span className={`connection ${connection}`} role="status" aria-label={connection === "connected" ? "Conectado ao servidor" : "Sem conexão"}>
          <i />{connection !== "connected" && (connection === "connecting" ? "Conectando…" : "Sem conexão")}
        </span>
        <span className="spacer" />
        {active && <><button className={`btn idioma${traduzir ? " on" : ""}`} aria-label="Traduzir ditado para inglês" aria-pressed={traduzir} onClick={() => { setTraduzir(!traduzir); localStorage.setItem("cockpit.traduzir", !traduzir ? "1" : "0"); }}>{traduzir ? "PT→EN" : "PT"}</button>
        <Microfone estado={voz} ativo={vozOnde === "painel"} onClick={ditarNoPainel} /></>}
      </div>
    </>
  );

  return (
    <div className="cockpit">
      {connection === "disconnected" && <div className="aviso" role="alert">A conexão com o servidor foi interrompida. Reinicie o servidor e recarregue para continuar.<button onClick={() => window.location.reload()}>Recarregar</button></div>}
      <div className="shell">
        <Lateral
          project={project ?? undefined}
          missions={missions}
          activeId={activeId}
          panes={panes}
          agents={agents}
          selectedId={selecionado}
          connected={connection === "connected"}
          onProjetos={() => setVerWorkspace(true)}
          onSelectMission={(id) => trocar(() => { setActiveId(id); setLateralAberta(false); })}
          onSelectPane={abrirPainel}
          onNovaMissao={() => setCriandoMissao(true)}
          onAddAgente={(id) => trocar(() => { setActiveId(id); abrirEscolhaAgente(); })}
          onRenomearMissao={(id, nome) => guarded(async () => { await renomearMissao(id, nome); await recarregarMissoes(projectId); })}
          aberta={lateralAberta}
          onFechar={() => setLateralAberta(false)}
          recolhida={lateralRecolhida}
          onRecolher={(v) => {
            setLateralRecolhida(v);
            localStorage.setItem("cockpit.lateral-recolhida", v ? "1" : "0");
          }}
          pagina={paginaLateral}
          onPagina={setPaginaLateral}
          tarefas={paginaTarefas}
          arquivos={paginaArquivos}
          rodape={ferramentas}
        />
        {lateralAberta && <button className="sidebar-veu" aria-label="Fechar lateral" onClick={() => setLateralAberta(false)} />}
        <main className="stage">
          {/* No celular a lateral é gaveta e precisa de uma porta. No desktop
              ela está sempre aberta, e este botão não existe. */}
          <button className="icon-btn abrir-lateral" aria-label="Abrir lateral" onClick={() => setLateralAberta(true)}><Icon name="grid" size={17} /></button>

          {active && (
            <div className="stage-topbar">
              <div className="stage-mission-info">
                {renomeandoAtiva ? (
                  <form
                    className="mission-rename-inline"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const nome = novoNomeMissao.trim();
                      if (nome) {
                        await renomearMissao(active.id, nome);
                        await recarregarMissoes(projectId);
                        setRenomeandoAtiva(false);
                      }
                    }}
                  >
                    <input
                      autoFocus
                      className="campo mini"
                      value={novoNomeMissao}
                      onChange={(e) => setNovoNomeMissao(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setRenomeandoAtiva(false);
                      }}
                      onBlur={async () => {
                        const nome = novoNomeMissao.trim();
                        if (nome && nome !== active.nome) {
                          await renomearMissao(active.id, nome);
                          await recarregarMissoes(projectId);
                        }
                        setRenomeandoAtiva(false);
                      }}
                    />
                  </form>
                ) : (
                  <span
                    className="stage-mission-title"
                    title={`Missão: ${active.nome} (clique para renomear)`}
                    onClick={() => {
                      setNovoNomeMissao(active.nome);
                      setRenomeandoAtiva(true);
                    }}
                  >
                    <b className="stage-mission-nome-texto">{active.nome}</b> <span className="edit-icon-hint">✏️</span>
                  </span>
                )}
                {active.branch && <span className="stage-mission-badge branch" title={`Branch: ${active.branch}`}>{active.branch}</span>}
                <select
                  className="stage-mission-badge mode stage-mode-select"
                  value={active.modo ?? "livre"}
                  title="Alterar modo de execução da missão"
                  disabled={busy}
                  onChange={(e) => {
                    const novo = e.target.value;
                    guarded(async () => {
                      await mudarModo(active.id, novo);
                      await recarregarMissoes(projectId);
                    });
                  }}
                >
                  <option value="livre">LIVRE</option>
                  <option value="dirigido">DIRIGIDO</option>
                  <option value="autonomo">AUTÔNOMO</option>
                </select>
              </div>
              <div className="stage-topbar-actions">
                <button
                  type="button"
                  className="btn mini"
                  onClick={() => setVerMissao(true)}
                  title="Ver detalhes da missão"
                >
                  Detalhes
                </button>
                <button
                  type="button"
                  className="btn mini solid"
                  onClick={abrirEscolhaAgente}
                  title="Adicionar agente ou terminal limpo"
                >
                  <Icon name="plus" size={12} /> Adicionar
                </button>
              </div>
            </div>
          )}

          {verMissao && active && <Modal title="Detalhes da missão" onClose={() => setVerMissao(false)}>
            <section className="mission-details">
              <header className="panel-heading">
                {renomeandoAtiva ? (
                  <form
                    className="mission-rename-modal-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const nome = novoNomeMissao.trim();
                      if (nome) {
                        await renomearMissao(active.id, nome);
                        await recarregarMissoes(projectId);
                        setRenomeandoAtiva(false);
                      }
                    }}
                  >
                    <input
                      autoFocus
                      className="campo"
                      value={novoNomeMissao}
                      onChange={(e) => setNovoNomeMissao(e.target.value)}
                      onBlur={async () => {
                        const nome = novoNomeMissao.trim();
                        if (nome && nome !== active.nome) {
                          await renomearMissao(active.id, nome);
                          await recarregarMissoes(projectId);
                        }
                        setRenomeandoAtiva(false);
                      }}
                    />
                  </form>
                ) : (
                  <h2
                    title="Clique para renomear missão"
                    onClick={() => {
                      setNovoNomeMissao(active.nome);
                      setRenomeandoAtiva(true);
                    }}
                  >
                    {active.nome} <span style={{ fontSize: 13, cursor: "pointer" }}>✏️</span>
                  </h2>
                )}
                <button className="icon-btn" aria-label="Fechar detalhes da missão" onClick={() => setVerMissao(false)}><Icon name="close" /></button>
              </header>
              <p className="mission-objective">{active.objetivo || "Esta missão ainda não tem um objetivo definido."}</p>
              <dl className="detail-list">
                <div><dt>Projeto</dt><dd>{project?.nome}</dd></div>
                <div><dt>Pasta de trabalho</dt><dd>{active.isolada ? active.worktree : project?.root}</dd></div>
                <div><dt>Workspace</dt><dd>{active.isolada ? "Worktree legado — resgatar antes de remover" : "Pasta real do projeto"}</dd></div>
                <div>
                  <dt>Modo de execução</dt>
                  <dd>
                    <select
                      className="campo"
                      style={{ padding: "4px 8px", width: "auto", display: "inline-block" }}
                      value={active.modo ?? "livre"}
                      disabled={busy}
                      onChange={(e) => {
                        const novo = e.target.value;
                        guarded(async () => {
                          await mudarModo(active.id, novo);
                          await recarregarMissoes(projectId);
                        });
                      }}
                    >
                      <option value="livre">Livre (controle 100% manual)</option>
                      <option value="dirigido">Dirigido (delegações autorizadas)</option>
                      <option value="autonomo">Autônomo (coordenação contínua)</option>
                    </select>
                  </dd>
                </div>
                <div><dt>Arquivos alterados</dt><dd>{active.git.dirty}</dd></div>
                <div><dt>Elenco</dt><dd>{active.elenco?.clis.map(cli => `${cli}${active.elenco?.soVisual?.includes(cli) ? " (só imagens)" : ""}`).join(" · ") || "Catálogo de agentes"}</dd></div>
              </dl>
              <button className="btn" aria-label="Maestro" onClick={() => { setVerMissao(false); setVerMaestro(true); }}><Icon name="team" size={16} /> Maestro e continuidade · {maestroCli ?? "Escolher"}</button>
          {active && verMissao && (
            <SquadBar
              mission={active}
              squads={squads}
              busy={busy}
              voz={voz}
              vozAqui={vozOnde === "brief"}
              onDitar={(aplicar) => ditar("brief", aplicar)}
              onRun={(squad, brief) =>
                guarded(async () => {
                  await postSquad(active.id, squad, brief);
                  await recarregarMissoes(projectId);
                })
              }
              onAvancar={() =>
                guarded(async () => {
                  await postAvancarFase(active.id);
                  await recarregarMissoes(projectId);
                })
              }
            />
          )}

            </section>
          </Modal>}

          {verAgentes && active && (
            <Modal title="Adicionar Agente ou Terminal" onClose={fecharEscolhaAgente}>
              <section className="agent-picker-panel">
                <header className="panel-heading">
                  <div>
                    <h2>Catálogo de Papéis & Executores</h2>
                    <p>Você define papel, executor e modelo em etapas independentes com soberania total.</p>
                  </div>
                  <button className="icon-btn" aria-label="Fechar catálogo" onClick={fecharEscolhaAgente}>
                    <Icon name="close" />
                  </button>
                </header>
                <RoleCatalog
                  providers={providers}
                  pontes={pontes}
                  elenco={active.elenco}
                  defaultRole="builder"
                  defaultRunner="bash"
                  missionId={active.id}
                  onCancel={fecharEscolhaAgente}
                  onLaunch={(params) => {
                    const role = roleDefinitionFor(params.role, params.customRole ? [params.customRole] : []);
                    const agent = params.runner === "bash"
                      ? "shell"
                      : agentForRole(agents, role) ?? role.baseAgent ?? "builder";
                    send({
                      type: "spawn",
                      agent,
                      missionId: active.id,
                      cli: params.runner,
                      model: params.model,
                      effort: params.effort || undefined,
                      tarefa: params.tarefa,
                      role: params.role,
                      roleDefinition: params.roleDefinition,
                      runner: params.runner,
                      maestro: params.role === "maestro",
                      preferredAccountId: params.preferredAccountId,
                      accountPinned: params.accountPinned || undefined,
                      backend: params.backend,
                    });
                    fecharEscolhaAgente();
                  }}
                />
              </section>
            </Modal>
          )}

          {verAtividade && <Modal title="Atividade" onClose={() => setVerAtividade(false)}>
            <section className="activity-panel"><header className="panel-heading"><h2>Atividade</h2><button className="icon-btn" aria-label="Fechar atividade" onClick={() => setVerAtividade(false)}><Icon name="close" /></button></header>
              <dl className="detail-list">
                <div><dt>Agentes abertos</dt><dd>{panes.length}</dd></div>
                <div><dt>Missões neste projeto</dt><dd>{missions.length}</dd></div>
                <div><dt>Notas de memória</dt><dd>{memoria.length}</dd></div>
                <div><dt>Custo estimado do projeto</dt><dd>${custoTotal.toFixed(2)}</dd></div>
              </dl>
              <Redline />
              <button className="btn" onClick={() => { setVerAtividade(false); setVerConsumo(true); }}>Detalhar consumo <Icon name="arrow" size={16} /></button>
            </section>
          </Modal>}

          {aviso && (
            <div className="aviso" role="alert">
              {aviso}
              <button onClick={() => setAviso(null)}>✕</button>
            </div>
          )}

          {criandoMissao && (
            <Modal title="Nova missão" onClose={() => setCriandoMissao(false)}>
            <NovaMissao
              agents={agents}
              squads={squads}
              tarefas={tarefas}
              providers={providers}
              receitas={receitas}
              onCriar={criarMissao}
              onCancelar={() => setCriandoMissao(false)}
            />
            </Modal>
          )}

          {verConfig && (
            <Modal title="Ajustes" onClose={() => setVerConfig(false)}>
            <Ajustes
              colunas={colunas}
              onColunas={(c) => { setColunas(c); localStorage.setItem("cockpit.colunas", c); }}
              agents={agents}
              squads={squads}
              tarefas={tarefas}
              missionId={active?.id}
              onFechar={() => setVerConfig(false)}
              onMudou={() => {
                void fetchConfig().then((c) => {
                  setAgents(c.agents);
                  setSquads(c.squads);
                  setTarefas(c.tarefas ?? {});
                  setProviders(c.providers ?? []);
                  setReceitas(c.receitas ?? {});
                });
              }}
            />
            </Modal>
          )}

          {verWorkspace && (
            <Modal title="Projetos e missões" onClose={() => setVerWorkspace(false)}>
              <Workspace
                projects={projects}
                projectId={projectId}
                missions={missions}
                activeId={activeId}
                panes={panes}
                agents={agents}
                busy={busy}
                escolhendo={escolhendo}
                onTrocarProjeto={(id) =>
                  trocar(() => {
                    projectIdRef.current = id;
                    activeIdRef.current = null;
                    setProjectId(id);
                    setActiveId(null);
                    setTree([]);
                    setArquivo(null);
                  })
                }
                onProcurarPasta={() =>
                  guarded(async () => {
                    setEscolhendo(true);
                    try {
                      const resultado = await escolherPasta();
                      if (resultado.navegar) {
                        setEscolhendo(false);
                        setMostrarNavegador(true);
                        return;
                      }
                      if (!resultado.caminho) return;
                      const caminho = resultado.caminho;
                      const p = await postProject(caminho);
                      await recarregarProjetos();
                      setProjectId(p.id);
                    } finally {
                      setEscolhendo(false);
                    }
                  })
                }
                onFecharProjeto={(id) =>
                  trocar(() =>
                    guarded(async () => {
                      await closeProject(id);
                      projectIdRef.current = null;
                      activeIdRef.current = null;
                      setActiveId(null);
                      setTree([]);
                      setArquivo(null);
                      setProjectId(null);
                      await recarregarProjetos();
                    }),
                  )
                }
                onSelectMission={(id) => trocar(() => { setActiveId(id); setVerWorkspace(false); })}
                onCreateMission={() => {
                  setVerWorkspace(false);
                  setCriandoMissao(true);
                }}
                onArquivarMissao={(id) =>
                  guarded(async () => {
                    await deleteMission(id);
                    if (activeId === id) setActiveId(null);
                    await recarregarMissoes(projectId);
                  })
                }
                onFechar={() => setVerWorkspace(false)}
              />
            </Modal>
          )}

          {pendente && (
            <Modal title="Edição não salva" onClose={() => setPendente(null)}>
              <div className="ajustes janela">
                <nav className="abas">
                  <span className="aba-titulo">Edição não salva</span>
                  <span className="spacer" />
                  <button className="icon-btn" onClick={() => setPendente(null)} aria-label="Cancelar troca" title="Ficar aqui">
                    ✕
                  </button>
                </nav>
                <div className="aba-corpo">
                  <div className="wizard-corpo">
                    <p className="dica sem-margem">
                      <code>{arquivo}</code> tem mudanças que ainda não foram para o disco.
                    </p>
                    <div className="form-acoes">
                      <button className="btn quiet" onClick={() => setPendente(null)}>
                        Ficar aqui
                      </button>
                      <button
                        className="btn perigo"
                        onClick={() => {
                          const seguir = pendente;
                          setSujo(false);
                          sujoRef.current = false;
                          setPendente(null);
                          seguir();
                        }}
                      >
                        Descartar
                      </button>
                      <button
                        className="btn solid"
                        disabled={busy}
                        onClick={() => {
                          const seguir = pendente;
                          void guarded(async () => {
                            await saveFile(activeId, projectId, arquivo!, conteudo);
                            setSujo(false);
                            sujoRef.current = false;
                            setPendente(null);
                            seguir();
                          });
                        }}
                      >
                        Salvar e continuar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </Modal>
          )}

          {verConsumo && <Modal title="Consumo" onClose={() => setVerConsumo(false)}><Consumo onFechar={() => setVerConsumo(false)} /></Modal>}
          {verMaestro && <Modal title="Maestro e continuidade" onClose={() => setVerMaestro(false)}><Maestro missionId={active?.id ?? null} onClose={() => setVerMaestro(false)} onChanged={() => { void fetchConfig().then(c => setAgents(c.agents)); }} /></Modal>}
          
          {mostrarNavegador && (
            <div className="fundo-modal" onClick={() => setMostrarNavegador(false)}>
              <div onClick={(e) => e.stopPropagation()}>
                <NavegadorPastas
                  onEscolher={aoEscolherPeloNavegador}
                  onCancelar={() => setMostrarNavegador(false)}
                />
              </div>
            </div>
          )}

          <div className={`work${arquivo ? " dividido" : ""}`}>
            <div className="panes-wrap">
              {!project ? (
                <div className="partida">
                  <h2>Abra uma pasta para começar.</h2>
                  <button
                    className="botao-grande"
                    onClick={() =>
                      guarded(async () => {
                        setEscolhendo(true);
                        try {
                          const resultado = await escolherPasta();
                          if (resultado.navegar) {
                            setEscolhendo(false);
                            setMostrarNavegador(true);
                            return;
                          }
                          if (!resultado.caminho) return;
                          const caminho = resultado.caminho;
                          const p = await postProject(caminho);
                          await recarregarProjetos();
                          setProjectId(p.id);
                        } finally {
                          setEscolhendo(false);
                        }
                      })
                    }
                    disabled={busy}
                  >
                    <Icon name="folder" /> Abrir projeto <Icon name="arrow" size={16} />
                  </button>
                  <p className="rodape-partida">
                    Os agentes trabalham diretamente na pasta que você selecionar.
                  </p>
                </div>
              ) : !active ? (
                <div className="partida">
                  <h2>Qual é a próxima missão?</h2>
                  <button className="botao-grande" onClick={() => setCriandoMissao(true)}>
                    <Icon name="plus" /> Nova missão <Icon name="arrow" size={16} />
                  </button>
                  <p className="rodape-partida">
                    Todas as missões usam a pasta real do projeto. O Cockpit não cria cópias nem troca branches.
                  </p>
                </div>
              ) : visible.length === 0 ? (
                <div className="partida">
                  <h2>Traga o primeiro agente.</h2>
                  <button className="botao-grande" disabled={connection !== "connected"} onClick={abrirEscolhaAgente}><Icon name="plus" size={16} /> Adicionar agente <Icon name="arrow" size={16} /></button>
                  <p className="rodape-partida">
                    O <strong>maestro</strong> divide o trabalho e chama os especialistas sozinho.
                    Um especialista você comanda direto.
                  </p>
                </div>
              ) : null}
              <PaneGrid
                panes={panes}
                missionId={active?.id ?? null}
                agents={agents}
                usos={usos}
                colunas={colunas}
                selectedId={selecionado}
                onSelectPane={(paneId) => setSelectedPane(paneId)}
                connections={connections}
                tasks={tasks}
                onMudarPapel={(paneId, maestro) => {
                  guarded(async () => {
                    await postPapelPainel(paneId, { maestro });
                  });
                }}
                onDefinirAgente={(paneId, agent) => {
                  guarded(async () => {
                    await postPapelPainel(paneId, { maestro: false, agent });
                  });
                }}
                onRenomearLabel={(paneId, novoLabel) => {
                  guarded(async () => {
                    const p = panes.find((x) => x.paneId === paneId);
                    await postPapelPainel(paneId, {
                      label: novoLabel,
                      maestro: p?.maestro ?? false,
                    });
                  });
                }}
                onReclassificarPapel={(paneId, novoPapel) => {
                  guarded(async () => {
                    await postPapelPainel(paneId, {
                      agent: novoPapel,
                      maestro: novoPapel === "maestro",
                    });
                  });
                }}
                onClose={(paneId) => setPaneParaEncerrar(paneId)}
                onConectar={(origemId, destinoId) => {
                  if (!active?.id) return;
                  guarded(async () => {
                    await createConnection(active.id, origemId, destinoId);
                    const res = await fetchConnections(active.id);
                    if (res.ok && res.connections) setConnections(res.connections);
                  });
                }}
                onDesconectar={(connId) => {
                  if (!active?.id) return;
                  guarded(async () => {
                    await deleteConnection(active.id, connId);
                    const res = await fetchConnections(active.id);
                    if (res.ok && res.connections) setConnections(res.connections);
                  });
                }}
              />

            </div>

            {arquivo && (
              <Suspense fallback={<div className="editor"><p className="vazio-nota" role="status">Carregando editor…</p></div>}>
              <Editor
                caminho={arquivo}
                conteudo={conteudo}
                sujo={sujo}
                onChange={(texto) => {
                  setConteudo(texto);
                  setSujo(true);
                }}
                onSave={() =>
                  guarded(async () => {
                    await saveFile(activeId, projectId, arquivo, conteudo);
                    setSujo(false);
                  })
                }
                onClose={() =>
                  trocar(() => {
                    setArquivo(null);
                    setSujo(false);
                  })
                }
              />
              </Suspense>
            )}
          </div>

          {/* Modal de confirmação para encerrar painel (ação destrutiva) */}
          {paneParaEncerrar && (
            <Modal title="Encerrar Terminal" onClose={() => setPaneParaEncerrar(null)}>
              <div className="confirm-dialog-content">
                <header className="panel-heading">
                  <h2>Encerrar painel de terminal?</h2>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Cancelar"
                    onClick={() => setPaneParaEncerrar(null)}
                  >
                    <Icon name="close" />
                  </button>
                </header>
                <p>
                  Tem certeza que deseja encerrar o painel{" "}
                  <strong>
                    {panes.find((p) => p.paneId === paneParaEncerrar)?.label ?? paneParaEncerrar}
                  </strong>
                  ?
                </p>
                <p className="dica">
                  O processo PTY em execução será encerrado e o terminal desacoplado.
                </p>
                <footer className="panel-actions">
                  <button
                    type="button"
                    className="btn quiet"
                    onClick={() => setPaneParaEncerrar(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn perigo"
                    onClick={() => {
                      send({ type: "kill", paneId: paneParaEncerrar });
                      setPaneParaEncerrar(null);
                    }}
                  >
                    Encerrar Painel
                  </button>
                </footer>
              </div>
            </Modal>
          )}

          {/* Modal de confirmação para outras ações destrutivas */}
          {confirmacaoDestrutiva && (
            <Modal title={confirmacaoDestrutiva.titulo} onClose={() => setConfirmacaoDestrutiva(null)}>
              <div className="confirm-dialog-content">
                <header className="panel-heading">
                  <h2>{confirmacaoDestrutiva.titulo}</h2>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Cancelar"
                    onClick={() => setConfirmacaoDestrutiva(null)}
                  >
                    <Icon name="close" />
                  </button>
                </header>
                <p>{confirmacaoDestrutiva.mensagem}</p>
                <footer className="panel-actions">
                  <button
                    type="button"
                    className="btn quiet"
                    onClick={() => setConfirmacaoDestrutiva(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn perigo"
                    onClick={() => {
                      confirmacaoDestrutiva.onConfirmar();
                      setConfirmacaoDestrutiva(null);
                    }}
                  >
                    Confirmar Ação
                  </button>
                </footer>
              </div>
            </Modal>
          )}
        </main>
      </div>
    </div>
  );
}
