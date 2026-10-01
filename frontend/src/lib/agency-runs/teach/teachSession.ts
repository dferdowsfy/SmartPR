/**
 * Teach session — turns sanitized recorder events into draft skill steps
 * and the mapping dialogue (Teach Clara spec §5).
 *
 * Pure and serializable: `applyTeachEvent`, `answerQuestion` and the
 * `mark*` helpers each return a new state. The UI renders `openQuestions`;
 * `buildSkillFromTeach` (buildSkill.ts) turns a finished session into a
 * skill that must pass validateSkill before it can be saved.
 *
 * What gets asked:
 *  - after each fill: "This looks like X from your business info — remember
 *    it as X?" (confirm / pick another / ask me each time)
 *  - after a meaningful choice (radio, checkbox, dropdown option):
 *    "Should I always choose this?" (Yes / No / Not Sure)
 *  - when a screen looks like a human-only step (login, code, payment,
 *    certification, signature, submit, CAPTCHA, uploads): "You'll do this
 *    part yourself — Clara stops here. Right?" (Yes / No / Not Sure)
 *  - when the teacher marks a screen as conditional: "What decides whether
 *    this screen shows up?" (a passport fact, or Not Sure)
 * Human-only screens never record their fields or clicks.
 */
import type { TeachClickEvent, TeachEvent, TeachFillEvent, TeachPageEvent, TeachValueKind } from "./events";
import { catalogEntry, normalizeLabel, proposeMapping, type MappingProposal } from "./passportCatalog";
import { isSecretField, isSubmitTarget } from "../skills/skillValidate";
import type { BilingualText } from "../skills/skill";

export type TeachGate =
  | "login"
  | "mfa"
  | "captcha"
  | "certification"
  | "signature"
  | "payment"
  | "submit"
  | "upload"
  | "identity";

export type TeachTier = "admin" | "partner" | "user";
export type YesNoNotSure = "yes" | "no" | "not_sure";

export interface DraftField {
  key: string;
  label: string;
  selector: string | null;
  role: "textbox" | "combobox";
  valueKind: TeachValueKind;
  required: boolean;
  /** Custom dropdown or native select: the picked option's text, if safe. */
  optionText: string;
  /** Custom dropdown: the option's own selector (for "always choose"). */
  optionSelector: string | null;
  decision:
    | { kind: "pending" }
    | { kind: "passport"; path: string }
    | { kind: "ask" }
    | { kind: "always"; option: string };
}

export interface DraftAction {
  key: string;
  role: TeachClickEvent["role"];
  label: string;
  selector: string | null;
  optionText: string;
  /** nav = plain navigation click, recorded without a question. */
  decision: "pending" | "nav" | "always" | "ask";
}

export interface DraftStep {
  id: string;
  url: string;
  title: string;
  heading: string;
  observed: boolean;
  gate: TeachGate | null;
  gateSource: "detected" | "teacher" | null;
  conditional: { path: string; equals?: string | number | boolean } | "unknown" | null;
  fields: DraftField[];
  actions: DraftAction[];
  notes: string[];
}

export type TeachQuestion =
  | { id: string; kind: "mapping"; stepId: string; fieldKey: string; label: string; proposal: MappingProposal | null; canAlwaysChoose: boolean; optionText: string }
  | { id: string; kind: "always_choose"; stepId: string; actionKey: string; label: string; optionText: string }
  | { id: string; kind: "gate"; stepId: string; gate: TeachGate; reason: BilingualText }
  | { id: string; kind: "branch"; stepId: string; title: string };

export type TeachAnswer =
  | { kind: "mapping"; choice: "confirm" }
  | { kind: "mapping"; choice: "correct"; path: string }
  | { kind: "mapping"; choice: "ask" }
  | { kind: "mapping"; choice: "always" }
  | { kind: "yes_no"; value: YesNoNotSure }
  | { kind: "branch"; path: string; equals?: string | number | boolean }
  | { kind: "branch"; notSure: true };

export interface TeachState {
  id: string;
  ownerUserId: string;
  tier: TeachTier;
  portalName: string;
  form: string;
  startUrl: string;
  steps: DraftStep[];
  questions: TeachQuestion[];
  answered: string[];
  /** Custom dropdown opened and waiting for its option click. */
  openCombobox: { label: string; selector: string | null; stepId: string } | null;
  seq: number;
}

