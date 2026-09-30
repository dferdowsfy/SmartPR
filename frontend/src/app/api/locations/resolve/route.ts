// Where is this point? Deterministic Census municipio/barrio lookup for a
// WGS84 point, plus the municipio's designations in SmartPR's knowledge base.
// Local computation only (no provider, no database), so it also serves the
// intake before an account or business exists. Rate limited per client.
//
//   GET /api/locations/resolve?lat=<n>&lng=<n>
//   → { placement: { municipality, barrio, near_boundary, boundary_distance_m, source } | null,
//       designations: string[] }

import { KB } from "../../../kb";
import { rateLimitAllow } from "../../../../lib/rateLimit";
import { BOUNDARY_SOURCE, locateInPuertoRico } from "../../../locations/boundaries";
import { normalizeMunicipio, validateCoordinates } from "../../../locations/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimitAllow(`resolve:${client}`, 120, 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  const url = new URL(req.url);
  const coords = validateCoordinates(url.searchParams.get("lat"), url.searchParams.get("lng"));
  if (!coords.ok) return Response.json({ error: "invalid_coordinates", details: coords.errors }, { status: 400 });
  const p = locateInPuertoRico(coords.latitude, coords.longitude);
  const kbMunicipality = p ? KB.municipalities.find((m) => normalizeMunicipio(m.name) === normalizeMunicipio(p.municipio.name)) : undefined;
  return Response.json(
    {
      placement: p
        ? {
            municipality: { fips: p.municipio.fips, name: kbMunicipality?.name ?? p.municipio.name },
            barrio: p.barrio ? { geoid: p.barrio.geoid, name: p.barrio.name, barrio_pueblo: p.barrio.barrioPueblo } : null,
            near_boundary: p.nearBoundary,
            boundary_distance_m: p.boundaryDistanceM,
            source: { id: BOUNDARY_SOURCE.id, name: BOUNDARY_SOURCE.name, version: BOUNDARY_SOURCE.version, url: BOUNDARY_SOURCE.url },
          }
        : null,
      designations: kbMunicipality ? kbMunicipality.flags : [],
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
