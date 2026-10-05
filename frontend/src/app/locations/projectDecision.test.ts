// Project decision summary — regression tests.
// The Guaynabo case uses OBSERVED report inputs for parcel 114-042-022-01
// (R-5-T 98.2%, VIAL 1.5%, D-2-T 0.3%; PA-PACUT 98.5%; Zone X 94.9%,
// shaded X 5.1%) as test inputs only — nothing here is hard-coded in
// production, and none of it is a verified legal conclusion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeProposedActivity } from "./landUseGraph.ts";
import { buildPropertyReport, reportSummaryText, type PropertyReportContext } from "./propertyReport.ts";
import { AT, GUAYNABO, synthParcel, synthSite, type SynthSpec } from "./decisionFixtures.ts";

const ctx: PropertyReportContext = { activity: null, businessType: null, projectTypes: [], locationRequirements: [] };
const SFR = "New 3,200-square-foot single-family residence with a pool";

function run(spec: SynthSpec, muni: string, text: string, answers: Record<string, string> | null = null, pinZoning = spec.zoning[0]!.cali) {
  const p = synthParcel(spec);
  const site = synthSite(p, muni, pinZoning);
  const lu = analyzeProposedActivity(text, site, p, { answers });
  const report = buildPropertyReport({ site, parcel: p, revision: 1, context: { ...ctx, activity: text }, landUse: lu, now: new Date(AT) });
  return { lu, d: lu.decision!, report };
}
const ap = (lu: ReturnType<typeof run>["lu"], id: string) => lu.approvals.find((a) => a.ruleId === id);

test("Guaynabo regression: new single-family residence with a pool is parsed as new construction with a pool, never a remodel", () => {
  const { lu } = run(GUAYNABO, "Guaynabo", SFR);
  assert.equal(lu.activity.use, "LU_SINGLE_FAMILY");
  assert.equal(lu.activity.construction, "new");
  assert.equal(lu.activity.facts.area_sqft, 3200);
  assert.equal(lu.activity.components.pool, true);
  assert.ok(!lu.approvals.some((a) => /remodel/i.test(`${a.id} ${a.name} ${a.trigger}`)), lu.approvals.map((a) => a.trigger).join(" | "));
  assert.match(ap(lu, "SR_CONSTRUCTION_PERMIT")!.trigger, /^New construction of a single-family dwelling, about 3,200 sq ft \(297 m²\), including the pool/);
});

test("Guaynabo regression: compatibility is undetermined because PA-PACUT provisions are missing; the R-5-T → R-C rule reading stays separate", () => {
  const { d, lu } = run(GUAYNABO, "Guaynabo", SFR);
  assert.equal(d.compatibility.status, "undetermined");
  assert.equal(d.compatibility.basis, "none");
  assert.ok(d.compatibility.blockedBy.includes("overlay_PA-PACUT"));
  assert.match(d.compatibility.reason.en, /PA-PACUT overlay \(98\.5% of the parcel\) may modify or restrict the base zoning and its provisions have not been obtained/);
  assert.match(d.compatibility.ruleReading!.en, /^R-5-T → R-C \(RC 2023 .*Tabla 6\.6.*p\. 321–322\): Permitted \/ as-of-right — RC 2023 Sección 6\.1\.5\.2\(b\); Tabla 6\.40/);
  assert.ok(!/VIAL|D-2-T/.test(d.compatibility.ruleReading!.en), "road and small districts are not used for the use reading");
  const road = d.governing.districts.find((x) => x.code === "VIAL")!;
  assert.equal(road.road, true);
  assert.match(road.effect.en, /neither treated as a fatal obstacle nor dismissed.*cannot show whether the building, yards or access fall in it/);
  const small = d.governing.districts.find((x) => x.code === "D-2-T")!;
  assert.equal(small.small, true);
  assert.equal(small.rcCode, "D-G");
  const ov = d.governing.overlays.find((o) => o.code === "PA-PACUT")!;
  assert.equal(ov.provisions, "not_obtained");
  assert.equal(ov.effect, "may_modify_or_restrict");
  assert.match(ov.basis!, /Sección 6\.1\.1\.3\(m\) \(p\. 314\)/);
  assert.ok(!lu.districts.some((x) => x.code === "R-5-T" && x.districtId === null), "R-5-T resolves through the Guaynabo equivalence, not as an unknown code");
});

test("Guaynabo regression: flood exposure (shaded Zone X 5.1%) is a constraint, separate from the SFHA and the advisory map", () => {
  const { d, report } = run(GUAYNABO, "Guaynabo", SFR);
  const c = d.constraints.find((x) => x.id === "flood_shaded_x")!;
  assert.match(c.detail.en, /Shaded Zone X \(0\.2% annual-chance flood hazard\) on 5\.1% of the parcel \(effective FIRM\)\. Outside the Special Flood Hazard Area and no regulatory floodway mapped, but it is mapped flood exposure/);
  assert.ok(!d.constraints.some((x) => x.id === "flood_sfha"));
  const a = report.assessment!;
  assert.ok(a.review.some((x) => x.id === "flood_shaded_x" && /approximately 5\.1% of the parcel/.test(x.value.en)));
  assert.ok(!a.clear.some((x) => x.id === "flood_zone"), "flood exposure is not listed as clear");
  assert.ok(a.review.some((x) => x.id === "zoning_minor" && /VIAL 1\.5% \(road district\)/.test(x.value.en) && /D-2-T 0\.3% \(small intersection\)/.test(x.value.en)));
  assert.ok(a.review.some((x) => x.id === "zoning_overlay"));
});

