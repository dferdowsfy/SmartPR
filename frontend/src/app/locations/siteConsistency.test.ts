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

// Fixtures whose last capture missed a live request (zoning MapServer/0 parcel
// query unrecorded after upstream 502s/timeouts). Reported as TODO, not
// failures, until they are recaptured against healthy services.
const DEGRADED: Record<string, string> = {
  arroyo_agricultural: "zoning parcel query not recorded; recapture",
  patillas_mountain: "zoning parcel query not recorded; recapture",
  jayuya_mountain: "zoning parcel query not recorded; recapture",
};

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
