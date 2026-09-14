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

-- Monthly digest idempotency: one digest per workspace per YYYY-MM period.
-- The cron inserts ON CONFLICT DO NOTHING so a retry never double-sends.
CREATE TABLE IF NOT EXISTS compliance_digest_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  period TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, period)
);
CREATE INDEX IF NOT EXISTS idx_compliance_digest_log_workspace ON compliance_digest_log (workspace_id);

-- Regulatory developments pipeline (spec section 10a): the monthly
-- regulatory scan records findings here; the digest surfaces a finding to a
-- business ONLY when it matches that business's profile/obligations with an
-- explainable basis. review_status='verified' is the gate: only verified
-- findings (checked against a primary government source) reach the digest.
CREATE TABLE IF NOT EXISTS regulatory_developments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  published_date DATE,
  effective_date DATE,
  affected_requirement_codes TEXT[] NOT NULL DEFAULT '{}',
  -- Targeting: AND across specified groups, OR within a group (same pattern
  -- as the enterprise regulatory-events targeting).
  agency_names TEXT[] NOT NULL DEFAULT '{}',
  municipalities TEXT[] NOT NULL DEFAULT '{}',
  business_types TEXT[] NOT NULL DEFAULT '{}',
  industries TEXT[] NOT NULL DEFAULT '{}',
  requirement_names TEXT[] NOT NULL DEFAULT '{}',
  applicability_notes TEXT,
  recommended_action TEXT,
  confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
  review_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed','verified','superseded')),
  recorded_by TEXT NOT NULL DEFAULT 'scan',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_regulatory_developments_review
  ON regulatory_developments (review_status, published_date DESC);

-- Log of the monthly regulatory-scan research passes (the scan itself is a
-- scheduled research pass; this table records that it happened).
CREATE TABLE IF NOT EXISTS regulatory_scan_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  sources_checked TEXT[] NOT NULL DEFAULT '{}',
  developments_found INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

-- A development is shown to a workspace at most once, so monthly digests
-- never repeat the same finding.
CREATE TABLE IF NOT EXISTS regulatory_development_shows (
  development_id UUID NOT NULL REFERENCES regulatory_developments(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  period TEXT NOT NULL,
  shown_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (development_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_regdev_shows_workspace ON regulatory_development_shows (workspace_id);

COMMIT;
