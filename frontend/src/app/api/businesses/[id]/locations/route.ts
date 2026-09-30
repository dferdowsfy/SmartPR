// Business Passport → Property / Location: list and create saved locations.
// Ownership (business, workspace, creator) is derived server-side; any
// tenant fields in the body are ignored.

import { isWithinPuertoRico, parseLocationInput } from "../../../../locations/geo";
import { NO_STORE, resolveBusinessAccess } from "../../../../locations/routeAccess";
import { auditLocationEvent, createLocation, listLocationsForBusiness } from "../../../../locations/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await resolveBusinessAccess(id);
  if ("error" in r) return r.error;
  try {
    const locations = await listLocationsForBusiness(r.pool, r.business);
    return Response.json({ locations, can_edit: r.business.can_edit }, { headers: NO_STORE });
  } catch (err) {
    console.error("[locations] list failed:", (err as Error).message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await resolveBusinessAccess(id, { write: true });
  if ("error" in r) return r.error;
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  const parsed = parseLocationInput(body);
  if (!parsed.ok) return Response.json({ error: "invalid_location", details: parsed.errors }, { status: 400 });
  try {
    const location = await createLocation(r.pool, r.business, r.userId, parsed.value);
    await auditLocationEvent(r.pool, {
      action: "location_created",
      actorUserId: r.userId,
      workspaceId: r.business.workspace_id,
      targetType: "location",
      targetId: location.id,
      detail: {
        business_id: r.business.id,
        is_primary: location.is_primary,
        coordinate_source: location.coordinate_source,
        address_source: location.address_source,
      },
    });
    const warnings = isWithinPuertoRico(location.latitude, location.longitude) ? [] : ["outside_puerto_rico"];
    return Response.json({ location, warnings }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error("[locations] create failed:", (err as Error).message);
    return Response.json({ error: "save_failed" }, { status: 500 });
  }
}
