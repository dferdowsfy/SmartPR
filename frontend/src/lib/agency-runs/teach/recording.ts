/**
 * Record-first Teach Clara — the action log of a recording.
 *
 * The teach-session state machine (teachSession.ts) folds recorder events
 * into *screens* (steps with fields and clicks) and the mapping dialogue.
 * This module keeps the flat, in-order list of what the person actually did
 * — navigate, click, type into a field, select, upload, wait — so the
 * recording UI can show it as it happens and the validator can check it.
 *
 * Same privacy contract as the recorder: every event is re-sanitized with
 * sanitizeTeachEvent (structure only — selector, label, value *kind*, never
 * a value). A typed value is represented only by the passport field it is
 * bound to (or "ask each time"); secrets (passwords, codes), SSN/EIN-type
 * IDs, uploads and payment screens become human pause steps.
 *
 * Screenshots: the worker may attach a per-action screenshot URL (owner
 * token-gated, served by the worker). It is kept on the session view for
 * the person reviewing their own recording and is NEVER written into the
 * saved routine (the skill).
 */
import type { BilingualText } from "../skills/skill";
import { passportFieldName } from "../skills/skillCard";
import { isSubmitTarget } from "../skills/skillValidate";
import { sanitizeTeachEvent, type TeachEvent } from "./events";
import { normalizeLabel } from "./passportCatalog";
import type { TeachGate, TeachState } from "./teachSession";

export type RecordedActionKind = "navigate" | "click" | "type" | "select" | "upload" | "wait";

export type RecordedBinding =
  | { kind: "passport"; path: string; name: BilingualText }
  | { kind: "ask" }
  | { kind: "always"; option: string }
  | { kind: "pending"; suggestion: { path: string; name: BilingualText } | null }
  | { kind: "pause"; gate: TeachGate };

export interface RecordedAction {
  seq: number;
  kind: RecordedActionKind;
  url: string;
  /** Visible label of the control / screen heading for navigate. */
  label: string;
  selector: string | null;
  role: string | null;
  /** Only for type/select: the coarse kind of what was entered (never the value). */
  valueKind: string | null;
  /** Wait: how long the person waited (ms, clamped). */
  waitMs: number | null;
  /** Human pause this action belongs to (login, MFA, upload, payment …). */
  pause: TeachGate | null;
  /** The person clicked something that looks like the final submit. */
  submitLike: boolean;
  screenshot: string | null;
  /** Filled in by bindRecordedActions from the teach state. */
  binding: RecordedBinding | null;
  stepId: string | null;
}

const MAX_ACTIONS = 400;
const MAX_WAIT_MS = 120_000;

/**
 * A screenshot reference the worker attached to an event: an https URL
 * (token-gated worker endpoint) or a small inline image. Anything else is
 * dropped.
 */
export function safeScreenshotRef(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= 400_000) return s;
  if (s.length > 600) return null;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return s;
  } catch {
    /* fall through */
  }
  return null;
}

