/**
 * Live teach sessions (server memory, like agency runs) — the glue between
 * the worker's recorder, the teach-session state machine and the skill
 * library. Owner-gated: every call takes the signed-in viewer.
 *
 * Passport values are loaded once per session only to build the scrub list
 * for sanitizeTeachEvent; they are never stored on the session view,
 * returned to the client or written into a skill.
 *
 * Sensitive values (passwords, SSNs, one-time codes) never pass through
 * here except on their way to the worker in `secureFillTeach`, which keeps
 * no copy. Per-step screenshots are served through SmartPR's owner-gated
 * proxy (`teachShot`); the worker's viewer token never reaches the client
 * through the action log.
 */
import { randomUUID } from "node:crypto";
import { passportScrubValues, sanitizeTeachEvent, type PageFieldRef, type SecretFieldRef } from "./events";
import {
  addSkippedStep,
  answerQuestion,
  applyTeachEvent,
  markStepConditional,
  markStepGate,
  newTeachState,
  openQuestions,
  type TeachAnswer,
  type TeachGate,
  type TeachQuestion,
  type TeachState,
  type TeachTier,
} from "./teachSession";
import { buildSkillFromTeach, type BuildResult } from "./buildSkill";
import { bindRecordedActions, normalizeRecorderItems, type RecordedAction } from "./recording";
import { llmReviewRoutine, validateRoutine, withLlmNotes, type LlmReviewer, type RoutineValidation } from "./validateRoutine";
import { passportFieldName } from "../skills/skillCard";
import { additionalDetailPath, catalogEntry, catalogEntryApplies, passportHas, proposeMapping, protectedMarkerPaths, readPassportPath, setPassportPath } from "./passportCatalog";
import { normalizeValue, PassportWriteError, writablePath, type PassportStore } from "../passportWrite";
import { teachDomainDecision } from "./domains";
import { skillCard, type SkillCard } from "../skills/skillCard";
import {
  SkillLibraryError,
  saveTaughtSkill,
  submitForReview,
  type SkillRepo,
  type SkillViewer,
  type StoredSkill,
} from "../skills/skillLibrary";

export interface TeachWorker {
  start(input: { startUrl: string; allowedDomains: string[] }): Promise<{ sessionId: string; liveUrl: string | null }>;
  /** `shot`: the worker kept a screenshot for this step; `screenshot`: legacy workers' direct URL. */
  events(sessionId: string, after: number): Promise<{ items: { seq: number; event: unknown; shot?: boolean; screenshot?: unknown }[]; nextAfter: number; status: string }>;
  stop(sessionId: string): Promise<void>;
  /** Type a one-time sensitive value into the live portal; the worker keeps no copy. */
  secureFill?(sessionId: string, input: { value: string; selector: string | null }): Promise<{ ok: boolean; reason?: string }>;
  /** A step's screenshot bytes (server-side, authenticated). */
  shot?(sessionId: string, seq: number): Promise<ArrayBuffer | null>;
}

/** Where the person is in the walkthrough — the chat's stage line. */
export type TeachStage = "recording" | "your_turn" | "mapping" | "ready_to_review" | "reviewing" | "saved";

interface LiveTeach {
  state: TeachState;
  businessId: string | null;
  workerSessionId: string;
  liveUrl: string | null;
  cursor: number;
  secrets: string[];
  status: "recording" | "finished" | "saved";
  savedSkillId: string | null;
  workerStatus: string;
  createdAt: number;
  /** Record-first Teach: the flat action log (navigate/click/type/select/upload/wait). */
  actions: RecordedAction[];
  /** The checklist requirement this recording teaches (row → routine). */
  requirementKey: string | null;
  /** Last validation; cleared whenever the routine changes. */
  validation: RoutineValidation | null;
  /** Agency (for the routine's metadata). */
  agency: string | null;
  /** Sensitive inputs on the current screen (labels/selectors only). */
  secretFields: SecretFieldRef[];
  /** Every visible input on the current screen (labels/selectors only). */
  pageFields: PageFieldRef[];
  /** The business's Passport (server memory only — never in the view) for "fill from Passport". */
  passport: unknown;
  /** Step seqs whose screenshot the worker kept, and legacy direct URLs (server-side only). */
  shotSeqs: Set<number>;
  legacyShotUrls: Map<number, string>;
}

