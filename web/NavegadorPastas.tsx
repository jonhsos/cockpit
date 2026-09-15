import { useState, useEffect, useCallback } from "react";
import { listarDiretorios } from "./api.ts";
import { Icon } from "./Icon.tsx";

/**
 * Navegador de pastas embutido.
 *
 * Quando o sistema não tem seletor nativo (Linux sem zenity/kdialog), este
 * componente abre direto na interface: navega o filesystem pelo servidor,
 * sem dependência externa.
 */
export function NavegadorPastas({
  onEscolher,
  onCancelar,
}: {
  onEscolher: (caminho: string) => void;
  onCancelar: () => void;
}) {
  const [caminho, setCaminho] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [pai, setPai] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [digitado, setDigitado] = useState("");

  const navegar = useCallback((path?: string) => {
    setCarregando(true);
    listarDiretorios(path)
      .then((r) => {
        setCaminho(r.path);
        setDirs(r.dirs);
        setPai(r.parent);
        setDigitado(r.path);
      })
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    navegar();
  }, [navegar]);

  const irPara = () => {
    const alvo = digitado.trim();
    if (alvo) navegar(alvo);
  };

  return (
    <div className="ajustes janela" style={{ maxWidth: 520 }}>
      <nav className="abas">
        <span className="aba-titulo">
          <Icon name="folder" size={15} /> Escolher pasta
        </span>
        <span className="spacer" />
        <button className="icon-btn" onClick={onCancelar} aria-label="Cancelar" title="Cancelar">
          ✕
        </button>
      </nav>

      <div className="aba-corpo">
        <div className="wizard-corpo">
          <div className="campo-bloco">
            <span className="rotulo">Caminho</span>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="campo"
                value={digitado}
                onChange={(e) => setDigitado(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && irPara()}
                placeholder="/home/usuario/projeto"
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={irPara}>Ir</button>
            </div>
          </div>

          <div className="campo-bloco cresce">
            <div className="lista-skills" style={{ maxHeight: 320, overflowY: "auto" }}>
              {/* Botão para subir ao diretório pai */}
              {pai !== caminho && (
                <div className="linha">
                  <button className="linha-toque" onClick={() => navegar(pai)}>
                    <Icon name="arrow" size={13} /> <b>..</b>
                    <span className="caminho">{pai}</span>
                  </button>
                </div>
              )}

              {carregando && <p className="vazio-nota">Carregando…</p>}

              {!carregando && dirs.length === 0 && (
                <p className="vazio-nota">Nenhuma subpasta aqui.</p>
              )}

              {dirs.map((nome) => (
                <div key={nome} className="linha">
                  <button
                    className="linha-toque"
                    onClick={() => navegar(caminho + "/" + nome)}
                  >
                    <Icon name="folder" size={15} />
                    <b>{nome}</b>
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 8 }}>
            <button className="btn" onClick={onCancelar}>Cancelar</button>
            <button
              className="btn solid"
              onClick={() => onEscolher(caminho)}
              disabled={!caminho}
            >
              <Icon name="folder" size={13} /> Abrir esta pasta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
