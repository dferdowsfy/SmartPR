"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyPassportProposals, validatePassportProposals, type PassportConflict, type PassportProposal } from "../../ai/intake/passportExtraction";
import type { CanonicalApplicationData, Lang } from "../../forms/engine/types";

export interface PassportInputTarget {
  canonical: CanonicalApplicationData;
  onChange: (next: CanonicalApplicationData) => void | Promise<void>;
  unconfirmedDefaults?: string[];
}

/** Only proposals awaiting review are transient. Accepted values immediately
 * enter the very same canonical state and save handler used by typing. */
export function usePassportVoiceInput(target: PassportInputTarget | undefined, lang: Lang) {
  const latest = useRef(target);
  useEffect(() => { latest.current = target; }, [target]);
  const [conflicts, setConflicts] = useState<PassportConflict[]>([]);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const apply = useCallback(async (proposals: PassportProposal[], approvals: PassportConflict[] = []) => {
    const current = latest.current;
    if (!current) return;
    const result = applyPassportProposals(current.canonical, proposals, approvals, current.unconfirmedDefaults);
    setConflicts((previous) => [
      ...previous.filter((c) => !proposals.some((p) => p.fieldId === c.proposal.fieldId)),
      ...result.conflicts,
    ]);
    if (result.applied.length) {
      setSaving(true);
      try {
        await current.onChange(result.next);
        setNotice(`${lang === "es" ? "Datos añadidos por voz" : "Fields added by voice"}: ${result.applied.map((p) => p.label[lang]).join(", ")}.`);
      } catch {
        setNotice(lang === "es" ? "No se pudieron guardar los cambios. Revise los campos e intente guardar de nuevo." : "Could not save the changes. Review the fields and retry saving.");
      } finally { setSaving(false); }
    } else if (!result.conflicts.length) {
      setNotice(lang === "es" ? "No hay datos nuevos suficientemente claros. Puede editar los campos directamente." : "No new clearly stated details found. You can edit the fields directly.");
    }
  }, [lang]);
  const receive = useCallback(async (raw: unknown, transcript: string) => {
    await apply(validatePassportProposals(raw, transcript, lang));
  }, [apply, lang]);
  return { receive, conflicts, notice, saving,
    confirm: (conflict: PassportConflict) => apply([conflict.proposal], [conflict]),
    dismiss: (fieldId: string) => setConflicts((previous) => previous.filter((c) => c.proposal.fieldId !== fieldId)),
  };
}

export function PassportVoiceReview({ review, lang }: { review: ReturnType<typeof usePassportVoiceInput>; lang: Lang }) {
  if (!review.notice && !review.conflicts.length) return null;
  return <div className="my-3 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-slate-800" aria-live="polite">
    {review.notice && <p role="status">{review.notice}</p>}
    {review.conflicts.length > 0 && <>
      <p className="font-semibold">{lang === "es" ? "Revise antes de reemplazar datos existentes" : "Review before replacing existing details"}</p>
      <ul className="mt-2 space-y-3">{review.conflicts.map((c) => <li key={c.proposal.fieldId}>
        <p className="font-medium">{c.proposal.label[lang]}</p>
        <p className="break-words">{lang === "es" ? "Actual" : "Current"}: {String(c.previous)}</p>
        <p className="break-words">{lang === "es" ? "Propuesto" : "Proposed"}: {c.proposal.displayValue}</p>
        <div className="mt-1 flex gap-3">
          <button type="button" disabled={review.saving} className="rounded-lg bg-teal-800 px-3 py-2 text-white disabled:opacity-50" onClick={() => void review.confirm(c)}>{lang === "es" ? "Reemplazar" : "Replace"}</button>
          <button type="button" disabled={review.saving} className="rounded-lg border border-slate-300 px-3 py-2" onClick={() => review.dismiss(c.proposal.fieldId)}>{lang === "es" ? "Conservar actual" : "Keep current"}</button>
        </div>
      </li>)}</ul>
    </>}
  </div>;
}