export interface TeachSessionView {
  id: string;
  status: LiveTeach["status"];
  live_url: string | null;
  portal_name: string;
  form: string;
  start_url: string;
  steps: {
    id: string;
    title: string;
    observed: boolean;
    gate: TeachGate | null;
    conditional: boolean;
    fields: { key: string; label: string; decided: boolean; binding: { kind: "passport"; path: string; name: { en: string; es: string } } | { kind: "ask" } | { kind: "always"; option: string } | { kind: "pending" } }[];
    choices: string[];
    clicks: { key: string; label: string; role: string }[];
  }[];
  questions: TeachQuestion[];
  answered: number;
  saved_skill_id: string | null;
  /** Everything the person did, in order, with what each typed value is bound to. */
  actions: RecordedAction[];
  requirement_key: string | null;
  validation: RoutineValidation | null;
  worker_status: string;
  agency: string | null;
  stage: TeachStage;
  /** Sensitive inputs visible on the portal's current screen — where a secure one-time value can go. */
  secret_fields: SecretFieldRef[];
  /** Every visible input on the portal's current screen — the person can type into it from the chat. */
  page_fields: (PageFieldRef & { suggestion: PageFieldSuggestion | null })[];
  /** Whether Passport details can be saved from here (the session belongs to a saved business). */
  can_save_passport: boolean;
  /** The human-only step the current screen is (login, MFA, CAPTCHA, payment …), if any. */
  current_gate: TeachGate | null;
}

/**
 * How a screen field relates to the Business Passport:
 *  - ready:  mapped, value on file — Clara can fill it
 *  - needed: mapped, value missing — the person can add it here
 *  - new:    no canonical mapping yet — the person can add it as a new Passport detail
 * Never carries the value itself (only a masked preview for "ready").
 */
export interface PageFieldSuggestion {
  path: string;
  name: { en: string; es: string };
  on_file: boolean;
  status: "ready" | "needed" | "new";
  sensitive: boolean;
  preview: string | null;
}

const globalStore = globalThis as typeof globalThis & { __smartprTeachSessions?: Map<string, LiveTeach> };
function sessions(): Map<string, LiveTeach> {
  if (!globalStore.__smartprTeachSessions) globalStore.__smartprTeachSessions = new Map();
  return globalStore.__smartprTeachSessions;
}

export class TeachSessionError extends Error {
  constructor(public status: number, public code: string, message: string, public detail?: unknown) {
    super(message);
  }
}

function owned(id: string, viewer: SkillViewer): LiveTeach {
  const live = sessions().get(id);
  if (!live || live.state.ownerUserId !== viewer.userId) throw new TeachSessionError(404, "not_found", "Teach session not found.");
  return live;
}

function stageOf(live: LiveTeach): TeachStage {
  if (live.status === "saved") return "saved";
  if (live.status === "finished") return live.validation ? "reviewing" : "ready_to_review";
  const cur = live.state.steps.at(-1);
  if (cur?.gate && cur.gate !== "submit") return "your_turn";
  if (openQuestions(live.state).length) return "mapping";
  return "recording";
}

