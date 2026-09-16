import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { discardBufferedOutput, onOutput, send, takeBufferedOutput } from "./socket.ts";
import { fetchPaneReplay, postPanePrompt, openLoginTerminal, type AgentSpec, type Usage } from "./api.ts";
import {
  type PaneState,
  type Connection,
  type Task,
  type GranularPaneStatus,
  GRANULAR_STATUS_MAP,
  CATALOG_ROLES,
} from "./tipos.ts";
import { Icon } from "./Icon.tsx";
import { Mascote } from "./Mascote.tsx";
import { nomeDoPainel } from "./rotulos.ts";
import { roleDefinitionFor } from "./role-contract.ts";

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
  onMinimizar,
  minimizado = false,
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
  gridColumn,
  layoutEpoch,
  emFoco = false,
  onFocar,
  onVoltarFoco,
}: {
  pane: PaneState;
  spec: AgentSpec | undefined;
  usage: Usage | undefined;
  onClose: () => void;
  onMinimizar?: () => void;
  minimizado?: boolean;
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
  gridColumn?: string;
  /** Muda quando a grade reflowa (minimizar/colunas) — força fit do xterm. */
  layoutEpoch?: string;
  emFoco?: boolean;
  onFocar?: () => void;
  onVoltarFoco?: () => void;
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

  // DSH interactive prompt state (Requirement R1)
  const isDsh = pane.backend === "dsh";
  const isDshRef = useRef(isDsh);
  isDshRef.current = isDsh;
  const [promptTexto, setPromptTexto] = useState("");
  const [promptEnviando, setPromptEnviando] = useState(false);
  const [promptErro, setPromptErro] = useState<string | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  const handleEnviarPrompt = async () => {
    const texto = promptTexto.trim();
    if (!texto || promptEnviando) return;
    setPromptEnviando(true);
    setPromptErro(null);
    try {
      const result = await postPanePrompt(pane.paneId, texto);
      if (!result.ok) throw new Error("O servidor rejeitou o prompt");
      setPromptTexto("");
    } catch (err) {
      setPromptErro(err instanceof Error ? err.message : String(err));
    } finally {
      setPromptEnviando(false);
      promptInputRef.current?.focus();
    }
  };

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleEnviarPrompt();
    }
  };

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
      smoothScrollDuration: 0,
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

    term.onData((data) => {
      if (isDshRef.current) return;
      send({ type: "input", paneId: pane.paneId, data });
    });
    term.onResize(({ cols, rows }) =>
      send({ type: "resize", paneId: pane.paneId, cols, rows }),
    );

    // Roda: não deixa a grade roubar o evento. No buffer normal o xterm
    // rola o scrollback. No alternativo (TUI): se há mouse tracking, o
    // xterm manda CSI; senão PageUp/PageDown ao PTY (setas corrompiam Grok).
    term.attachCustomWheelEventHandler((ev) => {
      ev.stopPropagation();
      if (term.buffer.active.type !== "alternate") return false;
      if (term.modes.mouseTrackingMode !== "none") return false;
      const viewport = area.querySelector(".xterm-viewport") as HTMLElement | null;
      if (viewport && viewport.scrollHeight > viewport.clientHeight + 2) {
        const subindo = ev.deltaY < 0;
        const pode =
          (subindo && viewport.scrollTop > 0) ||
          (!subindo && viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1);
        if (pode) return false;
      }
      ev.preventDefault();
      const passos = Math.min(4, Math.max(1, Math.round(Math.abs(ev.deltaY) / 100)));
      const seq = ev.deltaY < 0 ? "\x1b[5~" : "\x1b[6~";
      for (let i = 0; i < passos; i++) send({ type: "input", paneId: pane.paneId, data: seq });
      return true;
    });

    // Replay HTTP é a fonte da verdade após refresh (o dump do WS pode
    // chegar antes do xterm existir e se perder no remount do React).
    let cancelled = false;
    let offOutput: (() => void) | null = null;
    discardBufferedOutput(pane.paneId);
    void (async () => {
      try {
        const { scrollback } = await fetchPaneReplay(pane.paneId);
        if (cancelled || !terminal.current) return;
        if (scrollback) terminal.current.write(scrollback);
      } catch {
        // Painel pode ter morrido entre o fetch e a resposta.
      }
      if (cancelled || !terminal.current) return;
      const late = takeBufferedOutput(pane.paneId);
      for (const chunk of late) terminal.current.write(chunk);
      offOutput = onOutput(pane.paneId, (data) => terminal.current?.write(data));
      if (area.clientHeight > 0 && area.clientWidth > 0) fit.fit();
    })();

    const observer = new ResizeObserver(() => {
      if (area.clientHeight > 0 && area.clientWidth > 0) fit.fit();
    });
    observer.observe(area);
    if (area.clientHeight > 0 && area.clientWidth > 0) fit.fit();

    return () => {
      cancelled = true;
      observer.disconnect();
      offOutput?.();
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
    if (!visible || minimizado) return;
    const frame = requestAnimationFrame(() => {
      if (host.current && host.current.clientWidth > 0 && host.current.clientHeight > 0) {
        fitter.current?.fit();
        if (selecionado) terminal.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, selecionado, minimizado, layoutEpoch, gridColumn, emFoco]);

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

  const roleId = pane.role || (pane.maestro ? "maestro" : pane.agent);
  const roleName = roleDefinitionFor(roleId).label;

  const nome = label ?? spec?.label ?? pane.label;

  return (
    <section
      className={`pane${selecionado ? " selecionado" : ""}${emFoco ? " em-foco" : ""}${
        menuPapelAberto || detalhesAberto ? " popover-aberto" : ""
      }`}
      hidden={!visible || minimizado}
      data-pane-id={pane.paneId}
      role={emFoco ? "dialog" : undefined}
      aria-modal={emFoco ? true : undefined}
      aria-label={`Terminal de ${nome}`}
      style={{
        ["--pane" as string]: pane.cor,
        ...(gridColumn ? { gridColumn } : {}),
      }}
    >
      <header className="pane-head">
        {/* Linha 1: identidade + ações — nunca compete com os badges. */}
        <div className="pane-head-top">
          <div className="pane-head-id">
            <Mascote semente={pane.agent} cor={pane.cor} estado={pane.status} tamanho={22} />
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
                {nome}
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
          </div>

          <div className="pane-head-actions">
            {emFoco && onVoltarFoco ? (
              <button
                type="button"
                className="pane-focus-back-btn"
                onClick={onVoltarFoco}
                autoFocus
              >
                <Icon name="back" size={14} />
                <span>Voltar</span>
              </button>
            ) : onFocar ? (
              <button
                type="button"
                className="pane-focus-btn"
                title="Focar painel"
                aria-label={`Focar ${nome}`}
                onClick={onFocar}
              >
                <Icon name="expand" size={14} />
              </button>
            ) : null}
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
                  {(pane.accountLabel || pane.accountId) && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--ink-3)" }}>Conta:</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: "var(--ink)", textAlign: "right", wordBreak: "break-word" }}>
                          {pane.accountLabel || pane.accountId}
                          {pane.accountPinned ? " · fixada" : ""}
                        </span>
                        <button
                          type="button"
                          className="btn mini quiet"
                          style={{ padding: "1px 6px", fontSize: "10.5px" }}
                          onClick={async () => {
                            setDetalhesAberto(false);
                            await openLoginTerminal(pane.cli, pane.accountId!, pane.missionId ?? undefined);
                          }}
                          title="Abrir terminal de login para esta conta"
                        >
                          🔑 Login
                        </button>
                      </div>
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

                <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid #30363d", paddingTop: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)" }}>
                    Conexões ({conexoesReais.length})
                  </span>
                  {conexoesReais.map((c) => {
                    const outroId = c.sourcePaneId === pane.paneId ? c.targetPaneId : c.sourcePaneId;
                    const outroPane = todosPaineis.find((p) => p.paneId === outroId);
                    const outroNome = outroPane
                      ? nomeDoPainel(outroPane, todosPaineis, agentes)
                      : outroId;
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
                              {p.maestro ? "⭐ " : ""}{nomeDoPainel(p, todosPaineis, agentes)} ({roleDefinitionFor(p.role || (p.maestro ? "maestro" : p.agent)).label})
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

            {onMinimizar && (
              <button
                type="button"
                className="pane-min-btn"
                title="Minimizar painel (continua rodando)"
                onClick={onMinimizar}
                aria-label="Minimizar painel"
              >
                <Icon name="minimize" size={14} />
              </button>
            )}

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
        </div>

        {/* Linha 2: badges — quebram de linha em janela estreita, nunca somem. */}
        <div className="pane-head-badges">
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
                  👑 Orquestrador (coordenação)
                </button>
                {CATALOG_ROLES.filter((r) => r.id !== "maestro").map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={roleId === r.id ? "active" : ""}
                    onClick={() => handleEscolherPapel(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

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

          <span
            className={`pane-badge badge-backend ${isDsh ? "dsh" : "pty"}`}
            title={`Backend de execução: ${isDsh ? "DSH (SDK headless / subagentes)" : "PTY (Terminal interativo CLI)"}`}
          >
            {isDsh ? "⚡ dsh" : "📟 pty"}
          </span>

          {pane.accountLabel && (
            <span
              className="pane-badge badge-account"
              title={`Conta do pool: ${pane.accountLabel}${pane.accountPinned ? " (fixada)" : ""}`}
            >
              👤 {pane.accountLabel}
            </span>
          )}

          {pane.cli === "bash" ? (
            <span className="pane-badge badge-model clean-bash" title="Terminal Linux soberano sem LLM">
              Shell limpo
            </span>
          ) : pane.model ? (
            <span className="pane-badge badge-model" title={`Modelo: ${pane.model}${pane.effort ? ` · ${pane.effort}` : ""}`}>
              <span className="model-name">{pane.model}</span>
              {pane.effort ? <span className="model-effort"> · {pane.effort}</span> : null}
            </span>
          ) : null}

          <span
            className={`pane-badge badge-status ${pane.status}`}
            title={pane.blockedReason ? `Bloqueado: ${pane.blockedReason}` : statusInfo.description}
          >
            <span className="status-dot-mini" style={{ background: statusInfo.color }} />
            <span className="status-label">{statusInfo.label}</span>
          </span>

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
      </header>

      <div className="pane-term" ref={host} />

      {isDsh && (
        <div className="pane-dsh-prompt-box">
          <div className="pane-dsh-status-row">
            <span className={`dsh-status-tag ${pane.status}`}>
              <span className="dsh-status-dot" />
              <span className="dsh-status-text">
                {pane.status === "waiting-user"
                  ? "Aguardando instrução"
                  : pane.status === "working"
                  ? "Executando resposta..."
                  : pane.status === "completed" || pane.status === "review"
                  ? "Resposta concluída"
                  : pane.status === "starting"
                  ? "Iniciando agente DSH..."
                  : pane.status === "blocked"
                  ? `Bloqueado: ${pane.blockedReason || "Aguardando liberação"}`
                  : pane.status === "failed"
                  ? `Falha: ${pane.blockedReason || "Erro"}`
                  : "Pronto"}
              </span>
            </span>
            <span className="dsh-status-hint">
              {pane.status === "working" ? "Subagentes em execução..." : "Enter envia · Shift+Enter quebra linha"}
            </span>
          </div>

          <div className="pane-dsh-input-row">
            <textarea
              ref={promptInputRef}
              className="pane-dsh-input"
              placeholder={
                pane.status === "working"
                  ? "Agente trabalhando... você pode digitar a próxima instrução para enfileirar"
                  : "Digite uma instrução para o agente DSH..."
              }
              value={promptTexto}
              onChange={(e) => setPromptTexto(e.target.value)}
              onKeyDown={handlePromptKeyDown}
              disabled={promptEnviando || pane.status === "dead" || pane.status === "failed"}
              rows={Math.min(6, Math.max(2, promptTexto.split("\n").length))}
            />
            <button
              type="button"
              className="btn acao pane-dsh-send-btn"
              disabled={!promptTexto.trim() || promptEnviando || pane.status === "dead" || pane.status === "failed"}
              onClick={() => void handleEnviarPrompt()}
              title="Enviar instrução ao agente DSH (Enter)"
            >
              <span>{promptEnviando ? "Enviando..." : "Enviar"}</span>
              <Icon name="arrow" size={14} />
            </button>
          </div>
          {promptErro && <div className="pane-dsh-prompt-error" role="alert">{promptErro}</div>}
        </div>
      )}
    </section>
  );
}
