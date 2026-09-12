"use client";

// ============================================================================
// GovernmentFormActions — the modal action bar (Part 13).
//
// Drafts autosave in GovernmentFormModal, so the footer exposes one clear
// primary action per step instead of four competing buttons.
// ============================================================================

import React from "react";
import type { Lang } from "./types.ts";

export interface GovernmentFormActionsProps {
  lang: Lang;
  mode: "edit" | "review";
  onReview: () => void;
  onBackToEdit: () => void;
  onComplete: () => void;
  onClose: () => void;
  completing?: boolean;
  /** Localized label for the final "complete" button (defaults to
   * "Complete and add"). Completing finalizes the document and closes the
   * modal — the host marks its requirement row complete. */
  completeLabel?: string;
}

export function GovernmentFormActions(props: GovernmentFormActionsProps) {
  const { lang, mode, onReview, onBackToEdit, onComplete, onClose, completing, completeLabel } = props;
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  const btn: React.CSSProperties = { fontSize: 14, padding: "9px 16px", borderRadius: 8, cursor: "pointer", border: "1px solid #cbd5e1", background: "white" };
  const primary: React.CSSProperties = { ...btn, background: "var(--brand-1, #0a2540)", color: "white", border: "none" };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
      <button type="button" style={btn} onClick={onClose}>{L("Close", "Cerrar")}</button>
      {mode === "edit" ? (
        <button type="button" style={primary} onClick={onReview}>{L("Complete", "Completar")}</button>
      ) : (
        <>
          <button type="button" style={btn} onClick={onBackToEdit}>{L("Back to edit", "Volver a editar")}</button>
          <button type="button" style={primary} disabled={completing} onClick={onComplete}>
            {completing ? L("Saving…", "Guardando…") : completeLabel ?? L("Complete and add", "Completar y añadir")}
          </button>
        </>
      )}
    </div>
  );
}
