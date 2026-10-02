/**
 * Teach Clara end to end, at the server-library level (the browser-level
 * test of the same journey is tests/teach-clara-workspace.e2e.mts):
 *
 *   requirement → teach session (worker probe) → live walkthrough →
 *   secure one-time input → Passport field binding → named save →
 *   routine retrieval → replay for a DIFFERENT business with its own
 *   Passport → missing Passport value asked → secure input at sign-in →
 *   review checkpoint (never submits) → portal drift → re-teach (v2).
 *
 * Plus: worker availability reasons, worker failures, sensitive-data
 * redaction (recorder events, screenshots, replay answers, portal errors),
 * EN/ES labels and the workspace link contract.
 */
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MemorySkillRepo } from "../skills/skillLibrary";
import { sanitizeTeachEvent } from "./events";
import { applyTeachEvent, newTeachState } from "./teachSession";
import { sampleRecorderEvents } from "./sampleRecording";
import {
  answerTeachQuestion,
  finishTeachSession,
  resetTeachSessionsForTests,
  saveTeachSession,
  secureFillTeach,
  startTeachSession,
  syncTeachSession,
  teachShot,
  validateTeachSession,
  TeachSessionError,
  type TeachWorker,
} from "./teachSessions";
import { listLearnedRoutines, removeRoutine, renameRoutine, routineForRow, summarizeRoutine } from "./learnedRoutines";
import { probeTeachWorker, resetTeachProbeForTests, teachBrowserProvider, TeachWorkerError } from "./teachWorkerClient";
import { defaultRoutineName, looksSensitiveLabel, replayPauseHeadline, secureCardFor, teachNarrative } from "./workspaceChat";
import { VirtualPortal } from "../replay/virtualPortal";
import type { PageSnapshot } from "../replay/engine";
import { agentRelocator } from "../replay/relocate";
import {
  continueReplaySession,
  getReplaySession,
  planReplaySession,
  resetReplaysForTests,
  secureInputReplay,
  startReplaySession,
  type ReplayDeps,
} from "../replay/replaySessions";
import { claraWorkspaceHref, parseClaraWorkspace } from "../../../app/components/clara/claraWorkspaceLink";
import { STANDARD_LABELS } from "../../../app/components/checklist/requirementActions";
import { teachClaraCta, learnedFillCta } from "../../../app/components/checklist/rowActionModel";

const PORTAL = "https://tramites.municipio-ejemplo.com/";
const PASSWORD = "S3creta-Clave!";
const SSN = "123-45-6789";
const BUSINESS_A = { business: { legalName: "Panadería La Esquina LLC" }, contact: { email: "hola@laesquina.pr", phone: "787-555-0142" }, addresses: { municipality: "San Juan" } };
// A different business, missing its phone in the Passport.
const BUSINESS_B = { business: { legalName: "Caribe Precision Manufacturing, LLC" }, contact: { email: "ops@caribeprecision.pr" }, addresses: { municipality: "Bayamón" } };

/** The sample walkthrough, with the sign-in screen reporting its password field. */
function walkthrough(): Record<string, unknown>[] {
  return sampleRecorderEvents(PORTAL).map((e) =>
    e.kind === "page" && e.hasPassword ? { ...e, secretFields: [{ label: "Contraseña", selector: "#clave", kind: "password" }] } : e
  );
}

function fakeWorker(events: Record<string, unknown>[], opts: { startError?: Error } = {}) {
  const typed: { sessionId: string; value: string; selector: string | null }[] = [];
  const worker: TeachWorker & { typed: typeof typed } = {
    typed,
    async start() {
      if (opts.startError) throw opts.startError;
      return { sessionId: "w1", liveUrl: "https://worker.example/vnc/vnc.html?token=VIEWER" };
    },
    async events(_id, after) {
      return {
        items: events.slice(after).map((event, i) => {
          const seq = after + i + 1;
          const secret = (event as { valueKind?: string }).valueKind === "secret";
          // seq 1 comes from a legacy worker: a direct URL carrying the viewer token.
          return seq === 1 ? { seq, event, screenshot: "https://worker.example/api/v4/teach/w1/shots/1?token=VIEWER" } : { seq, event, shot: !secret };
        }),
        nextAfter: events.length,
        status: "running",
      };
    },
    async stop() {},
    async secureFill(sessionId, input) {
      typed.push({ sessionId, ...input });
      return { ok: true };
    },
    async shot(_id, seq) {
      return new TextEncoder().encode(`jpeg-${seq}`).buffer as ArrayBuffer;
    },
  };
  return worker;
}

