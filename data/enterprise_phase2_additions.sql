-- =====================================================================
-- SmartPR Enterprise schema — Phase 2 additions (work queue + evidence
-- approval). Project: pzlqdrfwmzxfytkjssac
--
-- This file is a subset of data/enterprise_schema.sql covering only the
-- tables Phase 2 depends on. Idempotent: safe to re-run, and safe to apply
-- even if the full enterprise_schema.sql is applied later (or was applied
-- before) — every statement uses IF NOT EXISTS guards, DO-block ALTERs,
-- and DROP POLICY/TRIGGER IF EXISTS before creates.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- Shared helpers (may already exist from the full migration)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enterprise_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_is_member(ws uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = ws AND wm.user_id = auth.uid()
  );
$$;

-- =====================================================================
-- 1. obligation_work — internal workflow state per obligation (1:1)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.obligation_work (
  obligation_id    uuid PRIMARY KEY REFERENCES public.obligations(id) ON DELETE CASCADE,
  owner_user_id    uuid,
  department       text,
  reviewer_user_id uuid,
  priority         text NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('low','medium','high','critical')),
  internal_due_date date,
  work_status      text NOT NULL DEFAULT 'not_started'
                   CHECK (work_status IN ('not_started','in_progress','blocked',
                                         'evidence_submitted','under_review',
                                         'changes_requested','approved','completed')),
  escalation_state text NOT NULL DEFAULT 'none',
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Phase 2 audit columns: how a requirement was completed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='obligation_work'
        AND column_name='exception_reason') THEN
    ALTER TABLE public.obligation_work ADD COLUMN exception_reason text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='obligation_work'
        AND column_name='completed_via_exception') THEN
    ALTER TABLE public.obligation_work
      ADD COLUMN completed_via_exception boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='obligation_work'
        AND column_name='exception_granted_by') THEN
    ALTER TABLE public.obligation_work ADD COLUMN exception_granted_by uuid;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_obligation_work_owner ON public.obligation_work(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_obligation_work_reviewer ON public.obligation_work(reviewer_user_id);
CREATE INDEX IF NOT EXISTS idx_obligation_work_status ON public.obligation_work(work_status);
CREATE INDEX IF NOT EXISTS idx_obligation_work_due ON public.obligation_work(internal_due_date);

-- =====================================================================
-- 2. evidence_versions — immutable evidence rows (supersede, never edit)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.evidence_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id    uuid NOT NULL REFERENCES public.evidence(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  storage_path   text,
  file_hash      text,
  uploaded_by    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_evidence_versions_evidence_id ON public.evidence_versions(evidence_id);

-- =====================================================================
-- 3. evidence_reviews — review decisions on evidence/version rows
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.evidence_reviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id        uuid NOT NULL REFERENCES public.evidence(id) ON DELETE CASCADE,
  evidence_version_id uuid REFERENCES public.evidence_versions(id) ON DELETE SET NULL,
  reviewer_user_id   uuid,
  decision           text NOT NULL CHECK (decision IN ('approve','request_changes','reject')),
  reason             text,
  previous_state     text,
  resulting_state    text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evidence_reviews_evidence_id ON public.evidence_reviews(evidence_id);

-- =====================================================================
-- 4. evidence.enterprise_state (add if missing)
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='evidence' AND column_name='enterprise_state'
  ) THEN
    ALTER TABLE public.evidence
      ADD COLUMN enterprise_state text NOT NULL DEFAULT 'draft'
        CHECK (enterprise_state IN ('draft','submitted_for_review','under_review',
                                   'changes_requested','approved','rejected',
                                   'superseded','expired'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_evidence_enterprise_state ON public.evidence(enterprise_state);

-- =====================================================================
-- 5. audit_events — append-only audit log (+ trigger blocking UPDATE/DELETE)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.audit_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid,
  workspace_id   uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  action         text NOT NULL,
  target_type    text,
  target_id      text,
  before         jsonb,
  "after"        jsonb,
  ip             text,
  user_agent     text,
  correlation_id text,
  source         text CHECK (source IN ('ui','api','automation','superadmin')),
  reason         text
);
CREATE INDEX IF NOT EXISTS idx_audit_events_workspace_id ON public.audit_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON public.audit_events(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_action ON public.audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON public.audit_events(created_at);

CREATE OR REPLACE FUNCTION public.enterprise_audit_no_modify()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END;
$$;
DROP TRIGGER IF EXISTS audit_events_no_modify ON public.audit_events;
CREATE TRIGGER audit_events_no_modify
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_audit_no_modify();

-- =====================================================================
-- updated_at triggers (idempotent)
-- =====================================================================
DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS trg_obligation_work_updated_at ON public.obligation_work';
  EXECUTE 'CREATE TRIGGER trg_obligation_work_updated_at BEFORE UPDATE ON public.obligation_work FOR EACH ROW EXECUTE FUNCTION public.enterprise_set_updated_at()';
END $$;

-- =====================================================================
-- RLS: enable + workspace-membership policies (defense-in-depth; the app
-- enforces authorization server-side and queries via a privileged pool).
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['obligation_work','evidence_versions','evidence_reviews','audit_events'] LOOP
    EXECUTE format('ALTER TABLE public.%s ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- --- obligation_work: workspace resolved via obligations -> businesses ---
DO $$
BEGIN
  DROP POLICY IF EXISTS ep_select_obligation_work ON public.obligation_work;
  DROP POLICY IF EXISTS ep_insert_obligation_work ON public.obligation_work;
  DROP POLICY IF EXISTS ep_update_obligation_work ON public.obligation_work;
  DROP POLICY IF EXISTS ep_delete_obligation_work ON public.obligation_work;
  CREATE POLICY ep_select_obligation_work ON public.obligation_work FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.obligations o
      JOIN public.businesses b ON b.id = o.business_id
      WHERE o.id = obligation_work.obligation_id
        AND public.enterprise_is_member(b.workspace_id)));
  CREATE POLICY ep_insert_obligation_work ON public.obligation_work FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.obligations o
      JOIN public.businesses b ON b.id = o.business_id
      WHERE o.id = obligation_work.obligation_id
        AND public.enterprise_is_member(b.workspace_id)));
  CREATE POLICY ep_update_obligation_work ON public.obligation_work FOR UPDATE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.obligations o
      JOIN public.businesses b ON b.id = o.business_id
      WHERE o.id = obligation_work.obligation_id
        AND public.enterprise_is_member(b.workspace_id)))
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.obligations o
      JOIN public.businesses b ON b.id = o.business_id
      WHERE o.id = obligation_work.obligation_id
        AND public.enterprise_is_member(b.workspace_id)));
  CREATE POLICY ep_delete_obligation_work ON public.obligation_work FOR DELETE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.obligations o
      JOIN public.businesses b ON b.id = o.business_id
      WHERE o.id = obligation_work.obligation_id
        AND public.enterprise_is_member(b.workspace_id)));
