import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Skill } from "../skills/skill";
import { runSkillChecks, sanitizationCheck } from "../skills/reviewChecks";
import { virtualReplayCheck, VirtualPortal } from "./virtualPortal";
import { advanceReplay, newReplayState } from "./engine";
import { planReplay } from "./preflight";
import { applyProbeSignals } from "../skills/portalHealth";
import {
  MemorySkillRepo,
  approveSkill,
  getVisibleSkill,
  matchSkill,
  rejectSkill,
  reviewQueue,
  saveTaughtSkill,
  submitForReview,
  SkillLibraryError,
} from "../skills/skillLibrary";
import { continueReplaySession, findSkillFor, getReplaySession, planReplaySession, resetReplaysForTests, startReplaySession, ReplayError, type ReplayDeps } from "./replaySessions";
import { withTaughtSkill, resolveSubmissionPath } from "../submissionPaths";

const OGPE = JSON.parse(readFileSync(join(__dirname, "..", "skills", "ogpe.permiso_unico.v1.json"), "utf8")) as Skill;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** A small taught-style skill with a conditional screen. */
function branchy(): Skill {
  const s = clone(OGPE);
  s.skill_id = "permisos_ejemplo_pr_gov.permiso_de_uso";
  s.portal = { name: "Portal", base_url: "https://permisos.ejemplo.pr.gov/" };
  s.form = "Permiso de Uso";
  s.steps = [
    { id: "datos", label: { en: "Datos", es: "Datos" }, page_match: { title_contains: "Datos" }, observed: true, fallback: "pause_and_ask", actions: [{ type: "click", target: { role: "button", label_contains: "Continuar" }, fallback: "pause_and_ask" }], fields: [{ portal_field: { label: "Nombre legal", role: "textbox" }, passport_path: "business.legalName", transform: "trim", required: true, fallback: "pause_and_ask" }], branches: [{ when: { passport_has: "operations.employeeCount" }, goto_step: "empleados" }] },
    { id: "empleados", label: { en: "Empleados", es: "Empleados" }, page_match: { title_contains: "Empleados" }, observed: true, fallback: "pause_and_ask", actions: [{ type: "click", target: { role: "button", label_contains: "Seguir" }, fallback: "pause_and_ask" }], fields: [{ portal_field: { label: "Cantidad de empleados", role: "textbox" }, passport_path: "operations.employeeCount", transform: "trim", required: true, fallback: "pause_and_ask" }] },
    { id: "revision", label: { en: "Revisión", es: "Revisión" }, page_match: { title_contains: "Revisión" }, gate: "submit", observed: true, fallback: "pause_and_ask", actions: [], fields: [] },
  ];
  return s;
}

describe("review checks", () => {
  it("the OGPe v0 skill passes sanitization and the virtual replay check", async () => {
    const checks = await runSkillChecks(OGPE);
    assert.deepEqual(checks.sanitization.findings, []);
    assert.deepEqual(checks.replay.problems, []);
    assert.ok(checks.ok);
    assert.deepEqual(checks.replay.gatesPaused, ["login", "mfa", "parcel", "upload", "certification", "submit", "payment"]);
    assert.equal(checks.replay.submitClicked, false);
  });

  it("sanitization flags values, PII and non-passport paths", () => {
    const bad = clone(OGPE);
    const f = bad.steps.find((s) => s.fields.length)!.fields;
    f[1].portal_field.label = "Email marisol@laesquina.pr";
    f[2].portal_field.label = "Tel 787-555-0142";
    f[3].passport_path = "owner.ssnLastFour";
    const r = sanitizationCheck(bad);
    assert.equal(r.ok, false);
    assert.ok(r.findings.some((x) => /email/.test(x)));
    assert.ok(r.findings.some((x) => /long number/.test(x)));
    assert.ok(r.findings.some((x) => /not a Business Passport field/.test(x)));
  });

  it("the replay check fails a skill whose gate never pauses", async () => {
    const s = branchy();
    s.steps[2].page_match = { title_contains: "Revisión" };
    const portal = new VirtualPortal(s, new Set(["datos", "empleados", "revision"]));
    assert.equal(portal.pages.length, 3);
    const ok = await virtualReplayCheck(s);
    assert.ok(ok.ok, ok.problems.join("; "));
  });
});