/** Virtual portal whose sign-in screen shows a password field. */
class PortalWithSignIn extends VirtualPortal {
  async snapshot(): Promise<PageSnapshot> {
    const snap = await super.snapshot();
    return snap.hasPassword ? { ...snap, secretFields: [{ label: "Contraseña", selector: "#clave", kind: "password" }] } : snap;
  }
}

const teacher = { userId: randomUUID(), isAdmin: true };

async function teach(repo: MemorySkillRepo, name: string) {
  const worker = fakeWorker(walkthrough());
  let v = await startTeachSession({ worker }, { viewer: teacher, tier: "admin", businessId: "biz-a", passport: BUSINESS_A, startUrl: PORTAL, portalName: "Municipio de Bayamón", form: "Patente Municipal", requirementKey: "req-patente-bayamon", agency: "Municipio de Bayamón" });
  v = await syncTeachSession({ worker }, teacher, v.id);
  return { worker, v };
}

describe("Teach Clara journey: teach once, replay for another business", () => {
  beforeEach(() => {
    resetTeachSessionsForTests();
    resetReplaysForTests();
  });

  it("records, binds Passport fields, takes a secure one-time password, saves a named routine and replays it for a different business", async () => {
    const repo = new MemorySkillRepo();
    const { worker, v: first } = await teach(repo, "Patente");
    let v = first;

    // Live walkthrough: one line per screen; sign-in is the person's part.
    assert.equal(v.actions.length, 17);
    const lines = teachNarrative(v.steps);
    assert.ok(lines.some((l) => /Información del negocio/.test(l.text.en) && /4 fields/.test(l.text.en)), JSON.stringify(lines.map((l) => l.text.en)));
    assert.ok(lines.some((l) => l.tone === "gate" && /sign-in/i.test(l.text.en)));
    assert.ok(lines.some((l) => l.tone === "stop" && /final submission/.test(l.text.en)));

    // Screenshots go through SmartPR's owner-gated proxy; the worker's viewer token never reaches the client.
    const shots = v.actions.map((a) => a.screenshot).filter(Boolean) as string[];
    assert.ok(shots.length > 0);
    assert.ok(shots.every((s) => /^\/api\/teach-sessions\/[\w-]+\/shots\/\d+$/.test(s)), shots.join(" "));
    assert.doesNotMatch(JSON.stringify({ ...v, live_url: null }), /token=|VIEWER|worker\.example/);
    // The sensitive (password) step kept no screenshot.
    assert.equal(v.actions.find((a) => a.valueKind === "secret")?.screenshot ?? null, null);
    assert.ok(await teachShot({ worker }, teacher, v.id, 2));
    assert.equal(await teachShot({ worker }, teacher, v.id, 999), null);

    // Secure one-time input: goes to the worker, nowhere else.
    assert.deepEqual(v.secret_fields, []); // the recording has moved past sign-in
    const before = JSON.stringify(v);
    const out = await secureFillTeach({ worker }, teacher, v.id, { value: PASSWORD, selector: "#not-a-reported-field" });
    assert.equal(out.ok, true);
    assert.equal(worker.typed.length, 1);
    assert.equal(worker.typed[0].value, PASSWORD);
    assert.equal(worker.typed[0].selector, null, "only a selector the recorder reported as sensitive is honored");
    v = await syncTeachSession({ worker }, teacher, v.id);
    assert.ok(!JSON.stringify(v).includes(PASSWORD));
    assert.equal(JSON.stringify(v).length, before.length);
    await assert.rejects(secureFillTeach({ worker }, { userId: randomUUID(), isAdmin: false }, v.id, { value: PASSWORD, selector: null }), (e: unknown) => e instanceof TeachSessionError && e.status === 404);

    // Passport binding: confirm Clara's proposals (stage = mapping while questions are open).
    assert.equal(v.stage, "mapping");
    for (const q of v.questions) v = answerTeachQuestion(teacher, v.id, q.id, q.kind === "mapping" ? { kind: "mapping", choice: "confirm" } : { kind: "yes_no", value: "yes" });
    const biz = v.steps.find((s) => /negocio/i.test(s.title))!;
    assert.deepEqual(biz.fields.map((f) => f.binding.kind === "passport" ? f.binding.path : f.binding.kind).sort(), ["addresses.municipality", "business.legalName", "contact.email", "contact.phone"].sort());

    await finishTeachSession({ worker }, teacher, v.id);
    const { validation } = await validateTeachSession(teacher, v.id);
    assert.equal(validation.status, "pass");
    const row = await saveTeachSession({ repo }, teacher, v.id, { submit: false, learn: true, name: "Patente Municipal — Bayamón" });

    // The saved routine: name, agency, requirement, portal, version, validation — and no values.
    const summary = summarizeRoutine(row, teacher)!;
    assert.equal(summary.name, "Patente Municipal — Bayamón");
    assert.equal(summary.agency, "Municipio de Bayamón");
    assert.equal(summary.requirement_key, "req-patente-bayamon");
    assert.equal(summary.portal_host, "tramites.municipio-ejemplo.com");
    assert.equal(summary.version, 1);
    assert.equal(summary.validation.status, "pass");
    const stored = JSON.stringify(await repo.get(row.id));
    for (const value of ["Panadería", "laesquina", "787-555", PASSWORD, "token=", "shots/"]) assert.ok(!stored.includes(value), `routine stores ${value}`);

    // Retrieval for the requirement.
    const routines = await listLearnedRoutines(repo, teacher);
    const routine = routineForRow(routines, { key: "req-patente-bayamon" })!;
    assert.equal(routine.ref, row.id);

    // Replay for business B with B's own Passport.
    const skill = (await repo.get(row.id))!.skill;
    const portal = new PortalWithSignIn(skill, new Set(skill.steps.map((s) => s.id)));
    const secure: { value: string; selector: string | null }[] = [];
    const deps: ReplayDeps = {
      repo,
      async startDrive() { return { sessionId: "d1", liveUrl: "https://worker.example/vnc/vnc.html?token=DRIVE" }; },
      driver: () => portal,
      async stopDrive() {},
      relocate: agentRelocator(null),
      async secureFill(_id, input) { secure.push(input); return { ok: true }; },
    };
    const plan = await planReplaySession(deps, teacher, { ref: routine.ref, businessId: "biz-b", passport: BUSINESS_B });
    assert.deepEqual(plan.plan.missingRequired.map((m) => m.field), ["Teléfono"], "preflight names the Passport value B is missing");
    let r = await startReplaySession(deps, teacher, plan.id);
    // Sign-in: a secure one-time card for the password field.
    assert.equal(r.pause?.kind, "gate");
    assert.deepEqual(r.secret_fields.map((f) => f.selector), ["#clave"]);
    assert.ok(secureCardFor(r.pause?.kind === "gate" ? r.pause.gate : null, r.secret_fields));
    assert.equal((await secureInputReplay(deps, teacher, plan.id, { value: PASSWORD, selector: "#clave" })).ok, true);
    assert.deepEqual(secure, [{ value: PASSWORD, selector: "#clave" }]);
    assert.ok(!JSON.stringify(getReplaySession(teacher, plan.id)).includes(PASSWORD));
    portal.humanAdvance();
    r = await continueReplaySession(deps, teacher, plan.id);
    // B has no phone on file: Clara fills what she has, then asks.
    assert.equal(r.pause?.kind, "ask");
    assert.deepEqual(r.pause?.kind === "ask" ? r.pause.fields.map((f) => f.label) : [], ["Teléfono"]);
    r = await continueReplaySession(deps, teacher, plan.id, { [r.pause!.kind === "ask" ? r.pause!.fields[0].key : ""]: "787-555-9999" });
    const filled = portal.pages.flatMap((p) => p.controls).filter((c) => c.value).map((c) => `${c.label}=${c.value}`);
    assert.ok(filled.includes("Nombre legal del negocio=Caribe Precision Manufacturing, LLC"), filled.join(" | "));
    assert.ok(filled.includes("Correo electrónico=ops@caribeprecision.pr"));
    assert.ok(filled.includes("Teléfono=787-555-9999"));
    assert.ok(!filled.some((f) => /Esquina|laesquina|787-555-0142/.test(f)), "never business A's values");
    assert.ok(!JSON.stringify(getReplaySession(teacher, plan.id)).includes("787-555-9999"), "answers aren't kept or shown");
    // Documents are the person's; then the review checkpoint — Clara never submits.
    for (let i = 0; i < 5 && r.status !== "review"; i++) {
      portal.humanAdvance();
      r = await continueReplaySession(deps, teacher, plan.id);
    }
    assert.equal(r.status, "review");
    assert.equal(r.pause?.kind === "gate" ? r.pause.gate : null, "submit");
    assert.equal(portal.submitClicked, false);
    assert.match(replayPauseHeadline(r.pause as never).text.en, /final submission is yours/);
    await assert.rejects(secureInputReplay(deps, teacher, plan.id, { value: PASSWORD, selector: null }), (e: unknown) => (e as { code?: string }).code === "not_paused");
  });

  it("portal drift stops the replay, marks the routine for re-teaching, and re-teaching saves version 2", async () => {
    const repo = new MemorySkillRepo();
    let { worker, v } = await teach(repo, "Patente");
    for (const q of v.questions) v = answerTeachQuestion(teacher, v.id, q.id, q.kind === "mapping" ? { kind: "mapping", choice: "confirm" } : { kind: "yes_no", value: "yes" });
    await finishTeachSession({ worker }, teacher, v.id);
    await validateTeachSession(teacher, v.id);
    const row = await saveTeachSession({ repo }, teacher, v.id, { submit: false, learn: true, name: "Patente" });
    const skill = row.skill;
    const portal = new VirtualPortal(skill, new Set(skill.steps.map((s) => s.id)));
    for (const p of portal.pages) for (const c of p.controls) if (c.label === "Nombre legal del negocio") c.label = "Razón social del contribuyente";
    const deps: ReplayDeps = { repo, async startDrive() { return { sessionId: "d", liveUrl: null }; }, driver: () => portal, async stopDrive() {}, relocate: agentRelocator(null) };
    const plan = await planReplaySession(deps, teacher, { ref: row.id, businessId: "biz-b", passport: BUSINESS_B });
    let r = await startReplaySession(deps, teacher, plan.id);
    portal.humanAdvance();
    r = await continueReplaySession(deps, teacher, plan.id);
    assert.equal(r.pause?.kind, "drift");
    assert.deepEqual(portal.filledLabels(), [], "nothing on the changed screen is touched");
    assert.equal((await listLearnedRoutines(repo, teacher))[0].status, "needs_reteach");
    await assert.rejects(planReplaySession(deps, teacher, { ref: row.id, businessId: "biz-b", passport: BUSINESS_B }), (e: unknown) => (e as { code?: string }).code === "needs_reteach");

    // Re-teach: a new version for the same requirement becomes the one used.
    ({ worker, v } = await teach(repo, "Patente"));
    for (const q of v.questions) v = answerTeachQuestion(teacher, v.id, q.id, q.kind === "mapping" ? { kind: "mapping", choice: "confirm" } : { kind: "yes_no", value: "yes" });
    await finishTeachSession({ worker }, teacher, v.id);
    await validateTeachSession(teacher, v.id);
    await saveTeachSession({ repo }, teacher, v.id, { submit: false, learn: true, name: "Patente v2" });
    const latest = routineForRow(await listLearnedRoutines(repo, teacher), { key: "req-patente-bayamon" })!;
    assert.equal(latest.version, 2);
    assert.equal(latest.status, "learned");
    assert.equal(latest.name, "Patente v2");
  });

  it("routines page: owner can rename and remove; others can't", async () => {
    const repo = new MemorySkillRepo();
    const taught = await teach(repo, "Patente");
    const worker = taught.worker;
    let v = taught.v;
    for (const q of v.questions) v = answerTeachQuestion(teacher, v.id, q.id, q.kind === "mapping" ? { kind: "mapping", choice: "confirm" } : { kind: "yes_no", value: "yes" });
    await finishTeachSession({ worker }, teacher, v.id);
    await validateTeachSession(teacher, v.id);
    const row = await saveTeachSession({ repo }, teacher, v.id, { submit: false, learn: true, name: "Patente" });
    const stranger = { userId: randomUUID(), isAdmin: false };
    await assert.rejects(renameRoutine(repo, stranger, row.id, "x"), (e: unknown) => (e as { status?: number }).status === 404);
    assert.equal((await renameRoutine(repo, teacher, row.id, "  Patente   Bayamón ")).name, "Patente Bayamón");
    assert.equal((await listLearnedRoutines(repo, teacher))[0].name, "Patente Bayamón");
    await assert.rejects(removeRoutine(repo, stranger, row.id));
    await removeRoutine(repo, teacher, row.id);
    assert.equal((await listLearnedRoutines(repo, teacher)).length, 0);
  });

  it("worker failures surface as specific errors", async () => {
    const start = (err: Error) =>
      startTeachSession({ worker: fakeWorker([], { startError: err }) }, { viewer: teacher, tier: "admin", businessId: null, passport: null, startUrl: PORTAL, portalName: "", form: "Patente" });
    await assert.rejects(start(new TeachWorkerError(409, "teach worker 409: pilot limit")), (e: unknown) => e instanceof TeachSessionError && e.code === "worker_busy" && e.status === 409);
    await assert.rejects(start(new TeachWorkerError(0, "teach worker unreachable")), (e: unknown) => e instanceof TeachSessionError && e.code === "worker_unreachable" && e.status === 503);
    await assert.rejects(start(new TeachWorkerError(401, "teach worker 401")), (e: unknown) => e instanceof TeachSessionError && e.code === "worker_unauthorized");
    const busy = await start(new TeachWorkerError(409, "x")).catch((e: TeachSessionError) => e);
    assert.match(JSON.stringify((busy as TeachSessionError).detail), /ocupado/, "Spanish message too");
  });
});

