// One saved Passport location: read, replace (edit), delete. A location is
// only reachable through a business the caller can access; a foreign or
// unknown location id answers 404 either way (no enumeration signal).

import { isWithinPuertoRico, parseLocationInput } from "../../../../../locations/geo";
import { NO_STORE, resolveBusinessAccess } from "../../../../../locations/routeAccess";
import { auditLocationEvent, deleteLocation, getLocation, updateLocation } from "../../../../../locations/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; locationId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id, locationId } = await ctx.params;
  const r = await resolveBusinessAccess(id);
  if ("error" in r) return r.error;
  const location = await getLocation(r.pool, r.business, locationId);
  if (!location) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ location }, { headers: NO_STORE });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id, locationId } = await ctx.params;
  const r = await resolveBusinessAccess(id);
  if ("error" in r) return r.error;
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  const parsed = parseLocationInput(body);
  if (!parsed.ok) return Response.json({ error: "invalid_location", details: parsed.errors }, { status: 400 });
  try {
    const result = await updateLocation(r.pool, r.business, r.userId, locationId, parsed.value);
    if (!result) return Response.json({ error: "not_found" }, { status: 404 });
    if (result.changed.length) {
      await auditLocationEvent(r.pool, {
        action: "location_updated",
        actorUserId: r.userId,
        workspaceId: r.business.workspace_id,
        targetType: "location",
        targetId: result.location.id,
        detail: { business_id: r.business.id, fields_changed: result.changed, moved: result.moved },
      });
    }
    const { location } = result;
    const warnings = isWithinPuertoRico(location.latitude, location.longitude) ? [] : ["outside_puerto_rico"];
    return Response.json({ location, warnings }, { headers: NO_STORE });
  } catch (err) {
    console.error("[locations] update failed:", (err as Error).message);
    return Response.json({ error: "save_failed" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id, locationId } = await ctx.params;
  const r = await resolveBusinessAccess(id);
  if ("error" in r) return r.error;
  try {
    const result = await deleteLocation(r.pool, r.business, locationId);
    if (!result.deleted) return Response.json({ error: "not_found" }, { status: 404 });
    await auditLocationEvent(r.pool, {
      action: "location_deleted",
      actorUserId: r.userId,
      workspaceId: r.business.workspace_id,
      targetType: "location",
      targetId: locationId,
      detail: { business_id: r.business.id, was_primary: result.wasPrimary, unassigned_projects: result.unassignedProjects },
    });
    return Response.json({ deleted: true, unassigned_projects: result.unassignedProjects });
  } catch (err) {
    console.error("[locations] delete failed:", (err as Error).message);
    return Response.json({ error: "delete_failed" }, { status: 500 });
  }
}
