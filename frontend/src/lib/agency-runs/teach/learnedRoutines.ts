/**
 * Learned routines — taught skills that passed the record-first validation
 * step (teachSessions.validateTeachSession → saveTeachSession {learn}).
 *
 * A learned routine is a skill row whose `checks.routine` carries the
 * requirement it teaches, the portal host and a passing validation. The
 * checklist uses this list to make "Fill with Clara" the row's primary
 * action (strict replay of exactly those steps) for ANY portal, and to
 * show "Clara learned this" / "Needs re-teaching" on the row.
 */
import { listVisibleSkills, type SkillRepo, type SkillViewer, type StoredSkill } from "../skills/skillLibrary";
import type { LearnedRoutineSummary } from "./learnedRoutineMatch";

export { routineForRow, type LearnedRoutineSummary } from "./learnedRoutineMatch";

interface RoutineChecks {
  routine?: {
    name?: string;
    agency?: string | null;
    requirement_key?: string | null;
    portal_host?: string;
    start_url?: string;
    validation?: { status?: string; checkedAt?: string };
    learned_at?: string;
  };
}

export function routineOf(row: StoredSkill): RoutineChecks["routine"] | null {
  const r = (row.checks as RoutineChecks | null | undefined)?.routine;
  return r && r.validation?.status === "pass" ? r : null;
}

export function summarizeRoutine(row: StoredSkill, viewer: SkillViewer): LearnedRoutineSummary | null {
  const r = routineOf(row);
  if (!r || row.status === "rejected") return null;
  return {
    ref: row.id,
    name: r.name || `${row.form} — ${row.skill.portal.name}`,
    agency: r.agency ?? null,
    version: row.version,
    validation: { status: "pass", checked_at: r.validation?.checkedAt ?? null },
    requirement_key: r.requirement_key ?? null,
    portal_host: r.portal_host ?? row.portal_host,
    portal_name: row.skill.portal.name,
    form: row.form,
    start_url: r.start_url ?? row.skill.portal.base_url,
    status: row.status === "needs_reteach" ? "needs_reteach" : "learned",
    steps: row.skill.steps.filter((s) => !s.gate).length,
    pauses: row.skill.steps.filter((s) => s.gate).length,
    learned_at: r.learned_at ?? row.updated_at,
    attribution: row.owner_user_id === viewer.userId && row.scope === "private" ? "you" : row.taught_by === "admin" ? "smartpr" : "partner",
  };
}

/** Newest routine per requirement (or per portal+form when it has no requirement). */
export async function listLearnedRoutines(repo: SkillRepo, viewer: SkillViewer): Promise<LearnedRoutineSummary[]> {
  const rows = await listVisibleSkills(repo, viewer);
  const out = new Map<string, LearnedRoutineSummary>();
  for (const row of rows) {
    const s = summarizeRoutine(row, viewer);
    if (!s) continue;
    const key = s.requirement_key ?? `${s.portal_host}|${s.form.toLowerCase()}`;
    const prev = out.get(key);
    if (!prev || prev.learned_at < s.learned_at) out.set(key, s);
  }
  return [...out.values()];
}

