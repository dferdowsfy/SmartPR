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
 * Full admin check: ADMIN_EMAILS env var OR the admin_allowlist table.
 * The open default (everyone is admin) applies only while no admin is
 * configured in either source.
 */
export async function isUserAdmin(
  email: string | null | undefined
): Promise<boolean> {
  if (!email) return false;
  if (adminSet().size > 0) return adminSet().has(email.toLowerCase());
  // No env allowlist: the table decides. A single query answers both
  // "is this email allowlisted" and "is anyone allowlisted" (open default).
  try {
    const pool = getPool();
    if (!pool) return true; // no DB: preserve the open default
    const { rows } = await pool.query<{ hit: string; total: string }>(
      `SELECT COUNT(*) FILTER (WHERE lower(email) = lower($1))::text AS hit,
              COUNT(*)::text AS total
         FROM admin_allowlist`,
      [email]
    );
    const hit = Number(rows[0]?.hit || 0) > 0;
    const total = Number(rows[0]?.total || 0);
    if (hit) return true;
    return total === 0; // open default: nobody configured yet
  } catch {
    return true; // table missing / DB error: preserve the open default
  }
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return isUserAdmin(user?.email);
}
