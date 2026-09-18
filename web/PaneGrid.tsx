import { useState, useEffect, useRef, type CSSProperties } from "react";
import { Pane } from "./Pane.tsx";
import { Icon } from "./Icon.tsx";
import { Mascote } from "./Mascote.tsx";
import { corDoPainel, nomeDoPainel, sementeDoPainel } from "./rotulos.ts";
import type { AgentSpec, Usage } from "./api.ts";
import type { PaneState, Connection, Task } from "./tipos.ts";
import { GRANULAR_STATUS_MAP, type GranularPaneStatus } from "./tipos.ts";
import { chavePaineis, moverAntesOuDepois, useOrdem } from "./ordem.ts";

export type Colunas = "auto" | "1" | "2" | "3";

/**
 * O palco: terminais e nada mais.
 *
 * Todos os painéis ficam montados o tempo todo, de todas as missões. Trocar
 * de missão só muda quem está visível — a sessão xterm, o scrollback e a
 * saída que chega enquanto ninguém olha continuam intactos. Só encerrar de
 * verdade remove um Pane.
 *
 * Minimizar esconde o painel da grade (continua montado e recebendo saída)
 * e deixa um chip na bandeja para restaurar.
 *
 * A missão aberta mostra todos os seus terminais de uma vez, em grade
 * automática. Escolher um agente na lateral não esconde os outros: leva o
 * cursor para o terminal dele.
 */
