import { useState } from "react";
import { Config } from "./Config.tsx";
import { Skills } from "./Skills.tsx";
import { Marketplace } from "./Marketplace.tsx";
import { Receitas } from "./Receitas.tsx";
import { Media } from "./Media.tsx";
import { Gratis } from "./Gratis.tsx";
import { DshApis } from "./DshApis.tsx";
import type { Colunas } from "./PaneGrid.tsx";
import type { AgentSpec, SquadSpec, TipoTarefa } from "./api.ts";

/**
 * Tudo o que se configura mora atrás de uma engrenagem só.
 *
 * A ordem das abas segue o caminho de quem chega: primeiro conecto os
 * provedores que já pago, depois ligo os de graça, pego skills no
 * marketplace, olho o acervo, guardo as formações que funcionaram e por fim
 * ligo o que gera imagem e vídeo. Tela fica por último: é preferência de
 * quem já está trabalhando, e saiu da tela principal justamente para não
 * disputar espaço com o terminal.
 */

type Aba = "provedores" | "dsh-apis" | "gratis" | "marketplace" | "skills" | "receitas" | "media" | "tela";

const ABAS: { id: Aba; label: string }[] = [
  { id: "provedores", label: "Provedores" },
  { id: "dsh-apis", label: "APIs DSH" },
  { id: "gratis", label: "Grátis" },
  { id: "marketplace", label: "Marketplace" },
  { id: "skills", label: "Skills" },
  { id: "receitas", label: "Receitas" },
  { id: "media", label: "Media" },
  { id: "tela", label: "Tela" },
];

export function Ajustes({
  inicial,
  agents,
  squads,
  tarefas,
  colunas,
  onColunas,
  onFechar,
  onMudou,
  missionId,
}: {
  inicial?: Aba;
  agents: Record<string, AgentSpec>;
  squads: Record<string, SquadSpec>;
  tarefas: Record<string, TipoTarefa>;
  colunas: Colunas;
  onColunas: (colunas: Colunas) => void;
  onFechar: () => void;
  onMudou: () => void;
  missionId?: string;
}) {
  const [aba, setAba] = useState<Aba>(inicial ?? "provedores");

  return (
    <div className="ajustes">
      <nav className="abas" role="tablist" aria-label="Ajustes">
        <div className="abas-scroll">
          {ABAS.map((a) => (
            <button
              key={a.id}
              role="tab"
              aria-selected={aba === a.id}
              className={`aba${aba === a.id ? " on" : ""}`}
              onClick={() => setAba(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="icon-btn fechar-modal-btn" onClick={onFechar} aria-label="Fechar ajustes" title="Fechar">
          ✕
        </button>
      </nav>

      <div className="aba-corpo" role="tabpanel">
        {aba === "provedores" && (
          <Config
            onFechar={onFechar}
            onMudou={onMudou}
            missionId={missionId}
            onAbrirDshApis={() => setAba("dsh-apis")}
          />
        )}
        {aba === "dsh-apis" && <DshApis onMudou={onMudou} />}
        {aba === "gratis" && <Gratis onMudou={onMudou} />}
        {aba === "marketplace" && <Marketplace onMudou={onMudou} />}
        {aba === "skills" && <Skills agents={agents} />}
        {aba === "receitas" && (
          <Receitas agents={agents} squads={squads} tarefas={tarefas} onMudou={onMudou} />
        )}
        {aba === "media" && <Media />}
        {aba === "tela" && (
          <div className="wizard-corpo">
            <div className="campo-bloco">
              <span className="rotulo">Colunas de terminal</span>
              <p className="dica">
                No automático, um agente sozinho usa a tela toda, até quatro dividem em duas
                colunas e daí em diante são três. Fixe um número se preferir sempre o mesmo
                arranjo.
              </p>
              <span className="cols" role="group" aria-label="Colunas dos terminais">
                {(["auto", "1", "2", "3"] as const).map((c) => (
                  <button
                    key={c}
                    className={colunas === c ? "on" : undefined}
                    aria-pressed={colunas === c}
                    onClick={() => onColunas(c)}
                  >
                    {c === "auto" ? "Auto" : c}
                  </button>
                ))}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
