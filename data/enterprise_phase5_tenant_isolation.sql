-- ============================================================================
-- SmartPR Enterprise — Phase 5 hardening: tenant-isolate regulatory_impacts
-- Date: 2026-09-12
--
-- Background: regulatory_events may be workspace-scoped or GLOBAL
-- (workspace_id IS NULL, visible to every workspace). regulatory_impacts had
-- no workspace discriminator, so impact reads/mutations for a global event
-- could see or touch another workspace's impact rows (entity names, owners,
-- acknowledgment state).
--
-- This migration:
--   1. Adds regulatory_impacts.workspace_id.
--   2. Backfills it: the event's own workspace when the event is
--      workspace-scoped, otherwise the impacted entity's workspace chain.
--   3. Replaces the event-wide uniqueness (event_id, match_key) with
--      per-workspace uniqueness (event_id, workspace_id, match_key).
--
-- Safe to re-run (idempotent).
-- ============================================================================

ALTER TABLE regulatory_impacts
  ADD COLUMN IF NOT EXISTS workspace_id uuid;

-- Backfill: prefer the event's workspace (workspace-scoped events), else the
-- impacted entity's workspace chain (global events).
UPDATE regulatory_impacts i
   SET workspace_id = COALESCE(
         (SELECT re.workspace_id
            FROM regulatory_events re
           WHERE re.id = i.event_id),
         (SELECT b.workspace_id
            FROM obligations o
            JOIN businesses b ON b.id = o.business_id
           WHERE o.id = i.obligation_id),
         (SELECT b.workspace_id
            FROM businesses b
           WHERE b.id = i.business_id),
         (SELECT b.workspace_id
            FROM facilities f
            JOIN businesses b ON b.id = f.business_id
           WHERE f.id = i.facility_id),
         (SELECT m.workspace_id
            FROM matters m
           WHERE m.id = i.matter_id)
       )
 WHERE i.workspace_id IS NULL;

-- Per-workspace uniqueness replaces event-wide uniqueness.
DROP INDEX IF EXISTS uq_regulatory_impacts_event_match;
CREATE UNIQUE INDEX IF NOT EXISTS uq_regulatory_impacts_event_ws_match
  ON regulatory_impacts (event_id, workspace_id, match_key);

-- Fast tenant-scoped lookups for the API.
CREATE INDEX IF NOT EXISTS ix_regulatory_impacts_event_workspace
  ON regulatory_impacts (event_id, workspace_id);
