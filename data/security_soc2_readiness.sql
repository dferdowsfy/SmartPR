-- =====================================================================
-- SmartPR SOC 2 readiness schema (evidence, incidents, risks, policies,
-- access reviews). Idempotent. Does NOT claim certification.
-- Apply via Supabase SQL editor or migration pipeline.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- security_control_evidence — pointers to evidence artifacts (no fakes)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_control_evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id      text NOT NULL,
  evidence_kind   text NOT NULL,
  title           text NOT NULL,
  description     text,
  -- Link or storage path; never store secret material here
  artifact_uri    text,
  recorded_by     uuid,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  -- Optional human verification date (must be real when set)
  verified_at     timestamptz,
  verified_by     uuid,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sce_control_id ON public.security_control_evidence(control_id);
CREATE INDEX IF NOT EXISTS idx_sce_recorded_at ON public.security_control_evidence(recorded_at DESC);

-- ---------------------------------------------------------------------
-- security_incidents
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_incidents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  summary         text,
  severity        text NOT NULL DEFAULT 'medium'
                  CHECK (severity IN ('low','medium','high','critical')),
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','investigating','contained','resolved','closed')),
  detected_at     timestamptz NOT NULL DEFAULT now(),
  contained_at    timestamptz,
  resolved_at     timestamptz,
  reported_by     uuid,
  owner_user_id   uuid,
  -- workspace_id optional: platform-wide vs tenant-scoped
  workspace_id    uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  timeline        jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_si_status ON public.security_incidents(status);
CREATE INDEX IF NOT EXISTS idx_si_severity ON public.security_incidents(severity);

-- ---------------------------------------------------------------------
-- security_risks
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_risks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  description     text,
  likelihood      text NOT NULL DEFAULT 'medium'
                  CHECK (likelihood IN ('low','medium','high')),
  impact          text NOT NULL DEFAULT 'medium'
                  CHECK (impact IN ('low','medium','high')),
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','accepted','mitigating','closed')),
  treatment       text,
  owner_user_id   uuid,
  related_control_ids text[] NOT NULL DEFAULT '{}',
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sr_status ON public.security_risks(status);

-- ---------------------------------------------------------------------
-- security_policies — register only; no fabricated approvals
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_policies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL UNIQUE,
  title           text NOT NULL,
  version         text NOT NULL DEFAULT '0.1.0',
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','active','retired')),
  doc_uri         text,
  summary         text,
  -- Approval fields NULL until a real approval is recorded
  approved_at     timestamptz,
  approved_by     uuid,
  approval_notes  text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- security_access_reviews — privileged access review records
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_access_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  reviewer_user_id uuid,
  status          text NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress','completed','cancelled')),
  findings_summary text,
  -- Structured snapshot of what was reviewed (emails/roles — no secrets)
  snapshot        jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at    timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- support_access_grants hardening columns (idempotent)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='support_access_grants' AND column_name='last_used_at'
  ) THEN
    ALTER TABLE public.support_access_grants ADD COLUMN last_used_at timestamptz;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='support_access_grants' AND column_name='use_count'
  ) THEN
    ALTER TABLE public.support_access_grants ADD COLUMN use_count integer NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='support_access_grants' AND column_name='expiry_audited_at'
  ) THEN
    ALTER TABLE public.support_access_grants ADD COLUMN expiry_audited_at timestamptz;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- change_deploy_log — optional operational log (no fabricated rows)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.change_deploy_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment     text NOT NULL,
  change_type     text NOT NULL DEFAULT 'deploy'
                  CHECK (change_type IN ('deploy','config','schema','hotfix','rollback')),
  git_sha         text,
  summary         text NOT NULL,
  actor_email     text,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMIT;
