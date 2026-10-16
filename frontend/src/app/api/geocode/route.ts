// Address search / reverse geocoding for the Passport location picker.
// Server-side proxy so provider keys never reach the browser. Open to
// anonymous visitors because the public intake asks "Where is it?" before
// sign-in (requiring a session here was why address search said "isn't
// available" for every anonymous user). Rate limited per user, or per client
// IP when anonymous, on top of the upstream throttle in lib/geocoding.
// Results are provider-derived metadata; the coordinates the user confirms
// on the map stay authoritative. OSM-derived results carry `attribution`,
// which the UI must display (ODbL).
//
//   GET /api/geocode?q=<text>            → { results: GeocodeCandidate[] }
//   GET /api/geocode?lat=<n>&lng=<n>     → { result: GeocodeCandidate | null }
//   503 { error: "geocoding_not_configured" } when no provider is set up.
//   502 { error: "geocoding_failed" } only when EVERY provider failed;
//   "nothing found" is a 200 with an empty list.

import { getCurrentUser } from "../../../lib/supabase/server";
import { attributionFor, geocoderFromEnv, GeocodingError, searchInNamedMunicipio, type GeocodeCandidate, type SlotReserver } from "../../../lib/geocoding";
import { pgSlotReserver } from "../../../lib/geocoding/slots";
import { getPool } from "../../graph/db";
import { ensureSchema } from "../../graph/store";
import { getClientIpKey, rateLimitAllow } from "../../../lib/rateLimit";
import { formatCoordinate, parseLatLngQuery, validateCoordinates } from "../../locations/geo";
import { locateInPuertoRico } from "../../locations/boundaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Platform kill switch; internal deadline is ~2 s below this. */
export const maxDuration = 20;

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
  const user = await getCurrentUser().catch(() => null);
  const geocoder = geocoderFromEnv(process.env, { reserve: await sharedReserver() });
  if (!geocoder) return Response.json({ error: "geocoding_not_configured" }, { status: 503 });
  if (!(user ? rateLimitAllow(`geocode:${user.id}`, 30, 60_000) : rateLimitAllow(getClientIpKey(req.headers, "geocode:anon"), 20, 60_000))) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") === "es" ? "es" : "en";
  const q = (url.searchParams.get("q") ?? "").trim();
  try {
    if (q) {
      if (q.length > 200) return Response.json({ error: "query_too_long" }, { status: 400 });
      // A typed "lat, lng" inside Puerto Rico IS the point: never send it to
      // an address geocoder (which answers nothing and surfaced as "Address
      // search failed"). The address is a best-effort reverse lookup.
      const point = parseLatLngQuery(q);
      if (point) {
        const near = await geocoder.reverse(point.latitude, point.longitude, { lang }).catch(() => null);
        const result: GeocodeCandidate = {
          latitude: point.latitude,
          longitude: point.longitude,
          formatted_address: near?.formatted_address ?? `${formatCoordinate(point.latitude, 5)}, ${formatCoordinate(point.longitude, 5)}`,
          address_line_1: near?.address_line_1 ?? null,
          city: near?.city ?? null,
          municipality: near?.municipality ?? null,
          state_or_region: near?.state_or_region ?? "Puerto Rico",
          postal_code: near?.postal_code ?? null,
          country_code: near?.country_code ?? "US",
          place_source: "coordinates",
          place_source_id: null,
        };
        const attribution = [attributionFor(near?.place_source)].filter(Boolean);
        return Response.json({ results: [result], provider: geocoder.id, attribution, coordinates: true }, { headers: { "Cache-Control": "no-store" } });
      }
      // Candidates in the municipio the query names lead (live Run 12).
      const results = await searchInNamedMunicipio(geocoder, q, {
        limit: 5,
        lang,
        locate: (lat, lng) => locateInPuertoRico(lat, lng)?.municipio.name ?? null,
      });
      const attribution = [...new Set(results.map((r) => attributionFor(r.place_source)).filter(Boolean))];
      return Response.json({ results, provider: geocoder.id, attribution }, { headers: { "Cache-Control": "no-store" } });
    }
    const coords = validateCoordinates(url.searchParams.get("lat"), url.searchParams.get("lng"));
    if (!coords.ok) return Response.json({ error: "invalid_coordinates", details: coords.errors }, { status: 400 });
    const result = await geocoder.reverse(coords.latitude, coords.longitude, { lang });
    return Response.json({ result, provider: geocoder.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof GeocodingError ? err.message : "provider_error";
    console.error("[geocode] every provider failed:", message);
    const status = message === "rate_limited" ? 429 : 502;
    return Response.json({ error: status === 429 ? "rate_limited" : "geocoding_failed", detail: message }, { status });
  }
}
