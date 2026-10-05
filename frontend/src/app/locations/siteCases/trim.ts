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
