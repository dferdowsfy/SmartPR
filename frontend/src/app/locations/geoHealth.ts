// ============================================================================
// Geo-layer health check: every provider, at known Puerto Rico points, with
// the answer each one is expected to give. Used by the scheduled CI job
// (scripts/geo-health.mts) and the admin page (/admin/geo-health).
//
// Two kinds of checks:
//   endpoint   — each ArcGIS endpoint (primary AND every fallback) answers a
//                point query with a well-formed `features` array in time.
//   expectation — the resolved layers at a known point match what the
//                official maps said when the check was written (2026-10-04).
// A "required" failure means users are seeing "couldn't check" (or a wrong
// answer) for a layer that drives rules; "optional" failures are reported
// but do not fail the job (JP historic / protected areas are known to hang).
// ============================================================================

import { LAYER_SOURCES, buildArcgisPointQuery, pinPlacement, type SiteLayerId, type SiteLayers } from "./layers.ts";
import { LAYER_QUERIES, LayerCache, queryJson, resolveSiteLayers, sourceEndpoints, type FetchLike } from "./layerService.ts";

export interface ProbePoint {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  placement?: ReturnType<typeof pinPlacement>["state"];
  expect: Partial<Record<SiteLayerId, { status?: "resolved" | "none"; code?: string; tags?: string[] }>>;
}

/** Known points, verified against the official maps on 2026-10-04. */
export const PROBE_POINTS: ProbePoint[] = [
  { id: "loiza_water", label: "Loíza — pin in the Piñones lagoon (live report)", latitude: 18.443338, longitude: -65.972185, placement: "on_water",
    expect: { flood_zone: { code: "AE", tags: ["FLOODWAY"] }, zoning: { code: "AGUA" }, land_class: { code: "AGUA", tags: ["NOT_A_LOT"] }, parcel: { status: "none" } } },
  { id: "caguas_street", label: "Caguas — pin on the street (live report)", latitude: 18.232565, longitude: -66.037436, placement: "on_road",
    expect: { flood_zone: { code: "X" }, zoning: { code: "VIAL" }, parcel: { status: "none" } } },
  { id: "pinones_lot", label: "Loíza — Piñones lot (CRIM polygon without number → JP catastro)", latitude: 18.444, longitude: -65.974, placement: "on_lot",
    expect: { flood_zone: { code: "AE", tags: ["SFHA"] }, coastal_zone: { status: "resolved" }, land_class: { code: "SREP-E" }, parcel: { code: "042-000-008-01" } } },
  { id: "caguas_centre", label: "Caguas — pueblo lot", latitude: 18.2341, longitude: -66.0397, placement: "on_lot",
    expect: { flood_zone: { code: "X" }, zoning: { code: "DT-G" }, land_class: { code: "SU" }, parcel: { code: "225-044-031-13" } } },
  { id: "toa_baja_ae", label: "Toa Baja — AE lot, coastal", latitude: 18.4436, longitude: -66.201, placement: "on_lot",
    expect: { flood_zone: { code: "AE" }, zoning: { code: "C-R" }, land_class: { code: "SREP-E" }, parcel: { code: "038-000-010-13" }, coastal_zone: { status: "resolved" } } },
  { id: "guayama_rural", label: "Guayama — rural residential lot", latitude: 17.993, longitude: -66.134, placement: "on_lot",
    expect: { flood_zone: { code: "X" }, zoning: { code: "R-A" }, land_class: { code: "SREP-A" }, parcel: { code: "419-000-005-02" } } },
  { id: "condado_ve", label: "San Juan — Condado shoreline (VE)", latitude: 18.4573, longitude: -66.0614,
    expect: { flood_zone: { code: "VE" }, coastal_zone: { status: "resolved" } } },
];

export interface HealthCheck {
  kind: "endpoint" | "expectation";
  id: string;
  required: boolean;
  ok: boolean;
  detail: string;
  latency_ms: number | null;
}

export interface HealthReport {
  checked_at: string;
  ok: boolean;
  required_failures: number;
  optional_failures: number;
  checks: HealthCheck[];
}

function layerSummary(l: SiteLayers, id: SiteLayerId): string {
  const r = l.results.find((x) => x.layer === id);
  if (!r) return "missing";
  return r.status === "unknown" ? `unknown(${r.reason})` : `${r.status}:${r.code ?? ""}${r.tags.length ? `[${r.tags.join("|")}]` : ""}`;
}

