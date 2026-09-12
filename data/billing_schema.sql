-- SmartPR billing schema (drop-in)
-- Apply against the same Postgres used by the app (workspaces table must exist).

-- Plan enum: the Supabase Table Editor renders enum columns as a dropdown,
-- so plans can be changed from the dashboard without SQL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_id') THEN
    CREATE TYPE plan_id AS ENUM ('free', 'core', 'operator', 'partner', 'pilot', 'enterprise');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces (id),
  plan plan_id NOT NULL,
  status TEXT NOT NULL,
  owner_email TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  current_period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workspace_subscriptions_customer_idx
  ON workspace_subscriptions (stripe_customer_id);

CREATE INDEX IF NOT EXISTS workspace_subscriptions_subscription_idx
  ON workspace_subscriptions (stripe_subscription_id);

-- owner_email: display column so the dashboard shows whose plan each row is.
-- Maintained by triggers (recomputed from the workspace OWNER on every
-- subscription or membership change); backfilled for existing rows.
ALTER TABLE workspace_subscriptions ADD COLUMN IF NOT EXISTS owner_email TEXT;

CREATE OR REPLACE FUNCTION refresh_subscription_owner_email()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT u.email INTO NEW.owner_email
  FROM workspace_members wm
  JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = NEW.workspace_id
  ORDER BY CASE WHEN wm.role = 'OWNER' THEN 0 ELSE 1 END
  LIMIT 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscription_owner_email ON workspace_subscriptions;
CREATE TRIGGER trg_subscription_owner_email
BEFORE INSERT OR UPDATE ON workspace_subscriptions
FOR EACH ROW EXECUTE FUNCTION refresh_subscription_owner_email();

CREATE OR REPLACE FUNCTION refresh_workspace_owner_emails()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_ws UUID;
BEGIN
  v_ws := COALESCE(NEW.workspace_id, OLD.workspace_id);
  UPDATE workspace_subscriptions ws
  SET owner_email = (
    SELECT u.email
    FROM workspace_members wm
    JOIN auth.users u ON u.id = wm.user_id
    WHERE wm.workspace_id = v_ws
    ORDER BY CASE WHEN wm.role = 'OWNER' THEN 0 ELSE 1 END
    LIMIT 1
  )
  WHERE ws.workspace_id = v_ws;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_members_owner_email ON workspace_members;
CREATE TRIGGER trg_members_owner_email
AFTER INSERT OR UPDATE OR DELETE ON workspace_members
FOR EACH ROW EXECUTE FUNCTION refresh_workspace_owner_emails();

UPDATE workspace_subscriptions ws
SET owner_email = (
  SELECT u.email
  FROM workspace_members wm
  JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = ws.workspace_id
  ORDER BY CASE WHEN wm.role = 'OWNER' THEN 0 ELSE 1 END
  LIMIT 1
)
WHERE ws.owner_email IS NULL;
