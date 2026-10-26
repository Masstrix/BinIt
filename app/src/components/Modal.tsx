import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Native <dialog> shown modally: focus is trapped, Esc and a backdrop click close it.
 * Mount it to open, unmount to close (so any form inside starts fresh each time).
 */
export function Modal({ title, onClose, children, centered = false, narrow = false, className = "" }: { title: string; onClose: () => void; children: ReactNode; centered?: boolean; narrow?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    // Focus here, inside the tap that opened the dialog: phones only raise the keyboard for a focus
    // that happens as part of a user action, not one a timer fires later.
    d.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    // With the on-screen keyboard up, the visible area is smaller than the page: let the dialog use only that.
    const vv = window.visualViewport;
    const fit = () => {
      // Some browsers (iOS home-screen apps especially) report a tiny or stale height around the keyboard;
      // a floor keeps the dialog from squashing down to just its header.
      if (!vv) return;
      d.style.setProperty("--vvh", `${Math.max(vv.height, 360)}px`);
      d.style.setProperty("--vvt", `${vv.offsetTop}px`);
    };
    fit();
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);
    return () => {
      vv?.removeEventListener("resize", fit);
      vv?.removeEventListener("scroll", fit);
      d.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${centered ? " center" : ""}${narrow ? " narrow" : ""}${className ? ` ${className}` : ""}`}
      aria-labelledby={titleId}
      // Esc: let the parent unmount us instead of the browser closing the dialog. (Not
      // `onClose`: the unmount cleanup's close() fires that too, even in StrictMode remounts.)
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {children}
    </dialog>
  );
}