END $$;

-- --- evidence_versions / evidence_reviews: workspace via evidence -> businesses ---
DO $$
BEGIN
  DROP POLICY IF EXISTS ep_select_evidence_versions ON public.evidence_versions;
  DROP POLICY IF EXISTS ep_insert_evidence_versions ON public.evidence_versions;
  DROP POLICY IF EXISTS ep_update_evidence_versions ON public.evidence_versions;
  DROP POLICY IF EXISTS ep_delete_evidence_versions ON public.evidence_versions;
  CREATE POLICY ep_select_evidence_versions ON public.evidence_versions FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.evidence e
      JOIN public.businesses b ON b.id = e.business_id
      WHERE e.id = evidence_versions.evidence_id
        AND public.enterprise_is_member(b.workspace_id)));
  CREATE POLICY ep_insert_evidence_versions ON public.evidence_versions FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.evidence e
      JOIN public.businesses b ON b.id = e.business_id
      WHERE e.id = evidence_versions.evidence_id
        AND public.enterprise_is_member(b.workspace_id)));
  CREATE POLICY ep_update_evidence_versions ON public.evidence_versions FOR UPDATE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.evidence e
      JOIN public.businesses b ON b.id = e.business_id
      WHERE e.id = evidence_versions.evidence_id
        AND public.enterprise_is_member(b.workspace_id)))
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.evidence e
      JOIN public.businesses b ON b.id = e.business_id
      WHERE e.id = evidence_versions.evidence_id
        AND public.enterprise_is_member(b.workspace_id)));
  CREATE POLICY ep_delete_evidence_versions ON public.evidence_versions FOR DELETE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.evidence e
      JOIN public.businesses b ON b.id = e.business_id
      WHERE e.id = evidence_versions.evidence_id
        AND public.enterprise_is_member(b.workspace_id)));
