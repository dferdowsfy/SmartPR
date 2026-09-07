-- SmartPR billing schema (drop-in)
-- Apply against the same Postgres used by the app (workspaces table must exist).

CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces (id),
  plan TEXT NOT NULL,
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