export function viewOf(live: LiveTeach): TeachSessionView {
  const s = live.state;
  const cur = s.steps.at(-1) ?? null;
  return {
    id: s.id,
    status: live.status,
    live_url: live.status === "recording" ? live.liveUrl : null,
    portal_name: s.portalName,
    form: s.form,
    start_url: s.startUrl,
    steps: s.steps.map((st) => ({
      id: st.id,
      title: st.heading || st.title || st.id,
      observed: st.observed,
      gate: st.gate,
      conditional: st.conditional !== null || s.questions.some((q) => q.kind === "branch" && q.stepId === st.id),
      fields: st.fields.map((f) => ({
        key: f.key,
        label: f.label,
        decided: f.decision.kind !== "pending",
        binding:
          f.decision.kind === "passport" ? { kind: "passport" as const, path: f.decision.path, name: passportFieldName(f.decision.path) }
          : f.decision.kind === "ask" ? { kind: "ask" as const }
          : f.decision.kind === "always" ? { kind: "always" as const, option: f.decision.option }
          : { kind: "pending" as const },
      })),
      choices: st.actions.filter((a) => a.decision !== "nav").map((a) => a.label),
      clicks: st.actions.map((a) => ({ key: a.key, label: a.label, role: a.role })),
    })),
    questions: openQuestions(s),
    answered: s.answered.length,
    saved_skill_id: live.savedSkillId,
    actions: bindRecordedActions(live.actions ?? [], s),
    requirement_key: live.requirementKey ?? null,
    validation: live.validation ?? null,
    worker_status: live.workerStatus,
    agency: live.agency ?? null,
    stage: stageOf(live),
    secret_fields: live.status === "recording" ? live.secretFields ?? [] : [],
    page_fields: live.status === "recording" ? (live.pageFields ?? []).map((f) => withSuggestion(f, live.passport)) : [],
    can_save_passport: Boolean(live.businessId),
    current_gate: live.status === "recording" ? cur?.gate ?? null : null,
  };
}

/**
 * The Passport field a screen field looks like (Spanish or English label) —
 * and whether this business has it. Never the value. Passwords, one-time
 * codes and payment fields are never Passport details; SSN / ITIN fields map
 * to the protected contact.taxId.
 */
function suggestionFor(f: PageFieldRef, passport: unknown): { path: string; value: string | null; sensitive: boolean; status: PageFieldSuggestion["status"] } | null {
  if (f.kind === "password" || f.kind === "code" || f.kind === "payment") return null;
  const p = f.kind === "ssn" ? { path: "contact.taxId", confidence: "high" as const } : proposeMapping(f.label, "text");
  if (p && p.confidence === "high") {
    const entry = catalogEntry(p.path);
    // Conditional details (LLC member count) only when the Passport says they apply — or doesn't know yet.
    if (entry?.when && passport && readPassportPath(passport, entry.when.path) && !catalogEntryApplies(entry, passport)) return null;
    const sensitive = Boolean(entry?.sensitive);
    if (sensitive) {
      const has = passportHas(passport, p.path);
      const last4 = has ? readPassportPath(passport, protectedMarkerPaths(p.path).last4) : null;
      return { path: p.path, value: has ? `•••-••-${typeof last4 === "string" ? last4 : "••••"}` : null, sensitive, status: has ? "ready" : "needed" };
    }
    const v = passport ? readPassportPath(passport, p.path) : undefined;
    const value = v === undefined || v === null || v === "" || typeof v === "object" ? null : String(v);
    return { path: p.path, value, sensitive, status: value !== null ? "ready" : "needed" };
  }
  if (f.kind !== "text") return null;
  const extra = additionalDetailPath(f.label);
  if (!extra) return null;
  const v = passport ? readPassportPath(passport, extra) : undefined;
  const value = v === undefined || v === null || v === "" || typeof v === "object" ? null : String(v);
  return { path: extra, value, sensitive: false, status: value !== null ? "ready" : "new" };
}

function withSuggestion(f: PageFieldRef, passport: unknown) {
  const s = suggestionFor(f, passport);
  return {
    ...f,
    suggestion: s
      // Values never travel in the session view: only the detail's name,
      // plus the masked last 4 for a protected detail on file.
      ? { path: s.path, name: passportFieldName(s.path), on_file: s.value !== null, status: s.status, sensitive: s.sensitive, preview: s.sensitive && s.value !== null ? s.value : null }
      : null,
  };
}

