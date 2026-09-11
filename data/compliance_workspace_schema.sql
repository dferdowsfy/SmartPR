-- SmartPR persistent multi-business compliance workspace
-- Backward-compatible extension: existing businesses, submissions, workflow
-- snapshots, validations, readiness scores, and deliverables are preserved.

BEGIN;

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'INDIVIDUAL' CHECK (kind IN ('INDIVIDUAL','PROFESSIONAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_user_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER','ADMIN','MEMBER','VIEWER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS entity_number TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_structure TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_type TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS municipality TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS physical_address TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS onboarding_mode TEXT NOT NULL DEFAULT 'NEW'
  CHECK (onboarding_mode IN ('NEW','EXISTING'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
UPDATE businesses SET legal_name=name WHERE legal_name IS NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_workspace ON businesses(workspace_id);
CREATE INDEX IF NOT EXISTS idx_businesses_municipality ON businesses(municipality);

CREATE TABLE IF NOT EXISTS matters (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id),
  user_id UUID NOT NULL,
  submission_id UUID,
  matter_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','IN_PROGRESS','NEEDS_ATTENTION','READY','COMPLETED','ARCHIVED')),
  readiness_score NUMERIC(5,2),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date DATE,
  due_date_source TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (due_date_source IN ('REGULATORY_RULE','DOCUMENT_EXTRACTED','USER_PROVIDED','EXTERNALLY_VERIFIED','UNKNOWN')),
  due_date_confidence NUMERIC(5,4),
  source_reference TEXT,
  verified_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_matters_business ON matters(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matters_workspace_status ON matters(workspace_id,status);
CREATE INDEX IF NOT EXISTS idx_matters_due ON matters(due_date) WHERE completed_at IS NULL;

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS matter_id UUID;
CREATE INDEX IF NOT EXISTS idx_submissions_matter ON submissions(matter_id);
ALTER TABLE workflow_snapshots ADD COLUMN IF NOT EXISTS matter_id UUID;

CREATE TABLE IF NOT EXISTS obligations (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  matter_id UUID REFERENCES matters(id) ON DELETE SET NULL,
  requirement_id TEXT,
  graph_entity_id TEXT,
  name TEXT NOT NULL,
  agency TEXT,
  status TEXT NOT NULL DEFAULT 'MISSING'
    CHECK (status IN ('CURRENT','UPCOMING','DUE_SOON','IN_PROGRESS','NEEDS_ATTENTION','MISSING','OVERDUE','COMPLETED','UNKNOWN')),
  due_date DATE,
  due_date_source TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (due_date_source IN ('REGULATORY_RULE','DOCUMENT_EXTRACTED','USER_PROVIDED','EXTERNALLY_VERIFIED','UNKNOWN')),
  due_date_confidence NUMERIC(5,4),
  source TEXT NOT NULL DEFAULT 'REGULATORY_GRAPH',
  source_reference TEXT,
  verified_at TIMESTAMPTZ,
  renewal_frequency_months INTEGER CHECK (renewal_frequency_months IS NULL OR renewal_frequency_months>0),
  renewal_reference TEXT,
  mandatory BOOLEAN NOT NULL DEFAULT true,
  next_action TEXT,
  cycle_index INTEGER NOT NULL DEFAULT 1 CHECK (cycle_index>0),
  previous_obligation_id UUID REFERENCES obligations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(matter_id,requirement_id,cycle_index)
);
CREATE INDEX IF NOT EXISTS idx_obligations_business_status ON obligations(business_id,status);
-- Tracks when the user opened the requirement's official download/filing
-- destination in a new tab. Powers the "downloaded, now upload" return nudge.
ALTER TABLE obligations ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_obligations_due ON obligations(due_date) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_obligations_requirement ON obligations(requirement_id);

CREATE TABLE IF NOT EXISTS evidence (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  matter_id UUID REFERENCES matters(id) ON DELETE SET NULL,
  obligation_id UUID REFERENCES obligations(id) ON DELETE SET NULL,
  validation_id BIGINT,
  original_filename TEXT NOT NULL,
  storage_path TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  document_type TEXT,
  review_status TEXT NOT NULL DEFAULT 'UPLOADED'
    CHECK (review_status IN ('UPLOADED','PROCESSING','VERIFIED','NEEDS_REVIEW','REJECTED')),
  extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  extraction_confidence NUMERIC(5,4),
  issue_date DATE,
  expiration_date DATE,
  date_source TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (date_source IN ('REGULATORY_RULE','DOCUMENT_EXTRACTED','USER_PROVIDED','EXTERNALLY_VERIFIED','UNKNOWN')),
  source_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_evidence_business ON evidence(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_obligation ON evidence(obligation_id);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  workspace_id UUID REFERENCES workspaces(id),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  obligation_id UUID REFERENCES obligations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP','EMAIL','SMS')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','DELIVERED','READ','DISMISSED','CANCELLED')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  UNIQUE(obligation_id,type,scheduled_for)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_schedule ON notifications(user_id,scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_pending ON notifications(user_id,status,scheduled_for);

COMMIT;

-- Optional Supabase Storage setup for private evidence binaries. This block is
-- intentionally separate from the core transaction so ordinary PostgreSQL
-- deployments without the Supabase storage schema can apply the core model.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets(id,name,public,file_size_limit)
      VALUES ('evidence','evidence',false,20971520)
      ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=20971520;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='SmartPR users manage own evidence') THEN
      EXECUTE $policy$
        CREATE POLICY "SmartPR users manage own evidence" ON storage.objects
        FOR ALL TO authenticated
        USING (bucket_id='evidence' AND (storage.foldername(name))[1]=auth.uid()::text)
        WITH CHECK (bucket_id='evidence' AND (storage.foldername(name))[1]=auth.uid()::text)
      $policy$;
    END IF;
  END IF;
END $$;

-- Deliverables: archived readiness reports / submission packages. Same
-- per-user-folder isolation model as evidence — the storage path is always
-- `{user_id}/{deliverable_id}/{filename}`, so a policy scoped to the first
-- folder segment is sufficient and requires no join back to the app schema.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets(id,name,public,file_size_limit)
      VALUES ('deliverables','deliverables',false,20971520)
      ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=20971520;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='SmartPR users manage own deliverables') THEN
      EXECUTE $policy$
        CREATE POLICY "SmartPR users manage own deliverables" ON storage.objects
        FOR ALL TO authenticated
        USING (bucket_id='deliverables' AND (storage.foldername(name))[1]=auth.uid()::text)
        WITH CHECK (bucket_id='deliverables' AND (storage.foldername(name))[1]=auth.uid()::text)
      $policy$;
    END IF;
  END IF;
END $$;

-- Generated filings: populated working copies of official government forms.
-- Storage path is `{tenant_id}/{business_id}/{form_code}/{instance_id}/...`
-- where tenant_id is always the uploading user's own auth.uid() (see
-- forms/artifacts/persistence.ts) — so, as with evidence and deliverables,
-- scoping the policy to the first folder segment is enough.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets(id,name,public,file_size_limit)
      VALUES ('generated-filings','generated-filings',false,20971520)
      ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=20971520;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='SmartPR users manage own generated filings') THEN
      EXECUTE $policy$
        CREATE POLICY "SmartPR users manage own generated filings" ON storage.objects
        FOR ALL TO authenticated
        USING (bucket_id='generated-filings' AND (storage.foldername(name))[1]=auth.uid()::text)
        WITH CHECK (bucket_id='generated-filings' AND (storage.foldername(name))[1]=auth.uid()::text)
      $policy$;
    END IF;
  END IF;
END $$;

-- Official/municipal government form templates: canonical originals shared
-- across every tenant. These are never written or read by an end-user
-- request — only the offline `scripts/sync-template-library.ts` admin tool
-- (using the service-role key, which bypasses RLS entirely) touches them, and
-- the live app reads its working copies from local disk (see
-- forms/artifacts/templateLoader.ts). Deliberately no `authenticated` policy
-- is created here: with none, Storage RLS default-denies every anon/user
-- request against these buckets, which is the correct posture for a
-- service-role-only bucket. Create them private so a future accidental
-- policy addition starts from "nobody but the owner" rather than "public".
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets(id,name,public)
      VALUES ('official-form-templates','official-form-templates',false)
      ON CONFLICT (id) DO UPDATE SET public=false;
    INSERT INTO storage.buckets(id,name,public)
      VALUES ('municipal-form-templates','municipal-form-templates',false)
      ON CONFLICT (id) DO UPDATE SET public=false;
  END IF;
END $$;
