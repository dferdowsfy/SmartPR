// Superadmin support access: POST grants time-boxed, reason-bound support
// access to a workspace. Reason and duration are REQUIRED; scope defaults to
// read_only. Every grant is written to audit_events (source='superadmin') and
// the legacy admin_audit_log. A httpOnly cookie (sp_support_ws) is set so the
// banner can show the active grant on all /admin pages.
//
// Allowed durations: 15m, 1h, 4h, 24h.
import { randomUUID } from "crypto";
import { getPool, isEnabled } from "../../../../../graph/db";
import { requireSuperAdmin, auditLog } from "../../../_util";
import {
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const SUPPORT_COOKIE = "sp_support_ws";

const ALLOWED_DURATIONS_MIN: Record<string, number> = {
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "24h": 1440,
};

function workspaceIdFrom(request: Request): string | null {
  const m = request.url.match(/\/workspaces\/([^/]+)\/support-access/);
  return m ? decodeURIComponent(m[1]) : null;
}

type GrantBody = {
  reason?: string;
  duration?: string;
  scope?: string;
  granted_to_email?: string;
};

export async function POST(request: Request) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  const workspaceId = workspaceIdFrom(request);
  if (!workspaceId) return Response.json({ error: "workspace_id required" }, { status: 400 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const ctx = gate.ctx;
  const meta = getRequestMeta(request);

  const body = (await request.json().catch(() => ({}))) as GrantBody;
  const reason = (body.reason || "").trim();
  if (!reason) {
    return Response.json({ error: "reason is required for support access" }, { status: 400 });
  }
  if (reason.length > 500) {
    return Response.json({ error: "reason must be 500 characters or fewer" }, { status: 400 });
  }
  const durationKey = (body.duration || "").trim();
  const minutes = ALLOWED_DURATIONS_MIN[durationKey];
  if (!minutes) {
    return Response.json(
      { error: "duration is required", allowed: Object.keys(ALLOWED_DURATIONS_MIN) },
      { status: 400 }
    );
  }
  const scope = (body.scope || "read_only").trim().toLowerCase();
  if (!["read_only", "read_write"].includes(scope)) {
    return Response.json({ error: "scope must be read_only or read_write" }, { status: 400 });
  }
  const grantedToEmail = (body.granted_to_email || ctx.email).trim().toLowerCase();
  if (!grantedToEmail.includes("@")) {
    return Response.json({ error: "valid granted_to_email required" }, { status: 400 });
  }

  const ws = await pool.query(`SELECT name FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  const grantId = randomUUID();
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
  await pool.query(
    `INSERT INTO support_access_grants
       (id, workspace_id, granted_by, granted_to_email, reason, expires_at, scope)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [grantId, workspaceId, ctx.userId, grantedToEmail, reason, expiresAt, scope]
  );

  await writeAuditEvent(pool, {
    actorUserId: ctx.userId,
    workspaceId,
    action: "support_access.granted",
    targetType: "support_access_grant",
    targetId: grantId,
    after: { granted_to_email: grantedToEmail, reason, scope, expires_at: expiresAt },
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
    action: "support_access.granted",
    details: { grant_id: grantId, reason, scope, expires_at: expiresAt },
  });

  const cookieValue = encodeURIComponent(
    JSON.stringify({ grant_id: grantId, workspace_id: workspaceId })
  );
  const secure = process.env.NODE_ENV === "production";
  const res = Response.json({
    ok: true,
    grant: {
      id: grantId,
      workspace_id: workspaceId,
      workspace_name: ws.rows[0].name,
      granted_to_email: grantedToEmail,
      reason,
      scope,
      expires_at: expiresAt,
    },
  });
  res.headers.append(
    "Set-Cookie",
    `${SUPPORT_COOKIE}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${minutes * 60}${secure ? "; Secure" : ""}`
  );
  return res;
}
