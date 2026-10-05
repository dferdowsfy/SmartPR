// Site-report consistency: replays every recorded site case (no network) and
// checks the report, PDF, chips and official facts agree with each other.
// Run: npx tsx --test src/app/locations/siteConsistency.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SITE_CASES } from "./siteCases/cases.ts";
import { checkCase, runCase } from "./siteCases/consistency.ts";
import { MUNICIPIOS } from "./municipios.ts";

const fixture = (id: string) => fileURLToPath(new URL(`./siteCases/fixtures/${id}.json`, import.meta.url));

// All 17 fixtures currently replay clean (no DEGRADED TODOs).
const DEGRADED: Record<string, string> = {};

test("site cases: 17 recorded cases", () => {
  assert.equal(SITE_CASES.length, 17);
});

test("municipios: exactly 78 distinct entries", () => {
  assert.equal(MUNICIPIOS.length, 78);
  assert.equal(new Set(MUNICIPIOS).size, 78);
});

for (const c of SITE_CASES) {
  test(`site case ${c.id}: report outputs are consistent`, { todo: DEGRADED[c.id] }, async () => {
    const p = fixture(c.id);
    assert.ok(existsSync(p), `missing fixture ${c.id}.json`);
    const run = await runCase(c, JSON.parse(readFileSync(p, "utf8")));
    const issues = checkCase(run).map((i) => `[${i.output}] ${i.fact}: expected ${i.expected.slice(0, 140)} | actual ${i.actual.slice(0, 200)}`);
    assert.deepEqual(issues, []);
  });
}

// ---- geo:drift review items (read-only) ----------------------------------------------------
test("geo:drift: identical answers give no items; a changed zone goes to the land-use reviewer; a silent source retries", async () => {
  const { officialFacts } = await import("./siteCases/officialFacts.ts");
  const { diffOfficialFacts } = await import("./siteCases/drift.ts");
  const c = SITE_CASES[0]!;
  const rec = officialFacts(JSON.parse(readFileSync(fixture(c.id), "utf8")));
  assert.deepEqual(diffOfficialFacts(c, rec, rec), []);
  const changed = diffOfficialFacts(c, rec, { ...rec, captured_at: "2099-01-01T00:00:00.000Z", jp: { ...rec.jp, cali: "ZZ-TEST" } });
  assert.equal(changed.length, 1);
  assert.equal(changed[0]!.route, "land_use_reviewer");
  assert.match(changed[0]!.what_changed, /ZZ-TEST/);
  const silent = diffOfficialFacts(c, rec, { ...rec, fema: { ...rec.fema, answered: false }, femaParcel: { ...rec.femaParcel, answered: false } });
  assert.ok(silent.length >= 1 && silent.every((i) => i.route === "auto_resolve"));
  assert.equal(silent.filter((i) => i.evidence.source.startsWith("FEMA")).length, 1);
});
