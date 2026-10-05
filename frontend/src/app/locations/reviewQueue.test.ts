// Review queue: groups stored geo:drift items by reviewer, read-only.
// Run: npx tsx --test src/app/locations/reviewQueue.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildReviewQueue, loadReviewQueue, ROUTE_ORDER } from "./siteCases/reviewQueue.ts";
import type { DriftItem } from "./siteCases/drift.ts";

const item = (route: string, label: string): DriftItem => ({
  case_id: label.toLowerCase(), case_label: label, route: route as DriftItem["route"],
  what_changed: "The FEMA flood map (NFHL) now gives a different governing flood zone at the pin: it was X and is now AE.",
  affects: "Flood finding, flood chip, PDF",
  evidence: { source: "FEMA flood map (NFHL)", recorded: "X", live: "AE", recorded_at: "2026-10-01T00:00:00Z", checked_at: "2026-10-05T00:00:00Z" },
  recommended_action: "Have a qualified land-use reviewer confirm the new official answer.",
});

test("review queue: groups by route in reviewer-first order, skipping empty groups", () => {
  const q = buildReviewQueue({ checked_at: "2026-10-05T00:00:00Z", cases: ["a", "b"], items: [item("auto_resolve", "Patillas"), item("land_use_reviewer", "Arroyo"), item("land_use_reviewer", "Aguadilla")] });
  assert.equal(q.status, "ok");
  if (q.status !== "ok") return;
  assert.deepEqual(q.groups.map((g) => g.route), ["land_use_reviewer", "auto_resolve"]);
  assert.deepEqual(q.groups.map((g) => g.title), ["Land-use reviewer", "Retries automatically"]);
  assert.deepEqual(q.groups[0].items.map((i) => i.case_label), ["Aguadilla", "Arroyo"]);
  assert.equal(q.total, 3);
  assert.equal(q.dropped, 0);
});

test("review queue: only the three known routes; anything else (e.g. the owner) is dropped", () => {
  assert.deepEqual([...ROUTE_ORDER].sort(), ["auto_resolve", "engineering", "land_use_reviewer"]);
  const q = buildReviewQueue({ items: [item("owner", "X"), item("darius", "Y"), { route: "engineering" }, item("engineering", "Z")] });
  assert.equal(q.status, "ok");
  if (q.status !== "ok") return;
  assert.equal(q.total, 1);
  assert.equal(q.dropped, 3);
  assert.deepEqual(q.groups.map((g) => g.route), ["engineering"]);
});

test("review queue: empty check has no groups; bad shapes are reported, not thrown", () => {
  const empty = buildReviewQueue({ checked_at: null, items: [] });
  assert.equal(empty.status === "ok" && empty.groups.length, 0);
  assert.equal(buildReviewQueue({ nope: 1 }).status, "invalid");
  assert.equal(buildReviewQueue(null).status, "invalid");
});

test("review queue: loads from disk without network; missing and corrupt files are handled", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rq-"));
  assert.equal(loadReviewQueue(path.join(dir, "absent.json")).status, "missing");
  const bad = path.join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  assert.equal(loadReviewQueue(bad).status, "invalid");
  const good = path.join(dir, "good.json");
  writeFileSync(good, JSON.stringify({ checked_at: "2026-10-05T00:00:00Z", cases: ["arroyo"], items: [item("land_use_reviewer", "Arroyo")] }));
  const q = loadReviewQueue(good);
  assert.equal(q.status === "ok" && q.groups[0].items[0].evidence.live, "AE");
});
