/**
 * Skill library — storage and visibility rules for taught skills
 * (Teach Clara spec §7). Repo-agnostic: `PgSkillRepo` in production,
 * `MemorySkillRepo` in tests and DB-less dev.
 *
 * Rules enforced here, whatever the client sends:
 *  - Tiering: an admin's skill goes to the shared library; everyone else's
 *    is private to their account. Nobody else ever writes a shared row.
 *  - Private skills are visible only to the account that taught them.
 *    Shared skills are visible to everyone once approved; admins see all
 *    shared rows plus private skills submitted for review.
 *  - Drafts are editable by their owner; submitting for review locks them.
 *  - Every insert/update must pass validateSkill.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Skill } from "./skill";
import { validateSkill } from "./skillValidate";
import { normalizeLabel } from "../teach/passportCatalog";

export interface StoredSkill {
  id: string;
  skill_id: string;
  version: number;
  scope: Skill["scope"];
  status: Skill["status"];
  taught_by: Skill["taught_by"];
  owner_user_id: string;
  portal_host: string;
  form: string;
  skill: Skill;
  review_notes: string | null;
  promoted_from: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillViewer {
  userId: string;
  isAdmin: boolean;
}

export interface SkillRepo {
  insert(row: StoredSkill): Promise<void>;
  update(id: string, patch: Partial<Omit<StoredSkill, "id" | "created_at">>): Promise<void>;
  get(id: string): Promise<StoredSkill | null>;
  /** Rows a viewer could possibly see — the library filters further. */
  listCandidates(filter: { ownerUserId?: string; includeShared?: boolean; includeInReview?: boolean; portalHost?: string }): Promise<StoredSkill[]>;
  maxVersion(skillId: string, scope: Skill["scope"], ownerUserId: string): Promise<number>;
}

export class SkillLibraryError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export function portalHost(skill: Skill): string {
  return new URL(skill.portal.base_url).hostname.replace(/^www\./, "");
}

export function canView(row: StoredSkill, viewer: SkillViewer): boolean {
  if (row.owner_user_id === viewer.userId) return true;
  if (row.scope === "shared" && row.status === "approved") return true;
  if (!viewer.isAdmin) return false;
  return row.scope === "shared" || row.status === "in_review";
}

function assertValid(skill: Skill): void {
  const errors = validateSkill(skill);
  if (errors.length) {
    throw new SkillLibraryError(422, "invalid_skill", errors.slice(0, 5).map((e) => `${e.path} ${e.message}`).join("; "));
  }
}

/** Save a newly taught skill as a draft under the viewer's tier. */
export async function saveTaughtSkill(repo: SkillRepo, viewer: SkillViewer, input: Skill, tier: Skill["taught_by"]): Promise<StoredSkill> {
  const scope: Skill["scope"] = viewer.isAdmin ? "shared" : "private";
  const taughtBy: Skill["taught_by"] = viewer.isAdmin ? "admin" : tier === "partner" ? "partner" : "user";
  const version = (await repo.maxVersion(input.skill_id, scope, viewer.userId)) + 1;
  const skill: Skill = { ...input, version, scope, status: "draft", taught_by: taughtBy };
  assertValid(skill);
  const now = nowIso();
  const row: StoredSkill = {
    id: randomUUID(),
    skill_id: skill.skill_id,
    version,
    scope,
    status: "draft",
    taught_by: taughtBy,
    owner_user_id: viewer.userId,
    portal_host: portalHost(skill),
    form: skill.form,
    skill,
    review_notes: null,
    promoted_from: null,
    submitted_at: null,
    created_at: now,
    updated_at: now,
  };
  await repo.insert(row);
  return row;
}

async function ownedDraft(repo: SkillRepo, viewer: SkillViewer, id: string): Promise<StoredSkill> {
  const row = await repo.get(id);
  if (!row || !canView(row, viewer)) throw new SkillLibraryError(404, "not_found", "Skill not found.");
  if (row.owner_user_id !== viewer.userId) throw new SkillLibraryError(403, "forbidden", "Only the person who taught this skill can change it.");
  if (row.status !== "draft") throw new SkillLibraryError(409, "locked", "This skill was submitted for review and can't be edited.");
  return row;
}

/** Replace an owned draft's content. Identity fields stay as stored. */
export async function updateDraft(repo: SkillRepo, viewer: SkillViewer, id: string, input: Skill): Promise<StoredSkill> {
  const row = await ownedDraft(repo, viewer, id);
  if (input.skill_id !== row.skill_id) throw new SkillLibraryError(422, "skill_id_changed", "A draft can't change which portal/form it is for.");
  const skill: Skill = { ...input, version: row.version, scope: row.scope, status: "draft", taught_by: row.taught_by };
  assertValid(skill);
  const updated_at = nowIso();
  await repo.update(id, { skill, form: skill.form, portal_host: portalHost(skill), updated_at });
  return { ...row, skill, form: skill.form, portal_host: portalHost(skill), updated_at };
}

/** Owner submits a draft for review; the draft is locked from then on. */
export async function submitForReview(repo: SkillRepo, viewer: SkillViewer, id: string): Promise<StoredSkill> {
  const row = await ownedDraft(repo, viewer, id);
  const skill: Skill = { ...row.skill, status: "in_review" };
  assertValid(skill);
  const now = nowIso();
  await repo.update(id, { status: "in_review", skill, submitted_at: now, updated_at: now });
  return { ...row, status: "in_review", skill, submitted_at: now, updated_at: now };
}

export async function getVisibleSkill(repo: SkillRepo, viewer: SkillViewer, id: string): Promise<StoredSkill | null> {
  const row = await repo.get(id);
  return row && canView(row, viewer) ? row : null;
}

