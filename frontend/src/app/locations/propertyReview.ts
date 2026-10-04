// ============================================================================
// Professional land-use review of one Property & Site Report (pure).
//
// A review is layered ON TOP of a saved report version; it never edits the
// report's official findings or rule results. Professionals add notes and
// unresolved questions and move the review through
//   draft → under_review → reviewed
// "Reviewed" means a professional reviewed SmartPR's report. It is never a
// government approval, permit or determination, and every surface says so.
//
// The server applies one action at a time through applyReviewAction(), so
// the history is append-only: a client can't rewrite who did what, when.
// When a new report version is saved, the review re-opens (status → draft)
// and the history records why.
// ============================================================================

export type ReviewStatus = "draft" | "under_review" | "reviewed";

export interface ReviewActor {
  id: string;
  name: string | null;
}

export interface ReviewNote {
  id: string;
  finding_id: string | null;
  text: string;
  include_in_export: boolean;
  removed: boolean;
  author: ReviewActor;
  created_at: string;
}

export interface ReviewQuestion {
  id: string;
  finding_id: string | null;
  text: string;
  status: "open" | "resolved";
  resolution: string | null;
  include_in_export: boolean;
  author: ReviewActor;
  created_at: string;
  resolved_at: string | null;
}

export interface ReviewEvent {
  at: string;
  actor: ReviewActor;
  action: "status_changed" | "note_added" | "note_removed" | "note_export_toggled" | "question_added" | "question_resolved" | "question_reopened" | "question_export_toggled" | "report_version_changed";
  detail: string;
  report_version: number | null;
}

export interface PropertyReview {
  schema: "smartpr.property-review/v1";
  status: ReviewStatus;
  /** Report version + fingerprint the current status applies to. */
  report_version: number | null;
  report_fingerprint: string | null;
  reviewed_by: ReviewActor | null;
  reviewed_at: string | null;
  notes: ReviewNote[];
  questions: ReviewQuestion[];
  history: ReviewEvent[];
}

export type ReviewAction =
  | { type: "set_status"; status: ReviewStatus }
  | { type: "add_note"; finding_id?: string | null; text: string; include_in_export?: boolean }
  | { type: "remove_note"; note_id: string }
  | { type: "toggle_note_export"; note_id: string; include: boolean }
  | { type: "add_question"; finding_id?: string | null; text: string; include_in_export?: boolean }
  | { type: "resolve_question"; question_id: string; resolution: string }
  | { type: "reopen_question"; question_id: string }
  | { type: "toggle_question_export"; question_id: string; include: boolean };

export type ReviewResult = { ok: true; review: PropertyReview } | { ok: false; error: string };

export const REVIEW_STATUS_TEXT: Record<ReviewStatus, { en: string; es: string }> = {
  draft: { en: "Draft", es: "Borrador" },
  under_review: { en: "Under review", es: "En revisión" },
  reviewed: { en: "Reviewed", es: "Revisado" },
};
/** Shown wherever the status is shown. */
export const REVIEW_DISCLAIMER = {
  en: "Professional review of SmartPR's report — not a government approval, permit or determination.",
  es: "Revisión profesional del informe de SmartPR — no es una aprobación, permiso ni determinación del gobierno.",
};

const MAX_TEXT = 2000;
const MAX_ITEMS = 200;

export function emptyReview(): PropertyReview {
  return { schema: "smartpr.property-review/v1", status: "draft", report_version: null, report_fingerprint: null, reviewed_by: null, reviewed_at: null, notes: [], questions: [], history: [] };
}

const clean = (t: unknown) => (typeof t === "string" ? t.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "");

/**
 * Bind the review to the latest report version. A different fingerprint
 * re-opens a reviewed / under-review report as a draft (the professional must
 * look again) and records it.
 */
