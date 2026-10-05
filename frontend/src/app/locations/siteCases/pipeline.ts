// ============================================================================
// One pipeline for a sample case, with the network injected:
//   capture (scripts/geo-capture.mts)  live fetch, every answer recorded
//   replay  (tests)                    recorded answers only, no network
//   drift   (scripts/geo-drift.mts)    live fetch, compared with the record
// Runs exactly the server code the app uses: resolveSiteLayers (pin layers),
// resolveParcelFindings (whole-parcel findings) and findNearbyLots (snap).
// ============================================================================

import { findNearbyLots, LayerCache, resetEndpointHealth, resolveSiteLayers, type DecodedImage, type FetchLike, type SnapResult } from "../layerService.ts";
import { resolveParcelFindings, type PostJson } from "../parcelService.ts";
import { locateInPuertoRico } from "../boundaries.ts";
import { webMercatorTilePixel, LANDSLIDE_TILE_ZOOM, LAYER_SOURCES, type SiteLayers } from "../layers.ts";
import type { ParcelFindings } from "../parcel.ts";

/** One recorded GET: a JSON body, the landslide pixel at the pin, or a transport failure. */
export interface RecordedGet {
  ok: boolean;
  status: number;
  body?: unknown;
  /** Landslide tile: RGBA of the pixel under the pin (the tile itself is not stored). */
  rgba?: number[];
  throw?: { name: string; message: string };
  /** The body was not JSON (replayed as a parse failure). */
  badJson?: boolean;
}

export interface SiteFixture {
  id: string;
  captured_at: string;
  latitude: number;
  longitude: number;
  /** Reverse geocode the app showed for the pin (provider-derived, not an official source). */
  address: { formatted_address: string | null; municipality: string | null; provider: string | null } | null;
  gets: Record<string, RecordedGet>;
  posts: Array<{ url: string; query: string; response: unknown }>;
}

export interface PipelineResult {
  layers: SiteLayers;
  parcel: ParcelFindings;
  snap: SnapResult | null;
}

export const isLandslideTile = (url: string) => url.startsWith(`${LAYER_SOURCES.usgs_landslide.url}/tile/`);

/** Replay: answers from the fixture only. Unrecorded URLs are collected (and fail like a dead host). */
export function replayNetwork(fx: SiteFixture) {
  const missing: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    const rec = fx.gets[url];
    if (!rec) {
      missing.push(url);
      return { ok: false, status: 599, json: async () => null };
    }
    if (rec.throw) {
      const e = new Error(rec.throw.message);
      e.name = rec.throw.name;
      throw e;
    }
    return {
      ok: rec.ok,
      status: rec.status,
      json: async () => {
        if (rec.badJson) throw new SyntaxError("Unexpected token in JSON");
        return rec.body ?? null;
      },
      arrayBuffer: async () => new Uint8Array(rec.rgba ?? [0, 0, 0, 0]).buffer,
    };
  };
  const postJson: PostJson = async (url, body) => {
    const q = (body as { query?: string })?.query ?? "";
    const hit = fx.posts.find((p) => p.url === url && p.query === q);
    if (!hit) {
      missing.push(`POST ${url} ${q.slice(0, 80)}`);
      return "not_recorded";
    }
    return hit.response;
  };
  /** The replayed "tile" is the recorded pixel: paint a whole tile with it. */
  const decodePng = async (buf: ArrayBuffer): Promise<DecodedImage> => {
    const px = new Uint8Array(buf);
    const data = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < data.length; i += 4) data.set(px.subarray(0, 4), i);
    return { width: 256, height: 256, channels: 4, data };
  };
  return { fetchImpl, postJson, decodePng, missing };
}

export function landslidePixelIndex(latitude: number, longitude: number) {
  return webMercatorTilePixel({ latitude, longitude }, LANDSLIDE_TILE_ZOOM);
}

export async function runSitePipeline(
  point: { latitude: number; longitude: number },
  net: { fetchImpl: FetchLike; postJson: PostJson; decodePng: (b: ArrayBuffer) => Promise<DecodedImage> },
  opts: { now: Date; retryDelayMs?: number; withSnap?: boolean }
): Promise<PipelineResult> {
  // Isolate each case: no shared cache, no circuit state from another case.
  resetEndpointHealth();
  const now = () => opts.now;
  const layers = await resolveSiteLayers(point.latitude, point.longitude, {
    fetchImpl: net.fetchImpl,
    decodePng: net.decodePng,
    cache: new LayerCache(),
    refresh: true,
    now,
    retryDelayMs: opts.retryDelayMs ?? 0,
    isOnLand: (p) => locateInPuertoRico(p.latitude, p.longitude) !== null,
  });
  resetEndpointHealth();
  const parcel = await resolveParcelFindings(point.latitude, point.longitude, { fetchImpl: net.fetchImpl, postJson: net.postJson, now, refresh: true, neighbors: false });
  const snap = opts.withSnap ? await findNearbyLots(point.latitude, point.longitude, { fetchImpl: net.fetchImpl }) : null;
  return { layers, parcel, snap };
}
