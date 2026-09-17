// Trusted gateway: session validation.
// POST /api/voice/session/validate { session_token }
// Lets the voice gateway check a session's health without consuming it.
// user_id is derived server-side and returned for the gateway's own logging;
// the agent must never accept a user id from the caller.

import { getPool, isEnabled } from "../../../../graph/db";
import { hashSessionToken, isGatewayAuthorized } from "../../../../../lib/voice/session";
import { readJson } from "../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isGatewayAuthorized(request.headers.get("authorization"))) {
    return Response.json({ error: "gateway_unauthorized" }, { status: 401 });
  }
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const body = await readJson(request);
  const token = body.session_token as string | undefined;
  if (!token) return Response.json({ valid: false, error: "missing_token" }, { status: 400 });

  const { rows } = await pool.query<{
    user_id: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `SELECT user_id, expires_at, revoked_at
       FROM voice_sessions WHERE token_hash = $1 LIMIT 1`,
    [hashSessionToken(token)]
  );
  const session = rows[0];
  if (!session) return Response.json({ valid: false });
  if (session.revoked_at) return Response.json({ valid: false, revoked: true });
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    return Response.json({ valid: false, expired: true });
  }
  return Response.json({
    valid: true,
    user_id: session.user_id,
    expires_at: session.expires_at,
  });
}
