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
import { listVisibleSkills, SkillLibraryError, type SkillRepo, type SkillViewer, type StoredSkill } from "../skills/skillLibrary";
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


/** Owner-only: a routine the viewer taught (not the shared library's). */
async function ownedRoutine(repo: SkillRepo, viewer: SkillViewer, ref: string): Promise<StoredSkill> {
  const row = await repo.get(ref);
  if (!row || !routineOf(row) || row.owner_user_id !== viewer.userId) throw new SkillLibraryError(404, "not_found", "Routine not found.");
  return row;
}

/** Rename a routine the viewer taught. */
export async function renameRoutine(repo: SkillRepo, viewer: SkillViewer, ref: string, name: string): Promise<LearnedRoutineSummary> {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean) throw new SkillLibraryError(400, "name_required", "Give the routine a name.");
  const row = await ownedRoutine(repo, viewer, ref);
  const checks = { ...((row.checks as Record<string, unknown>) ?? {}), routine: { ...routineOf(row), name: clean } };
  await repo.update(row.id, { checks } as never);
  return summarizeRoutine({ ...row, checks } as StoredSkill, viewer)!;
}

/**
 * Remove a routine the viewer taught: it stops being a learned routine
 * ("Fill with Clara" no longer replays it). The skill row stays for the
 * audit trail; teaching the requirement again creates a fresh routine.
 */
export async function removeRoutine(repo: SkillRepo, viewer: SkillViewer, ref: string): Promise<void> {
  const row = await ownedRoutine(repo, viewer, ref);
  const checks = { ...((row.checks as Record<string, unknown>) ?? {}), routine: null, routine_removed_at: new Date().toISOString() };
  await repo.update(row.id, { checks } as never);
}
