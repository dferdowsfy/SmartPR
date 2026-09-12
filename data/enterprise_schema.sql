-- =====================================================================
-- SmartPR Enterprise schema — Phase 0
-- Project: pzlqdrfwmzxfytkjssac
-- Idempotent: every statement is safe to re-run (IF NOT EXISTS guards,
-- DO-block ALTERs, DROP POLICY/TRIGGER IF EXISTS before creates).
-- All PKs mirror existing convention (uuid, gen_random_uuid()).
-- Note: `obligations` and `evidence` have no direct workspace_id column in
-- this project; workspace scoping for their dependent tables resolves via
-- obligations -> businesses -> workspace_members (see RLS policies).
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- Shared helpers
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
-- 1. facilities — physical business locations (jurisdictional anchors)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.facilities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  business_id  uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  name         text NOT NULL,
  municipality text,
  address      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_facilities_workspace_id ON public.facilities(workspace_id);
CREATE INDEX IF NOT EXISTS idx_facilities_business_id ON public.facilities(business_id);

-- =====================================================================
-- 2. obligation_work — internal workflow state per obligation
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
CREATE INDEX IF NOT EXISTS idx_obligation_work_owner ON public.obligation_work(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_obligation_work_reviewer ON public.obligation_work(reviewer_user_id);

-- =====================================================================
-- 3. evidence_versions — immutable evidence rows (supersede, never edit)
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
-- 4. evidence_reviews — review decisions on evidence/version rows
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
-- 5. evidence.enterprise_state (add if missing)
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
-- 6. regulatory_events — change-intel ingestion (proposed -> effective)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.regulatory_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  summary          text,
  lifecycle        text NOT NULL DEFAULT 'proposed'
                   CHECK (lifecycle IN ('proposed','pending_review','enacted_not_effective',
                                       'effective','superseded')),
  regulatory_source text,
  source_version   text,
  effective_date   date,
  verification_date timestamptz,
  verified_by      uuid,
  reviewer_notes   text,
  workspace_id     uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_regulatory_events_workspace_id ON public.regulatory_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_events_lifecycle ON public.regulatory_events(lifecycle);

-- =====================================================================
-- 7. regulatory_impacts — per-obligation/business/facility impact plans
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.regulatory_impacts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             uuid NOT NULL REFERENCES public.regulatory_events(id) ON DELETE CASCADE,
  obligation_id        uuid REFERENCES public.obligations(id) ON DELETE SET NULL,
  business_id          uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  facility_id          uuid REFERENCES public.facilities(id) ON DELETE SET NULL,
  required_action      text,
  ack_status           text NOT NULL DEFAULT 'pending',
  implementation_status text NOT NULL DEFAULT 'not_started',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_regulatory_impacts_event_id ON public.regulatory_impacts(event_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_impacts_obligation_id ON public.regulatory_impacts(obligation_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_impacts_business_id ON public.regulatory_impacts(business_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_impacts_facility_id ON public.regulatory_impacts(facility_id);

-- =====================================================================
-- 8. reminder_rules — cadence rules for due-date reminders
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.reminder_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  obligation_id uuid REFERENCES public.obligations(id) ON DELETE CASCADE,
  offsets_days  int[],
  channels      text[] NOT NULL DEFAULT '{in_app}',
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reminder_rules_workspace_id ON public.reminder_rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_reminder_rules_obligation_id ON public.reminder_rules(obligation_id);

-- =====================================================================
-- 9. escalation_policies — ordered escalation steps per trigger
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.escalation_policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  trigger       text NOT NULL CHECK (trigger IN ('overdue','unassigned','critical_unreviewed')),
  steps         jsonb NOT NULL DEFAULT '[]',
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_escalation_policies_workspace_id ON public.escalation_policies(workspace_id);

-- =====================================================================
-- 10. deadline_schedules — verified one-time/recurring/expiration dates
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.deadline_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  obligation_id    uuid REFERENCES public.obligations(id) ON DELETE CASCADE,
  schedule_type    text NOT NULL CHECK (schedule_type IN ('one_time','recurring','expiration')),
  due_date         date,
  recurrence_rule  text,
  grace_days       int NOT NULL DEFAULT 0,
  is_verified      boolean NOT NULL DEFAULT false,
  label            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deadline_schedules_workspace_id ON public.deadline_schedules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_deadline_schedules_obligation_id ON public.deadline_schedules(obligation_id);

-- =====================================================================
-- 11. webhook_endpoints + 12. webhook_deliveries
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url           text NOT NULL,
  secret_hash   text,
  events        text[] NOT NULL DEFAULT '{}',
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_workspace_id ON public.webhook_endpoints(workspace_id);

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id    uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event_type     text NOT NULL,
  payload        jsonb,
  signature      text,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','delivered','failed','disabled')),
  attempts       int NOT NULL DEFAULT 0,
  next_retry_at  timestamptz,
  response_status int,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint_id ON public.webhook_deliveries(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON public.webhook_deliveries(status);

-- =====================================================================
-- 13. service_accounts — API identities per workspace
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.service_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  scopes          text[] NOT NULL DEFAULT '{}',
  credential_hash text,
  expires_at      timestamptz,
  last_used_at    timestamptz,
  revoked         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_accounts_workspace_id ON public.service_accounts(workspace_id);

-- =====================================================================
-- 14. enterprise_roles + 15. role_assignments (scoped RBAC)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.enterprise_roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  key           text NOT NULL,
  label         text NOT NULL,
  permissions   jsonb NOT NULL DEFAULT '{}',
  is_system     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);
CREATE INDEX IF NOT EXISTS idx_enterprise_roles_workspace_id ON public.enterprise_roles(workspace_id);

CREATE TABLE IF NOT EXISTS public.role_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  workspace_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  enterprise_role_id uuid REFERENCES public.enterprise_roles(id) ON DELETE CASCADE,
  scope_type         text NOT NULL
                     CHECK (scope_type IN ('organization','business','facility','project')),
  scope_id           uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id, enterprise_role_id, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_role_assignments_workspace_id ON public.role_assignments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_role_assignments_user_id ON public.role_assignments(user_id);

-- =====================================================================
-- 16. feature_flags + 17. feature_flag_history (superadmin kill switches)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  key           text NOT NULL,
  value         jsonb NOT NULL DEFAULT 'false',
  source        text NOT NULL DEFAULT 'superadmin',
  updated_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);
CREATE INDEX IF NOT EXISTS idx_feature_flags_workspace_id ON public.feature_flags(workspace_id);

CREATE TABLE IF NOT EXISTS public.feature_flag_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  key           text NOT NULL,
  old_value     jsonb,
  new_value     jsonb,
  changed_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feature_flag_history_workspace_id ON public.feature_flag_history(workspace_id);

-- =====================================================================
-- 18. support_access_grants — time-boxed admin support access
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.support_access_grants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  granted_by        uuid,
  granted_to_email  text NOT NULL,
  reason            text,
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  scope             text NOT NULL DEFAULT 'read_only',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_access_grants_workspace_id ON public.support_access_grants(workspace_id);

-- =====================================================================
-- 19. audit_events — append-only audit log (+ trigger blocking UPDATE/DELETE)
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
-- 20. domain_verifications — custom domain DNS/TLS verification state
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.domain_verifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  domain          text NOT NULL,
  dns_token       text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','verifying','active','failed')),
  last_attempt_at timestamptz,
  last_error      text,
  tls_status      text NOT NULL DEFAULT 'unknown',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_domain_verifications_workspace_id ON public.domain_verifications(workspace_id);

-- =====================================================================
-- 21. workspace_branding extension (add-if-missing, idempotent)
-- =====================================================================
DO $$
DECLARE col RECORD;
BEGIN
  FOR col IN
    SELECT * FROM (VALUES
      ('logo_primary_path',        'text'),
      ('logo_compact_path',        'text'),
      ('favicon_path',             'text'),
      ('email_header_html',        'text'),
      ('login_branding',           'jsonb'),
      ('terminology',              'jsonb'),
      ('sso_verified_at',          'timestamptz'),
      ('sso_last_successful_login','timestamptz')
    ) AS v(name, dtype)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='workspace_branding'
        AND column_name = col.name
    ) THEN
      EXECUTE format('ALTER TABLE public.workspace_branding ADD COLUMN %I %s', col.name, col.dtype);
    END IF;
  END LOOP;

  -- columns with defaults + checks
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='workspace_branding' AND column_name='sso_enforcement') THEN
    ALTER TABLE public.workspace_branding
      ADD COLUMN sso_enforcement text NOT NULL DEFAULT 'disabled'
        CHECK (sso_enforcement IN ('disabled','enabled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='workspace_branding' AND column_name='session_minutes') THEN
    ALTER TABLE public.workspace_branding ADD COLUMN session_minutes int NOT NULL DEFAULT 480;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='workspace_branding' AND column_name='mfa_policy') THEN
    ALTER TABLE public.workspace_branding ADD COLUMN mfa_policy text NOT NULL DEFAULT 'optional';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='workspace_branding' AND column_name='auto_provision') THEN
    ALTER TABLE public.workspace_branding ADD COLUMN auto_provision boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='workspace_branding' AND column_name='sso_default_role') THEN
    ALTER TABLE public.workspace_branding ADD COLUMN sso_default_role text NOT NULL DEFAULT 'contributor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='workspace_branding' AND column_name='sso_group_mappings') THEN
    ALTER TABLE public.workspace_branding ADD COLUMN sso_group_mappings jsonb NOT NULL DEFAULT '[]';
  END IF;
