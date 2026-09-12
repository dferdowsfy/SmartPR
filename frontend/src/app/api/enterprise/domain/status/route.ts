// GET /api/enterprise/domain/status — verification state for a workspace.
//
// Query: ?workspace_id=…
// Returns the domain_verifications row (status machine, TLS status, last
// attempt, error details) plus the TXT record the caller must publish.
// The dns_token is included so the UI can display it to the workspace admin
// who requested it; it is never written to logs.
//
// Gate: platform super admin OR `configure_branding_security` permission.

import { getPool, isEnabled } from "../../../../../app/graph/db";
import { requireBrandingSecurity } from "../../../../../lib/enterprise-gate";
import { challengeHostname } from "../../../../../lib/enterprise-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id") || "";
  const gate = await requireBrandingSecurity(workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows } = await pool.query(
    `SELECT domain, status, tls_status, last_attempt_at, last_error, created_at, updated_at
       FROM domain_verifications WHERE workspace_id = $1`,
    [workspaceId]
  );
  const row = rows[0] as
    | {
        domain: string;
        status: string;
        tls_status: string;
        last_attempt_at: string | null;
        last_error: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return Response.json({ verification: null });

  const token = await pool.query(
    `SELECT dns_token FROM domain_verifications WHERE workspace_id = $1`,
    [workspaceId]
  );
  const dnsToken = (token.rows[0] as { dns_token: string | null } | undefined)?.dns_token ?? null;

  return Response.json({
    verification: {
      ...row,
      txt_host: challengeHostname(row.domain),
      txt_value: dnsToken,
    },
  });
}
