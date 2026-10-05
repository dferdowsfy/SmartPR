/**
 * Read-only map-data drift check for the sample parcels (src/app/locations/siteCases).
 *
 *   npm run geo:drift -- [caseId ...]   (default: every case)
 *   npm run geo:drift -- --json         machine-readable items
 *
 * Looks the sample points up again on the LIVE government services, compares
 * the official answers with the recorded fixtures, and prints plain-language
 * review items (what changed, which outputs may be affected, the official
 * evidence, the recommended action, and who should review it).
 *
 * It never writes fixtures, changes rules, or deploys anything. Items are also
 * written to $GEO_DRIFT_OUT (default /tmp/geo-drift.json) for the review queue,
 * together with each case's readiness label (siteCases/readiness.ts).
 * Exit 0 always: drift is a review item, not a build failure.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_CASES } from "../src/app/locations/siteCases/cases.ts";
import { officialFacts } from "../src/app/locations/siteCases/officialFacts.ts";
import { checkCase, runCase } from "../src/app/locations/siteCases/consistency.ts";
import { assessCase, LABEL_TEXT, type CaseReadiness } from "../src/app/locations/siteCases/readiness.ts";
import { diffOfficialFacts, engineeringItems, ROUTE_TEXT, type DriftItem } from "../src/app/locations/siteCases/drift.ts";
import { isLandslideTile, landslidePixelIndex, runSitePipeline, type RecordedGet, type SiteFixture } from "../src/app/locations/siteCases/pipeline.ts";
import type { FetchLike } from "../src/app/locations/layerService.ts";
import type { PostJson } from "../src/app/locations/parcelService.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, "../src/app/locations/siteCases/fixtures");
const sharp = createRequire(import.meta.url)("sharp");
const args = process.argv.slice(2);
const json = args.includes("--json");
const ids = args.filter((a) => !a.startsWith("--"));
const cases = ids.length ? SITE_CASES.filter((c) => ids.includes(c.id)) : SITE_CASES;

async function liveFixture(c: (typeof SITE_CASES)[number], recorded: SiteFixture): Promise<SiteFixture> {
  const gets: Record<string, RecordedGet> = {};
  const posts: SiteFixture["posts"] = [];
  const px = landslidePixelIndex(c.latitude, c.longitude);
  const fetchImpl: FetchLike = async (url, init) => {
    try {
      const res = await fetch(url, { signal: init?.signal, headers: init?.headers, cache: "no-store" });
      if (isLandslideTile(url)) {
        if (!res.ok) { gets[url] = { ok: false, status: res.status }; return { ok: false, status: res.status, json: async () => null }; }
        const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const i = (px.y * info.width + px.x) * info.channels;
        const rgba = Array.from(data.subarray(i, i + 4) as Uint8Array);
        gets[url] = { ok: true, status: res.status, rgba };
        return { ok: true, status: res.status, json: async () => null, arrayBuffer: async () => new Uint8Array(rgba).buffer };
      }
      const text = res.ok ? await res.text() : "";
      let body: unknown = null;
      let badJson = false;
      if (res.ok) { try { body = JSON.parse(text); } catch { badJson = true; } }
      gets[url] = { ok: res.ok, status: res.status, ...(res.ok ? (badJson ? { badJson } : { body }) : {}) };
      return { ok: res.ok, status: res.status, json: async () => { if (badJson) throw new SyntaxError("bad json"); return body; } };
    } catch (err) {
      const e = err as Error;
      gets[url] = { ok: false, status: 0, throw: { name: e?.name ?? "Error", message: String(e?.message ?? err).slice(0, 200) } };
      throw err;
    }
  };
  const postJson: PostJson = async (url, body, timeoutMs) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let response: unknown;
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) response = `http_${res.status}`;
      else { const t = await res.text(); response = t.trim() ? JSON.parse(t) : {}; }
    } catch (err) {
      response = (err as Error)?.name === "AbortError" ? `timeout_${timeoutMs}ms` : `network_error: ${(err as Error)?.message ?? "error"}`;
    } finally { clearTimeout(timer); }
    posts.push({ url, query: (body as { query?: string })?.query ?? "", response });
    return response;
  };
  const decodePng = async (buf: ArrayBuffer) => {
    const px4 = new Uint8Array(buf);
    const data = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < data.length; i += 4) data.set(px4.subarray(0, 4), i);
    return { width: 256, height: 256, channels: 4, data };
  };
  const now = new Date();
  await runSitePipeline(c, { fetchImpl, postJson, decodePng }, { now, retryDelayMs: 400, withSnap: !!c.offLot });
  // The address comes from our own geocoder, not a government map; keep the recorded one.
  return { id: c.id, captured_at: now.toISOString(), latitude: c.latitude, longitude: c.longitude, address: recorded.address, gets, posts };
}

const items: DriftItem[] = [];
const readiness: CaseReadiness[] = [];
/** Readiness from the live run when it built, otherwise from the recorded fixture (replay, no network). */
async function readinessFor(c: (typeof SITE_CASES)[number], fx: SiteFixture, drift: DriftItem[], issues?: Awaited<ReturnType<typeof checkCase>>) {
  try {
    const run = await runCase(c, fx);
    readiness.push(assessCase({ case: c, facts: run.official, layers: run.pipeline.layers.results, issues: issues ?? checkCase(run), drift }));
  } catch (err) {
    readiness.push({ case_id: c.id, case_label: c.label, label: "needs_professional_review", gaps: [{ id: "report_not_built", severity: "needs_professional_review", owner: "engineering", explanation: `The report could not be built for this case (${String((err as Error)?.message ?? err).slice(0, 120)}).` }] });
  }
}
for (const c of cases) {
  const recorded = JSON.parse(readFileSync(path.join(FX, `${c.id}.json`), "utf8")) as SiteFixture;
  let live: SiteFixture;
  try { live = await liveFixture(c, recorded); } catch (err) {
    items.push({ case_id: c.id, case_label: c.label, route: "auto_resolve", what_changed: `The live lookup for this location stopped early (${(err as Error)?.message ?? "error"}).`, affects: "Nothing yet", evidence: { source: "live lookup", recorded: "answered", live: "stopped", recorded_at: recorded.captured_at, checked_at: new Date().toISOString() }, recommended_action: "No action now. The next scheduled check retries it; if it keeps failing, it moves to engineering." });
    await readinessFor(c, recorded, items.filter((i) => i.case_id === c.id));
    continue;
  }
  const found = diffOfficialFacts(c, officialFacts(recorded), officialFacts(live));
  let liveIssues: ReturnType<typeof checkCase> | undefined;
  try { liveIssues = checkCase(await runCase(c, live)); found.push(...engineeringItems(c, liveIssues, live.captured_at, recorded.captured_at)); } catch (err) {
    found.push(...engineeringItems(c, [{ case: c.id, output: "report", fact: "report could be built from live answers", expected: "built", actual: String((err as Error)?.message ?? err).slice(0, 200) }], live.captured_at, recorded.captured_at));
  }
  items.push(...found);
  await readinessFor(c, liveIssues ? live : recorded, found, liveIssues);
  if (!json) console.log(`${c.id}: ${found.length ? `${found.length} item(s)` : "no change"}`);
  await new Promise((r) => setTimeout(r, 1500)); // stay gentle on JP / CRIM
}

const out = process.env.GEO_DRIFT_OUT ?? "/tmp/geo-drift.json";
writeFileSync(out, JSON.stringify({ checked_at: new Date().toISOString(), cases: cases.map((c) => c.id), items, readiness }, null, 2) + "\n");
if (json) console.log(JSON.stringify(items, null, 2));
else {
  for (const i of items) console.log(`\n[${ROUTE_TEXT[i.route]}] ${i.case_label}\n  ${i.what_changed}\n  May affect: ${i.affects}\n  Evidence: ${i.evidence.source}: recorded ${i.evidence.recorded} (${i.evidence.recorded_at}) vs live ${i.evidence.live} (${i.evidence.checked_at})\n  Recommended: ${i.recommended_action}`);
  for (const r of readiness) console.log(`\n${LABEL_TEXT[r.label]}: ${r.case_label}${r.gaps.map((g) => `\n  - ${g.explanation}`).join("")}`);
  console.log(`\n${items.length} review item(s) across ${cases.length} case(s). Written to ${out}. Nothing was changed.`);
}
