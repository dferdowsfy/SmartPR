/**
 * Live skill replays (server memory, owner-gated) — match → preflight plan
 * → the human confirms → gated execution in the user's replay browser →
 * human review and submit (Teach Clara spec §6).
 *
 * Passport values and the human's answers live only in this process for
 * the run; the view carries labels, milestones and the pause, never values.
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
  skill: { ref: string; form: string; portal: string; version: number; attribution: SkillRef["attribution"] };
  plan: PreflightPlan;
  pause: ReplayPause | null;
  milestones: ReplayState["milestones"];
  live_url: string | null;
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
    skill: { ref: r.skillRef.ref, form: r.skillRef.skill.form, portal: r.skillRef.skill.portal.name, version: r.skillRef.skill.version, attribution: r.skillRef.attribution },
    plan: r.plan,
    pause: r.state.pause,
    milestones: r.state.milestones,
    live_url: r.status === "running" || r.status === "paused" || r.status === "review" ? r.liveUrl : null,
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
    onDrift: async (d) => {
      const report = `${d.reason} on "${d.expected}" (${d.detail}); saw "${d.seen.heading || d.seen.title}"`;
      if (r.skillRef.rowId) await markNeedsReteach(deps.repo, r.skillRef.rowId, report);
      else await deps.repo.setPortalHealth(portalHost(r.skillRef.skill), "portal_changed", report.slice(0, 500));
    },
  });
  r.state = next;
  r.status = next.status === "done" ? "done" : next.status === "stopped" ? "stopped" : next.pause?.kind === "gate" && next.pause.gate === "submit" ? "review" : next.status === "paused" ? "paused" : "running";
}

/** The human confirmed the plan: open the replay browser and start. */
export async function startReplaySession(deps: ReplayDeps, viewer: SkillViewer, id: string): Promise<ReplayView> {
  const r = owned(viewer, id);
  if (r.status !== "planned") throw new ReplayError(409, "already_started", "This replay already started.");
  const decision = teachDomainDecision(r.skillRef.skill.portal.base_url, { isAdmin: true });
  if (!decision.ok) throw new ReplayError(400, decision.reason, decision.message.en);
  const drive = await deps.startDrive({ startUrl: r.skillRef.skill.portal.base_url, allowedDomains: decision.allowedDomains });
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
