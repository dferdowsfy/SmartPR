// Trusted gateway: PIN verification -> voice session issuance.
// POST /api/voice/phone/verify-pin { phone, pin }
// Requires the VOICE_GATEWAY_API_KEY bearer secret (server-to-server auth).
//
// On success returns a short-lived opaque session token (shown once).
// Brute-force protection: 5 failed attempts locks the phone for 15 minutes.

import { getPool, isEnabled } from "../../../../graph/db";
import { normalizePhone } from "../../../../../lib/voice/phone";
import {
  MAX_PIN_ATTEMPTS,
  LOCKOUT_MINUTES,
  isValidPinFormat,
  lockoutSecondsRemaining,
  verifyPin,
} from "../../../../../lib/voice/pin";
import {
  generateSessionToken,
  hashSessionToken,
  isGatewayAuthorized,
  sessionExpiresAt,
} from "../../../../../lib/voice/session";
import { logVoiceAudit } from "../../../../../lib/voice/audit";
import { incrementVoiceUsage } from "../../../../../lib/voice/usage";
import { clientIp, readJson } from "../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AccessRow {
  user_id: string;
  phone_e164: string;
  pin_hash: string;
  enabled: boolean;
  failed_attempts: number;
  locked_until: string | null;
}

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
  // Enforce PIN shape before any DB work so malformed input fails fast
  // without touching the attempt counter.
  if (!isValidPinFormat(body.pin as string | undefined)) {
    return Response.json({ error: "invalid_pin", attempts_remaining: null }, { status: 401 });
  }

  const { rows } = await pool.query<AccessRow>(
    `SELECT user_id, phone_e164, pin_hash, enabled, failed_attempts, locked_until
       FROM voice_access WHERE phone_e164 = $1 LIMIT 1`,
    [normalized.e164]
  );
  const access = rows[0];
  // Do not distinguish "unknown phone" from "disabled" to the caller.
  if (!access || !access.enabled) {
    await logVoiceAudit(pool, {
      phoneE164: normalized.e164,
      action: "pin_failed",
      details: { reason: "not_enrolled_or_disabled" },
      ip: clientIp(request),
    });
    return Response.json({ error: "not_enrolled" }, { status: 404 });
  }

  const retryAfter = lockoutSecondsRemaining(access.locked_until);
  if (retryAfter > 0) {
    await logVoiceAudit(pool, {
      userId: access.user_id,
      phoneE164: access.phone_e164,
      action: "pin_locked",
      details: { retry_after_seconds: retryAfter },
      ip: clientIp(request),
    });
    return Response.json(
      { error: "locked", retry_after_seconds: retryAfter },
      { status: 423 }
    );
  }

  const ok = await verifyPin(body.pin as string, access.pin_hash);
  if (!ok) {
    // Atomic increment: concurrent wrong PINs cannot lose updates or
    // bypass the lockout threshold.
    const updated = await pool.query<{
      failed_attempts: number;
      locked_until: string | null;
    }>(
      `UPDATE voice_access
          SET failed_attempts = failed_attempts + 1,
              locked_until = CASE
                WHEN failed_attempts + 1 >= $2
                THEN now() + ($3 || ' minutes')::interval
                ELSE locked_until END,
              updated_at = now()
        WHERE user_id = $1
        RETURNING failed_attempts, locked_until`,
      [access.user_id, MAX_PIN_ATTEMPTS, String(LOCKOUT_MINUTES)]
    );
    const failedAttempts = updated.rows[0]?.failed_attempts ?? MAX_PIN_ATTEMPTS;
    const nowLocked = failedAttempts >= MAX_PIN_ATTEMPTS;
    const attemptsRemaining = nowLocked ? 0 : MAX_PIN_ATTEMPTS - failedAttempts;
    await logVoiceAudit(pool, {
      userId: access.user_id,
      phoneE164: access.phone_e164,
      action: nowLocked ? "pin_locked" : "pin_failed",
      details: { attempts_remaining: attemptsRemaining },
      ip: clientIp(request),
    });
    if (nowLocked) {
      return Response.json(
        { error: "locked", retry_after_seconds: LOCKOUT_MINUTES * 60 },
        { status: 423 }
      );
    }
    return Response.json({ error: "invalid_pin", attempts_remaining: attemptsRemaining }, { status: 401 });
  }

  // Success: reset the counter, issue a short-lived session, revoke any
  // other outstanding sessions for this user.
  const token = generateSessionToken();
  const expiresAt = sessionExpiresAt();
  await pool.query(
    `UPDATE voice_access
        SET failed_attempts = 0, locked_until = NULL,
            last_verified_at = now(), updated_at = now()
      WHERE user_id = $1`,
    [access.user_id]
  );
  await pool.query(
    `UPDATE voice_sessions SET revoked_at = now(), revoke_reason = 'superseded'
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [access.user_id]
  );
  const issued = await pool.query<{ id: string }>(
    `INSERT INTO voice_sessions (token_hash, user_id, phone_e164, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [hashSessionToken(token), access.user_id, access.phone_e164, expiresAt.toISOString()]
  );
  await logVoiceAudit(pool, {
    userId: access.user_id,
    phoneE164: access.phone_e164,
    action: "session_issued",
    details: { session_id: issued.rows[0]?.id },
    ip: clientIp(request),
  });
  await incrementVoiceUsage(pool, access.user_id, "calls", 1);

  return Response.json({
    session_token: token,
    token_type: "bearer",
    expires_at: expiresAt.toISOString(),
  });
}
