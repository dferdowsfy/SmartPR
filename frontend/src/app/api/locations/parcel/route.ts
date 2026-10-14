// Whole-parcel findings for a pin: CRIM boundary + area, every JP calificación
// district and FEMA flood zone intersecting the parcel.
//
//   GET /api/locations/parcel?lat=<n>&lng=<n>[&refresh=1]
//   → { parcel: ParcelFindings | null, reason? }
//
// Never fails because a source is down: that part comes back "unavailable".
// Never hangs: a hard route deadline (ROUTE_DEADLINE_MS.parcel) answers with
// every part "unavailable" (reason route_deadline_…) if the lookup has not
// finished; the lookup keeps running and caches its answer for the retry.

import { getClientIpKey, rateLimitAllow } from "../../../../lib/rateLimit";
import { isWithinPuertoRico, validateCoordinates } from "../../../locations/geo";
import { resolveParcelFindings } from "../../../locations/parcelService";
import { parcelFindingsUnavailable } from "../../../locations/parcel";
import { ROUTE_DEADLINE_MS, raceRouteDeadline } from "../../../../lib/routeDeadline";

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
  const { latitude, longitude } = coords;
  const { value: parcel, outcome, elapsedMs } = await raceRouteDeadline(
    () => resolveParcelFindings(latitude, longitude, { refresh: u.searchParams.get("refresh") === "1" }),
    ROUTE_DEADLINE_MS.parcel,
    (reason) => parcelFindingsUnavailable(latitude, longitude, reason)
  );
  if (outcome !== "ok") console.warn(`[parcel] ${outcome} after ${elapsedMs} ms; answered "unavailable" (lat=${latitude.toFixed(5)} lng=${longitude.toFixed(5)})`);
  return Response.json({ parcel, ...(outcome !== "ok" ? { partial: outcome } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
