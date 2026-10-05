// Representative report cases for output tests (screen / copy / PDF agreement
// and PDF layout). Built from recorded or synthetic parcel data through the
// real report pipeline — nothing here is used in production.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPropertyReport, type PropertyReport, type PropertyReportContext } from "./propertyReport.ts";
import { analyzeProposedActivity } from "./landUseGraph.ts";
import { restoreParcelFindings, type ParcelFindings } from "./parcel.ts";
import type { IntakeSite } from "./intakeLocation.ts";
import type { SiteLayers } from "./layers.ts";
import { AT, GUAYNABO, synthParcel, synthSite } from "./decisionFixtures.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ctx = (activity: string | null): PropertyReportContext => ({ activity, businessType: null, projectTypes: [], locationRequirements: [] });

function siteFor(lat: number, lng: number, layers: SiteLayers, muni: string, barrio: string, address?: { primary: string; secondary: string }): IntakeSite {
  return {
    latitude: lat, longitude: lng, coordinate_source: address ? "GEOCODED_ADDRESS" : "MAP_PIN", formatted_address: address ? `${address.primary}, ${address.secondary}` : null,
    address_line: address?.primary ?? null,
    municipality: { name: muni, fips: "72025" }, barrio: { name: barrio, geoid: null }, near_boundary: false,
    designations: [], boundary_source: null, location_id: null, confirmed_at: AT, layers,
  } as unknown as IntakeSite;
}

/** Mark a pin layer and/or parcel layer as a source timeout. */
function timeoutZoning(layers: SiteLayers, parcel: ParcelFindings): [SiteLayers, ParcelFindings] {
  const l = structuredClone(layers);
  for (const r of l.results) if (r.layer === "zoning" || r.layer === "land_class") Object.assign(r, { status: "unknown", code: null, name: null, reason: "timeout_8000ms", retrieval: "none" });
  const p = structuredClone(parcel);
  p.zoning = { ...p.zoning, status: "unavailable", districts: [], reason: "timeout_8000ms", coverage: null, overlay_coverage: null };
  return [l, p];
}

export interface ReportCase { id: string; lang: "en" | "es"; report: PropertyReport; note: string }

export function reportCases(): ReportCase[] {
  const rec = JSON.parse(readFileSync(join(here, "fixtures/caguas225.json"), "utf8")) as { layers: SiteLayers; parcel: unknown };
  const lat = rec.layers.latitude, lng = rec.layers.longitude;
  const parcel = restoreParcelFindings(rec.parcel, lat, lng)!;
  const caguasSite = siteFor(lat, lng, rec.layers, "Caguas", "Caguas", { primary: "Calle Génova", secondary: "Caguas, Puerto Rico 00725" });
  const out: ReportCase[] = [];
  const build = (site: IntakeSite, p: ParcelFindings | null, activity: string | null, answers: Record<string, string> | null = null) =>
    buildPropertyReport({ site, parcel: p, revision: 2, context: ctx(activity), landUse: activity ? analyzeProposedActivity(activity, site, p, { answers }) : null, now: new Date(AT) });

  // 1. Regression: catastro 225-016-807-10 (recorded live), no activity.
  out.push({ id: "caguas-225-016-807-10", lang: "en", note: "ordinary parcel, mixed districts with a tiny VIAL strip (recorded live)", report: build(caguasSite, parcel, null) });
  // 2. Same parcel with the zoning source timing out (as in the supplied PDF).
  const [tl, tp] = timeoutZoning(rec.layers, parcel);
  out.push({ id: "caguas-zoning-timeout", lang: "en", note: "zoning + land-classification source timeouts", report: build(siteFor(lat, lng, tl, "Caguas", "Caguas", { primary: "Calle Génova", secondary: "Caguas, Puerto Rico 00725" }), restoreParcelFindings(tp, lat, lng) ?? tp, "Open a restaurant in the existing building") });
  // 3. Guaynabo: mixed districts, tiny intersection, overlay, multi-page with a project (English and Spanish).
  const gp = synthParcel({ ...GUAYNABO, unavailable: ["archaeology"] });
  const gs = synthSite(gp, "Guaynabo", "R-5-T");
  out.push({ id: "guaynabo-project-en", lang: "en", note: "mixed districts, tiny intersection, overlay, project decision, one source timeout", report: build(gs, gp, "New 3,200-square-foot single-family residence with a pool") });
  out.push({ id: "guaynabo-project-es", lang: "es", note: "same, Spanish", report: build(gs, gp, "New 3,200-square-foot single-family residence with a pool", { pool_public: "no" }) });
  // 4. Point-only: no parcel identified.
  out.push({ id: "point-only", lang: "en", note: "point-only result (no CRIM parcel)", report: build(siteFor(lat, lng, rec.layers, "Caguas", "Caguas"), null, null) });
  // 5. Long English / Spanish place names and text.
  const longSite = siteFor(lat, lng, rec.layers, "Caguas", "Barrio Bairoa La Veinticinco — Sector Los Flamboyanes del Valle de Turabo Norte", {
    primary: "Urbanización Valle Escondido de las Colinas del Turabo, Calle Doctor Agustín Stahl Esquina Avenida Luis Muñoz Marín Final, Edificio Profesional Torre Norte, Suite 1405-B",
    secondary: "Caguas, Puerto Rico 00725-https://www.example-municipal-records-portal.pr.gov/catastro/consulta/225-016-807-10/detalle-completo-del-expediente",
  });
  const longAct = "Convert the existing two-story building into a twelve-unit residential condominium with ground-floor retail, a rooftop terrace, a 40-space parking structure, landscaped courtyards and a community swimming pool open to residents and guests";
  out.push({ id: "long-text-en", lang: "en", note: "very long names, address with a URL, long activity", report: build(longSite, parcel, longAct) });
  out.push({ id: "long-text-es", lang: "es", note: "same, Spanish", report: build(longSite, parcel, longAct) });
  return out;
}
