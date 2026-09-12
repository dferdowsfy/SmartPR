-- ============================================================================
-- SmartPR Enterprise — Phase 8b: branding columns expected by the
-- /api/enterprise/branding route (tagline, support_email).
-- The route's SELECT list references these columns; they were never migrated,
-- which made the branding tab fail. Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE workspace_branding ADD COLUMN IF NOT EXISTS tagline TEXT;
ALTER TABLE workspace_branding ADD COLUMN IF NOT EXISTS support_email TEXT;
