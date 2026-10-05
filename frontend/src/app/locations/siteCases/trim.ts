/**
 * Fixture size control. Official polygon layers (FEMA NFHL zone X, PUT, soils)
 * return island-scale polygons whose vertices are mostly kilometres away from
 * the case. We clip every returned ring to the case's window (CRIM parcel
 * bounding box, or the pin, plus a margin) with Sutherland–Hodgman. Anything a
 * report measures (point-in-polygon at the pin, intersection with the parcel,
 * nearby lots) lies inside the window, so the replayed report is unchanged —
 * `trim.test` in siteConsistency.test.ts asserts that for every case.
 */
import type { SiteFixture } from "./pipeline.ts";

export type Box = { minX: number; minY: number; maxX: number; maxY: number };
type Pt = number[];

export function clipRing(ring: Pt[], b: Box): Pt[] {
  let out = ring.slice(0, ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? -1 : undefined);
  const edges: Array<[(p: Pt) => boolean, (a: Pt, c: Pt) => Pt]> = [
    [(p) => p[0] >= b.minX, (a, c) => [b.minX, a[1] + ((c[1] - a[1]) * (b.minX - a[0])) / (c[0] - a[0])]],
    [(p) => p[0] <= b.maxX, (a, c) => [b.maxX, a[1] + ((c[1] - a[1]) * (b.maxX - a[0])) / (c[0] - a[0])]],
    [(p) => p[1] >= b.minY, (a, c) => [a[0] + ((c[0] - a[0]) * (b.minY - a[1])) / (c[1] - a[1]), b.minY]],
    [(p) => p[1] <= b.maxY, (a, c) => [a[0] + ((c[0] - a[0]) * (b.maxY - a[1])) / (c[1] - a[1]), b.maxY]],
  ];
  for (const [inside, cut] of edges) {
    if (!out.length) break;
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cut(prev, cur));
    }
  }
  if (out.length < 3) return [];
  const r = out.map((p) => [Math.round(p[0] * 1e8) / 1e8, Math.round(p[1] * 1e8) / 1e8]);
  r.push([...r[0]]);
  return r;
}

const inBox = (r: Pt[], b: Box) => r.every((p) => p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY);

function trimBody(body: unknown, b: Box): unknown {
  if (!body || typeof body !== "object") return body;
  const feats = (body as { features?: Array<{ geometry?: { rings?: Pt[][] } }> }).features;
  if (!Array.isArray(feats)) return body;
  for (const f of feats) {
    const rings = f.geometry?.rings;
    if (!Array.isArray(rings) || rings.every((r) => inBox(r, b))) continue;
    f.geometry!.rings = rings.map((r) => (inBox(r, b) ? r : clipRing(r, b))).filter((r) => r.length);
  }
  return body;
}

/** Window for a fixture: the CRIM lot under the pin (if any) plus `marginDeg`, always including the pin. */
export function fixtureWindow(fx: SiteFixture, marginDeg = 0.004): Box {
  let minX = fx.longitude, maxX = fx.longitude, minY = fx.latitude, maxY = fx.latitude;
  for (const [url, g] of Object.entries(fx.gets)) {
    if (!url.includes("crim_parcels") || url.includes("distance=") || !url.includes("returnGeometry=true")) continue;
    const rings = (g.body as { features?: Array<{ geometry?: { rings?: Pt[][] } }> })?.features?.[0]?.geometry?.rings ?? [];
    for (const r of rings) for (const p of r) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  }
  return { minX: minX - marginDeg, maxX: maxX + marginDeg, minY: minY - marginDeg, maxY: maxY + marginDeg };
}

/** Returns a trimmed deep copy; responses without polygon rings are untouched. */
export function trimFixture(fx: SiteFixture, marginDeg?: number): SiteFixture {
  const copy = JSON.parse(JSON.stringify(fx)) as SiteFixture;
  const b = fixtureWindow(copy, marginDeg);
  for (const g of Object.values(copy.gets)) if (g.body !== undefined) g.body = trimBody(g.body, b);
  for (const p of copy.posts) p.response = trimBody(p.response, b);
  return copy;
}