/**
 * Save one missing Passport detail from Teach Clara. The Passport stays the
 * single source of truth: the value goes to the business's Passport (SSN /
 * ITIN to the protected store), the session's in-memory Passport and scrub
 * list are refreshed so Clara can fill it now and the recording never keeps
 * it, and nothing about the value goes into the routine (which only maps
 * portal field → Passport path).
 */
export async function savePassportFieldTeach(
  deps: { passportStore: PassportStore },
  viewer: SkillViewer,
  id: string,
  input: { path: string; value: string }
): Promise<{ ok: true; path: string; name: { en: string; es: string }; preview: string; session: TeachSessionView }> {
  const live = owned(id, viewer);
  if (!live.businessId) throw new TeachSessionError(409, "no_business", "Save the business first so its Passport can keep this detail.");
  const path = input.path.trim();
  if (!writablePath(path)) throw new TeachSessionError(400, "unknown_detail", "That Passport detail can't be saved here.");
  const raw = String(input.value ?? "").slice(0, 256);
  if (!raw.trim()) throw new TeachSessionError(400, "empty", "Type a value first.");
  let preview: string;
  try {
    ({ preview } = await deps.passportStore.save({ businessId: live.businessId, userId: viewer.userId, path, value: raw }));
  } catch (err) {
    if (err instanceof PassportWriteError) throw new TeachSessionError(err.status, err.code, err.message);
    throw err;
  }
  const normalized = normalizeValue(path, raw);
  const passport = (live.passport && typeof live.passport === "object" ? live.passport : {}) as Record<string, unknown>;
  if (catalogEntry(path)?.sensitive) {
    const m = protectedMarkerPaths(path);
    setPassportPath(passport, m.onFile, true);
    setPassportPath(passport, m.last4, String(normalized).slice(-4));
  } else {
    setPassportPath(passport, path, normalized);
  }
  live.passport = passport;
  // The recorder must never keep this value if it's typed on the page later.
  const value = String(normalized).trim();
  if (value.length >= 3 && !live.secrets.includes(value)) live.secrets = [...live.secrets, value].sort((a, b) => b.length - a.length);
  sessions().set(id, live);
  return { ok: true, path, name: passportFieldName(path), preview, session: viewOf(live) };
}

/** Fill one field on the current screen from the business's Passport (typed by the browser; nothing returned). */
export async function fillFromPassportTeach(deps: { worker: TeachWorker; passportStore?: PassportStore }, viewer: SkillViewer, id: string, selector: string): Promise<{ ok: boolean; reason: string | null }> {
  const live = owned(id, viewer);
  if (live.status !== "recording") throw new TeachSessionError(409, "not_recording", "The portal browser is closed.");
  const field = (live.pageFields ?? []).find((f) => f.selector === selector);
  const s = field ? suggestionFor(field, live.passport) : null;
  if (!s || s.value === null) return { ok: false, reason: "not_on_file" };
  if (!deps.worker.secureFill) throw new TeachSessionError(503, "worker_outdated", "The recording browser can't type for you yet.");
  // Protected details are read from the protected store only now, at fill time.
  let value = s.value;
  if (s.sensitive) {
    const secret = deps.passportStore && live.businessId ? await deps.passportStore.readProtected({ businessId: live.businessId, userId: viewer.userId, path: s.path }) : null;
    if (!secret) return { ok: false, reason: "not_on_file" };
    value = secret;
  }
  try {
    const out = await deps.worker.secureFill(live.workerSessionId, { value: value.slice(0, 256), selector });
    return { ok: out.ok === true, reason: out.ok ? null : out.reason ?? "no_field" };
  } catch (err) {
    throw workerFailure(err);
  }
}