describe("engine on a virtual portal", () => {
  it("skips a conditional screen when its branch doesn't fire for this business", async () => {
    const s = branchy();
    const portal = new VirtualPortal(s, new Set(["datos", "revision"])); // this business has no employees
    let st = newReplayState(s);
    st = await advanceReplay(st, { skill: s, passport: { business: { legalName: "Colmado Ortiz" } }, driver: portal });
    assert.equal(st.pause?.kind, "gate");
    assert.equal((st.pause as { gate: string }).gate, "submit");
    assert.deepEqual(st.done, ["datos"]);
  });

  it("expects the conditional screen when the branch fires", async () => {
    const s = branchy();
    const portal = new VirtualPortal(s, new Set(["datos", "empleados", "revision"]));
    const st = await advanceReplay(newReplayState(s), { skill: s, passport: { business: { legalName: "X" }, operations: { employeeCount: 4 } }, driver: portal });
    assert.deepEqual(st.done, ["datos", "empleados"]);
    assert.deepEqual(st.branchTargets, ["empleados"]);
  });

  it("asks for a required value the passport doesn't have instead of guessing", async () => {
    const s = branchy();
    const portal = new VirtualPortal(s, new Set(["datos", "revision"]));
    const st = await advanceReplay(newReplayState(s), { skill: s, passport: {}, driver: portal });
    assert.equal(st.pause?.kind, "ask");
    assert.equal((st.pause as { fields: { label: string }[] }).fields[0].label, "Nombre legal");
  });

  it("an unexpected screen when a conditional one was expected is drift", async () => {
    const s = branchy();
    const portal = new VirtualPortal(s, new Set(["datos", "revision"]));
    let drift = "";
    const st = await advanceReplay(newReplayState(s), { skill: s, passport: { business: { legalName: "X" }, operations: { employeeCount: 4 } }, driver: portal, onDrift: (d) => void (drift = d.reason) });
    // The portal skipped the employees screen this business should see.
    assert.equal(st.pause?.kind, "drift");
    assert.equal(drift, "unexpected_screen");
  });
});

