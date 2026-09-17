// Phone Access enrollment (web-session authenticated).
// POST /api/voice/settings/enroll { phone, pin }
// Registers (or re-registers) the caller's phone number and 6-digit PIN.
// The PIN is hashed with scrypt before storage — never plaintext.

import { getPool, isEnabled } from "../../../../graph/db";
import { getCurrentUser } from "../../../../../lib/supabase/server";
import { normalizePhone } from "../../../../../lib/voice/phone";
import { hashPin, isValidPinFormat } from "../../../../../lib/voice/pin";
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
  const normalized = normalizePhone(body.phone as string | undefined);
  if (!normalized) {
    return Response.json(
      { error: "invalid_phone", message: "Enter a valid phone number." },
      { status: 400 }
    );
  }
  if (!isValidPinFormat(body.pin as string | undefined)) {
    return Response.json(
      { error: "invalid_pin", message: "The PIN must be exactly 6 digits." },
      { status: 400 }
    );
  }

  // A phone number belongs to exactly one SmartPR user.
  const clash = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM voice_access WHERE phone_e164 = $1 LIMIT 1`,
    [normalized.e164]
  );
  if (clash.rows[0] && clash.rows[0].user_id !== user.id) {
    return Response.json(
      { error: "phone_in_use", message: "That phone number is already registered." },
      { status: 409 }
    );
  }

  const existing = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM voice_access WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );
  const pinHash = await hashPin(body.pin as string);
  await pool.query(
    `INSERT INTO voice_access
       (user_id, phone_e164, phone_display, pin_hash, enabled,
        failed_attempts, locked_until, last_verified_at, email, updated_at)
     VALUES ($1, $2, $3, $4, true, 0, NULL, NULL, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET
       phone_e164 = EXCLUDED.phone_e164,
       phone_display = EXCLUDED.phone_display,
       pin_hash = EXCLUDED.pin_hash,
       enabled = true,
       failed_attempts = 0,
       locked_until = NULL,
       email = EXCLUDED.email,
       updated_at = now()`,
    [user.id, normalized.e164, normalized.display, pinHash, user.email ?? null]
  );

  // A (re-)enrollment invalidates any outstanding voice sessions.
  await pool.query(
    `UPDATE voice_sessions SET revoked_at = now(), revoke_reason = 're_enrollment'
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [user.id]
  );

  await logVoiceAudit(pool, {
    userId: user.id,
    phoneE164: normalized.e164,
    action: existing.rows[0] ? "phone_changed" : "enrollment",
    details: { phone_display: normalized.display },
    ip: clientIp(request),
  });

  return Response.json({
    enrolled: true,
    enabled: true,
    phone_e164: normalized.e164,
    phone_display: normalized.display,
  });
}
