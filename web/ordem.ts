import { useEffect, useMemo, useState } from "react";

const bus = new EventTarget();

export function lerOrdem(chave: string): string[] {
  try {
    const raw = localStorage.getItem(chave);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function gravarOrdem(chave: string, ids: string[]): void {
  localStorage.setItem(chave, JSON.stringify(ids));
  bus.dispatchEvent(new Event(chave));
  bus.dispatchEvent(new Event("cockpit.ordem"));
}

export function onOrdem(fn: () => void): () => void {
  bus.addEventListener("cockpit.ordem", fn);
  return () => bus.removeEventListener("cockpit.ordem", fn);
}

/** Mantém a ordem salva e acrescenta ids novos no fim. */
export function aplicarOrdem(atuais: string[], salva: string[]): string[] {
  const vivos = new Set(atuais);
  const vistos = new Set<string>();
  const resultado: string[] = [];
  for (const id of salva) {
    if (!vivos.has(id) || vistos.has(id)) continue;
    resultado.push(id);
    vistos.add(id);
  }
  for (const id of atuais) {
    if (vistos.has(id)) continue;
    resultado.push(id);
    vistos.add(id);
  }
  return resultado;
}

export function moverAntesOuDepois(ids: string[], origem: string, destino: string, depois: boolean): string[] {
  if (!origem || !destino || origem === destino) return ids;
  const de = ids.indexOf(origem);
  const para = ids.indexOf(destino);
  if (de < 0 || para < 0) return ids;
  const proxima = ids.filter((id) => id !== origem);
  let idx = proxima.indexOf(destino);
  if (idx < 0) return ids;
  if (depois) idx += 1;
  proxima.splice(idx, 0, origem);
  return proxima;
}

export function metadeDepois(event: { clientX: number; clientY: number }, alvo: DOMRect, eixo: "x" | "y" | "auto" = "auto"): boolean {
  if (eixo === "x") return event.clientX > alvo.left + alvo.width / 2;
  if (eixo === "y") return event.clientY > alvo.top + alvo.height / 2;
  const dx = Math.abs(event.clientX - (alvo.left + alvo.width / 2));
  const dy = Math.abs(event.clientY - (alvo.top + alvo.height / 2));
  return dx > dy
    ? event.clientX > alvo.left + alvo.width / 2
    : event.clientY > alvo.top + alvo.height / 2;
}

export function chaveMissoes(projectId: string): string {
  return `cockpit.ordem.missoes.${projectId}`;
}

export function chavePaineis(missionId: string): string {
  return `cockpit.ordem.paineis.${missionId}`;
}

export function useOrdem(chave: string | null, atuais: string[]): [string[], (proxima: string[]) => void] {
  const firma = atuais.join("\n");
  const [salva, setSalva] = useState<string[]>(() => (chave ? lerOrdem(chave) : []));

  useEffect(() => {
    if (!chave) {
      setSalva([]);
      return;
    }
    const sync = () => setSalva(lerOrdem(chave));
    sync();
    bus.addEventListener(chave, sync);
    return () => bus.removeEventListener(chave, sync);
  }, [chave]);

  const efetiva = useMemo(
    () => aplicarOrdem(firma ? firma.split("\n") : [], salva),
    [firma, salva],
  );

  const gravar = (proxima: string[]) => {
    if (!chave) return;
    gravarOrdem(chave, proxima);
    setSalva(proxima);
  };

  return [efetiva, gravar];
}