/** The owner-gated proxy path for one step's screenshot (no worker token). */
export function teachShotPath(sessionId: string, seq: number): string {
  return `/api/teach-sessions/${encodeURIComponent(sessionId)}/shots/${seq}`;
}

/** Map a worker failure to a specific, person-facing teach error. */
function workerFailure(err: unknown): TeachSessionError {
  const status = Number((err as { status?: unknown })?.status ?? NaN);
  if (status === 409) {
    return new TeachSessionError(409, "worker_busy", "Clara's recording browser is busy with another session. Try again in a few minutes.", {
      en: "Clara's recording browser is busy with another session right now. Try again in a few minutes.",
      es: "El navegador de grabación de Clara está ocupado con otra sesión. Intenta de nuevo en unos minutos.",
    });
  }
  if (status === 401 || status === 403) {
    return new TeachSessionError(503, "worker_unauthorized", "Clara's recording browser refused SmartPR's connection.", {
      en: "Clara's recording browser refused SmartPR's connection.",
      es: "El navegador de grabación de Clara rechazó la conexión de SmartPR.",
    });
  }
  if (status === 400) {
    return new TeachSessionError(400, "worker_rejected", "The recording browser couldn't open that address.", {
      en: "The recording browser couldn't open that address. Check the portal link (it must be https).",
      es: "El navegador de grabación no pudo abrir esa dirección. Revisa el enlace del portal (debe ser https).",
    });
  }
  return new TeachSessionError(503, "worker_unreachable", "Clara's recording browser didn't answer.", {
    en: "Clara's recording browser didn't answer, so the recording couldn't start. Try again in a moment.",
    es: "El navegador de grabación de Clara no respondió, así que no se pudo empezar a grabar. Intenta de nuevo en un momento.",
  });
}

export async function startTeachSession(
  deps: { worker: TeachWorker },
  input: {
    viewer: SkillViewer;
    tier: TeachTier;
    businessId: string | null;
    passport: unknown;
    startUrl: string;
    portalName: string;
    form: string;
    requirementKey?: string | null;
    agency?: string | null;
  }
): Promise<TeachSessionView> {
  const decision = teachDomainDecision(input.startUrl, { isAdmin: input.viewer.isAdmin });
  if (!decision.ok) throw new TeachSessionError(400, decision.reason, decision.message.en, decision.message);
  const form = input.form.trim().slice(0, 120);
  const portalName = (input.portalName.trim() || decision.host).slice(0, 120);
  if (!form) throw new TeachSessionError(400, "form_required", "Name the form you're about to file.");
  // One recording at a time per teacher.
  for (const [id, live] of sessions()) {
    if (live.state.ownerUserId === input.viewer.userId && live.status === "recording") {
      await deps.worker.stop(live.workerSessionId).catch(() => undefined);
      live.status = "finished";
      sessions().set(id, live);
    }
  }
  let worker: { sessionId: string; liveUrl: string | null };
  try {
    worker = await deps.worker.start({ startUrl: input.startUrl, allowedDomains: decision.allowedDomains });
  } catch (err) {
    throw workerFailure(err);
  }
  const id = randomUUID();
  const live: LiveTeach = {
    state: newTeachState({ id, ownerUserId: input.viewer.userId, tier: input.viewer.isAdmin ? "admin" : input.tier, portalName, form, startUrl: input.startUrl }),
    businessId: input.businessId,
    workerSessionId: worker.sessionId,
    liveUrl: worker.liveUrl,
    cursor: 0,
    secrets: passportScrubValues(input.passport),
    status: "recording",
    savedSkillId: null,
    workerStatus: "running",
    createdAt: Date.now(),
    actions: [],
    requirementKey: input.requirementKey ? input.requirementKey.slice(0, 120) : null,
    validation: null,
    agency: input.agency ? input.agency.trim().slice(0, 120) || null : null,
    secretFields: [],
    pageFields: [],
    passport: input.passport ?? null,
    shotSeqs: new Set(),
    legacyShotUrls: new Map(),
  };
  sessions().set(id, live);
  return viewOf(live);
}

