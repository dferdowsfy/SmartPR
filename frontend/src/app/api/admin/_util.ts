import { getCurrentUser } from "../../../lib/supabase/server";
import { isSuperAdmin } from "../../../lib/admin";
import { getPool } from "../../graph/db";

export interface AdminContext {
  userId: string;
  email: string;
}

/**
 * Super-admin gate for management APIs. Only platform super admins
 * (the SmartPR team) may manage companies, teams, branding, and plans.
 * A workspace-level ADMIN ("regular admin") does NOT pass this gate.
 */
export async function requireSuperAdmin(): Promise<
  { ctx: AdminContext } | { response: Response }
> {
  const user = await getCurrentUser();
  if (!user?.email || !(await isSuperAdmin(user.email))) {
    return { response: Response.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ctx: { userId: user.id, email: user.email } };
}

export async function auditLog(entry: {
  actorUserId: string | null;
  actorEmail: string;
  workspaceId?: string | null;
  action: string;
  targetEmail?: string | null;
  targetUserId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const pool = getPool();
    if (!pool) return;
    await pool.query(
      `INSERT INTO admin_audit_log
         (actor_user_id, actor_email, workspace_id, action, target_email, target_user_id, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        entry.actorUserId,
        entry.actorEmail,
        entry.workspaceId ?? null,
        entry.action,
        entry.targetEmail ?? null,
        entry.targetUserId ?? null,
        JSON.stringify(entry.details ?? {}),
      ]
    );
  } catch (e) {
    console.error("[admin-audit] failed:", (e as Error).message);
  }
}
