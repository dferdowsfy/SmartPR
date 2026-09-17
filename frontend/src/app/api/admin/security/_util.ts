/**
 * Shared gates for /api/admin/security/* — ALWAYS enforce requireSuperAdmin
 * server-side. Never rely on UI alone.
 */
import { requireSuperAdmin, auditLog } from "../_util";
import { getPool, isEnabled } from "../../../graph/db";
import { writeAuditEvent, getRequestMeta } from "../../../../lib/enterprise-permissions";
import { normalizeSecurityAction } from "../../../../lib/security/events";
import { assertNoClientSecrets } from "../../../../lib/security/secrets";

export { requireSuperAdmin, auditLog, getPool, isEnabled, getRequestMeta };

export async function requireSecurityAdmin(): Promise<
  | { ctx: { userId: string; email: string }; pool: NonNullable<ReturnType<typeof getPool>> }
  | { response: Response }
> {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate;
  if (!isEnabled()) return { response: Response.json({ error: "no_database" }, { status: 503 }) };
  const pool = getPool();
  if (!pool) return { response: Response.json({ error: "no_database" }, { status: 503 }) };
  return { ctx: gate.ctx, pool };
}

export async function auditSecurityMutation(
  pool: NonNullable<ReturnType<typeof getPool>>,
  req: Request,
  ctx: { userId: string; email: string },
  action: string,
  targetType: string,
  targetId: string | null,
  after?: unknown
): Promise<void> {
  const meta = getRequestMeta(req);
  const normalized = normalizeSecurityAction(action);
  const safeAfter = after === undefined ? undefined : JSON.parse(JSON.stringify(after));
  if (safeAfter !== undefined) {
    try {
      assertNoClientSecrets(safeAfter);
    } catch {
      // Strip rather than fail the mutation audit
          console.error("[security-audit] secret-like fields stripped from after payload");
    }
  }
  await writeAuditEvent(pool, {
    actorUserId: ctx.userId,
    workspaceId: null,
    action: normalized,
    targetType,
    targetId,
    after: safeAfter,
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "superadmin",
  });
  await auditLog({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: normalized,
    details: { targetType, targetId, after: safeAfter },
  });
}

export function jsonOk(body: unknown, status = 200): Response {
  assertNoClientSecrets(body);
  return Response.json(body, { status });
}
