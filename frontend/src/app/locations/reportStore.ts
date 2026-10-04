// Versioned Property & Site Reports in the Business Passport (server).
// Saving the same report again (same fingerprint as the latest version) is a
// no-op that returns the existing version; a changed report adds a version.

import { randomUUID } from "crypto";
import type { Pool, PoolClient } from "pg";
import { isUuid, type AccessibleBusiness } from "./store";
import { restorePropertyReport, type PropertyReport } from "./propertyReport";
import { applyReviewAction, attachReportVersion, emptyReview, restoreReview, type PropertyReview, type ReviewAction, type ReviewActor } from "./propertyReview";

type Db = Pool | PoolClient;
const MAX_REPORT_BYTES = 400_000;

export interface SavedReportMeta {
  id: string;
  version: number;
  fingerprint: string;
  created_at: string;
}

export async function listSiteReports(db: Db, business: AccessibleBusiness, locationId: string): Promise<SavedReportMeta[] | null> {
  if (!isUuid(locationId)) return null;
  const own = await db.query(`SELECT 1 FROM locations WHERE id=$1 AND business_id=$2`, [locationId, business.id]);
  if (!own.rowCount) return null;
  const { rows } = await db.query<{ id: string; version: number; fingerprint: string; created_at: Date }>(
    `SELECT id, version, fingerprint, created_at FROM location_site_reports WHERE location_id=$1 ORDER BY version DESC LIMIT 50`,
    [locationId]
  );
  return rows.map((r) => ({ id: r.id, version: r.version, fingerprint: r.fingerprint, created_at: new Date(r.created_at).toISOString() }));
}

export async function getSiteReport(db: Db, business: AccessibleBusiness, locationId: string, version: number | null): Promise<(SavedReportMeta & { report: PropertyReport }) | null> {
  if (!isUuid(locationId)) return null;
  const { rows } = await db.query<{ id: string; version: number; fingerprint: string; created_at: Date; report: unknown }>(
    `SELECT r.id, r.version, r.fingerprint, r.created_at, r.report FROM location_site_reports r
       JOIN locations l ON l.id = r.location_id
      WHERE r.location_id=$1 AND l.business_id=$2 ${version ? "AND r.version=$3" : ""}
      ORDER BY r.version DESC LIMIT 1`,
    version ? [locationId, business.id, version] : [locationId, business.id]
  );
  const row = rows[0];
  const report = row ? restorePropertyReport(row.report) : null;
  if (!row || !report) return null;
  return { id: row.id, version: row.version, fingerprint: row.fingerprint, created_at: new Date(row.created_at).toISOString(), report };
}

export type SaveResult = { ok: true; saved: SavedReportMeta; created: boolean } | { ok: false; error: "not_found" | "invalid_report" | "location_mismatch" | "too_large" };

