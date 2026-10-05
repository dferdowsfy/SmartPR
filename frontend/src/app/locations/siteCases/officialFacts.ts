// ============================================================================
// Official facts for a sample case, read DIRECTLY from the recorded raw
// government responses — deliberately not through the app's parsers, so the
// consistency suite cross-checks the parsers too. Small and literal: which
// polygon each official layer returned at the pin / on the parcel, and the
// dates those services publish.
// ============================================================================

import { LAYER_SOURCES, type LayerSourceKey } from "../layers.ts";
import type { RecordedGet, SiteFixture } from "./pipeline.ts";

type Attrs = Record<string, unknown>;
type Feature = { attributes?: Attrs; geometry?: { rings?: number[][][] } };

export interface OfficialFacts {
  captured_at: string;
  /** CRIM parcel polygon under the pin. */
  crim: { answered: boolean; catastro: string | null; tipo: string | null; ring: number[][] | null };
  /** JP calificación polygon under the pin. */
  jp: { answered: boolean; cali: string | null; descrip: string | null; clasi: string | null; vigencia: string | null; resolucion: string | null; num_catast: string | null };
  /** JP calificación districts on the parcel (with geometry). */
  jpParcel: { answered: boolean; districts: string[] };
  /** FEMA NFHL zones under the pin (every polygon) and on the parcel (zone|subtype). */
  fema: { answered: boolean; zones: string[]; governing: string | null; floodway: boolean; panel: string | null; effective: string | null };
  femaParcel: { answered: boolean; keys: string[] };
  /** FEMA/JP advisory (ABFE) at the pin. */
  advisory: { answered: boolean; zone: string | null; in02: boolean | null };
  /** NOAA CZMA boundary at the pin. */
  coastal: { answered: boolean; inside: boolean | null };
  /** Historic-zone polygons on the parcel (MIPR). */
  historicParcel: { answered: boolean; inside: boolean | null };
  wetlandsParcel: { answered: boolean; inside: boolean | null };
}

const urlsOf = (k: LayerSourceKey): string[] => [LAYER_SOURCES[k].url, ...((LAYER_SOURCES[k] as { fallback_urls?: readonly string[] }).fallback_urls ?? [])];

function find(fx: SiteFixture, k: LayerSourceKey, pred: (q: URLSearchParams) => boolean): RecordedGet | null {
  const bases = urlsOf(k);
  // Primary first; a fallback only counts when the primary did not answer.
  for (const base of bases) {
    for (const [u, g] of Object.entries(fx.gets)) {
      if (!u.startsWith(`${base}/query?`)) continue;
      const q = new URL(u).searchParams;
      if (!pred(q)) continue;
      if (g.ok && g.body && typeof g.body === "object" && !(g.body as { error?: unknown }).error) return g;
    }
  }
  return null;
}
const feats = (g: RecordedGet | null): Feature[] => ((g?.body as { features?: Feature[] })?.features ?? []);
const s = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const isPoint = (q: URLSearchParams) => q.get("geometryType") === "esriGeometryPoint" && !q.get("distance");
const isPolygon = (q: URLSearchParams) => q.get("geometryType") === "esriGeometryPolygon";
const epoch = (v: unknown) => (typeof v === "number" && v > 0 ? new Date(v).toISOString().slice(0, 10) : null);

function hazard(zone: string, sub: string): number {
  if (/FLOODWAY/i.test(sub)) return 100;
  if (/^V/i.test(zone)) return 90;
  if (/^A/i.test(zone)) return 80;
  if (zone === "D") return 30;
  if (/0\.2/.test(sub)) return 20;
  return 10;
}

export function officialFacts(fx: SiteFixture): OfficialFacts {
  // CRIM: the pin-layer query (outFields=*) and the parcel-service query (with geometry).
  const crimPoint = find(fx, "crim_parcels", (q) => isPoint(q) && q.get("outFields") === "*");
  const crimGeom = find(fx, "crim_parcels", (q) => isPoint(q) && q.get("returnGeometry") === "true" && !q.get("distance"));
  const cf = feats(crimPoint)[0]?.attributes ?? null;
  const numbered = feats(crimGeom).find((f) => s(f.attributes?.NUM_CATASTRO));
  const jpPoint = find(fx, "jp_calificacion", (q) => isPoint(q) && q.get("outFields") === "*");
  const ja = feats(jpPoint)[0]?.attributes ?? null;
  const jpPoly = find(fx, "jp_calificacion", isPolygon);
  const femaPoint = find(fx, "fema_flood_zones", isPoint);
  const fz = feats(femaPoint).map((f) => ({ zone: s(f.attributes?.FLD_ZONE) ?? "", sub: s(f.attributes?.ZONE_SUBTY) ?? "" })).filter((z) => z.zone);
  const gov = [...fz].sort((a, b) => hazard(b.zone, b.sub) - hazard(a.zone, a.sub))[0] ?? null;
  const panel = feats(find(fx, "fema_firm_panels", isPoint))[0]?.attributes ?? null;
  const femaPoly = find(fx, "fema_flood_zones", isPolygon);
  const adv = find(fx, "jp_advisory_flood", isPoint);
  const advZones = feats(adv).map((f) => ({ zone: s(f.attributes?.FLD_ZONE) ?? "", sub: s(f.attributes?.ZONE_SUBTY) ?? "" })).filter((z) => z.zone);
  const advGov = [...advZones].sort((a, b) => hazard(b.zone, b.sub) - hazard(a.zone, a.sub))[0] ?? null;
  const adv02 = find(fx, "jp_advisory_flood_02", isPoint);
  const noaa = find(fx, "noaa_czma", isPoint);
  const hist = find(fx, "mipr_zona_historica", isPolygon);
  const wet = find(fx, "mipr_humedales", isPolygon);
  const withArea = (g: RecordedGet | null, key: (a: Attrs) => string | null) => [...new Set(feats(g).filter((f) => (f.geometry?.rings?.length ?? 0) > 0).map((f) => key(f.attributes ?? {})).filter((x): x is string => !!x))].sort();
  return {
    captured_at: fx.captured_at,
    crim: { answered: !!crimPoint, catastro: s(cf?.NUM_CATASTRO), tipo: s(cf?.TIPO), ring: numbered?.geometry?.rings?.[0] ?? null },
    jp: { answered: !!jpPoint, cali: s(ja?.cali), descrip: s(ja?.descrip), clasi: s(ja?.clasi), vigencia: s(ja?.vigencia), resolucion: s(ja?.resolucion), num_catast: s(ja?.num_catast) },
    jpParcel: { answered: !!jpPoly, districts: withArea(jpPoly, (a) => s(a.cali)) },
    fema: { answered: !!femaPoint, zones: [...new Set(fz.map((z) => z.zone))].sort(), governing: gov?.zone ?? null, floodway: fz.some((z) => /FLOODWAY/i.test(z.sub)), panel: s(panel?.FIRM_PAN), effective: epoch(panel?.EFF_DATE) },
    femaParcel: { answered: !!femaPoly, keys: withArea(femaPoly, (a) => (s(a.FLD_ZONE) ? `${s(a.FLD_ZONE)}|${s(a.ZONE_SUBTY) ?? ""}` : null)) },
    advisory: { answered: !!adv, zone: advGov?.zone ?? null, in02: adv02 ? feats(adv02).length > 0 : null },
    coastal: { answered: !!noaa, inside: noaa ? feats(noaa).length > 0 : null },
    historicParcel: { answered: !!hist, inside: hist ? feats(hist).length > 0 : null },
    wetlandsParcel: { answered: !!wet, inside: wet ? feats(wet).length > 0 : null },
  };
}
