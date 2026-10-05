// Per-case readiness labels (internal only): explicit criteria, gaps explained.
// Run: npx tsx --test src/app/locations/readiness.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SITE_CASES, siteCase } from "./siteCases/cases.ts";
import { checkCase, runCase } from "./siteCases/consistency.ts";
import { assessCase, parseReadiness, PLATFORM_GAPS, type ReadinessInput } from "./siteCases/readiness.ts";
import { buildReviewQueue } from "./siteCases/reviewQueue.ts";
import type { OfficialFacts } from "./siteCases/officialFacts.ts";
import type { SiteLayerResult } from "./layers.ts";

const fixture = (id: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./siteCases/fixtures/${id}.json`, import.meta.url)), "utf8"));

const cleanFacts = (): OfficialFacts => ({
  captured_at: "2026-10-04T00:00:00Z",
  crim: { answered: true, catastro: "225-044-031-13", tipo: null, ring: null },
  jp: { answered: true, cali: "DT-G", descrip: null, clasi: "SU", vigencia: null, resolucion: null, num_catast: null },
  jpParcel: { answered: true, districts: ["DT-G"] },
  fema: { answered: true, zones: ["X"], governing: "X", floodway: false, panel: null, effective: null },
  femaParcel: { answered: true, keys: ["X|"] },
  advisory: { answered: true, zone: null, in02: false },
  coastal: { answered: true, inside: false },
  historicParcel: { answered: true, inside: false },
  wetlandsParcel: { answered: true, inside: false },
});
const layer = (l: SiteLayerResult["layer"], status: SiteLayerResult["status"], reason: string | null = null) => ({ layer: l, status, reason }) as SiteLayerResult;
const input = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  case: siteCase("caguas_town")!, facts: cleanFacts(), issues: [], drift: [],
  layers: [layer("historic_zone", "none"), layer("protected_area", "none")], ...over,
});

test("readiness: a fully clean case is client-ready only once the platform gaps close", () => {
  assert.equal(assessCase(input(), []).label, "ready_for_client_delivery");
  const r = assessCase(input());
  assert.equal(r.label, "ready_for_internal_screening");
  assert.deepEqual(r.gaps.map((g) => g.id), PLATFORM_GAPS.map((g) => g.id));
  assert.match(r.gaps[0].explanation, /permitted-use matrix/);
});

test("readiness: each known gap forces professional review and is explained", () => {
  const cases: Array<[string, Partial<ReadinessInput>, RegExp]> = [
    ["historic_zone_no_answer", { layers: [layer("historic_zone", "unknown", "timeout_3500ms")] }, /historic-zone lookup .*did not answer \(timeout_3500ms\)/],
    ["protected_area_no_answer", { layers: [layer("protected_area", "unknown")] }, /protected natural area/],
    ["abfe_not_in_flood_rule", { facts: { ...cleanFacts(), advisory: { answered: true, zone: "A", in02: false } } }, /advisory flood map \(ABFE\) puts the pin in zone A while the effective FEMA map says X/],
    ["zmt_not_checked", { facts: { ...cleanFacts(), coastal: { answered: true, inside: true } } }, /maritime-terrestrial zone \(ZMT\)/],
    ["wetlands_not_in_rules", { facts: { ...cleanFacts(), wetlandsParcel: { answered: true, inside: true } } }, /wetlands/],
    ["off_lot_pin", { case: siteCase("arroyo_road_pin")!, facts: { ...cleanFacts(), wetlandsParcel: { answered: false, inside: null } } }, /on a street/],
    ["output_mismatch", { issues: [{ case: "x", output: "pdf", fact: "flood zone", expected: "AE", actual: "X" }] }, /outputs disagree in 1 place/],
  ];
  for (const [id, over, re] of cases) {
    const r = assessCase(input(over));
    assert.equal(r.label, "needs_professional_review", id);
    const g = r.gaps.find((x) => x.id === id);
    assert.ok(g, `${id} listed`);
    assert.equal(g.severity, "needs_professional_review");
    assert.match(g.explanation, re);
  }
});

test("readiness: drift items set the label by route; a retrying source only blocks client delivery", () => {
  const d = (route: "auto_resolve" | "engineering" | "land_use_reviewer") => ({ case_id: "caguas_town", case_label: "Caguas", route, what_changed: "The zoning district changed from DT-G to C-L.", affects: "Zoning", evidence: { source: "JP zoning map", recorded: "DT-G", live: "C-L", recorded_at: "", checked_at: "" }, recommended_action: "Review" });
  assert.equal(assessCase(input({ drift: [d("auto_resolve")] }), []).label, "ready_for_internal_screening");
  assert.equal(assessCase(input({ drift: [d("land_use_reviewer")] })).label, "needs_professional_review");
  assert.equal(assessCase(input({ drift: [d("engineering"), d("engineering")] })).gaps.filter((g) => g.id === "live_read_failed").length, 1);
});

test("readiness: recorded cases today — none is client-ready, and every label says why", async () => {
  for (const c of SITE_CASES) {
    const run = await runCase(c, fixture(c.id));
    const r = assessCase({ case: c, facts: run.official, layers: run.pipeline.layers.results, issues: checkCase(run), drift: [] });
    assert.notEqual(r.label, "ready_for_client_delivery", c.id);
    assert.ok(r.gaps.length > 0 && r.gaps.every((g) => g.explanation.length > 20), c.id);
    if (c.id === "isla_verde") assert.ok(r.gaps.some((g) => g.id === "abfe_not_in_flood_rule" && /zone AO/.test(g.explanation)));
    if (c.id === "arroyo_coastal_ve") assert.ok(r.gaps.some((g) => g.id === "zmt_not_checked"));
  }
});

test("readiness: stored rows are validated and surfaced on the review queue, professional review first", () => {
  const good = (id: string, label: string) => ({ case_id: id, case_label: id, label, gaps: [{ id: "g", severity: "blocks_client_delivery", owner: "product", explanation: "gap" }] });
  assert.equal(parseReadiness([good("a", "ready_for_internal_screening"), good("b", "owner_ok"), { case_id: 1 }]).length, 1);
  const q = buildReviewQueue({ items: [], readiness: [good("b", "ready_for_internal_screening"), good("a", "needs_professional_review")] });
  assert.equal(q.status, "ok");
  if (q.status !== "ok") return;
  assert.deepEqual(q.readiness.map((r) => r.case_id), ["a", "b"]);
  const old = buildReviewQueue({ items: [] });
  assert.equal(old.status === "ok" && old.readiness.length, 0);
});