END $$;

-- =====================================================================
-- updated_at triggers (idempotent: drop then create)
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'facilities','obligation_work','regulatory_events','regulatory_impacts',
    'reminder_rules','escalation_policies','deadline_schedules',
    'webhook_endpoints','webhook_deliveries','service_accounts',
    'enterprise_roles','role_assignments','feature_flags',
    'support_access_grants','domain_verifications'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%s', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%s FOR EACH ROW EXECUTE FUNCTION public.enterprise_set_updated_at()',
      t, t);
  END LOOP;
END $$;

-- =====================================================================
-- RLS: enable + workspace-membership policies (defense-in-depth; the app
-- enforces authorization server-side and queries via service role).
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'facilities','regulatory_events','regulatory_impacts','reminder_rules',
    'escalation_policies','deadline_schedules','webhook_endpoints',
    'webhook_deliveries','service_accounts','enterprise_roles',
    'role_assignments','feature_flags','feature_flag_history',
    'support_access_grants','domain_verifications','audit_events',
    'obligation_work','evidence_versions','evidence_reviews'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%s ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- --- standard workspace_id-keyed tables (regulatory_impacts and
-- webhook_deliveries have no direct workspace_id and get custom policies below) ---
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'facilities','regulatory_events','reminder_rules',
    'escalation_policies','deadline_schedules','webhook_endpoints',
    'service_accounts','enterprise_roles',
    'role_assignments','feature_flags','feature_flag_history',
    'support_access_grants','domain_verifications'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'ep_select_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'ep_insert_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'ep_update_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'ep_delete_' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.enterprise_is_member(workspace_id))',
      'ep_select_' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.enterprise_is_member(workspace_id))',
      'ep_insert_' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.enterprise_is_member(workspace_id)) WITH CHECK (public.enterprise_is_member(workspace_id))',
      'ep_update_' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.enterprise_is_member(workspace_id))',
      'ep_delete_' || t, t);
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

