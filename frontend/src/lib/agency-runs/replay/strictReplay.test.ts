import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Skill } from "../skills/skill";
import { MemorySkillRepo } from "../skills/skillLibrary";
import { buildSkillFromTeach } from "../teach/buildSkill";
import { sanitizeTeachEvent } from "../teach/events";
import { sampleRecorderEvents, SAMPLE_PORTAL_URL } from "../teach/sampleRecording";
import { answerQuestion, applyTeachEvent, newTeachState, openQuestions } from "../teach/teachSession";
import {
  finishTeachSession,
  resetTeachSessionsForTests,
  saveTeachSession,
  startTeachSession,
  syncTeachSession,
  answerTeachQuestion,
  validateTeachSession,
  TeachSessionError,
  type TeachWorker,
} from "../teach/teachSessions";
import { listLearnedRoutines, routineForRow } from "../teach/learnedRoutines";
import { advanceReplay, newReplayState, type ReplayState } from "./engine";
import { agentRelocator, fuzzyRelocate, labelSimilarity } from "./relocate";
import { VirtualPortal } from "./virtualPortal";
import { planReplaySession, resetReplaysForTests, startReplaySession, continueReplaySession, type ReplayDeps } from "./replaySessions";

/** The skill a person teaches by recording the sample filing. */
function taughtSkill(): Skill {
  let state = newTeachState({ id: "t", ownerUserId: "u", tier: "user", portalName: "Portal de Permisos", form: "Permiso", startUrl: SAMPLE_PORTAL_URL });
  for (const e of sampleRecorderEvents()) {
    const ev = sanitizeTeachEvent(e);
    if (ev) state = applyTeachEvent(state, ev);
  }
  for (const q of openQuestions(state)) {
    state = answerQuestion(state, q.id, q.kind === "mapping" ? { kind: "mapping", choice: "confirm" } : { kind: "yes_no", value: "yes" });
  }
  return buildSkillFromTeach(state).skill;
}

const PASSPORT = { business: { legalName: "Panadería La Esquina LLC" }, contact: { email: "hola@laesquina.pr", phone: "787-555-0142" }, addresses: { municipality: "San Juan" } };

/** Run to the end, playing the human at every pause. Returns the pauses seen. */
async function drive(skill: Skill, portal: VirtualPortal, opts: { relocate?: Parameters<typeof agentRelocator>[0] | "fuzzy" | null; onDrift?: () => void } = {}) {
  const relocate = opts.relocate === "fuzzy" ? agentRelocator(null) : opts.relocate ? agentRelocator(opts.relocate) : undefined;
  let state: ReplayState = newReplayState(skill);
  const pauses: string[] = [];
  for (let i = 0; i < 30 && state.status !== "done"; i++) {
    state = await advanceReplay(state, { skill, passport: PASSPORT, driver: portal, relocate, onDrift: opts.onDrift });
    const p = state.pause;
    if (!p) break;
    pauses.push(p.kind === "gate" ? `gate:${p.gate}` : p.kind);
    if (p.kind === "gate" && p.gate === "submit") break;
    if (p.kind === "gate" || p.kind === "navigate") portal.humanAdvance();
    else break;
  }
  return { state, pauses };
}

function portalFor(skill: Skill, rename?: { from: string; to: string }): VirtualPortal {
  const portal = new VirtualPortal(skill, new Set(skill.steps.map((s) => s.id)));
  if (rename) for (const p of portal.pages) for (const c of p.controls) if (c.label === rename.from) c.label = rename.to;
  return portal;
}

