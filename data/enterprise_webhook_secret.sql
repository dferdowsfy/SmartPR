-- =====================================================================
-- SmartPR Enterprise Phase 6 — webhook secret storage + delivery status.
-- Idempotent. Apply via the Supabase Management API.
--
-- 1. webhook_endpoints.secret_enc: AES-256-GCM encrypted signing secret.
--    Raw secrets are shown ONCE at creation/rotation and never stored.
-- 2. webhook_deliveries.status: add 'skipped' for inert demo URLs
--    (non-HTTPS, localhost, example.com, *.test, ...) which are recorded
--    but never sent.
-- =====================================================================

ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS secret_enc text;

DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'public.webhook_deliveries'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%status%'
   LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.webhook_deliveries DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_status_check
    CHECK (status IN ('pending','delivered','failed','disabled','skipped'));
EXCEPTION WHEN duplicate_object THEN
  -- Constraint already in the desired shape; nothing to do.
  NULL;
END $$;
