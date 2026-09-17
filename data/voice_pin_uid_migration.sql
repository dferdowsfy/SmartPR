-- PIN-as-identifier migration: the 6-digit voice PIN becomes the account
-- selector for voice verification (no email is ever requested on a call).
--
-- pin_uid = HMAC-SHA256(VOICE_PIN_PEPPER, pin), computed application-side
-- (see src/lib/voice/pin.ts pinIdentifier). Deterministic so a spoken PIN
-- resolves its account with one indexed lookup; the pepper keeps it
-- non-reversible (DB read access alone reveals no PIN).
--
-- The UNIQUE index enforces one PIN per account: application code rejects
-- already-used PINs at enroll/change time with a friendly 409, and this
-- index is the backstop.
--
-- Existing rows keep pin_uid NULL (their PINs cannot be recovered from the
-- scrypt hashes) and must re-set their PIN once via voice settings; until
-- then PIN-only verification does not match them. NULLs are not considered
-- equal by the unique index, so legacy rows never collide.
BEGIN;

ALTER TABLE voice_access
  ADD COLUMN IF NOT EXISTS pin_uid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_access_pin_uid
  ON voice_access(pin_uid);

COMMIT;