export function PaneGrid({
  panes,
  missionId,
  agents,
  usos,
  colunas,
  onClose,
  onMudarPapel,
  onDefinirAgente,
  onRenomearLabel,
  onReclassificarPapel,
  onConectar,
  onDesconectar,
  connections = [],
  tasks = [],
  selectedId,
  onSelectPane,
}: {
  panes: PaneState[];
  missionId: string | null;
  agents: Record<string, AgentSpec>;
  usos: Record<string, Usage>;
  colunas: Colunas;
  onClose: (id: string) => void;
  onMudarPapel?: (paneId: string, maestro: boolean) => void;
  onDefinirAgente?: (paneId: string, agent: string) => void;
  onRenomearLabel?: (paneId: string, novoLabel: string) => void;
  onReclassificarPapel?: (paneId: string, novoPapel: string) => void;
  onConectar?: (origemId: string, destinoId: string) => void;
  onDesconectar?: (connectionId: string) => void;
  connections?: Connection[];
  tasks?: Task[];
  selectedId: string | null;
  onSelectPane?: (paneId: string) => void;
}) {
  const [larguraJanela, setLarguraJanela] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1200));
  const [minimizados, setMinimizados] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("cockpit.panes-min");
      if (!raw) return new Set();
      const ids = JSON.parse(raw) as string[];
      return new Set(Array.isArray(ids) ? ids : []);
    } catch {
      return new Set();
    }
  });
  const [paneEmFoco, setPaneEmFoco] = useState<string | null>(null);
  const [arrasto, setArrasto] = useState<{ id: string; sobre?: string; depois?: boolean } | null>(null);
  const arrastoRef = useRef(arrasto);
  arrastoRef.current = arrasto;
  const idsDaMissao = panes.filter((p) => missionId !== null && p.missionId === missionId).map((p) => p.paneId);
  const [ordemPaineis, setOrdemPaineis] = useOrdem(missionId ? chavePaineis(missionId) : null, idsDaMissao);

  useEffect(() => {
    const onResize = () => setLarguraJanela(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    localStorage.setItem("cockpit.panes-min", JSON.stringify([...minimizados]));
  }, [minimizados]);

  // Limpa ids de panes que já não existem.
  useEffect(() => {
    const vivos = new Set(panes.map((p) => p.paneId));
    setMinimizados((prev) => {
      let mudou = false;
      const proximo = new Set<string>();
      for (const id of prev) {
        if (vivos.has(id)) proximo.add(id);
        else mudou = true;
      }
      return mudou ? proximo : prev;
    });
  }, [panes]);

  useEffect(() => {
    if (!paneEmFoco) return;
    const existeNaMissao = panes.some((pane) => pane.paneId === paneEmFoco && pane.missionId === missionId);
    if (!existeNaMissao) setPaneEmFoco(null);
  }, [missionId, paneEmFoco, panes]);

  useEffect(() => {
    if (!paneEmFoco) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPaneEmFoco(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [paneEmFoco]);

  const daMissao = ordemPaineis
    .map((id) => panes.find((p) => p.paneId === id))
    .filter((p): p is PaneState => Boolean(p));
  const panesNaOrdem = [...daMissao, ...panes.filter((p) => p.missionId !== missionId)];
  const ativos = daMissao.filter((p) => !minimizados.has(p.paneId));
  const naBandeja = daMissao.filter((p) => minimizados.has(p.paneId));
  // Nunca peça mais colunas do que painéis visíveis: senão sobra buraco preto
  // na grade (ex.: colunas=3 com só Maestro+Grok → faixa vazia à direita).
  const desejado = colunas === "auto"
    ? (larguraJanela < 900 || ativos.length <= 1 ? 1 : ativos.length <= 4 ? 2 : 3)
    : Number(colunas);
  const n = Math.max(1, Math.min(desejado, Math.max(ativos.length, 1)));
  const temMaestroNaMissao = daMissao.some((p) => p.maestro);
  const ativosIds = ativos.map((p) => p.paneId).join(",");

  const minimizar = (id: string) => setMinimizados((prev) => new Set(prev).add(id));
  const focar = (id: string) => {
    if (!daMissao.some((pane) => pane.paneId === id)) return;
    setMinimizados((prev) => {
      if (!prev.has(id)) return prev;
      const proximo = new Set(prev);
      proximo.delete(id);
      return proximo;
    });
    setPaneEmFoco(id);
    onSelectPane?.(id);
  };
  const voltarParaGrade = () => setPaneEmFoco(null);
  const restaurar = (id: string) => {
    setMinimizados((prev) => {
      const proximo = new Set(prev);
      proximo.delete(id);
      return proximo;
    });
    onSelectPane?.(id);
  };

  return (
    <div className="panes-stack">
      <div
        className={`panes${paneEmFoco ? " tem-foco" : ""}`}
        data-colunas={n}
        data-ativos={ativos.length}
        hidden={!ativos.length}
        style={{ "--columns": `repeat(${n}, minmax(0, 1fr))` } as CSSProperties}
      >
        {panesNaOrdem.map((p) => {
          const naGrade = p.missionId === missionId && !minimizados.has(p.paneId);
          const indiceAtivo = naGrade ? ativos.findIndex((a) => a.paneId === p.paneId) : -1;
          // Última fileira incompleta: só o último painel estica e tapa o buraco.
          const resto = ativos.length % n;
          const ehUltimo = naGrade && indiceAtivo === ativos.length - 1;
          const span = ehUltimo && resto !== 0 ? n - resto + 1 : 1;
          return (
            <Pane
              key={p.paneId}
              pane={p}
              spec={agents[p.agent]}
              usage={usos[p.paneId]}
              visible={p.missionId === missionId}
              minimizado={minimizados.has(p.paneId)}
              selecionado={p.paneId === selectedId}
              onSelect={() => onSelectPane?.(p.paneId)}
              temMaestroNaMissao={temMaestroNaMissao}
              connections={connections}
              tasks={tasks}
              onMudarPapel={onMudarPapel}
              onDefinirAgente={onDefinirAgente}
              onRenomearLabel={onRenomearLabel}
              onReclassificarPapel={onReclassificarPapel}
              agentes={agents}
              todosPaineis={daMissao}
              onConectar={onConectar}
              onDesconectar={onDesconectar}
              label={nomeDoPainel(p, panes, agents)}
              onClose={() => {
                if (paneEmFoco === p.paneId) voltarParaGrade();
                onClose(p.paneId);
              }}
              onMinimizar={() => {
                if (paneEmFoco === p.paneId) voltarParaGrade();
                minimizar(p.paneId);
              }}
              emFoco={paneEmFoco === p.paneId}
              onFocar={() => focar(p.paneId)}
              onVoltarFoco={voltarParaGrade}
              arrastando={arrasto?.id === p.paneId}
              alvoSoltar={arrasto?.sobre === p.paneId ? (arrasto.depois ? "depois" : "antes") : null}
              onArrastoInicio={(id) => {
                const proximo = { id };
                arrastoRef.current = proximo;
                setArrasto(proximo);
              }}
              onArrastoSobre={(id, depois) => setArrasto((atual) => {
                const base = atual ?? arrastoRef.current;
                return base ? { ...base, sobre: id, depois } : atual;
              })}
              onArrastoSoltar={(destino) => {
                const atual = arrastoRef.current;
                if (!atual) return;
                setOrdemPaineis(moverAntesOuDepois(ordemPaineis, atual.id, destino, Boolean(atual.depois)));
                setArrasto(null);
              }}
              onArrastoFim={() => setArrasto(null)}
              gridColumn={span > 1 ? `span ${span}` : undefined}
              layoutEpoch={`${n}:${ativosIds}`}
            />
          );
        })}
      </div>

      {paneEmFoco && (
        <button
          type="button"
          className="pane-focus-backdrop"
          tabIndex={-1}
          aria-hidden="true"
          aria-label="Voltar para a grade de painéis"
          onClick={voltarParaGrade}
        />
      )}

      {naBandeja.length > 0 && (
        <div className="panes-tray" role="toolbar" aria-label="Painéis minimizados">
          <span className="panes-tray-label">Minimizados</span>
          {naBandeja.map((p) => {
            const nome = nomeDoPainel(p, panes, agents);
            const info =
              GRANULAR_STATUS_MAP[p.status as GranularPaneStatus] ||
              GRANULAR_STATUS_MAP[p.status === "dead" ? "dead" : "working"];
            return (
              <button
                key={p.paneId}
                type="button"
                className={`pane-chip${selectedId === p.paneId ? " selecionado" : ""}`}
                style={{ ["--pane" as string]: corDoPainel(p) }}
                title={`${nome} · ${info.label} — clique para restaurar`}
                aria-label={`Restaurar ${nome}`}
                onClick={() => restaurar(p.paneId)}
              >
                <Mascote semente={sementeDoPainel(p)} cor={corDoPainel(p)} estado={p.status} tamanho={18} />
                <span className="pane-chip-nome">{nome}</span>
                <span className="pane-chip-dot" style={{ background: info.color }} />
                <Icon name="expand" size={12} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
