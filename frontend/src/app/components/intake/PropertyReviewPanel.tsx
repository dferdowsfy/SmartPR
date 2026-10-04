"use client";

/**
 * Professional land-use review controls for the expanded Property & Site
 * Report (never the compact intake preview). Every change is ONE server
 * action; the server appends the history. "Reviewed" is a professional
 * review of SmartPR's report — never a government approval.
 */
import { useCallback, useEffect, useState } from "react";
import { History, Loader2, MessageSquarePlus, ShieldCheck } from "lucide-react";
import type { Lang } from "../../forms/engine/types";
import { REVIEW_DISCLAIMER, REVIEW_STATUS_TEXT, type PropertyReview, type ReviewAction, type ReviewStatus } from "../../locations/propertyReview";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export interface ReviewTarget {
  businessId: string;
  locationId: string;
}

const ERRORS: Record<string, { en: string; es: string }> = {
  open_questions: { en: "Resolve the open questions before marking the report Reviewed.", es: "Resuelve las preguntas pendientes antes de marcar el informe como Revisado." },
  no_saved_report: { en: "Save the report to the Passport first.", es: "Primero guarda el informe en el Pasaporte." },
  forbidden: { en: "Your role can't edit this review.", es: "Tu rol no puede editar esta revisión." },
};

/** Loads the review and returns an action runner (shared by panel + finding rows). */
export function usePropertyReview(target: ReviewTarget | null, reportVersion: number | null) {
  const [review, setReview] = useState<PropertyReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = target ? `/api/businesses/${encodeURIComponent(target.businessId)}/locations/${encodeURIComponent(target.locationId)}/site-reports/review` : null;
  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    fetch(base, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { review: null })).then((d: { review: PropertyReview | null }) => { if (!cancelled) setReview(d.review); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [base, reportVersion]);
  const run = useCallback(async (action: ReviewAction): Promise<boolean> => {
    if (!base) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? `http_${res.status}`); return false; }
      setReview(d.review);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [base]);
  return { review: base ? review : null, busy, error, run, enabled: !!base };
}

export type ReviewApi = ReturnType<typeof usePropertyReview>;

/** Inline "Add note / Flag question" for one finding (expanded report only). */
export function FindingReviewControls({ api, findingId, lang }: { api: ReviewApi; findingId: string; lang: Lang }) {
  const [mode, setMode] = useState<null | "note" | "question">(null);
  const [text, setText] = useState("");
  if (!api.enabled) return null;
  const notes = api.review?.notes.filter((n) => n.finding_id === findingId && !n.removed) ?? [];
  const questions = api.review?.questions.filter((q) => q.finding_id === findingId) ?? [];
  const submit = async () => {
    if (!mode || !text.trim()) return;
    const ok = await api.run(mode === "note" ? { type: "add_note", finding_id: findingId, text } : { type: "add_question", finding_id: findingId, text });
    if (ok) { setText(""); setMode(null); }
  };
  return (
    <div className="spr-prv-finding" data-testid="finding-review">
      {notes.map((n) => (
        <p key={n.id} className="spr-prv-note"><span className="spr-prv-basis spr-prv-basis-professional">{L("Professional note", "Nota profesional", lang)}</span> {n.text} <small>— {n.author.name ?? L("reviewer", "revisor", lang)}</small></p>
      ))}
      {questions.map((q) => (
        <p key={q.id} className={`spr-prv-note spr-prv-q-${q.status}`}><span className="spr-prv-basis spr-prv-basis-question">{q.status === "open" ? L("Open question", "Pregunta pendiente", lang) : L("Resolved", "Resuelta", lang)}</span> {q.text}{q.resolution ? <> → {q.resolution}</> : null}</p>
      ))}
      {mode ? (
        <div className="spr-prv-form">
          <label className="sr-only" htmlFor={`prv-${findingId}`}>{mode === "note" ? L("Note", "Nota", lang) : L("Question", "Pregunta", lang)}</label>
          <textarea id={`prv-${findingId}`} value={text} maxLength={2000} rows={2} onChange={(e) => setText(e.target.value)} placeholder={mode === "note" ? L("Professional note on this finding…", "Nota profesional sobre este hallazgo…", lang) : L("What still needs to be answered?", "¿Qué falta por contestar?", lang)} data-testid="finding-review-text" />
          <div>
            <button type="button" className="spr-loc-btn primary" disabled={api.busy || !text.trim()} onClick={() => void submit()} data-testid="finding-review-save">{L("Save", "Guardar", lang)}</button>
            <button type="button" className="spr-loc-btn ghost" onClick={() => { setMode(null); setText(""); }}>{L("Cancel", "Cancelar", lang)}</button>
          </div>
        </div>
      ) : (
        <div className="spr-prv-finding-actions">
          <button type="button" className="spr-link" onClick={() => setMode("note")} data-testid="finding-add-note"><MessageSquarePlus aria-hidden="true" /> {L("Add note", "Añadir nota", lang)}</button>
          <button type="button" className="spr-link" onClick={() => setMode("question")} data-testid="finding-flag-question">{L("Flag question", "Marcar pregunta", lang)}</button>
        </div>
      )}
    </div>
  );
}

