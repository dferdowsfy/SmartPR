// Run: npx tsx --test src/lib/geoWarmup.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { geoWarmupEnabled, geoWarmupUrls, runGeoWarmup, WARMUP_PIN } from "./geoWarmup.ts";
import { locateInPuertoRico } from "../app/locations/boundaries.ts";

test("warm-up runs only in the production Node server unless forced", () => {
  assert.equal(geoWarmupEnabled({ NODE_ENV: "production", NEXT_RUNTIME: "nodejs" }), true);
  assert.equal(geoWarmupEnabled({ NODE_ENV: "production", NEXT_RUNTIME: "edge" }), false);
  assert.equal(geoWarmupEnabled({ NODE_ENV: "production", SMARTPR_GEO_WARMUP: "0" }), false);
  assert.equal(geoWarmupEnabled({ NODE_ENV: "development" }), false);
  assert.equal(geoWarmupEnabled({ NODE_ENV: "test", SMARTPR_GEO_WARMUP: "1" }), true);
});

test("warm-up asks this server only, read-only, about one known pin in Puerto Rico", () => {
  const urls = geoWarmupUrls(8080);
  assert.deepEqual(urls.map((u) => new URL(u).pathname), ["/api/locations/resolve", "/api/locations/layers", "/api/locations/parcel"]);
  assert.ok(urls.every((u) => new URL(u).host === "127.0.0.1:8080"));
  assert.equal(locateInPuertoRico(WARMUP_PIN.latitude, WARMUP_PIN.longitude)?.municipio.name, "Caguas");
});

test("warm-up is sequential and swallows failures", async () => {
  let active = 0;
  let maxActive = 0;
  const seen: string[] = [];
  const lines: string[] = [];
  const res = await runGeoWarmup(geoWarmupUrls(3000), async (url) => {
    active++; maxActive = Math.max(maxActive, active); seen.push(url);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    if (url.includes("/layers")) throw new Error("connection refused");
    return { status: 200, text: async () => "{}" };
  }, (l) => lines.push(l));
  assert.equal(maxActive, 1, "one request at a time");
  assert.equal(seen.length, 3);
  assert.deepEqual(res.map((r) => r.status), [200, null, 200]);
  assert.match(lines[0]!, /\[warmup\] geo routes: resolve 200 .* layers connection refused .* parcel 200/);
});
