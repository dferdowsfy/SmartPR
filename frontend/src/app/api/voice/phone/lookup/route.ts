// Trusted gateway: caller phone lookup.
// POST /api/voice/phone/lookup { phone }
// Requires the VOICE_GATEWAY_API_KEY bearer secret (server-to-server auth).
// Returns whether the inbound caller-id has SmartPR phone access enabled,
// so the voice agent knows whether to prompt for a PIN.

import { getPool, isEnabled } from "../../../../graph/db";
import { normalizePhone } from "../../../../../lib/voice/phone";
import { isGatewayAuthorized } from "../../../../../lib/voice/session";
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
  const normalized = normalizePhone(body.phone as string | undefined);
  if (!normalized) return Response.json({ error: "invalid_phone" }, { status: 400 });

  const { rows } = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM voice_access WHERE phone_e164 = $1 LIMIT 1`,
    [normalized.e164]
  );
  const row = rows[0];
  const result = { enrolled: Boolean(row), enabled: row?.enabled ?? false, phone_e164: normalized.e164 };

  await logVoiceAudit(pool, {
    phoneE164: normalized.e164,
    action: "lookup",
    details: result,
    ip: clientIp(request),
  });
  return Response.json(result);
}
