// ============================================================================
// Admin allowlist gate.
//
// Admins are granted from two sources (either one grants access):
//   1. The ADMIN_EMAILS env var (comma-separated, case-insensitive).
//   2. The `admin_allowlist` table in Postgres — manageable directly from the
//      Supabase dashboard: INSERT INTO admin_allowlist (email) VALUES ('…').
//
// OPEN DEFAULT: if neither source names any admin (env empty AND the table
// is empty/missing), ANY signed-in user is treated as an admin so the tools
// stay reachable out of the box. As soon as at least one admin is
// configured anywhere, the default closes and only allowlisted emails pass.
// ============================================================================

import { getCurrentUser } from "./supabase/server";
import { getPool } from "../app/graph/db";

function adminSet(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Synchronous env-var check only (kept for compatibility). */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const set = adminSet();
  if (set.size === 0) return true; // open default: no allowlist configured
  return set.has(email.toLowerCase());
}

/**
 * Full admin check: ADMIN_EMAILS env var OR membership in the "admin" group
 * of the admin_allowlist table. The open default (everyone is admin) applies
 * only while no admin is configured in either source.
 */
export async function isUserAdmin(
  email: string | null | undefined
): Promise<boolean> {
  return userInGroup(email, "admin");
}

/**
 * Permission-group check. A user is in `group` when:
 *   - the ADMIN_EMAILS env var allowlist is non-empty and names their email
 *     (env grants the "admin" group only), or
 *   - their admin_allowlist row's `groups` array contains the group
 *     (case-insensitive).
 *
 * The open default (everyone passes) applies only while zero admins are
 * configured anywhere: empty env allowlist AND an empty/missing table.
 * Once any admin exists, only explicitly granted users pass.
 */
export async function userInGroup(
  email: string | null | undefined,
  group: string
): Promise<boolean> {
  if (!email) return false;
  const want = group.trim().toLowerCase();
  if (adminSet().size > 0) {
    // Env allowlist configured: it defines the "admin" group; other groups
    // still consult the table below.
    if (want === "admin" && adminSet().has(email.toLowerCase())) return true;
  }
  try {
    const pool = getPool();
    if (!pool) return adminSet().size === 0; // no DB: preserve open default
    const mine = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM admin_allowlist
        WHERE lower(email) = lower($1)
          AND EXISTS (SELECT 1 FROM unnest(groups) AS g WHERE lower(trim(g)) = lower($2))`,
      [email, want]
    );
    if (Number(mine.rows[0]?.n || 0) > 0) return true;
    // Not granted: the open default holds only while zero admins are
    // configured anywhere.
    const total = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM admin_allowlist`
    );
    return Number(total.rows[0]?.n || 0) === 0 && adminSet().size === 0;
  } catch {
    return adminSet().size === 0; // table missing / DB error: open default
  }
}

/** All permission groups granted to an email (empty when none). */
export async function getUserGroups(
  email: string | null | undefined
): Promise<string[]> {
  if (!email) return [];
  const groups = new Set<string>();
  if (adminSet().has(email.toLowerCase())) groups.add("admin");
  try {
    const pool = getPool();
    if (!pool) return [...groups];
    const { rows } = await pool.query<{ g: string }>(
      `SELECT DISTINCT lower(trim(g)) AS g FROM admin_allowlist,
              LATERAL unnest(groups) AS g
        WHERE lower(email) = lower($1)`,
      [email]
    );
    for (const r of rows) if (r.g) groups.add(r.g);
  } catch {
    // Table missing: fall through with env-derived groups.
  }
  return [...groups];
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return isUserAdmin(user?.email);
}
