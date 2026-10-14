// Whole-parcel findings for a pin: CRIM boundary + area, every JP calificación
// district and FEMA flood zone intersecting the parcel.
//
//   GET /api/locations/parcel?lat=<n>&lng=<n>[&refresh=1]
//   → { parcel: ParcelFindings | null, reason? }
//
// Never fails because a source is down: that part comes back "unavailable".

import { getClientIpKey, rateLimitAllow } from "../../../../lib/rateLimit";
import { isWithinPuertoRico, validateCoordinates } from "../../../locations/geo";
import { resolveParcelFindings } from "../../../locations/parcelService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Platform kill switch; internal deadline is ~2 s below this. */
export const maxDuration = 25;

export async function GET(req: Request) {
  if (!rateLimitAllow(getClientIpKey(req.headers, "parcel"), 60, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 });
  const u = new URL(req.url);
  const coords = validateCoordinates(u.searchParams.get("lat"), u.searchParams.get("lng"));
  if (!coords.ok) return Response.json({ error: "invalid_coordinates", details: coords.errors }, { status: 400 });
  if (!isWithinPuertoRico(coords.latitude, coords.longitude)) {
    return Response.json({ parcel: null, reason: "outside_puerto_rico" }, { headers: { "Cache-Control": "no-store" } });
  }
  const parcel = await resolveParcelFindings(coords.latitude, coords.longitude, { refresh: u.searchParams.get("refresh") === "1" });
  return Response.json({ parcel }, { headers: { "Cache-Control": "no-store" } });
}
