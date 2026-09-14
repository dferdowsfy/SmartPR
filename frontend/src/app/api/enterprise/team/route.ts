// GET /api/enterprise/team — workspace members for assignment pickers.
// Returns user_id, email, name, and legacy workspace role. Names/emails come
// from auth.users; server-side only. Permission: view_records.

import { gateEnterprise, withEnterpriseHandler } from "../_util";
import { getPool } from "../../../graph/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getHandler(request: Request) {
  const url = new URL(request.url);
  const gate = await gateEnterprise(
    request,
    "view_records",
    url.searchParams.get("workspace_id")
  );
  if ("response" in gate) return gate.response;
  const { workspaceId } = gate;

  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows } = await pool.query(
    `SELECT wm.user_id::text AS user_id,
            COALESCE(u.raw_user_meta_data ->> 'full_name', u.email) AS name,
            u.email AS email,
            wm.role AS workspace_role
       FROM workspace_members wm
       LEFT JOIN auth.users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1::uuid
      ORDER BY COALESCE(u.raw_user_meta_data ->> 'full_name', u.email) ASC NULLS LAST`,
    [workspaceId]
  );
  return Response.json({ workspace_id: workspaceId, members: rows });
}

export const GET = withEnterpriseHandler("GET /api/enterprise/team", getHandler);
