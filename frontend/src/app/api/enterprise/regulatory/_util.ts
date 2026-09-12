// ============================================================================
// Shared helpers for the Phase 5 regulatory change impact APIs.
// Not a route itself (no HTTP exports).
// ============================================================================

import type { PoolClient } from "pg";
import { getPool, isEnabled } from "../../../graph/db";
import {
  requireEnterprisePermission,
  sanitizeForAudit,
  getRequestMeta,
  type Permission,
} from "../../../../lib/enterprise-permissions";

/** Read a JSON body safely; returns {} on parse failure. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Resolve the workspace id for a request. Query param `?workspace=` wins,
 * then `?workspace_id=` (used by the portfolio page), then
 * `body.workspace_id`. Returns null when none is a UUID.
 */
export function resolveWorkspaceId(
  req: Request,
  body?: Record<string, unknown>
): string | null {
  const url = new URL(req.url);
  const fromQuery =
    (url.searchParams.get("workspace") ?? "").trim() ||
    (url.searchParams.get("workspace_id") ?? "").trim();
  const fromBody =
    typeof body?.workspace_id === "string" ? body.workspace_id.trim() : "";
  const ws = fromQuery || fromBody;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ws)
    ? ws
    : null;
}

export type GateSuccess = {
  user: { id: string; email?: string | null };
  workspaceId: string;
};

/**
 * Permission gate + request metadata for audit events.
 * Returns { gate } on success or { response } (401/403) on failure.
 */
export async function gateRequest(
  req: Request,
  permission: Permission,
  workspaceId: string
): Promise<{ gate: GateSuccess; meta: ReturnType<typeof getRequestMeta> } | { response: Response }> {
  const gate = await requireEnterprisePermission(permission, workspaceId);
  if ("response" in gate) return { response: gate.response };
  return { gate, meta: getRequestMeta(req) };
}

export function noDatabase() {
  return Response.json({ error: "no_database" }, { status: 503 });
}

/** Strict UUID check (8-4-4-4-12 hex). Rejects the permissive 36-char pattern. */
export function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export function ensureDatabase() {
  if (!isEnabled()) return false;
  return getPool() !== null;
}

/** Run fn inside a single Postgres transaction (audit writes join the tx). */
export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error("no_database");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // rollback failure: nothing more to do
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Tenant scope predicate for regulatory_events: the workspace's own events plus global (workspace_id NULL) ones. */
export const EVENT_TENANT_SCOPE = `(re.workspace_id = $1 OR re.workspace_id IS NULL)`;

export interface AuditParams {
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> };
  meta: ReturnType<typeof getRequestMeta>;
  userId: string;
  workspaceId: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/**
 * Strict audit write that participates in the caller's transaction.
 * Unlike writeAuditEvent (which logs-and-continues), this lets insert
 * failures propagate so withTx rolls the whole regulatory mutation back:
 * a mutation that cannot be audited must not commit.
 */
export async function auditInTx(p: AuditParams): Promise<void> {
  await p.client.query(
    `INSERT INTO audit_events
       (actor_user_id, workspace_id, action, target_type, target_id,
        "before", "after", ip, user_agent, correlation_id, source, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      p.userId ?? null,
      p.workspaceId ?? null,
      p.action,
      p.targetType ?? null,
      p.targetId ?? null,
      JSON.stringify(sanitizeForAudit(p.before ?? null)),
      JSON.stringify(sanitizeForAudit(p.after ?? null)),
      p.meta.ip ?? null,
      p.meta.userAgent ?? null,
      p.meta.correlationId ?? null,
      "api",
      p.reason ?? null,
    ]
  );
}
