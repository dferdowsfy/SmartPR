import { test } from "node:test";
import assert from "node:assert/strict";
import { activeFilingFor, municipalityConflict, municipalRequirements } from "./activeFiling.ts";
import { AGENCY_FILING_CONFIGS } from "../../lib/agency-runs/filingTypes.ts";

const m = (id: string, status: string, opened = "2026-09-01") => ({ id, title: id, matter_type: "OTHER", status, readiness_score: null, opened_at: opened });
const o = (id: string, status: string, matter_id = "m1", requirement_id: string | null = null, agency = "OGPe") => ({ id, name: id, agency, matter_id, requirement_id, status: status as never, next_action: "" });
const puReq = AGENCY_FILING_CONFIGS.find((c) => c.id === "OGPE_PERMISO_UNICO")?.requirementIds?.[0] ?? null;

test("no active matter → null", () => {
  assert.equal(activeFilingFor([m("m1", "COMPLETED")], [], []), null);
});

test("blockers → action needed, next = highest-priority blocker with its regulatory reason", () => {
  const a = activeFilingFor([m("m1", "IN_PROGRESS")], [o("a", "COMPLETED"), o("b", "IN_PROGRESS"), o("c", "MISSING", "m1", "DOC_ALCOHOL_LICENSE")], [])!;
  assert.equal(a.stage, "action_needed");
  assert.equal(a.next?.item.id, "c");
  assert.match(a.next?.why?.en ?? "", /alcohol/i);
  assert.equal(a.done, 1); assert.equal(a.total, 3); assert.equal(a.pct, 33);
  assert.equal(a.agency, "OGPe");
});

test("only in-progress / upcoming blockers", () => {
  assert.equal(activeFilingFor([m("m1", "IN_PROGRESS")], [o("b", "IN_PROGRESS")], [])!.stage, "in_progress");
  assert.equal(activeFilingFor([m("m1", "IN_PROGRESS")], [o("b", "UPCOMING")], [])!.stage, "upcoming");
});

test("all linked requirements done → ready for submission, never 'approved'", () => {
  assert.equal(activeFilingFor([m("m1", "READY")], [o("a", "COMPLETED")], [])!.stage, "ready_for_submission");
});

test("Clara run state wins: review → ready for review; submitted → waiting on agency", { skip: !puReq }, () => {
  const obs = [o("a", "MISSING", "m1", puReq)];
  assert.equal(activeFilingFor([m("m1", "IN_PROGRESS")], obs, [{ filing_type: "OGPE_PERMISO_UNICO", status: "review" }])!.stage, "ready_for_review");
  assert.equal(activeFilingFor([m("m1", "IN_PROGRESS")], obs, [{ filing_type: "OGPE_PERMISO_UNICO", status: "submitted" }])!.stage, "submitted_waiting");
  assert.equal(activeFilingFor([m("m1", "IN_PROGRESS")], obs, [{ filing_type: "SURI_MERCHANT_REGISTRATION", status: "review" }])!.stage, "action_needed", "another filing's run does not count");
});

test("focus prefers needs-attention, then newest", () => {
  const a = activeFilingFor([m("old", "IN_PROGRESS", "2026-01-01"), m("new", "IN_PROGRESS", "2026-09-01"), m("att", "NEEDS_ATTENTION", "2025-01-01")], [], [])!;
  assert.equal(a.matter.id, "att");
  assert.deepEqual(a.others.map((x) => x.id), ["new", "old"]);
});

const loc = (muni: string | null, geo: string | null, primary = true) => ({ name: "Local", is_primary: primary, municipality: muni, geographies: geo ? [{ geography_type: "municipality", geography_name: geo, determination_method: "SPATIAL_INTERSECTION", determined_at: "2026-01-01" }] : [] }) as never;

test("municipality conflict uses the pin's municipality, accent-insensitive, never picks one", () => {
  assert.equal(municipalityConflict("Bayamón", [loc(null, "Bayamon")]), null);
  assert.deepEqual(municipalityConflict("Camuy", [loc("Camuy", "Hatillo")]), { passport: "Camuy", location: "Hatillo", locationName: "Local" });
  assert.equal(municipalityConflict(null, [loc(null, "Hatillo")]), null);
  assert.equal(municipalityConflict("Camuy", []), null);
});

test("municipal requirements are the ones named for the municipality", () => {
  assert.deepEqual(municipalRequirements([{ name: "Patente Municipal", agency: "Municipio" }, { name: "EIN", agency: "IRS" }]).map((x) => x.name), ["Patente Municipal"]);
});
