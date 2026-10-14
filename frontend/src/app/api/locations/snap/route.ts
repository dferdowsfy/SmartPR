// "Move the pin onto your lot": numbered CRIM parcels near a pin that landed
// on a road, water, or between lots. Anonymous (intake runs before sign-in),
// rate limited per client, read-only.
//
//   GET /api/locations/snap?lat=<n>&lng=<n>
//   → { candidates: [{ catastro, distance_m, latitude, longitude }], reason }

import { getClientIpKey, rateLimitAllow } from "../../../../lib/rateLimit";
import { isWithinPuertoRico, validateCoordinates } from "../../../locations/geo";
import { findNearbyLots } from "../../../locations/layerService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Platform kill switch; internal deadline is ~2 s below this. */
export const maxDuration = 15;

export async function GET(req: Request) {
  if (!rateLimitAllow(getClientIpKey(req.headers, "snap"), 30, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 });
  const u = new URL(req.url);
  const coords = validateCoordinates(u.searchParams.get("lat"), u.searchParams.get("lng"));
  if (!coords.ok) return Response.json({ error: "invalid_coordinates", details: coords.errors }, { status: 400 });
  if (!isWithinPuertoRico(coords.latitude, coords.longitude)) {
    return Response.json({ candidates: [], reason: "outside_puerto_rico" }, { headers: { "Cache-Control": "no-store" } });
  }
  const r = await findNearbyLots(coords.latitude, coords.longitude);
  return Response.json({ candidates: r.candidates, reason: r.reason }, { headers: { "Cache-Control": "private, max-age=300" } });
}