/** Run every check. Never throws; network failures become failed checks. */
export async function runGeoHealth(opts: { fetchImpl?: FetchLike; now?: () => Date; endpointTimeoutMs?: number } = {}): Promise<HealthReport> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }) as ReturnType<FetchLike>);
  const now = opts.now ?? (() => new Date());
  const checks: HealthCheck[] = [];
  const ref = PROBE_POINTS.find((p) => p.id === "caguas_centre")!;
  const coastRef = PROBE_POINTS.find((p) => p.id === "pinones_lot")!;

  // 1) Every endpoint of every dataset, primary and fallbacks.
  const seen = new Set<string>();
  const endpointJobs: Promise<void>[] = [];
  for (const [key, spec] of Object.entries(LAYER_QUERIES)) {
    for (const ep of sourceEndpoints(spec.source)) {
      if (seen.has(ep)) continue;
      seen.add(ep);
      const coastal = /costa|czm|coast|advisory|Inundacion/i.test(ep) || spec.source === "noaa_czma";
      const p = coastal ? coastRef : ref;
      const extra: Record<string, string> = key === "coastline" ? { distance: "1000", units: "esriSRUnit_Meter", returnCountOnly: "true" } : { returnCountOnly: "true" };
      endpointJobs.push((async () => {
        const t0 = Date.now();
        const r = await queryJson(fetchImpl, buildArcgisPointQuery(ep, p, extra), opts.endpointTimeoutMs ?? 10_000, 1, 500, true);
        const ok = typeof r !== "string" && !r.error && (typeof r.count === "number" || Array.isArray(r.features));
        checks.push({
          kind: "endpoint",
          id: `${key}${ep === LAYER_SOURCES[spec.source].url ? "" : " (fallback)"} ${ep}`,
          required: !spec.optional && ep === LAYER_SOURCES[spec.source].url,
          ok,
          detail: typeof r === "string" ? r : r.error ? `arcgis_error_${r.error.code}: ${r.error.message ?? ""}` : `count=${r.count ?? r.features?.length ?? 0}`,
          latency_ms: Date.now() - t0,
        });
      })());
    }
  }
  await Promise.all(endpointJobs);

  // 1b) Configured LAYER_SOURCES URLs must exist (service metadata answers
  // without "service not found" / 404 / 502). Catches dead primaries like the
  // old sige.pr.gov Reglamentario_va2 path before they burn live traffic.
  const metaJobs: Promise<void>[] = [];
  const metaSeen = new Set<string>();
  const sourceKeyOf = new Map(Object.entries(LAYER_SOURCES).map(([k, v]) => [v, k]));
  for (const src of Object.values(LAYER_SOURCES)) {
    for (const ep of [src.url, ...(src.fallback_urls ?? [])]) {
      if (metaSeen.has(ep)) continue;
      metaSeen.add(ep);
      if (!/\/(Map|Feature)Server\/\d+$/i.test(ep)) continue;
      const key = sourceKeyOf.get(src);
      const spec = key ? Object.values(LAYER_QUERIES).find((s) => s.source === key) : undefined;
      metaJobs.push((async () => {
        const t0 = Date.now();
        try {
          const r = await fetchImpl(`${ep}?f=json`, { headers: { Accept: "application/json" } });
          let detail = `http_${r.status}`;
          let ok = false;
          if (r.ok) {
            const body = (await r.json()) as { error?: { code?: number; message?: string }; name?: string; type?: string; fields?: unknown; layers?: unknown };
            if (body.error) detail = `arcgis_error_${body.error.code}: ${body.error.message ?? ""}`;
            else if (body.name || body.type || body.fields || body.layers) { ok = true; detail = `name=${body.name ?? body.type ?? "ok"}`; }
            else detail = "missing_layer_metadata";
          }
          checks.push({ kind: "endpoint", id: `exists ${ep}`, required: !!spec && !spec.optional, ok, detail, latency_ms: Date.now() - t0 });
        } catch (err) {
          checks.push({ kind: "endpoint", id: `exists ${ep}`, required: !!spec && !spec.optional, ok: false, detail: `network_error: ${(err as Error)?.message ?? "error"}`.slice(0, 160), latency_ms: Date.now() - t0 });
        }
      })());
    }
  }
  await Promise.all(metaJobs);

  // 2) Resolved answers at the known points (the full production path:
  // fallbacks, retries, parsers, placement).
  for (const p of PROBE_POINTS) {
    const t0 = Date.now();
    const l = await resolveSiteLayers(p.latitude, p.longitude, { fetchImpl, cache: new LayerCache(), store: null, refresh: true, skipOptional: true, recordHealth: false });
    const latency = Date.now() - t0;
    if (p.placement) {
      const got = pinPlacement(l).state;
      checks.push({ kind: "expectation", id: `${p.id} placement`, required: true, ok: got === p.placement, detail: `expected ${p.placement}, got ${got}`, latency_ms: latency });
    }
    for (const [layerId, e] of Object.entries(p.expect) as Array<[SiteLayerId, NonNullable<ProbePoint["expect"][SiteLayerId]>]>) {
      const r = l.results.find((x) => x.layer === layerId);
      const status = e.status ?? (e.code ? "resolved" : undefined);
      const ok = !!r && (!status || r.status === status) && (!e.code || r.code === e.code) && (e.tags ?? []).every((t) => r.tags.includes(t));
      checks.push({ kind: "expectation", id: `${p.id} ${layerId}`, required: true, ok, detail: `expected ${status ?? "*"}:${e.code ?? "*"}${e.tags ? `[${e.tags.join("|")}]` : ""}, got ${layerSummary(l, layerId)}`, latency_ms: latency });
    }
  }

  checks.sort((a, b) => Number(a.ok) - Number(b.ok) || Number(b.required) - Number(a.required) || a.id.localeCompare(b.id));
  const required_failures = checks.filter((c) => !c.ok && c.required).length;
  const optional_failures = checks.filter((c) => !c.ok && !c.required).length;
  return { checked_at: now().toISOString(), ok: required_failures === 0, required_failures, optional_failures, checks };
}
