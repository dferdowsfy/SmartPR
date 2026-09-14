-- ============================================================================
-- SmartPR partner-code redemption (design-partner pilots)
-- Apply against the same Postgres used by the app.
-- Requires: workspaces, workspace_members, workspace_subscriptions, plan_id.
--
-- Usage (SQL Editor):
--   SELECT admin_create_partner_code('ACME-90', 'partner', 10, 90, 'Acme Pilot');
--   SELECT * FROM partner_codes;
-- ============================================================================

CREATE TABLE IF NOT EXISTS partner_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  plan plan_id NOT NULL DEFAULT 'partner',
  workspace_id UUID REFERENCES workspaces (id),
  workspace_name TEXT NOT NULL DEFAULT 'Design Partner Workspace',
  max_redemptions INT NOT NULL DEFAULT 10 CHECK (max_redemptions > 0),
  redemption_count INT NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  pilot_days INT NOT NULL DEFAULT 90 CHECK (pilot_days > 0),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT partner_codes_code_upper CHECK (code = upper(code))
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_codes_code_uidx ON partner_codes (code);
CREATE INDEX IF NOT EXISTS partner_codes_workspace_idx ON partner_codes (workspace_id);

CREATE TABLE IF NOT EXISTS partner_code_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_code_id UUID NOT NULL REFERENCES partner_codes (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces (id),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_code_id, user_id)
);

CREATE INDEX IF NOT EXISTS partner_code_redemptions_user_idx
  ON partner_code_redemptions (user_id);

-- Create / upsert a partner code from the SQL Editor.
CREATE OR REPLACE FUNCTION admin_create_partner_code(
  p_code TEXT,
  p_plan TEXT DEFAULT 'partner',
  p_max_redemptions INT DEFAULT 10,
  p_pilot_days INT DEFAULT 90,
  p_workspace_name TEXT DEFAULT NULL,
  p_expires_days INT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT := upper(trim(p_code));
  v_plan TEXT := lower(trim(p_plan));
  v_name TEXT := COALESCE(nullif(trim(p_workspace_name), ''), v_code || ' Pilot');
  v_expires TIMESTAMPTZ := CASE
    WHEN p_expires_days IS NOT NULL THEN NOW() + make_interval(days => p_expires_days)
    ELSE NOW() + make_interval(days => COALESCE(p_pilot_days, 90))
  END;
BEGIN
  IF v_code IS NULL OR v_code = '' THEN
    RAISE EXCEPTION 'Code is required.';
  END IF;
  IF v_plan NOT IN ('free', 'core', 'operator', 'partner', 'pilot', 'enterprise') THEN
    RAISE EXCEPTION 'Unknown plan "%".', p_plan;
  END IF;
  INSERT INTO partner_codes (
    code, plan, workspace_name, max_redemptions, pilot_days, expires_at, notes, active, updated_at
  ) VALUES (
    v_code, v_plan::plan_id, v_name, COALESCE(p_max_redemptions, 10),
    COALESCE(p_pilot_days, 90), v_expires, p_notes, true, NOW()
  )
  ON CONFLICT (code) DO UPDATE SET
    plan = EXCLUDED.plan,
    workspace_name = EXCLUDED.workspace_name,
    max_redemptions = EXCLUDED.max_redemptions,
    pilot_days = EXCLUDED.pilot_days,
    expires_at = EXCLUDED.expires_at,
    notes = COALESCE(EXCLUDED.notes, partner_codes.notes),
    active = true,
    updated_at = NOW();
  RETURN format('Partner code %s → plan %s (max %s, %s-day pilot).',
    v_code, v_plan, COALESCE(p_max_redemptions, 10), COALESCE(p_pilot_days, 90));
END;
$$;

-- Seed: Luyo design-partner pilot (safe to re-run).
INSERT INTO partner_codes (
  code, plan, workspace_name, max_redemptions, pilot_days, expires_at, notes, active
) VALUES (
  'LUYO-90',
  'partner',
  'Luyo Design Partner',
  10,
  90,
  NOW() + INTERVAL '90 days',
  'Luyo design-partner pilot — shared Partner workspace',
  true
)
ON CONFLICT (code) DO UPDATE SET
  plan = EXCLUDED.plan,
  workspace_name = EXCLUDED.workspace_name,
  max_redemptions = EXCLUDED.max_redemptions,
  pilot_days = EXCLUDED.pilot_days,
  notes = EXCLUDED.notes,
  active = true,
  updated_at = NOW();