export function attachReportVersion(review: PropertyReview, version: number, fingerprint: string, actor: ReviewActor, now: string): PropertyReview {
  if (review.report_fingerprint === fingerprint) return review.report_version === version ? review : { ...review, report_version: version };
  const reopened = review.report_fingerprint !== null && review.status !== "draft";
  return {
    ...review,
    report_version: version,
    report_fingerprint: fingerprint,
    status: reopened ? "draft" : review.status,
    reviewed_by: reopened ? null : review.reviewed_by,
    reviewed_at: reopened ? null : review.reviewed_at,
    history: [
      ...review.history,
      {
        at: now,
        actor,
        action: "report_version_changed",
        detail: review.report_fingerprint === null ? `review started on report v${version}` : `report updated to v${version}${reopened ? "; review re-opened as Draft" : ""}`,
        report_version: version,
      },
    ],
  };
}

export function applyReviewAction(review: PropertyReview, action: ReviewAction, actor: ReviewActor, now: string, newId: () => string): ReviewResult {
  if (review.report_version === null) return { ok: false, error: "no_report_version" };
  const ev = (a: ReviewEvent["action"], detail: string): ReviewEvent => ({ at: now, actor, action: a, detail, report_version: review.report_version });
  switch (action.type) {
    case "set_status": {
      if (!["draft", "under_review", "reviewed"].includes(action.status)) return { ok: false, error: "invalid_status" };
      if (action.status === review.status) return { ok: true, review };
      // A report with open questions can't be called reviewed.
      if (action.status === "reviewed" && review.questions.some((q) => q.status === "open")) return { ok: false, error: "open_questions" };
      const reviewed = action.status === "reviewed";
      return {
        ok: true,
        review: {
          ...review,
          status: action.status,
          reviewed_by: reviewed ? actor : null,
          reviewed_at: reviewed ? now : null,
          history: [...review.history, ev("status_changed", `${review.status} → ${action.status}`)],
        },
      };
    }
    case "add_note": {
      const text = clean(action.text);
      if (!text) return { ok: false, error: "empty_text" };
      if (review.notes.length >= MAX_ITEMS) return { ok: false, error: "too_many_notes" };
      const note: ReviewNote = { id: newId(), finding_id: action.finding_id ?? null, text, include_in_export: action.include_in_export !== false, removed: false, author: actor, created_at: now };
      return { ok: true, review: { ...review, notes: [...review.notes, note], history: [...review.history, ev("note_added", `${note.finding_id ?? "report"}: ${text.slice(0, 120)}`)] } };
    }
    case "remove_note": {
      const n = review.notes.find((x) => x.id === action.note_id && !x.removed);
      if (!n) return { ok: false, error: "not_found" };
      // Soft delete: the history still shows it existed.
      return { ok: true, review: { ...review, notes: review.notes.map((x) => (x.id === n.id ? { ...x, removed: true, include_in_export: false } : x)), history: [...review.history, ev("note_removed", n.text.slice(0, 120))] } };
    }
    case "toggle_note_export": {
      const n = review.notes.find((x) => x.id === action.note_id && !x.removed);
      if (!n) return { ok: false, error: "not_found" };
      return { ok: true, review: { ...review, notes: review.notes.map((x) => (x.id === n.id ? { ...x, include_in_export: action.include } : x)), history: [...review.history, ev("note_export_toggled", `${action.include ? "included in" : "excluded from"} client export: ${n.text.slice(0, 80)}`)] } };
    }
    case "add_question": {
      const text = clean(action.text);
      if (!text) return { ok: false, error: "empty_text" };
      if (review.questions.length >= MAX_ITEMS) return { ok: false, error: "too_many_questions" };
      const q: ReviewQuestion = { id: newId(), finding_id: action.finding_id ?? null, text, status: "open", resolution: null, include_in_export: action.include_in_export !== false, author: actor, created_at: now, resolved_at: null };
      // An open question takes a reviewed report back to "under review".
      const status: ReviewStatus = review.status === "reviewed" ? "under_review" : review.status;
      const history = [...review.history, ev("question_added", `${q.finding_id ?? "report"}: ${text.slice(0, 120)}`)];
      if (status !== review.status) history.push(ev("status_changed", `${review.status} → ${status} (new open question)`));
      return { ok: true, review: { ...review, status, reviewed_by: null, reviewed_at: null, questions: [...review.questions, q], history } };
    }
    case "resolve_question": {
      const q = review.questions.find((x) => x.id === action.question_id && x.status === "open");
      if (!q) return { ok: false, error: "not_found" };
      const resolution = clean(action.resolution);
      if (!resolution) return { ok: false, error: "empty_resolution" };
      return { ok: true, review: { ...review, questions: review.questions.map((x) => (x.id === q.id ? { ...x, status: "resolved", resolution, resolved_at: now } : x)), history: [...review.history, ev("question_resolved", `${q.text.slice(0, 80)} → ${resolution.slice(0, 80)}`)] } };
    }
    case "reopen_question": {
      const q = review.questions.find((x) => x.id === action.question_id && x.status === "resolved");
      if (!q) return { ok: false, error: "not_found" };
      const status: ReviewStatus = review.status === "reviewed" ? "under_review" : review.status;
      const history = [...review.history, ev("question_reopened", q.text.slice(0, 120))];
      if (status !== review.status) history.push(ev("status_changed", `${review.status} → ${status} (question re-opened)`));
      return { ok: true, review: { ...review, status, reviewed_by: null, reviewed_at: null, questions: review.questions.map((x) => (x.id === q.id ? { ...x, status: "open", resolved_at: null } : x)), history } };
    }
    case "toggle_question_export": {
      const q = review.questions.find((x) => x.id === action.question_id);
      if (!q) return { ok: false, error: "not_found" };
      return { ok: true, review: { ...review, questions: review.questions.map((x) => (x.id === q.id ? { ...x, include_in_export: action.include } : x)), history: [...review.history, ev("question_export_toggled", `${action.include ? "included in" : "excluded from"} client export: ${q.text.slice(0, 80)}`)] } };
    }
    default:
      return { ok: false, error: "unknown_action" };
  }
}

