// Project (matter) ↔ Passport location.
//   GET → the project's structured location context, loaded fresh, for the
//         requirements engine (locations/locationContext.ts withLocationContext).
//   PUT { location_id: string | null } → assign one of the project's own
//         business's saved locations by stable id, or clear it.

import { locationEngineFacts } from "../../../../locations/locationContext";
import { FORBIDDEN, NO_STORE, resolveUser } from "../../../../locations/routeAccess";
import {
  accessibleMatter,
  assignLocationToMatter,
  auditLocationEvent,
  locationContextForMatter,
} from "../../../../locations/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const r = await resolveUser();
  if ("error" in r) return r.error;
  const matter = await accessibleMatter(r.pool, id, r.userId);
  if (!matter) return Response.json({ error: "not_found" }, { status: 404 });
  const context = await locationContextForMatter(r.pool, matter);
  return Response.json(
    { location_id: matter.location_id, context, engine_facts: context ? locationEngineFacts(context).projectFacts : null },
    { headers: NO_STORE }
  );
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: { location_id?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || !("location_id" in body)) {
    return Response.json({ error: "location_id_required" }, { status: 400 });
  }
  const locationId = body.location_id;
  if (locationId !== null && typeof locationId !== "string") {
    return Response.json({ error: "invalid_location_id" }, { status: 400 });
  }
  const r = await resolveUser();
  if ("error" in r) return r.error;
  const matter = await accessibleMatter(r.pool, id, r.userId);
  if (!matter) return Response.json({ error: "not_found" }, { status: 404 });
  if (!matter.can_edit) return FORBIDDEN();
  const result = await assignLocationToMatter(r.pool, matter, locationId);
  // Same answer for "no such location" and "location of another business".
  if (!result.ok) return Response.json({ error: "location_not_found" }, { status: 404 });
  await auditLocationEvent(r.pool, {
    action: "project_location_assigned",
    actorUserId: r.userId,
    workspaceId: matter.workspace_id,
    targetType: "matter",
    targetId: matter.id,
    detail: { business_id: matter.business_id, location_id: locationId, previous_location_id: matter.location_id },
  });
  return Response.json({ matter_id: matter.id, location_id: locationId });
}