test("Guaynabo regression: every approval names authority, trigger, provision and status; unknown facts stay unresolved", () => {
  const { lu, d } = run(GUAYNABO, "Guaynabo", SFR);
  const cp = ap(lu, "SR_CONSTRUCTION_PERMIT")!;
  assert.equal(cp.requirement, "required");
  assert.match(cp.citation, /Regla 3\.2\.1, Sección 3\.2\.1\.1\(a\) \(p\. 125\)/);
  assert.match(cp.agency, /OGPe, or the autonomous municipality/);
  assert.equal(ap(lu, "SR_FLOOD_CERTIFICATION")!.requirement, "required");
  assert.match(ap(lu, "SR_ICP_ARCHAEOLOGY_EARTHWORK")!.citation, /Sección 2\.1\.8\.7\(b\)\(4\) \(p\. 24\)/);
  for (const id of ["SR_DEMOLITION", "SR_PUBLIC_POOL_HEALTH", "SR_STORMWATER_CGP"]) {
    const x = ap(lu, id)!;
    assert.equal(x.requirement, "unresolved", id);
    assert.ok(x.needs, id);
  }
  assert.deepEqual(new Set(lu.questions.map((q) => q.id)), new Set(["demolition", "disturbance_1acre", "pool_public", "subdivision"]));
  for (const a of lu.approvals) assert.ok(a.agency && a.citation && a.requirement, a.id);
  assert.equal(d.pathway.complete, false);
  assert.match(d.pathway.completeness.en, /^Not a complete approval pathway/);
  assert.ok(!JSON.stringify(lu).includes("Regla to confirm"), "vague citations are replaced by labelled evidence gaps");
});

test("Guaynabo regression: answering the inline questions settles the component approvals", () => {
  const { lu } = run(GUAYNABO, "Guaynabo", SFR, { pool_public: "no", demolition: "yes", disturbance_1acre: "no", subdivision: "no" });
  assert.equal(ap(lu, "SR_PUBLIC_POOL_HEALTH"), undefined, "private pool: the public-pool health recommendation is not listed");
  assert.equal(ap(lu, "SR_DEMOLITION")!.requirement, "required");
  assert.equal(ap(lu, "SR_STORMWATER_CGP"), undefined);
  assert.equal(lu.questions.length, 0);
  assert.ok(!lu.decision!.unresolved.some((g) => g.kind === "project_fact"));
});

test("Guaynabo regression: every unresolved issue says what is missing, why, how to close it and what it blocks", () => {
  const { d } = run(GUAYNABO, "Guaynabo", SFR);
  const ids = d.unresolved.map((g) => g.id);
  for (const id of ["overlay_PA-PACUT", "governing_rules", "permit_authority", "standards_variant", "placement"]) assert.ok(ids.includes(id), `${id} in ${ids.join(",")}`);
  for (const g of d.unresolved) for (const k of ["missing", "why", "obtain", "blocks"] as const) assert.ok(g[k].en.length > 10 && g[k].es.length > 10, `${g.id}.${k}`);
  assert.match(d.unresolved.find((g) => g.id === "placement")!.why.en, /Parcel-wide percentages cannot establish whether the proposed footprint intersects/);
  assert.match(d.pathway.nextAction.en, /^Research task: obtain the adopted Plan de Área del Centro Urbano Tradicional \(PACUT\)/);
});

test("Guaynabo regression: summary, findings, flags, approvals, copy text and JSON export all carry the same decision", () => {
  const { d, report, lu } = run(GUAYNABO, "Guaynabo", SFR);
  const pu = report.findings.find((f) => f.id === "permitted_uses")!;
  assert.equal(pu.detail!.en, d.compatibility.reason.en);
  assert.equal(report.flags!.find((f) => f.id === "compatibility")!.value.en, d.compatibility.label.en);
  assert.ok(report.assessment!.review.find((x) => x.id === "compatibility")!.value.en.startsWith(d.compatibility.label.en));
  const txt = reportSummaryText(report, "en");
  assert.match(txt, /PROJECT DECISION SUMMARY\nProposed use and scope: New construction · single-family dwelling · about 3,200 sq ft \(297 m²\) · with a pool/);
  assert.ok(txt.includes(`Compatibility: ${d.compatibility.label.en} — ${d.compatibility.reason.en}`));
  for (const a of lu.approvals) assert.ok(txt.includes(`• ${a.name} — `), a.name);
  assert.ok(txt.includes(d.pathway.nextAction.en));
  assert.ok(report.summary!.next[0]!.en.includes(d.pathway.nextAction.en));
  const json = JSON.parse(JSON.stringify(report));
  assert.deepEqual(json.land_use.decision.compatibility, JSON.parse(JSON.stringify(d.compatibility)));
  const es = reportSummaryText(report, "es");
  assert.match(es, /RESUMEN DE DECISIÓN DEL PROYECTO/);
  assert.match(es, /Compatibilidad: Indeterminado/);
  // No mapped intersection never reads as no restriction or clearance.
  assert.doesNotMatch(txt, /\bno restrictions?\b|\bcleared\b|\bapproved\b/i);
});

