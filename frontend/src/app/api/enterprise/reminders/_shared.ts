// Shared helpers for the enterprise reminders/deadlines/escalation routes.
// Not a route (underscore prefix). Server-side only.
import { getPool } from "../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
  type Permission,
} from "../../../../lib/enterprise-permissions";
import { withTransaction } from "../../../../lib/enterprise-reminders";

export interface Gate {
  user: { id: string; email?: string | null };
  workspaceId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any;
  meta: { ip: string | null; userAgent: string | null; correlationId: string };
}

/**
 * Workspace gate: `?workspace=<uuid>` is required, then the enterprise
 * permission check. Returns `{ response }` on any failure.
 */
export async function enterpriseGate(
  req: Request,
  permission: Permission
): Promise<Gate | { response: Response }> {
  const workspaceId = new URL(req.url).searchParams.get("workspace");
  if (!workspaceId) {
    return { response: Response.json({ error: "workspace query param is required" }, { status: 400 }) };
  }
  const gate = await requireEnterprisePermission(permission, workspaceId);
  if ("response" in gate) return gate;
  const pool = getPool();
  if (!pool) {
    return { response: Response.json({ error: "Database unavailable." }, { status: 503 }) };
  }
  return { user: gate.user, workspaceId, pool, meta: getRequestMeta(req) };
}

/** True when the obligation belongs to the workspace (via businesses). */
export async function obligationInWorkspace(
  pool: { query: (t: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  obligationId: string,
  workspaceId: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM obligations o
      JOIN businesses b ON b.id = o.business_id
     WHERE o.id = $1 AND b.workspace_id = $2 LIMIT 1`,
    [obligationId, workspaceId]
  );
  return rows.length > 0;
}

/**
 * Run a mutating DB fn in a transaction and write the audit event in the
 * SAME transaction. Audit write is best-effort inside the transaction body
 * but the mutation only commits if everything succeeds.
 */
export async function transactWithAudit<T>(
  pool: Gate["pool"],
  gate: Gate,
  action: string,
  targetType: string,
  targetId: string | null,
  before: unknown,
  after: unknown,
  fn: (client: {
    query: (t: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  }) => Promise<T>
): Promise<T> {
  return withTransaction(pool, async (client) => {
    const out = await fn(client);
    await writeAuditEvent(client, {
      actorUserId: gate.user.id,
      workspaceId: gate.workspaceId,
      action,
      targetType,
      targetId,
      before,
      after,
      ip: gate.meta.ip,
      userAgent: gate.meta.userAgent,
      correlationId: gate.meta.correlationId,
      source: "api",
    });
    return out;
  });
}

export function rowId(row: Record<string, unknown>): string | null {
  return typeof row.id === "string" ? row.id : null;
}