/** Pull new recorder events from the worker and fold them in. */
export async function syncTeachSession(deps: { worker: TeachWorker }, viewer: SkillViewer, id: string): Promise<TeachSessionView> {
  const live = owned(id, viewer);
  if (live.status === "recording") {
    let batch: Awaited<ReturnType<TeachWorker["events"]>>;
    try {
      batch = await deps.worker.events(live.workerSessionId, live.cursor);
    } catch (err) {
      throw workerFailure(err);
    }
    let state = live.state;
    const items = batch.items.map((item) => {
      // Screenshots go through SmartPR's owner-gated proxy; a legacy
      // worker's direct (viewer-token) URL stays server-side.
      const legacy = typeof item.screenshot === "string" && item.screenshot ? item.screenshot : null;
      if (legacy) live.legacyShotUrls.set(item.seq, legacy);
      const has = item.shot === true || Boolean(legacy);
      if (has) live.shotSeqs.add(item.seq);
      return { seq: item.seq, event: item.event, screenshot: has ? teachShotPath(id, item.seq) : null };
    });
    for (const item of items) {
      const ev = sanitizeTeachEvent(item.event, live.secrets);
      if (!ev) continue;
      state = applyTeachEvent(state, ev);
      if (ev.kind === "page") {
        live.secretFields = ev.secretFields;
        live.pageFields = ev.inputFields;
      }
    }
    live.state = state;
    live.actions = normalizeRecorderItems(items, live.secrets, live.actions ?? []);
    live.cursor = batch.nextAfter;
    live.workerStatus = batch.status;
    if (batch.items.length) live.validation = null;
  }
  return viewOf(live);
}

function mutate(viewer: SkillViewer, id: string, fn: (s: TeachState) => TeachState): TeachSessionView {
  const live = owned(id, viewer);
  if (live.status === "saved") throw new TeachSessionError(409, "saved", "This skill is already saved.");
  try {
    live.state = fn(live.state);
    live.validation = null;
  } catch (err) {
    throw new TeachSessionError(400, "bad_answer", (err as Error).message);
  }
  return viewOf(live);
}

export function answerTeachQuestion(viewer: SkillViewer, id: string, questionId: string, answer: TeachAnswer): TeachSessionView {
  return mutate(viewer, id, (s) => answerQuestion(s, questionId, answer));
}

export type TeachStepEdit =
  | { stepId: string; gate?: TeachGate | null; conditional?: boolean }
  | { addStep: { title: string; gate: TeachGate | null } }
  /** Edit steps: drop a screen recorded by accident (or twice). */
  | { removeStep: string }
  /** Edit steps: drop one stray click. */
  | { removeAction: { stepId: string; actionKey: string } }
  /** Edit steps: re-bind a field (passport path, or null = ask each time). */
  | { rebind: { stepId: string; fieldKey: string; path: string | null } };

export function markTeachStep(viewer: SkillViewer, id: string, input: TeachStepEdit): TeachSessionView {
  return mutate(viewer, id, (s) => {
    if ("addStep" in input) return addSkippedStep(s, input.addStep);
    if ("removeStep" in input) return removeStep(s, input.removeStep);
    if ("removeAction" in input) return removeAction(s, input.removeAction.stepId, input.removeAction.actionKey);
    if ("rebind" in input) return rebindField(s, input.rebind.stepId, input.rebind.fieldKey, input.rebind.path);
    let next = s;
    if (input.gate !== undefined) next = markStepGate(next, input.stepId, input.gate);
    if (input.conditional) next = markStepConditional(next, input.stepId);
    return next;
  });
}

function removeStep(s: TeachState, stepId: string): TeachState {
  const next = JSON.parse(JSON.stringify(s)) as TeachState;
  if (!next.steps.some((x) => x.id === stepId)) throw new Error("unknown step");
  next.steps = next.steps.filter((x) => x.id !== stepId);
  next.questions = next.questions.filter((q) => q.stepId !== stepId);
  return next;
}