// ---- Additional cases ----------------------------------------------------------------
const ARROYO_RI: SynthSpec = { catastro: "420-000-010-29", pinX: 0.5, zoning: [{ cali: "R-I", x0: 0, x1: 1 }], flood: [{ zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD", x0: 0, x1: 1 }] };

test("rule-based conclusion: Arroyo R-I (governing rules identified) + new single-family house → supported as permitted, cited", () => {
  const { d } = run(ARROYO_RI, "Arroyo", "Build a new single-family house");
  assert.equal(d.compatibility.status, "supported_permitted");
  assert.equal(d.compatibility.basis, "rule");
  assert.match(d.compatibility.reason.en, /^Rule-based conclusion: R-I: Permitted \/ as-of-right — RC 2023 Tabla 6\.32.*not an agency determination/);
});

test("remodeling: an existing-house remodel uses the remodel trigger, not new construction, and no flood certification for new works", () => {
  const { lu, d } = run(ARROYO_RI, "Arroyo", "Remodel the kitchen of the existing house");
  assert.equal(lu.activity.construction, "renovation");
  assert.equal(ap(lu, "SR_CONSTRUCTION_PERMIT")!.trigger, "Remodelling / alteration of an existing structure (stated).");
  assert.equal(ap(lu, "SR_FLOOD_CERTIFICATION"), undefined);
  assert.match(d.scope.en, /^Remodelling of an existing structure/);
  assert.ok(!lu.questions.some((q) => q.id === "demolition"), "no demolition question for an interior remodel");
});

test("unresolved overlay: an overlay SmartPR has no record of keeps compatibility undetermined and becomes a research task", () => {
  const spec: SynthSpec = { ...ARROYO_RI, zoning: [{ cali: "R-I", x0: 0, x1: 1, overlay: "ZE-X" }], overlays: [{ code: "ZE-X", x0: 0, x1: 0.6 }] };
  const { d, report } = run(spec, "Arroyo", "Build a new single-family house");
  assert.equal(d.compatibility.status, "undetermined");
  assert.ok(d.compatibility.blockedBy.includes("overlay_ZE-X"));
  const o = d.governing.overlays[0]!;
  assert.equal(o.effect, "unknown");
  assert.match(o.effectText.en, /Unknown whether it adds, modifies or restricts the base zoning \(60\.0% of the parcel\)/);
  const g = d.unresolved.find((x) => x.id === "overlay_ZE-X")!;
  assert.match(g.blocks.en, /Compatibility conclusion/);
  assert.ok(d.unresolved.some((x) => x.id === "placement"), "overlay on part of the parcel → placement matters");
  assert.ok(report.assessment!.review.some((x) => x.id === "zoning_overlay"));
});

test("mixed zoning: districts that give different answers make the result depend on placement → undetermined", () => {
  const spec: SynthSpec = { ...ARROYO_RI, zoning: [{ cali: "R-I", x0: 0, x1: 0.6 }, { cali: "A-B", x0: 0.6, x1: 1 }] };
  const { d } = run(spec, "Arroyo", "Build a new single-family house");
  assert.equal(d.compatibility.status, "undetermined");
  assert.ok(d.compatibility.blockedBy.includes("mixed"), d.compatibility.blockedBy.join(","));
  assert.match(d.compatibility.reason.en, /R-I: Permitted .*A-B: Conditional.*depends on where the building sits/);
});

test("unavailable source: a source that did not answer is an evidence gap, never 'none'", () => {
  const spec: SynthSpec = { ...ARROYO_RI, unavailable: ["wetlands"] };
  const { d, report } = run(spec, "Arroyo", "Build a new single-family house");
  const g = d.unresolved.find((x) => x.id === "sources_unavailable")!;
  assert.match(g.missing.en, /wetlands/);
  assert.match(g.why.en, /Unknown is not clear/);
  assert.ok(!d.constraints.some((c) => c.id === "wetlands"));
  assert.ok(report.assessment!.unable.some((x) => /wetland/i.test(x.id + x.label.en)), report.assessment!.unable.map((x) => x.id).join(","));
});

test("missing use: no recognised use → undetermined with the specific reason", () => {
  const { d } = run(ARROYO_RI, "Arroyo", "Build a new widget factory");
  assert.equal(d.compatibility.status, "undetermined");
  assert.ok(d.compatibility.blockedBy.includes("use"));
});