/**
 * After trim clips CRIM rings, parcel-polygon GET/POST URLs (geometry / WKT)
 * no longer match what resolveParcelFindings will request on replay. Re-run the
 * pipeline against the trimmed fixture, serving bodies by endpoint fingerprint
 * (path + outFields + returnGeometry, ignoring geometry), and record under the
 * exact URLs the app will ask for.
 */
export async function alignTrimmedUrls(
  fx: SiteFixture,
  run: (net: { fetchImpl: import("../layerService.ts").FetchLike; postJson: import("../parcelService.ts").PostJson; decodePng: (b: ArrayBuffer) => Promise<{ width: number; height: number; channels: number; data: Uint8Array }> }) => Promise<unknown>,
): Promise<SiteFixture> {
  const gets: Record<string, import("./pipeline.ts").RecordedGet> = { ...fx.gets };
  const posts: SiteFixture["posts"] = fx.posts.map((p) => ({ ...p }));

  const fingerprint = (u: string) => {
    const url = new URL(u);
    return [
      url.pathname,
      url.searchParams.get("geometryType") ?? "",
      url.searchParams.get("returnGeometry") ?? "",
      url.searchParams.get("outFields") ?? "",
      url.searchParams.get("geometryPrecision") ?? "",
      url.searchParams.get("maxAllowableOffset") ?? "",
      url.searchParams.has("geometry") && (url.searchParams.get("geometry") ?? "").includes(",") && !(url.searchParams.get("geometry") ?? "").includes("{") ? "point" : url.searchParams.has("geometry") ? "shape" : "none",
    ].join("|");
  };
  const byFp = new Map<string, import("./pipeline.ts").RecordedGet>();
  for (const [u, g] of Object.entries(fx.gets)) byFp.set(fingerprint(u), g);

  const fetchImpl: import("../layerService.ts").FetchLike = async (url) => {
    const hit = gets[url] ?? byFp.get(fingerprint(url));
    if (!hit) return { ok: false, status: 599, json: async () => null };
    gets[url] = hit;
    if (hit.throw) {
      const e = new Error(hit.throw.message);
      e.name = hit.throw.name;
      throw e;
    }
    return {
      ok: hit.ok,
      status: hit.status,
      json: async () => {
        if (hit.badJson) throw new SyntaxError("bad json");
        return hit.body ?? null;
      },
      arrayBuffer: async () => new Uint8Array(hit.rgba ?? [0, 0, 0, 0]).buffer,
    };
  };

  const postJson: import("../parcelService.ts").PostJson = async (url, body) => {
    const query = (body as { query?: string })?.query ?? "";
    let hit = posts.find((p) => p.url === url && p.query === query);
    if (!hit) {
      // Soils parcel SQL embeds WKT of the (now trimmed) ring — match on the
      // SELECT head so the recorded answer stays attached to the new query.
      const head = query.replace(/'POLYGON\([^']*\)'/, "'POLYGON(...)'").replace(/'MULTIPOLYGON\([^']*\)'/, "'MULTIPOLYGON(...)'");
      hit = posts.find((p) => p.url === url && p.query.replace(/'POLYGON\([^']*\)'/, "'POLYGON(...)'").replace(/'MULTIPOLYGON\([^']*\)'/, "'MULTIPOLYGON(...)'") === head);
    }
    if (!hit) {
      posts.push({ url, query, response: "not_recorded" });
      return "not_recorded";
    }
    if (hit.query !== query) posts.push({ url, query, response: hit.response });
    return hit.response;
  };

  const decodePng = async (buf: ArrayBuffer) => {
    const px = new Uint8Array(buf);
    const data = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < data.length; i += 4) data.set(px.subarray(0, 4), i);
    return { width: 256, height: 256, channels: 4, data };
  };

  await run({ fetchImpl, postJson, decodePng });
  return { ...fx, gets, posts };
}
