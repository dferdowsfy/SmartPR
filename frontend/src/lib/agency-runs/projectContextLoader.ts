/**
 * Best-effort Project Context load for agency runs.
 *
 * Reads the latest workflow snapshot for the business (the same blob the
 * intake Save & Resume writes) and extracts the validated project-context
 * facts. Returns null when there is no snapshot, no context, or the DB/auth
 * is unavailable — the brief simply omits the PROJECT CONTEXT block.
 *
 * The facts are re-validated defensively here: a snapshot is user data, and
 * the brief must never carry a malformed entry to the agent prompt.
 */
import type { ProjectContext } from "../../app/ai/intake/projectContext";
import { validateProjectContext } from "../../app/ai/intake/projectContext";
import type { ProjectIntent } from "../../app/ai/intake/projectIntent";
import { normalizeProjectIntent } from "../../app/ai/intake/projectIntent";

/**
 * Best-effort project-intent load for agency runs. Reads the same snapshot
 * state the intake persists (state.projectIntent) and normalizes it to the
 * canonical snake_case branch. Returns null when there is no snapshot, no
 * intent, or the DB/auth is unavailable — the brief simply omits the
 * PROJECT INTENT line.
 */
export async function loadProjectIntentForBusiness(
  businessId: string,
  userId: string | null
): Promise<ProjectIntent | null> {
  if (!userId) return null;
  try {
    const { getPool, isEnabled } = await import("../../app/graph/db");
    const { ensureSchema, resolveBusinessUuid } = await import("../../app/graph/store");
    if (!isEnabled()) return null;
    const pool = getPool();
    if (!pool) return null;
    await ensureSchema();
    const businessUuid = await resolveBusinessUuid(pool, businessId);
    if (!businessUuid) return null;
    const { rows } = await pool.query(
      `SELECT state FROM workflow_snapshots
        WHERE business_id = $1 AND user_id = $2
        ORDER BY updated_at DESC LIMIT 1`,
      [businessUuid, userId]
    );
    const state = rows[0]?.state;
    if (!state || typeof state !== "object") return null;
    return normalizeProjectIntent((state as Record<string, unknown>).projectIntent);
  } catch {
    return null;
  }
}

export async function loadProjectContextForBusiness(
  businessId: string,
  userId: string | null
): Promise<ProjectContext | null> {
  if (!userId) return null;
  try {
    const { getPool, isEnabled } = await import("../../app/graph/db");
    const { ensureSchema, resolveBusinessUuid } = await import("../../app/graph/store");
    if (!isEnabled()) return null;
    const pool = getPool();
    if (!pool) return null;
    await ensureSchema();
    const businessUuid = await resolveBusinessUuid(pool, businessId);
    if (!businessUuid) return null;
    const { rows } = await pool.query(
      `SELECT state FROM workflow_snapshots
        WHERE business_id = $1 AND user_id = $2
        ORDER BY updated_at DESC LIMIT 1`,
      [businessUuid, userId]
    );
    const state = rows[0]?.state;
    if (!state || typeof state !== "object") return null;
    const raw = (state as Record<string, unknown>).projectContext;
    const { context } = validateProjectContext(raw);
    return Object.keys(context).length > 0 ? context : null;
  } catch {
    // DB optional for local UI demos — never log connection strings / secrets.
    return null;
  }
}