END $$;

DO $$
BEGIN
  DROP POLICY IF EXISTS ep_select_evidence_reviews ON public.evidence_reviews;
  DROP POLICY IF EXISTS ep_insert_evidence_reviews ON public.evidence_reviews;
  DROP POLICY IF EXISTS ep_update_evidence_reviews ON public.evidence_reviews;
  DROP POLICY IF EXISTS ep_delete_evidence_reviews ON public.evidence_reviews;
  CREATE POLICY ep_select_evidence_reviews ON public.evidence_reviews FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.evidence e
      JOIN public.businesses b ON b.id = e.business_id
      WHERE e.id = evidence_reviews.evidence_id
        AND public.enterprise_is_member(b.workspace_id)));
  CREATE POLICY ep_insert_evidence_reviews ON public.evidence_reviews FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.evidence e
      JOIN public.businesses b ON b.id = e.business_id
      WHERE e.id = evidence_reviews.evidence_id
        AND public.enterprise_is_member(b.workspace_id)));
  CREATE POLICY ep_update_evidence_reviews ON public.evidence_reviews FOR UPDATE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.evidence e
      JOIN public.businesses b ON b.id = e.business_id
      WHERE e.id = evidence_reviews.evidence_id
        AND public.enterprise_is_member(b.workspace_id)))
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.evidence e
      JOIN public.businesses b ON b.id = e.business_id
      WHERE e.id = evidence_reviews.evidence_id
        AND public.enterprise_is_member(b.workspace_id)));
  CREATE POLICY ep_delete_evidence_reviews ON public.evidence_reviews FOR DELETE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.evidence e
      JOIN public.businesses b ON b.id = e.business_id
      WHERE e.id = evidence_reviews.evidence_id
        AND public.enterprise_is_member(b.workspace_id)));
END $$;

-- --- audit_events: membership-scoped where workspace-bound ---
DO $$
BEGIN
  DROP POLICY IF EXISTS ep_select_audit_events ON public.audit_events;
  DROP POLICY IF EXISTS ep_insert_audit_events ON public.audit_events;
  DROP POLICY IF EXISTS ep_update_audit_events ON public.audit_events;
  DROP POLICY IF EXISTS ep_delete_audit_events ON public.audit_events;
  CREATE POLICY ep_select_audit_events ON public.audit_events FOR SELECT TO authenticated
    USING (workspace_id IS NOT NULL AND public.enterprise_is_member(workspace_id));
  CREATE POLICY ep_insert_audit_events ON public.audit_events FOR INSERT TO authenticated
    WITH CHECK (workspace_id IS NOT NULL AND public.enterprise_is_member(workspace_id));
  CREATE POLICY ep_update_audit_events ON public.audit_events FOR UPDATE TO authenticated
    USING (workspace_id IS NOT NULL AND public.enterprise_is_member(workspace_id))
    WITH CHECK (workspace_id IS NOT NULL AND public.enterprise_is_member(workspace_id));
  CREATE POLICY ep_delete_audit_events ON public.audit_events FOR DELETE TO authenticated
    USING (workspace_id IS NOT NULL AND public.enterprise_is_member(workspace_id));
END $$;

COMMIT;
