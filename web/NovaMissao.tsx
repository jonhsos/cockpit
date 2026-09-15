import { useState } from "react";
import type { AgentSpec, Elenco, Provider, Receita, SquadSpec, TipoTarefa } from "./api.ts";

export type Modo = "livre" | "dirigido" | "autonomo" | "squad" | "agentico";

export type Plano = {
  nome: string;
  objetivo: string;
  modo: Modo;
  squad: string;
  agentes: string[];
  tipo: string;
  /** Receita usada, e as skills que ela trouxe para a missão inteira. */
  receita?: string;
  skills?: string[];
  /** Quais IAs esta missão libera, e em que configuração. */
  elenco?: Elenco;
};

/** O nome que se usa para falar do provedor, não o comando dele. */
const NOME_CLI: Record<string, string> = {
  claude: "Claude",
  codex: "GPT · Codex",
  agy: "Gemini · Antigravity",
  bash: "Terminal",
  grok: "Grok · xAI",
};

const nomeCli = (id: string) => NOME_CLI[id] ?? id;

/**
 * A receita diz QUEM entra; o modelo e o esforço que você já fixou continuam
 * seus. Substituir o elenco inteiro apagava em silêncio uma escolha explícita
 * — você escolhia o modelo, clicava na receita, e o pino sumia sem aviso.
 */
function juntarElenco(seu: Elenco, daReceita: Elenco): Elenco {
  const clis = daReceita.clis;
  const porCli: Record<string, { model?: string; effort?: string }> = {};
  for (const cli of clis) {
    const fixo = seu.porCli?.[cli] ?? daReceita.porCli?.[cli];
    if (fixo?.model || fixo?.effort) porCli[cli] = fixo;
  }
  return {
    clis,
    ...(Object.keys(porCli).length > 0 && { porCli }),
    ...(daReceita.soVisual?.length && { soVisual: daReceita.soVisual }),
  };
}

/**
 * Formações de elenco que já se sabe que funcionam. Cada uma é uma frase
 * inteira sobre como a missão vai rodar, não um atalho de configuração.
 */
const FORMACOES: { id: string; label: string; explica: string; monta: (ligados: string[]) => Elenco }[] = [
  {
    id: "claude-gpt",
    label: "Claude + GPT",
    explica: "Claude e GPT decidem e escrevem a tela. Gemini só entrega os arquivos de imagem.",
    monta: (ligados) => ({
      clis: ["claude", "codex", "agy"].filter((c) => ligados.includes(c)),
      soVisual: ligados.includes("agy") ? ["agy"] : [],
    }),
  },
  {
    id: "so-claude",
    label: "Só Claude",
    explica: "Nenhum outro provedor entra, nem como reserva.",
    monta: () => ({ clis: ["claude"] }),
  },
  {
    id: "tudo",
    label: "Todos",
    explica: "Todo provedor ligado pode receber qualquer tipo de trabalho.",
    monta: (ligados) => ({ clis: ligados }),
  },
];

const MODOS: { id: Modo; label: string; explica: string }[] = [
  { id: "livre", label: "Livre", explica: "Controle manual absoluto (padrão). Terminais abertos sob seu comando." },
  { id: "dirigido", label: "Dirigido", explica: "Maestro delega tarefas estritamente dentro da equipe e permissões definidas." },
  { id: "autonomo", label: "Autônomo", explica: "Maestro pode criar tarefas e instanciar painéis dentro do limite autorizado." },
];

const QUANTIDADES = [1, 2, 4, 8, 12];

/**
 * Um campo que a receita já respondeu. Vira uma linha, não some: você precisa
 * ver o que foi decidido por você, e poder discordar em um clique.
 */
function Resolvido({
  rotulo,
  valor,
  nota,
  onMudar,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  onMudar: () => void;
}) {
  return (
    <div className="resolvido">
      <span className="rotulo">{rotulo}</span>
      <b>{valor}</b>
      {nota && <span className="prov-cmd">{nota}</span>}
      <span className="spacer" />
      <button className="btn mini" onClick={onMudar}>mudar</button>
    </div>
  );
}

/**
 * Quem entra na missão. A pergunta não é "qual modelo é o melhor": é qual
 * trabalho cada provedor tem o direito de pegar. Sem isto o Gemini acabava
 * escrevendo front-end porque era o agente que estava livre.
 */