function removeAction(s: TeachState, stepId: string, actionKey: string): TeachState {
  const next = JSON.parse(JSON.stringify(s)) as TeachState;
  const step = next.steps.find((x) => x.id === stepId);
  if (!step || !step.actions.some((a) => a.key === actionKey)) throw new Error("unknown action");
  step.actions = step.actions.filter((a) => a.key !== actionKey);
  next.questions = next.questions.filter((q) => !(q.kind === "always_choose" && q.actionKey === actionKey));
  return next;
}

function rebindField(s: TeachState, stepId: string, fieldKey: string, path: string | null): TeachState {
  const next = JSON.parse(JSON.stringify(s)) as TeachState;
  const field = next.steps.find((x) => x.id === stepId)?.fields.find((f) => f.key === fieldKey);
  if (!field) throw new Error("unknown field");
  if (path !== null && !catalogEntry(path)) throw new Error("not a passport path");
  field.decision = path === null ? { kind: "ask" } : { kind: "passport", path };
  // The mapping question for this field is answered by the edit.
  for (const q of next.questions) if (q.kind === "mapping" && q.fieldKey === fieldKey && !next.answered.includes(q.id)) next.answered.push(q.id);
  return next;
}

/**
 * Validation step (record-first Teach): deterministic rules + simulated dry
 * run, plus the advisory LLM review when a reviewer is configured. Only a
 * passing validation lets the routine be saved as "Learned".
 */
export async function validateTeachSession(viewer: SkillViewer, id: string, opts: { reviewer?: LlmReviewer | null } = {}): Promise<{ session: TeachSessionView; validation: RoutineValidation }> {
  const live = owned(id, viewer);
  if (live.status === "recording") throw new TeachSessionError(409, "still_recording", "Finish the recording first.");
  const { skill } = buildSkillFromTeach(live.state);
  let validation = await validateRoutine(live.state, skill, live.actions ?? []);
  if (opts.reviewer) validation = withLlmNotes(validation, await llmReviewRoutine(live.state, opts.reviewer));
  live.validation = validation;
  return { session: viewOf(live), validation };
}

export interface TeachPreview {
  session: TeachSessionView;
  card: SkillCard;
  blockers: string[];
  errors: BuildResult["errors"];
}

/** Stop recording (closes the worker browser) and preview the skill card. */
export async function finishTeachSession(deps: { worker: TeachWorker }, viewer: SkillViewer, id: string): Promise<TeachPreview> {
  const live = owned(id, viewer);
  if (live.status === "recording") {
    await syncTeachSession(deps, viewer, id).catch(() => undefined);
    await deps.worker.stop(live.workerSessionId).catch(() => undefined);
    live.status = "finished";
  }
  return previewTeachSession(viewer, id);
}

export function previewTeachSession(viewer: SkillViewer, id: string): TeachPreview {
  const live = owned(id, viewer);
  const { skill, blockers, errors } = buildSkillFromTeach(live.state);
  return { session: viewOf(live), card: skillCard(skill), blockers, errors };
}