describe("strict replay of a recorded routine", () => {
  it("replays exactly the recorded steps in order, pausing at sign-in and documents, stopping before submit", async () => {
    const skill = taughtSkill();
    const portal = portalFor(skill);
    const { state, pauses } = await drive(skill, portal);
    assert.deepEqual(pauses, ["gate:login", "gate:upload", "gate:submit"]);
    // Exactly the recorded clicks, in recorded order (Municipio = opening the recorded dropdown).
    assert.deepEqual(portal.clicks, ["Solicitar permiso", "Municipio", "Siguiente"]);
    assert.equal(portal.submitClicked, false);
    assert.ok(!portal.clicks.includes("Radicar solicitud"));
    assert.ok(!portal.clicks.includes("Continuar"), "the person moves on from the documents screen");
    assert.deepEqual(portal.filledLabels().sort(), ["Correo electrónico", "Municipio", "Nombre legal del negocio", "Teléfono"].sort());
    assert.ok(!JSON.stringify(state).includes("Panadería"), "the replay state carries labels, never values");
  });

  it("re-locates a control whose label drifted slightly (deterministic, one clear match)", async () => {
    const skill = taughtSkill();
    const portal = portalFor(skill, { from: "Nombre legal del negocio", to: "Nombre legal del negocio o entidad" });
    let drifted = 0;
    const { state, pauses } = await drive(skill, portal, { relocate: "fuzzy", onDrift: () => void drifted++ });
    assert.equal(drifted, 0);
    assert.deepEqual(pauses, ["gate:login", "gate:upload", "gate:submit"]);
    assert.ok(portal.filledLabels().includes("Nombre legal del negocio o entidad"));
    assert.ok(state.milestones.some((m) => /renamed/.test(m.text.en)));
  });

  it("pauses on drift (no improvising) when the control can't be matched, and reports it for Re-teach", async () => {
    const skill = taughtSkill();
    const portal = portalFor(skill, { from: "Nombre legal del negocio", to: "Razón social" });
    let drifted = 0;
    const { state, pauses } = await drive(skill, portal, { relocate: "fuzzy", onDrift: () => void drifted++ });
    assert.equal(drifted, 1);
    assert.equal(pauses.at(-1), "drift");
    assert.equal(state.status, "paused");
    assert.equal(state.pause?.kind === "drift" ? state.pause.reason : null, "control_not_found");
    assert.deepEqual(portal.filledLabels(), [], "nothing on that screen is touched");
  });

  it("without a relocator the engine pauses on the first drift (strict mode default)", async () => {
    const skill = taughtSkill();
    const portal = portalFor(skill, { from: "Nombre legal del negocio", to: "Nombre legal del negocio o entidad" });
    const { pauses } = await drive(skill, portal, {});
    assert.equal(pauses.at(-1), "drift");
  });

  it("the agent may only name one of the visible labels — never a submit control, never something new", async () => {
    const skill = taughtSkill();
    const ok = await drive(skill, portalFor(skill, { from: "Nombre legal del negocio", to: "Razón social" }), { relocate: async () => "Razón social" });
    assert.equal(ok.pauses.at(-1), "gate:submit");
    const invented = await drive(skill, portalFor(skill, { from: "Nombre legal del negocio", to: "Razón social" }), { relocate: async () => "Nombre comercial" });
    assert.equal(invented.pauses.at(-1), "drift");
    const relocate = agentRelocator(async () => "Radicar");
    assert.equal(await relocate({ role: "button", label: "Siguiente" }, ["Radicar", "Ayuda"]), null);
  });

  it("an unexpected screen pauses — Clara never improvises a path", async () => {
    const skill = taughtSkill();
    const portal = portalFor(skill);
    portal.pages[0].heading = "Portal en mantenimiento";
    portal.pages[0].url = "https://permisos.ejemplo.pr.gov/mantenimiento";
    let drifted = 0;
    const { pauses } = await drive(skill, portal, { relocate: "fuzzy", onDrift: () => void drifted++ });
    assert.equal(pauses[0], "drift");
    assert.equal(drifted, 1);
    assert.deepEqual(portal.clicks, []);
  });

  it("fuzzy matching needs one clear winner", () => {
    assert.ok(labelSimilarity("Nombre legal del negocio", "Nombre legal del negocio o entidad") >= 0.6);
    assert.equal(fuzzyRelocate({ role: "textbox", label: "Teléfono" }, ["Teléfono del negocio", "Teléfono del contacto"]), null);
    assert.equal(fuzzyRelocate({ role: "button", label: "Siguiente paso" }, ["Siguiente", "Enviar"]), null);
    assert.equal(fuzzyRelocate({ role: "button", label: "Continuar al pago" }, ["Continuar al pago ahora", "Ayuda"]), "Continuar al pago ahora");
  });
});

