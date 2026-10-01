import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSkillFromTeach } from "./buildSkill";
import { sanitizeTeachEvent } from "./events";
import { normalizeRecorderItems } from "./recording";
import { sampleRecorderEvents, SAMPLE_PORTAL_URL } from "./sampleRecording";
import { answerQuestion, applyTeachEvent, newTeachState, openQuestions, type TeachState } from "./teachSession";
import { llmReviewRoutine, portalEntryCheck, routineRuleChecks, selectorUnstable, validateRoutine, withLlmNotes } from "./validateRoutine";

const u = (p: string) => new URL(p, SAMPLE_PORTAL_URL).toString();

function record(events: Record<string, unknown>[], opts: { answer?: boolean; startUrl?: string } = {}): { state: TeachState; actions: ReturnType<typeof normalizeRecorderItems> } {
  let state = newTeachState({ id: "t", ownerUserId: "u", tier: "user", portalName: "Portal", form: "Permiso", startUrl: opts.startUrl ?? SAMPLE_PORTAL_URL });
  for (const e of events) {
    const ev = sanitizeTeachEvent(e);
    if (ev) state = applyTeachEvent(state, ev);
  }
  if (opts.answer !== false) {
    for (const q of openQuestions(state)) {
      if (q.kind === "mapping") state = answerQuestion(state, q.id, q.proposal ? { kind: "mapping", choice: "confirm" } : { kind: "mapping", choice: "ask" });
      else if (q.kind === "branch") state = answerQuestion(state, q.id, { kind: "branch", notSure: true });
      else state = answerQuestion(state, q.id, { kind: "yes_no", value: "yes" });
    }
  }
  return { state, actions: normalizeRecorderItems(events.map((event, i) => ({ seq: i + 1, event })), []) };
}

async function validate(events: Record<string, unknown>[], opts?: Parameters<typeof record>[1]) {
  const { state, actions } = record(events, opts);
  return validateRoutine(state, buildSkillFromTeach(state).skill, actions);
}

const failed = (v: Awaited<ReturnType<typeof validate>>) => v.checks.filter((c) => !c.ok && c.severity === "error").map((c) => c.id);

