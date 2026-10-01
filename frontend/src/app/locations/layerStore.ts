// Database-backed second level for the site-layer cache (site_layer_cache).
// Optional by design: with no database (guest intake, local dev) or when the
// database misbehaves, resolveSiteLayers simply runs on its in-memory cache.
// Everything here is best-effort and bounded by a short timeout so a slow
// database can never slow the pin down.

import type { Pool } from "pg";
import { getPool } from "../graph/db";
import { ensureSchema } from "../graph/store";
import type { SiteLayerResult } from "./layers.ts";
import type { LayerStore } from "./layerService.ts";

const DB_TIMEOUT_MS = 1500;
const BACKOFF_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("db_timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

let disabledUntil = 0;

/** The shared store, or null when no database is configured (or it failed recently). */
export function getLayerStore(): LayerStore | null {
  const pool = getPool();
  if (!pool || Date.now() < disabledUntil) return null;
  return createPgLayerStore(pool, ensureSchema, () => {
    disabledUntil = Date.now() + BACKOFF_MS;
  });
}

/** Store over a pool; `ensure` runs before every call (idempotent), `onFailure` lets the caller back off. */
export function createPgLayerStore(pool: Pool, ensure: () => Promise<void>, onFailure: () => void = () => {}): LayerStore {
  const guard = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await withTimeout(
        (async () => {
          await ensure();
          return fn();
        })(),
        DB_TIMEOUT_MS
      );
    } catch {
      onFailure();
      return fallback;
    }
  };
  return {
    load: (keys) =>
      guard(async () => {
        const { rows } = await pool.query<{ cache_key: string; result: SiteLayerResult; fetched_at: Date }>(
          `SELECT cache_key, result, fetched_at FROM site_layer_cache WHERE cache_key = ANY($1::text[])`,
          [keys]
        );
        return rows.map((r) => ({ key: r.cache_key, at: new Date(r.fetched_at).getTime(), result: r.result }));
      }, []),
    save: (entries) =>
      guard(async () => {
        if (!entries.length) return;
        await pool.query(
          `INSERT INTO site_layer_cache (cache_key, layer, latitude, longitude, result, fetched_at)
           SELECT k, l, la, lo, r::jsonb, to_timestamp(a / 1000.0)
           FROM unnest($1::text[], $2::text[], $3::float8[], $4::float8[], $5::text[], $6::float8[]) AS t(k, l, la, lo, r, a)
           ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, fetched_at = EXCLUDED.fetched_at`,
          [
            entries.map((e) => e.key),
            entries.map((e) => e.result.layer),
            entries.map((e) => e.latitude),
            entries.map((e) => e.longitude),
            entries.map((e) => JSON.stringify(e.result)),
            entries.map((e) => e.at),
          ]
        );
        // Rows older than the 30-day stale window can never be served: prune now and then.
        if (Math.random() < 0.02) await pool.query(`DELETE FROM site_layer_cache WHERE fetched_at < now() - interval '30 days'`);
      }, undefined),
  };
}
