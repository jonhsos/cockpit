import { useEffect, useState, useRef } from "react";
import { fetchCotas, fetchAccountPools, type Cota, type AccountPoolView } from "./api.ts";

/**
 * Redline: quanto resta de cada assinatura e limite de taxa (Sessão / Semanal).
 */

const ROTULO: Record<string, string> = { codex: "GPT · Codex", claude: "Claude", agy: "Gemini · AGY", grok: "Grok · xAI" };

export function formatarResetTempo(voltaEm: number | null): string {
  if (!voltaEm) return "";
  const diffMs = voltaEm - Date.now();
  if (diffMs <= 0) return "Reseta em instantes";
  const totalMinutos = Math.floor(diffMs / 60_000);
  const dias = Math.floor(totalMinutos / 1440);
  const horas = Math.floor((totalMinutos % 1440) / 60);
  const minutos = totalMinutos % 60;

  if (dias > 0) {
    return `Reseta em ${dias}d ${horas}h ${minutos}m`;
  }
  if (horas > 0) {
    return `Reseta em ${horas}h ${minutos}m`;
  }
  return `Reseta em ${minutos}m`;
}

export function QuotaProgressCard({
  cota,
  pool,
  showPoolList = true,
}: {
  cota?: Cota;
  pool?: AccountPoolView;
  showPoolList?: boolean;
}) {
  const cli = cota?.cli || pool?.cli || "desconhecido";
  const labelNome = ROTULO[cli] ?? cli;
  const temJanelas = cota && cota.janelas && cota.janelas.length > 0;

  return (
    <div className={`quota-card ${cota?.estado ?? "livre"}`}>
      <div className="quota-card-header">
        <span className="quota-card-provider">
          <i className="quota-card-dot" />
          {labelNome}
        </span>
        {cota?.plano && <span className="quota-card-plan">{cota.plano}</span>}
        {!cota?.plano && pool && <span className="quota-card-plan">{pool.total} contas</span>}
      </div>

      {temJanelas && (
        <div className="quota-card-windows">
          {cota!.janelas.map((j) => {
            const restantePct = Math.max(0, Math.min(100, 100 - j.usadoPct));
            const rotuloNome =
              j.rotulo.toLowerCase().includes("5h") || j.rotulo.toLowerCase().includes("sess")
                ? "Session"
                : j.rotulo.toLowerCase().includes("7 dia") || j.rotulo.toLowerCase().includes("semana")
                ? "Weekly"
                : j.rotulo;

            const corClasse = restantePct <= 10 ? "critico" : restantePct <= 35 ? "alerta" : "ok";

            return (
              <div key={j.rotulo} className="quota-window-item">
                <div className="quota-window-top">
                  <span className="quota-window-name">{rotuloNome}</span>
                  <span className={`quota-window-left ${corClasse}`}>{restantePct}% left</span>
                </div>

                <div className="quota-window-bar-track">
                  <div
                    className={`quota-window-bar-fill ${corClasse}`}
                    style={{ width: `${restantePct}%` }}
                  />
                </div>

                {j.voltaEm ? (
                  <div className="quota-window-reset">
                    <span className="quota-reset-clock">⏱️</span>
                    <span>{formatarResetTempo(j.voltaEm)}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Account Pool Details (only shown when showPoolList is true) */}
      {showPoolList && pool && pool.contas && pool.contas.length > 0 && (
        <div className="quota-card-pool" style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: temJanelas ? "1px solid #21262d" : "none", paddingTop: temJanelas ? 8 : 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-2)" }}>
            <span>Pool de contas:</span>
            <span style={{ fontWeight: 600, color: "var(--ink)" }}>
              {pool.ativas}/{pool.total} ativas {pool.emCooldown > 0 ? `· ${pool.emCooldown} em cooldown` : ""}
            </span>
          </div>

          <div className="quota-window-bar-track">
            <div
              className="quota-window-bar-fill ok"
              style={{
                width: `${pool.total > 0 ? Math.round(((pool.total - pool.emCooldown) / pool.total) * 100) : 100}%`,
                background: pool.emCooldown > 0 ? "#e3b341" : "#3fb950",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
            {pool.contas.map((acc) => (
              <div
                key={acc.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 10.5,
                  padding: "2px 4px",
                  borderRadius: 4,
                  background: acc.status === "ocupada" ? "rgba(63, 185, 80, 0.1)" : "rgba(255, 255, 255, 0.02)",
                  color: acc.status === "ocupada" ? "#7ee787" : acc.status === "cooldown" ? "#f85149" : "var(--ink-3)",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }} title={acc.label}>
                  {acc.label}
                </span>
                <span style={{ fontSize: 10, fontWeight: 600 }}>
                  {acc.status === "ocupada" ? (acc.painelLabel || "ativa") : acc.status === "cooldown" ? "cooldown" : "livre"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!temJanelas && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--ink-2)", borderTop: "1px solid #21262d", paddingTop: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "var(--ink-3)" }}>Disponibilidade:</span>
            <span style={{ color: cota?.estado === "bloqueado" ? "#f85149" : "#3fb950", fontWeight: 600 }}>
              {cota?.estado === "bloqueado" ? "● Limite atingido" : "● 100% Livre / Operacional"}
            </span>
          </div>
          <span style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.35 }}>
            {cli === "agy"
              ? "Google Gemini não impõe janela horária fixa (opera por cotas contínuas de requisição / dia). O Cockpit monitora ativamente contra 429."
              : cota?.detalhe ?? "Conta operacional sem limite de janela horária fixa."}
          </span>
        </div>
      )}
    </div>
  );
}

export function Redline({ compact = false }: { compact?: boolean }) {
  const [cotas, setCotas] = useState<Cota[]>([]);
  const [pools, setPools] = useState<Record<string, AccountPoolView>>({});
  const [popoverAberto, setPopoverAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const puxar = () => {
      void fetchCotas().then((d) => setCotas(d.cotas ?? []), () => {});
      void fetchAccountPools().then((d) => setPools(d.pools ?? {}), () => {});
    };
    puxar();
    const t = setInterval(puxar, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!popoverAberto) return;
    const handleClickFora = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPopoverAberto(false);
      }
    };
    window.addEventListener("pointerdown", handleClickFora);
    return () => window.removeEventListener("pointerdown", handleClickFora);
  }, [popoverAberto]);

  // Merge list of unique clis from cotas + pools
  const clisUnicos = Array.from(new Set([...cotas.map((c) => c.cli), ...Object.keys(pools)]));

  if (clisUnicos.length === 0) return null;

  if (!compact) {
    return (
      <div className="redline-cards-container" style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        {clisUnicos.map((cli) => {
          const c = cotas.find((item) => item.cli === cli);
          const p = pools[cli];
          return <QuotaProgressCard key={cli} cota={c} pool={p} />;
        })}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="redline-wrapper" style={{ position: "relative" }}>
      <button
        type="button"
        className="redline"
        role="status"
        aria-label="Cota das assinaturas"
        title="Clique para ver limites de Sessão, Semanal e Pools"
        onClick={() => setPopoverAberto((v) => !v)}
      >
        {clisUnicos.map((cli) => {
          const c = cotas.find((item) => item.cli === cli);
          const p = pools[cli];
          const pior = c?.janelas && c.janelas.length > 0
            ? c.janelas.reduce((a, b) => (a.usadoPct >= b.usadoPct ? a : b))
            : null;
          const restante = pior ? Math.max(0, 100 - pior.usadoPct) : null;

          const labelCli = cli === "codex" ? "GPT" : cli === "agy" ? "AGY" : ROTULO[cli] ?? cli;

          const estadoClasse = c?.estado ?? (p && p.emCooldown > 0 ? "apertado" : "livre");

          return (
            <span key={cli} className={`cota ${estadoClasse}`}>
              <i />
              {labelCli}
              <b>
                {restante !== null
                  ? `${restante}%`
                  : p
                  ? `${p.ativas}/${p.total}`
                  : "livre"}
              </b>
              {c?.estado === "bloqueado" && pior?.voltaEm && (
                <em>{formatarResetTempo(pior.voltaEm).replace("Reseta em ", "")}</em>
              )}
            </span>
          );
        })}
      </button>

      {popoverAberto && (
        <div className="quota-popover" role="dialog" aria-label="Limites de Cota de IA">
          <div className="quota-popover-header">
            <span>Limites de Cota & Pools</span>
            <button
              type="button"
              className="quota-popover-close"
              onClick={(e) => {
                e.stopPropagation();
                setPopoverAberto(false);
              }}
            >
              ✕
            </button>
          </div>
          {clisUnicos.map((cli) => {
            const c = cotas.find((item) => item.cli === cli);
            const p = pools[cli];
            return <QuotaProgressCard key={cli} cota={c} pool={p} />;
          })}
        </div>
      )}
    </div>
  );
}

