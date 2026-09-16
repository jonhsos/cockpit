import { useEffect, useRef, useState } from "react";
import {
  atualizarModelosDshApi,
  atualizarModelosDshGateway,
  descobrirModelosDshApi,
  fetchDshGateway,
  fetchDshApis,
  removerDshApi,
  salvarChaveDshApi,
  salvarDshApi,
  type DshApi,
  type DshGateway,
  type DshApiModel,
  type DshApiInput,
} from "./api.ts";

const VAZIO: DshApiInput = {
  id: "deepseek",
  label: "DeepSeek API",
  provider: "deepseek-official",
  model: "",
  chave: "",
  api: null,
  baseURL: null,
  chaveUrl: "https://platform.deepseek.com/api_keys",
};

const PROTOCOLOS = [
  ["openai-responses", "OpenAI Responses"],
  ["openai-completions", "OpenAI Chat Completions"],
  ["anthropic-messages", "Anthropic Messages"],
] as const;

export function DshApis({ onMudou }: { onMudou: () => void }) {
  const [apis, setApis] = useState<DshApi[]>([]);
  const [form, setForm] = useState<DshApiInput>(VAZIO);
  const [nova, setNova] = useState(false);
  const [chavePara, setChavePara] = useState<string | null>(null);
  const [chave, setChave] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [catalogoForm, setCatalogoForm] = useState<DshApiModel[]>([]);
  const [consultando, setConsultando] = useState(false);
  const [gateway, setGateway] = useState<DshGateway | null>(null);
  const [gatewayConsultando, setGatewayConsultando] = useState(false);
  const consultaAtual = useRef("");

  const recarregar = () => fetchDshApis().then((res) => setApis(res.apis), (err: Error) => setErro(err.message));
  const recarregarGateway = () => fetchDshGateway().then((res) => setGateway(res.gateway), (err: Error) => setErro(err.message));
  useEffect(() => { void recarregar(); void recarregarGateway(); }, []);

  const executar = async (acao: () => Promise<void>) => {
    setOcupado(true);
    setErro(null);
    try {
      await acao();
      await recarregar();
      onMudou();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  };

  const editar = (api: DshApi) => {
    setForm({
      id: api.id,
      label: api.label,
      provider: api.provider,
      model: api.model ?? "",
      chave: "",
      api: api.api,
      baseURL: api.baseURL,
      chaveUrl: api.chaveUrl,
      modelos: api.modelos,
    });
    setCatalogoForm(api.modelos);
    setNova(true);
  };

  const consultarModelos = async (entrada: DshApiInput = form) => {
    const chaveConsulta = JSON.stringify({ provider: entrada.provider, api: entrada.api ?? null, baseURL: entrada.baseURL ?? null });
    consultaAtual.current = chaveConsulta;
    setConsultando(true);
    setErro(null);
    try {
      const result = await descobrirModelosDshApi(entrada);
      if (consultaAtual.current !== chaveConsulta) return;
      setCatalogoForm(result.modelos);
      setForm((current) => ({
        ...current,
        modelos: result.modelos,
        model: current.model && result.modelos.some((model) => model.id === current.model)
          ? current.model
          : result.modelos[0]?.id ?? "",
      }));
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setConsultando(false);
    }
  };

  const abrirNovo = () => {
    setForm(VAZIO);
    setCatalogoForm([]);
    setNova(true);
    void consultarModelos(VAZIO);
  };

  const cancelarForm = () => {
    setNova(false);
    setForm(VAZIO);
    setCatalogoForm([]);
  };

  const atualizarGateway = async () => {
    setGatewayConsultando(true);
    setErro(null);
    try {
      const result = await atualizarModelosDshGateway();
      setGateway(result.gateway);
      await recarregar();
      onMudou();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      await recarregarGateway();
    } finally {
      setGatewayConsultando(false);
    }
  };

  const mudarRota = (patch: Partial<DshApiInput>) => {
    consultaAtual.current = "rota-alterada";
    setForm((current) => ({ ...current, ...patch, model: "", modelos: undefined }));
    setCatalogoForm([]);
  };

  return (
    <div className="wizard-corpo dsh-apis">
      {erro && <div className="aviso">{erro}<button onClick={() => setErro(null)}>✕</button></div>}
      <section className="campo-bloco dsh-api-intro">
        <span className="rotulo">Escolha como o DSH acessa o modelo</span>
        <p className="dica">Você pode usar a API oficial do DeepSeek com sua própria chave ou o gateway configurado no Codex. O Shell limpo continua separado e nunca recebe a chave nem o contexto do DSH.</p>
        <p className="dica sem-margem">A configuração da API fica nesta aba. Depois, selecione o executor criado em <b>Catálogo de Papéis</b> ou use <code>codex · dsh</code> para o OmniRoute.</p>
      </section>

      <section className="campo-bloco dsh-gateway-card">
        <div className="dsh-gateway-heading">
          <div>
            <span className="rotulo">DSH via OmniRoute</span>
            <p className="dica sem-margem">Usa o <code>CODEX_HOME</code> global do Cockpit e deixa a rotação das quatro contas para o OmniRoute.</p>
          </div>
          <span className={`dsh-gateway-status${gateway?.configurado && gateway.credencialDisponivel && gateway.modelos.length > 0 ? " on" : ""}`}>
            {!gateway ? "verificando…" : !gateway.configurado ? "não configurado" : gateway.credencialDisponivel && gateway.modelos.length > 0 ? "conectado" : gateway.credencialDisponivel ? "sem catálogo" : "credencial ausente"}
          </span>
        </div>
        {gateway?.configurado ? (
          <>
            <div className="dsh-gateway-facts">
              <span>Rota <code>{gateway.provider}</code></span>
              <span>URL <code>{gateway.baseURL}</code></span>
              <span>Protocolo <code>{gateway.api}</code></span>
              <span>Modelo padrão <code>{gateway.model ?? "não definido"}</code></span>
            </div>
            <p className="dica dsh-gateway-note">Neste modo, o pool de contas do Cockpit não escolhe nem substitui <code>CODEX_HOME</code>. O DSH conversa com o gateway global, e o OmniRoute decide qual conta usar.</p>
            {gateway.erro && <p className="prov-instalar">{gateway.erro}</p>}
            {gateway.modelos.length > 0 && (
              <div className="dsh-modelos dsh-gateway-modelos">
                <div className="dsh-modelos-cabecalho"><span><b>Modelos fornecidos pelo OmniRoute</b><small>{gateway.modelos.length} modelos confirmados</small></span></div>
                <ul>{gateway.modelos.map((model) => <li key={model.id}><code>{model.id}</code>{model.name && model.name !== model.id && <span>{model.name}</span>}</li>)}</ul>
              </div>
            )}
            <div className="form-acoes">
              <button type="button" className="btn solid" disabled={ocupado || gatewayConsultando} onClick={() => void atualizarGateway()}>
                {gatewayConsultando ? "Consultando OmniRoute…" : "Atualizar catálogo do OmniRoute"}
              </button>
              <span className="dica sem-margem">A chave não é exibida nem gravada no Cockpit.</span>
            </div>
          </>
        ) : (
          <p className="dica sem-margem">O Cockpit procura a configuração em <code>CODEX_HOME</code>. Para ativar este modo, o Codex precisa apontar para um gateway OpenAI-compatible, como o OmniRoute.</p>
        )}
      </section>

      <section className="campo-bloco dsh-api-intro dsh-direct-api-heading">
        <span className="rotulo">APIs diretas do DSH</span>
        <p className="dica sem-margem">Este caminho não depende do OmniRoute: a chave é cifrada no cofre local e só é entregue ao processo DSH do painel selecionado.</p>
      </section>

      {apis.map((api) => {
        const modelos = api.modelos ?? [];
        return (
        <section className="campo-bloco" key={api.id}>
          <div className={`prov${api.pronto ? " on" : ""}`}>
            <span className="prov-luz" />
            <div className="prov-corpo">
              <b>{api.label}</b>
              <span className="prov-agentes">rota DSH <code>{api.provider}</code> · modelo ativo <code>{api.model ?? "não definido"}</code></span>
              <span className="prov-cmd">{api.api ? `${api.api} · ${api.baseURL}` : "catálogo nativo do DSH"}</span>
              {api.pronto ? <span className="prov-cmd">chave vinda de {api.chaveEm}</span> : <span className="prov-instalar">{api.falta}</span>}
              <div className="dsh-modelos">
                <div className="dsh-modelos-cabecalho"><span><b>Modelos fornecidos</b><small>{modelos.length ? `${modelos.length} confirmados` : "ainda não consultados"}</small></span><button type="button" className="btn mini" disabled={ocupado} onClick={() => executar(async () => { await atualizarModelosDshApi(api.id); })}>Atualizar modelos</button></div>
                {modelos.length > 0 ? <ul>{modelos.map((model) => <li key={model.id} className={model.id === api.model ? "ativo" : undefined}><code>{model.id}</code>{model.name && model.name !== model.id && <span>{model.name}</span>}{model.id === api.model && <em>ativo</em>}</li>)}</ul> : <p className="dica sem-margem">Clique em “Atualizar modelos” para consultar o catálogo real da rota.</p>}
              </div>
            </div>
            {chavePara === api.id ? (
              <div className="form-inline chave">
                <input className="campo" type="password" autoFocus value={chave} onChange={(event) => setChave(event.target.value)} placeholder="cole a chave aqui" aria-label={`Chave de ${api.label}`} />
                <button className="btn quiet" onClick={() => { setChavePara(null); setChave(""); }}>Cancelar</button>
                <button className="btn solid" disabled={ocupado || !chave.trim()} onClick={() => executar(async () => { await salvarChaveDshApi(api.id, chave); setChave(""); setChavePara(null); })}>Guardar</button>
              </div>
            ) : (
              <div className="form-acoes">
                <button className="btn" disabled={ocupado} onClick={() => setChavePara(api.id)}>{api.chaveEm ? "Trocar chave" : "Pôr chave"}</button>
                <button className="btn quiet" disabled={ocupado} onClick={() => editar(api)}>Editar</button>
                <button className="btn quiet" disabled={ocupado} onClick={() => executar(async () => { await removerDshApi(api.id); })}>Remover</button>
              </div>
            )}
          </div>
        </section>
        );
      })}

      {!nova ? <button className="btn solid" onClick={abrirNovo}>Conectar API ao DSH</button> : (
        <form className="campo-bloco dsh-api-form" onSubmit={(event) => { event.preventDefault(); if (!form.model?.trim()) { setErro("Consulte os modelos e escolha um modelo antes de salvar."); return; } void executar(async () => { await salvarDshApi(form); cancelarForm(); }); }}>
          <span className="rotulo">{apis.some((api) => api.id === form.id) ? "Editar API DSH" : "Conectar API DSH"}</span>
          <div className="form-grade">
            <label><span>Identificador</span><input className="campo" value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} maxLength={63} required /></label>
            <label><span>Nome visível</span><input className="campo" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} maxLength={80} required /></label>
            <label><span>Rota no DSH</span><input className="campo" value={form.provider} onChange={(event) => mudarRota({ provider: event.target.value })} placeholder="deepseek-official" maxLength={100} required /></label>
            <label><span>Modelo ativo</span><input className="campo" list={`dsh-modelos-${form.id}`} value={form.model ?? ""} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="consulte o catálogo abaixo" maxLength={160} required /><datalist id={`dsh-modelos-${form.id}`}>{catalogoForm.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist></label>
          </div>
          <div className="dsh-form-catalogo"><div className="dsh-modelos-cabecalho"><span><b>Catálogo do executor</b><small>{catalogoForm.length ? `${catalogoForm.length} modelos encontrados` : "nenhum catálogo consultado"}</small></span><button type="button" className="btn" disabled={consultando || ocupado} onClick={() => void consultarModelos()}>{consultando ? "Consultando…" : "Consultar modelos"}</button></div>{catalogoForm.length > 0 ? <ul>{catalogoForm.map((model) => <li key={model.id} className={model.id === form.model ? "ativo" : undefined}><button type="button" onClick={() => setForm({ ...form, model: model.id })}><code>{model.id}</code>{model.name && model.name !== model.id && <span>{model.name}</span>}<em>{model.id === form.model ? "selecionado" : "usar"}</em></button></li>)}</ul> : <p className="dica sem-margem">O Cockpit consulta o catálogo do DSH para rotas nativas e o endpoint compatível da API para gateways personalizados. Nada é inventado.</p>}</div>
          <label className="campo-bloco"><span className="rotulo">Chave da API</span><input className="campo" type="password" value={form.chave} onChange={(event) => setForm({ ...form, chave: event.target.value })} placeholder="cole a chave aqui para guardar ou deixe vazio para manter a atual" /></label>
          <details className="dsh-api-advanced"><summary>Gateway personalizado (opcional)</summary><p className="dica">Preencha os dois campos para um endpoint que não esteja no catálogo nativo do DSH.</p><div className="form-grade"><label><span>Protocolo</span><select className="campo" value={form.api ?? ""} onChange={(event) => mudarRota({ api: event.target.value ? event.target.value as DshApiInput["api"] : null })}><option value="">Catálogo nativo DSH</option>{PROTOCOLOS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label><span>URL base</span><input className="campo" type="url" value={form.baseURL ?? ""} onChange={(event) => mudarRota({ baseURL: event.target.value || null })} placeholder="https://api.exemplo.com/v1" /></label></div></details>
          <footer className="form-acoes"><button type="button" className="btn quiet" onClick={cancelarForm}>Cancelar</button><button className="btn solid" disabled={ocupado || consultando}>{ocupado ? "Guardando…" : "Salvar e disponibilizar no catálogo"}</button></footer>
        </form>
      )}
    </div>
  );
}
