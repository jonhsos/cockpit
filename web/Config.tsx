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
  startOnboarding,
  getOnboardingStatus,
  cancelOnboarding,
  submitManualOnboardingCallback,
  salvarBackendProvider,
  openLoginTerminal,
  type Preset,
  type Provider,
} from "./api.ts";

interface OnboardUIState {
  sessionId: string;
  authUrl: string;
  loopbackPort: number;
  status: "waiting" | "configuring" | "success" | "error";
  stepLabel?: string;
  error?: string;
  account?: { id: string; label: string };
  manualInput?: string;
  showManual?: boolean;
  submittingManual?: boolean;
}

/**
 * Conectar um provedor é dizer ao cockpit qual comando chamar. Nenhuma
 * credencial passa por aqui: cada CLI já é autenticado por fora, na conta que
 * você paga. Por isso a tela mostra "instalado" e "responde", não "logado".
 */
export function Config({
  onFechar,
  onMudou,
  onAbrirDshApis,
  missionId,
}: {
  onFechar: () => void;
  onMudou: () => void;
  onAbrirDshApis?: () => void;
  missionId?: string;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [autoAprovar, setAutoAprovar] = useState(true);
  const [testes, setTestes] = useState<Record<string, { ok: boolean; saida: string }>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [poolAberto, setPoolAberto] = useState<Record<string, boolean>>({});
  const [onboardSessions, setOnboardSessions] = useState<Record<string, OnboardUIState | null>>({});
  const [novaConta, setNovaConta] = useState<Record<string, { id: string; label: string; envKey: string; envVal: string } | null>>({});
  const [mostrarAvancado, setMostrarAvancado] = useState<Record<string, boolean>>({});
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
      if (msg.type === "onboarding:step") {
        const { sessionId, cli, step, label, error, account, loopbackPort } = msg;
        // Defesa: backends antigos podiam emitir "waiting_browser".
        const mappedStatus =
          step === "waiting" || (step as string) === "waiting_browser"
            ? "waiting"
            : step === "configuring" || step === "success" || step === "error"
              ? step
              : "waiting";
        setOnboardSessions((prev) => {
          const cur = prev[cli];
          if (!cur || cur.sessionId !== sessionId) return prev;
          return {
            ...prev,
            [cli]: {
              ...cur,
              status: mappedStatus,
              stepLabel: label || cur.stepLabel,
              error: error || cur.error,
              account: (account as any) || cur.account,
              loopbackPort: loopbackPort ?? cur.loopbackPort,
            },
          };
        });
        if (mappedStatus === "success") {
          void recarregar();
          onMudou();
          setTimeout(() => {
            setOnboardSessions((prev) => ({ ...prev, [cli]: null }));
          }, 2500);
        }
      }
    });
  }, []);

  // Polling de fallback caso o websocket sofra atraso
  useEffect(() => {
    const active = Object.entries(onboardSessions).filter(
      ([_, s]) => s && (s.status === "waiting" || s.status === "configuring")
    );
    if (active.length === 0) return;

    const timer = setInterval(() => {
      for (const [cli, session] of active) {
        if (!session) continue;
        getOnboardingStatus(session.sessionId)
          .then((res) => {
            if (!res.ok) return;
            if (res.status === "success") {
              setOnboardSessions((prev) => {
                const cur = prev[cli];
                if (!cur || cur.sessionId !== session.sessionId) return prev;
                return {
                  ...prev,
                  [cli]: { ...cur, status: "success", account: res.account || undefined },
                };
              });
              void recarregar();
              onMudou();
              setTimeout(() => {
                setOnboardSessions((prev) => ({ ...prev, [cli]: null }));
              }, 2500);
            } else if (res.status === "error" || res.status === "cancelled" || res.status === "expired") {
              setOnboardSessions((prev) => {
                const cur = prev[cli];
                if (!cur || cur.sessionId !== session.sessionId) return prev;
                return {
                  ...prev,
                  [cli]: {
                    ...cur,
                    status: "error",
                    error: res.error || `Sessão encerrada (${res.status})`,
                  },
                };
              });
            }
          })
          .catch(() => {});
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [onboardSessions]);

  const iniciarOnboardingAgy = async (cli = "agy") => {
    setOcupado(true);
    setErro(null);
    try {
      const res = await startOnboarding(cli);
      if (!res.ok) {
        throw new Error("Não foi possível iniciar o servidor de login.");
      }
      setOnboardSessions((prev) => ({
        ...prev,
        [cli]: {
          sessionId: res.sessionId,
          authUrl: res.authUrl,
          loopbackPort: res.loopbackPort,
          status: "waiting",
          stepLabel: "Aguardando autorização no navegador...",
          manualInput: "",
          showManual: false,
        },
      }));
      try {
        window.open(res.authUrl, "_blank", "noopener,noreferrer");
      } catch {}
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  };

  const cancelarOnboarding = async (cli: string, sessionId: string) => {
    try {
      await cancelOnboarding(sessionId);
    } catch {}
    setOnboardSessions((prev) => ({ ...prev, [cli]: null }));
  };

  const enviarCallbackManual = async (cli: string, sessionId: string, urlOrCode: string) => {
    if (!urlOrCode.trim()) return;
    setOnboardSessions((prev) => {
      const cur = prev[cli];
      if (!cur) return prev;
      return {
        ...prev,
        [cli]: { ...cur, submittingManual: true, stepLabel: "Processando código de autorização..." },
      };
    });
    try {
      const res = await submitManualOnboardingCallback(sessionId, urlOrCode.trim());
      if (res.ok) {
        setOnboardSessions((prev) => {
          const cur = prev[cli];
          if (!cur) return prev;
          return {
            ...prev,
            [cli]: {
              ...cur,
              status: "success",
              account: res.account,
              submittingManual: false,
            },
          };
        });
        await recarregar();
        onMudou();
        setTimeout(() => {
          setOnboardSessions((prev) => ({ ...prev, [cli]: null }));
        }, 2500);
      }
    } catch (err: any) {
      setOnboardSessions((prev) => {
        const cur = prev[cli];
        if (!cur) return prev;
        return {
          ...prev,
          [cli]: {
            ...cur,
            submittingManual: false,
            error: err.message || "Falha ao validar autorização manual",
          },
        };
      });
    }
  };

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
            Quando ativado, qualquer LLM aberta roda com auto-aprovação (<code>--dangerously-skip-permissions</code> no Claude e Antigravity, <code>--ask-for-approval never</code> no Codex) para você não precisar ficar confirmando cada comando no terminal.
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
                            {p.backend === "dsh" ? "Pool PTY" : "Pool"}: {p.pool.total} contas ({p.pool.total - p.pool.ativas - p.pool.emCooldown} livres · {p.pool.ativas} em uso{p.pool.emCooldown > 0 ? ` · ${p.pool.emCooldown} cooldown` : ""})
                            {p.backend === "dsh" && " · não usado pelo DSH"}
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
                      {(p.id === "codex" || p.id === "claude") && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", marginTop: "4px" }}>
                          <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>Backend:</span>
                          <select
                            className="campo"
                            style={{ padding: "2px 6px", fontSize: "11px" }}
                            value={p.backend ?? "dsh"}
                            disabled={ocupado}
                            onChange={(e) => {
                              const novo = e.target.value as "dsh" | "pty";
                              guardado(async () => {
                                await salvarBackendProvider(p.id, novo);
                                setProviders((prev) =>
                                  prev.map((item) => (item.id === p.id ? { ...item, backend: novo } : item)),
                                );
                                onMudou();
                              });
                            }}
                          >
                            <option value="dsh">dsh (SDK headless / subagentes)</option>
                            <option value="pty">pty (Terminal CLI tradicional)</option>
                          </select>
                        </div>
                      )}
                      {p.id === "codex" && onAbrirDshApis && (
                        <button
                          type="button"
                          className="btn quiet"
                          style={{ alignSelf: "flex-start", marginTop: "6px", fontSize: "11px" }}
                          onClick={onAbrirDshApis}
                        >
                          Configurar DSH / API
                        </button>
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
                                {c.authenticated === false ? (
                                  <span
                                    className="badge-auth-aviso"
                                    style={{
                                      background: "rgba(248, 81, 73, 0.15)",
                                      color: "#f85149",
                                      border: "1px solid rgba(248, 81, 73, 0.3)",
                                      borderRadius: "4px",
                                      padding: "1px 6px",
                                      fontSize: "10.5px",
                                      fontWeight: 600,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                    }}
                                  >
                                    ⚠️ Não conectada
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      background: "rgba(46, 160, 67, 0.15)",
                                      color: "#3fb950",
                                      border: "1px solid rgba(46, 160, 67, 0.3)",
                                      borderRadius: "4px",
                                      padding: "1px 6px",
                                      fontSize: "10.5px",
                                      fontWeight: 600,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "3px",
                                    }}
                                  >
                                    ✓ Conectada
                                  </span>
                                )}
                              </div>
                              <div className="conta-pool-detalhes">
                                {c.env && Object.entries(c.env).length > 0 ? (
                                  <details style={{ fontSize: "11px", color: "var(--ink-4)" }}>
                                    <summary style={{ cursor: "pointer", userSelect: "none" }}>Perfil isolado</summary>
                                    <div style={{ marginTop: "3px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                      {Object.entries(c.env).map(([k, v]) => (
                                        <span key={k}>
                                          <code>{k}</code>={v}
                                        </span>
                                      ))}
                                    </div>
                                  </details>
                                ) : (
                                  <span style={{ fontSize: "11px", color: "var(--ink-4)" }}>Perfil padrão</span>
                                )}
                                {c.lastLimitDetail && (
                                  <span style={{ color: "var(--alerta)" }}>Motivo: {c.lastLimitDetail}</span>
                                )}
                              </div>
                            </div>

                            <div className="conta-pool-acoes">
                              {c.status === "ocupada" && (
                                <button
                                  className="btn quiet"
                                  style={{ fontSize: "11px", padding: "2px 8px" }}
                                  title="Ir para o terminal onde esta conta está rodando"
                                  onClick={onFechar}
                                >
                                  {c.authenticated === false ? "Ir para terminal ↗" : "Ver terminal ↗"}
                                </button>
                              )}
                              {c.authenticated === false && c.status !== "ocupada" && (
                                <button
                                  className="btn solid"
                                  disabled={ocupado}
                                  style={{ fontSize: "11px", padding: "2px 8px", background: "#238636" }}
                                  title={`Abrir terminal e autenticar esta conta agora (${p.id} login)`}
                                  onClick={() =>
                                    guardado(async () => {
                                      await openLoginTerminal(p.id, c.id, missionId);
                                      onFechar();
                                    })
                                  }
                                >
                                  🔑 Conectar agora
                                </button>
                              )}
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

                      {/* Sessão de Onboarding Plug-and-Play Ativa */}
                      {onboardSessions[p.id] && (
                        <div
                          className={`onboard-card${
                            onboardSessions[p.id]?.status === "success"
                              ? " sucesso"
                              : onboardSessions[p.id]?.status === "error"
                              ? " erro"
                              : ""
                          }`}
                        >
                          <div className="onboard-topo">
                            <span
                              className={`onboard-status ${
                                onboardSessions[p.id]?.status === "waiting"
                                  ? "esperando"
                                  : onboardSessions[p.id]?.status === "configuring"
                                  ? "configurando"
                                  : onboardSessions[p.id]?.status === "success"
                                  ? "sucesso"
                                  : "erro"
                              }`}
                            >
                              {(onboardSessions[p.id]?.status === "waiting" ||
                                onboardSessions[p.id]?.status === "configuring") && (
                                <span className="onboard-pulse" />
                              )}
                              {onboardSessions[p.id]?.status === "waiting" && "Aguardando login no navegador..."}
                              {onboardSessions[p.id]?.status === "configuring" &&
                                (onboardSessions[p.id]?.stepLabel || "Configurando perfil isolado e trocando tokens...")}
                              {onboardSessions[p.id]?.status === "success" &&
                                `Conta adicionada com sucesso! (${onboardSessions[p.id]?.account?.label || "Google"})`}
                              {onboardSessions[p.id]?.status === "error" &&
                                (onboardSessions[p.id]?.error || "Falha na autenticação")}
                            </span>
                            <span className="onboard-detalhe">
                              Túnel Reverso: 127.0.0.1:{onboardSessions[p.id]?.loopbackPort}
                            </span>
                          </div>

                          <p className="onboard-desc">
                            {onboardSessions[p.id]?.status === "waiting" &&
                              "Uma nova guia foi aberta no navegador para login na Conta Google. Após autorizar, sua conta é conectada e isolada automaticamente no pool."}
                            {onboardSessions[p.id]?.status === "configuring" &&
                              "Credenciais recebidas via túnel local. Criando ambiente seguro e sincronizando com o Antigravity..."}
                            {onboardSessions[p.id]?.status === "success" &&
                              "Perfil configurado em diretório exclusivo. O Cockpit já atualizou as contas disponíveis."}
                            {onboardSessions[p.id]?.status === "error" &&
                              "Ocorreu um erro durante a autorização ou o tempo limite de 5 minutos expirou."}
                          </p>

                          <div className="onboard-acoes">
                            {onboardSessions[p.id]?.status === "waiting" && (
                              <>
                                <button
                                  className="btn quiet"
                                  style={{ fontSize: "11px" }}
                                  onClick={() => {
                                    try {
                                      window.open(onboardSessions[p.id]!.authUrl, "_blank", "noopener,noreferrer");
                                    } catch {}
                                  }}
                                >
                                  Abrir navegador novamente
                                </button>
                                <button
                                  className="onboard-manual-toggle"
                                  onClick={() =>
                                    setOnboardSessions((prev) => {
                                      const cur = prev[p.id];
                                      if (!cur) return prev;
                                      return { ...prev, [p.id]: { ...cur, showManual: !cur.showManual } };
                                    })
                                  }
                                >
                                  {onboardSessions[p.id]?.showManual
                                    ? "Ocultar modo manual ▲"
                                    : "Está em VPS ou o redirecionamento falhou? Cole a URL ▼"}
                                </button>
                              </>
                            )}

                            <span className="spacer" />

                            <button
                              className="btn quiet"
                              style={{ fontSize: "11px" }}
                              onClick={() => cancelarOnboarding(p.id, onboardSessions[p.id]!.sessionId)}
                            >
                              {onboardSessions[p.id]?.status === "success" ? "Fechar" : "Cancelar"}
                            </button>
                          </div>

                          {onboardSessions[p.id]?.showManual && onboardSessions[p.id]?.status === "waiting" && (
                            <div className="onboard-manual-caixa">
                              <span style={{ fontSize: "11px", color: "var(--ink-2)" }}>
                                Cole a URL final da barra de endereços (ou o código de autorização):
                              </span>
                              <div className="onboard-manual-linha">
                                <input
                                  className="campo"
                                  style={{ fontSize: "11px", flex: 1 }}
                                  placeholder="http://127.0.0.1:.../callback?code=... ou código 4/..."
                                  value={onboardSessions[p.id]?.manualInput ?? ""}
                                  onChange={(e) =>
                                    setOnboardSessions((prev) => {
                                      const cur = prev[p.id];
                                      if (!cur) return prev;
                                      return { ...prev, [p.id]: { ...cur, manualInput: e.target.value } };
                                    })
                                  }
                                />
                                <button
                                  className="btn solid"
                                  disabled={
                                    onboardSessions[p.id]?.submittingManual ||
                                    !onboardSessions[p.id]?.manualInput?.trim()
                                  }
                                  style={{ fontSize: "11px" }}
                                  onClick={() =>
                                    enviarCallbackManual(
                                      p.id,
                                      onboardSessions[p.id]!.sessionId,
                                      onboardSessions[p.id]!.manualInput!
                                    )
                                  }
                                >
                                  {onboardSessions[p.id]?.submittingManual ? "Verificando..." : "Confirmar"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {!onboardSessions[p.id] && (
                        p.id === "agy" ? (
                          <button
                            className="btn solid"
                            disabled={ocupado}
                            style={{ alignSelf: "flex-start", fontSize: "12px", marginTop: "4px" }}
                            onClick={() => iniciarOnboardingAgy(p.id)}
                          >
                            + Adicionar conta ao pool (Login Google)
                          </button>
                        ) : (
                          novaConta[p.id] ? (
                          <div
                            className="form-inline"
                            style={{
                              marginTop: "8px",
                              background: "rgba(255, 255, 255, 0.03)",
                              padding: "12px",
                              borderRadius: "6px",
                              border: "1px solid var(--borda, rgba(255, 255, 255, 0.1))",
                              display: "flex",
                              flexDirection: "column",
                              gap: "8px",
                              width: "100%",
                              boxSizing: "border-box",
                            }}
                          >
                            <span style={{ fontSize: "12px", color: "var(--ink-1)", fontWeight: 600 }}>
                              Conectar nova conta de {p.id.toUpperCase()}
                            </span>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center", width: "100%" }}>
                              <input
                                className="campo"
                                placeholder="Nome / Identificador (ex: Pessoal, Trabalho)"
                                value={novaConta[p.id]?.label ?? ""}
                                style={{ flex: 1 }}
                                autoFocus
                                onChange={(e) =>
                                  setNovaConta((st) => ({
                                    ...st,
                                    [p.id]: { ...(st[p.id] || { id: "", label: "", envKey: "", envVal: "" }), label: e.target.value },
                                  }))
                                }
                              />
                            </div>

                            {novaConta[p.id]?.envKey && (
                              <details style={{ fontSize: "11px", color: "var(--ink-4)", marginTop: "4px" }}>
                                <summary style={{ cursor: "pointer", userSelect: "none" }}>Opções avançadas (personalizar diretório isolado)</summary>
                                <div style={{ marginTop: "6px" }}>
                                  <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", color: "var(--ink-3)" }}>
                                    <span>
                                      Pasta isolada (<code>{novaConta[p.id]?.envKey}</code>):
                                    </span>
                                    <input
                                      className="campo"
                                      style={{ fontSize: "11px" }}
                                      value={novaConta[p.id]?.envVal ?? ""}
                                      onChange={(e) =>
                                        setNovaConta((st) => ({
                                          ...st,
                                          [p.id]: {
                                            ...(st[p.id] || { id: "", label: "", envKey: "", envVal: "" }),
                                            envVal: e.target.value,
                                          },
                                        }))
                                      }
                                    />
                                  </label>
                                </div>
                              </details>
                            )}

                            <div className="form-acoes" style={{ marginTop: "6px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                              <button
                                className="btn solid"
                                disabled={ocupado || !novaConta[p.id]?.label.trim()}
                                style={{ background: "#238636", color: "#fff", fontWeight: 600, fontSize: "12px" }}
                                title="Salva e abre o terminal de login na hora"
                                onClick={() =>
                                  guardado(async () => {
                                    const item = novaConta[p.id]!;
                                    const env: Record<string, string> = {};
                                    if (item.envKey && item.envVal.trim()) {
                                      env[item.envKey] = item.envVal.trim();
                                    }
                                    await addAccountToPool(p.id, {
                                      id: item.id.trim(),
                                      label: item.label.trim(),
                                      env: Object.keys(env).length > 0 ? env : undefined,
                                    });
                                    setNovaConta((st) => ({ ...st, [p.id]: null }));
                                    await openLoginTerminal(p.id, item.id.trim(), missionId);
                                    onFechar();
                                  })
                                }
                              >
                                🔑 Conectar conta agora
                              </button>
                              <button
                                className="btn quiet"
                                disabled={ocupado || !novaConta[p.id]?.label.trim()}
                                style={{ fontSize: "11px" }}
                                title="Salva a conta no pool sem abrir o login imediatamente"
                                onClick={() =>
                                  guardado(async () => {
                                    const item = novaConta[p.id]!;
                                    const env: Record<string, string> = {};
                                    if (item.envKey && item.envVal.trim()) {
                                      env[item.envKey] = item.envVal.trim();
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
                                Salvar sem conectar
                              </button>
                              <button
                                className="btn quiet"
                                style={{ fontSize: "11px" }}
                                onClick={() => setNovaConta((st) => ({ ...st, [p.id]: null }))}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="btn solid"
                            style={{ alignSelf: "flex-start", fontSize: "12px", marginTop: "4px" }}
                            onClick={() => {
                              const used = new Set((p.pool?.contas ?? []).map((c) => c.id));
                              let nextNum = 1;
                              for (const c of p.pool?.contas ?? []) {
                                const m = new RegExp(`^${p.id}-(\\d+)$`).exec(c.id);
                                if (m) nextNum = Math.max(nextNum, parseInt(m[1], 10) + 1);
                              }
                              while (used.has(`${p.id}-${nextNum}`)) nextNum++;
                              const defaultKey =
                                p.id === "codex" ? "CODEX_HOME" : p.id === "grok" ? "GROK_HOME" : "CLI_HOME";
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
                            + Conectar nova conta ao pool
                          </button>
                        )
                        )
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
