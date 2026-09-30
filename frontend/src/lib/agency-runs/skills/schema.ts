// Clara skills table — appended to the idempotent runtime bootstrap
// (graph/store.ts applySchema) and mirrored in data/clara_skills_schema.sql
// (a test keeps the two in sync). Additive only.
//
// One row per skill version. Visibility (Teach Clara spec §7):
//   scope 'shared'  — the SmartPR library; readable by everyone once
//                     status = 'approved'. Only admins and the promote flow
//                     ever write shared rows.
//   scope 'private' — readable and writable only by owner_user_id.
// skill_json never holds entered values: it is validated by validateSkill
// before every insert/update.
export const CLARA_SKILLS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clara_skills (
  id UUID PRIMARY KEY,
  skill_id TEXT NOT NULL CHECK (skill_id ~ '^[a-z0-9_]+\\.[a-z0-9_]+$'),
  version INTEGER NOT NULL CHECK (version >= 1),
  scope TEXT NOT NULL CHECK (scope IN ('shared','private')),
  status TEXT NOT NULL CHECK (status IN ('draft','in_review','approved','rejected','needs_reteach')),
  taught_by TEXT NOT NULL CHECK (taught_by IN ('admin','partner','user')),
  owner_user_id UUID NOT NULL,
  portal_host TEXT NOT NULL,
  form TEXT NOT NULL,
  skill_json JSONB NOT NULL,
  review_notes TEXT,
  promoted_from UUID REFERENCES clara_skills(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clara_skills_owner ON clara_skills (owner_user_id, skill_id, version);
CREATE INDEX IF NOT EXISTS idx_clara_skills_match ON clara_skills (portal_host, scope, status);
-- A shared skill version number is unique across the library.
CREATE UNIQUE INDEX IF NOT EXISTS uq_clara_skills_shared_version ON clara_skills (skill_id, version) WHERE scope = 'shared';
-- A private skill version number is unique per owner.
CREATE UNIQUE INDEX IF NOT EXISTS uq_clara_skills_private_version ON clara_skills (owner_user_id, skill_id, version) WHERE scope = 'private';
`;
