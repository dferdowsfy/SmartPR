// Basemap tile proxy for the ChatGPT widget map — GET /api/tiles/{z}/{x}/{y}.png[?s=sat]
//
// ChatGPT renders the widget in a sandbox whose CSP only lets images load
// from origins the widget resource declares (openai/widgetCSP
// resource_domains / _meta.ui.csp.resourceDomains). Serving tiles from
// SmartPR's own origin means one first-party origin is declared for the map,
// and the upstream provider can change (or carry a server-side key) without
// touching the widget or its CSP.
//
// Upstream (raster, XYZ): Esri World Street Map / World Imagery by default —
// the same Esri basemap service the portal map already uses for imagery —
// overridable with CHATGPT_TILE_URL_STREETS / CHATGPT_TILE_URL_SATELLITE
// ({z}/{x}/{y} templates, e.g. a keyed MapTiler raster URL; keys stay
// server-side). Attribution is shown on the widget map.
//
// Guard rails: Puerto Rico tiles only (z 7–19, tile must touch PR's
// envelope), per-IP rate limit, short upstream timeout, small in-memory LRU,
// long browser/CDN cache. Not an open tile proxy.
// The `.png` suffix keeps tile requests out of the auth middleware matcher.

import { rateLimitAllow } from "../../../../../../lib/rateLimit";
import { tileAllowed, upstreamUrl } from "../../../../../../lib/chatgpt/tiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_MAX = 1500;
const cache = new Map<string, { body: ArrayBuffer; type: string; at: number }>();
const CACHE_TTL_MS = 24 * 3600_000;

const headersFor = (type: string, hit: string) => ({
  "Content-Type": type,
  "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Tile-Cache": hit,
});

export async function GET(request: Request, ctx: { params: Promise<{ z: string; x: string; y: string }> }) {
  const p = await ctx.params;
  const z = Number(p.z), x = Number(p.x), y = Number(String(p.y).replace(/\.(png|jpg|jpeg)$/i, ""));
  if (!tileAllowed(z, x, y)) return new Response("tile outside Puerto Rico", { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
  if (!rateLimitAllow(`tiles:${ip}`, Number(process.env.CHATGPT_TILE_RATE_PER_MIN || 1200), 60_000)) return new Response("rate limited", { status: 429 });
  const style = new URL(request.url).searchParams.get("s") === "sat" ? "satellite" : "streets";
  const key = `${style}/${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    cache.delete(key); cache.set(key, hit); // LRU touch
    return new Response(hit.body, { status: 200, headers: headersFor(hit.type, "hit") });
  }
  try {
    const up = await fetch(upstreamUrl(style, z, x, y), {
      headers: { "User-Agent": "SmartPR/1.0 (+https://www.getsmartpr.com)", Accept: "image/png,image/jpeg,image/*" },
      signal: AbortSignal.timeout(6000),
    });
    const type = up.headers.get("content-type") || "";
    if (!up.ok || !/^image\//.test(type)) return new Response("upstream tile unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
    const body = await up.arrayBuffer();
    if (body.byteLength > 0 && body.byteLength < 600_000) {
      cache.set(key, { body, type, at: Date.now() });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    }
    return new Response(body, { status: 200, headers: headersFor(type, "miss") });
  } catch {
    return new Response("upstream tile timeout", { status: 504, headers: { "Cache-Control": "no-store" } });
  }
}
