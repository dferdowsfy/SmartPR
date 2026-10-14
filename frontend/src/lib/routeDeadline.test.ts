// Run: npx tsx --test src/lib/routeDeadline.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROUTE_DEADLINE_MS, SITE_LOOKUP_CLIENT_TIMEOUT_MS, raceRouteDeadline, routeDeadlineReason } from "./routeDeadline.ts";
import { parcelFindingsUnavailable } from "../app/locations/parcel.ts";
import { layerReasonText, unavailableSiteLayers } from "../app/locations/layers.ts";
import { reasonText } from "../app/locations/propertyReport.ts";
import { maxDuration as parcelMax } from "../app/api/locations/parcel/route.ts";
import { maxDuration as layersMax } from "../app/api/locations/layers/route.ts";
import { maxDuration as snapMax } from "../app/api/locations/snap/route.ts";
import { LAYERS_DEADLINE_MS, PARCEL_DEADLINE_MS } from "../app/locations/layerService.ts";

test("work that finishes in time wins the race", async () => {
  const r = await raceRouteDeadline(async () => 7, 200, () => -1);
  assert.deepEqual([r.value, r.outcome], [7, "ok"]);
});

test("a hung lookup answers with the fallback at the deadline, never a hang", async () => {
  const started = Date.now();
  const r = await raceRouteDeadline(() => new Promise<number>(() => {}), 40, (reason) => (reason === routeDeadlineReason(40) ? -1 : -2));
  assert.equal(r.outcome, "deadline");
  assert.equal(r.value, -1, "the fallback receives route_deadline_<ms>ms");
  assert.ok(Date.now() - started < 1000);
});

test("a thrown error (sync or async) becomes the fallback, never a 500", async () => {
  const a = await raceRouteDeadline(async () => { throw new Error("boom"); }, 200, (reason) => reason);
  assert.equal(a.outcome, "error");
  assert.match(a.value, /^route_error: boom/);
  const b = await raceRouteDeadline(() => { throw new Error("sync"); }, 200, (reason) => reason);
  assert.equal(b.outcome, "error");
});

test("a late finish after the deadline does not change the answer (and does not throw)", async () => {
  let release!: (v: number) => void;
  const r = await raceRouteDeadline(() => new Promise<number>((res) => { release = res; }), 20, () => -1);
  release(5);
  await new Promise((res) => setTimeout(res, 5));
  assert.equal(r.value, -1);
});

test("route deadlines sit above each internal deadline and under each route's maxDuration", () => {
  assert.ok(ROUTE_DEADLINE_MS.parcel > PARCEL_DEADLINE_MS && ROUTE_DEADLINE_MS.parcel < parcelMax * 1000);
  assert.ok(ROUTE_DEADLINE_MS.layers > LAYERS_DEADLINE_MS && ROUTE_DEADLINE_MS.layers < layersMax * 1000);
  assert.ok(ROUTE_DEADLINE_MS.snap < snapMax * 1000);
});

test("the geo routes race their lookups against the route deadline", () => {
  for (const r of ["parcel", "layers", "snap"]) {
    const src = readFileSync(new URL(`../app/api/locations/${r}/route.ts`, import.meta.url), "utf8");
    assert.match(src, new RegExp(`raceRouteDeadline\\([\\s\\S]*ROUTE_DEADLINE_MS\\.${r}`), `${r} route uses the hard deadline`);
  }
});

test("deadline fallbacks are well-formed 'unable to verify' answers", () => {
  const reason = routeDeadlineReason(ROUTE_DEADLINE_MS.parcel);
  const p = parcelFindingsUnavailable(18.36, -67.26, reason, "2026-10-14T19:00:00.000Z");
  assert.equal(p.boundary.status, "unavailable");
  assert.equal(p.zoning.status, "unavailable");
  assert.equal(p.flood.status, "unavailable");
  assert.equal(p.boundary.reason, reason);
  assert.equal(p.latitude, 18.36);
  const l = unavailableSiteLayers(18.36, -67.26, routeDeadlineReason(ROUTE_DEADLINE_MS.layers));
  assert.ok(l.results.length >= 7 && l.results.every((r) => r.status === "unknown"));
  // Plain language, and offered as retryable.
  const lt = layerReasonText(l.results[0]!.reason, "FEMA");
  assert.equal(lt.retryable, true);
  assert.match(lt.text.en, /took too long/);
  assert.match(reasonText(reason).en, /took longer than 24 s/);
});

test("the browser's own ceiling sits above every route deadline", () => {
  assert.ok(Object.values(ROUTE_DEADLINE_MS).every((ms) => SITE_LOOKUP_CLIENT_TIMEOUT_MS > ms));
  const intake = readFileSync(new URL("../app/SmartPRIntake.tsx", import.meta.url), "utf8");
  assert.equal(intake.match(/SITE_LOOKUP_CLIENT_TIMEOUT_MS\)/g)?.length, 2, "layers and parcel fetches are both capped");
});
