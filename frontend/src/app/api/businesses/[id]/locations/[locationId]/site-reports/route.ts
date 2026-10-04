// Versioned Property & Site Reports for one saved Passport location.
//   GET  ?version=n  → latest (or that version) + version list
//   POST { report }  → saves a new version when the report changed
// Only reachable through a business the caller can access; writes need an
// edit-capable role.

import { NO_STORE, resolveBusinessAccess } from "../../../../../../locations/routeAccess";
import { getSiteReport, listSiteReports, saveSiteReport } from "../../../../../../locations/reportStore";
import { auditLocationEvent } from "../../../../../../locations/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; locationId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id, locationId } = await ctx.params;
  const r = await resolveBusinessAccess(id);
  if ("error" in r) return r.error;
  const versions = await listSiteReports(r.pool, r.business, locationId);
  if (!versions) return Response.json({ error: "not_found" }, { status: 404 });
  const v = Number(new URL(req.url).searchParams.get("version"));
  const latest = versions.length ? await getSiteReport(r.pool, r.business, locationId, Number.isInteger(v) && v > 0 ? v : null) : null;
  return Response.json({ versions, report: latest }, { headers: NO_STORE });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id, locationId } = await ctx.params;
  const r = await resolveBusinessAccess(id, { write: true });
  if ("error" in r) return r.error;
  let body: { report?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  try {
    const result = await saveSiteReport(r.pool, r.business, r.userId, locationId, body.report);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 400 });
    if (result.created) {
      await auditLocationEvent(r.pool, {
        action: "location_updated",
        actorUserId: r.userId,
        workspaceId: r.business.workspace_id,
        targetType: "location",
        targetId: locationId,
        detail: { business_id: r.business.id, site_report_version: result.saved.version },
      });
    }
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error("[site-reports] save failed:", (err as Error).message);
    return Response.json({ error: "save_failed" }, { status: 500 });
  }
}
