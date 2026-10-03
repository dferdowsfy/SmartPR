/**
 * Live skill replays (server memory, owner-gated) — match → preflight plan
 * → the human confirms → gated execution in the user's replay browser →
 * human review and submit (Teach Clara spec §6).
 *
 * Passport values and the human's answers live only in this process for
 * the run; the view carries labels, milestones and the pause, never values.
 * Answers are dropped as soon as Clara has used them (after each advance),
 * and sensitive one-time values (password, SSN, verification code) never
 * enter the session at all: `secureInputReplay` hands them straight to the
 * worker, which types them into the portal's field.
 * Drift marks a library skill needs_reteach (bundled skills flag their
 * portal instead — they're fixed in code review).
 */
import { randomUUID } from "node:crypto";
import type { Skill } from "../skills/skill";
import { bundledRef, bundledSkill, BUNDLED_SKILLS } from "../skills/bundled";
import { getVisibleSkill, markNeedsReteach, matchSkill, portalHost, type SkillRepo, type SkillViewer } from "../skills/skillLibrary";
import { normalizeLabel } from "../teach/passportCatalog";
import { teachDomainDecision } from "../teach/domains";
import { advanceReplay, newReplayState, stopReplay, type PortalDriver, type ReplayPause, type ReplayState } from "./engine";
import { planReplay, type PreflightPlan } from "./preflight";

export interface ReplayDeps {
  repo: SkillRepo;
  startDrive(input: { startUrl: string; allowedDomains: string[] }): Promise<{ sessionId: string; liveUrl: string | null }>;
  driver(sessionId: string): PortalDriver;
  stopDrive(sessionId: string): Promise<void>;
  /** Strict replay: re-locate a drifted control (labels only), else pause. */
  relocate?: import("./relocate").Relocator;
  /** Type a one-time sensitive value into the replay browser; the worker keeps no copy. */
  secureFill?(sessionId: string, input: { value: string; selector: string | null }): Promise<{ ok: boolean; reason?: string }>;
  /** Protected Passport details (SSN / ITIN), read only at fill time. */
  passportStore?: import("../passportWrite").PassportStore;
}

export interface SkillRef {
  ref: string;
  rowId: string | null;
  skill: Skill;
  attribution: "smartpr" | "partner" | "you";
}

interface LiveReplay {
  id: string;
  ownerUserId: string;
  businessId: string | null;
  skillRef: SkillRef;
  passport: unknown;
  plan: PreflightPlan;
  status: "planned" | "running" | "paused" | "review" | "done" | "stopped";
  state: ReplayState;
  answers: Record<string, string>;
  driveSessionId: string | null;
  liveUrl: string | null;
}

export interface ReplayView {
  id: string;
  status: LiveReplay["status"];
  skill: { ref: string; form: string; portal: string; base_url: string; version: number; attribution: SkillRef["attribution"] };
  plan: PreflightPlan;
  pause: ReplayPause | null;
  milestones: ReplayState["milestones"];
  live_url: string | null;
  /** Sensitive inputs on the paused screen (labels/selectors) — for the masked one-time card. */
  secret_fields: NonNullable<ReplayState["pauseSecretFields"]>;
}

const g = globalThis as typeof globalThis & { __smartprReplays?: Map<string, LiveReplay> };
const replays = () => (g.__smartprReplays ??= new Map());

export class ReplayError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

function viewOf(r: LiveReplay): ReplayView {
  return {
    id: r.id,
    status: r.status,
    skill: { ref: r.skillRef.ref, form: r.skillRef.skill.form, portal: r.skillRef.skill.portal.name, base_url: r.skillRef.skill.portal.base_url, version: r.skillRef.skill.version, attribution: r.skillRef.attribution },
    plan: r.plan,
    pause: r.state.pause,
    milestones: r.state.milestones,
    live_url: r.status === "running" || r.status === "paused" || r.status === "review" ? r.liveUrl : null,
    secret_fields: r.status === "paused" || r.status === "review" ? r.state.pauseSecretFields ?? [] : [],
  };
}

function owned(viewer: SkillViewer, id: string): LiveReplay {
  const r = replays().get(id);
  if (!r || r.ownerUserId !== viewer.userId) throw new ReplayError(404, "not_found", "Replay not found.");
  return r;
}