-- --- audit_events: membership-scoped where workspace-bound; trigger blocks writes ---
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
  -- UPDATE/DELETE policies intentionally grant membership-only; the
  -- audit_events_no_modify trigger raises before they can take effect.
  CREATE POLICY ep_update_audit_events ON public.audit_events FOR UPDATE TO authenticated
    USING (workspace_id IS NOT NULL AND public.enterprise_is_member(workspace_id))
    WITH CHECK (workspace_id IS NOT NULL AND public.enterprise_is_member(workspace_id));
  CREATE POLICY ep_delete_audit_events ON public.audit_events FOR DELETE TO authenticated
    USING (workspace_id IS NOT NULL AND public.enterprise_is_member(workspace_id));
END $$;

-- --- regulatory_impacts: workspace_id not direct; use event -> workspace, else business ---
DO $$
BEGIN
  DROP POLICY IF EXISTS ep_select_regulatory_impacts ON public.regulatory_impacts;
  DROP POLICY IF EXISTS ep_insert_regulatory_impacts ON public.regulatory_impacts;
  DROP POLICY IF EXISTS ep_update_regulatory_impacts ON public.regulatory_impacts;
  DROP POLICY IF EXISTS ep_delete_regulatory_impacts ON public.regulatory_impacts;
  CREATE POLICY ep_select_regulatory_impacts ON public.regulatory_impacts FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.regulatory_events re
      WHERE re.id = regulatory_impacts.event_id
        AND re.workspace_id IS NOT NULL
        AND public.enterprise_is_member(re.workspace_id)));
  CREATE POLICY ep_insert_regulatory_impacts ON public.regulatory_impacts FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.regulatory_events re
      WHERE re.id = regulatory_impacts.event_id
        AND re.workspace_id IS NOT NULL
        AND public.enterprise_is_member(re.workspace_id)));
  CREATE POLICY ep_update_regulatory_impacts ON public.regulatory_impacts FOR UPDATE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.regulatory_events re
      WHERE re.id = regulatory_impacts.event_id
        AND re.workspace_id IS NOT NULL
        AND public.enterprise_is_member(re.workspace_id)))
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.regulatory_events re
      WHERE re.id = regulatory_impacts.event_id
        AND re.workspace_id IS NOT NULL
        AND public.enterprise_is_member(re.workspace_id)));
  CREATE POLICY ep_delete_regulatory_impacts ON public.regulatory_impacts FOR DELETE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.regulatory_events re
      WHERE re.id = regulatory_impacts.event_id
        AND re.workspace_id IS NOT NULL
        AND public.enterprise_is_member(re.workspace_id)));
