import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  answerTeachQuestion,
  finishTeachSession,
  markTeachStep,
  resetTeachSessionsForTests,
  saveTeachSession,
  startTeachSession,
  syncTeachSession,
  TeachSessionError,
  type TeachWorker,
} from "./teachSessions";
import { getVisibleSkill, listVisibleSkills, MemorySkillRepo } from "../skills/skillLibrary";
import { navigationAllowed, teachDomainDecision } from "./domains";

const URL0 = "https://permisos.ejemplo.pr.gov/";
const PASSPORT = { business: { legalName: "Panadería La Esquina LLC" }, contact: { phone: "787-555-0142" } };

function fakeWorker(script: unknown[]): TeachWorker & { stopped: string[]; started: { startUrl: string; allowedDomains: string[] }[] } {
  const stopped: string[] = [];
  const started: { startUrl: string; allowedDomains: string[] }[] = [];
  return {
    stopped,
    started,
    async start(input) {
      started.push(input);
      return { sessionId: `w${started.length}`, liveUrl: "https://worker.example/vnc/vnc.html?token=t" };
    },
    async events(_id, after) {
      const items = script.slice(after).map((event, i) => ({ seq: after + i + 1, event }));
      return { items, nextAfter: script.length, status: "running" };
    },
    async stop(id) {
      stopped.push(id);
    },
  };
}

const SCRIPT = [
  { kind: "page", url: `${URL0}login`, title: "Portal", heading: "Iniciar sesión", hasPassword: true },
  { kind: "fill", url: `${URL0}login`, role: "textbox", label: "Contraseña", selector: "#p", inputType: "password", valueKind: "text", value: "hunter2" },
  { kind: "page", url: `${URL0}app#datos`, title: "Portal", heading: "Datos — Panadería La Esquina LLC" },
  { kind: "fill", url: `${URL0}app#datos`, role: "textbox", label: "Nombre legal", selector: "#legal", inputType: "text", valueKind: "text" },
  { kind: "fill", url: `${URL0}app#datos`, role: "textbox", label: "Teléfono", selector: "#tel", inputType: "tel", valueKind: "phone" },
  { kind: "page", url: `${URL0}app#revision`, title: "Portal", heading: "Revisión" },
  { kind: "click", url: `${URL0}app#revision`, role: "button", label: "Radicar", selector: "#radicar", inputType: "button" },
];

const alice = { userId: randomUUID(), isAdmin: false };
const bob = { userId: randomUUID(), isAdmin: false };

