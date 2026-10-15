// Santurce regression + land-use engine. Run: npx tsx --test src/app/locations/landUse.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { restoreSiteLayers } from "./layers.ts";
import type { IntakeSite } from "./intakeLocation.ts";
import type { ParcelFindings } from "./parcel.ts";
import { buildPropertyReport, findingStatus } from "./propertyReport.ts";
import { analyzeProposedActivity, bundledLandUseGraphs } from "./landUseGraph.ts";
import { parseProposedActivity } from "./landUse.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(readFileSync(join(here, "fixtures/propertyReportCases.json"), "utf8"));
const C = FX.cases.santurce;
const site: IntakeSite = {
  latitude: C.latitude, longitude: C.longitude, coordinate_source: "MAP_PIN", formatted_address: "Santurce, San Juan, Puerto Rico 00902",
  municipality: { name: "San Juan", fips: "127" }, barrio: { name: "Santurce", geoid: null }, near_boundary: false, designations: [],
  boundary_source: null, location_id: null, confirmed_at: "2026-10-04T12:00:00Z", layers: restoreSiteLayers(C.layers, C.latitude, C.longitude),
};
const parcel = C.parcel as ParcelFindings;
const ctx = { activity: null, businessType: null, projectTypes: [], locationRequirements: [] };
const report = (desc?: string) => buildPropertyReport({ site, parcel, revision: 1, context: ctx, landUse: desc ? analyzeProposedActivity(desc, site, parcel) : null, now: new Date("2026-10-04T12:00:00Z") });
const f = (r: ReturnType<typeof report>, id: string) => r.findings.find((x) => x.id === id)!;

test("Santurce: existing correct findings stay intact", () => {
  const r = report();
  assert.equal(r.property.catastro.value, "040-028-001-24");
  assert.equal(Math.round(r.property.boundary.area_m2!), 7848);
  assert.match(f(r, "zoning").value!.en, /^CT .*· P/);
  assert.match(f(r, "land_class").value!.en, /SU/);
  assert.match(f(r, "flood_zone").value!.en, /X.*VE/);
  assert.equal(f(r, "floodway").value!.en, "None mapped");
  assert.equal(f(r, "flood_advisory").state, "none_mapped");
  assert.equal(f(r, "terrain").value!.en, "Low");
  assert.equal(f(r, "coastal_zone").state, "sourced");
});

test("Santurce: multi-zone parcel shows areas, never 'whole parcel' for each", () => {
  const r = report();
  const z = f(r, "zoning"), fl = f(r, "flood_zone");
  // Small intersections are kept and named as such, never dropped or called errors.
  assert.match(z.value!.en, /^CT 99\.\d% · P 0\.3% \(small\)$/);
  assert.match(z.detail!.en, /P \(Público\): \d+ m² — 0\.3% of the parcel\. Small intersection\./);
  assert.ok(z.notes!.some((n) => /cannot tell whether this is a real strip/.test(n.en)));
  assert.doesNotMatch(z.detail!.en + z.notes!.map((n) => n.en).join(" "), /mapping error|sliver/i);
  assert.match(fl.value!.en, /^Zone X 80\.\d% · VE 19\.\d%$/);
  assert.match(fl.detail!.en, /Zone VE: 1,5\d\d m² — 19\.\d% of the parcel/);
});