export function PropertyReviewPanel({ api, lang }: { api: ReviewApi; lang: Lang }) {
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const [general, setGeneral] = useState("");
  const r = api.review;
  const status: ReviewStatus = r?.status ?? "draft";
  const open = r?.questions.filter((q) => q.status === "open") ?? [];
  const err = api.error ? (ERRORS[api.error]?.[lang] ?? api.error) : null;
  return (
    <section className="spr-prd-section spr-prv" aria-label={L("Professional review", "Revisión profesional", lang)} data-testid="review-panel" data-status={status}>
      <h3><ShieldCheck aria-hidden="true" /> {L("Professional review", "Revisión profesional", lang)}</h3>
      <p className="spr-prv-disclaimer" data-testid="review-disclaimer">{REVIEW_DISCLAIMER[lang]}</p>
      <div className="spr-prv-status" role="radiogroup" aria-label={L("Review status", "Estado de la revisión", lang)}>
        {(["draft", "under_review", "reviewed"] as const).map((st) => (
          <button key={st} type="button" role="radio" aria-checked={status === st} className={`spr-prv-status-btn${status === st ? " on" : ""}`} disabled={api.busy} onClick={() => void api.run({ type: "set_status", status: st })} data-testid={`review-status-${st}`}>
            {REVIEW_STATUS_TEXT[st][lang]}
          </button>
        ))}
        {api.busy && <Loader2 className="spr-loc-spin" aria-hidden="true" />}
      </div>
      {r?.status === "reviewed" && r.reviewed_at && (
        <p className="spr-prv-meta">{L("Reviewed by", "Revisado por", lang)} {r.reviewed_by?.name ?? "—"} · {new Date(r.reviewed_at).toLocaleString(lang === "es" ? "es-PR" : "en-US")} · {L("report", "informe", lang)} v{r.report_version}</p>
      )}
      {err && <p className="spr-prd-error" role="alert" data-testid="review-error">{err}</p>}

      <div className="spr-prv-block">
        <h4>{L("Unresolved questions", "Preguntas sin resolver", lang)} ({open.length})</h4>
        {open.length === 0 && <p className="spr-prv-empty">{L("None flagged.", "Ninguna marcada.", lang)}</p>}
        <ul>
          {r?.questions.map((q) => (
            <li key={q.id} className={`spr-prv-q-${q.status}`} data-testid="review-question" data-status={q.status}>
              <span>{q.finding_id ? <small>[{q.finding_id}] </small> : null}{q.text}{q.resolution ? <> → <em>{q.resolution}</em></> : null}</span>
              <label className="spr-prv-export"><input type="checkbox" checked={q.include_in_export} onChange={(e) => void api.run({ type: "toggle_question_export", question_id: q.id, include: e.target.checked })} /> {L("In client export", "En exportación al cliente", lang)}</label>
              {q.status === "open" ? (
                resolving === q.id ? (
                  <span className="spr-prv-form">
                    <input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder={L("How it was resolved", "Cómo se resolvió", lang)} data-testid="review-resolution" />
                    <button type="button" className="spr-loc-btn primary" disabled={!resolution.trim() || api.busy} onClick={async () => { if (await api.run({ type: "resolve_question", question_id: q.id, resolution })) { setResolving(null); setResolution(""); } }} data-testid="review-resolve-save">{L("Resolve", "Resolver", lang)}</button>
                  </span>
                ) : <button type="button" className="spr-link" onClick={() => setResolving(q.id)} data-testid="review-resolve">{L("Resolve", "Resolver", lang)}</button>
              ) : <button type="button" className="spr-link" onClick={() => void api.run({ type: "reopen_question", question_id: q.id })}>{L("Re-open", "Reabrir", lang)}</button>}
            </li>
          ))}
        </ul>
      </div>

      <div className="spr-prv-block">
        <h4>{L("Professional notes", "Notas profesionales", lang)}</h4>
        <ul>
          {r?.notes.filter((n) => !n.removed).map((n) => (
            <li key={n.id} data-testid="review-note">
              <span>{n.finding_id ? <small>[{n.finding_id}] </small> : null}{n.text} <small>— {n.author.name ?? "—"}</small></span>
              <label className="spr-prv-export"><input type="checkbox" checked={n.include_in_export} onChange={(e) => void api.run({ type: "toggle_note_export", note_id: n.id, include: e.target.checked })} /> {L("In client export", "En exportación al cliente", lang)}</label>
              <button type="button" className="spr-link" onClick={() => void api.run({ type: "remove_note", note_id: n.id })}>{L("Remove", "Quitar", lang)}</button>
            </li>
          ))}
        </ul>
        <div className="spr-prv-form">
          <label className="sr-only" htmlFor="prv-general">{L("General note", "Nota general", lang)}</label>
          <textarea id="prv-general" rows={2} maxLength={2000} value={general} onChange={(e) => setGeneral(e.target.value)} placeholder={L("General note on this report…", "Nota general sobre este informe…", lang)} />
          <div><button type="button" className="spr-loc-btn" disabled={!general.trim() || api.busy} onClick={async () => { if (await api.run({ type: "add_note", text: general })) setGeneral(""); }} data-testid="review-add-general">{L("Add note", "Añadir nota", lang)}</button></div>
        </div>
      </div>

      <details className="spr-prv-history">
        <summary><History aria-hidden="true" /> {L("Review history", "Historial de revisión", lang)} ({r?.history.length ?? 0})</summary>
        <ol data-testid="review-history">
          {[...(r?.history ?? [])].reverse().map((h, i) => (
            <li key={i}><time>{new Date(h.at).toLocaleString(lang === "es" ? "es-PR" : "en-US")}</time> · {h.actor.name ?? h.actor.id.slice(0, 8)} · v{h.report_version ?? "—"} · {h.action.replace(/_/g, " ")}: {h.detail}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}
