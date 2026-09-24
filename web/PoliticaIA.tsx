import { useEffect, useState } from "react";
import type { AgentSpec, Provider } from "./api.ts";
type Execucao = { cli: string; model: string; effort: string };
type Politica = { modo: "padrao" | "unica" | "dividida"; unica?: Execucao; papeis?: Record<string, Execucao> };
type Dados = { politica: Politica; agents: Record<string, AgentSpec>; providers: Provider[] };
const sol = { cli: "codex", model: "gpt-6-sol", effort: "high" };
function Escolha({ value, providers, onChange }: { value: Execucao; providers: Provider[]; onChange: (e: Execucao) => void }) {
  const provider = providers.find(p => p.id === value.cli);
  return <div className="cartas">
    <label>Provedor<select className="campo" value={value.cli} onChange={e => { const p = providers.find(p => p.id === e.target.value)!; onChange({ cli: p.id, model: p.modelos[0]!, effort: p.efforts?.includes("high") ? "high" : p.efforts?.[0] ?? "high" }); }}>{providers.map(p => <option key={p.id} value={p.id}>{p.id}{p.disponivel ? "" : " (indisponível)"}</option>)}</select></label>
    <label>Modelo<select className="campo" value={value.model} onChange={e => onChange({ ...value, model: e.target.value })}>{provider?.modelos.map(m => { const label = provider.nomesModelos?.[m]; return <option key={m} value={m}>{label && label !== m ? `${label} (${m})` : m}</option>; })}</select></label>
    <label>Esforço<select className="campo" value={value.effort} onChange={e => onChange({ ...value, effort: e.target.value })}>{(provider?.efforts ?? ["low", "medium", "high"]).map(e => <option key={e}>{e}</option>)}</select></label>
  </div>;
}
/**
 * O que chega da rede não é confiável só por ter vindo com status 200.
 *
 * Um servidor de outra versão respondendo `[]` nesta rota fazia
 * `dados.providers.filter` estourar durante a renderização — e como esta tela
 * mora dentro do modal do maestro, o erro subia até o topo e trocava o cockpit
 * inteiro pela página de "a tela quebrou". Um formato inesperado tem que virar
 * um aviso nesta seção, não um tombo do aplicativo.
 */
function conferir(d: unknown): Dados {
  const ok = d !== null && typeof d === "object" && !Array.isArray(d)
    && Array.isArray((d as Dados).providers)
    && !!(d as Dados).agents && typeof (d as Dados).agents === "object"
    && !!(d as Dados).politica;
  if (!ok) throw Error("O servidor respondeu a configuração de IA num formato que esta tela não entende. Reinicie o servidor e recarregue a janela.");
  return d as Dados;
}

export function PoliticaIA({ onChanged }: { onChanged: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [politica, setPolitica] = useState<Politica>({ modo: "padrao" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/politica-ia", { signal: controller.signal }).then(async r => {
      if (!r.ok || !r.headers.get("content-type")?.includes("application/json")) throw Error("Reinicie o servidor para carregar a configuração de IA.");
      return r.json() as Promise<Dados>;
    }).then(d => { setDados(conferir(d)); setPolitica(d.politica); }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); });
    return () => controller.abort();
  }, []);
  const change = (p: Politica) => { setPolitica(p); setNotice(""); };
  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/politica-ia", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(politica) });
      const result = await r.json();
      if (!r.ok) throw Error(result.error ?? "Não foi possível salvar.");
      setPolitica(result); onChanged(); setNotice("Configuração salva. Vale para os próximos painéis; painéis abertos continuam como estão.");
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const providers = dados?.providers.filter(p => p.modelos.length > 0) ?? [];
  return <section aria-label="Configuração de IA">
    <h3>Quem faz o trabalho</h3>
    {error && <p className="aviso" role="alert">{error}</p>}
    {dados && <fieldset disabled={busy}>
      <label className="campo-bloco">Distribuição de IA<select className="campo" value={politica.modo} onChange={e => change({ ...politica, modo: e.target.value as Politica["modo"], unica: politica.unica ?? sol, papeis: politica.papeis ?? {} })}>
        <option value="padrao">Padrão atual</option><option value="unica">Uma IA para tudo</option><option value="dividida">Escolher por papel</option>
      </select></label>
      {politica.modo === "padrao" && <p className="dica">Mantém catálogo, modelos por tarefa e escolhas da missão. Orquestrador: {dados.agents.maestro?.cli} / {dados.agents.maestro?.model}; piloto: {dados.agents.piloto?.cli} / {dados.agents.piloto?.model}; construtor: {dados.agents.builder?.cli} / {dados.agents.builder?.model}.</p>}
      {politica.modo === "unica" && <><Escolha value={politica.unica ?? sol} providers={providers} onChange={unica => change({ ...politica, unica })} /><p className="dica">A mesma IA assume todos os papéis. O maestro planeja, implementa e revisa sozinho, delegando apenas se você pedir. Prevalece sobre receitas, elenco e tarefas; não troca automaticamente de IA. Geração de mídia depende das ferramentas disponíveis.</p></>}
      {politica.modo === "dividida" && <><p className="dica">Papéis personalizados prevalecem sobre receitas e tarefas. Os demais seguem o padrão atual.</p>{Object.entries(dados.agents).filter(([, a]) => a.cli !== "bash").map(([id, a]) => <div className="campo-bloco" key={id}>
        <label><input type="checkbox" checked={!!politica.papeis?.[id]} onChange={e => { const papeis = { ...politica.papeis }; if (e.target.checked) papeis[id] = { cli: a.cli, model: a.model ?? providers.find(p => p.id === a.cli)?.modelos[0] ?? "", effort: a.effort ?? "high" }; else delete papeis[id]; change({ ...politica, papeis }); }} /> Personalizar {a.label}</label>
        {politica.papeis?.[id] && <Escolha value={politica.papeis[id]} providers={providers} onChange={value => change({ ...politica, papeis: { ...politica.papeis, [id]: value } })} />}
      </div>)}</>}
      <button className="btn solid" onClick={() => void save()}>{busy ? "Salvando…" : "Salvar distribuição de IA"}</button>
    </fieldset>}
    {notice && <p className="ressalva" role="status">{notice}</p>}
  </section>;
}
