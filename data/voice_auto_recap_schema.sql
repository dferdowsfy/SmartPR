-- SmartPR voice auto-recap (2026-09-18).
--
-- * voice_access.auto_recap_enabled: per-user toggle for automatic call
--   recaps. Defaults to TRUE — recaps are automatic unless the user opts
--   out in Settings > Phone access.
-- * voice_sessions.recap_sent_at: set when the auto-recap sweep has
--   processed a session (sent or deliberately skipped), so each session is
--   recapped at most once.
--
-- Idempotent: safe to re-run. Apply with psql or the host's SQL runner.
-- Production DDL requires Darius's approval before applying.

BEGIN;

ALTER TABLE voice_access
  ADD COLUMN IF NOT EXISTS auto_recap_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE voice_sessions
  ADD COLUMN IF NOT EXISTS recap_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_voice_sessions_recap_pending
  ON voice_sessions (expires_at)
  WHERE recap_sent_at IS NULL;

COMMIT;
