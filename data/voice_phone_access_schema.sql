-- SmartPR Phase 1 voice phone access: enrollment, PIN auth, sessions, audit, usage.
-- Applied manually (psql) or via the hosting provider's SQL runner.
-- Tables are idempotent (IF NOT EXISTS) so re-running is safe.
--
-- Design notes:
-- * voice_access holds ONE phone row per SmartPR user. Phone numbers are
--   stored normalized to E.164 (see src/lib/voice/phone.ts).
-- * PINs are NEVER stored in plaintext. pin_hash is a scrypt envelope
--   (see src/lib/voice/pin.ts): scrypt$N$r$p$saltB64$hashB64.
-- * Voice sessions are opaque bearer tokens. Only the SHA-256 hash of the
--   token is stored (token_hash); the raw token is shown to the trusted
--   voice gateway exactly once at issuance.
-- * The voice gateway (Grok/xAI integration host) authenticates to the
--   lookup / verify-pin / session endpoints with a shared secret
--   (VOICE_GATEWAY_API_KEY). That secret is never stored in the database.
-- * Every voice API request must follow: session token -> validate session
--   -> derive user -> derive workspace membership -> verify resource access
--   -> check plan entitlement where applicable -> perform operation ->
--   audit -> return safe result. See src/lib/voice/context.ts.

BEGIN;

-- ---------------------------------------------------------------------------
-- voice_access: phone enrollment + PIN credential per SmartPR user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_access (
  user_id UUID PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  phone_display TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_uid TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_access_phone ON voice_access(phone_e164);
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_access_pin_uid ON voice_access(pin_uid);

-- ---------------------------------------------------------------------------
-- voice_sessions: authenticated voice sessions (30m sliding idle, 120m absolute from issued_at).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  phone_e164 TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_token ON voice_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_user ON voice_sessions(user_id);

-- ---------------------------------------------------------------------------
-- voice_audit_log: append-only audit trail for all voice operations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  phone_e164 TEXT,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_audit_user ON voice_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_audit_action ON voice_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_voice_audit_created ON voice_audit_log(created_at DESC);

-- ---------------------------------------------------------------------------
-- voice_usage: per-user, per-day usage counters for the voice channel.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_usage (
  user_id UUID NOT NULL,
  day DATE NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  emails_sent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

COMMIT;