describe("routine validation", () => {
  it("passes a complete recording: entry → sign-in → form → documents → review", async () => {
    const v = await validate(sampleRecorderEvents());
    assert.equal(v.status, "pass", JSON.stringify(v.checks.filter((c) => !c.ok)));
    assert.equal(v.errors, 0);
    assert.ok(v.checks.find((c) => c.id === "dry_run")!.ok);
    for (const c of v.checks) if (!c.ok) assert.ok(c.fix, `${c.id} carries a one-line fix`);
  });

  it("fails when the recording doesn't start at the portal entry", async () => {
    const v = await validate(sampleRecorderEvents().slice(6)); // starts on /solicitud/negocio
    assert.equal(v.status, "issues");
    assert.ok(failed(v).includes("starts_at_entry"));
    assert.match(v.checks.find((c) => c.id === "starts_at_entry")!.fix!.en, /start from the portal/);
  });

  it("fails when it stops before the review screen", async () => {
    const v = await validate(sampleRecorderEvents().slice(0, 12));
    assert.ok(failed(v).includes("ends_at_review"));
  });

  it("fails when a typed value isn't bound to a business field or 'ask each time'", async () => {
    const v = await validate(sampleRecorderEvents(), { answer: false });
    assert.ok(failed(v).includes("inputs_bound"));
    assert.ok(failed(v).includes("questions_done"));
    assert.match(v.checks.find((c) => c.id === "inputs_bound")!.fix!.en, /Ask each time/);
  });

  it("fails on accidental clicks and on a screen recorded twice", async () => {
    const ev = sampleRecorderEvents();
    const help = { kind: "click", url: u("/solicitud/negocio"), role: "link", label: "Ayuda", selector: "#ayuda" };
    const withHelp = [...ev.slice(0, 11), help, ...ev.slice(11)];
    assert.ok(failed(await validate(withHelp)).includes("no_accidental"));

    // Same screen twice in a row (reload with a different heading in between is not needed)
    const { state } = record(ev);
    const dup = JSON.parse(JSON.stringify(state)) as TeachState;
    const form = dup.steps.find((s) => s.id === "informacion-del-negocio")!;
    dup.steps.splice(dup.steps.indexOf(form) + 1, 0, { ...JSON.parse(JSON.stringify(form)), id: "informacion-del-negocio-2" });
    const checks = routineRuleChecks(dup, buildSkillFromTeach(dup).skill);
    assert.equal(checks.find((c) => c.id === "no_duplicates")!.ok, false);
  });

  it("fails when a sign-in or payment screen isn't a human pause", async () => {
    const { state } = record(sampleRecorderEvents());
    const s = JSON.parse(JSON.stringify(state)) as TeachState;
    s.steps.splice(3, 0, { id: "pago", url: u("/pago"), title: "", heading: "Pago de derechos", observed: true, gate: null, gateSource: null, conditional: null, fields: [], actions: [{ key: "ax", role: "button", label: "Siguiente", selector: "#s", optionText: "", decision: "nav" }], notes: [] });
    const checks = routineRuleChecks(s, buildSkillFromTeach(s).skill);
    const pm = checks.find((c) => c.id === "pauses_marked")!;
    assert.equal(pm.ok, false);
    assert.match(pm.fix!.en, /I do this part/);
  });

  it("flags unstable selectors; blocks only when the label can't find it either", () => {
    assert.equal(selectorUnstable("#nombre-legal"), false);
    assert.equal(selectorUnstable("#ember1234567"), true);
    assert.equal(selectorUnstable("div:nth-child(2) > div:nth-child(3) > span:nth-child(1) > input"), true);
    assert.equal(selectorUnstable(null), true);
    const { state } = record(sampleRecorderEvents());
    const s = JSON.parse(JSON.stringify(state)) as TeachState;
    const f = s.steps.find((x) => x.id === "informacion-del-negocio")!.fields[0];
    f.selector = "#ember1234567";
    let checks = routineRuleChecks(s, buildSkillFromTeach(s).skill);
    let c = checks.find((x) => x.id === "stable_selectors")!;
    assert.equal(c.ok, false);
    assert.equal(c.severity, "warning");
    f.label = "x";
    checks = routineRuleChecks(s, buildSkillFromTeach(s).skill);
    c = checks.find((x) => x.id === "stable_selectors")!;
    assert.equal(c.severity, "error");
  });

  it("the routine never contains the final submit, even though the teacher clicked it", async () => {
    const { state } = record(sampleRecorderEvents());
    const skill = buildSkillFromTeach(state).skill;
    const labels = skill.steps.flatMap((s) => s.actions.map((a) => a.target.label_contains));
    assert.ok(!labels.includes("Radicar solicitud"));
    assert.equal(skill.steps.at(-1)!.gate, "submit");
    // Clara never clicks past a human part (documents): no "Continuar" on the upload screen.
    assert.ok(!skill.steps.find((s) => s.gate === "upload")!.actions.length);
    assert.ok(!labels.includes("Continuar"));
  });

  it("LLM review is advisory: notes become warnings, never a failure; skipped without a model", async () => {
    const { state, actions } = record(sampleRecorderEvents());
    const base = await validateRoutine(state, buildSkillFromTeach(state).skill, actions);
    assert.deepEqual(await llmReviewRoutine(state, null), { status: "skipped", notes: [] });
    let prompt = "";
    const llm = await llmReviewRoutine(state, async (p) => {
      prompt = p.user;
      return '{"notes":[{"en":"Step 2 may be optional.","es":"El paso 2 puede ser opcional."}]}';
    });
    assert.ok(!/Panader|787-|@/.test(prompt), "the reviewer sees labels only");
    const v = withLlmNotes(base, llm);
    assert.equal(v.status, "pass");
    assert.equal(v.checks.find((c) => c.id === "llm_review")!.severity, "warning");
    assert.equal((await llmReviewRoutine(state, async () => "not json")).status, "error");
  });

  it("live entry check: opens the portal, sees the first screen, closes; fills nothing", async () => {
    const stopped: string[] = [];
    const calls: string[] = [];
    const drive = {
      async start() { return { sessionId: "d1" }; },
      driver: () => ({ async settle() { calls.push("settle"); }, async snapshot() { calls.push("snapshot"); return { url: SAMPLE_PORTAL_URL, title: "Portal", heading: "Bienvenido al Portal de Permisos", hasPassword: false }; } }),
      async stop(id: string) { stopped.push(id); },
    };
    const { state } = record(sampleRecorderEvents());
    const ok = await portalEntryCheck(drive, { startUrl: SAMPLE_PORTAL_URL, allowedDomains: ["permisos.ejemplo.pr.gov"], firstStep: state.steps[0] });
    assert.equal(ok.ok, true);
    assert.deepEqual(stopped, ["d1"]);
    assert.deepEqual(calls, ["settle", "snapshot"]);
    const elsewhere = await portalEntryCheck({ ...drive, driver: () => ({ async settle() {}, async snapshot() { return { url: "https://otro.pr.gov/x", title: "", heading: "Mantenimiento", hasPassword: false }; } }) }, { startUrl: SAMPLE_PORTAL_URL, allowedDomains: [], firstStep: state.steps[0] });
    assert.equal(elsewhere.ok, false);
  });
});
