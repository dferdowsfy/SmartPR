// Shared request plumbing for the Passport location routes: authenticate,
// require the database, bootstrap schema, and resolve a business the caller
// can access. Inaccessible and nonexistent businesses both answer 404.

import type { Pool } from "pg";
import { getPool, isEnabled } from "../graph/db";
import { ensureSchema } from "../graph/store";
import { getCurrentUser } from "../../lib/supabase/server";
import { accessibleBusiness, type AccessibleBusiness } from "./store";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export type ResolvedUser = { pool: Pool; userId: string };

export async function resolveUser(): Promise<ResolvedUser | { error: Response }> {
  const user = await getCurrentUser();
  if (!user) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  const pool = isEnabled() ? getPool() : null;
  if (!pool) return { error: Response.json({ error: "no_database" }, { status: 503 }) };
  await ensureSchema();
  return { pool, userId: user.id };
}

export async function resolveBusinessAccess(
  rawBusinessId: string
): Promise<(ResolvedUser & { business: AccessibleBusiness }) | { error: Response }> {
  const resolved = await resolveUser();
  if ("error" in resolved) return resolved;
  const business = await accessibleBusiness(resolved.pool, rawBusinessId, resolved.userId);
  if (!business) return { error: Response.json({ error: "not_found" }, { status: 404 }) };
  return { ...resolved, business };
}