/** Validate an action body from the network (shape only; meaning is checked by applyReviewAction). */
export function parseReviewAction(raw: unknown): ReviewAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  const b = (k: string) => a[k] === true;
  switch (a.type) {
    case "set_status": return { type: "set_status", status: s("status") as ReviewStatus };
    case "add_note": return { type: "add_note", text: s("text"), finding_id: s("finding_id") || null, include_in_export: a.include_in_export !== false };
    case "remove_note": return { type: "remove_note", note_id: s("note_id") };
    case "toggle_note_export": return { type: "toggle_note_export", note_id: s("note_id"), include: b("include") };
    case "add_question": return { type: "add_question", text: s("text"), finding_id: s("finding_id") || null, include_in_export: a.include_in_export !== false };
    case "resolve_question": return { type: "resolve_question", question_id: s("question_id"), resolution: s("resolution") };
    case "reopen_question": return { type: "reopen_question", question_id: s("question_id") };
    case "toggle_question_export": return { type: "toggle_question_export", question_id: s("question_id"), include: b("include") };
    default: return null;
  }
}

export function restoreReview(raw: unknown): PropertyReview | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as PropertyReview;
  if (r.schema !== "smartpr.property-review/v1" || !Array.isArray(r.notes) || !Array.isArray(r.questions) || !Array.isArray(r.history)) return null;
  return r;
}

/** What the client-facing export carries: status + selected notes + selected questions. */
export function exportableReview(review: PropertyReview | null) {
  if (!review) return null;
  return {
    status: review.status,
    status_text: REVIEW_STATUS_TEXT[review.status],
    disclaimer: REVIEW_DISCLAIMER,
    report_version: review.report_version,
    reviewed_by: review.status === "reviewed" ? review.reviewed_by : null,
    reviewed_at: review.status === "reviewed" ? review.reviewed_at : null,
    notes: review.notes.filter((n) => !n.removed && n.include_in_export).map((n) => ({ finding_id: n.finding_id, text: n.text, author: n.author.name, at: n.created_at })),
    open_questions: review.questions.filter((q) => q.status === "open" && q.include_in_export).map((q) => ({ finding_id: q.finding_id, text: q.text })),
    resolved_questions: review.questions.filter((q) => q.status === "resolved" && q.include_in_export).map((q) => ({ finding_id: q.finding_id, text: q.text, resolution: q.resolution })),
  };
}