export async function listVisibleSkills(repo: SkillRepo, viewer: SkillViewer): Promise<StoredSkill[]> {
  const rows = await repo.listCandidates({ ownerUserId: viewer.userId, includeShared: true, includeInReview: viewer.isAdmin });
  return rows.filter((r) => canView(r, viewer)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/**
 * The skill to replay for a portal + form, or null. Latest approved shared
 * version wins; otherwise the viewer's own latest private skill that isn't
 * rejected. (Phase 3 replay uses this; Phase 2 uses it to offer "Show Clara".)
 */
export async function matchSkill(repo: SkillRepo, viewer: SkillViewer, host: string, form: string): Promise<StoredSkill | null> {
  const h = host.replace(/^www\./, "").toLowerCase();
  const f = normalizeLabel(form);
  const rows = (await repo.listCandidates({ ownerUserId: viewer.userId, includeShared: true, portalHost: h }))
    .filter((r) => canView(r, viewer) && r.portal_host === h && normalizeLabel(r.form) === f);
  const byVersion = (a: StoredSkill, b: StoredSkill) => b.version - a.version;
  const shared = rows.filter((r) => r.scope === "shared" && r.status === "approved").sort(byVersion);
  if (shared[0]) return shared[0];
  const own = rows.filter((r) => r.owner_user_id === viewer.userId && r.status !== "rejected" && r.status !== "needs_reteach").sort(byVersion);
  return own[0] ?? null;
}

// --------------------------------------------------------------------------
// Repos
// --------------------------------------------------------------------------

export class MemorySkillRepo implements SkillRepo {
  rows = new Map<string, StoredSkill>();
  async insert(row: StoredSkill) {
    this.rows.set(row.id, structuredClone(row));
  }
  async update(id: string, patch: Partial<StoredSkill>) {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, structuredClone({ ...row, ...patch }));
  }
  async get(id: string) {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }
  async listCandidates(filter: { ownerUserId?: string; includeShared?: boolean; includeInReview?: boolean; portalHost?: string }) {
    return [...this.rows.values()]
      .filter((r) => !filter.portalHost || r.portal_host === filter.portalHost)
      .filter(
        (r) =>
          r.owner_user_id === filter.ownerUserId ||
          (filter.includeShared && r.scope === "shared") ||
          (filter.includeInReview && r.status === "in_review")
      )
      .map((r) => structuredClone(r));
  }
  async maxVersion(skillId: string, scope: Skill["scope"], ownerUserId: string) {
    return [...this.rows.values()]
      .filter((r) => r.skill_id === skillId && r.scope === scope && (scope === "shared" || r.owner_user_id === ownerUserId))
      .reduce((m, r) => Math.max(m, r.version), 0);
  }
}

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

function fromRow(r: Row): StoredSkill {
  return {
    id: String(r.id),
    skill_id: String(r.skill_id),
    version: Number(r.version),
    scope: r.scope as StoredSkill["scope"],
    status: r.status as StoredSkill["status"],
    taught_by: r.taught_by as StoredSkill["taught_by"],
    owner_user_id: String(r.owner_user_id),
    portal_host: String(r.portal_host),
    form: String(r.form),
    skill: r.skill_json as Skill,
    review_notes: (r.review_notes as string | null) ?? null,
    promoted_from: (r.promoted_from as string | null) ?? null,
    submitted_at: iso(r.submitted_at),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

const COLUMNS: (keyof StoredSkill)[] = [
  "skill_id", "version", "scope", "status", "taught_by", "owner_user_id", "portal_host", "form",
  "skill", "review_notes", "promoted_from", "submitted_at", "created_at", "updated_at",
];
const column = (k: keyof StoredSkill) => (k === "skill" ? "skill_json" : k);

export class PgSkillRepo implements SkillRepo {
  constructor(private pool: Pool) {}
  async insert(row: StoredSkill) {
    const cols = ["id", ...COLUMNS.map(column)];
    const values = [row.id, ...COLUMNS.map((k) => (k === "skill" ? JSON.stringify(row.skill) : row[k]))];
    await this.pool.query(
      `INSERT INTO clara_skills (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
      values
    );
  }
  async update(id: string, patch: Partial<StoredSkill>) {
    const keys = (Object.keys(patch) as (keyof StoredSkill)[]).filter((k) => COLUMNS.includes(k));
    if (!keys.length) return;
    const sets = keys.map((k, i) => `${column(k)} = $${i + 2}`);
    const values = keys.map((k) => (k === "skill" ? JSON.stringify(patch.skill) : patch[k]));
    await this.pool.query(`UPDATE clara_skills SET ${sets.join(", ")} WHERE id = $1`, [id, ...values]);
  }
  async get(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { rows } = await this.pool.query(`SELECT * FROM clara_skills WHERE id = $1`, [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }
  async listCandidates(filter: { ownerUserId?: string; includeShared?: boolean; includeInReview?: boolean; portalHost?: string }) {
    const { rows } = await this.pool.query(
      `SELECT * FROM clara_skills
        WHERE ($4::text IS NULL OR portal_host = $4)
          AND (owner_user_id = $1::uuid
               OR ($2::boolean AND scope = 'shared')
               OR ($3::boolean AND status = 'in_review'))
        ORDER BY updated_at DESC
        LIMIT 500`,
      [filter.ownerUserId ?? null, !!filter.includeShared, !!filter.includeInReview, filter.portalHost ?? null]
    );
    return rows.map(fromRow);
  }
  async maxVersion(skillId: string, scope: Skill["scope"], ownerUserId: string) {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(MAX(version), 0) AS v FROM clara_skills
        WHERE skill_id = $1 AND scope = $2 AND ($2 = 'shared' OR owner_user_id = $3::uuid)`,
      [skillId, scope, ownerUserId]
    );
    return Number(rows[0]?.v ?? 0);
  }
}
