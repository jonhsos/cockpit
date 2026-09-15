import { useEffect, useState } from "react";
import type { AgentSpec, Provider } from "./api.ts";
import { onMessage } from "./socket.ts";
import { PoliticaIA } from "./PoliticaIA.tsx";

type Status = { agent: AgentSpec; auto: boolean; providers: Provider[]; codexQuota?: { remaining: number; checkedAt: number; resetsAt: number | null } | null; quotaError?: string | null; limits: Record<string, { state: "warning" | "blocked"; detail: string; remaining?: number }> };
const labels: Record<string, string> = { codex: "GPT · Codex", claude: "Claude", agy: "Gemini · AGY", grok: "Grok · xAI", gemini: "Gemini CLI" };
async function request(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw Error("O servidor do cockpit está desatualizado. Reinicie o servidor e recarregue a janela.");
  }
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? "Falha na solicitação.");
  return result;
}
export function Maestro({ missionId, onClose, onChanged }: { missionId: string | null; onClose: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [cli, setCli] = useState("codex");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("high");
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let alive = true;
    void request("/api/maestro").then((s: Status) => {
      if (!alive) return;
      const provModel = s.providers.find((p) => p.id === s.agent.cli)?.modelos[0] ?? "";
      setStatus(s); setCli(s.agent.cli); setModel(s.agent.model || provModel); setEffort(s.agent.effort ?? "high"); setAuto(s.auto);
    }).catch(e => { if (alive) setError(String(e)); });
    const off = onMessage(msg => { if (msg.type === "maestro" || msg.type === "pool:updated" || msg.type === "pool:rotated") void request("/api/maestro").then(s => { if (alive) setStatus(s); }).catch(e => { if (alive) setError(String(e)); }); });
    return () => { alive = false; off(); };
  }, []);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const save = async () => { setStatus(await request("/api/maestro", { cli, model, effort, auto })); onChanged(); };
  const currentProvider = status?.providers.find((p) => p.id === cli);
  return <div className="config">
    <header className="wizard-topo"><h2>Maestro e continuidade</h2><button className="btn quiet" onClick={onClose} aria-label="Fechar maestro">✕</button></header>
    <div className="wizard-corpo">
      <PoliticaIA onChanged={onChanged} />
      <p className="ressalva">Os controles abaixo definem o maestro do modo padrão. Uma IA fixa na distribuição acima tem prioridade. Ao trocar, o novo maestro recebe objetivo, memória, resumo de progresso e acesso ao histórico local, no mesmo projeto.</p>
      {error && <p className="aviso" role="alert">{error}</p>}
      {notice && <p className="ressalva" role="status">{notice}</p>}
      {!status ? (!error && <p>Carregando provedores…</p>) : <>
        <div className="cartas">{status.providers.map(p => {
          const quotaText = !p.disponivel
            ? "CLI não encontrado"
            : status.limits[p.id]?.state === "blocked"
            ? "Limite atingido"
            : status.limits[p.id]?.state === "warning"
            ? "Cota próxima do limite"
            : p.pool
            ? `${p.pool.total} contas (${p.pool.total - p.pool.emCooldown}/${p.pool.total} ativas)`
            : "Cota não informada";
          return (
            <button key={p.id} className={`carta${cli === p.id ? " on" : ""}`} disabled={busy || !p.disponivel} onClick={() => { setCli(p.id); setModel(p.modelos[0] ?? ""); setEffort("high"); }}>
              <b>{labels[p.id] ?? p.id}</b>
              <span>{quotaText}</span>
            </button>
          );
        })}</div>
        {currentProvider?.pool && (
          <div className="prov" style={{ marginTop: "6px" }}>
            <div className="prov-corpo">
              <b>Pool de contas multicontas ({labels[cli] ?? cli})</b>
              <span>
                {currentProvider.pool.total} contas: {currentProvider.pool.total - currentProvider.pool.ativas - currentProvider.pool.emCooldown} livres, {currentProvider.pool.ativas} em uso{currentProvider.pool.emCooldown > 0 ? `, ${currentProvider.pool.emCooldown} em cooldown temporário` : ""}.
              </span>
              <span className="dica">
                Cada painel usa uma conta diferente em paralelo. Ao bater cota, o Cockpit troca de conta preservando o cache da sessão.
              </span>
            </div>
            {currentProvider.pool.emCooldown > 0 && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => void act(async () => {
                  await request("/api/account-pools/reset-limit", { cli });
                  setStatus(await request("/api/maestro"));
                })}
              >
                Resetar cooldowns
              </button>
            )}
          </div>
        )}
        <label className="campo-bloco"><span className="rotulo">Modelo do maestro</span><select className="campo" value={model} onChange={e => setModel(e.target.value)}>{status.providers.find(p => p.id === cli)?.modelos.map(m => <option key={m}>{m}</option>)}</select></label>
        <label className="campo-bloco"><span className="rotulo">Esforço</span><select className="campo" value={effort} onChange={e => setEffort(e.target.value)}>{["low", "medium", "high", ...(cli === "codex" ? ["xhigh", "max", "ultra"] : cli === "claude" ? ["xhigh", "max"] : [])].map(e => <option key={e}>{e}</option>)}</select></label>
        <label className="ressalva"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Continuar automaticamente em outro provedor quando houver limite.</label>
        <p className="dica">Com até 10% restante, o maestro troca após o próximo checkpoint. Se um painel bloquear, retoma a tarefa dele com o histórico disponível. Claude e AGY dependem de avisos explícitos do terminal. A troca usa modelos fortes; confira testes e entregas após a retomada.</p>
        <div className="prov"><div className="prov-corpo"><b>Cota GPT / Codex</b><span>{status.codexQuota ? `${status.codexQuota.remaining}% restante · consultado às ${new Date(status.codexQuota.checkedAt).toLocaleTimeString()}` : "Não informada"}</span>{status.codexQuota?.resetsAt && <span>Renova em {new Date(status.codexQuota.resetsAt * 1000).toLocaleString()}</span>}{status.quotaError && <span className="dica">Não foi possível consultar a cota da conta. Os avisos do terminal continuam sendo monitorados.</span>}</div><button className="btn" disabled={busy} onClick={() => void act(async () => { setStatus(await request("/api/maestro/refresh", {})); })}>Atualizar cota</button></div>
        {Object.entries(status.limits).map(([provider, limit]) => <div className="prov" key={provider}><div className="prov-corpo"><b>{labels[provider]}</b><span>{limit.detail}</span></div><button className="btn" disabled={busy} onClick={() => void act(async () => { setStatus(await request("/api/maestro/reset-limit", { cli: provider })); })}>Cota renovada</button></div>)}
      </>}
    </div>
    <footer className="wizard-pe"><button className="btn" disabled={busy || !status} onClick={() => void act(async () => { await save(); setNotice("Preferência salva para os próximos maestros."); })}>Salvar padrão</button><button className="btn solid" disabled={busy || !status || !missionId} onClick={() => void act(async () => { await save(); await request(`/api/missions/${missionId}/maestro`, { cli }); setNotice("Novo maestro aberto com o contexto da missão."); })}>{busy ? "Aguarde…" : "Trocar nesta missão"}</button></footer>
  </div>;
}