/** Save the finished session as a draft (scope by tier), optionally submitting it. */
export async function saveTeachSession(
  deps: { repo: SkillRepo },
  viewer: SkillViewer,
  id: string,
  opts: { submit: boolean; learn?: boolean; name?: string | null }
): Promise<StoredSkill> {
  const live = owned(id, viewer);
  if (opts.learn && live.validation?.status !== "pass") {
    throw new TeachSessionError(409, "not_validated", "Check the recording first — only a passing routine is saved as learned.");
  }
  if (live.status === "recording") throw new TeachSessionError(409, "still_recording", "Finish the walkthrough first.");
  if (live.status === "saved") throw new TeachSessionError(409, "saved", "This skill is already saved.");
  const { skill, blockers, errors } = buildSkillFromTeach(live.state);
  if (blockers.length) throw new TeachSessionError(409, "not_ready", blockers.join(" "), blockers);
  if (errors.length) throw new TeachSessionError(422, "invalid_skill", "The skill didn't pass its safety checks.", errors);
  try {
    let row = await saveTaughtSkill(deps.repo, viewer, skill, live.state.tier);
    if (opts.learn && live.validation) {
      const routine = {
        name: (opts.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || `${live.state.form} — ${live.state.portalName}`,
        agency: live.agency,
        requirement_key: live.requirementKey,
        portal_host: new URL(skill.portal.base_url).hostname.replace(/^www\./, "").toLowerCase(),
        start_url: live.state.startUrl,
        validation: { status: live.validation.status, errors: live.validation.errors, warnings: live.validation.warnings, checkedAt: live.validation.checkedAt },
        learned_at: new Date().toISOString(),
      };
      await deps.repo.update(row.id, { checks: { routine } });
      row = { ...row, checks: { routine } };
    }
    // Admin skills already live in the shared library; review is for private ones.
    if (opts.submit && row.scope === "private") row = await submitForReview(deps.repo, viewer, row.id);
    live.status = "saved";
    live.savedSkillId = row.id;
    return row;
  } catch (err) {
    if (err instanceof SkillLibraryError) throw new TeachSessionError(err.status, err.code, err.message);
    throw err;
  }
}

/**
 * One-time sensitive input (password, SSN, verification code): sent
 * straight to the live recording browser and dropped. Never stored on the
 * session, never logged, never part of the recording (the recorder reports
 * the field as "secret" without reading it).
 */
export async function secureFillTeach(deps: { worker: TeachWorker }, viewer: SkillViewer, id: string, input: { value: string; selector: string | null }): Promise<{ ok: boolean; reason: string | null }> {
  const live = owned(id, viewer);
  if (live.status !== "recording") throw new TeachSessionError(409, "not_recording", "The portal browser is closed.");
  if (!deps.worker.secureFill) throw new TeachSessionError(503, "worker_outdated", "The recording browser can't take secure input yet.");
  if (typeof input.value !== "string" || !input.value || input.value.length > 256) throw new TeachSessionError(400, "bad_value", "Type the value first.");
  // Only a field the recorder reported as sensitive on this screen (or the focused / first empty one).
  // Only a field the recorder reported on this screen (or the focused / first empty sensitive one).
  const known = [...(live.secretFields ?? []), ...(live.pageFields ?? [])];
  const selector = input.selector && known.some((f) => f.selector === input.selector) ? input.selector : null;
  try {
    const out = await deps.worker.secureFill(live.workerSessionId, { value: input.value, selector });
    return { ok: out.ok === true, reason: out.ok ? null : out.reason ?? "no_field" };
  } catch (err) {
    throw workerFailure(err);
  }
}

/** A step screenshot for the session's owner (proxied from the worker). */
export async function teachShot(deps: { worker: TeachWorker }, viewer: SkillViewer, id: string, seq: number): Promise<ArrayBuffer | null> {
  const live = owned(id, viewer);
  if (!live.shotSeqs?.has(seq)) return null;
  const legacy = live.legacyShotUrls?.get(seq);
  if (legacy) {
    const res = await fetch(legacy, { cache: "no-store" }).catch(() => null);
    return res && res.ok ? res.arrayBuffer() : null;
  }
  return deps.worker.shot ? deps.worker.shot(live.workerSessionId, seq) : null;
}

/** Read-only copy of a session's state (owner only) — for the live entry check. */
export function getTeachState(viewer: SkillViewer, id: string): TeachState {
  return JSON.parse(JSON.stringify(owned(id, viewer).state)) as TeachState;
}

/** Test seam. */
export function resetTeachSessionsForTests(): void {
  sessions().clear();
}
