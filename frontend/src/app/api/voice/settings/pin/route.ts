// PIN change / reset (web-session authenticated).
// POST /api/voice/settings/pin { current_pin?, new_pin }
//
// * Change: provide current_pin + new_pin; the current PIN is verified first.
// * Reset:  omit current_pin. Allowed because the caller is authenticated via
//           their SmartPR web login, which is the stronger recovery factor.
//           A forgotten phone PIN never needs the old PIN.

import { getPool, isEnabled } from "../../../../graph/db";
import { getCurrentUser } from "../../../../../lib/supabase/server";
import { hashPin, isValidPinFormat, verifyPin } from "../../../../../lib/voice/pin";
import { logVoiceAudit } from "../../../../../lib/voice/audit";
import { clientIp, readJson } from "../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const body = await readJson(request);
  const newPin = body.new_pin as string | undefined;
  if (!isValidPinFormat(newPin)) {
    return Response.json(
      { error: "invalid_pin", message: "The new PIN must be exactly 6 digits." },
      { status: 400 }
    );
  }

  const { rows } = await pool.query<{ pin_hash: string; phone_e164: string }>(
    `SELECT pin_hash, phone_e164 FROM voice_access WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );
  const row = rows[0];
  if (!row) {
    return Response.json(
      { error: "not_enrolled", message: "Phone access is not enrolled yet." },
      { status: 404 }
    );
  }

  const currentPin = body.current_pin as string | undefined;
  let action: "pin_changed" | "pin_reset";
  if (typeof currentPin === "string" && currentPin.length > 0) {
    const ok = await verifyPin(currentPin, row.pin_hash);
    if (!ok) {
      await logVoiceAudit(pool, {
        userId: user.id,
        phoneE164: row.phone_e164,
        action: "pin_failed",
        details: { context: "pin_change" },
        ip: clientIp(request),
      });
      return Response.json(
        { error: "invalid_pin", message: "The current PIN is incorrect." },
        { status: 401 }
      );
    }
    action = "pin_changed";
  } else {
    // Reset via the authenticated web session (recovery factor).
    action = "pin_reset";
  }

  const pinHash = await hashPin(newPin as string);
  await pool.query(
    `UPDATE voice_access
        SET pin_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE user_id = $1`,
    [user.id, pinHash]
  );
  // A PIN change/reset invalidates outstanding voice sessions.
  await pool.query(
    `UPDATE voice_sessions SET revoked_at = now(), revoke_reason = 'pin_changed'
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [user.id]
  );

  await logVoiceAudit(pool, {
    userId: user.id,
    phoneE164: row.phone_e164,
    action,
    ip: clientIp(request),
  });

  return Response.json({ ok: true, action });
}
