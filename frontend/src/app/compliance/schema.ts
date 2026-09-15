// Backward-compatible extension of graph/store.ts's existing execution schema.
// The same SQL is also checked in at data/compliance_workspace_schema.sql for
// explicit Supabase migration/review. Runtime bootstrap remains idempotent.
export const COMPLIANCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'INDIVIDUAL' CHECK (kind IN ('INDIVIDUAL','PROFESSIONAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces (owner_user_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER','ADMIN','MEMBER','VIEWER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members (user_id);

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS entity_number TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_structure TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_type TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS municipality TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS physical_address TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS onboarding_mode TEXT NOT NULL DEFAULT 'NEW' CHECK (onboarding_mode IN ('NEW','EXISTING'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
-- Short public id for clean URLs (/businesses/k7d2mq9x instead of a UUID).
-- Backfilled in code (ensureSchema) so every id is unique.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS public_id TEXT;
-- Business Passport: enter-once canonical facts that stamp every applicable form.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS passport_json JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_public_id ON businesses (public_id);
UPDATE businesses SET legal_name = name WHERE legal_name IS NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_workspace ON businesses (workspace_id);
CREATE INDEX IF NOT EXISTS idx_businesses_municipality ON businesses (municipality);

CREATE TABLE IF NOT EXISTS matters (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id),
  user_id UUID NOT NULL,
  submission_id UUID,
  matter_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_PROGRESS','NEEDS_ATTENTION','READY','COMPLETED','ARCHIVED')),
  readiness_score NUMERIC(5,2),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date DATE,
  due_date_source TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (due_date_source IN ('REGULATORY_RULE','DOCUMENT_EXTRACTED','USER_PROVIDED','EXTERNALLY_VERIFIED','UNKNOWN')),
  due_date_confidence NUMERIC(5,4),
  source_reference TEXT,
  verified_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_matters_business ON matters (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matters_workspace_status ON matters (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_matters_due ON matters (due_date) WHERE completed_at IS NULL;

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS matter_id UUID;
CREATE INDEX IF NOT EXISTS idx_submissions_matter ON submissions (matter_id);
ALTER TABLE workflow_snapshots ADD COLUMN IF NOT EXISTS matter_id UUID;

CREATE TABLE IF NOT EXISTS obligations (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  matter_id UUID REFERENCES matters(id) ON DELETE SET NULL,
  requirement_id TEXT,
  graph_entity_id TEXT,
  name TEXT NOT NULL,
  agency TEXT,
  status TEXT NOT NULL DEFAULT 'MISSING' CHECK (status IN ('CURRENT','UPCOMING','DUE_SOON','IN_PROGRESS','NEEDS_ATTENTION','MISSING','OVERDUE','COMPLETED','UNKNOWN')),
  due_date DATE,
  due_date_source TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (due_date_source IN ('REGULATORY_RULE','DOCUMENT_EXTRACTED','USER_PROVIDED','EXTERNALLY_VERIFIED','UNKNOWN')),
  due_date_confidence NUMERIC(5,4),
  source TEXT NOT NULL DEFAULT 'REGULATORY_GRAPH',
  source_reference TEXT,
  verified_at TIMESTAMPTZ,
  renewal_frequency_months INTEGER CHECK (renewal_frequency_months IS NULL OR renewal_frequency_months > 0),
  renewal_reference TEXT,
  mandatory BOOLEAN NOT NULL DEFAULT true,
  next_action TEXT,
  cycle_index INTEGER NOT NULL DEFAULT 1 CHECK (cycle_index > 0),
  previous_obligation_id UUID REFERENCES obligations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (matter_id, requirement_id, cycle_index)
);
CREATE INDEX IF NOT EXISTS idx_obligations_business_status ON obligations (business_id, status);
-- Tracks when the user opened the requirement's official download/filing
-- destination in a new tab. Powers the "downloaded, now upload" return nudge.
ALTER TABLE obligations ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_obligations_due ON obligations (due_date) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_obligations_requirement ON obligations (requirement_id);

CREATE TABLE IF NOT EXISTS evidence (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  matter_id UUID REFERENCES matters(id) ON DELETE SET NULL,
  obligation_id UUID REFERENCES obligations(id) ON DELETE SET NULL,
  validation_id BIGINT,
  original_filename TEXT NOT NULL,
  storage_path TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  document_type TEXT,
  review_status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (review_status IN ('UPLOADED','PROCESSING','VERIFIED','NEEDS_REVIEW','REJECTED')),
  extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  extraction_confidence NUMERIC(5,4),
  issue_date DATE,
  expiration_date DATE,
  date_source TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (date_source IN ('REGULATORY_RULE','DOCUMENT_EXTRACTED','USER_PROVIDED','EXTERNALLY_VERIFIED','UNKNOWN')),
  source_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_evidence_business ON evidence (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_obligation ON evidence (obligation_id);

-- Evidence locker: reusable business-scoped files tagged with DOC_/requirement codes.
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS requirement_tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_evidence_requirement_tags ON evidence USING GIN (requirement_tags);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  source TEXT NOT NULL DEFAULT 'landing_start_assessment',
  language TEXT,
  utm JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_id UUID,
  status TEXT NOT NULL DEFAULT 'CAPTURED' CHECK (status IN ('CAPTURED','CONVERTED')),
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email ON leads (lower(email));
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  workspace_id UUID REFERENCES workspaces(id),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  obligation_id UUID REFERENCES obligations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP','EMAIL','SMS')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DELIVERED','READ','DISMISSED','CANCELLED')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  UNIQUE (obligation_id, type, scheduled_for)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_schedule ON notifications (user_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_pending ON notifications (user_id, status, scheduled_for);
-- Sweep index for the daily compliance-reminder cron: due PENDING emails.
CREATE INDEX IF NOT EXISTS idx_notifications_cron_sweep ON notifications (status, channel, scheduled_for) WHERE status = 'PENDING';

-- Compliance-reminder opt-outs: global email mute, per-business mute, and
-- per-requirement (obligation) mute. The reminder cron honors all three.
-- Mirrored in data/compliance_reminders_schema.sql for explicit migration.
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'business', 'obligation')),
  business_id UUID REFERENCES businesses (id) ON DELETE CASCADE,
  obligation_id UUID REFERENCES obligations (id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL')),
  muted BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_scope_check CHECK (
    (scope = 'global' AND business_id IS NULL AND obligation_id IS NULL) OR
    (scope = 'business' AND business_id IS NOT NULL AND obligation_id IS NULL) OR
    (scope = 'obligation' AND obligation_id IS NOT NULL) OR
    (scope = 'digest' AND business_id IS NULL AND obligation_id IS NULL)
  )
);
-- NULL-safe uniqueness: plain UNIQUE treats NULLs as distinct, so a single
-- constraint would allow duplicate global/business mutes. One partial unique
-- index per scope instead.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_global
  ON notification_preferences (user_id, channel) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_business
  ON notification_preferences (user_id, business_id, channel) WHERE scope = 'business';
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_obligation
  ON notification_preferences (user_id, obligation_id, channel) WHERE scope = 'obligation';
ALTER TABLE notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_user_id_scope_business_id_obligation_id_channel_key;
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences (user_id);

-- Monthly digest opt-out (scope='digest'): independent of the transactional
-- reminder toggles; the global EMAIL mute covers both. Applied to existing
-- deployments via ALTER (the CREATE TABLE above is IF NOT EXISTS).
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_scope_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_scope_check CHECK (
  (scope = 'global' AND business_id IS NULL AND obligation_id IS NULL) OR
  (scope = 'business' AND business_id IS NOT NULL AND obligation_id IS NULL) OR
  (scope = 'obligation' AND obligation_id IS NOT NULL) OR
  (scope = 'digest' AND business_id IS NULL AND obligation_id IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_digest
  ON notification_preferences (user_id, channel) WHERE scope = 'digest';

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

-- Founder-manageable compliance email templates: the *wrapper* (subject +
-- HTML + text) for each compliance email, editable from /admin/emails or the
-- Supabase Table Editor. Code renders the dynamic section blocks and
-- substitutes them into the {{placeholders}} — templates carry no logic.
-- Seed rows are INSERT ... ON CONFLICT DO NOTHING so an admin's edits are
-- never overwritten by a later deploy or cron run. A missing row or a
-- failed load never drops a send: the cron falls back to the built-in
-- wrapper and still sends.
CREATE TABLE IF NOT EXISTS email_templates (
  key TEXT NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('en', 'es')),
  subject TEXT NOT NULL,
  html_template TEXT NOT NULL,
  text_template TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  PRIMARY KEY (key, lang)
);

-- Archive of every compliance email actually sent: the full rendered body,
-- which template rendered it, and which template version (updated_at) was
-- used. Written only on successful sends; archiving never throws.
CREATE TABLE IF NOT EXISTS email_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL,
  lang TEXT NOT NULL,
  template_source TEXT NOT NULL CHECK (template_source IN ('db', 'builtin')),
  template_updated_at TIMESTAMPTZ,
  recipient_user_id UUID,
  workspace_id UUID,
  recipient_email TEXT,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_archive_recipient ON email_archive (recipient_email, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_archive_workspace ON email_archive (workspace_id, sent_at DESC);

-- Admin allowlist, manageable from the Supabase dashboard: insert an email
-- to grant that user admin access (admin tools + deliverables bypass).
-- The ADMIN_EMAILS env var remains as an additional source.
-- The "groups" array holds permission groups (e.g. {admin}, {admin,billing})
-- so access can be scoped beyond a single admin flag; gate with userInGroup().
CREATE TABLE IF NOT EXISTS admin_allowlist (
  email TEXT PRIMARY KEY,
  groups TEXT[] NOT NULL DEFAULT '{admin}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);
`;
