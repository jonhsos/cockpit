import { type CSSProperties } from "react";

/**
 * Mascote do agente: um corpo simples com um rosto.
 *
 * O modelo vem do bloub (bloub.vercel.app): uma forma, uma expressão, uma cor
 * e uma animação discreta. O desenho é nosso — SVG próprio, sem dependência
 * externa nem geração de imagem.
 *
 * Duas regras que valem mais que o estilo:
 *
 * 1. A forma é determinística pelo id do agente, nunca pela posição na lista.
 *    O mesmo agente é o mesmo bicho em toda sessão, em qualquer missão.
 * 2. A expressão vem do estado real do painel — em atividade, sem atividade
 *    recente, encerrado ou sem conexão. Nada aqui inventa "terminei" ou
 *    "preciso de você": esse dado não existe no servidor.
 */

/**
 * "neutro" é o catálogo: um agente que ainda não entrou em missão não tem
 * estado nenhum, e não pode fingir que está trabalhando. Acordado e sem
 * opinião é o retrato honesto disso.
 */
export type EstadoMascote =
  | "run"
  | "idle"
  | "dead"
  | "off"
  | "neutro"
  | "starting"
  | "waiting-user"
  | "working"
  | "blocked"
  | "review"
  | "completed"
  | "failed";

const FORMAS = ["circulo", "seixo", "squircle", "capsula", "hexagono", "gota"] as const;

/** Corpos em viewBox 0 0 100 100. Todos ocupam a mesma caixa óptica. */
const CORPOS: Record<(typeof FORMAS)[number], string> = {
  circulo: "M50 8a42 42 0 1 1 0 84a42 42 0 1 1 0-84z",
  seixo: "M54 6c21 2 38 17 38 37c0 23-13 41-33 48c-19 7-40-3-48-21C4 54 6 32 20 18C28 10 41 5 54 6z",
  squircle: "M50 8c29 0 42 13 42 42s-13 42-42 42S8 79 8 50 21 8 50 8z",
  capsula: "M50 6c17 0 28 11 28 28v32c0 17-11 28-28 28S22 83 22 66V34C22 17 33 6 50 6z",
  hexagono: "M50 6l34 20c5 3 8 8 8 14v20c0 6-3 11-8 14L50 94l-34-20c-5-3-8-8-8-14V40c0-6 3-11 8-14z",
  gota: "M50 6c22 14 36 30 36 47a36 36 0 0 1-72 0C14 36 28 20 50 6z",
};

/** Hash estável: mesma string, mesma forma, em qualquer máquina e sessão. */
function forma(semente: string): (typeof FORMAS)[number] {
  let n = 0;
  for (let i = 0; i < semente.length; i++) n = (n * 31 + semente.charCodeAt(i)) >>> 0;
  return FORMAS[n % FORMAS.length];
}

export function Mascote({ semente, cor, estado, tamanho = 22, titulo }: {
  semente: string;
  cor: string;
  estado: EstadoMascote;
  tamanho?: number;
  titulo?: string;
}) {
  const corpo = CORPOS[forma(semente)];
  const normEstado =
    estado === "working" || estado === "run" || estado === "starting" || estado === "review"
      ? "run"
      : estado === "waiting-user" || estado === "idle" || estado === "completed"
      ? "idle"
      : estado === "dead" || estado === "failed"
      ? "dead"
      : estado === "blocked"
      ? "idle"
      : estado;

  // Encerrado e sem conexão não têm cor de identidade: um agente morto não
  // pode parecer vivo só porque a cor dele é bonita.
  const apagado = normEstado === "dead" || normEstado === "off";
  const olhosFechados = normEstado === "idle";

  return (
    <svg
      className={`mascote e-${estado}`}
      viewBox="0 0 100 100"
      width={tamanho}
      height={tamanho}
      style={{ "--identity": cor } as CSSProperties}
      role={titulo ? "img" : undefined}
      aria-label={titulo}
      aria-hidden={titulo ? undefined : true}
    >
      <g className="mascote-corpo">
        <path className="mascote-pele" d={corpo} fill={apagado ? "#3a3a3a" : cor} />
        {/* Um brilho no alto dá volume sem precisar de gradiente com id único.
            Pequeno de propósito: tem que caber dentro do corpo mais estreito
            da lista (cápsula e gota), sem vazar pela borda. */}
        <ellipse className="mascote-brilho" cx="43" cy="33" rx="14" ry="9" fill="#fff" opacity={apagado ? 0.05 : 0.16} />

        <g className="mascote-rosto" fill="#151515">
          {olhosFechados ? (
            <>
              <path d="M28 50q8 8 16 0" stroke="#151515" strokeWidth="5" strokeLinecap="round" fill="none" />
              <path d="M56 50q8 8 16 0" stroke="#151515" strokeWidth="5" strokeLinecap="round" fill="none" />
            </>
          ) : apagado ? (
            <>
              <path d="M29 52h14" stroke="#151515" strokeWidth="5" strokeLinecap="round" />
              <path d="M57 52h14" stroke="#151515" strokeWidth="5" strokeLinecap="round" />
            </>
          ) : (
            <>
              <ellipse className="mascote-olho" cx="36" cy="48" rx="7" ry="8" />
              <ellipse className="mascote-olho" cx="64" cy="48" rx="7" ry="8" />
            </>
          )}

          {estado === "run" ? (
            <path className="mascote-boca" d="M38 66q12 12 24 0" stroke="#151515" strokeWidth="5" strokeLinecap="round" fill="none" />
          ) : olhosFechados ? (
            <path d="M43 68q7 5 14 0" stroke="#151515" strokeWidth="5" strokeLinecap="round" fill="none" />
          ) : estado === "neutro" ? (
            // No catálogo o sorriso é reação, não estado: aparece quando você
            // passa por cima ou escolhe o agente, e o CSS é quem troca.
            <>
              <path className="boca-reta" d="M42 68h16" stroke="#151515" strokeWidth="5" strokeLinecap="round" />
              <path className="boca-sorriso" d="M38 66q12 12 24 0" stroke="#151515" strokeWidth="5" strokeLinecap="round" fill="none" />
            </>
          ) : (
            <path d="M42 68h16" stroke="#151515" strokeWidth="5" strokeLinecap="round" />
          )}
        </g>
      </g>
    </svg>
  );
}