test("Santurce: previously 'not performed' checks are now verified or no-mapped", () => {
  const r = report();
  for (const id of ["put", "municipal_plan", "soils", "historic_zone", "protected_area", "archaeology", "wetlands"]) {
    assert.ok(["verified", "no_mapped_constraint"].includes(findingStatus(f(r, id).state)), `${id}: ${f(r, id).state}`);
  }
  assert.match(f(r, "put").value!.en, /SU — Suelo Urbano \(PUT-2014/);
  // Legacy saved record ("revision_1" = due date) is re-read with the official meanings.
  assert.match(f(r, "municipal_plan").value!.en, /^Approved 13-Mar-2003 · first revision was due 13-Mar-2011; no approval recorded$/);
  assert.doesNotMatch(f(r, "municipal_plan").value!.en, /revised/i);
  assert.match(f(r, "soils").value!.en, /Urban land/);
  assert.match(f(r, "zoning_overlay").value!.en, /APE-ZC/);
  // No activity → "Not evaluated", never "Not applicable".
  assert.equal(f(r, "permitted_uses").state, "not_evaluated");
  assert.equal(findingStatus(f(r, "permitted_uses").state), "not_evaluated");
  assert.equal(r.flags!.find((x) => x.id === "compatibility")!.value.en, "Pending proposed activity");
});

const ACTS = {
  hotel: "Build a 120-room hotel",
  multifamily: "Construct a multifamily residential building with 40 apartments",
  restaurant: "Open a restaurant in the existing building",
  office: "Professional offices in the existing building",
  warehouse: "Construct a warehouse",
  solar: "Install a utility-scale solar project",
} as const;

test("activity parsing", () => {
  const lu = bundledLandUseGraphs().lu.landUses;
  const h = parseProposedActivity(ACTS.hotel, lu);
  assert.equal(h.use, "LU_HOTEL"); assert.equal(h.construction, "new"); assert.equal(h.facts.rooms, 120);
  assert.equal(parseProposedActivity(ACTS.restaurant, lu).construction, "none");
  const d = parseProposedActivity("Change residential use to daycare", lu);
  assert.equal(d.use, "LU_DAYCARE"); assert.equal(d.changeOfUse, true);
  assert.equal(parseProposedActivity("Install a utility-scale solar project", lu).use, "LU_SOLAR_UTILITY");
  assert.equal(parseProposedActivity("Subdivide the property", lu).use, "LU_SUBDIVISION");
});

test("Santurce: six activities, different reasoning on the same parcel", () => {
  const A = Object.fromEntries(Object.entries(ACTS).map(([k, v]) => [k, analyzeProposedActivity(v, site, parcel)])) as Record<keyof typeof ACTS, ReturnType<typeof analyzeProposedActivity>>;
  // Base zoning (C-T, Tabla 6.57) — verified RC 2023 text.
  assert.equal(A.hotel.compatibility.baseOutcome, "conditional");
  assert.equal(A.multifamily.compatibility.baseOutcome, "conditional");
  assert.equal(A.restaurant.compatibility.baseOutcome, "permitted");
  assert.equal(A.office.compatibility.baseOutcome, "permitted");
  assert.equal(A.warehouse.compatibility.baseOutcome, "potentially_prohibited");
  assert.equal(A.solar.compatibility.baseOutcome, "potentially_prohibited");
  // The P sliver (0.3%) never decides; the APE-ZC karst overlay prevails → professional review.
  for (const k of ["hotel", "restaurant", "office", "multifamily"] as const) assert.equal(A[k].compatibility.outcome, "professional_review", k);
  assert.equal(A.warehouse.compatibility.outcome, "potentially_prohibited");
  // Every determination is traceable to a verified rule + source.
  for (const a of Object.values(A)) {
    assert.ok(a.compatibility.path.some((p) => p.kind === "rule" && /RC 2023/.test(p.label)), a.activity.raw);
    assert.ok(a.compatibility.path.some((p) => p.kind === "source"), a.activity.raw);
  }
  const ids = (k: keyof typeof ACTS) => A[k].approvals.map((x) => x.ruleId);
  // New construction on a parcel that is 19% VE → floodplain review is LIKELY (partial), not confirmed.
  const flood = A.hotel.approvals.find((x) => x.ruleId === "SR_FLOOD_SFHA_CONSTRUCTION")!;
  assert.equal(flood.status, "likely");
  assert.match(flood.trigger, /Zone VE \(19\.\d% of the parcel\)/);
  assert.ok(flood.evidence.some((e) => /Elevation Certificate/.test(e)));
  assert.ok(flood.path.some((p) => p.kind === "source" && /44 CFR/.test(p.label)));
  // Opening in an existing building does not trigger construction-based reviews.
  assert.ok(!ids("restaurant").includes("SR_FLOOD_SFHA_CONSTRUCTION"));
  assert.ok(ids("restaurant").includes("SR_FOOD_HEALTH"));
  assert.ok(ids("hotel").includes("SR_LODGING_TOURISM"));
  assert.ok(ids("warehouse").includes("SR_USE_NOT_LISTED"));
  assert.ok(ids("solar").includes("SR_SOLAR_INTERCONNECT"));
  for (const k of ["hotel", "warehouse", "multifamily"] as const) for (const r of ["SR_COASTAL_ZONE", "SR_KARST_APE", "SR_WETLANDS_FILL"]) assert.ok(ids(k).includes(r), `${k} ${r}`);
  // Residential density standards only for residential/lodging uses.
  assert.ok(A.multifamily.standards.some((s) => s.id === "DS_CT_DENSITY"));
  assert.ok(!A.office.standards.some((s) => s.id === "DS_CT_DENSITY"));
  // Complexity is explainable and differs by activity.
  assert.ok(A.hotel.complexity.score > A.office.complexity.score);
  assert.ok(A.hotel.complexity.factors.length > 0);
});

test("unknown facts become questions, never guesses; missing rules become QA gaps", () => {
  const vague = analyzeProposedActivity("Something for tourists", site, parcel);
  assert.equal(vague.activity.use, null);
  assert.equal(vague.compatibility.outcome, "insufficient");
  assert.ok(vague.questions.some((q) => q.id === "use"));
  const daycare = analyzeProposedActivity("A daycare", site, parcel);
  assert.ok(daycare.questions.some((q) => q.id === "construction"));
  // A district without graph coverage is flagged, not guessed.
  const p2 = JSON.parse(JSON.stringify(parcel)) as ParcelFindings;
  p2.zoning.districts = [{ ...p2.zoning.districts[0]!, code: "ZZ-9", name: "Distrito desconocido", share: 1, overlays: [] }];
  p2.areas_reliable = { zoning: true, flood: true };
  const r = analyzeProposedActivity("Build a hotel", site, p2);
  assert.equal(r.compatibility.baseOutcome, "insufficient");
  assert.ok(r.coverageGaps.some((g) => g.kind === "zoning_district" && /ZZ-9/.test(g.detail)));
  assert.ok(r.coverageGaps.some((g) => g.kind === "zoning_district" && /could not be verified/i.test(g.detail)));
  assert.ok(!r.coverageGaps.some((g) => /add it with its|No graph district/i.test(g.detail)));
});

function ruralParcel(code: string, name: string): ParcelFindings {
  const p = JSON.parse(JSON.stringify(parcel)) as ParcelFindings;
  p.zoning.districts = [{ ...p.zoning.districts[0]!, code, name, share: 1, overlays: [] }];
  p.areas_reliable = { zoning: true, flood: true };
  return p;
}

test("Aguas Buenas-like R-G: listed uses resolve, unlisted uses go to consulta (never a gap)", () => {
  const rg = ruralParcel("R-G", "Rural General");
  const base = (t: string) => analyzeProposedActivity(t, site, rg).compatibility.baseOutcome;
  assert.equal(base("Agrotourism cabins"), "permitted");
  assert.equal(base("Single-family house"), "permitted");
  assert.equal(base("Open a restaurant"), "conditional");
  const office = analyzeProposedActivity("Professional office", site, rg);
  if (office.activity.use) {
    assert.equal(office.compatibility.baseOutcome, "discretionary");
    assert.ok(!office.coverageGaps.some((g) => g.kind === "use_permission"));
    assert.match(office.districts[0]!.citation ?? "", /6\.69/);
  }
});

test("A-B and R-I districts are covered", () => {
  assert.equal(analyzeProposedActivity("Agrotourism eco-lodge", site, ruralParcel("A-B", "Agrícola Productivo")).compatibility.baseOutcome, "permitted");
  assert.equal(analyzeProposedActivity("Bed and breakfast", site, ruralParcel("R-I", "Residencial Intermedio")).compatibility.baseOutcome, "permitted");
});

test("report carries flags, land-use section and standardized statuses", () => {
  const r = report(ACTS.hotel);
  const ids = r.flags!.map((x) => x.id);
  assert.deepEqual(ids, ["zoning", "land_class", "compatibility", "flood", "coastal", "environmental", "historic", "complexity"]);
  assert.equal(r.flags!.find((x) => x.id === "flood")!.value.en, "High-risk area on 19.5% of the parcel");
  // Governing regulation not verified → undetermined; the RC 2023 reading is kept apart from the conclusion.
  assert.equal(f(r, "permitted_uses").value!.en, "Undetermined — see the evidence gaps");
  assert.match(f(r, "permitted_uses").detail!.en, /^No conclusion yet because .*the regulation governing uses in San Juan has not been confirmed.* Rule reading kept separate \(not a conclusion\): CT: Conditional/);
  assert.equal(r.land_use?.activity.use, "LU_HOTEL");
});

test("Santurce: compact zoning pill ignores the 0.3% edge sliver", () => {
  const r = report();
  const z = r.findings.find((x) => x.id === "zoning")!;
  assert.equal(z.pill?.en, "Commercial");
});
