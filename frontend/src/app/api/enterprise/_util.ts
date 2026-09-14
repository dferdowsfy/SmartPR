// Shared helpers for /api/enterprise/* routes. Server-side only.
//
// Every mutation route wraps its DB writes and audit_events insert in a
// single transaction on a dedicated pg client (BEGIN/COMMIT/ROLLBACK).
// Audit writes are mandatory inside that transaction — writeAuditEvent is
// best-effort standalone, but here it runs on the same client so it commits
// or rolls back with the mutation.

import { getPool } from "../../../app/graph/db";
import type { Pool, PoolClient } from "pg";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
  type Permission,
} from "../../../lib/enterprise-permissions";
import { isUuid } from "../../../lib/enterprise-work";

export { getPool };

export type GateSuccess = {
  user: { id: string; email?: string | null };
  workspaceId: string;
};

/**
 * Gate helper: resolves the workspace (explicit query/body param or the
 * user's first membership), then requires the permission. Returns a
 * `{ response }` 401/403 on failure, or `{ user, workspaceId }` on success.
 */
export async function gateEnterprise(
  request: Request,
  permission: Permission,
  explicitWorkspaceId?: string | null
): Promise<GateSuccess | { response: Response }> {
  let workspaceId: string | null = null;
  if (explicitWorkspaceId && isUuid(explicitWorkspaceId)) {
    workspaceId = explicitWorkspaceId;
  }
  if (!workspaceId) {
    const { getCurrentUser } = await import("../../../lib/supabase/server");
    const user = await getCurrentUser();
    if (!user) return { response: Response.json({ error: "unauthorized" }, { status: 401 }) };
    const pool = getPool();
    if (!pool) return { response: Response.json({ error: "no_database" }, { status: 503 }) };
    const { rows } = await pool.query<{ workspace_id: string }>(
      `SELECT workspace_id::text AS workspace_id FROM workspace_members
        WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [user.id]
    );
    if (!rows[0]?.workspace_id) {
      return { response: Response.json({ error: "no_workspace" }, { status: 403 }) };
    }
    workspaceId = rows[0].workspace_id;
  }
  const gate = await requireEnterprisePermission(permission, workspaceId);
  if ("response" in gate) return gate;
  return gate;
}

/** Run fn inside BEGIN/COMMIT on a dedicated client; ROLLBACK + rethrow. */
export async function withEnterpriseTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool();
  if (!pool) throw Object.assign(new Error("no_database"), { status: 503 });
  const client = await (pool as Pool).connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export function auditSource(): "ui" | "api" {
  return "api";
}

export function metaOf(request: Request) {
  return getRequestMeta(request);
}

export async function writeEnterpriseAudit(
  client: PoolClient,
  request: Request,
  input: {
    actorUserId?: string | null;
    workspaceId?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  }
): Promise<void> {
  const meta = metaOf(request);
  await writeAuditEvent(client as unknown as Parameters<typeof writeAuditEvent>[0], {
    actorUserId: input.actorUserId,
    workspaceId: input.workspaceId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    before: input.before,
    after: input.after,
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: auditSource(),
    reason: input.reason,
  });
}

export function badRequest(message: string, detail?: unknown) {
  return Response.json({ error: "bad_request", message, detail }, { status: 400 });
}

export function notFound(message = "not_found") {
  return Response.json({ error: message }, { status: 404 });
}

export function forbidden(message = "forbidden") {
  return Response.json({ error: message }, { status: 403 });
}

/** Parse a JSON body safely; returns null when the body is not valid JSON. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * withEnterpriseHandler — every enterprise route handler must be wrapped in
 * this. It guarantees the route ALWAYS returns valid JSON: any unexpected
 * throw becomes a 500 JSON error envelope (never an empty body, which is
 * what surfaces on the client as the raw
 * "Failed to execute 'json' on 'Response': Unexpected end of JSON input"
 * error). Successful responses (including CSV/file downloads) pass through
 * untouched. Missing-table errors (Postgres 42P01) get a legible message
 * naming the table instead of a generic 500.
 *
 * Usage:
 *   async function getHandler(request: Request) { ... }
 *   export const GET = withEnterpriseHandler("GET /api/enterprise/audit", getHandler);
 */
export function withEnterpriseHandler(
  tag: string,
  handler: (request: Request, ctx?: any) => Promise<Response>
): (request: Request, ctx?: any) => Promise<Response> {
  return async (request: Request, ctx?: any) => {
    try {
      return await handler(request, ctx);
    } catch (err) {
      console.error(`[${tag}] unhandled error:`, err);
      const msg = err instanceof Error ? err.message : String(err ?? "");
      const missing = /relation "([^"]+)" does not exist/.exec(msg);
      if (missing) {
        return Response.json(
          {
            error: "missing_table",
            table: missing[1],
            message: `Required data table "${missing[1]}" is not set up yet. Some enterprise features are unavailable — please contact support.`,
          },
          { status: 500 }
        );
      }
      return Response.json(
        { error: "internal_error", message: "Something went wrong. Please retry." },
        { status: 500 }
      );
    }
  };
}
