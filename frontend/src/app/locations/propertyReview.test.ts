// Run: npx tsx --test src/app/locations/propertyReview.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyReviewAction, attachReportVersion, emptyReview, exportableReview, parseReviewAction, REVIEW_DISCLAIMER, type PropertyReview } from "./propertyReview.ts";
import { buildPropertyReport, reportSummaryText } from "./propertyReport.ts";
import { restoreSiteLayers } from "./layers.ts";
import type { IntakeSite } from "./intakeLocation.ts";
import type { ParcelFindings } from "./parcel.ts";

const actor = { id: "u1", name: "Arq. Rivera" };
let n = 0;
const id = () => `id${++n}`;
const T = "2026-10-04T10:00:00.000Z";
const ok = (r: ReturnType<typeof applyReviewAction>): PropertyReview => { assert.ok(r.ok, JSON.stringify(r)); return (r as { review: PropertyReview }).review; };

test("review needs a report version; status flow and Reviewed is never approval", () => {
  assert.equal(applyReviewAction(emptyReview(), { type: "set_status", status: "reviewed" }, actor, T, id).ok, false);
  let r = attachReportVersion(emptyReview(), 1, "fpA", actor, T);
  r = ok(applyReviewAction(r, { type: "set_status", status: "under_review" }, actor, T, id));
  r = ok(applyReviewAction(r, { type: "set_status", status: "reviewed" }, actor, T, id));
  assert.equal(r.status, "reviewed");
  assert.equal(r.reviewed_by?.name, "Arq. Rivera");
  assert.match(REVIEW_DISCLAIMER.en, /not a government approval/);
  assert.match(REVIEW_DISCLAIMER.es, /no es una aprobación/);
});

test("open questions block Reviewed; a new question re-opens a reviewed report", () => {
  let r = attachReportVersion(emptyReview(), 1, "fpA", actor, T);
  r = ok(applyReviewAction(r, { type: "add_question", finding_id: "zoning", text: "Which district covers the lodge footprint?" }, actor, T, id));
  const blocked = applyReviewAction(r, { type: "set_status", status: "reviewed" }, actor, T, id);
  assert.deepEqual(blocked, { ok: false, error: "open_questions" });
  const q = r.questions[0]!;
  r = ok(applyReviewAction(r, { type: "resolve_question", question_id: q.id, resolution: "JP map review: lodge is in R-G" }, actor, T, id));
  r = ok(applyReviewAction(r, { type: "set_status", status: "reviewed" }, actor, T, id));
  r = ok(applyReviewAction(r, { type: "add_question", text: "Confirm access road easement" }, actor, T, id));
  assert.equal(r.status, "under_review");
  assert.equal(r.reviewed_at, null);
});

test("history is append-only; removed notes stay in history; new report version re-opens", () => {
  let r = attachReportVersion(emptyReview(), 1, "fpA", actor, T);
  r = ok(applyReviewAction(r, { type: "add_note", finding_id: "flood_zone", text: "Zone X on the whole lot." }, actor, T, id));
  r = ok(applyReviewAction(r, { type: "remove_note", note_id: r.notes[0]!.id }, actor, T, id));
  r = ok(applyReviewAction(r, { type: "set_status", status: "reviewed" }, actor, T, id));
  const before = r.history.length;
  r = attachReportVersion(r, 2, "fpB", actor, "2026-10-05T00:00:00Z");
  assert.equal(r.status, "draft");
  assert.equal(r.report_version, 2);
  assert.equal(r.history.length, before + 1);
  assert.match(r.history.at(-1)!.detail, /re-opened/);
  assert.ok(r.history.some((h) => h.action === "note_removed"));
  assert.equal(r.notes[0]!.removed, true);
});

test("client export carries only selected notes and questions", () => {
  let r = attachReportVersion(emptyReview(), 1, "fpA", actor, T);
  r = ok(applyReviewAction(r, { type: "add_note", text: "Share this", include_in_export: true }, actor, T, id));
  r = ok(applyReviewAction(r, { type: "add_note", text: "Internal only", include_in_export: false }, actor, T, id));
  r = ok(applyReviewAction(r, { type: "add_question", text: "Open for client" }, actor, T, id));
  const e = exportableReview(r)!;
  assert.deepEqual(e.notes.map((x) => x.text), ["Share this"]);
  assert.deepEqual(e.open_questions.map((x) => x.text), ["Open for client"]);
  assert.equal(parseReviewAction({ type: "nope" }), null);
});

