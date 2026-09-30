// What a saved Passport location means for this business's requirements:
// its Census municipio/barrio, the municipio's knowledge-base designations,
// and the requirements the rules engine ties to this location. Re-evaluated
// on every request (current KB + boundary data); nothing is stored.

import { locationRequirementsFor } from "../../../../../../locations/requirements";
import { NO_STORE, resolveBusinessAccess } from "../../../../../../locations/routeAccess";
import { getLocation } from "../../../../../../locations/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; locationId: string }> }) {
  const { id, locationId } = await ctx.params;
  const r = await resolveBusinessAccess(id);
  if ("error" in r) return r.error;
  const location = await getLocation(r.pool, r.business, locationId);
  if (!location) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    const view = await locationRequirementsFor(r.pool, r.business.id, location);
    return Response.json(view, { headers: NO_STORE });
  } catch (err) {
    console.error("[locations] requirements failed:", (err as Error).message);
    return Response.json({ error: "evaluation_failed" }, { status: 500 });
  }
}
