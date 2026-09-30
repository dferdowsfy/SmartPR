/**
 * Layer 4 public-probe signals → skill health (Teach Clara spec §9). A
 * portal whose public page drifted flags every skill for that host
 * ("portal_changed") so the preflight warns; it never edits or retires a
 * skill — only a replay that actually hits drift marks needs_reteach.
 */
import type { SkillRepo } from "./skillLibrary";

export interface ProbeSignal {
  url: string;
  reachable: boolean;
  drift: boolean;
  driftDetail?: string | null;
}

export async function applyProbeSignals(repo: SkillRepo, results: ProbeSignal[]): Promise<{ host: string; status: string }[]> {
  const out: { host: string; status: string }[] = [];
  for (const r of results) {
    let host: string;
    try {
      host = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    const status = r.drift ? "portal_changed" : r.reachable ? "ok" : "unreachable";
    // "unreachable" from the probe vantage point is not a portal change.
    const prev = await repo.portalHealth(host);
    if (status === "ok" && prev?.status === "portal_changed") continue; // cleared only by a clean replay / re-teach
    await repo.setPortalHealth(host, status, r.drift ? (r.driftDetail ?? "portal changed").slice(0, 500) : null);
    out.push({ host, status });
  }
  return out;
}
