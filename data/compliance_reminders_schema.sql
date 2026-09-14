-- SmartPR compliance-reminder notification preferences.
--
-- Honors the founder's opt-out requirements (2026-09-14): global email
-- opt-out, per-business mute, and per-requirement (obligation) mute. The
-- daily reminder cron must exclude muted scopes before sending.
--
-- Apply via the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  -- Scope of the mute. 'global' ignores business_id/obligation_id;
  -- 'business' mutes one business; 'obligation' mutes one requirement.
  scope TEXT NOT NULL CHECK (scope IN ('global', 'business', 'obligation')),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  obligation_id UUID REFERENCES obligations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL')),
  muted BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL-safe uniqueness: plain UNIQUE treats NULLs as distinct, so a single
  -- constraint would allow duplicate global/business mutes. One partial
  -- unique index per scope instead.
  CONSTRAINT notification_preferences_scope_check CHECK (
    (scope = 'global' AND business_id IS NULL AND obligation_id IS NULL) OR
    (scope = 'business' AND business_id IS NOT NULL AND obligation_id IS NULL) OR
    (scope = 'obligation' AND obligation_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_global
  ON notification_preferences(user_id, channel) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_business
  ON notification_preferences(user_id, business_id, channel) WHERE scope = 'business';
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_obligation
  ON notification_preferences(user_id, obligation_id, channel) WHERE scope = 'obligation';
-- Drop the old NULL-unsafe constraint if a previous migration created it.
ALTER TABLE notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_user_id_scope_business_id_obligation_id_channel_key;
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user
  ON notification_preferences(user_id);

-- The reminder cron sends PENDING email notifications whose scheduled_for
-- has passed. This index keeps that sweep cheap.
CREATE INDEX IF NOT EXISTS idx_notifications_cron_sweep
  ON notifications(status, channel, scheduled_for)
  WHERE status = 'PENDING';

COMMIT;
