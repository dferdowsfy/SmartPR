/**
 * Record the official answers for the sample parcels (src/app/locations/siteCases).
 *
 *   npm run geo:capture -- [caseId ...]      (default: every case)
 *
 * Runs the app's own server lookups against the LIVE government services and
 * writes every raw response to src/app/locations/siteCases/fixtures/<id>.json.
 * A person runs this deliberately (after reviewing a drift item); nothing
 * schedules it. Cases run one after another to stay gentle on JP / CRIM.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_CASES } from "../src/app/locations/siteCases/cases.ts";
import { isLandslideTile, landslidePixelIndex, runSitePipeline, type RecordedGet, type SiteFixture } from "../src/app/locations/siteCases/pipeline.ts";
import type { FetchLike } from "../src/app/locations/layerService.ts";
import type { PostJson } from "../src/app/locations/parcelService.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "../src/app/locations/siteCases/fixtures");
mkdirSync(OUT, { recursive: true });
const sharp = createRequire(import.meta.url)("sharp");
const ADDRESS_API = process.env.SMARTPR_BASE_URL ?? "https://www.getsmartpr.com";

const ids = process.argv.slice(2);
const cases = ids.length ? SITE_CASES.filter((c) => ids.includes(c.id)) : SITE_CASES;

for (const c of cases) {
  const gets: Record<string, RecordedGet> = {};
  const posts: SiteFixture["posts"] = [];
  const px = landslidePixelIndex(c.latitude, c.longitude);
  const fetchImpl: FetchLike = async (url, init) => {
    try {
      const res = await fetch(url, { signal: init?.signal, headers: init?.headers, cache: "no-store" });
      if (isLandslideTile(url)) {
        if (!res.ok) { gets[url] = { ok: false, status: res.status }; return { ok: false, status: res.status, json: async () => null }; }
        const buf = await res.arrayBuffer();
        const { data, info } = await sharp(Buffer.from(buf)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
    const query = (body as { query?: string })?.query ?? "";
    let response: unknown;
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) response = `http_${res.status}`;
      else { const t = await res.text(); response = t.trim() ? JSON.parse(t) : {}; }
    } catch (err) {
      response = (err as Error)?.name === "AbortError" ? `timeout_${timeoutMs}ms` : `network_error: ${(err as Error)?.message ?? "error"}`;
    } finally { clearTimeout(timer); }
    posts.push({ url, query, response });
    return response;
  };
  const decodePng = async (buf: ArrayBuffer) => {
    const px4 = new Uint8Array(buf);
    const data = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < data.length; i += 4) data.set(px4.subarray(0, 4), i);
    return { width: 256, height: 256, channels: 4, data };
  };
  const now = new Date();
  const t0 = Date.now();
  await runSitePipeline(c, { fetchImpl, postJson, decodePng }, { now, retryDelayMs: 400, withSnap: !!c.offLot });
  let address: SiteFixture["address"] = null;
  try {
    const r = await fetch(`${ADDRESS_API}/api/geocode?lat=${c.latitude}&lng=${c.longitude}`);
    const j = (await r.json()) as { result?: { formatted_address?: string | null; municipality?: string | null } | null; provider?: string };
    address = { formatted_address: j.result?.formatted_address ?? null, municipality: j.result?.municipality ?? null, provider: j.provider ?? null };
  } catch { address = null; }
  const fx: SiteFixture = { id: c.id, captured_at: now.toISOString(), latitude: c.latitude, longitude: c.longitude, address, gets, posts };
  writeFileSync(path.join(OUT, `${c.id}.json`), JSON.stringify(fx) + "\n");
  const fails = Object.entries(gets).filter(([, g]) => !g.ok).map(([u, g]) => `${new URL(u).pathname.split("/").slice(-3).join("/")}:${g.throw?.name ?? g.status}`);
  console.log(`${c.id}: ${Object.keys(gets).length} GET, ${posts.length} POST, ${Math.round((Date.now() - t0) / 1000)} s${fails.length ? ` · failures: ${fails.join(", ")}` : ""}`);
  await new Promise((r) => setTimeout(r, 1500));
}
