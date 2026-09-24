import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { discardBufferedOutput, onOutput, send, takeBufferedOutput } from "./socket.ts";
import {
  fetchPaneReplay,
  postPanePrompt,
  openLoginTerminal,
  fetchCotas,
  fetchAccountPools,
  type AgentSpec,
  type Usage,
  type Cota,
  type AccountPoolView,
} from "./api.ts";
import { QuotaProgressCard } from "./Redline.tsx";
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
import {
  corDoPainel,
  nomeDoPainel,
  sementeDoPainel,
  formatarTempoSessao,
  formatarTempoCompleto,
  formatarHoraInicio,
} from "./rotulos.ts";
import { roleDefinitionFor } from "./role-contract.ts";
import { atalhoDeColar, atalhoDeCopiar, colarTexto, copiarTexto } from "./clipboard.ts";

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
  arrastando = false,
  alvoSoltar = null,
  onArrastoInicio,
  onArrastoSobre,
  onArrastoSoltar,
  onArrastoFim,
  onSelect,
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
  arrastando?: boolean;
  alvoSoltar?: "antes" | "depois" | null;
  onArrastoInicio?: (paneId: string) => void;
  onArrastoSobre?: (paneId: string, depois: boolean) => void;
  onArrastoSoltar?: (paneId: string) => void;
  onArrastoFim?: () => void;
  onSelect?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitter = useRef<FitAddon | null>(null);
  const [telaCheia, setTelaCheia] = useState(false);
  const [menuClip, setMenuClip] = useState<{ x: number; y: number; temSelecao: boolean } | null>(null);

  // Inline rename state
  const [renomeando, setRenomeando] = useState(false);
  const [tempLabel, setTempLabel] = useState(label ?? spec?.label ?? pane.label);

  // Role reclassification popover state
  const [menuPapelAberto, setMenuPapelAberto] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [detalhesAberto, setDetalhesAberto] = useState(false);
  const [trocandoConta, setTrocandoConta] = useState(false);
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
  const colarNoXtermRef = useRef<(texto: string) => void>(() => {});
  colarNoXtermRef.current = (texto: string) => {
    if (!texto) return;
    if (isDshRef.current) {
      setPromptTexto((atual) => atual + texto);
      promptInputRef.current?.focus();
      return;
    }
    const term = terminal.current;
    if (!term) return;
    term.paste(texto);
    term.focus();
  };

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
    if (!menuPapelAberto && !detalhesAberto && !menuClip) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (menuPapelAberto && !target?.closest(".pane-role-container")) {
        setMenuPapelAberto(false);
      }
      if (menuClip && !target?.closest(".pane-clip-menu")) {
        setMenuClip(null);
      }
      if (detalhesAberto && detailsRef.current && !detailsRef.current.contains(target)) {
        detailsRef.current.removeAttribute("open");
        setDetalhesAberto(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuPapelAberto(false);
        setMenuClip(null);
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
  }, [menuPapelAberto, detalhesAberto, menuClip]);

  useEffect(() => {
    setTempLabel(label ?? spec?.label ?? pane.label);
  }, [label, spec?.label, pane.label]);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      rightClickSelectsWord: false,
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

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    term.onResize(({ cols, rows }) => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        send({ type: "resize", paneId: pane.paneId, cols, rows });
      }, 120);
    });

    const safeFit = () => {
      if (cancelled || !terminal.current || !fitter.current || !host.current) return;
      if (host.current.clientHeight <= 0 || host.current.clientWidth <= 0) return;
      try {
        const dims = fitter.current.proposeDimensions();
        if (!dims || !dims.cols || !dims.rows || isNaN(dims.cols) || isNaN(dims.rows)) return;
        if (dims.cols === terminal.current.cols && dims.rows === terminal.current.rows) return;
        fitter.current.fit();
      } catch {
        // Ignora medições transitórias
      }
    };

    // Teclado: atalhos de copiar/colar e navegação por scroll (Shift+PageUp/Down/Home/End)
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== "keydown") return true;
      if (atalhoDeCopiar(ev)) {
        if (!term.hasSelection()) return true;
        void copiarTexto(term.getSelection());
        return false;
      }
      if (atalhoDeColar(ev)) {
        // Deixa o evento nativo `paste` (clipboardData) seguir — é o único
        // caminho confiável quando o navegador nega clipboard.readText.
        return true;
      }
      if (ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        if (ev.key === "PageUp") {
          term.scrollPages(-1);
          return false;
        }
        if (ev.key === "PageDown") {
          term.scrollPages(1);
          return false;
        }
        if (ev.key === "Home") {
          term.scrollToTop();
          return false;
        }
        if (ev.key === "End") {
          term.scrollToBottom();
          return false;
        }
      }
      return true;
    });

    const aoCopiar = (ev: ClipboardEvent) => {
      if (!term.hasSelection()) return;
      ev.preventDefault();
      ev.clipboardData?.setData("text/plain", term.getSelection());
    };
    const aoColar = (ev: ClipboardEvent) => {
      const texto = ev.clipboardData?.getData("text/plain");
      if (!texto) return;
      ev.preventDefault();
      ev.stopPropagation();
      colarNoXtermRef.current(texto);
    };
    const aoMenu = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      const temSelecao = term.hasSelection();
      // readText no mesmo gesto do clique direito; se o browser negar,
      // abre Copiar/Colar em vez de fingir que colou.
      const tentativa = navigator.clipboard.readText();
      void tentativa.then((texto) => {
        if (texto) {
          colarNoXtermRef.current(texto);
          setMenuClip(null);
          return;
        }
        setMenuClip({ x: ev.clientX, y: ev.clientY, temSelecao });
      }).catch(() => {
        setMenuClip({ x: ev.clientX, y: ev.clientY, temSelecao });
      });
    };
    area.addEventListener("copy", aoCopiar);
    area.addEventListener("paste", aoColar);
    area.addEventListener("contextmenu", aoMenu, true);

    // Rolagem por mouse/trackpad:
    // No buffer normal (onde rodam Claude, Codex, Bash, etc.): sempre rola o scrollback
    // do terminal diretamente, evitando que mouse tracking do CLI bloqueie o scroll.
    // No buffer alternativo (TUI como vim, htop, less, grok): se houver mouse tracking,
    // envia ao PTY, a menos que Shift esteja pressionado; se não houver mouse tracking, envia PageUp/Down.
    term.attachCustomWheelEventHandler((ev) => {
      ev.stopPropagation();

      const passos = Math.max(1, Math.min(8, Math.round(Math.abs(ev.deltaY) / 30) || 1));

      if (term.buffer.active.type === "normal") {
        term.scrollLines(ev.deltaY < 0 ? -passos : passos);
        ev.preventDefault();
        return true;
      }

      // Buffer alternativo (TUI):
      if (ev.shiftKey) {
        term.scrollLines(ev.deltaY < 0 ? -passos : passos);
        ev.preventDefault();
        return true;
      }

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
      const passosTui = Math.min(4, Math.max(1, Math.round(Math.abs(ev.deltaY) / 100)));
      const seq = ev.deltaY < 0 ? "\x1b[5~" : "\x1b[6~";
      for (let i = 0; i < passosTui; i++) send({ type: "input", paneId: pane.paneId, data: seq });
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
      if (area.clientHeight > 0 && area.clientWidth > 0) safeFit();
    })();

    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        safeFit();
      });
    });
    observer.observe(area);
    if (area.clientHeight > 0 && area.clientWidth > 0) safeFit();

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (resizeTimer) clearTimeout(resizeTimer);
      observer.disconnect();
      offOutput?.();
      area.removeEventListener("copy", aoCopiar);
      area.removeEventListener("paste", aoColar);
      area.removeEventListener("contextmenu", aoMenu, true);
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
    const aoMudar = () => {
      const ativo = document.fullscreenElement === caixa.current;
      setTelaCheia(ativo);
      requestAnimationFrame(() => fitter.current?.fit());
    };
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, []);

  useEffect(() => {
    if (emFoco) return;
    if (document.fullscreenElement === caixa.current) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [emFoco]);

  const alternarTelaCheia = () => {
    const el = caixa.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    void el.requestFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    if (!visible || minimizado) return;
    const frame = requestAnimationFrame(() => {
      if (host.current && host.current.clientWidth > 0 && host.current.clientHeight > 0) {
        if (!terminal.current || !fitter.current) return;
        try {
          const dims = fitter.current.proposeDimensions();
          if (dims && dims.cols && dims.rows && (dims.cols !== terminal.current.cols || dims.rows !== terminal.current.rows)) {
            fitter.current.fit();
          }
        } catch {
          // Ignora medições transitórias
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, minimizado, layoutEpoch, gridColumn, emFoco]);

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

  // Session live uptime ticker (updates live every second)
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [cota, setCota] = useState<Cota | null>(null);
  const [pool, setPool] = useState<AccountPoolView | null>(null);
  useEffect(() => {
    if (!detalhesAberto) return;
    void fetchCotas().then((res) => {
      const c = res.cotas?.find((item) => item.cli === pane.cli);
      if (c) setCota(c);
    }).catch(() => {});
    void fetchAccountPools().then((res) => {
      const p = res.pools?.[pane.cli];
      if (p) setPool(p);
    }).catch(() => {});
  }, [detalhesAberto, pane.cli]);

  const inicio = pane.iniciadoEm || agora;
  const tempoDecorrido = Math.max(0, agora - inicio);
  const tempoSessaoCurto = formatarTempoSessao(tempoDecorrido);
  const tempoSessaoCompleto = formatarTempoCompleto(tempoDecorrido);
  const horaInicio = formatarHoraInicio(inicio);

  const roleId = pane.role || (pane.maestro ? "maestro" : pane.agent);
  const roleName = roleDefinitionFor(roleId).label;

  const nome = nomeDoPainel(pane, todosPaineis.length ? todosPaineis : [pane], agentes);

  return (
    <section
      ref={caixa}
      className={`pane${selecionado ? " selecionado" : ""}${emFoco ? " em-foco" : ""}${telaCheia ? " tela-cheia" : ""}${
        menuPapelAberto || detalhesAberto || menuClip ? " popover-aberto" : ""
      }${arrastando ? " arrastando" : ""}${alvoSoltar === "antes" ? " alvo-antes" : ""}${alvoSoltar === "depois" ? " alvo-depois" : ""}`}
      onPointerDown={() => onSelect?.()}
      onDragOver={(event) => {
        if (!onArrastoSobre || emFoco) return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        const dx = Math.abs(event.clientX - (box.left + box.width / 2));
        const dy = Math.abs(event.clientY - (box.top + box.height / 2));
        const apos = dx > dy ? event.clientX > box.left + box.width / 2 : event.clientY > box.top + box.height / 2;
        onArrastoSobre(pane.paneId, apos);
      }}
      onDrop={(event) => {
        if (!onArrastoSoltar || emFoco) return;
        event.preventDefault();
        onArrastoSoltar(pane.paneId);
      }}
      onPaste={(event) => {
        const texto = event.clipboardData?.getData("text/plain");
        if (!texto) return;
        const alvo = event.target as HTMLElement | null;
        if (alvo && (alvo.tagName === "TEXTAREA" || alvo.tagName === "INPUT") && alvo.closest(".pane-dsh-prompt")) {
          return;
        }
        event.preventDefault();
        colarNoXtermRef.current(texto);
      }}
      hidden={!visible || minimizado}
      data-pane-id={pane.paneId}
      role={emFoco ? "dialog" : undefined}
      aria-modal={emFoco ? true : undefined}
      aria-label={`Terminal de ${nome}`}
      style={{
        ["--pane" as string]: corDoPainel(pane),
        ...(gridColumn ? { gridColumn } : {}),
      }}
    >
      <header className="pane-head">
        {/* Linha 1: identidade + ações — nunca compete com os badges. */}
        <div className="pane-head-top">
          <div className="pane-head-id">
            {onArrastoInicio && !emFoco ? (
              <span
                className="arrasto-pega"
                draggable
                title="Arrastar para reordenar"
                aria-label={`Arrastar ${nome}`}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", `painel:${pane.paneId}`);
                  event.dataTransfer.effectAllowed = "move";
                  onArrastoInicio(pane.paneId);
                }}
                onDragEnd={() => onArrastoFim?.()}
              >
                <Icon name="grip" size={12} />
              </span>
            ) : null}
            <Mascote semente={sementeDoPainel(pane)} cor={corDoPainel(pane)} estado={pane.status} tamanho={20} />
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
              <>
                <button
                  type="button"
                  className="pane-focus-btn"
                  title={telaCheia ? "Sair da tela cheia" : "Tela cheia"}
                  aria-label={telaCheia ? "Sair da tela cheia" : "Abrir em tela cheia"}
                  aria-pressed={telaCheia}
                  onClick={alternarTelaCheia}
                >
                  <Icon name={telaCheia ? "compress" : "expand"} size={14} />
                </button>
                <button
                  type="button"
                  className="pane-focus-back-btn"
                  onClick={() => {
                    if (document.fullscreenElement === caixa.current) {
                      void document.exitFullscreen().catch(() => {});
                    }
                    onVoltarFoco();
                  }}
                >
                  <Icon name="back" size={14} />
                  <span>Voltar</span>
                </button>
              </>
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
                    title={`${compacto(usage.in + usage.cacheWrite + usage.cacheRead)} entrada · ${compacto(usage.out)} saída · ${usage.turnos} turnos em ${usage.model ?? "—"} · Sessão ativa há ${tempoSessaoCompleto}`}
                  >
                    ${usage.custo.toFixed(2)} · ⏱️ {tempoSessaoCurto}
                  </span>
                ) : (
                  <span className="meter" title={`Sessão iniciada às ${horaInicio} (${tempoSessaoCompleto})`}>
                    ⏱️ {tempoSessaoCurto}
                  </span>
                )}
                <span className="dica">
                  PID / Daemon PTY ativo · {pane.cli}
                </span>

                <div className="pane-meta-summary" style={{ display: "flex", flexDirection: "column", gap: 5, borderTop: "1px solid #30363d", paddingTop: 8, fontSize: 11.5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ color: "var(--ink-3)" }}>Duração da sessão:</span>
                    <span style={{ fontWeight: 600, color: "var(--ink)" }} title={`Iniciado em ${new Date(inicio).toLocaleString()}`}>
                      ⏱️ {tempoSessaoCompleto} <span style={{ color: "var(--ink-3)", fontWeight: 400, fontSize: 11 }}>(iniciado às {horaInicio})</span>
                    </span>
                  </div>
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
                  {(pane.accountLabel || pane.accountId || (pool && pool.contas.length > 0)) && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span style={{ color: "var(--ink-3)" }}>Conta:</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ color: "var(--ink)", textAlign: "right", wordBreak: "break-word", fontWeight: 600 }}>
                            {pane.accountLabel || pane.accountId || "Automático"}
                            {pane.accountPinned ? " · fixada" : ""}
                          </span>
                          {pane.accountId && (
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
                          )}
                        </div>
                      </div>

                      {pool && pool.contas.length > 1 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                          <select
                            className="campo"
                            style={{ fontSize: 11, padding: "2px 6px", flex: 1 }}
                            defaultValue=""
                            disabled={trocandoConta}
                            onChange={async (e) => {
                              const targetAccId = e.target.value;
                              if (!targetAccId || !pane.missionId) return;
                              setTrocandoConta(true);
                              try {
                                if (pane.maestro) {
                                  await fetch(`/api/missions/${pane.missionId}/maestro`, {
                                    method: "POST",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({
                                      cli: pane.cli,
                                      preferredAccountId: targetAccId,
                                      accountPinned: true,
                                    }),
                                  });
                                } else {
                                  send({
                                    type: "spawn",
                                    agent: pane.agent,
                                    missionId: pane.missionId,
                                    cli: pane.cli,
                                    model: pane.model,
                                    effort: pane.effort,
                                    role: pane.role,
                                    label: pane.label,
                                    preferredAccountId: targetAccId,
                                    accountPinned: true,
                                    backend: pane.backend,
                                  });
                                  send({ type: "kill", paneId: pane.paneId });
                                }
                                setDetalhesAberto(false);
                              } catch (err) {
                                alert(`Falha ao trocar conta: ${String(err)}`);
                              } finally {
                                setTrocandoConta(false);
                              }
                            }}
                          >
                            <option value="" disabled>Trocar para outra conta do pool...</option>
                            {pool.contas.map((acc) => (
                              <option key={acc.id} value={acc.id} disabled={acc.id === pane.accountId}>
                                {acc.label || acc.id} {acc.id === pane.accountId ? "(atual)" : acc.status === "ocupada" ? `(ocupada · ${acc.painelLabel || "painel"})` : acc.status === "cooldown" ? "(cooldown)" : "(livre)"}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
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

                {(cota || pool) && (
                  <div style={{ borderTop: "1px solid #30363d", paddingTop: 8 }}>
                    <QuotaProgressCard cota={cota ?? undefined} pool={pool ?? undefined} showPoolList={false} />
                  </div>
                )}

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

        {/* Linha 2: badges — quebram de linha em janela estreita, nunca somem nem cortam. */}
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
              {pane.maestro ? <Icon name="team" size={11} /> : null}
              <span className="role-label-text">{roleName}</span>
              <Icon name="chevron" size={9} />
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
            {isDsh ? "dsh" : "pty"}
          </span>

          {pane.accountLabel && (
            <span
              className="pane-badge badge-account"
              title={`Conta do pool: ${pane.accountLabel}${pane.accountPinned ? " (fixada)" : ""}`}
            >
              <span className="account-icon" aria-hidden="true">👤</span>
              <span className="account-name">{pane.accountLabel}</span>
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

          <span
            className="pane-badge badge-session-time"
            title={`Sessão iniciada às ${horaInicio} (${tempoSessaoCompleto} de atividade)`}
          >
            <span className="session-time-icon" aria-hidden="true">⏱️</span>
            <span className="session-time-val">{tempoSessaoCurto}</span>
          </span>

          {taskAtiva && (
            <span
              className="pane-badge badge-active-task"
              title={`Tarefa ativa: #${taskAtiva.id} — ${taskAtiva.título}`}
            >
              <span className="task-icon" aria-hidden="true">📋</span>
              <span className="task-id">#{taskAtiva.id.slice(-4)}</span>
              <span className="task-title">: {taskAtiva.título}</span>
            </span>
          )}

          {conexoesReais.length > 0 && (
            <span
              className="pane-conn-line real"
              title={`Conexão persistida ativa (${conexoesReais.length} ligação${conexoesReais.length > 1 ? "ões" : ""})`}
            >
              <span className="pane-conn-dot" />
              <span className="pane-conn-wire" aria-hidden="true" />
              <span className="conn-label">🔗 {conexoesReais.length}</span>
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

      {menuClip && (
        <div
          className="pane-clip-menu"
          role="menu"
          style={{ top: menuClip.y, left: menuClip.x }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!menuClip.temSelecao}
            onClick={() => {
              const texto = terminal.current?.getSelection() ?? "";
              if (texto) void copiarTexto(texto);
              setMenuClip(null);
            }}
          >
            Copiar
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void colarTexto().then((texto) => {
                if (texto) colarNoXtermRef.current(texto);
                setMenuClip(null);
              });
            }}
          >
            Colar
          </button>
        </div>
      )}
    </section>
  );
}
