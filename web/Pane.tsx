import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { onOutput, send } from "./socket.ts";
import type { AgentSpec, Usage } from "./api.ts";
import {
  type PaneState,
  type Connection,
  type Task,
  type GranularPaneStatus,
  GRANULAR_STATUS_MAP,
  CANONICAL_ROLES,
} from "./tipos.ts";
import { Icon } from "./Icon.tsx";
import { Mascote } from "./Mascote.tsx";

const BARRAS = 40;

function compacto(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function Spark({ atividade }: { atividade: number[] }) {
  const janela = atividade.slice(-BARRAS);
  const pico = Math.max(...janela, 1);
  return (
    <span className="spark" aria-hidden>
      {janela.map((v, i) => (
        <i
          key={i}
          className={v === 0 ? "zero" : undefined}
          style={{ height: `${v === 0 ? 8 : 12 + 88 * (Math.log1p(v) / Math.log1p(pico))}%` }}
        />
      ))}
    </span>
  );
}

function desdeQuando(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${Math.round(s / 3600)}h`;
}

export function Pane({
  pane,
  spec,
  usage,
  onClose,
  onMudarPapel,
  onDefinirAgente,
  onRenomearLabel,
  onReclassificarPapel,
  agentes = {},
  todosPaineis = [],
  connections = [],
  tasks = [],
  activeTask,
  temMaestroNaMissao = false,
  visible = true,
  label,
  selecionado = false,
  onConectar,
  onDesconectar,
}: {
  pane: PaneState;
  spec: AgentSpec | undefined;
  usage: Usage | undefined;
  onClose: () => void;
  onMudarPapel?: (paneId: string, maestro: boolean) => void;
  /** Só nomeia Shell já aberto; não troca CLI, modelo nem processo. */
  onDefinirAgente?: (paneId: string, agent: string) => void;
  onRenomearLabel?: (paneId: string, novoLabel: string) => void;
  onReclassificarPapel?: (paneId: string, novoPapel: string) => void;
  agentes?: Record<string, AgentSpec>;
  todosPaineis?: PaneState[];
  connections?: Connection[];
  tasks?: Task[];
  activeTask?: Task | null;
  temMaestroNaMissao?: boolean;
  visible?: boolean;
  label?: string;
  selecionado?: boolean;
  onConectar?: (origemId: string, destinoId: string) => void;
  onDesconectar?: (connectionId: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitter = useRef<FitAddon | null>(null);

  // Inline rename state
  const [renomeando, setRenomeando] = useState(false);
  const [tempLabel, setTempLabel] = useState(label ?? spec?.label ?? pane.label);

  // Role reclassification popover state
  const [menuPapelAberto, setMenuPapelAberto] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [detalhesAberto, setDetalhesAberto] = useState(false);
  const roleBtnRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [detalhesPos, setDetalhesPos] = useState<{ top: number; right: number } | null>(null);

  // Close popovers on click-outside or Escape key
  useEffect(() => {
    if (!menuPapelAberto && !detalhesAberto) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (menuPapelAberto && !target?.closest(".pane-role-container")) {
        setMenuPapelAberto(false);
      }
      if (detalhesAberto && detailsRef.current && !detailsRef.current.contains(target)) {
        detailsRef.current.removeAttribute("open");
        setDetalhesAberto(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuPapelAberto(false);
        if (detailsRef.current) {
          detailsRef.current.removeAttribute("open");
          setDetalhesAberto(false);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuPapelAberto, detalhesAberto]);

  useEffect(() => {
    setTempLabel(label ?? spec?.label ?? pane.label);
  }, [label, spec?.label, pane.label]);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: "#141414",
        foreground: "#e5e5e5",
        cursor: pane.cor,
        selectionBackground: "#ffffff30",
      },
    });
    const fit = new FitAddon();
    terminal.current = term;
    fitter.current = fit;
    term.loadAddon(fit);

    const area = host.current!;
    term.open(area);

    term.onData((data) => send({ type: "input", paneId: pane.paneId, data }));
    term.onResize(({ cols, rows }) =>
      send({ type: "resize", paneId: pane.paneId, cols, rows }),
    );
    const offOutput = onOutput(pane.paneId, (data) => term.write(data));

    const observer = new ResizeObserver(() => {
      if (area.clientHeight > 0 && area.clientWidth > 0) fit.fit();
    });
    observer.observe(area);
    if (area.clientHeight > 0 && area.clientWidth > 0) fit.fit();

    return () => {
      observer.disconnect();
      offOutput();
      term.dispose();
      terminal.current = null;
      fitter.current = null;
    };
  }, [pane.paneId]);

  useEffect(() => {
    if (terminal.current) {
      terminal.current.options.theme = {
        background: "#141414",
        foreground: "#e5e5e5",
        cursor: pane.cor,
        selectionBackground: "#ffffff30",
      };
    }
  }, [pane.cor]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      if (host.current && host.current.clientWidth > 0 && host.current.clientHeight > 0) {
        fitter.current?.fit();
        if (selecionado) terminal.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, selecionado]);

  // Find active task for this pane
  const taskAtiva =
    activeTask ||
    tasks.find((t) => t.pane === pane.paneId && t.status !== "complete" && t.status !== "failed") ||
    null;

  // Strict Connection Check (Feature 14): Only render lines when real persisted connection exists
  const conexoesReais = connections.filter(
    (c) =>
      c.status === "active" &&
      (c.sourcePaneId === pane.paneId || c.targetPaneId === pane.paneId)
  );

  // Status mapping
  const statusInfo =
    GRANULAR_STATUS_MAP[pane.status as GranularPaneStatus] ||
    GRANULAR_STATUS_MAP[pane.status === "dead" ? "dead" : "working"];

  const handleSalvarLabel = () => {
    const val = tempLabel.trim();
    if (val && val !== (label ?? spec?.label ?? pane.label)) {
      onRenomearLabel?.(pane.paneId, val);
    }
    setRenomeando(false);
  };

  const handleEscolherPapel = (papelId: string) => {
    setMenuPapelAberto(false);
    if (papelId === "maestro") {
      onMudarPapel?.(pane.paneId, true);
    } else {
      if (pane.maestro) {
        onMudarPapel?.(pane.paneId, false);
      }
      onReclassificarPapel?.(pane.paneId, papelId);
      onDefinirAgente?.(pane.paneId, papelId);
    }
  };

  const roleName = pane.role || (pane.maestro ? "maestro" : pane.agent);

  return (
    <section
      className={`pane${selecionado ? " selecionado" : ""}${
        menuPapelAberto || detalhesAberto ? " popover-aberto" : ""
      }`}
      hidden={!visible}
      data-pane-id={pane.paneId}
      aria-label={`Terminal de ${label ?? spec?.label ?? pane.label}`}
      style={{ ["--pane" as string]: pane.cor }}
    >
      <header className="pane-head">
        <div className="pane-head-main">
          {/* Mascote */}
          <Mascote semente={pane.agent} cor={pane.cor} estado={pane.status} tamanho={24} />

          {/* 1. Interactive Label with inline rename */}
          {renomeando ? (
            <input
              autoFocus
              className="pane-rename-input"
              value={tempLabel}
              onChange={(e) => setTempLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSalvarLabel();
                if (e.key === "Escape") setRenomeando(false);
              }}
              onBlur={handleSalvarLabel}
            />
          ) : (
            <span
              className="who"
              title="Clique para renomear este terminal"
              onClick={() => setRenomeando(true)}
            >
              {label ?? spec?.label ?? pane.label}
              <button
                type="button"
                className="pane-edit-hint-btn"
                aria-label="Renomear terminal"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenomeando(true);
                }}
              >
                ✏️
              </button>
            </span>
          )}

          {/* BADGE 1: Papel Funcional (.badge-role) with Reclassify Dropdown */}
          <div className="pane-role-container">
            <button
              ref={roleBtnRef}
              type="button"
              className={`pane-badge badge-role${pane.maestro ? " maestro" : ""}`}
              title="Clique para reclassificar o papel funcional deste terminal"
              onClick={() => {
                setMenuPapelAberto((prev) => {
                  if (!prev && roleBtnRef.current) {
                    const r = roleBtnRef.current.getBoundingClientRect();
                    const top = Math.min(r.bottom + 6, Math.max(10, window.innerHeight - 340));
                    const left = Math.min(Math.max(10, r.left), Math.max(10, window.innerWidth - 230));
                    setPopoverPos({ top, left });
                  }
                  return !prev;
                });
              }}
            >
              {pane.maestro ? <Icon name="team" size={12} /> : null}
              <span>{roleName}</span>
              <Icon name="chevron" size={10} />
            </button>

            {menuPapelAberto && popoverPos && (
              <div className="role-reclassify-popover" role="menu" style={{ top: popoverPos.top, left: popoverPos.left }}>
                <span className="popover-title">Reclassificar Papel:</span>
                <button
                  type="button"
                  className={pane.maestro ? "active" : ""}
                  onClick={() => handleEscolherPapel("maestro")}
                >
                  👑 Maestro (Coordenador)
                </button>
                {CANONICAL_ROLES.filter((r) => r.id !== "maestro").map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={roleName === r.id ? "active" : ""}
                    onClick={() => handleEscolherPapel(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* BADGE 2: Executor (.badge-runner) */}
          <span
            className={`pane-badge badge-runner ${pane.cli}`}
            title={`Executor: ${pane.cli} (Soberano)`}
          >
            {pane.cli === "bash" ? (
              <>
                <span className="runner-icon" aria-hidden="true">💻</span>
                <span className="runner-name">bash</span>
              </>
            ) : (
              <>
                <span className="runner-icon" aria-hidden="true">⚡</span>
                <span className="runner-name">{pane.cli}</span>
              </>
            )}
          </span>

          {/* BADGE 3: Modelo (.badge-model) */}
          {pane.cli === "bash" ? (
            <span className="pane-badge badge-model clean-bash" title="Terminal Linux soberano sem LLM">
              clean-bash
            </span>
          ) : pane.model ? (
            <span className="pane-badge badge-model" title={`Modelo: ${pane.model}${pane.effort ? ` · ${pane.effort}` : ""}`}>
              <span className="model-name">{pane.model}</span>
              {pane.effort ? <span className="model-effort"> · {pane.effort}</span> : null}
            </span>
          ) : null}

          {/* BADGE 4: Status Granular de 8 Estados (.badge-status) */}
          <span
            className={`pane-badge badge-status ${pane.status}`}
            title={pane.blockedReason ? `Bloqueado: ${pane.blockedReason}` : statusInfo.description}
          >
            <span className="status-dot-mini" style={{ background: statusInfo.color }} />
            <span className="status-label">{statusInfo.label}</span>
          </span>

          {/* BADGE 5: Tarefa Ativa (.badge-active-task) */}
          {taskAtiva ? (
            <span
              className="pane-badge badge-active-task"
              title={`Tarefa ativa: #${taskAtiva.id} — ${taskAtiva.título}`}
            >
              <span className="task-icon" aria-hidden="true">📋</span>
              <span className="task-id">#{taskAtiva.id.slice(-6)}</span>
              <span className="task-title">: {taskAtiva.título}</span>
            </span>
          ) : (
            <span className="pane-badge badge-no-task" title="Nenhuma tarefa ativa atribuída">
              Sem tarefa
            </span>
          )}

          {/* STRICT CONNECTION WIRE: Only rendered when real connection exists */}
          {conexoesReais.length > 0 && (
            <span
              className="pane-conn-line real"
              title={`Conexão persistida ativa (${conexoesReais.length} ligação${conexoesReais.length > 1 ? "ões" : ""})`}
            >
              <span className="pane-conn-dot" />
              <span className="pane-conn-wire" aria-hidden="true" />
              <span className="conn-label">🔗 Conectado</span>
              <span className="conn-count">({conexoesReais.length})</span>
            </span>
          )}
        </div>

        <div className="pane-head-actions">
          {/* Detalhes & Ações */}
          <details
            className="pane-details"
            ref={detailsRef}
            onToggle={(e) => {
              const open = e.currentTarget.open;
              setDetalhesAberto(open);
              if (open) {
                const summary = e.currentTarget.querySelector("summary");
                if (summary) {
                  const r = summary.getBoundingClientRect();
                  const top = Math.min(r.bottom + 6, Math.max(10, window.innerHeight - 380));
                  const right = Math.max(16, window.innerWidth - r.right);
                  setDetalhesPos({ top, right });
                }
              }
            }}
          >
            <summary>
              Detalhes <Icon name="chevron" size={14} />
            </summary>
            <div className="pane-details-content" style={detalhesPos ? { top: detalhesPos.top, right: detalhesPos.right } : undefined}>
              <Spark atividade={pane.atividade} />
              {usage && usage.turnos > 0 ? (
                <span
                  className="meter"
                  title={`${compacto(usage.in + usage.cacheWrite + usage.cacheRead)} entrada · ${compacto(usage.out)} saída · ${usage.turnos} turnos em ${usage.model ?? "—"}`}
                >
                  ${usage.custo.toFixed(2)}
                </span>
              ) : (
                <span className="meter" title="tempo desde que o painel abriu">
                  {desdeQuando(Date.now() - pane.iniciadoEm)}
                </span>
              )}
              <span className="dica">
                PID / Daemon PTY ativo · {pane.cli}
              </span>

              {/* Ficha Completa de Metadados (visível e acessível em qualquer tamanho de tela) */}
              <div className="pane-meta-summary" style={{ display: "flex", flexDirection: "column", gap: 5, borderTop: "1px solid #30363d", paddingTop: 8, fontSize: 11.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "var(--ink-3)" }}>Papel:</span>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{roleName}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "var(--ink-3)" }}>Executor:</span>
                  <span style={{ color: "var(--ink)" }}>{pane.cli}</span>
                </div>
                {pane.model && (
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ color: "var(--ink-3)" }}>Modelo:</span>
                    <span style={{ color: "var(--ink)", textAlign: "right", wordBreak: "break-word" }}>
                      {pane.model}{pane.effort ? ` (${pane.effort})` : ""}
                    </span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "var(--ink-3)" }}>Status:</span>
                  <span style={{ color: statusInfo.color, fontWeight: 600 }}>● {statusInfo.label}</span>
                </div>
                {pane.blockedReason && (
                  <div style={{ fontSize: 11, color: "var(--alerta)" }}>
                    Bloqueio: {pane.blockedReason}
                  </div>
                )}
                {taskAtiva && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, borderTop: "1px solid #21262d", paddingTop: 5 }}>
                    <span style={{ color: "var(--ink-3)" }}>Tarefa ativa:</span>
                    <span style={{ color: "var(--ink)", fontSize: 11 }}>#{taskAtiva.id.slice(-6)}: {taskAtiva.título}</span>
                  </div>
                )}
              </div>

              {/* Gerenciamento de Conexões */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid #30363d", paddingTop: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)" }}>
                  Conexões ({conexoesReais.length})
                </span>
                {conexoesReais.map((c) => {
                  const outroId = c.sourcePaneId === pane.paneId ? c.targetPaneId : c.sourcePaneId;
                  const outroPane = todosPaineis.find((p) => p.paneId === outroId);
                  const outroNome = outroPane?.label ?? outroId;
                  return (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "var(--ink)" }}>
                      <span>🔗 {outroNome}</span>
                      <button
                        type="button"
                        className="btn mini"
                        style={{ padding: "1px 6px", fontSize: 10 }}
                        onClick={() => onDesconectar?.(c.id)}
                        title="Desconectar"
                      >
                        Desconectar
                      </button>
                    </div>
                  );
                })}

                {/* Conectar a outro painel disponível */}
                {todosPaineis.filter((p) => p.paneId !== pane.paneId).length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <select
                      className="campo"
                      style={{ fontSize: 11, padding: "2px 4px", flex: 1 }}
                      defaultValue=""
                      onChange={(e) => {
                        const destinoId = e.target.value;
                        if (destinoId) {
                          onConectar?.(pane.paneId, destinoId);
                          e.target.value = "";
                        }
                      }}
                    >
                      <option value="" disabled>Conectar a...</option>
                      {todosPaineis
                        .filter((p) => p.paneId !== pane.paneId)
                        .map((p) => (
                          <option key={p.paneId} value={p.paneId}>
                            {p.maestro ? "⭐ " : ""}{p.label} ({p.role || p.agent})
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="btn perigo"
                onClick={onClose}
              >
                Encerrar painel
              </button>
            </div>
          </details>

          <button
            type="button"
            className="pane-close-btn"
            title="Encerrar painel"
            onClick={onClose}
            aria-label="Encerrar painel"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="pane-term" ref={host} />
    </section>
  );
}
