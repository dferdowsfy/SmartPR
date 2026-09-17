// Private (non-route) helpers for /api/voice routes.
// Files/folders prefixed with "_" are ignored by the Next.js router.

import { getCurrentUser } from "../../../lib/supabase/server";
import { getPool, isEnabled } from "../../graph/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}

export function requireDb() {
  if (!isEnabled()) return null;
  return getPool();
}

/** Web-session authenticated user (for the Phone Access settings UI). */
export async function requireWebUser() {
  const user = await getCurrentUser();
  return user;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}
