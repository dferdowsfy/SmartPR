"use client";

// A plain in-platform dialog (portal to <body>): Escape / backdrop closes,
// focus moves into it once on open, clicks never reach the row behind it.

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function ClaraModal({ title, subtitle, onClose, children, footer, testId, wide = false, size }: { title: string; subtitle?: string | null; onClose: () => void; children: ReactNode; footer?: ReactNode; testId?: string; wide?: boolean; size?: "xl" }) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass a fresh onClose on every render (e.g. each keystroke in a
  // field). Read it through a ref so the setup below runs once per open —
  // re-running it moved focus back to the dialog and swallowed typing.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="cl-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onClick={(e) => e.stopPropagation()}>
      <div className={`cl-modal ${wide ? "cl-modal-wide" : ""} ${size === "xl" ? "cl-modal-xl" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} data-testid={testId}>
        <header className="cl-head">
          <div className="cl-head-text">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="cl-close" onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="cl-body">{children}</div>
        {footer && <footer className="cl-foot">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
