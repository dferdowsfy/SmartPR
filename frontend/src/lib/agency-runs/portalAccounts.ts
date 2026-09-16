/**
 * Portal account memory — LABELS ONLY, never credentials.
 *
 * Records whether a business already has an account on an agency portal, so
 * the pre-flight "Do you already have an account on {portal}?" question is
 * asked once instead of on every run. Nothing secret is ever stored here:
 * only a boolean label per (business, agency).
 *
 * Storage is OPTIONAL (best-effort): without DATABASE_URL every call is a
 * safe no-op returning "unknown", exactly like the graph capture layer.
 */
import { getPool } from "../../app/graph/db";
import { ensureSchema, resolveBusinessUuid } from "../../app/graph/store";
import type { PortalAccountStatus } from "./preflight";

async function canonicalUuid(businessId: string): Promise<string | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    await ensureSchema();
  } catch {
    return null;
  }
  try {
    return await resolveBusinessUuid(pool, businessId);
  } catch {
    return null;
  }
}

/**
 * Read the remembered portal-account status. Returns "unknown" when there is
 * no record or no database — the pre-flight then asks the question.
 */
export async function getPortalAccountStatus(
  businessId: string,
  agencyId: string
): Promise<PortalAccountStatus> {
  const pool = getPool();
  if (!pool) return "unknown";
  const uuid = await canonicalUuid(businessId);
  if (!uuid) return "unknown";
  try {
    const { rows } = await pool.query<{ has_account: boolean }>(
      `SELECT has_account FROM business_portal_accounts WHERE business_id = $1 AND agency_id = $2 LIMIT 1`,
      [uuid, agencyId]
    );
    if (rows.length === 0) return "unknown";
    return rows[0].has_account ? "has_account" : "no_account";
  } catch {
    return "unknown";
  }
}

/**
 * Remember the portal-account label. Called when the human answers the
 * pre-flight account question, and when a run hits a login gate (a login
 * gate proves an account exists).
 */
export async function setPortalAccountStatus(
  businessId: string,
  agencyId: string,
  hasAccount: boolean
): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  const uuid = await canonicalUuid(businessId);
  if (!uuid) return;
  try {
    await pool.query(
      `INSERT INTO business_portal_accounts (business_id, agency_id, has_account, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (business_id, agency_id)
       DO UPDATE SET has_account = EXCLUDED.has_account, updated_at = now()`,
      [uuid, agencyId, hasAccount]
    );
  } catch {
    // Best-effort: the question just gets asked again next time.
  }
}
