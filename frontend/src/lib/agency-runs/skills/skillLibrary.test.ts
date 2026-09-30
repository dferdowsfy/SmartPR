/**
 * Skill library rules (Teach Clara spec §7), run against the in-memory repo
 * and — when SKILLS_TEST_DATABASE_URL names a Postgres server whose user may
 * CREATE DATABASE — against real Postgres with the production schema.
 *
 *   SKILLS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres \
 *     npx tsx --test src/lib/agency-runs/skills/skillLibrary.test.ts
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import type { Skill } from "./skill";
import { CLARA_SKILLS_SCHEMA_SQL } from "./schema";
import { splitSqlStatements } from "../../../app/graph/sqlStatements";
import {
  MemorySkillRepo,
  PgSkillRepo,
  SkillLibraryError,
  approveSkill,
  getVisibleSkill,
  listVisibleSkills,
  matchSkill,
  saveTaughtSkill,
  submitForReview,
  updateDraft,
  type SkillRepo,
} from "./skillLibrary";

const OGPE = JSON.parse(readFileSync(join(__dirname, "ogpe.permiso_unico.v1.json"), "utf8")) as Skill;
const ALICE = { userId: randomUUID(), isAdmin: false };
const BOB = { userId: randomUUID(), isAdmin: false };
const ADMIN = { userId: randomUUID(), isAdmin: true };

function suite(name: string, makeRepo: () => Promise<SkillRepo>) {
  describe(name, () => {
    let repo: SkillRepo;
    before(async () => {
      repo = await makeRepo();
    });

    it("a user's skill is private; another account can't see, match or edit it", async () => {
      const row = await saveTaughtSkill(repo, ALICE, OGPE, "user");
      assert.equal(row.scope, "private");
      assert.equal(row.status, "draft");
      assert.equal(row.skill.scope, "private");

      assert.ok(await getVisibleSkill(repo, ALICE, row.id));
      assert.equal(await getVisibleSkill(repo, BOB, row.id), null);
      assert.ok(!(await listVisibleSkills(repo, BOB)).some((r) => r.id === row.id));
      assert.equal(await matchSkill(repo, BOB, "sbp.ogpe.pr.gov", "Permiso Único"), null);
      assert.equal((await matchSkill(repo, ALICE, "sbp.ogpe.pr.gov", "permiso unico"))?.id, row.id);
      await assert.rejects(updateDraft(repo, BOB, row.id, OGPE), (e: SkillLibraryError) => e.status === 404);
      await assert.rejects(submitForReview(repo, BOB, row.id), (e: SkillLibraryError) => e.status === 404);
    });

    it("a client can't claim the shared library: scope follows the tier", async () => {
      const sneaky: Skill = { ...OGPE, scope: "shared", status: "approved", taught_by: "admin" };
      const row = await saveTaughtSkill(repo, BOB, sneaky, "partner");
      assert.equal(row.scope, "private");
      assert.equal(row.status, "draft");
      assert.equal(row.taught_by, "partner");
      assert.equal(await getVisibleSkill(repo, ALICE, row.id), null);
    });

    it("an admin's skill goes to the shared library as a draft, hidden until approved", async () => {
      const row = await saveTaughtSkill(repo, ADMIN, OGPE, "admin");
      assert.equal(row.scope, "shared");
      assert.equal(row.taught_by, "admin");
      assert.equal(await getVisibleSkill(repo, ALICE, row.id), null, "shared draft is not public");
      assert.ok(await getVisibleSkill(repo, { userId: randomUUID(), isAdmin: true }, row.id), "other admins see it");
    });

    it("drafts are editable by the owner; submitting locks them", async () => {
      const row = await saveTaughtSkill(repo, ALICE, OGPE, "user");
      const edited = await updateDraft(repo, ALICE, row.id, { ...OGPE, form: "Permiso Único (editado)" });
      assert.equal(edited.form, "Permiso Único (editado)");
      const submitted = await submitForReview(repo, ALICE, row.id);
      assert.equal(submitted.status, "in_review");
      assert.ok(submitted.submitted_at);
      await assert.rejects(updateDraft(repo, ALICE, row.id, OGPE), (e: SkillLibraryError) => e.code === "locked");
      await assert.rejects(submitForReview(repo, ALICE, row.id), (e: SkillLibraryError) => e.code === "locked");
      // Admins can now see it for review; other users still can't.
      assert.ok(await getVisibleSkill(repo, ADMIN, row.id));
      assert.equal(await getVisibleSkill(repo, BOB, row.id), null);
    });

    it("rejects a skill that fails validateSkill", async () => {
      const bad = structuredClone(OGPE);
      bad.gates = bad.gates.filter((g) => g.id !== "submit");
      await assert.rejects(saveTaughtSkill(repo, ALICE, bad, "user"), (e: SkillLibraryError) => e.status === 422);
    });

    it("promote: private → shared vN with checks and approver; portal health round-trips", async () => {
      const t = { userId: randomUUID(), isAdmin: false };
      const d = await saveTaughtSkill(repo, t, { ...OGPE, skill_id: "promo_test.permiso", form: "Formulario de prueba" }, "partner");
      await submitForReview(repo, t, d.id);
      const shared = await approveSkill(repo, ADMIN, d.id, { ok: true, note: "clean" } as { ok: boolean });
      const back = await repo.get(shared.id);
      assert.equal(back?.scope, "shared");
      assert.equal(back?.status, "approved");
      assert.equal(back?.owner_user_id, t.userId);
      assert.equal(back?.promoted_from, d.id);
      assert.equal(back?.approved_by, ADMIN.userId);
      assert.deepEqual(back?.checks, { ok: true, note: "clean" });
      assert.equal((await repo.get(d.id))?.status, "approved");
      await repo.setPortalHealth("sbp.ogpe.pr.gov", "portal_changed", "title changed");
      assert.deepEqual(await repo.portalHealth("sbp.ogpe.pr.gov"), { status: "portal_changed", detail: "title changed" });
    });

    it("versions per owner for private skills", async () => {
      const carol = { userId: randomUUID(), isAdmin: false };
      const a = await saveTaughtSkill(repo, carol, OGPE, "user");
      const b = await saveTaughtSkill(repo, carol, OGPE, "user");
      assert.equal(a.version, 1);
      assert.equal(b.version, 2);
      assert.equal((await matchSkill(repo, carol, "sbp.ogpe.pr.gov", "Permiso Único"))?.id, b.id);
    });
  });
}

suite("skill library (memory)", async () => new MemorySkillRepo());

const ADMIN_URL = process.env.SKILLS_TEST_DATABASE_URL;
if (ADMIN_URL) {
  if (process.env.SKILLS_TEST_SSL !== "1") process.env.PGSSL_DISABLE = "1";
  const dbName = `smartpr_skills_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  let admin: Pool;
  let pool: Pool;
  suite("skill library (postgres)", async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(ADMIN_URL);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString() });
    for (const statement of splitSqlStatements(CLARA_SKILLS_SCHEMA_SQL)) await pool.query(statement);
    return new PgSkillRepo(pool);
  });
  after(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await admin.end();
    }
  });
}

describe("clara_skills schema", () => {
  const migration = readFileSync(join(__dirname, "..", "..", "..", "..", "..", "data", "clara_skills_schema.sql"), "utf8");
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();

  it("every runtime statement is present verbatim in data/clara_skills_schema.sql", () => {
    for (const statement of splitSqlStatements(CLARA_SKILLS_SCHEMA_SQL)) {
      assert.ok(norm(migration).includes(norm(statement)), `missing from migration: ${statement.slice(0, 80)}`);
    }
  });

  it("is additive only", () => {
    for (const statement of splitSqlStatements(CLARA_SKILLS_SCHEMA_SQL)) {
      const body = statement.replace(/^(--[^\n]*\n|\s)*/, "");
      assert.match(body, /^(CREATE (TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS|ALTER TABLE clara_skills ADD COLUMN IF NOT EXISTS)\b/i, body.slice(0, 60));
    }
  });
});
