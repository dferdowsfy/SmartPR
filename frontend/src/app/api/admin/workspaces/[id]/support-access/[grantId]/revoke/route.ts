// Revoke a support-access grant: POST
// /api/admin/workspaces/[id]/support-access/[grantId]/revoke
// Sets revoked_at; clears the sp_support_ws cookie when it refers to this
// grant. Audited (source='superadmin').
import { getPool, isEnabled } from "../../../../../../../graph/db";
import { requireSuperAdmin, auditLog } from "../../../../../_util";
import {
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../../../../lib/enterprise-permissions";
import { SUPPORT_COOKIE } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; grantId: string }> }
) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const ctx = gate.ctx;
  const meta = getRequestMeta(request);
  const { id: workspaceId, grantId } = await params;

  const cur = await pool.query(
    `SELECT id::text AS id, granted_to_email, reason, scope, expires_at, revoked_at
       FROM support_access_grants
      WHERE id = $1 AND workspace_id = $2`,
    [grantId, workspaceId]
  );
  if (!cur.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });
  if (cur.rows[0].revoked_at) return Response.json({ ok: true, already_revoked: true });

  await pool.query(`UPDATE support_access_grants SET revoked_at = now() WHERE id = $1`, [grantId]);

  const reason = String(cur.rows[0].reason ?? "");
  await writeAuditEvent(pool, {
    actorUserId: ctx.userId,
    workspaceId,
    action: "support_access.revoked",
    targetType: "support_access_grant",
    targetId: grantId,
    before: { granted_to_email: cur.rows[0].granted_to_email, scope: cur.rows[0].scope },
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "superadmin",
    reason,
  });
  await auditLog({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    workspaceId,
    action: "support_access.revoked",
    details: { grant_id: grantId },
  });

  // Clear the banner cookie when it points at this grant.
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`${SUPPORT_COOKIE}=([^;]+)`));
  let clearCookie = false;
  if (match) {
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1]));
      clearCookie = parsed?.grant_id === grantId;
    } catch {
      clearCookie = false;
    }
  }

  const res = Response.json({ ok: true });
  if (clearCookie) {
    res.headers.append(
      "Set-Cookie",
      `${SUPPORT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
  }
  return res;
}
