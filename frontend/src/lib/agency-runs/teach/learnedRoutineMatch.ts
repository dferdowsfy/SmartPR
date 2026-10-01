/** Client-safe: the learned-routine summary the checklist reads, and row matching. */
export interface LearnedRoutineSummary {
  ref: string;
  /** The name the teacher gave the routine. */
  name: string;
  agency: string | null;
  /** Skill version — re-teaching saves a new version; the newest one is used. */
  version: number;
  validation: { status: "pass"; checked_at: string | null };
  requirement_key: string | null;
  portal_host: string;
  portal_name: string;
  form: string;
  start_url: string;
  /** learned = replayable; needs_reteach = the portal changed during a replay. */
  status: "learned" | "needs_reteach";
  steps: number;
  pauses: number;
  learned_at: string;
  attribution: "you" | "smartpr" | "partner";
}

/** The routine a checklist row should use: same requirement, else same portal host + form. */
export function routineForRow(
  routines: LearnedRoutineSummary[],
  row: { key: string; portalUrl?: string | null; name?: string }
): LearnedRoutineSummary | null {
  const byKey = routines.find((r) => r.requirement_key === row.key);
  if (byKey) return byKey;
  if (!row.portalUrl) return null;
  let host = "";
  try {
    host = new URL(row.portalUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
  const name = (row.name ?? "").trim().toLowerCase();
  return routines.find((r) => !r.requirement_key && r.portal_host === host && (!name || r.form.trim().toLowerCase() === name)) ?? null;
}
