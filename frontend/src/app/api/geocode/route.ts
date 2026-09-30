// Address search / reverse geocoding for the Passport location picker.
// Server-side proxy so provider keys never reach the browser. Signed-in
// users only, rate limited. Results are provider-derived metadata; the
// coordinates the user confirms on the map stay authoritative.
//
//   GET /api/geocode?q=<text>            → { results: GeocodeCandidate[] }
//   GET /api/geocode?lat=<n>&lng=<n>     → { result: GeocodeCandidate | null }
//   503 { error: "geocoding_not_configured" } when no provider is set up.

import { getCurrentUser } from "../../../lib/supabase/server";
import { geocoderFromEnv, GeocodingError, type SlotReserver } from "../../../lib/geocoding";
import { pgSlotReserver } from "../../../lib/geocoding/slots";
import { getPool } from "../../graph/db";
import { ensureSchema } from "../../graph/store";
import { rateLimitAllow } from "../../../lib/rateLimit";
import { validateCoordinates } from "../../locations/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * App-wide slot reservation through Postgres, so the public Nominatim limit
 * (1 request/second for the whole application) holds across every server
 * instance. Without a database the geocoder falls back to per-process spacing.
 */
async function sharedReserver(): Promise<SlotReserver | undefined> {
  const pool = getPool();
  if (!pool) return undefined;
  try {
    await ensureSchema();
  } catch {
    return undefined;
  }
  return pgSlotReserver(pool, "nominatim-public", 1100);
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const geocoder = geocoderFromEnv(process.env, { reserve: await sharedReserver() });
  if (!geocoder) return Response.json({ error: "geocoding_not_configured" }, { status: 503 });
  if (!rateLimitAllow(`geocode:${user.id}`, 30, 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") === "es" ? "es" : "en";
  const q = (url.searchParams.get("q") ?? "").trim();
  try {
    if (q) {
      if (q.length > 200) return Response.json({ error: "query_too_long" }, { status: 400 });
      const results = await geocoder.search(q, { limit: 5, lang });
      return Response.json({ results, provider: geocoder.id }, { headers: { "Cache-Control": "no-store" } });
    }
    const coords = validateCoordinates(url.searchParams.get("lat"), url.searchParams.get("lng"));
    if (!coords.ok) return Response.json({ error: "invalid_coordinates", details: coords.errors }, { status: 400 });
    const result = await geocoder.reverse(coords.latitude, coords.longitude, { lang });
    return Response.json({ result, provider: geocoder.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof GeocodingError ? err.message : "provider_error";
    console.error("[geocode] provider failed:", message);
    return Response.json({ error: "geocoding_failed", detail: message }, { status: 502 });
  }
}