function Elencar({
  providers,
  elenco,
  onMudar,
}: {
  providers: Provider[];
  elenco: Elenco;
  onMudar: (e: Elenco) => void;
}) {
  const ligados = providers.filter((p) => p.disponivel && p.id !== "bash");
  const dentro = (cli: string) => elenco.clis.includes(cli);
  const soVisual = (cli: string) => (elenco.soVisual ?? []).includes(cli);

  const alternar = (cli: string) => {
    const clis = dentro(cli) ? elenco.clis.filter((c) => c !== cli) : [...elenco.clis, cli];
    onMudar({
      ...elenco,
      clis,
      soVisual: (elenco.soVisual ?? []).filter((c) => clis.includes(c)),
    });
  };

  const alternarVisual = (cli: string) => {
    const atual = elenco.soVisual ?? [];
    onMudar({ ...elenco, soVisual: soVisual(cli) ? atual.filter((c) => c !== cli) : [...atual, cli] });
  };

  const fixar = (cli: string, campo: "model" | "effort", valor: string) => {
    const anterior = elenco.porCli?.[cli] ?? {};
    const novo = { ...anterior, [campo]: valor || undefined };
    const porCli = { ...(elenco.porCli ?? {}), [cli]: novo };
    if (!novo.model && !novo.effort) delete porCli[cli];
    onMudar({ ...elenco, porCli });
  };

  return (
    <div className="campo-bloco">
      <span className="rotulo">
        Quais IAs entram{" "}
        <em>— o cockpit não abre painel fora desta lista; quem só gera imagem não escreve nem desenha a tela</em>
      </span>

      <div className="pilulas">
        {FORMACOES.map((f) => (
          <button
            key={f.id}
            className="pilula"
            title={f.explica}
            onClick={() => onMudar(f.monta(ligados.map((p) => p.id)))}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="elenco">
        {ligados.map((p) => {
          const fixo = elenco.porCli?.[p.id] ?? {};
          return (
            <div key={p.id} className={`elenco-linha${dentro(p.id) ? " on" : ""}`}>
              <button className="elenco-nome" onClick={() => alternar(p.id)}>
                <i />
                <b>{nomeCli(p.id)}</b>
              </button>

              {dentro(p.id) && (
                <div className="elenco-ajuste">
                  <select
                    className="campo mini"
                    value={fixo.model ?? ""}
                    onChange={(e) => fixar(p.id, "model", e.target.value)}
                    title="modelo fixo, ou perfil do agente escolhido"
                  >
                    <option value="">modelo: pelo agente escolhido</option>
                    {(p.modelos ?? []).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>

                  <select
                    className="campo mini"
                    value={fixo.effort ?? ""}
                    onChange={(e) => fixar(p.id, "effort", e.target.value)}
                    title="esforço fixo, ou perfil do agente escolhido"
                  >
                    <option value="">esforço: pelo agente escolhido</option>
                    {(p.efforts ?? []).map((e) => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </select>

                  <button
                    className={`pilula${soVisual(p.id) ? " on" : ""}`}
                    onClick={() => alternarVisual(p.id)}
                    title="só produz arquivos de imagem, vídeo e áudio que vão dentro do produto — não desenha telas nem decide layout"
                  >
                    só gera imagem
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {elenco.clis.length === 0 && (
        <p className="dica">Nenhuma IA escolhida: a missão vai usar o provedor do catálogo de cada agente.</p>
      )}
      {elenco.clis.length > 0 && elenco.clis.every((c) => (elenco.soVisual ?? []).includes(c)) && (
        <p className="dica">Todo mundo está marcado como "só gera imagem" — ninguém sobra para escrever código.</p>
      )}
    </div>
  );
}

export function NovaMissao({
  agents,
  squads,
  tarefas,
  providers,
  receitas,
  onCriar,
  onCancelar,
}: {
  agents: Record<string, AgentSpec>;
  squads: Record<string, SquadSpec>;
  tarefas: Record<string, TipoTarefa>;
  providers: Provider[];
  receitas: Record<string, Receita>;
  onCriar: (plano: Plano) => void;
  onCancelar: () => void;
}) {
  const ligados = new Set(providers.filter((p) => p.disponivel).map((p) => p.id));

  const [nome, setNome] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [modo, setModo] = useState<Modo>("livre");
  const [squad, setSquad] = useState(Object.keys(squads)[0] ?? "");
  const [tipo, setTipo] = useState("");
  const [quantos, setQuantos] = useState(2);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  // O padrão já é a regra que se quer no dia a dia: Claude e GPT constroem,
  // Gemini só desenha. Quem quiser outra coisa muda em dois cliques.
  const [elenco, setElenco] = useState<Elenco>(() => {
    const disponiveis = providers.filter((p) => p.disponivel && p.id !== "bash").map((p) => p.id);
    return {
      clis: ["claude", "codex", "agy"].filter((c) => disponiveis.includes(c)),
      soVisual: disponiveis.includes("agy") ? ["agy"] : [],
    };
  });
  const [receita, setReceita] = useState("");
  /** Campos que a receita respondeu: somem do formulário para não repetir. */
  const [cobertos, setCobertos] = useState<Set<string>>(new Set());

  const usarReceita = (id: string, r: Receita) => {
    setReceita(id);
    const respondidos = new Set<string>();
    if (r.modo) { setModo(r.modo as Modo); respondidos.add("modo"); }
    if (r.squad) { setSquad(r.squad); respondidos.add("squad"); }
    if (r.tipo) { setTipo(r.tipo); respondidos.add("tipo"); }
    if (r.paineis) { setQuantos(r.paineis); respondidos.add("paineis"); }
    if (r.agent) { setEscolhidos([r.agent]); respondidos.add("agentes"); }
    if (r.elenco) setElenco((atual) => juntarElenco(atual, r.elenco!));
    setCobertos(respondidos);
  };

  const cobre = (campo: string) => cobertos.has(campo);

  // Só aparece quem pode mesmo abrir: provedor instalado e dentro do elenco.
  // Mostrar um agente que o servidor vai trocar de provedor é mentir na tela.
  const usaveis = Object.entries(agents).filter(
    ([, a]) => ligados.has(a.cli) && (elenco.clis.length === 0 || elenco.clis.includes(a.cli)),
  );

  const alternar = (id: string) =>
    setEscolhidos((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  // No modo livre você diz quantos painéis quer; a escolha manual manda.
  const agentesFinais =
    modo === "autonomo" || modo === "agentico"
      ? ["maestro"]
      : modo === "dirigido"
        ? (escolhidos.length > 0 ? escolhidos : ["maestro"])
        : modo === "squad"
          ? (squads[squad]?.fases[0]?.agentes ?? [])
          : escolhidos.length > 0
            ? escolhidos
            : usaveis.slice(0, quantos).map(([id]) => id);

  const pronto = nome.trim().length > 0 && (modo !== "squad" || squad !== "");

  return (
    <div className="wizard">
      <header className="wizard-topo">
        <h2>Nova missão</h2>
        <button className="btn quiet" onClick={onCancelar} aria-label="Fechar nova missão">
          ✕
        </button>
      </header>

      <div className="wizard-corpo">
        {/* A receita responde o que já se sabe; o resto do formulário some. */}
        {Object.keys(receitas).length > 0 && (
          <div className="campo-bloco">
            <span className="rotulo">
              Receita <em>— uma formação já provada. Preenche o que cobre; você completa o resto.</em>
            </span>
            <div className="cartas receitas-linha">
              <button
                className={`carta${receita === "" ? " on" : ""}`}
                onClick={() => { setReceita(""); setCobertos(new Set()); }}
              >
                <b>Do zero</b>
                <span>Escolher tudo na mão.</span>
              </button>
              {Object.entries(receitas).map(([id, r]) => (
                <button
                  key={id}
                  className={`carta${receita === id ? " on" : ""}`}
                  onClick={() => usarReceita(id, r)}
                >
                  <b>{r.label}</b>
                  <span>{r.descricao}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="campo-bloco">
          <span className="rotulo">Nome</span>
          <input
            className="campo"
            autoFocus
            placeholder="auth-refactor"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </label>

        <label className="campo-bloco">
          <span className="rotulo">Objetivo</span>
          <textarea
            className="campo area"
            rows={3}
            placeholder="o que precisa ser feito — vai no prompt de todo agente desta missão"
            value={objetivo}
            onChange={(e) => setObjetivo(e.target.value)}
          />
        </label>

        <Elencar providers={providers} elenco={elenco} onMudar={setElenco} />

        {cobre("modo") ? (
          <Resolvido
            rotulo="Modo"
            valor={MODOS.find((m) => m.id === modo)?.label ?? modo}
            onMudar={() => setCobertos((p) => new Set([...p].filter((x) => x !== "modo")))}
          />
        ) : (
        <div className="campo-bloco">
          <span className="rotulo">Modo</span>
          <div className="cartas">
            {MODOS.map((m) => (
              <button
                key={m.id}
                className={`carta${modo === m.id ? " on" : ""}`}
                onClick={() => setModo(m.id)}
              >
                <b>{m.label}</b>
                <span>{m.explica}</span>
              </button>
            ))}
          </div>
        </div>
        )}

        {(modo === "autonomo" || modo === "agentico") && (
          <p className="ressalva">
            Modo Autônomo: O Maestro coordena a missão e instancia painéis conforme o escopo concedido.
          </p>
        )}
        {modo === "dirigido" && (
          <p className="ressalva">
            Modo Dirigido: O Maestro delega tarefas exclusivamente para a equipe de agentes selecionada abaixo.
          </p>
        )}
        {modo === "squad" && cobre("squad") && (
          <Resolvido
            rotulo="Time"
            valor={squads[squad]?.label ?? squad}
            onMudar={() => setCobertos((p) => new Set([...p].filter((x) => x !== "squad")))}
          />
        )}
        {modo === "squad" && !cobre("squad") && (
          <div className="campo-bloco">
            <span className="rotulo">Time</span>
            <div className="cartas">
              {Object.entries(squads).map(([id, s]) => (
                <button
                  key={id}
                  className={`carta${squad === id ? " on" : ""}`}
                  onClick={() => setSquad(id)}
                >
                  <b>{s.label}</b>
                  <span>{s.descricao}</span>
                  <span className="fases-mini">
                    {s.fases.map((f) => f.nome).join(" → ")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {(modo === "livre" || modo === "dirigido") && (
          <>
            <div className="campo-bloco">
              <span className="rotulo">Quantos painéis abrir agora</span>
              <div className="pilulas">
                {QUANTIDADES.map((n) => (
                  <button
                    key={n}
                    className={`pilula${quantos === n && escolhidos.length === 0 ? " on" : ""}`}
                    onClick={() => {
                      setQuantos(n);
                      setEscolhidos([]);
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="campo-bloco">
              <span className="rotulo">
                Ou escolha quem entra
                {escolhidos.length > 0 && ` · ${escolhidos.length} selecionados`}
              </span>
              <div className="agentes">
                {usaveis.map(([id, a]) => (
                  <button
                    key={id}
                    className={`agente${escolhidos.includes(id) ? " on" : ""}`}
                    onClick={() => alternar(id)}
                    style={{ ["--cor" as string]: a.cor }}
                    title={a.papel ?? ""}
                  >
                    <i />
                    <b>{a.label}</b>
                    <span>{a.papel ?? a.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {modo !== "squad" && cobre("tipo") && (
          <Resolvido
            rotulo="Tipo do trabalho"
            valor={tarefas[tipo]?.label ?? tipo}
            nota="decide modelo e esforço"
            onMudar={() => setCobertos((p) => new Set([...p].filter((x) => x !== "tipo")))}
          />
        )}
        {modo !== "squad" && !cobre("tipo") && (
          <div className="campo-bloco">
            <span className="rotulo">
              Tipo do trabalho <em>— organiza contexto; agente escolhido mantém modelo e esforço</em>
            </span>
            <div className="pilulas">
              <button
                className={`pilula${tipo === "" ? " on" : ""}`}
                onClick={() => setTipo("")}
                title="Cada agente usa o modelo do próprio catálogo"
              >
                padrão
              </button>
              {Object.entries(tarefas).map(([id, t]) => (
                <button
                  key={id}
                  className={`pilula${tipo === id ? " on" : ""}`}
                  onClick={() => setTipo(id)}
                  title={`${t.descricao} → ${t.model ?? t.cli ?? ""} ${t.effort ?? ""}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tipo && tarefas[tipo] && (
              <p className="dica">
                {tarefas[tipo]!.descricao}. O provedor de cada agente é mantido;
                modelo e esforço são ajustados quando há uma configuração compatível.
              </p>
            )}
          </div>
        )}

        <p className="resumo">
          {agentesFinais.length === 0
            ? "nenhum painel vai abrir"
            : `vai abrir: ${agentesFinais.map((id) => agents[id]?.label ?? id).join(", ")}`}
        </p>
      </div>

      <footer className="wizard-pe">
        <button className="btn quiet" onClick={onCancelar}>
          Cancelar
        </button>
        <button
          className="btn solid"
          disabled={!pronto}
          onClick={() =>
            onCriar({
              nome: nome.trim(),
              objetivo: objetivo.trim(),
              modo,
              squad,
              agentes: agentesFinais,
              tipo,
              receita: receita || undefined,
              skills: receitas[receita]?.skills,
              elenco: elenco.clis.length > 0 ? elenco : undefined,
            })
          }
        >
          Criar missão
        </button>
      </footer>
    </div>
  );
}
