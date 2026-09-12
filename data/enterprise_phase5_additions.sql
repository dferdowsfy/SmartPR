-- =====================================================================
-- SmartPR Enterprise schema — Phase 5 additions (regulatory change impact)
-- Project: pzlqdrfwmzxfytkjssac
-- Idempotent: every statement is safe to re-run (IF NOT EXISTS guards,
-- DO-block ALTERs, named-constraint existence checks).
--
-- Adds to regulatory_events:
--   prev_rule_text / updated_rule_text  — reviewer-entered rule text
--       (previous vs updated wording; human-entered, never AI-generated)
--   change_event_id                     — link to the detection layer
--       (requirement_change_events), NULL when the development was recorded
--       manually from a regulatory source
--   targeting                           — deterministic impact-matching spec
--       (jsonb; see frontend/src/lib/enterprise-regulatory.ts TargetingSpec)
-- Adds to regulatory_impacts:
--   applicability  — 'projected' when the event lifecycle is not effective
--       (no remediation may be triggered from projected impacts),
--       'confirmed' once the event is effective
--   match_basis    — human-readable explanation of why the row matched
--   match_key      — deterministic dedupe key per (event, matched entity);
--       the unique index below makes compute-impact an idempotent upsert
--       that preserves reviewer ack/implementation progress on re-runs
--   matter_id      — link to matters (projects)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- regulatory_events additions
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='regulatory_events'
        AND column_name='prev_rule_text') THEN
    ALTER TABLE public.regulatory_events ADD COLUMN prev_rule_text text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='regulatory_events'
        AND column_name='updated_rule_text') THEN
    ALTER TABLE public.regulatory_events ADD COLUMN updated_rule_text text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='regulatory_events'
        AND column_name='change_event_id') THEN
    ALTER TABLE public.regulatory_events
      ADD COLUMN change_event_id uuid
        REFERENCES public.requirement_change_events(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='regulatory_events'
        AND column_name='targeting') THEN
    ALTER TABLE public.regulatory_events
      ADD COLUMN targeting jsonb NOT NULL DEFAULT '{}';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_regulatory_events_change_event_id
  ON public.regulatory_events(change_event_id);

-- ---------------------------------------------------------------------
-- regulatory_impacts additions
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='regulatory_impacts'
        AND column_name='applicability') THEN
    ALTER TABLE public.regulatory_impacts
      ADD COLUMN applicability text NOT NULL DEFAULT 'confirmed'
        CHECK (applicability IN ('projected','confirmed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='regulatory_impacts'
        AND column_name='match_basis') THEN
    ALTER TABLE public.regulatory_impacts ADD COLUMN match_basis text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='regulatory_impacts'
        AND column_name='match_key') THEN
    ALTER TABLE public.regulatory_impacts ADD COLUMN match_key text;
  END IF;
  -- Tenant isolation (2026-09-12 hardening): every impact row belongs to the
  -- workspace whose entities it describes, even for global (workspace_id NULL)
  -- regulatory events.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='regulatory_impacts'
        AND column_name='workspace_id') THEN
    ALTER TABLE public.regulatory_impacts ADD COLUMN workspace_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='regulatory_impacts'
        AND column_name='matter_id') THEN
    ALTER TABLE public.regulatory_impacts
      ADD COLUMN matter_id uuid REFERENCES public.matters(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Domain checks on the existing status columns (tables were empty at
-- Phase 5 build time; guarded so re-runs never fail).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='regulatory_impacts_ack_status_check') THEN
    ALTER TABLE public.regulatory_impacts
      ADD CONSTRAINT regulatory_impacts_ack_status_check
      CHECK (ack_status IN ('pending','acknowledged'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='regulatory_impacts_impl_status_check') THEN
    ALTER TABLE public.regulatory_impacts
      ADD CONSTRAINT regulatory_impacts_impl_status_check
      CHECK (implementation_status IN ('not_started','in_progress','implemented'));
  END IF;
END $$;

-- Idempotent compute-impact: one row per (event, workspace, matched entity).
-- (Supersedes the pre-hardening uq_regulatory_impacts_event_match index;
-- the tenant-isolation migration drops it.)
DROP INDEX IF EXISTS uq_regulatory_impacts_event_match;
CREATE UNIQUE INDEX IF NOT EXISTS uq_regulatory_impacts_event_ws_match
  ON public.regulatory_impacts(event_id, workspace_id, match_key);
CREATE INDEX IF NOT EXISTS ix_regulatory_impacts_event_workspace
  ON public.regulatory_impacts(event_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_impacts_matter_id
  ON public.regulatory_impacts(matter_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_impacts_applicability
  ON public.regulatory_impacts(applicability);

COMMIT;