describe("preflight plan", () => {
  it("counts fields from the passport, asks, missing values, branches and human steps — no values", () => {
    const passport = { business: { legalName: "Panadería La Esquina LLC" }, contact: { email: "m@x.pr" } };
    const plan = planReplay(OGPE, passport);
    assert.ok(plan.fromPassport.some((f) => f.field === "Nombre legal"));
    assert.deepEqual(plan.askEachTime.map((a) => a.field), ["Nombre del proyecto"]);
    assert.ok(plan.missingRequired.some((m) => m.field === "Teléfono de contacto"));
    assert.deepEqual([...new Set(plan.humanSteps.map((h) => h.gate))], ["login", "mfa", "parcel", "upload", "certification", "submit", "payment"]);
    assert.match(plan.summary.en, /I'll need you at: Sign in/);
    assert.doesNotMatch(JSON.stringify(plan), /Esquina|m@x\.pr/);
    const b = planReplay(branchy(), { operations: { employeeCount: 0 } });
    assert.deepEqual(b.branches, [{ screen: "Empleados", applies: false }]);
  });
});

describe("review and promote", () => {
  const admin = { userId: randomUUID(), isAdmin: true };
  const teacher = { userId: randomUUID(), isAdmin: false };
  const other = { userId: randomUUID(), isAdmin: false };

  it("private → checks → admin approval → shared v1, attributed; teacher's copy marked promoted", async () => {
    const repo = new MemorySkillRepo();
    const draft = await saveTaughtSkill(repo, teacher, branchy(), "partner");
    await submitForReview(repo, teacher, draft.id);
    assert.deepEqual((await reviewQueue(repo, admin)).map((r) => r.id), [draft.id]);
    await assert.rejects(reviewQueue(repo, teacher), (e: SkillLibraryError) => e.status === 403);
    await assert.rejects(approveSkill(repo, teacher, draft.id, { ok: true }), (e: SkillLibraryError) => e.status === 403);
    await assert.rejects(approveSkill(repo, admin, draft.id, { ok: false }), (e: SkillLibraryError) => e.code === "checks_failed");

    const checks = await runSkillChecks(draft.skill);
    assert.ok(checks.ok, JSON.stringify(checks));
    const shared = await approveSkill(repo, admin, draft.id, checks);
    assert.equal(shared.scope, "shared");
    assert.equal(shared.version, 1);
    assert.equal(shared.status, "approved");
    assert.equal(shared.owner_user_id, teacher.userId, "attributed to the teacher");
    assert.equal(shared.taught_by, "partner");
    assert.equal(shared.promoted_from, draft.id);
    assert.equal(shared.approved_by, admin.userId);
    // Now in the shared library for everyone, and it wins matching.
    assert.ok(await getVisibleSkill(repo, other, shared.id));
    assert.equal((await matchSkill(repo, other, "permisos.ejemplo.pr.gov", "Permiso de Uso"))?.id, shared.id);
    assert.equal((await repo.get(draft.id))?.status, "approved");

    // A second promotion becomes v2.
    const d2 = await saveTaughtSkill(repo, teacher, branchy(), "partner");
    await submitForReview(repo, teacher, d2.id);
    assert.equal((await approveSkill(repo, admin, d2.id, { ok: true })).version, 2);
  });

  it("rejected skills stay private with notes", async () => {
    const repo = new MemorySkillRepo();
    const d = await saveTaughtSkill(repo, teacher, branchy(), "user");
    await submitForReview(repo, teacher, d.id);
    const r = await rejectSkill(repo, admin, d.id, "El paso de empleados no aparece en el portal real.");
    assert.equal(r.status, "rejected");
    assert.equal(r.scope, "private");
    assert.equal(await getVisibleSkill(repo, other, d.id), null);
    assert.match((await getVisibleSkill(repo, teacher, d.id))?.review_notes ?? "", /empleados/);
  });

  it("an admin's shared draft is approved in place", async () => {
    const repo = new MemorySkillRepo();
    const d = await saveTaughtSkill(repo, admin, branchy(), "admin");
    const a = await approveSkill(repo, admin, d.id, { ok: true });
    assert.equal(a.id, d.id);
    assert.equal(a.status, "approved");
    assert.ok(await getVisibleSkill(repo, other, d.id));
  });
});

describe("portal health from the public probes", () => {
  it("drift flags the host; a later clean probe doesn't silently clear it", async () => {
    const repo = new MemorySkillRepo();
    await applyProbeSignals(repo, [{ url: "https://sbp.ogpe.pr.gov/", reachable: true, drift: true, driftDetail: "title changed" }]);
    assert.deepEqual(await repo.portalHealth("sbp.ogpe.pr.gov"), { status: "portal_changed", detail: "title changed" });
    await applyProbeSignals(repo, [{ url: "https://sbp.ogpe.pr.gov/", reachable: true, drift: false }]);
    assert.equal((await repo.portalHealth("sbp.ogpe.pr.gov"))?.status, "portal_changed");
    await applyProbeSignals(repo, [{ url: "https://suri.hacienda.pr.gov", reachable: false, drift: false }]);
    assert.equal((await repo.portalHealth("suri.hacienda.pr.gov"))?.status, "unreachable");
  });
});


describe("live replay sessions (server)", () => {
  const teacher = { userId: randomUUID(), isAdmin: false };
  const stranger = { userId: randomUUID(), isAdmin: false };

  function deps(repo: MemorySkillRepo, portal: VirtualPortal): ReplayDeps & { stopped: string[] } {
    const stopped: string[] = [];
    return { repo, stopped, startDrive: async () => ({ sessionId: "d1", liveUrl: "https://worker/vnc" }), driver: () => portal, stopDrive: async (id) => void stopped.push(id) };
  }

  it("plan → confirm → fills → review at submit; owner-only; no values in the view", async () => {
    resetReplaysForTests();
    const repo = new MemorySkillRepo();
    const row = await saveTaughtSkill(repo, teacher, branchy(), "user");
    const portal = new VirtualPortal(row.skill, new Set(["datos", "empleados", "revision"]));
    const d = deps(repo, portal);
    const passport = { business: { legalName: "Colmado Ortiz" }, operations: { employeeCount: 3 } };
    const planned = await planReplaySession(d, teacher, { ref: row.id, businessId: "b1", passport });
    assert.equal(planned.status, "planned");
    assert.equal(planned.skill.attribution, "you");
    await assert.rejects(planReplaySession(d, stranger, { ref: row.id, businessId: null, passport }), (e: ReplayError) => e.status === 404);
    assert.throws(() => getReplaySession(stranger, planned.id), (e: ReplayError) => e.status === 404);

    const started = await startReplaySession(d, teacher, planned.id);
    assert.equal(started.status, "review");
    assert.equal(started.pause?.kind, "gate");
    assert.doesNotMatch(JSON.stringify(started), /Colmado/);
    assert.equal(portal.submitClicked, false);
    portal.humanAdvance(); // the person submits
    const done = await continueReplaySession(d, teacher, planned.id);
    assert.equal(done.status, "done");
  });

  it("drift during a live replay marks the library skill needs_reteach and blocks new replays", async () => {
    resetReplaysForTests();
    const repo = new MemorySkillRepo();
    const row = await saveTaughtSkill(repo, teacher, branchy(), "user");
    const portal = new VirtualPortal(row.skill, new Set(["datos", "revision"])); // portal skips a screen this business needs
    const d = deps(repo, portal);
    const p = await planReplaySession(d, teacher, { ref: row.id, businessId: null, passport: { business: { legalName: "X" }, operations: { employeeCount: 2 } } });
    const r = await startReplaySession(d, teacher, p.id);
    assert.equal(r.pause?.kind, "drift");
    assert.equal((await repo.get(row.id))?.status, "needs_reteach");
    await assert.rejects(planReplaySession(d, teacher, { ref: row.id, businessId: null, passport: {} }), (e: ReplayError) => e.code === "needs_reteach");
  });

  it("matching: approved shared wins; unapproved bundled OGPe v0 isn't offered; own private is", async () => {
    const repo = new MemorySkillRepo();
    assert.equal(await findSkillFor(repo, teacher, { host: "sbp.ogpe.pr.gov", form: "OGPe — Permiso Único", filingTypeId: "OGPE_PERMISO_UNICO" }), null);
    const mine = await saveTaughtSkill(repo, teacher, branchy(), "user");
    assert.equal((await findSkillFor(repo, teacher, { host: "permisos.ejemplo.pr.gov", form: "Permiso de Uso" }))?.ref, mine.id);
    assert.equal(await findSkillFor(repo, stranger, { host: "permisos.ejemplo.pr.gov", form: "Permiso de Uso" }), null);
  });
});

describe("submission paths with taught skills", () => {
  it("an approved skill makes the path verified; a changed portal only adds a warning", () => {
    const base = resolveSubmissionPath("DOC_PERMISO_UNICO")!;
    assert.equal(withTaughtSkill(base, { version: 2, attribution: "smartpr", health: "ok" }).status, "verified");
    const warned = withTaughtSkill({ ...base, status: "partial" }, { version: 2, attribution: "smartpr", health: "portal_changed" });
    assert.equal(warned.status, "partial");
    assert.match(warned.reasonEn, /portal changed/);
    assert.equal(withTaughtSkill(base, null).skill, null);
  });
});