const MFA_LABEL = /(c[oó]digo|code|token|otp|mfa|2fa|verificaci[oó]n|verification|one[- ]time)/i;
const SIGNATURE_LABEL = /\b(firma|signature|firmar|sign here)\b/i;
const IDENTITY_LABEL = /\b(ssn|seguro social|social security|itin|pasaporte|passport number|licencia de conducir|driver'?s license)\b/i;
const ATTESTATION_LABEL = /(juramento|certific|attest|perjur|acepto|i agree|declaro|afirmo|consent)/i;
const PAYMENT_TITLE = /\b(pago|pagar|payment|checkout|pay now|tarjeta|card)\b/i;

const GATE_REASON: Record<TeachGate, BilingualText> = {
  login: { en: "This looks like the sign-in screen.", es: "Esto parece la pantalla para entrar." },
  mfa: { en: "This looks like the verification-code screen.", es: "Esto parece la pantalla del código de verificación." },
  captcha: { en: "This screen has a CAPTCHA.", es: "Esta pantalla tiene un CAPTCHA." },
  certification: { en: "This looks like a legal certification or agreement.", es: "Esto parece una certificación o acuerdo legal." },
  signature: { en: "This looks like a signature.", es: "Esto parece una firma." },
  payment: { en: "This looks like the payment screen.", es: "Esto parece la pantalla de pago." },
  submit: { en: "This looks like the final submit (Radicar).", es: "Esto parece el envío final (Radicar)." },
  upload: { en: "This screen asks for documents.", es: "Esta pantalla pide documentos." },
  identity: { en: "This screen asks for a Social Security or ID number.", es: "Esta pantalla pide un número de Seguro Social o identificación." },
};

export function gateReason(gate: TeachGate): BilingualText {
  return GATE_REASON[gate];
}

/** Gates whose screens Clara never records anything on. */
const EXCLUSIVE_GATES: TeachGate[] = ["login", "mfa", "captcha"];

export function newTeachState(input: {
  id: string;
  ownerUserId: string;
  tier: TeachTier;
  portalName: string;
  form: string;
  startUrl: string;
}): TeachState {
  return { ...input, steps: [], questions: [], answered: [], openCombobox: null, seq: 0 };
}

export function openQuestions(state: TeachState): TeachQuestion[] {
  const done = new Set(state.answered);
  return state.questions.filter((q) => !done.has(q.id));
}

function clone(state: TeachState): TeachState {
  return JSON.parse(JSON.stringify(state)) as TeachState;
}

function slug(text: string): string {
  return normalizeLabel(text).replace(/ñ/g, "n").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "pantalla";
}

function pageKey(url: string, heading: string, title: string): string {
  const u = new URL(url);
  return `${u.host}${u.pathname}${u.hash}|${heading || title}`;
}

function currentStep(state: TeachState): DraftStep | null {
  return state.steps[state.steps.length - 1] ?? null;
}

function nextId(state: TeachState, prefix: string): string {
  state.seq += 1;
  return `${prefix}${state.seq}`;
}

function uniqueStepId(state: TeachState, base: string): string {
  const ids = new Set(state.steps.map((s) => s.id));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function newStep(state: TeachState, ev: { url: string; title: string; heading: string }, observed = true): DraftStep {
  const step: DraftStep = {
    id: uniqueStepId(state, slug(ev.heading || ev.title)),
    url: ev.url,
    title: ev.title,
    heading: ev.heading,
    observed,
    gate: null,
    gateSource: null,
    conditional: null,
    fields: [],
    actions: [],
    notes: [],
  };
  state.steps.push(step);
  return step;
}

/** Ensure there is a step for the event's page (events can precede a page event). */
function stepFor(state: TeachState, url: string): DraftStep {
  return currentStep(state) ?? newStep(state, { url, title: "", heading: "" });
}

function setGate(state: TeachState, step: DraftStep, gate: TeachGate, source: "detected" | "teacher"): void {
  if (step.gate === gate) return;
  // A stronger exclusive gate (login/MFA/CAPTCHA) is never downgraded.
  if (step.gate && EXCLUSIVE_GATES.includes(step.gate) && !EXCLUSIVE_GATES.includes(gate)) return;
  step.gate = gate;
  step.gateSource = source;
  if (EXCLUSIVE_GATES.includes(gate)) {
    // Nothing on a sign-in / code / CAPTCHA screen is ever recorded.
    const dropped = new Set([...step.fields.map((f) => f.key), ...step.actions.map((a) => a.key)]);
    step.fields = [];
    step.actions = [];
    state.questions = state.questions.filter(
      (q) => !(q.stepId === step.id && ((q.kind === "mapping" && dropped.has(q.fieldKey)) || (q.kind === "always_choose" && dropped.has(q.actionKey))))
    );
  }
  state.questions = state.questions.filter((q) => !(q.kind === "gate" && q.stepId === step.id && !state.answered.includes(q.id)));
  if (source === "detected") {
    state.questions.push({ id: nextId(state, "q"), kind: "gate", stepId: step.id, gate, reason: GATE_REASON[gate] });
  }
}

function onPage(state: TeachState, ev: TeachPageEvent): void {
  const cur = currentStep(state);
  if (!cur || pageKey(cur.url, cur.heading, cur.title) !== pageKey(ev.url, ev.heading, ev.title)) {
    // The first page event may just name the placeholder step events created.
    if (cur && !cur.title && !cur.heading && cur.fields.length === 0 && cur.actions.length === 0) {
      Object.assign(cur, { url: ev.url, title: ev.title, heading: ev.heading, id: uniqueStepId({ ...state, steps: state.steps.filter((s) => s !== cur) }, slug(ev.heading || ev.title)) });
    } else {
      newStep(state, ev);
    }
    state.openCombobox = null;
  }
  const step = currentStep(state)!;
  const text = `${ev.heading} ${ev.title}`;
  if (ev.hasPassword) setGate(state, step, "login", "detected");
  else if (ev.hasCaptcha) setGate(state, step, "captcha", "detected");
  else if (PAYMENT_TITLE.test(text)) setGate(state, step, "payment", "detected");
  if (ev.hasFileInput && !step.gate) setGate(state, step, "upload", "detected");
}

function onFill(state: TeachState, ev: TeachFillEvent): void {
  const step = stepFor(state, ev.url);
  const asField = {
    portal_field: { label: ev.label, selector: ev.selector },
    passport_path: null,
    transform: null,
    required: false,
    fallback: "pause_and_ask" as const,
  };
  if (ev.valueKind === "secret") {
    // What kind of secret decides whose step this is: an SSN screen is an
    // identity step, a one-time code is MFA, a card number is payment.
    const gate: TeachGate =
      ev.secretKind === "ssn" ? "identity"
      : ev.secretKind === "code" ? "mfa"
      : ev.secretKind === "payment" ? "payment"
      : step.gate === "mfa" ? "mfa" : "login";
    return setGate(state, step, gate, "detected");
  }
  // "Código postal" / "Código NAICS" are passport fields, not a code screen.
  if (MFA_LABEL.test(ev.label) && proposeMapping(ev.label, ev.valueKind)?.confidence !== "high") {
    return setGate(state, step, "mfa", "detected");
  }
  if (IDENTITY_LABEL.test(ev.label)) return setGate(state, step, "identity", "detected");
  if (SIGNATURE_LABEL.test(ev.label)) return setGate(state, step, "signature", "detected");
  if (ev.valueKind === "file") return setGate(state, step, "upload", "detected");
  if (isSecretField(asField)) return setGate(state, step, "payment", "detected");
  if (step.gate && EXCLUSIVE_GATES.includes(step.gate)) return;

  const same = step.fields.find(
    (f) => (ev.selector && f.selector === ev.selector) || normalizeLabel(f.label) === normalizeLabel(ev.label)
  );
  if (same) {
    same.valueKind = ev.valueKind === "empty" ? same.valueKind : ev.valueKind;
    same.optionText = ev.optionText || same.optionText;
    return;
  }
  if (ev.valueKind === "empty") return; // touched but left blank: nothing to learn
  const field: DraftField = {
    key: nextId(state, "f"),
    label: ev.label,
    selector: ev.selector,
    role: ev.role,
    valueKind: ev.valueKind,
    required: ev.required,
    optionText: ev.optionText,
    optionSelector: null,
    decision: { kind: "pending" },
  };
  step.fields.push(field);
  state.questions.push({
    id: nextId(state, "q"),
    kind: "mapping",
    stepId: step.id,
    fieldKey: field.key,
    label: field.label,
    proposal: proposeMapping(field.label, field.valueKind),
    canAlwaysChoose: field.role === "combobox" && !!field.optionText,
    optionText: field.optionText,
  });
}

function onClick(state: TeachState, ev: TeachClickEvent): void {
  const step = stepFor(state, ev.url);
  if (step.gate && EXCLUSIVE_GATES.includes(step.gate)) return;
  const target = { role: ev.role === "combobox" ? ("combobox" as const) : ev.role === "option" ? ("option" as const) : ("button" as const), label_contains: ev.label, selector: ev.selector };
  if (isSubmitTarget(target)) return setGate(state, step, "submit", "detected");
  if (ev.role === "checkbox" && ATTESTATION_LABEL.test(ev.label)) return setGate(state, step, "certification", "detected");
  if (SIGNATURE_LABEL.test(ev.label) && ev.role !== "link") return setGate(state, step, "signature", "detected");
  if (/\b(pagar|pay now|make payment|realizar pago)\b/i.test(ev.label)) return setGate(state, step, "payment", "detected");

  if (ev.role === "combobox") {
    state.openCombobox = { label: ev.label, selector: ev.selector, stepId: step.id };
    return;
  }
  if (ev.role === "option" && state.openCombobox && state.openCombobox.stepId === step.id) {
    // Custom dropdown: combobox click + option click = one field.
    const combo = state.openCombobox;
    state.openCombobox = null;
    const existing = step.fields.find((f) => normalizeLabel(f.label) === normalizeLabel(combo.label));
    if (existing) {
      existing.optionText = ev.optionText;
      existing.optionSelector = ev.selector;
      return;
    }
    const field: DraftField = {
      key: nextId(state, "f"),
      label: combo.label,
      selector: combo.selector,
      role: "combobox",
      valueKind: "option",
      required: false,
      optionText: ev.optionText,
      optionSelector: ev.selector,
      decision: { kind: "pending" },
    };
    step.fields.push(field);
    state.questions.push({
      id: nextId(state, "q"),
      kind: "mapping",
      stepId: step.id,
      fieldKey: field.key,
      label: field.label,
      proposal: proposeMapping(field.label, "option"),
      canAlwaysChoose: !!field.optionText,
      optionText: field.optionText,
    });
    return;
  }

  const choice = ev.role === "radio" || ev.role === "checkbox" || ev.role === "option";
  const existing = step.actions.find((a) => normalizeLabel(a.label) === normalizeLabel(ev.label) && a.role === ev.role);
  if (existing) return;
  const action: DraftAction = {
    key: nextId(state, "a"),
    role: ev.role,
    label: ev.label,
    selector: ev.selector,
    optionText: ev.optionText,
    decision: choice ? "pending" : "nav",
  };
  if (choice) {
    // A second radio in the same group replaces the first pick.
    if (ev.role === "radio") {
      const prior = step.actions.filter((a) => a.role === "radio" && a.decision === "pending");
      for (const p of prior) {
        step.actions = step.actions.filter((a) => a !== p);
        state.questions = state.questions.filter((q) => !(q.kind === "always_choose" && q.actionKey === p.key));
      }
    }
    step.actions.push(action);
    state.questions.push({ id: nextId(state, "q"), kind: "always_choose", stepId: step.id, actionKey: action.key, label: action.label, optionText: action.optionText });
  } else {
    step.actions.push(action);
  }
}

/** Fold one sanitized recorder event into the session. */
export function applyTeachEvent(state: TeachState, ev: TeachEvent): TeachState {
  const next = clone(state);
  if (ev.kind === "page") onPage(next, ev);
  else if (ev.kind === "fill") onFill(next, ev);
  else onClick(next, ev);
  return next;
}

export class TeachAnswerError extends Error {}

/** Record the teacher's answer to one open question. */
export function answerQuestion(state: TeachState, questionId: string, answer: TeachAnswer): TeachState {
  const next = clone(state);
  const q = next.questions.find((x) => x.id === questionId);
  if (!q) throw new TeachAnswerError("unknown question");
  if (next.answered.includes(q.id)) throw new TeachAnswerError("already answered");
  const step = next.steps.find((s) => s.id === q.stepId);
  if (!step) throw new TeachAnswerError("unknown step");

  if (q.kind === "mapping") {
    if (answer.kind !== "mapping") throw new TeachAnswerError("expected a mapping answer");
    const field = step.fields.find((f) => f.key === q.fieldKey);
    if (!field) throw new TeachAnswerError("unknown field");
    if (answer.choice === "confirm") {
      if (!q.proposal) throw new TeachAnswerError("nothing to confirm — pick a field or choose ask");
      field.decision = { kind: "passport", path: q.proposal.path };
    } else if (answer.choice === "correct") {
      if (!catalogEntry(answer.path)) throw new TeachAnswerError("unknown passport field");
      field.decision = { kind: "passport", path: answer.path };
    } else if (answer.choice === "always") {
      if (!q.canAlwaysChoose || !field.optionText) throw new TeachAnswerError("nothing to always choose");
      field.decision = { kind: "always", option: field.optionText };
    } else {
      field.decision = { kind: "ask" };
    }
  } else if (q.kind === "always_choose") {
    if (answer.kind !== "yes_no") throw new TeachAnswerError("expected Yes / No / Not Sure");
    const action = step.actions.find((a) => a.key === q.actionKey);
    if (!action) throw new TeachAnswerError("unknown action");
    action.decision = answer.value === "yes" ? "always" : "ask";
  } else if (q.kind === "gate") {
    if (answer.kind !== "yes_no") throw new TeachAnswerError("expected Yes / No / Not Sure");
    // Not Sure keeps the gate: when in doubt, the human does it.
    if (answer.value === "no" && step.gate === q.gate) {
      step.gate = null;
      step.gateSource = null;
    }
  } else {
    if (answer.kind !== "branch") throw new TeachAnswerError("expected a branch answer");
    if ("notSure" in answer) {
      step.conditional = "unknown";
    } else {
      if (!catalogEntry(answer.path)) throw new TeachAnswerError("unknown passport field");
      step.conditional = answer.equals === undefined ? { path: answer.path } : { path: answer.path, equals: answer.equals };
    }
  }
  next.answered.push(q.id);
  return next;
}

/** Teacher marks a screen as a human-only step (overrides detection). */
export function markStepGate(state: TeachState, stepId: string, gate: TeachGate | null): TeachState {
  const next = clone(state);
  const step = next.steps.find((s) => s.id === stepId);
  if (!step) throw new TeachAnswerError("unknown step");
  if (gate === null) {
    step.gate = null;
    step.gateSource = null;
    next.questions = next.questions.filter((q) => !(q.kind === "gate" && q.stepId === stepId && !next.answered.includes(q.id)));
    return next;
  }
  setGate(next, step, gate, "teacher");
  return next;
}

/** Teacher says a screen only shows up sometimes → ask what drives it. */
export function markStepConditional(state: TeachState, stepId: string): TeachState {
  const next = clone(state);
  const index = next.steps.findIndex((s) => s.id === stepId);
  if (index < 1) throw new TeachAnswerError("the first screen can't be conditional");
  const step = next.steps[index];
  if (next.questions.some((q) => q.kind === "branch" && q.stepId === stepId)) return next;
  next.questions.push({ id: nextId(next, "q"), kind: "branch", stepId, title: step.heading || step.title });
  return next;
}

/** Teacher adds a screen they did not walk through (e.g. payment). */
export function addSkippedStep(state: TeachState, input: { title: string; gate: TeachGate | null }): TeachState {
  const next = clone(state);
  const title = input.title.trim().slice(0, 120);
  if (!title) throw new TeachAnswerError("title required");
  const last = currentStep(next);
  const step = newStep(next, { url: last?.url ?? next.startUrl, title, heading: title }, false);
  if (input.gate) setGate(next, step, input.gate, "teacher");
  next.openCombobox = null;
  return next;
}
