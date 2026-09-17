-- SmartPR Phase 2: MCP observability for authenticated phone access.
--
-- One row per MCP tool call. Never stores tokens, PINs, or raw arguments —
-- only the tool name, outcome, and timing, so product can later measure
-- which phone capabilities callers actually use.
--
-- Apply after data/voice_phone_access_schema.sql.

CREATE TABLE IF NOT EXISTS voice_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tool_name TEXT NOT NULL,
  session_id UUID REFERENCES voice_sessions(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  business_id TEXT,
  success BOOLEAN NOT NULL,
  error_code TEXT,
  denial_kind TEXT CHECK (
    denial_kind IS NULL OR denial_kind IN (
      'auth', 'forbidden', 'plan', 'selection',
      'validation', 'not_found', 'delivery', 'internal'
    )
  ),
  latency_ms INTEGER NOT NULL,
  email_sent BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS voice_tool_calls_user_created_idx
  ON voice_tool_calls (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS voice_tool_calls_tool_created_idx
  ON voice_tool_calls (tool_name, created_at DESC);
CREATE INDEX IF NOT EXISTS voice_tool_calls_session_idx
  ON voice_tool_calls (session_id);