/** The skill to replay for a portal + form (spec §6.1): library first, then bundled. */
export async function findSkillFor(repo: SkillRepo, viewer: SkillViewer, input: { host: string; form: string; filingTypeId?: string | null }): Promise<SkillRef | null> {
  const row = await matchSkill(repo, viewer, input.host, input.form);
  if (row?.scope === "shared") return { ref: row.id, rowId: row.id, skill: row.skill, attribution: row.taught_by === "admin" ? "smartpr" : "partner" };
  const host = input.host.replace(/^www\./, "").toLowerCase();
  const bundled = BUNDLED_SKILLS.filter(
    (s) => s.status === "approved" && ((input.filingTypeId && s.filing_type_id === input.filingTypeId) || (portalHost(s) === host && normalizeLabel(s.form) === normalizeLabel(input.form)))
  ).sort((a, b) => b.version - a.version)[0];
  if (bundled) return { ref: bundledRef(bundled), rowId: null, skill: bundled, attribution: "smartpr" };
  if (row) return { ref: row.id, rowId: row.id, skill: row.skill, attribution: "you" };
  return null;
}

async function resolveRef(repo: SkillRepo, viewer: SkillViewer, ref: string): Promise<SkillRef> {
  if (ref.startsWith("bundled:")) {
    const skill = bundledSkill(ref);
    // Unapproved bundled skills are for the SmartPR team's own rehearsals.
    if (!skill || (skill.status !== "approved" && !viewer.isAdmin)) throw new ReplayError(404, "not_found", "Skill not found.");
    return { ref, rowId: null, skill, attribution: "smartpr" };
  }
  const row = await getVisibleSkill(repo, viewer, ref);
  if (!row || row.status === "rejected") throw new ReplayError(404, "not_found", "Skill not found.");
  if (row.status === "needs_reteach") throw new ReplayError(409, "needs_reteach", "This skill needs to be taught again — the portal changed.");
  const attribution = row.owner_user_id === viewer.userId && row.scope === "private" ? "you" : row.taught_by === "admin" ? "smartpr" : "partner";
  return { ref, rowId: row.id, skill: row.skill, attribution };
}

export async function planReplaySession(deps: ReplayDeps, viewer: SkillViewer, input: { ref: string; businessId: string | null; passport: unknown }): Promise<ReplayView> {
  const skillRef = await resolveRef(deps.repo, viewer, input.ref);
  const health = await deps.repo.portalHealth(portalHost(skillRef.skill));
  const plan = planReplay(skillRef.skill, input.passport, health && health.status !== "ok" ? { status: health.status, detail: health.detail } : { status: "ok", detail: null });
  const r: LiveReplay = {
    id: randomUUID(),
    ownerUserId: viewer.userId,
    businessId: input.businessId,
    skillRef,
    passport: input.passport,
    plan,
    status: "planned",
    state: newReplayState(skillRef.skill),
    answers: {},
    driveSessionId: null,
    liveUrl: null,
  };
  replays().set(r.id, r);
  return viewOf(r);
}

async function step(deps: ReplayDeps, r: LiveReplay): Promise<void> {
  const next = await advanceReplay(r.state, {
    skill: r.skillRef.skill,
    passport: r.passport,
    driver: deps.driver(r.driveSessionId!),
    answers: r.answers,
    relocate: deps.relocate,
    protectedValue: deps.passportStore && r.businessId
      ? (path: string) => deps.passportStore!.readProtected({ businessId: r.businessId!, userId: r.ownerUserId, path })
      : undefined,
    onDrift: async (d) => {
      const report = `${d.reason} on "${d.expected}" (${d.detail}); saw "${d.seen.heading || d.seen.title}"`;
      if (r.skillRef.rowId) await markNeedsReteach(deps.repo, r.skillRef.rowId, report);
      else await deps.repo.setPortalHealth(portalHost(r.skillRef.skill), "portal_changed", report.slice(0, 500));
    },
  });
  r.state = next;
  // Answers are used once, on this advance; nothing typed lingers in memory.
  r.answers = {};
  r.status = next.status === "done" ? "done" : next.status === "stopped" ? "stopped" : next.pause?.kind === "gate" && next.pause.gate === "submit" ? "review" : next.status === "paused" ? "paused" : "running";
}