export async function saveSiteReport(pool: Pool, business: AccessibleBusiness, userId: string, locationId: string, raw: unknown): Promise<SaveResult> {
  if (!isUuid(locationId)) return { ok: false, error: "not_found" };
  const report = restorePropertyReport(raw);
  if (!report) return { ok: false, error: "invalid_report" };
  const json = JSON.stringify(report);
  if (json.length > MAX_REPORT_BYTES) return { ok: false, error: "too_large" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const loc = await client.query<{ latitude: number; longitude: number }>(
      `SELECT latitude, longitude FROM locations WHERE id=$1 AND business_id=$2 FOR UPDATE`,
      [locationId, business.id]
    );
    if (!loc.rows[0]) { await client.query("ROLLBACK"); return { ok: false, error: "not_found" }; }
    // A report is only ever filed under the location it describes.
    const l = loc.rows[0];
    if (Math.abs(l.latitude - report.property.latitude) > 1e-6 || Math.abs(l.longitude - report.property.longitude) > 1e-6) {
      await client.query("ROLLBACK");
      return { ok: false, error: "location_mismatch" };
    }
    const latest = await client.query<{ id: string; version: number; fingerprint: string; created_at: Date }>(
      `SELECT id, version, fingerprint, created_at FROM location_site_reports WHERE location_id=$1 ORDER BY version DESC LIMIT 1`,
      [locationId]
    );
    const prev = latest.rows[0];
    if (prev && prev.fingerprint === report.fingerprint) {
      await client.query("COMMIT");
      return { ok: true, created: false, saved: { id: prev.id, version: prev.version, fingerprint: prev.fingerprint, created_at: new Date(prev.created_at).toISOString() } };
    }
    const id = randomUUID();
    const version = (prev?.version ?? 0) + 1;
    const ins = await client.query<{ created_at: Date }>(
      `INSERT INTO location_site_reports (id, location_id, business_id, version, fingerprint, report, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING created_at`,
      [id, locationId, business.id, version, report.fingerprint, json, userId]
    );
    // A changed report re-opens an existing professional review (history kept).
    const rev = await client.query<{ review: unknown }>(`SELECT review FROM location_site_report_reviews WHERE location_id=$1 FOR UPDATE`, [locationId]);
    const existing = rev.rows[0] ? restoreReview(rev.rows[0].review) : null;
    if (existing) {
      const next = attachReportVersion(existing, version, report.fingerprint, { id: userId, name: null }, new Date().toISOString());
      await client.query(`UPDATE location_site_report_reviews SET review=$2::jsonb, updated_by_user_id=$3, updated_at=now() WHERE location_id=$1`, [locationId, JSON.stringify(next), userId]);
    }
    await client.query("COMMIT");
    return { ok: true, created: true, saved: { id, version, fingerprint: report.fingerprint, created_at: new Date(ins.rows[0]!.created_at).toISOString() } };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Professional review (one per location, bound to the latest report version)
// ---------------------------------------------------------------------------


export async function getReview(db: Db, business: AccessibleBusiness, locationId: string): Promise<PropertyReview | null> {
  if (!isUuid(locationId)) return null;
  const { rows } = await db.query<{ review: unknown }>(
    `SELECT r.review FROM location_site_report_reviews r JOIN locations l ON l.id=r.location_id WHERE r.location_id=$1 AND l.business_id=$2`,
    [locationId, business.id]
  );
  return rows[0] ? restoreReview(rows[0].review) : null;
}

/**
 * Apply one review action against the LATEST saved report version (the
 * review re-opens automatically when that version changed).
 */
export async function applyReview(pool: Pool, business: AccessibleBusiness, actor: ReviewActor, locationId: string, action: ReviewAction): Promise<{ ok: true; review: PropertyReview } | { ok: false; error: string }> {
  if (!isUuid(locationId)) return { ok: false, error: "not_found" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const own = await client.query(`SELECT 1 FROM locations WHERE id=$1 AND business_id=$2 FOR UPDATE`, [locationId, business.id]);
    if (!own.rowCount) { await client.query("ROLLBACK"); return { ok: false, error: "not_found" }; }
    const latest = await client.query<{ version: number; fingerprint: string }>(
      `SELECT version, fingerprint FROM location_site_reports WHERE location_id=$1 ORDER BY version DESC LIMIT 1`, [locationId]
    );
    if (!latest.rows[0]) { await client.query("ROLLBACK"); return { ok: false, error: "no_saved_report" }; }
    const cur = await client.query<{ review: unknown }>(`SELECT review FROM location_site_report_reviews WHERE location_id=$1`, [locationId]);
    const now = new Date().toISOString();
    const bound = attachReportVersion(restoreReview(cur.rows[0]?.review) ?? emptyReview(), latest.rows[0].version, latest.rows[0].fingerprint, actor, now);
    const result = applyReviewAction(bound, action, actor, now, () => randomUUID());
    if (!result.ok) { await client.query("ROLLBACK"); return result; }
    await client.query(
      `INSERT INTO location_site_report_reviews (location_id, business_id, review, updated_by_user_id, updated_at)
       VALUES ($1,$2,$3::jsonb,$4, now())
       ON CONFLICT (location_id) DO UPDATE SET review=EXCLUDED.review, updated_by_user_id=EXCLUDED.updated_by_user_id, updated_at=now()`,
      [locationId, business.id, JSON.stringify(result.review), actor.id]
    );
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