describe("Teach Clara worker availability probe (real connectivity, not just config)", () => {
  const env = { ...process.env };
  beforeEach(() => {
    resetTeachProbeForTests();
    process.env = { ...env, SELF_HOSTED_AGENT_URL: "https://worker.example", WORKER_API_TOKEN: "tok" };
    delete process.env.BROWSER_USE_API_KEY;
    delete process.env.TEACH_BROWSER_PROVIDER;
  });
  const caps = (body: Record<string, unknown>) => ({ teach: true, drive: true, secureFill: true, protocol: 2, browser: true, liveView: true, busy: false, ...body });
  const fetchWith = (health: number | "down", capsStatus: number, body: Record<string, unknown> = {}) =>
    (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/healthz")) {
        if (health === "down") throw new TypeError("fetch failed");
        return new Response("{}", { status: health });
      }
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tok");
      return new Response(JSON.stringify(caps(body)), { status: capsStatus });
    }) as typeof fetch;

  it("config: no Browser Use key and no worker", async () => {
    delete process.env.SELF_HOSTED_AGENT_URL;
    const p = await probeTeachWorker({ fresh: true, fetchImpl: fetchWith(200, 200) });
    assert.equal(p.reason, "config");
    assert.match(p.operator_hint ?? "", /BROWSER_USE_API_KEY/);
  });

  it("the provider used for agent runs doesn't matter — only the worker does", async () => {
    process.env.AGENT_PROVIDER = "browser_use_cloud";
    assert.equal((await probeTeachWorker({ fresh: true, fetchImpl: fetchWith(200, 200) })).ok, true);
  });

  for (const [name, f, reason] of [
    ["unreachable", fetchWith("down", 200), "unreachable"],
    ["unhealthy", fetchWith(502, 200), "unreachable"],
    ["wrong token", fetchWith(200, 401), "unauthorized"],
    ["old worker without capabilities", fetchWith(200, 404), "outdated"],
    ["old protocol", fetchWith(200, 200, { protocol: 1 }), "outdated"],
    ["browser can't launch", fetchWith(200, 200, { browser: false, browserError: "browser_launch_failed:Error" }), "no_browser"],
    ["no live view", fetchWith(200, 200, { liveView: false }), "no_live_view"],
  ] as const) {
    it(`${name} → ${reason}, with a bilingual message`, async () => {
      const p = await probeTeachWorker({ fresh: true, fetchImpl: f });
      assert.equal(p.ok, false);
      assert.equal(p.reason, reason);
      assert.ok(p.message?.en && p.message?.es);
      assert.ok(!JSON.stringify(p).includes("tok"), "never echoes the token");
    });
  }

  it("Browser Use Cloud: the app's BROWSER_USE_API_KEY is enough (no self-hosted worker needed)", async () => {
    delete process.env.SELF_HOSTED_AGENT_URL;
    delete process.env.WORKER_API_TOKEN;
    process.env.BROWSER_USE_API_KEY = "bu-key";
    const seen: string[] = [];
    const cloud = (status: number) =>
      (async (url: string | URL, init?: RequestInit) => {
        seen.push(String(url));
        assert.equal((init?.headers as Record<string, string>)["X-Browser-Use-API-Key"], "bu-key");
        return new Response("{}", { status });
      }) as typeof fetch;
    assert.equal(teachBrowserProvider(), "browser_use_cloud");
    assert.equal((await probeTeachWorker({ fresh: true, fetchImpl: cloud(200) })).ok, true);
    assert.match(seen[0], /api\.browser-use\.com\/api\/v2\/billing\/account$/);
    const bad = await probeTeachWorker({ fresh: true, fetchImpl: cloud(401) });
    assert.equal(bad.reason, "unauthorized");
    assert.match(bad.operator_hint ?? "", /BROWSER_USE_API_KEY/);
    assert.ok(!JSON.stringify(bad).includes("bu-key"));
    assert.equal((await probeTeachWorker({ fresh: true, fetchImpl: cloud(402) })).reason, "no_credits");
    // Both configured: Browser Use by default; TEACH_BROWSER_PROVIDER can force the worker.
    process.env.SELF_HOSTED_AGENT_URL = "https://worker.example";
    process.env.WORKER_API_TOKEN = "tok";
    assert.equal(teachBrowserProvider(), "browser_use_cloud");
    process.env.TEACH_BROWSER_PROVIDER = "self_hosted";
    assert.equal(teachBrowserProvider(), "self_hosted");
  });

  it("ok (and busy is reported, not treated as down)", async () => {
    const p = await probeTeachWorker({ fresh: true, fetchImpl: fetchWith(200, 200, { busy: true, browser: null }) });
    assert.equal(p.ok, true);
    assert.equal(p.busy, true);
  });
});