describe("teach sessions (server)", () => {
  beforeEach(() => resetTeachSessionsForTests());

  it("records, asks, previews, and saves a private draft only the teacher can see", async () => {
    const worker = fakeWorker(SCRIPT);
    const repo = new MemorySkillRepo();
    const start = await startTeachSession({ worker }, { viewer: alice, tier: "user", businessId: "b1", passport: PASSPORT, startUrl: URL0, portalName: "", form: "Permiso de Uso" });
    assert.equal(start.status, "recording");
    assert.ok(worker.started[0].allowedDomains.includes("permisos.ejemplo.pr.gov"));

    let view = await syncTeachSession({ worker }, alice, start.id);
    assert.deepEqual(view.steps.map((s) => s.gate), ["login", null, "submit"]);
    assert.doesNotMatch(JSON.stringify(view), /Esquina|hunter2/, "view leaks passport or typed values");

    await assert.rejects(syncTeachSession({ worker }, bob, start.id), (e: TeachSessionError) => e.status === 404);

    for (const q of view.questions) {
      view = answerTeachQuestion(alice, start.id, q.id, q.kind === "mapping" ? { kind: "mapping", choice: "confirm" } : { kind: "yes_no", value: "yes" });
    }
    const preview = await finishTeachSession({ worker }, alice, start.id);
    assert.deepEqual(preview.blockers, []);
    assert.deepEqual(preview.errors, []);
    assert.equal(preview.card.counts.fromPassport, 2);
    assert.deepEqual(worker.stopped, ["w1"]);

    const row = await saveTeachSession({ repo }, alice, start.id, { submit: false });
    assert.equal(row.scope, "private");
    assert.equal(row.status, "draft");
    assert.ok(await getVisibleSkill(repo, alice, row.id));
    assert.equal(await getVisibleSkill(repo, bob, row.id), null);
    assert.equal((await listVisibleSkills(repo, bob)).length, 0);
    assert.doesNotMatch(JSON.stringify(row.skill), /Esquina|hunter2|787/);
    await assert.rejects(saveTeachSession({ repo }, alice, start.id, { submit: false }), (e: TeachSessionError) => e.code === "saved");
  });

  it("submit-for-review locks the saved draft", async () => {
    const worker = fakeWorker(SCRIPT);
    const repo = new MemorySkillRepo();
    const s = await startTeachSession({ worker }, { viewer: alice, tier: "user", businessId: null, passport: null, startUrl: URL0, portalName: "Portal", form: "Permiso de Uso" });
    let view = await syncTeachSession({ worker }, alice, s.id);
    for (const q of view.questions) view = answerTeachQuestion(alice, s.id, q.id, q.kind === "mapping" ? { kind: "mapping", choice: "ask" } : { kind: "yes_no", value: "not_sure" });
    await finishTeachSession({ worker }, alice, s.id);
    const row = await saveTeachSession({ repo }, alice, s.id, { submit: true });
    assert.equal(row.status, "in_review");
  });

  it("won't save with open questions or while still recording", async () => {
    const worker = fakeWorker(SCRIPT);
    const repo = new MemorySkillRepo();
    const s = await startTeachSession({ worker }, { viewer: alice, tier: "user", businessId: null, passport: null, startUrl: URL0, portalName: "Portal", form: "X" });
    await syncTeachSession({ worker }, alice, s.id);
    await assert.rejects(saveTeachSession({ repo }, alice, s.id, { submit: false }), (e: TeachSessionError) => e.code === "still_recording");
    await finishTeachSession({ worker }, alice, s.id);
    await assert.rejects(saveTeachSession({ repo }, alice, s.id, { submit: false }), (e: TeachSessionError) => e.code === "not_ready");
  });

  it("an admin's taught skill lands in the shared library", async () => {
    const admin = { userId: randomUUID(), isAdmin: true };
    const worker = fakeWorker(SCRIPT);
    const repo = new MemorySkillRepo();
    const s = await startTeachSession({ worker }, { viewer: admin, tier: "user", businessId: null, passport: null, startUrl: URL0, portalName: "Portal", form: "Permiso de Uso" });
    let view = await syncTeachSession({ worker }, admin, s.id);
    for (const q of view.questions) view = answerTeachQuestion(admin, s.id, q.id, q.kind === "mapping" ? { kind: "mapping", choice: "confirm" } : { kind: "yes_no", value: "yes" });
    await finishTeachSession({ worker }, admin, s.id);
    const row = await saveTeachSession({ repo }, admin, s.id, { submit: true });
    assert.equal(row.scope, "shared");
    assert.equal(row.taught_by, "admin");
    assert.equal(row.status, "draft", "admin skills aren't sent to the user review queue");
  });

  it("lets the teacher add a screen they skipped and mark gates", async () => {
    const worker = fakeWorker(SCRIPT.slice(0, 5));
    const s = await startTeachSession({ worker }, { viewer: alice, tier: "user", businessId: null, passport: null, startUrl: URL0, portalName: "Portal", form: "X" });
    await syncTeachSession({ worker }, alice, s.id);
    const view = markTeachStep(alice, s.id, { addStep: { title: "Pago", gate: "payment" } });
    const pago = view.steps.at(-1)!;
    assert.equal(pago.gate, "payment");
    assert.equal(pago.observed, false);
  });

  it("starting a new recording stops the teacher's previous one", async () => {
    const worker = fakeWorker([]);
    await startTeachSession({ worker }, { viewer: alice, tier: "user", businessId: null, passport: null, startUrl: URL0, portalName: "P", form: "A" });
    await startTeachSession({ worker }, { viewer: alice, tier: "user", businessId: null, passport: null, startUrl: URL0, portalName: "P", form: "B" });
    assert.deepEqual(worker.stopped, ["w1"]);
  });
});

describe("where Clara may learn", () => {
  it("allows government sites for everyone", () => {
    const d = teachDomainDecision("https://sbp.ogpe.pr.gov/", { isAdmin: false, approvedHosts: [] });
    assert.ok(d.ok && d.basis === "government");
    assert.ok(teachDomainDecision("https://www.irs.gov/", { isAdmin: false, approvedHosts: [] }).ok);
  });
  it("requires approval for other sites; an admin teaching is the approval", () => {
    const denied = teachDomainDecision("https://municipio-ejemplo.com/", { isAdmin: false, approvedHosts: [] });
    assert.ok(!denied.ok && denied.reason === "not_approved");
    assert.ok(teachDomainDecision("https://pagos.municipio-ejemplo.com/", { isAdmin: false, approvedHosts: ["municipio-ejemplo.com"] }).ok);
    const admin = teachDomainDecision("https://municipio-ejemplo.com/", { isAdmin: true, approvedHosts: [] });
    assert.ok(admin.ok && admin.basis === "admin");
  });
  it("refuses http, IPs and localhost", () => {
    for (const u of ["http://sbp.ogpe.pr.gov/", "https://127.0.0.1/", "https://localhost/", "nope"]) {
      assert.equal(teachDomainDecision(u, { isAdmin: true, approvedHosts: [] }).ok, false, u);
    }
  });
  it("keeps navigation on the site and government sign-in hosts", () => {
    const d = teachDomainDecision("https://municipio-ejemplo.com/", { isAdmin: true, approvedHosts: [] });
    assert.ok(d.ok);
    if (!d.ok) return;
    assert.ok(navigationAllowed("https://municipio-ejemplo.com/x", d.allowedDomains));
    assert.ok(navigationAllowed("https://login.municipio-ejemplo.com/", d.allowedDomains));
    assert.ok(navigationAllowed("https://login.pr.gov/", d.allowedDomains));
    assert.ok(!navigationAllowed("https://evil.example/", d.allowedDomains));
  });
});