/** The human confirmed the plan: open the replay browser and start. */
export async function startReplaySession(deps: ReplayDeps, viewer: SkillViewer, id: string): Promise<ReplayView> {
  const r = owned(viewer, id);
  if (r.status !== "planned") throw new ReplayError(409, "already_started", "This replay already started.");
  // One replay browser per person: close any earlier one they left open
  // (the worker runs one session at a time).
  for (const other of replays().values()) {
    if (other.id !== r.id && other.ownerUserId === viewer.userId && other.driveSessionId && (other.status === "running" || other.status === "paused" || other.status === "review")) {
      await deps.stopDrive(other.driveSessionId).catch(() => undefined);
      other.state = stopReplay(other.state);
      other.status = "stopped";
      other.answers = {};
    }
  }
  const decision = teachDomainDecision(r.skillRef.skill.portal.base_url, { isAdmin: true });
  if (!decision.ok) throw new ReplayError(400, decision.reason, decision.message.en);
  let drive: { sessionId: string; liveUrl: string | null };
  try {
    drive = await deps.startDrive({ startUrl: r.skillRef.skill.portal.base_url, allowedDomains: decision.allowedDomains });
  } catch (err) {
    const msg = String((err as Error)?.message ?? "");
    if (/ 409:/.test(msg) || (err as { status?: number })?.status === 409) throw new ReplayError(409, "worker_busy", "Clara's browser is busy with another session. Try again in a few minutes.");
    throw new ReplayError(503, "worker_unreachable", "Clara's browser didn't answer, so the replay couldn't start. Try again in a moment.");
  }
  r.driveSessionId = drive.sessionId;
  r.liveUrl = drive.liveUrl;
  r.status = "running";
  await step(deps, r);
  return viewOf(r);
}

/** The human did their part (or answered): continue. */
export async function continueReplaySession(deps: ReplayDeps, viewer: SkillViewer, id: string, answers: Record<string, string> = {}): Promise<ReplayView> {
  const r = owned(viewer, id);
  if (!r.driveSessionId || r.status === "planned") throw new ReplayError(409, "not_started", "Start the replay first.");
  if (r.status === "done" || r.status === "stopped") return viewOf(r);
  const allowed = new Set(r.state.pause?.kind === "ask" ? r.state.pause.fields.map((f) => f.key) : []);
  for (const [k, v] of Object.entries(answers)) if (allowed.has(k) && typeof v === "string") r.answers[k] = v.slice(0, 500);
  await step(deps, r);
  return viewOf(r);
}

/**
 * One-time sensitive input (password, SSN, verification code) for the
 * screen Clara paused on: straight to the replay browser, never stored.
 */
export async function secureInputReplay(deps: ReplayDeps, viewer: SkillViewer, id: string, input: { value: string; selector: string | null }): Promise<{ ok: boolean; reason: string | null }> {
  const r = owned(viewer, id);
  if (!r.driveSessionId || r.status !== "paused") throw new ReplayError(409, "not_paused", "Clara isn't waiting for that right now.");
  if (!deps.secureFill) throw new ReplayError(503, "worker_outdated", "Clara's browser can't take secure input yet.");
  if (typeof input.value !== "string" || !input.value || input.value.length > 256) throw new ReplayError(400, "bad_value", "Type the value first.");
  const selector = input.selector && (r.state.pauseSecretFields ?? []).some((f) => f.selector === input.selector) ? input.selector : null;
  try {
    const out = await deps.secureFill(r.driveSessionId, { value: input.value, selector });
    return { ok: out.ok === true, reason: out.ok ? null : out.reason ?? "no_field" };
  } catch {
    throw new ReplayError(503, "worker_unreachable", "Clara's browser didn't answer.");
  }
}

export async function stopReplaySession(deps: ReplayDeps, viewer: SkillViewer, id: string): Promise<ReplayView> {
  const r = owned(viewer, id);
  if (r.driveSessionId) await deps.stopDrive(r.driveSessionId).catch(() => undefined);
  r.state = stopReplay(r.state);
  r.status = "stopped";
  r.answers = {};
  return viewOf(r);
}

export function getReplaySession(viewer: SkillViewer, id: string): ReplayView {
  return viewOf(owned(viewer, id));
}

export function resetReplaysForTests(): void {
  replays().clear();
}
