// Superadmin feature flags for a workspace: GET (list), PUT (set value).
// Every change writes feature_flag_history AND audit_events (source='superadmin')
// plus the legacy admin_audit_log.
import { getPool, isEnabled } from "../../../../../graph/db";
import { requireSuperAdmin, auditLog } from "../../../_util";
import {
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function workspaceIdFrom(request: Request): string | null {
  const m = request.url.match(/\/workspaces\/([^/]+)\/feature-flags/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function GET(request: Request) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  const workspaceId = workspaceIdFrom(request);
  if (!workspaceId) return Response.json({ error: "workspace_id required" }, { status: 400 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows } = await pool.query(
    `SELECT key, value, source, updated_by::text AS updated_by,
            lower(u.email) AS updated_by_email, updated_at, created_at
       FROM feature_flags f
       LEFT JOIN auth.users u ON u.id = f.updated_by
      WHERE f.workspace_id = $1
      ORDER BY key ASC`,
    [workspaceId]
  );
  return Response.json({ flags: rows });
}

type PutBody = { key?: string; value?: unknown; source?: string };

export async function PUT(request: Request) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  const workspaceId = workspaceIdFrom(request);
  if (!workspaceId) return Response.json({ error: "workspace_id required" }, { status: 400 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const ctx = gate.ctx;
  const meta = getRequestMeta(request);

  const body = (await request.json().catch(() => ({}))) as PutBody;
  const key = (body.key || "").trim();
  if (!key || key.length > 120 || !/^[a-z0-9_.-]+$/i.test(key)) {
    return Response.json({ error: "valid key required (letters, numbers, _ . -)" }, { status: 400 });
  }
  if (body.value === undefined) {
    return Response.json({ error: "value required" }, { status: 400 });
  }
  const source = (body.source || "superadmin").trim().slice(0, 40) || "superadmin";

  const ws = await pool.query(`SELECT 1 FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  const before = await pool.query(
    `SELECT value FROM feature_flags WHERE workspace_id = $1 AND key = $2`,
    [workspaceId, key]
  );
  const oldValue = before.rows[0]?.value ?? null;

  await pool.query(
    `INSERT INTO feature_flags (workspace_id, key, value, source, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (workspace_id, key)
     DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source,
                   updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [workspaceId, key, body.value, source, ctx.userId]
  );

  // History row (the table's own audit trail).
  try {
    await pool.query(
      `INSERT INTO feature_flag_history (workspace_id, key, old_value, new_value, changed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [workspaceId, key, oldValue, body.value, ctx.userId]
    );
  } catch (e) {
    console.error("[feature-flags] history write failed:", (e as Error).message);
  }

  await writeAuditEvent(pool, {
    actorUserId: ctx.userId,
    workspaceId,
    action: "feature_flag.updated",
    targetType: "feature_flag",
    targetId: key,
    before: { value: oldValue },
    after: { value: body.value, source },
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "superadmin",
  });
  await auditLog({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    workspaceId,
    action: "feature_flag.updated",
    details: { key, source },
  });

  return Response.json({ ok: true, key, value: body.value });
}
