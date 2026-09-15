import { useEffect, useState } from "react";
import { onMessage } from "./socket.ts";
import {
  conectarProvider,
  criarAgenteProvider,
  desconectarProvider,
  fetchProviders,
  salvarAutoAprovar,
  testarProvider,
  resetAccountCooldown,
  addAccountToPool,
  removeAccountFromPool,
  type Preset,
  type Provider,
} from "./api.ts";

/**
 * Conectar um provedor é dizer ao cockpit qual comando chamar. Nenhuma
 * credencial passa por aqui: cada CLI já é autenticado por fora, na conta que
 * você paga. Por isso a tela mostra "instalado" e "responde", não "logado".
 */
export function Config({ onFechar, onMudou }: { onFechar: () => void; onMudou: () => void }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [autoAprovar, setAutoAprovar] = useState(true);
  const [testes, setTestes] = useState<Record<string, { ok: boolean; saida: string }>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [poolAberto, setPoolAberto] = useState<Record<string, boolean>>({});
  const [novaConta, setNovaConta] = useState<Record<string, { id: string; label: string; envKey: string; envVal: string } | null>>({});
  const [novo, setNovo] = useState<{ id: string; comando: string; modelos: string } | null>(null);

  const recarregar = (rescan = false) =>
    fetchProviders(rescan).then((d) => {
      setProviders(d.providers);
      setPresets(d.presets);
      if (d.autoAprovar !== undefined) setAutoAprovar(d.autoAprovar);
    }, (e: Error) => setErro(e.message));

  useEffect(() => {
    void recarregar();
    return onMessage((msg) => {
      if (msg.type === "pool:updated" || msg.type === "pool:rotated") {
        void recarregar();
      }
    });
  }, []);

  const guardado = async (fn: () => Promise<void>) => {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      await recarregar();
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  };

  const conectados = new Set(providers.map((p) => p.id));
  const disponiveis = presets.filter((p) => !conectados.has(p.id));

  // A moldura (título e fechar) é da janela de ajustes; aqui só o conteúdo.
  void onFechar;

  return (
    <div className="config">
      {erro && (
        <div className="aviso">
          {erro}
          <button onClick={() => setErro(null)}>✕</button>
        </div>
      )}

      <div className="wizard-corpo">
        <p className="dica">
          O cockpit não guarda chave nem senha: ele só sabe chamar os CLIs que já estão autenticados
          na sua máquina, com as assinaturas que você já paga.
        </p>

        <div className="campo-bloco">
          <span className="rotulo">Permissões de ferramentas e comandos</span>
          <p className="dica">
            Quando ativado, qualquer LLM aberta roda com auto-aprovação (<code>--dangerously-skip-permissions</code> no Claude e Antigravity, <code>--ask-for-approval never</code> no Codex e <code>-y</code> no Gemini) para você não precisar ficar confirmando cada comando no terminal.
          </p>
          <label className="ressalva" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginTop: "6px" }}>
            <input
              type="checkbox"
              checked={autoAprovar}
              disabled={ocupado}
              onChange={(e) => {
                const val = e.target.checked;
                setAutoAprovar(val);
                void guardado(() => salvarAutoAprovar(val).then(() => undefined));
              }}
            />
            <span>Auto-aprovar ações (não precisar ficar aceitando tudo que o chat despejar)</span>
          </label>
        </div>

        <div className="campo-bloco">
          <span className="rotulo">
            Conectados
            <button
              className="btn"
              disabled={ocupado}
              title="Varre o PATH de novo — use depois de instalar um CLI"
              onClick={() => guardado(async () => { await recarregar(true); })}
            >
              Procurar de novo
            </button>
          </span>
          <div className="lista-prov">
            {providers.map((p) => {
              const isPoolOpen = poolAberto[p.id] ?? false;
              return (
                <div key={p.id} className="prov-item-wrapper">
                  <div className={`prov${p.disponivel ? " on" : ""}`}>
                    <span className="prov-luz" />
                    <div className="prov-corpo">
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <b>{p.id}</b>
                        {p.pool && (
                          <span className={`badge-pool${p.pool.emCooldown > 0 ? " tem-cooldown" : ""}`}>
                            Pool: {p.pool.total} contas ({p.pool.total - p.pool.ativas - p.pool.emCooldown} livres · {p.pool.ativas} em uso{p.pool.emCooldown > 0 ? ` · ${p.pool.emCooldown} cooldown` : ""})
                          </span>
                        )}
                      </div>
                      <span className="prov-cmd" title={p.caminho ?? p.comando}>
                        {p.caminho ?? p.comando}
                      </span>
                      <span className="prov-agentes">
                        {p.agentes.length > 0 ? p.agentes.join(", ") : "nenhum agente usa ainda"}
                        {p.modelos.length > 0 && ` · ${p.modelos.length} modelos`}
                      </span>
                      {!p.disponivel && p.instalar && (
                        <span className="prov-instalar">
                          não encontrado — instale com <code>{p.instalar}</code>
                        </span>
                      )}
                      {testes[p.id] && (
                        <span className={`prov-teste${testes[p.id]!.ok ? " ok" : " falhou"}`}>
                          {testes[p.id]!.saida}
                        </span>
                      )}
                    </div>
                    {p.pool && (
                      <button
                        className="btn"
                        style={{ fontSize: "12px", whiteSpace: "nowrap" }}
                        disabled={ocupado}
                        onClick={() => setPoolAberto((st) => ({ ...st, [p.id]: !st[p.id] }))}
                      >
                        {isPoolOpen ? "Fechar contas ▲" : `Contas (${p.pool.total}) ▼`}
                      </button>
                    )}
                    {p.agentes.length === 0 && (
                      <button
                        className="btn solid"
                        disabled={ocupado}
                        title="Sem agente o provedor não aparece em nenhuma missão"
                        onClick={() => guardado(() => criarAgenteProvider(p.id).then(() => undefined))}
                      >
                        Criar agente
                      </button>
                    )}
                    <button
                      className="btn"
                      disabled={ocupado}
                      onClick={() =>
                        guardado(async () => {
                          const r = await testarProvider(p.id);
                          setTestes((t) => ({ ...t, [p.id]: r }));
                        })
                      }
                    >
                      Testar
                    </button>
                    <button
                      className="btn quiet"
                      disabled={ocupado}
                      title="Tira do cockpit; não desinstala nada"
                      onClick={() => guardado(() => desconectarProvider(p.id).then(() => undefined))}
                    >
                      Remover
                    </button>
                  </div>

                  {p.pool && isPoolOpen && (
                    <div className="prov-pool-drawer">
                      <div className="prov-pool-topo">
                        <b>
                          Contas do Pool {p.id.toUpperCase()} ({p.pool.total} cadastradas)
                        </b>
                        {p.pool.emCooldown > 0 && (
                          <button
                            className="btn"
                            disabled={ocupado}
                            style={{ fontSize: "11px", padding: "3px 8px" }}
                            onClick={() => guardado(() => resetAccountCooldown(p.id).then(() => undefined))}
                          >
                            Resetar cota de todas ({p.pool.emCooldown})
                          </button>
                        )}
                      </div>

                      <div className="lista-contas-pool">
                        {p.pool.contas.map((c) => (
                          <div key={c.id} className="conta-pool-row">
                            <div className="conta-pool-info">
                              <div className="conta-pool-principal">
                                <span className={`conta-pool-tag ${c.status}`}>
                                  {c.status === "livre"
                                    ? "● Livre"
                                    : c.status === "ocupada"
                                    ? `● Em uso (${c.painelLabel || c.painelId})`
                                    : `● Cooldown ${c.limitedUntil ? `até ${new Date(c.limitedUntil).toLocaleTimeString()}` : ""}`}
                                </span>
                                <b>{c.label || c.id}</b>
                                <code style={{ color: "var(--ink-4)", fontSize: "11px" }}>{c.id}</code>
                              </div>
                              <div className="conta-pool-detalhes">
                                {c.env && Object.entries(c.env).length > 0 ? (
                                  Object.entries(c.env).map(([k, v]) => (
                                    <span key={k}>
                                      <code>{k}</code>={v}
                                    </span>
                                  ))
                                ) : (
                                  <span>Configuração padrão</span>
                                )}
                                {c.lastLimitDetail && (
                                  <span style={{ color: "var(--alerta)" }}>Motivo: {c.lastLimitDetail}</span>
                                )}
                              </div>
                            </div>

                            <div className="conta-pool-acoes">
                              {c.status === "cooldown" && (
                                <button
                                  className="btn"
                                  disabled={ocupado}
                                  style={{ fontSize: "11px", padding: "2px 6px" }}
                                  onClick={() => guardado(() => resetAccountCooldown(p.id, c.id).then(() => undefined))}
                                >
                                  Resetar cota
                                </button>
                              )}
                              <button
                                className="btn quiet"
                                disabled={ocupado || (p.pool?.contas.length ?? 0) <= 1 || c.status === "ocupada"}
                                title={
                                  c.status === "ocupada"
                                    ? "Não é possível remover conta em execução"
                                    : (p.pool?.contas.length ?? 0) <= 1
                                    ? "O pool precisa de pelo menos uma conta"
                                    : "Remover esta conta do pool"
                                }
                                style={{ padding: "2px 6px", fontSize: "11px" }}
                                onClick={() => guardado(() => removeAccountFromPool(p.id, c.id).then(() => undefined))}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {novaConta[p.id] ? (
                        <div className="form-inline" style={{ marginTop: "6px" }}>
                          <span style={{ fontSize: "12px", color: "var(--ink-2)", fontWeight: 500 }}>
                            Adicionar nova conta ao pool de {p.id}
                          </span>
                          <input
                            className="campo"
                            placeholder="ID único (ex: codex-5, gemini-5)"
                            value={novaConta[p.id]?.id ?? ""}
                            onChange={(e) =>
                              setNovaConta((st) => ({
                                ...st,
                                [p.id]: { ...(st[p.id] || { id: "", label: "", envKey: "", envVal: "" }), id: e.target.value },
                              }))
                            }
                          />
                          <input
                            className="campo"
                            placeholder="Rótulo / Email da conta (ex: contato@exemplo.com)"
                            value={novaConta[p.id]?.label ?? ""}
                            onChange={(e) =>
                              setNovaConta((st) => ({
                                ...st,
                                [p.id]: { ...(st[p.id] || { id: "", label: "", envKey: "", envVal: "" }), label: e.target.value },
                              }))
                            }
                          />
                          <div style={{ display: "flex", gap: "6px" }}>
                            <input
                              className="campo"
                              placeholder={p.id === "codex" ? "CODEX_HOME" : p.id === "gemini" ? "GEMINI_CLI_HOME" : p.id === "grok" ? "GROK_HOME" : "VARIAVEL_ENV"}
                              value={novaConta[p.id]?.envKey ?? ""}
                              onChange={(e) =>
                                setNovaConta((st) => ({
                                  ...st,
                                  [p.id]: { ...(st[p.id] || { id: "", label: "", envKey: "", envVal: "" }), envKey: e.target.value },
                                }))
                              }
                            />
                            <input
                              className="campo"
                              placeholder="Caminho do diretório (ex: ~/.codex-acc5)"
                              value={novaConta[p.id]?.envVal ?? ""}
                              onChange={(e) =>
                                setNovaConta((st) => ({
                                  ...st,
                                  [p.id]: { ...(st[p.id] || { id: "", label: "", envKey: "", envVal: "" }), envVal: e.target.value },
                                }))
                              }
                            />
                          </div>
                          <div className="form-acoes">
                            <button
                              className="btn quiet"
                              onClick={() => setNovaConta((st) => ({ ...st, [p.id]: null }))}
                            >
                              Cancelar
                            </button>
                            <button
                              className="btn solid"
                              disabled={
                                ocupado ||
                                !novaConta[p.id]?.id.trim() ||
                                !novaConta[p.id]?.label.trim()
                              }
                              onClick={() =>
                                guardado(async () => {
                                  const item = novaConta[p.id]!;
                                  const env: Record<string, string> = {};
                                  const defaultKey = p.id === "codex" ? "CODEX_HOME" : p.id === "gemini" ? "GEMINI_CLI_HOME" : p.id === "grok" ? "GROK_HOME" : "CLI_HOME";
                                  const k = item.envKey.trim() || defaultKey;
                                  if (item.envVal.trim()) {
                                    env[k] = item.envVal.trim();
                                  }
                                  await addAccountToPool(p.id, {
                                    id: item.id.trim(),
                                    label: item.label.trim(),
                                    env: Object.keys(env).length > 0 ? env : undefined,
                                  });
                                  setNovaConta((st) => ({ ...st, [p.id]: null }));
                                })
                              }
                            >
                              Salvar conta
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="btn quiet"
                          style={{ alignSelf: "flex-start", fontSize: "12px" }}
                          onClick={() => {
                            const defaultKey = p.id === "codex" ? "CODEX_HOME" : p.id === "gemini" ? "GEMINI_CLI_HOME" : p.id === "grok" ? "GROK_HOME" : "CLI_HOME";
                            const nextNum = (p.pool?.contas.length ?? 0) + 1;
                            setNovaConta((st) => ({
                              ...st,
                              [p.id]: {
                                id: `${p.id}-${nextNum}`,
                                label: `Conta ${nextNum}`,
                                envKey: defaultKey,
                                envVal: `~/.${p.id}-acc${nextNum}`,
                              },
                            }));
                          }}
                        >
                          + Adicionar conta ao pool
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {disponiveis.length > 0 && (
          <div className="campo-bloco">
            <span className="rotulo">Conectar</span>
            <div className="cartas">
              {disponiveis.map((p) => (
                <button
                  key={p.id}
                  className="carta"
                  disabled={ocupado}
                  onClick={() =>
                    guardado(() =>
                      conectarProvider({
                        id: p.id,
                        comando: p.comando,
                        modelos: p.modelos,
                      }).then(() => undefined),
                    )
                  }
                >
                  <b>{p.label}</b>
                  <span>
                    comando <code>{p.comando}</code>
                  </span>
                  {p.nota && <span className="fases-mini">{p.nota}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="campo-bloco">
          <span className="rotulo">
            Outro CLI <em>— qualquer programa de terminal que fale com um agente</em>
          </span>
          {novo === null ? (
            <div>
              <button className="btn" onClick={() => setNovo({ id: "", comando: "", modelos: "" })}>
                Adicionar manualmente
              </button>
            </div>
          ) : (
            <div className="form-inline">
              <input
                className="campo"
                autoFocus
                placeholder="nome (ex: kimi)"
                value={novo.id}
                onChange={(e) => setNovo({ ...novo, id: e.target.value })}
              />
              <input
                className="campo"
                placeholder="comando (ex: kimi) ou caminho completo do .exe"
                value={novo.comando}
                onChange={(e) => setNovo({ ...novo, comando: e.target.value })}
              />
              <input
                className="campo"
                placeholder="modelos separados por vírgula (opcional)"
                value={novo.modelos}
                onChange={(e) => setNovo({ ...novo, modelos: e.target.value })}
              />
              <div className="form-acoes">
                <button className="btn quiet" onClick={() => setNovo(null)}>
                  Cancelar
                </button>
                <button
                  className="btn solid"
                  disabled={ocupado || !novo.id.trim() || !novo.comando.trim()}
                  onClick={() =>
                    guardado(async () => {
                      await conectarProvider({
                        id: novo.id.trim(),
                        comando: novo.comando.trim(),
                        modelos: novo.modelos
                          .split(",")
                          .map((m) => m.trim())
                          .filter(Boolean),
                      });
                      setNovo(null);
                    })
                  }
                >
                  Conectar
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="ressalva">
          Isto grava no <code>cockpit.json</code>. Depois de conectar, crie um agente lá apontando
          para o provedor novo — é o agente que junta CLI, modelo, esforço e papel.
        </p>
      </div>
    </div>
  );
}
