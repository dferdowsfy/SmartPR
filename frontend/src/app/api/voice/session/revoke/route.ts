// Trusted gateway: session revocation.
// POST /api/voice/session/revoke { session_token, reason? }
// Called when the call ends (or the caller asks to sign out of voice).
// Idempotent: revoking an unknown or already-revoked token still returns ok.

import { getPool, isEnabled } from "../../../../graph/db";
import { hashSessionToken, isGatewayAuthorized } from "../../../../../lib/voice/session";
import { logVoiceAudit } from "../../../../../lib/voice/audit";
import { clientIp, readJson } from "../../_util";

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
  if (!token) return Response.json({ error: "missing_token" }, { status: 400 });
  const reason =
    typeof body.reason === "string" && body.reason.length <= 64 ? body.reason : "call_ended";

  const { rows } = await pool.query<{ id: string; user_id: string; phone_e164: string }>(
    `UPDATE voice_sessions
        SET revoked_at = now(), revoke_reason = $2
      WHERE token_hash = $1 AND revoked_at IS NULL
      RETURNING id, user_id, phone_e164`,
    [hashSessionToken(token), reason]
  );
  const revoked = rows[0];
  if (revoked) {
    await logVoiceAudit(pool, {
      userId: revoked.user_id,
      phoneE164: revoked.phone_e164,
      action: "session_revoked",
      details: { session_id: revoked.id, reason },
      ip: clientIp(request),
    });
  }
  return Response.json({ revoked: true });
}