describe("sensitive-data redaction", () => {
  it("recorder events: sensitive fields are 'secret' with a kind, never a value; page events list them by label/selector", () => {
    const fill = sanitizeTeachEvent({ kind: "fill", url: `${PORTAL}x?ssn=${SSN}`, role: "textbox", label: "Seguro social", selector: "#ssn", inputType: "text", valueKind: "number", secretKind: "ssn", value: SSN });
    assert.equal(fill?.kind === "fill" ? fill.valueKind : null, "secret");
    assert.equal(fill?.kind === "fill" ? fill.secretKind : null, "ssn");
    assert.ok(!JSON.stringify(fill).includes("6789"));
    const page = sanitizeTeachEvent({ kind: "page", url: PORTAL, title: "t", heading: "h", secretFields: [{ label: "Código de verificación", selector: "#otp", kind: "code", value: "123456" }, { label: `SSN ${SSN}`, selector: `input[value="${SSN}"]`, kind: "weird" }] });
    assert.ok(page?.kind === "page");
    if (page?.kind === "page") {
      assert.deepEqual(page.secretFields[0], { label: "Código de verificación", selector: "#otp", kind: "code" });
      assert.equal(page.secretFields[1].selector, null);
      assert.equal(page.secretFields[1].kind, "password");
      assert.ok(!JSON.stringify(page).includes("6789") && !JSON.stringify(page).includes("123456"));
    }
    const pw = sanitizeTeachEvent({ kind: "fill", url: PORTAL, role: "textbox", label: "Clave", selector: "#c", inputType: "password", valueKind: "text" });
    assert.equal(pw?.kind === "fill" ? pw.secretKind : null, "password");
  });

  it("the kind of secret decides whose step it is: SSN → identity, code → MFA, password → sign-in", () => {
    const at = (secretKind: string) => {
      let st = newTeachState({ id: "t", ownerUserId: "u", tier: "user", portalName: "P", form: "F", startUrl: PORTAL });
      st = applyTeachEvent(st, sanitizeTeachEvent({ kind: "page", url: `${PORTAL}x`, title: "t", heading: "Pantalla" })!);
      st = applyTeachEvent(st, sanitizeTeachEvent({ kind: "fill", url: `${PORTAL}x`, role: "textbox", label: "Campo", selector: "#c", inputType: "text", valueKind: "text", secretKind })!);
      return st.steps.at(-1)?.gate;
    };
    assert.equal(at("ssn"), "identity");
    assert.equal(at("code"), "mfa");
    assert.equal(at("password"), "login");
    assert.equal(at("payment"), "payment");
  });

  it("workspace chat helpers: secure card for sign-in / code / SSN, never for payment; sensitive ask labels are masked", () => {
    assert.ok(secureCardFor("login", []));
    assert.ok(secureCardFor("mfa", []));
    assert.ok(secureCardFor(null, [{ label: "SSN", selector: "#s", kind: "ssn" }]));
    assert.equal(secureCardFor("payment", [{ label: "Card", selector: "#c", kind: "payment" }]), null);
    assert.equal(secureCardFor(null, [{ label: "Card", selector: "#c", kind: "payment" }]), null);
    assert.equal(secureCardFor("upload", []), null);
    assert.ok(looksSensitiveLabel("Número de seguro social"));
    assert.ok(looksSensitiveLabel("Verification code"));
    assert.ok(!looksSensitiveLabel("Código postal"));
    assert.ok(!looksSensitiveLabel("Teléfono"));
  });
});

