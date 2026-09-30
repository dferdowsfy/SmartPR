/**
 * POST /api/skills/health/probe — Layer 4 public-probe results → portal
 * health for skills (Teach Clara spec §9). Auth: header
 * `x-cron-secret: $SKILL_HEALTH_CRON_SECRET`. Body: { results: [{ url,
 * reachable, drift, driftDetail }] } — the probe script's JSON lines.
 */
import { applyProbeSignals, type ProbeSignal } from "../../../../../lib/agency-runs/skills/portalHealth";
import { skillRepo } from "../../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.SKILL_HEALTH_CRON_SECRET;
  const given = req.headers.get("x-cron-secret");
  if (!secret || !given || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { results?: unknown };
  const results = (Array.isArray(body.results) ? body.results : [])
    .filter((r): r is ProbeSignal => !!r && typeof (r as ProbeSignal).url === "string")
    .slice(0, 50)
    .map((r) => ({ url: r.url, reachable: r.reachable === true, drift: r.drift === true, driftDetail: typeof r.driftDetail === "string" ? r.driftDetail : null }));
  return Response.json({ updated: await applyProbeSignals(await skillRepo(), results) });
}
