import { useEffect, useState } from "react";
import {
  apagarReceita,
  fetchReceitas,
  salvarReceita,
  type AgentSpec,
  type Receita,
  type SquadSpec,
  type TipoTarefa,
} from "./api.ts";

/**
 * Receitas: formações prontas.
 *
 * Um squad diz quem trabalha em qual fase. Uma receita diz com o quê: modo,
 * agente, tipo de tarefa, modelo e esforço já resolvidos para um tipo de
 * objetivo. No assistente ela adianta os campos que cobre.
 *
 * As da casa não se apagam nem se sobrescrevem — ficam de referência. As suas
 * saem de missões que deram certo.
 */

const VAZIA: Receita & { id: string } = {
  id: "",
  label: "",
  descricao: "",
  modo: "livre",
  agent: "",
  squad: "",
  tipo: "",
  paineis: 2,
};

export function Receitas({
  agents,
  squads,
  tarefas,
  onMudou,
}: {
  agents: Record<string, AgentSpec>;
  squads: Record<string, SquadSpec>;
  tarefas: Record<string, TipoTarefa>;
  onMudou: () => void;
}) {
  const [receitas, setReceitas] = useState<Record<string, Receita>>({});
  const [editando, setEditando] = useState<(Receita & { id: string }) | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = () =>
    fetchReceitas().then(
      (d) => setReceitas(d.receitas ?? {}),
      (e: Error) => setErro(e.message),
    );

  useEffect(() => {
    void recarregar();
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

  const daCasa = Object.entries(receitas).filter(([, r]) => r.daCasa);
  const minhas = Object.entries(receitas).filter(([, r]) => !r.daCasa);

  const cartao = ([id, r]: [string, Receita]) => (
    <div key={id} className="receita">
      <div className="receita-topo">
        <b>{r.label}</b>
        {r.daCasa && <span className="tipo-chip">da casa</span>}
        <span className="spacer" />
        {!r.daCasa && (
          <button
            className="icon-btn apagar"
            disabled={ocupado}
            title="apagar receita"
            onClick={() => guardado(() => apagarReceita(id).then(() => undefined))}
          >
            ✕
          </button>
        )}
      </div>
      <p className="receita-desc">{r.descricao}</p>
      <div className="receita-pecas">
        <span title="modo da missão">{r.modo ?? "livre"}</span>
        {r.squad && <span title="time">{squads[r.squad]?.label ?? r.squad}</span>}
        {r.agent && <span title="agente">{agents[r.agent]?.label ?? r.agent}</span>}
        {r.tipo && (
          <span className="peca-tipo" title="tipo da tarefa — descreve trabalho; agente escolhe modelo e esforço">
            {tarefas[r.tipo]?.label ?? r.tipo}
          </span>
        )}
        {r.paineis && <span title="painéis">{r.paineis}×</span>}
        {r.model && <span title="modelo fixado">{r.model}</span>}
      </div>
    </div>
  );

  if (editando) {
    return (
      <div className="wizard-corpo">
        {erro && <div className="aviso">{erro}<button onClick={() => setErro(null)}>✕</button></div>}
        <div className="form-grade">
          <label className="campo-bloco">
            <span className="rotulo">Id <em>— sem espaço</em></span>
            <input className="campo" autoFocus value={editando.id} onChange={(e) => setEditando({ ...editando, id: e.target.value })} placeholder="revisar-api" />
          </label>
          <label className="campo-bloco">
            <span className="rotulo">Nome</span>
            <input className="campo" value={editando.label} onChange={(e) => setEditando({ ...editando, label: e.target.value })} placeholder="Revisar a API" />
          </label>
        </div>
        <label className="campo-bloco">
          <span className="rotulo">Para que serve <em>— quando escolher esta e não outra</em></span>
          <input className="campo" value={editando.descricao} onChange={(e) => setEditando({ ...editando, descricao: e.target.value })} />
        </label>
        <div className="form-grade">
          <label className="campo-bloco">
            <span className="rotulo">Modo</span>
            <select className="picker" value={editando.modo} onChange={(e) => setEditando({ ...editando, modo: e.target.value })}>
              <option value="livre">Livre</option>
              <option value="squad">Time</option>
              <option value="agentico">Agêntico</option>
            </select>
          </label>
          {editando.modo === "squad" ? (
            <label className="campo-bloco">
              <span className="rotulo">Time</span>
              <select className="picker" value={editando.squad} onChange={(e) => setEditando({ ...editando, squad: e.target.value })}>
                <option value="">—</option>
                {Object.entries(squads).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
              </select>
            </label>
          ) : (
            <label className="campo-bloco">
              <span className="rotulo">Agente</span>
              <select className="picker" value={editando.agent} onChange={(e) => setEditando({ ...editando, agent: e.target.value })}>
                <option value="">—</option>
                {Object.entries(agents).map(([id, a]) => <option key={id} value={id}>{a.label}</option>)}
              </select>
            </label>
          )}
          <label className="campo-bloco">
            <span className="rotulo">Tipo da tarefa</span>
            <select className="picker" value={editando.tipo} onChange={(e) => setEditando({ ...editando, tipo: e.target.value })}>
              <option value="">— deixar o harness decidir pelo agente</option>
              {Object.entries(tarefas).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
            </select>
          </label>
          <label className="campo-bloco">
            <span className="rotulo">Painéis</span>
            <select className="picker" value={String(editando.paineis ?? 2)} onChange={(e) => setEditando({ ...editando, paineis: Number(e.target.value) })}>
              {[1, 2, 4, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <p className="ressalva">
          Deixe o tipo preenchido e o modelo em branco: perfil do agente continua valendo se você
          trocar de provedor, porque quem escolhe o modelo é o harness.
        </p>
        <div className="form-acoes">
          <button className="btn quiet" onClick={() => setEditando(null)}>Cancelar</button>
          <button
            className="btn solid"
            disabled={ocupado || !editando.id.trim() || !editando.label.trim()}
            onClick={() =>
              guardado(async () => {
                const { id, ...resto } = editando;
                await salvarReceita(id.trim().toLowerCase(), resto);
                setEditando(null);
              })
            }
          >
            Salvar receita
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wizard-corpo">
      {erro && <div className="aviso">{erro}<button onClick={() => setErro(null)}>✕</button></div>}
      <div className="barra-acervo">
        <p className="dica sem-margem">
          Escolha uma receita na nova missão e os campos que ela cobre já vêm preenchidos.
        </p>
        <span className="spacer" />
        <button className="btn" onClick={() => setEditando({ ...VAZIA })}>Nova receita</button>
      </div>

      {minhas.length > 0 && (
        <div className="campo-bloco">
          <span className="rotulo">Minhas</span>
          <div className="grade-receitas">{minhas.map(cartao)}</div>
        </div>
      )}

      <div className="campo-bloco">
        <span className="rotulo">Da casa</span>
        <div className="grade-receitas">{daCasa.map(cartao)}</div>
      </div>
    </div>
  );
}
