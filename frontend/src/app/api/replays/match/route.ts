/**
 * GET /api/replays/match?filing_type=…  — does Clara already know this
 * filing? → { skill: { ref, version, attribution } | null, can_replay }
 * Latest approved shared version wins; then the person's own private skill.
 */
import { getFilingConfig } from "../../../../lib/agency-runs/filingTypes";
import type { AgencyFilingType } from "../../../../lib/agency-runs/types";
import { findSkillFor } from "../../../../lib/agency-runs/replay/replaySessions";
import { currentViewer, errorResponse, skillRepo, unauthorized } from "../../../../lib/agency-runs/teach/routeContext";
import { teachAvailability } from "../../../../lib/agency-runs/teach/teachWorkerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const cfg = getFilingConfig((new URL(req.url).searchParams.get("filing_type") ?? "") as AgencyFilingType);
  if (!cfg) return Response.json({ error: "bad_request", message: "Unknown filing_type." }, { status: 400 });
  try {
    const found = await findSkillFor(await skillRepo(), viewer, { host: new URL(cfg.startUrl).hostname, form: cfg.labelEs, filingTypeId: cfg.id });
    return Response.json({
      skill: found ? { ref: found.ref, version: found.skill.version, attribution: found.attribution } : null,
      can_replay: teachAvailability().ok,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
