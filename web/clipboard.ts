/** Copia texto para a área de transferência; fallback para execCommand. */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (!texto) return false;
  try {
    if (!window.isSecureContext || !navigator.clipboard?.writeText) throw Error("sem clipboard");
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const campo = document.createElement("textarea");
      campo.value = texto;
      campo.setAttribute("readonly", "");
      campo.style.position = "fixed";
      campo.style.left = "-9999px";
      document.body.appendChild(campo);
      campo.select();
      const ok = document.execCommand("copy");
      campo.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

type Tecla = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

export function atalhoDeCopiar(event: Tecla): boolean {
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.key === "Insert" && ctrl && !event.shiftKey && !event.altKey) return true;
  if (ctrl && event.key.toLowerCase() === "c" && !event.altKey) return true;
  return false;
}

export function atalhoDeColar(event: Tecla): boolean {
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.key === "Insert" && event.shiftKey && !ctrl && !event.altKey) return true;
  if (ctrl && event.key.toLowerCase() === "v" && !event.altKey) return true;
  return false;
}

/**
 * A API de leitura só existe em contexto seguro (HTTPS ou localhost). Quem
 * abre o cockpit pelo celular via http://IP-da-rede não tem `navigator.clipboard`,
 * e aí o único caminho é o colar nativo do sistema num campo de texto.
 */
export function clipboardLegivel(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof navigator.clipboard?.readText === "function";
}

/** Lê texto da área de transferência. Falha silenciosa se o navegador negar permissão. */
export async function colarTexto(): Promise<string> {
  try {
    return (await navigator.clipboard.readText()) || "";
  } catch {
    return "";
  }
}
