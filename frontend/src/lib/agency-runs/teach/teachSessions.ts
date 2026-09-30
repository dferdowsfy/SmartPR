/**
 * Live teach sessions (server memory, like agency runs) — the glue between
 * the worker's recorder, the teach-session state machine and the skill
 * library. Owner-gated: every call takes the signed-in viewer.
 *
 * Passport values are loaded once per session only to build the scrub list
 * for sanitizeTeachEvent; they are never stored on the session view,
 * returned to the client or written into a skill.
 */
import { randomUUID } from "node:crypto";
import { passportScrubValues, sanitizeTeachEvent } from "./events";
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
  events(sessionId: string, after: number): Promise<{ items: { seq: number; event: unknown }[]; nextAfter: number; status: string }>;
  stop(sessionId: string): Promise<void>;
}

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
    fields: { label: string; decided: boolean }[];
    choices: string[];
  }[];
  questions: TeachQuestion[];
  answered: number;
  saved_skill_id: string | null;
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

export function viewOf(live: LiveTeach): TeachSessionView {
  const s = live.state;
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
      fields: st.fields.map((f) => ({ label: f.label, decided: f.decision.kind !== "pending" })),
      choices: st.actions.filter((a) => a.decision !== "nav").map((a) => a.label),
    })),
    questions: openQuestions(s),
    answered: s.answered.length,
    saved_skill_id: live.savedSkillId,
  };
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
  const worker = await deps.worker.start({ startUrl: input.startUrl, allowedDomains: decision.allowedDomains });
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
  };
  sessions().set(id, live);
  return viewOf(live);
}

/** Pull new recorder events from the worker and fold them in. */
export async function syncTeachSession(deps: { worker: TeachWorker }, viewer: SkillViewer, id: string): Promise<TeachSessionView> {
  const live = owned(id, viewer);
  if (live.status === "recording") {
    const batch = await deps.worker.events(live.workerSessionId, live.cursor);
    let state = live.state;
    for (const item of batch.items) {
      const ev = sanitizeTeachEvent(item.event, live.secrets);
      if (ev) state = applyTeachEvent(state, ev);
    }
    live.state = state;
    live.cursor = batch.nextAfter;
    live.workerStatus = batch.status;
  }
  return viewOf(live);
}

function mutate(viewer: SkillViewer, id: string, fn: (s: TeachState) => TeachState): TeachSessionView {
  const live = owned(id, viewer);
  if (live.status === "saved") throw new TeachSessionError(409, "saved", "This skill is already saved.");
  try {
    live.state = fn(live.state);
  } catch (err) {
    throw new TeachSessionError(400, "bad_answer", (err as Error).message);
  }
  return viewOf(live);
}

export function answerTeachQuestion(viewer: SkillViewer, id: string, questionId: string, answer: TeachAnswer): TeachSessionView {
  return mutate(viewer, id, (s) => answerQuestion(s, questionId, answer));
}

export function markTeachStep(
  viewer: SkillViewer,
  id: string,
  input: { stepId: string; gate?: TeachGate | null; conditional?: boolean } | { addStep: { title: string; gate: TeachGate | null } }
): TeachSessionView {
  return mutate(viewer, id, (s) => {
    if ("addStep" in input) return addSkippedStep(s, input.addStep);
    let next = s;
    if (input.gate !== undefined) next = markStepGate(next, input.stepId, input.gate);
    if (input.conditional) next = markStepConditional(next, input.stepId);
    return next;
  });
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
  opts: { submit: boolean }
): Promise<StoredSkill> {
  const live = owned(id, viewer);
  if (live.status === "recording") throw new TeachSessionError(409, "still_recording", "Finish the walkthrough first.");
  if (live.status === "saved") throw new TeachSessionError(409, "saved", "This skill is already saved.");
  const { skill, blockers, errors } = buildSkillFromTeach(live.state);
  if (blockers.length) throw new TeachSessionError(409, "not_ready", blockers.join(" "), blockers);
  if (errors.length) throw new TeachSessionError(422, "invalid_skill", "The skill didn't pass its safety checks.", errors);
  try {
    let row = await saveTaughtSkill(deps.repo, viewer, skill, live.state.tier);
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

/** Test seam. */
export function resetTeachSessionsForTests(): void {
  sessions().clear();
}