describe("EN/ES labels and the workspace link", () => {
  it("rows say Teach Clara / Enséñale a Clara and Fill with Clara / Llenar con Clara", () => {
    const noop = () => undefined;
    assert.equal(teachClaraCta(noop, "en").label, "Teach Clara");
    assert.equal(teachClaraCta(noop, "es").label, "Enséñale a Clara");
    assert.equal(learnedFillCta(noop, "en").label, "Fill with Clara");
    assert.equal(learnedFillCta(noop, "es").label, "Llenar con Clara");
    assert.equal(STANDARD_LABELS.clara.es, "Llenar con Clara");
  });

  it("Teach Clara carries the requirement's context into the workspace (never business values)", () => {
    const href = claraWorkspaceHref("teach", "biz-1", { key: "MUNI-PATENTE-BAYAMON", name: "Patente Municipal (Bayamón)", agency: "Municipio de Bayamón", portalUrl: "https://bayamon.example.gov/patentes" }, { goal: "Renew the patente" });
    assert.match(href, /^\/businesses\/biz-1\/agency-run\?/);
    const ctx = parseClaraWorkspace(href.split("?")[1])!;
    assert.deepEqual(ctx, { mode: "teach", requirementKey: "MUNI-PATENTE-BAYAMON", name: "Patente Municipal (Bayamón)", agency: "Municipio de Bayamón", portalUrl: "https://bayamon.example.gov/patentes", goal: "Renew the patente", routineRef: null });
    assert.match(claraWorkspaceHref("teach", null, { key: "k", name: "n" }), /^\/businesses\/local-workspace\//);
    assert.equal(parseClaraWorkspace("mode=other&requirement=x"), null);
    assert.equal(parseClaraWorkspace("mode=fill&requirement=x&portal=javascript:alert(1)")?.portalUrl, null);
    assert.equal(defaultRoutineName({ name: "Patente", agency: "Municipio de Bayamón" }), "Patente — Municipio de Bayamón");
  });
});
