// Cross-instance request-slot reservation for rate-limited geocoding
// providers, backed by one Postgres row per limiter. Every server instance
// atomically claims the next free slot (spaced `intervalMs` apart), so the
// application as a whole never exceeds the provider's limit no matter how
// many instances run. Times come from the database clock, so instance clock
// skew does not matter. Table: geocoding_throttle (locations/schema.ts).

import type { Pool } from "pg";
import type { SlotReserver } from "./index.ts";

export function pgSlotReserver(pool: Pool, limiterId: string, intervalMs: number): SlotReserver {
  return async () => {
    const { rows } = await pool.query<{ wait_ms: number }>(
      `INSERT INTO geocoding_throttle (id, next_slot)
       VALUES ($1, clock_timestamp() + $2 * interval '1 millisecond')
       ON CONFLICT (id) DO UPDATE
         SET next_slot = GREATEST(geocoding_throttle.next_slot, clock_timestamp()) + $2 * interval '1 millisecond'
       RETURNING (extract(epoch FROM (next_slot - clock_timestamp())) * 1000 - $2)::float8 AS wait_ms`,
      [limiterId, intervalMs]
    );
    const wait = rows[0]?.wait_ms;
    return typeof wait === "number" ? Math.max(0, wait) : null;
  };
}