END $$;

-- --- webhook_deliveries: workspace via webhook_endpoints ---
DO $$
BEGIN
  DROP POLICY IF EXISTS ep_select_webhook_deliveries ON public.webhook_deliveries;
  DROP POLICY IF EXISTS ep_insert_webhook_deliveries ON public.webhook_deliveries;
  DROP POLICY IF EXISTS ep_update_webhook_deliveries ON public.webhook_deliveries;
  DROP POLICY IF EXISTS ep_delete_webhook_deliveries ON public.webhook_deliveries;
  CREATE POLICY ep_select_webhook_deliveries ON public.webhook_deliveries FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.webhook_endpoints we
      WHERE we.id = webhook_deliveries.endpoint_id
        AND public.enterprise_is_member(we.workspace_id)));
  CREATE POLICY ep_insert_webhook_deliveries ON public.webhook_deliveries FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.webhook_endpoints we
      WHERE we.id = webhook_deliveries.endpoint_id
        AND public.enterprise_is_member(we.workspace_id)));
  CREATE POLICY ep_update_webhook_deliveries ON public.webhook_deliveries FOR UPDATE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.webhook_endpoints we
      WHERE we.id = webhook_deliveries.endpoint_id
        AND public.enterprise_is_member(we.workspace_id)))
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.webhook_endpoints we
      WHERE we.id = webhook_deliveries.endpoint_id
        AND public.enterprise_is_member(we.workspace_id)));
  CREATE POLICY ep_delete_webhook_deliveries ON public.webhook_deliveries FOR DELETE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.webhook_endpoints we
      WHERE we.id = webhook_deliveries.endpoint_id
        AND public.enterprise_is_member(we.workspace_id)));
END $$;

COMMIT;
