// What do the official maps say about this point? FEMA flood zone, JP
// calificación (zoning) and land classification, CRIM parcel, coastal zone,
// and (optional) historic zones / protected natural areas — queried live by
// point with per-layer timeouts and a cache (src/app/locations/layerService).
//
//   GET /api/locations/layers?lat=<n>&lng=<n>
//   → { layers: SiteLayers | null }
//
// Never fails because a layer is down: that layer comes back `unknown` with
// a reason. Separate from /api/locations/resolve so the municipio answer
// stays instant. No account needed (serves the intake). When a database is
// configured, answers are also persisted per pin (site_layer_cache) so a
// government service outage never blanks a pin that was resolved before.

import { rateLimitAllow } from "../../../../lib/rateLimit";
import { isWithinPuertoRico, validateCoordinates } from "../../../locations/geo";
import { resolveSiteLayers } from "../../../locations/layerService";
import { getLayerStore } from "../../../locations/layerStore";
import { locateInPuertoRico } from "../../../locations/boundaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimitAllow(`layers:${client}`, 60, 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  const url = new URL(req.url);
  const coords = validateCoordinates(url.searchParams.get("lat"), url.searchParams.get("lng"));
  if (!coords.ok) return Response.json({ error: "invalid_coordinates", details: coords.errors }, { status: 400 });
  if (!isWithinPuertoRico(coords.latitude, coords.longitude)) {
    return Response.json({ layers: null, reason: "outside_puerto_rico" }, { headers: { "Cache-Control": "no-store" } });
  }
  const layers = await resolveSiteLayers(coords.latitude, coords.longitude, {
    store: getLayerStore(),
    refresh: url.searchParams.get("refresh") === "1",
    isOnLand: (p) => locateInPuertoRico(p.latitude, p.longitude) !== null,
  });
  return Response.json({ layers }, { headers: { "Cache-Control": "no-store" } });
}
