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
