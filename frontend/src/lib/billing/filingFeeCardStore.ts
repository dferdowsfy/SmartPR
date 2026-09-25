/**
 * Persistence for the filing-fee card reminder (businesses.payment_settings).
 *
 * Kept in its own column rather than passport_json: full passport saves
 * normalize and replace passport_json, and the agency-run task prompt embeds
 * passport_json — neither should touch payment settings. Access mirrors the
 * passport: the business owner or a member of its workspace.
 */
import type { Pool } from "pg";
import { readFilingFeeCard, type FilingFeeCard } from "./filingFeeCard";

/** Business UUID the user may read/write, or null (no row / no access). */
export async function accessibleBusinessUuid(
  pool: Pool,
  businessId: string,
  userId: string
): Promise<string | null> {
  const { resolveBusinessUuid } = await import("../../app/graph/store");
  const uuid = await resolveBusinessUuid(pool, businessId);
  if (!uuid) return null;
  const { rows } = await pool.query(
    `SELECT b.id FROM businesses b
       LEFT JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$2
      WHERE b.id=$1 AND b.archived=false AND (b.user_id=$2 OR wm.user_id IS NOT NULL)`,
    [uuid, userId]
  );
  return (rows[0]?.id as string | undefined) ?? null;
}

export async function loadFilingFeeCard(pool: Pool, businessUuid: string): Promise<FilingFeeCard | null> {
  const { rows } = await pool.query(`SELECT payment_settings FROM businesses WHERE id=$1`, [businessUuid]);
  return readFilingFeeCard(rows[0]?.payment_settings);
}

export async function saveFilingFeeCard(pool: Pool, businessUuid: string, card: FilingFeeCard): Promise<void> {
  await pool.query(
    `UPDATE businesses
        SET payment_settings = jsonb_set(COALESCE(payment_settings, '{}'::jsonb), '{filingFeeCard}', $2::jsonb, true)
      WHERE id=$1`,
    [businessUuid, JSON.stringify(card)]
  );
}

export async function clearFilingFeeCard(pool: Pool, businessUuid: string): Promise<void> {
  await pool.query(
    `UPDATE businesses SET payment_settings = COALESCE(payment_settings, '{}'::jsonb) - 'filingFeeCard' WHERE id=$1`,
    [businessUuid]
  );
}
