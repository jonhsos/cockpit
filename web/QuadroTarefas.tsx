import { useState, useEffect, useCallback, useMemo } from "react";
import { Icon } from "./Icon.tsx";
import { Modal } from "./Modal.tsx";
import {
  fetchTasks,
  fetchTaskBoard,
  createTask,
  updateTask,
  transitionTask,
  assignTask,
  addEvidence,
  recordKnowledge,
  deleteTask,
  fetchLocks,
  acquireLock,
  releaseLock,
} from "./api.ts";
import { onMessage, onReconnect } from "./socket.ts";
import {
  CANONICAL_TASK_STATUSES,
  CATALOG_ROLES,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type TaskEvidence,
  type FileLock,
  type PaneState,
  type AgentSpec,
} from "./tipos.ts";

export interface QuadroTarefasProps {
  missionId: string | null;
  missionNome?: string;
  panes: PaneState[];
  agents: Record<string, AgentSpec>;
  onSelectPane?: (missionId: string, paneId: string) => void;
}

export function QuadroTarefas({
  missionId,
  missionNome,
  panes,
  agents,
  onSelectPane,
}: QuadroTarefasProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [locks, setLocks] = useState<FileLock[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [filtroTexto, setFiltroTexto] = useState("");
  const [modalKanbanAberto, setModalKanbanAberto] = useState(false);

  // Inspector & modal states
  const [tarefaInspecionada, setTarefaInspecionada] = useState<Task | null>(null);
  const [criandoTarefa, setCriandoTarefa] = useState(false);

  // Form states for creating task
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novaDescricao, setNovaDescricao] = useState("");
  const [novaPrioridade, setNovaPrioridade] = useState<TaskPriority>("normal");
  const [novoPapel, setNovoPapel] = useState<string>("builder");
  const [novoArquivo, setNovoArquivo] = useState("");
  const [novosArquivos, setNovosArquivos] = useState<string[]>([]);

  // Evidence / Note adding state
  const [adicionandoNota, setAdicionandoNota] = useState(false);
  const [textoNota, setTextoNota] = useState("");

  // Transition modal state (e.g. for reason when blocked/failed)
  const [transicaoPendente, setTransicaoPendente] = useState<{
    task: Task;
    novoStatus: TaskStatus;
  } | null>(null);
  const [motivoTransicao, setMotivoTransicao] = useState("");

  // Accordion open/collapse states in compact sidebar mode
  const [colapsados, setColapsados] = useState<Record<TaskStatus, boolean>>({
    todo: false,
    "in-progress": false,
    blocked: false,
    "in-review": false,
    complete: true,
    failed: true,
  });

  const alternarColapso = (status: TaskStatus) => {
    setColapsados((prev) => ({ ...prev, [status]: !prev[status] }));
  };

  // Carregar tarefas e locks da missão ativa
  const carregarDados = useCallback(async () => {
    if (!missionId) {
      setTasks([]);
      setLocks([]);
      return;
    }
    setCarregando(true);
    try {
      const [resTasks, resLocks] = await Promise.all([
        fetchTasks(missionId).catch(() => ({ ok: false, tasks: [] })),
        fetchLocks(missionId).catch(() => ({ ok: false, locks: [] })),
      ]);
      if (resTasks.ok && resTasks.tasks) {
        setTasks(resTasks.tasks);
      }
      if (resLocks.ok && resLocks.locks) {
        setLocks(resLocks.locks);
      }
    } finally {
      setCarregando(false);
    }
  }, [missionId]);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  // Sincronização em tempo real via WebSocket
  useEffect(() => {
    const offReconnect = onReconnect(() => {
      void carregarDados();
    });

    const offMsg = onMessage((msg) => {
      if (msg.type === "task:created") {
        if (!missionId || msg.task.missionId === missionId) {
          setTasks((prev) => {
            if (prev.some((t) => t.id === msg.task.id)) return prev;
            return [...prev, msg.task];
          });
        }
      } else if (msg.type === "task:updated") {
        setTasks((prev) =>
          prev.map((t) => (t.id === msg.task.id ? msg.task : t))
        );
        setTarefaInspecionada((prev) =>
          prev && prev.id === msg.task.id ? msg.task : prev
        );
      } else if (msg.type === "task:status_changed") {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === msg.taskId ? { ...t, status: msg.status } : t
          )
        );
        setTarefaInspecionada((prev) =>
          prev && prev.id === msg.taskId ? { ...prev, status: msg.status } : prev
        );
      } else if (msg.type === "task:deleted") {
        setTasks((prev) => prev.filter((t) => t.id !== msg.taskId));
        setTarefaInspecionada((prev) =>
          prev && prev.id === msg.taskId ? null : prev
        );
      } else if (msg.type === "task:assigned") {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === msg.taskId
              ? {
                  ...t,
                  pane: msg.paneId,
                  responsável: msg.responsavel ?? t.responsável,
                  papel: msg.papel ?? t.papel,
                }
              : t
          )
        );
      } else if (msg.type === "task:evidence_added") {
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== msg.taskId) return t;
            return {
              ...t,
              evidências: [...t.evidências, msg.evidence],
            };
          })
        );
        setTarefaInspecionada((prev) => {
          if (!prev || prev.id !== msg.taskId) return prev;
          return {
            ...prev,
            evidências: [...prev.evidências, msg.evidence],
          };
        });
      }
    });

    return () => {
      offReconnect();
      offMsg();
    };
  }, [missionId, carregarDados]);

  // Group tasks by formal state
  const tarefasFiltradas = useMemo(() => {
    if (!filtroTexto.trim()) return tasks;
    const q = filtroTexto.toLowerCase();
    return tasks.filter(
      (t) =>
        t.título.toLowerCase().includes(q) ||
        t.descrição.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.papel && t.papel.toLowerCase().includes(q)) ||
        (t.responsável && t.responsável.toLowerCase().includes(q))
    );
  }, [tasks, filtroTexto]);

  const porStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      todo: [],
      "in-progress": [],
      blocked: [],
      "in-review": [],
      complete: [],
      failed: [],
    };
    for (const t of tarefasFiltradas) {
      if (map[t.status]) {
        map[t.status].push(t);
      }
    }
    return map;
  }, [tarefasFiltradas]);

  // Handlers for task mutations
  const handleCriarTarefa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!missionId || !novoTitulo.trim()) return;

    try {
      const res = await createTask(missionId, {
        título: novoTitulo.trim(),
        descrição: novaDescricao.trim(),
        prioridade: novaPrioridade,
        papel: novoPapel,
        "arquivos permitidos": novosArquivos,
      });
      if (res.ok && res.task) {
        setTasks((prev) => [...prev, res.task]);
        setCriandoTarefa(false);
        setNovoTitulo("");
        setNovaDescricao("");
        setNovosArquivos([]);
        setNovoArquivo("");
      }
    } catch (err) {
      alert(`Falha ao criar tarefa: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleTransicionar = async (task: Task, novoStatus: TaskStatus, motivo?: string) => {
    if (!missionId) return;
    try {
      const res = await transitionTask(missionId, task.id, novoStatus, {
        reason: motivo,
        resultado: novoStatus === "complete" ? "Concluído via Cockpit" : undefined,
      });
      if (res.ok && res.task) {
        setTasks((prev) => prev.map((t) => (t.id === res.task.id ? res.task : t)));
        if (tarefaInspecionada?.id === res.task.id) {
          setTarefaInspecionada(res.task);
        }
      }
    } catch (err) {
      alert(`Falha na transição: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const solicitarTransicao = (task: Task, novoStatus: TaskStatus) => {
    if (novoStatus === "blocked" || novoStatus === "failed") {
      setTransicaoPendente({ task, novoStatus });
      setMotivoTransicao("");
    } else {
      void handleTransicionar(task, novoStatus);
    }
  };

  const confirmarTransicaoPendente = () => {
    if (!transicaoPendente) return;
    void handleTransicionar(
      transicaoPendente.task,
      transicaoPendente.novoStatus,
      motivoTransicao.trim() || undefined
    );
    setTransicaoPendente(null);
    setMotivoTransicao("");
  };

  const handleAtribuirPainel = async (taskId: string, paneId: string | null) => {
    if (!missionId) return;
    try {
      const targetPane = panes.find((p) => p.paneId === paneId);
      const res = await assignTask(
        missionId,
        taskId,
        paneId,
        targetPane?.label ?? undefined,
        targetPane?.role ?? undefined
      );
      if (res.ok && res.task) {
        setTasks((prev) => prev.map((t) => (t.id === res.task.id ? res.task : t)));
        if (tarefaInspecionada?.id === res.task.id) {
          setTarefaInspecionada(res.task);
        }
      }
    } catch (err) {
      alert(`Falha ao atribuir painel: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleAdicionarEvidencia = async (taskId: string) => {
    if (!missionId || !textoNota.trim()) return;
    try {
      const res = await recordKnowledge(
        missionId,
        taskId,
        "Nota registrada no Cockpit",
        textoNota.trim(),
        "usuário"
      );
      if (res.ok && res.evidence) {
        setTextoNota("");
        setAdicionandoNota(false);
      }
    } catch (err) {
      alert(`Falha ao registrar nota: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExcluirTarefa = async (taskId: string) => {
    if (!missionId) return;
    if (!window.confirm("Deseja realmente excluir esta tarefa?")) return;
    try {
      await deleteTask(missionId, taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (tarefaInspecionada?.id === taskId) {
        setTarefaInspecionada(null);
      }
    } catch (err) {
      alert(`Falha ao excluir tarefa: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleAcquireLock = async (taskId: string, file: string) => {
    if (!missionId) return;
    try {
      const res = await acquireLock(missionId, {
        taskId,
        files: [file],
        mode: "isolated",
        owner: "user",
      });
      if (!res.ok) {
        alert(`Conflito de Lock (409): ${res.message || "Arquivo já bloqueado por outro agente"}`);
      } else {
        void carregarDados();
      }
    } catch (err) {
      alert(`Erro ao adquirir lock: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleReleaseLock = async (taskId: string, file: string) => {
    if (!missionId) return;
    try {
      await releaseLock(missionId, { taskId, files: [file] });
      void carregarDados();
    } catch (err) {
      alert(`Erro ao liberar lock: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!missionId) {
    return (
      <div className="quadro-tarefas-vazio">
        <p className="sidebar-vazio">Selecione uma missão para visualizar o placar de tarefas.</p>
      </div>
    );
  }

  return (
    <div className="quadro-tarefas-sidebar">
      {/* Top action bar in sidebar */}
      <div className="tarefas-topo">
        <div className="tarefas-topo-info">
          <span className="tarefas-contagem">
            <b>{tasks.length}</b> {tasks.length === 1 ? "tarefa" : "tarefas"}
          </span>
          <button
            type="button"
            className="btn mini btn-kanban-expand"
            title="Expandir placar completo em modo Kanban"
            onClick={() => setModalKanbanAberto(true)}
          >
            <Icon name="grid" size={13} /> Kanban
          </button>
        </div>

        <div className="tarefas-busca-row">
          <input
            type="search"
            className="tarefas-busca-input"
            placeholder="Filtrar tarefas..."
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
          />
          <button
            type="button"
            className="icon-btn tarefas-novo-btn"
            title="Nova Tarefa"
            onClick={() => setCriandoTarefa(true)}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>

      {carregando && <div className="tarefas-carregando">Carregando placar...</div>}

      {/* 6 Formal Status Accordion Sections */}
      <div className="tarefas-accordion-lista">
        {CANONICAL_TASK_STATUSES.map((st) => {
          const lista = porStatus[st.id] || [];
          const colapsado = colapsados[st.id];

          return (
            <div key={st.id} className={`status-secao ${st.id}${colapsado ? " colapsado" : ""}`}>
              <button
                type="button"
                className="status-secao-header"
                onClick={() => alternarColapso(st.id)}
                aria-expanded={!colapsado}
              >
                <span className="status-dot" style={{ background: st.color }} />
                <span className="status-titulo">{st.label}</span>
                <span className="status-count">{lista.length}</span>
                <Icon
                  name="chevron"
                  size={12}
                  style={{
                    transform: colapsado ? "rotate(-90deg)" : "rotate(0deg)",
                    transition: "transform 140ms ease",
                  }}
                />
              </button>

              {!colapsado && (
                <div className="status-tarefas-cards">
                  {lista.length === 0 ? (
                    <p className="status-vazio">Nenhuma</p>
                  ) : (
                    lista.map((task) => {
                      const lockDoTask = locks.filter((l) => l.taskId === task.id);
                      return (
                        <div
                          key={task.id}
                          className="tarefa-card-compacto"
                          onClick={() => setTarefaInspecionada(task)}
                        >
                          <div className="tarefa-card-top">
                            <span className="tarefa-card-id">#{task.id.slice(-6)}</span>
                            <span className={`tarefa-prioridade ${task.prioridade}`}>
                              {task.prioridade}
                            </span>
                          </div>

                          <div className="tarefa-card-titulo">{task.título}</div>

                          <div className="tarefa-card-badges">
                            {task.papel && (
                              <span className="badge-papel-mini">
                                {task.papel}
                              </span>
                            )}
                            {task.pane ? (
                              <span className="badge-pane-mini">
                                <Icon name="terminal" size={10} /> {task.pane}
                              </span>
                            ) : null}
                            {lockDoTask.length > 0 && (
                              <span className="badge-lock-mini" title={`${lockDoTask.length} locks ativos`}>
                                🔒 {lockDoTask.length}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* =================================================================== */}
      {/* MODAL 1: KANBAN EXPANDIDO (6 COLUNAS)                               */}
      {/* =================================================================== */}
      {modalKanbanAberto && (
        <Modal title={`Placar de Tarefas — ${missionNome || "Missão"}`} onClose={() => setModalKanbanAberto(false)}>
          <div className="kanban-modal-view">
            <header className="kanban-modal-header">
              <div>
                <h2>Placar de Tarefas (Kanban)</h2>
                <p>Ciclo formal de 6 estados com ownership e evidências.</p>
              </div>
              <div className="kanban-modal-actions">
                <button
                  type="button"
                  className="btn solid mini"
                  onClick={() => setCriandoTarefa(true)}
                >
                  <Icon name="plus" size={14} /> Nova Tarefa
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setModalKanbanAberto(false)}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            </header>

            <div className="kanban-grid-6">
              {CANONICAL_TASK_STATUSES.map((st) => {
                const lista = porStatus[st.id] || [];
                return (
                  <div key={st.id} className={`kanban-coluna ${st.id}`}>
                    <div className="kanban-coluna-header">
                      <span className="status-dot" style={{ background: st.color }} />
                      <span className="kanban-coluna-titulo">{st.label}</span>
                      <span className="status-count">{lista.length}</span>
                    </div>

                    <div className="kanban-coluna-corpo">
                      {lista.map((task) => (
                        <div
                          key={task.id}
                          className="kanban-task-card"
                          onClick={() => setTarefaInspecionada(task)}
                        >
                          <div className="kanban-card-top">
                            <span className="tarefa-card-id">#{task.id.slice(-6)}</span>
                            <span className={`tarefa-prioridade ${task.prioridade}`}>
                              {task.prioridade}
                            </span>
                          </div>

                          <h4 className="kanban-card-title">{task.título}</h4>

                          {task.descrição && (
                            <p className="kanban-card-desc">{task.descrição}</p>
                          )}

                          <div className="kanban-card-footer">
                            <div className="kanban-card-tags">
                              {task.papel && <span className="tag-role">{task.papel}</span>}
                              {task.pane && <span className="tag-pane">{task.pane}</span>}
                            </div>

                            {/* Status Quick Transition Dropdown */}
                            <select
                              className="kanban-quick-status"
                              value={task.status}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                e.stopPropagation();
                                solicitarTransicao(task, e.target.value as TaskStatus);
                              }}
                            >
                              {CANONICAL_TASK_STATUSES.map((s) => (
                                <option key={s.id} value={s.id}>
                                  → {s.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Modal>
      )}

      {/* =================================================================== */}
      {/* MODAL 2: INSPECTOR & EDITOR DE TAREFA (13 CAMPOS CANÔNICOS)         */}
      {/* =================================================================== */}
      {tarefaInspecionada && (
        <Modal title={`Tarefa #${tarefaInspecionada.id.slice(-6)}`} onClose={() => setTarefaInspecionada(null)}>
          <div className="task-inspector-modal">
            <header className="inspector-header">
              <div className="inspector-id-block">
                <span className="inspector-id">ID: {tarefaInspecionada.id}</span>
                <span className={`tarefa-prioridade ${tarefaInspecionada.prioridade}`}>
                  {tarefaInspecionada.prioridade}
                </span>
                <span className={`badge-status-pill ${tarefaInspecionada.status}`}>
                  {CANONICAL_TASK_STATUSES.find((s) => s.id === tarefaInspecionada.status)?.label ??
                    tarefaInspecionada.status}
                </span>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setTarefaInspecionada(null)}
              >
                <Icon name="close" size={16} />
              </button>
            </header>

            <div className="inspector-body">
              {/* Field 2: Título */}
              <label className="campo-bloco">
                <span className="rotulo">Título</span>
                <input
                  type="text"
                  className="campo"
                  value={tarefaInspecionada.título}
                  onChange={(e) => {
                    const novo = e.target.value;
                    setTarefaInspecionada((prev) => (prev ? { ...prev, título: novo } : null));
                  }}
                  onBlur={() => {
                    if (missionId && tarefaInspecionada) {
                      void updateTask(missionId, tarefaInspecionada.id, {
                        título: tarefaInspecionada.título,
                      });
                    }
                  }}
                />
              </label>

              {/* Field 3: Descrição */}
              <label className="campo-bloco">
                <span className="rotulo">Descrição</span>
                <textarea
                  className="campo area"
                  rows={3}
                  value={tarefaInspecionada.descrição}
                  onChange={(e) => {
                    const novo = e.target.value;
                    setTarefaInspecionada((prev) => (prev ? { ...prev, descrição: novo } : null));
                  }}
                  onBlur={() => {
                    if (missionId && tarefaInspecionada) {
                      void updateTask(missionId, tarefaInspecionada.id, {
                        descrição: tarefaInspecionada.descrição,
                      });
                    }
                  }}
                />
              </label>

              {/* Row: Status, Prioridade, Papel */}
              <div className="inspector-row-3">
                <label className="campo-bloco">
                  <span className="rotulo">Mudar Status</span>
                  <select
                    className="campo"
                    value={tarefaInspecionada.status}
                    onChange={(e) => {
                      solicitarTransicao(tarefaInspecionada, e.target.value as TaskStatus);
                    }}
                  >
                    {CANONICAL_TASK_STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="campo-bloco">
                  <span className="rotulo">Prioridade</span>
                  <select
                    className="campo"
                    value={tarefaInspecionada.prioridade}
                    onChange={(e) => {
                      const nova = e.target.value as TaskPriority;
                      setTarefaInspecionada((prev) => (prev ? { ...prev, prioridade: nova } : null));
                      if (missionId) {
                        void updateTask(missionId, tarefaInspecionada.id, { prioridade: nova });
                      }
                    }}
                  >
                    <option value="low">Baixa (low)</option>
                    <option value="normal">Normal</option>
                    <option value="high">Alta (high)</option>
                    <option value="critical">Crítica (critical)</option>
                  </select>
                </label>

                <label className="campo-bloco">
                  <span className="rotulo">Papel Atribuído</span>
                  <select
                    className="campo"
                    value={tarefaInspecionada.papel || ""}
                    onChange={(e) => {
                      const papel = e.target.value || null;
                      setTarefaInspecionada((prev) => (prev ? { ...prev, papel } : null));
                      if (missionId) {
                        void updateTask(missionId, tarefaInspecionada.id, { papel: papel ?? undefined });
                      }
                    }}
                  >
                    <option value="">Nenhum</option>
                    {CATALOG_ROLES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Live Pane Assignment & Terminal Focus */}
              <div className="campo-bloco">
                <span className="rotulo">Terminal / Painel Ativo</span>
                <div className="inspector-pane-row">
                  <select
                    className="campo"
                    value={tarefaInspecionada.pane || ""}
                    onChange={(e) => {
                      const pId = e.target.value || null;
                      void handleAtribuirPainel(tarefaInspecionada.id, pId);
                    }}
                  >
                    <option value="">Nenhum painel vinculado</option>
                    {panes
                      .filter((p) => p.missionId === missionId)
                      .map((p) => (
                        <option key={p.paneId} value={p.paneId}>
                          {p.label || p.agent} ({p.cli} · {p.status})
                        </option>
                      ))}
                  </select>

                  {tarefaInspecionada.pane && onSelectPane && missionId && (
                    <button
                      type="button"
                      className="btn mini solid"
                      onClick={() => onSelectPane(missionId, tarefaInspecionada.pane!)}
                      title="Ir para o terminal vinculado"
                    >
                      <Icon name="terminal" size={12} /> Focar Painel
                    </button>
                  )}
                </div>
              </div>

              {/* Field 7: Arquivos Permitidos & Locks */}
              <div className="campo-bloco">
                <span className="rotulo">Arquivos Permitidos & Locks de Escrita (R7)</span>
                <div className="inspector-files-list">
                  {tarefaInspecionada["arquivos permitidos"]?.length === 0 ? (
                    <span className="dica">Nenhum arquivo restrito.</span>
                  ) : (
                    tarefaInspecionada["arquivos permitidos"].map((f) => {
                      const lockAtivo = locks.find(
                        (l) => l.taskId === tarefaInspecionada.id && l.file === f
                      );
                      return (
                        <div key={f} className="inspector-file-item">
                          <span className="file-name">{f}</span>
                          {lockAtivo ? (
                            <button
                              type="button"
                              className="btn mini quiet"
                              onClick={() => handleReleaseLock(tarefaInspecionada.id, f)}
                              title="Liberar lock exclusivo"
                            >
                              🔒 Bloqueado (Liberar)
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn mini"
                              onClick={() => handleAcquireLock(tarefaInspecionada.id, f)}
                              title="Adquirir lock isolado"
                            >
                              🔓 Bloquear (Adquirir)
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Field 11: Evidências & Conhecimento */}
              <div className="campo-bloco">
                <div className="rotulo-com-acao">
                  <span className="rotulo">Linha do Tempo de Evidências ({tarefaInspecionada.evidências.length})</span>
                  <button
                    type="button"
                    className="btn mini"
                    onClick={() => setAdicionandoNota(!adicionandoNota)}
                  >
                    + Adicionar Nota
                  </button>
                </div>

                {adicionandoNota && (
                  <div className="inspector-nova-nota">
                    <textarea
                      className="campo area"
                      rows={2}
                      placeholder="Descreva a evidência ou anotação..."
                      value={textoNota}
                      onChange={(e) => setTextoNota(e.target.value)}
                    />
                    <div className="nova-nota-actions">
                      <button
                        type="button"
                        className="btn quiet mini"
                        onClick={() => setAdicionandoNota(false)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn solid mini"
                        disabled={!textoNota.trim()}
                        onClick={() => handleAdicionarEvidencia(tarefaInspecionada.id)}
                      >
                        Salvar Evidência
                      </button>
                    </div>
                  </div>
                )}

                <div className="inspector-evidencias-scroll">
                  {tarefaInspecionada.evidências.length === 0 ? (
                    <span className="dica">Nenhuma evidência registrada ainda.</span>
                  ) : (
                    tarefaInspecionada.evidências.map((ev) => (
                      <div key={ev.id} className="inspector-ev-card">
                        <div className="ev-header">
                          <span className={`ev-tipo ${ev.tipo}`}>{ev.tipo}</span>
                          <span className="ev-time">
                            {new Date(ev.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="ev-desc">{ev.descricao}</p>
                        {ev.conteudo && <pre className="ev-content">{ev.conteudo}</pre>}
                        {ev.diff && <pre className="ev-diff">{ev.diff}</pre>}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Field 12: Resultado (se houver) */}
              {tarefaInspecionada.resultado && (
                <div className="campo-bloco">
                  <span className="rotulo">Resultado</span>
                  <div className="inspector-resultado">{tarefaInspecionada.resultado}</div>
                </div>
              )}

              {/* Field 13: Timestamps */}
              <div className="inspector-timestamps">
                <span>Criada: {new Date(tarefaInspecionada.timestamps.criadaEm).toLocaleString()}</span>
                {tarefaInspecionada.timestamps.concluidaEm && (
                  <span>Concluída: {new Date(tarefaInspecionada.timestamps.concluidaEm).toLocaleString()}</span>
                )}
                <span>Atualizada: {new Date(tarefaInspecionada.timestamps.atualizadaEm).toLocaleString()}</span>
              </div>
            </div>

            <footer className="inspector-footer">
              <button
                type="button"
                className="btn perigo mini"
                onClick={() => handleExcluirTarefa(tarefaInspecionada.id)}
              >
                Excluir Tarefa
              </button>
              <button
                type="button"
                className="btn solid mini"
                onClick={() => setTarefaInspecionada(null)}
              >
                Fechar
              </button>
            </footer>
          </div>
        </Modal>
      )}

      {/* =================================================================== */}
      {/* MODAL 3: CRIAR NOVA TAREFA                                         */}
      {/* =================================================================== */}
      {criandoTarefa && (
        <Modal title="Nova Tarefa" onClose={() => setCriandoTarefa(false)}>
          <form className="nova-tarefa-form" onSubmit={handleCriarTarefa}>
            <header className="panel-heading">
              <h2>Criar Tarefa Estruturada</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setCriandoTarefa(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </header>

            <label className="campo-bloco">
              <span className="rotulo">Título da Tarefa</span>
              <input
                type="text"
                autoFocus
                className="campo"
                placeholder="ex: Implementar rotas de autenticação, Refatorar estilos"
                value={novoTitulo}
                onChange={(e) => setNovoTitulo(e.target.value)}
                required
              />
            </label>

            <label className="campo-bloco">
              <span className="rotulo">Descrição / Critérios de Aceite</span>
              <textarea
                className="campo area"
                rows={3}
                placeholder="Detalhes sobre o que deve ser entregue e testado..."
                value={novaDescricao}
                onChange={(e) => setNovaDescricao(e.target.value)}
              />
            </label>

            <div className="custom-row">
              <label className="campo-bloco" style={{ flex: 1 }}>
                <span className="rotulo">Papel Recomendado</span>
                <select
                  className="campo"
                  value={novoPapel}
                  onChange={(e) => setNovoPapel(e.target.value)}
                >
                  {CATALOG_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="campo-bloco" style={{ flex: 1 }}>
                <span className="rotulo">Prioridade</span>
                <select
                  className="campo"
                  value={novaPrioridade}
                  onChange={(e) => setNovaPrioridade(e.target.value as TaskPriority)}
                >
                  <option value="low">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="critical">Crítica</option>
                </select>
              </label>
            </div>

            <div className="campo-bloco">
              <span className="rotulo">Arquivos Permitidos / Escopo de Trabalho</span>
              <div className="arquivo-add-row">
                <input
                  type="text"
                  className="campo"
                  placeholder="ex: web/App.tsx, servidor/routes/index.ts"
                  value={novoArquivo}
                  onChange={(e) => setNovoArquivo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && novoArquivo.trim()) {
                      e.preventDefault();
                      setNovosArquivos((prev) => [...prev, novoArquivo.trim()]);
                      setNovoArquivo("");
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn mini"
                  disabled={!novoArquivo.trim()}
                  onClick={() => {
                    setNovosArquivos((prev) => [...prev, novoArquivo.trim()]);
                    setNovoArquivo("");
                  }}
                >
                  + Adicionar
                </button>
              </div>

              {novosArquivos.length > 0 && (
                <div className="novos-arquivos-tags">
                  {novosArquivos.map((f, i) => (
                    <span key={i} className="tag-file">
                      {f}{" "}
                      <button
                        type="button"
                        onClick={() =>
                          setNovosArquivos((prev) => prev.filter((_, idx) => idx !== i))
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <footer className="panel-actions">
              <button
                type="button"
                className="btn quiet"
                onClick={() => setCriandoTarefa(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn solid"
                disabled={!novoTitulo.trim()}
              >
                Criar Tarefa
              </button>
            </footer>
          </form>
        </Modal>
      )}

      {/* =================================================================== */}
      {/* MODAL 4: MOTIVO DA TRANSIÇÃO (BLOCKED OU FAILED)                    */}
      {/* =================================================================== */}
      {transicaoPendente && (
        <Modal title="Informar Motivo da Transição" onClose={() => setTransicaoPendente(null)}>
          <div className="motivo-transicao-modal">
            <header className="panel-heading">
              <h2>
                Marcar tarefa como {transicaoPendente.novoStatus === "blocked" ? "Bloqueada" : "Falha"}
              </h2>
            </header>

            <label className="campo-bloco">
              <span className="rotulo">Motivo / Causa do Bloqueio</span>
              <textarea
                autoFocus
                className="campo area"
                rows={3}
                placeholder="Explique o motivo (ex: dependência não concluída, erro na execução do teste, cota esgotada)..."
                value={motivoTransicao}
                onChange={(e) => setMotivoTransicao(e.target.value)}
              />
            </label>

            <footer className="panel-actions">
              <button
                type="button"
                className="btn quiet"
                onClick={() => setTransicaoPendente(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn solid"
                onClick={confirmarTransicaoPendente}
              >
                Confirmar Transição
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}
