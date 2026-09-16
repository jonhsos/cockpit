import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { atalhoDeCopiar, copiarTexto } from "./clipboard.ts";

/**
 * Quem abriu cada camada. Uma superficie pode trocar por outra ("Detalhar
 * consumo" fecha Atividade e abre Consumo): o botao que abriu a primeira some
 * junto, e sem esta cadeia o foco cairia no body ao fechar a segunda.
 */
const acionador = new WeakMap<HTMLDialogElement, HTMLElement>();

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current!;
    const ativo = document.activeElement;
    let previous = ativo instanceof HTMLElement ? ativo : null;
    const camadaAcima = previous?.closest("dialog");
    if (camadaAcima instanceof HTMLDialogElement) previous = acionador.get(camadaAcima) ?? previous;
    if (previous) acionador.set(dialog, previous);
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return createPortal(
    <dialog ref={ref} className="modal-window" aria-label={title} onWheel={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (!atalhoDeCopiar(event)) return;
      const alvo = event.target;
      if (alvo instanceof HTMLElement && alvo.closest("input, textarea, [contenteditable=true]")) return;
      const texto = window.getSelection()?.toString();
      if (!texto) return;
      event.preventDefault();
      event.stopPropagation();
      void copiarTexto(texto);
    }} onCancel={(event) => {
      event.preventDefault();
      onClose();
    }}>
      {children}
    </dialog>,
    document.body,
  );
}