describe("record → validate → learned → strict replay on ANY portal", () => {
  beforeEach(() => {
    resetTeachSessionsForTests();
    resetReplaysForTests();
  });

  const events = sampleRecorderEvents("https://tramites.municipio-ejemplo.com/");
  const worker = (): TeachWorker => ({
    async start() { return { sessionId: "w1", liveUrl: null }; },
    async events(_id, after) { return { items: events.slice(after).map((event, i) => ({ seq: after + i + 1, event })), nextAfter: events.length, status: "running" }; },
    async stop() {},
  });

  it("only a validated recording becomes a learned routine for its requirement, and replays on its own portal", async () => {
    const repo = new MemorySkillRepo();
    const viewer = { userId: randomUUID(), isAdmin: true }; // admin: any https site may be taught
    const w = worker();
    let v = await startTeachSession({ worker: w }, { viewer, tier: "admin", businessId: null, passport: null, startUrl: "https://tramites.municipio-ejemplo.com/", portalName: "Trámites municipales", form: "Patente municipal", requirementKey: "req-patente" });
    v = await syncTeachSession({ worker: w }, viewer, v.id);
    assert.equal(v.actions.length, 17);
    for (const q of v.questions) v = answerTeachQuestion(viewer, v.id, q.id, q.kind === "mapping" ? { kind: "mapping", choice: "confirm" } : { kind: "yes_no", value: "yes" });
    await finishTeachSession({ worker: w }, viewer, v.id);
    await assert.rejects(saveTeachSession({ repo }, viewer, v.id, { submit: false, learn: true }), (e: unknown) => e instanceof TeachSessionError && e.code === "not_validated");
    const { validation } = await validateTeachSession(viewer, v.id);
    assert.equal(validation.status, "pass");
    const row = await saveTeachSession({ repo }, viewer, v.id, { submit: false, learn: true });

    const routines = await listLearnedRoutines(repo, viewer);
    assert.equal(routines.length, 1);
    assert.equal(routines[0].requirement_key, "req-patente");
    assert.equal(routines[0].portal_host, "tramites.municipio-ejemplo.com");
    assert.equal(routineForRow(routines, { key: "req-patente" })?.ref, row.id);
    assert.equal(routineForRow(routines, { key: "other" }), null);

    // Strict replay on that (non built-in) portal; the allowlist is the taught domain.
    const skill = (await repo.get(row.id))!.skill;
    const portal = new VirtualPortal(skill, new Set(skill.steps.map((s) => s.id)));
    const started: { startUrl: string; allowedDomains: string[] }[] = [];
    const deps: ReplayDeps = {
      repo,
      async startDrive(input) { started.push(input); return { sessionId: "d1", liveUrl: null }; },
      driver: () => portal,
      async stopDrive() {},
      relocate: agentRelocator(null),
    };
    const plan = await planReplaySession(deps, viewer, { ref: row.id, businessId: null, passport: PASSPORT });
    let r = await startReplaySession(deps, viewer, plan.id);
    assert.equal(started[0].startUrl, "https://tramites.municipio-ejemplo.com/");
    assert.ok(started[0].allowedDomains.includes("tramites.municipio-ejemplo.com"));
    assert.ok(started[0].allowedDomains.includes("*.tramites.municipio-ejemplo.com"));
    for (let i = 0; i < 6 && r.status !== "review"; i++) {
      portal.humanAdvance();
      r = await continueReplaySession(deps, viewer, plan.id);
    }
    assert.equal(r.status, "review");
    assert.equal(portal.submitClicked, false);
  });
});