function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.hash}`;
  } catch {
    return url;
  }
}

/** Turn one sanitized recorder event into an action (null = nothing new to log). */
export function actionFromEvent(ev: TeachEvent, prev: RecordedAction[], extra: { seq: number; screenshot: string | null }): RecordedAction | null {
  const base = { seq: extra.seq, url: ev.url, screenshot: extra.screenshot, binding: null, stepId: null, waitMs: null, submitLike: false } as const;
  if (ev.kind === "page") {
    const label = ev.heading || ev.title || urlKey(ev.url);
    const lastNav = [...prev].reverse().find((a) => a.kind === "navigate");
    // SPA re-renders re-announce the same screen: log it once.
    if (lastNav && urlKey(lastNav.url) === urlKey(ev.url) && normalizeLabel(lastNav.label) === normalizeLabel(label)) return null;
    const pause: TeachGate | null = ev.hasPassword ? "login" : ev.hasCaptcha ? "captcha" : null;
    return { ...base, kind: "navigate", label, selector: null, role: null, valueKind: null, pause };
  }
  if (ev.kind === "fill") {
    if (ev.valueKind === "empty") return null; // touched but left blank
    const kind: RecordedActionKind = ev.valueKind === "file" ? "upload" : ev.role === "combobox" ? "select" : "type";
    const pause: TeachGate | null = ev.valueKind === "file" ? "upload" : ev.valueKind === "secret" ? "login" : null;
    const last = prev.at(-1);
    // Typing then changing the same field again is one action.
    if (last && (last.kind === "type" || last.kind === "select") && last.kind === kind && urlKey(last.url) === urlKey(ev.url) && ((ev.selector && last.selector === ev.selector) || normalizeLabel(last.label) === normalizeLabel(ev.label))) {
      return null;
    }
    return { ...base, kind, label: ev.label, selector: ev.selector, role: ev.role, valueKind: ev.valueKind === "secret" ? "secret" : ev.valueKind, pause };
  }
  // click
  const submitLike = isSubmitTarget({ role: ev.role === "combobox" ? "combobox" : ev.role === "option" ? "option" : "button", label_contains: ev.label, selector: ev.selector });
  const last = prev.at(-1);
  if (ev.role === "option" && last && last.role === "combobox" && last.kind === "click") {
    // Custom dropdown: open + pick = one "select".
    return { ...base, kind: "select", label: last.label, selector: last.selector, role: "combobox", valueKind: "option", pause: null };
  }
  // Double-clicks / repeated clicks on the same control are one action.
  if (last && last.kind === "click" && last.selector === ev.selector && normalizeLabel(last.label) === normalizeLabel(ev.label) && urlKey(last.url) === urlKey(ev.url)) return null;
  return { ...base, kind: "click", label: ev.label, selector: ev.selector, role: ev.role, valueKind: null, pause: submitLike ? "submit" : null, submitLike };
}

/**
 * Normalize raw recorder items (as queued by the worker) into the action
 * log. Raw "wait" items ({kind:"wait", url, ms}) are accepted here; every
 * other kind goes through sanitizeTeachEvent.
 */
export function normalizeRecorderItems(
  items: { seq: number; event: unknown; screenshot?: unknown }[],
  secrets: string[],
  prev: RecordedAction[] = []
): RecordedAction[] {
  const out = [...prev];
  for (const item of items) {
    if (out.length >= MAX_ACTIONS) break;
    const raw = item.event as Record<string, unknown> | null;
    const screenshot = safeScreenshotRef(item.screenshot ?? (raw && typeof raw === "object" ? raw.screenshot : null));
    if (raw && typeof raw === "object" && raw.kind === "wait") {
      const ms = Math.max(0, Math.min(MAX_WAIT_MS, Math.round(Number(raw.ms) || 0)));
      const url = sanitizeTeachEvent({ kind: "page", url: raw.url, title: "", heading: "" })?.url;
      if (!url || ms < 1000) continue;
      const last = out.at(-1);
      if (last?.kind === "wait") {
        last.waitMs = Math.min(MAX_WAIT_MS, (last.waitMs ?? 0) + ms);
        continue;
      }
      out.push({ seq: item.seq, kind: "wait", url, label: "", selector: null, role: null, valueKind: null, waitMs: ms, pause: null, submitLike: false, screenshot, binding: null, stepId: null });
      continue;
    }
    const ev = sanitizeTeachEvent(item.event, secrets);
    if (!ev) continue;
    const action = actionFromEvent(ev, out, { seq: item.seq, screenshot });
    if (action) out.push(action);
  }
  return out;
}

/**
 * Attach what each action means in the routine: the passport field a typed
 * value is bound to (or "ask each time" / "always choose"), and the human
 * pause of the screen it happened on. Uses the teach state's decisions;
 * pure.
 */
export function bindRecordedActions(actions: RecordedAction[], state: TeachState): RecordedAction[] {
  const stepFor = (a: RecordedAction) => {
    const key = urlKey(a.url);
    const candidates = state.steps.filter((s) => urlKey(s.url) === key);
    if (a.kind === "navigate") return candidates.find((s) => normalizeLabel(s.heading || s.title) === normalizeLabel(a.label)) ?? candidates[0] ?? null;
    return (
      candidates.find((s) => s.fields.some((f) => (a.selector && f.selector === a.selector) || normalizeLabel(f.label) === normalizeLabel(a.label))) ??
      candidates.find((s) => s.actions.some((x) => normalizeLabel(x.label) === normalizeLabel(a.label))) ??
      candidates.at(-1) ??
      null
    );
  };
  return actions.map((a) => {
    const step = stepFor(a);
    // The final-submit gate belongs only to the submit-like click itself.
    const stepGate = step?.gate && step.gate !== "submit" ? step.gate : null;
    const pause = a.pause ?? stepGate;
    let binding: RecordedBinding | null = null;
    if (pause && pause !== "submit" && a.kind !== "navigate" && a.kind !== "wait") binding = { kind: "pause", gate: pause };
    else if (a.kind === "type" || a.kind === "select") {
      const field = step?.fields.find((f) => (a.selector && f.selector === a.selector) || normalizeLabel(f.label) === normalizeLabel(a.label));
      if (field) {
        const d = field.decision;
        if (d.kind === "passport") binding = { kind: "passport", path: d.path, name: passportFieldName(d.path) };
        else if (d.kind === "ask") binding = { kind: "ask" };
        else if (d.kind === "always") binding = { kind: "always", option: d.option };
        else {
          const q = state.questions.find((x) => x.kind === "mapping" && x.fieldKey === field.key);
          const proposal = q && q.kind === "mapping" ? q.proposal : null;
          binding = { kind: "pending", suggestion: proposal ? { path: proposal.path, name: passportFieldName(proposal.path) } : null };
        }
      }
    } else if (a.kind === "upload") binding = { kind: "pause", gate: "upload" };
    return { ...a, pause, binding, stepId: step?.id ?? null };
  });
}

/** One-line description of an action for the recording list (EN/ES). */
export function describeAction(a: RecordedAction): BilingualText {
  const q = (s: string) => `“${s}”`;
  switch (a.kind) {
    case "navigate":
      return { en: `Opened ${q(a.label)}`, es: `Abrió ${q(a.label)}` };
    case "click":
      return a.submitLike
        ? { en: `Clicked ${q(a.label)} — final submit, never replayed`, es: `Tocó ${q(a.label)} — envío final, nunca se repite` }
        : { en: `Clicked ${q(a.label)}`, es: `Tocó ${q(a.label)}` };
    case "type":
      return a.valueKind === "secret"
        ? { en: `Typed into ${q(a.label)} (hidden — you do this part)`, es: `Escribió en ${q(a.label)} (oculto — esto lo haces tú)` }
        : { en: `Typed into ${q(a.label)}`, es: `Escribió en ${q(a.label)}` };
    case "select":
      return { en: `Picked an option in ${q(a.label)}`, es: `Escogió una opción en ${q(a.label)}` };
    case "upload":
      return { en: `Uploaded a file to ${q(a.label)}`, es: `Subió un archivo a ${q(a.label)}` };
    case "wait":
      return { en: `Waited ${Math.round((a.waitMs ?? 0) / 1000)}s for the portal`, es: `Esperó ${Math.round((a.waitMs ?? 0) / 1000)}s por el portal` };
  }
}