// ---- Three representative cases from recorded live sources ---------------
const here = dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(readFileSync(join(here, "fixtures/propertyReportCases.json"), "utf8"));
function caseReport(key: string) {
  const c = FX.cases[key];
  const layers = restoreSiteLayers(c.layers, c.latitude, c.longitude)!;
  const site: IntakeSite = {
    latitude: c.latitude, longitude: c.longitude, coordinate_source: "MAP_PIN", formatted_address: null,
    municipality: { name: c.place.municipio.name, fips: c.place.municipio.fips ?? null }, barrio: c.place.barrio ? { name: c.place.barrio.name, geoid: c.place.barrio.geoid ?? null } : null,
    near_boundary: false, designations: [], boundary_source: null, location_id: null, confirmed_at: T, layers,
  };
  return buildPropertyReport({ site, parcel: c.parcel as ParcelFindings, revision: 1, context: { activity: null, businessType: "Restaurant", projectTypes: [], locationRequirements: [] }, now: new Date(T) });
}

test("case 1 — straightforward parcel (Caguas): one district, no protection constraints", () => {
  const r = caseReport("straightforward");
  assert.equal(r.property.catastro.value, "225-085-948-54");
  assert.equal(r.findings.find((f) => f.id === "zoning")!.value!.en, "R-I");
  assert.equal(r.findings.find((f) => f.id === "flood_zone")!.value!.en, "Zone X");
  assert.ok(!r.findings.some((f) => f.constraint === "protection"));
  assert.ok(!r.next_steps.steps.some((s) => s.constraint === "protection"));
  assert.ok(r.next_steps.steps.some((s) => s.id === "describe_activity"));
});

test("case 2 — protected/rural parcel (Gurabo): conservation + SREP are protection constraints, never bypassable", () => {
  const r = caseReport("protected_rural");
  assert.equal(r.property.catastro.value, "173-000-001-39");
  const z = r.findings.find((f) => f.id === "zoning")!;
  assert.match(z.value!.en, /A-B/);
  assert.equal(z.constraint, "protection");
  assert.equal(r.findings.find((f) => f.id === "land_class")!.constraint, "protection");
  const prot = r.next_steps.steps.filter((s) => s.constraint === "protection");
  assert.ok(prot.length >= 2);
  for (const s of prot) {
    assert.match(s.because.en, /do not remove it/);
    assert.doesNotMatch(s.text.en + s.because.en, /\b(waiver|bypass|exempt|workaround|get around)\b/i);
  }
  const txt = reportSummaryText(r, "en");
  // Protection designations lead the reviewer findings (red), never presented as bypassable.
  const a = r.assessment!;
  assert.ok(a.review.some((x) => x.id === "zoning_conservation") && a.review.some((x) => x.id === "land_class" && x.severe));
  assert.match(txt, /Material constraints or exposure:\n• Land classification: Specially protected rustic land/);
});

test("case 3 — multiple districts / conflicting data (Carolina): every district kept, conflicts and outages listed", () => {
  const r = caseReport("multi_district_b");
  const z = r.findings.find((f) => f.id === "zoning")!;
  assert.equal(z.scope, "parcel");
  assert.ok(z.value!.en.includes("CT-3") && z.value!.en.includes("VIAL"), z.value!.en);
  assert.equal(z.tone, "attention");
  // FEMA vs JP advisory compared at the same place (the pin).
  assert.ok(r.discrepancies!.some((m) => /^At the pin, the JP advisory map shows/.test(m.en)), JSON.stringify(r.discrepancies));
  assert.equal(r.findings.find((f) => f.id === "coastal_zone")!.constraint, "documentation");
  // Sources that did not answer are reported as unavailable, never as "none".
  for (const id of ["historic_zone", "protected_area"]) {
    const f = r.findings.find((x) => x.id === id)!;
    assert.ok(f.state === "unavailable" || f.state === "sourced" || f.state === "none_mapped", f.state);
    if (f.state === "unavailable") assert.equal(f.value, null);
  }
});
