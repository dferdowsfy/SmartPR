-- ============================================================================
-- SmartPR Voice Phase 3: action-oriented voice assistant.
--
-- New tables:
--   voice_pending_actions  - server-side pending actions awaiting explicit
--                            caller confirmation. The model only ever sees an
--                            opaque id; the payload is frozen server-side.
--   voice_action_links     - short-lived, single-purpose secure links
--                            (upload links, secure action links). Tokens are
--                            stored as SHA-256 hashes; the raw token only
--                            exists in the emailed URL.
--   business_notes         - user notes on a business (voice or web).
--   voice_fact_provenance  - provenance for voice-confirmed facts:
--                            source=voice, session id, timestamp, scope.
--
-- Alterations:
--   matters.facts_json     - canonical project-scope facts (JSONB).
--
-- Nothing here stores PINs, raw voice session tokens, or link secrets.
-- Apply AFTER data/voice_phone_access_schema.sql and
-- data/voice_phase2_schema.sql.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- voice_pending_actions: server-side confirmation model.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_session_id UUID NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  business_id UUID,
  matter_id UUID,
  action_type TEXT NOT NULL
    CHECK (action_type IN ('create_draft_project', 'update_project_fact', 'add_note')),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmation_summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'executed', 'expired', 'cancelled', 'failed')),
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_voice_pending_session
  ON voice_pending_actions(voice_session_id, status);
CREATE INDEX IF NOT EXISTS idx_voice_pending_user
  ON voice_pending_actions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_pending_expiry
  ON voice_pending_actions(expires_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- voice_action_links: short-lived secure links (upload / secure action).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_action_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('upload_evidence', 'secure_action')),
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  business_id UUID,
  matter_id UUID,
  obligation_id UUID,
  action_type TEXT,
  label TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_action_links_user
  ON voice_action_links(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_action_links_expiry
  ON voice_action_links(expires_at);

-- ---------------------------------------------------------------------------
-- business_notes: informational notes on a business (voice or web).
-- Notes never alter regulatory facts automatically.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  matter_id UUID REFERENCES matters(id) ON DELETE SET NULL,
  note_text TEXT NOT NULL CHECK (char_length(note_text) BETWEEN 1 AND 2000),
  source TEXT NOT NULL DEFAULT 'voice' CHECK (source IN ('voice', 'web')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_notes_business
  ON business_notes(business_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- voice_fact_provenance: where each voice-confirmed fact came from.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_fact_provenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  matter_id UUID,
  fact_key TEXT NOT NULL,
  fact_value JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'voice',
  voice_session_id UUID REFERENCES voice_sessions(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_fact_prov_business
  ON voice_fact_provenance(business_id, fact_key, confirmed_at DESC);

-- ---------------------------------------------------------------------------
-- matters.facts_json: canonical project-scope facts (existing canonical keys).
-- ---------------------------------------------------------------------------
ALTER TABLE matters ADD COLUMN IF NOT EXISTS facts_json JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
