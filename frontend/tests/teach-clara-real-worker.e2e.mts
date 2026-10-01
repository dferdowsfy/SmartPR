/**
 * Teach Clara against a REAL browser worker (workers/browser-agent) — no
 * mocked worker. Proves the recorder path end to end: SmartPR's probe →
 * worker launches Chromium with the recorder injected → events flow back →
 * sanitization + teach session → secure one-time input typed by the worker
 * → screenshots proxied without the viewer token → named save → strict
 * replay on the real drive endpoints for a DIFFERENT business (its own
 * Passport) → secure input at sign-in / SSN → review checkpoint, never
 * submitted.
 *
 * Needs: the worker running (SELF_HOSTED_AGENT_URL, WORKER_API_TOKEN) and the
 * fixture portal tests/fixtures/teach-portal/server.py reachable as
 * https://permisos-prueba.pr.gov/ from the worker (see that file). This is a
 * local integration run; it says nothing about a deployed worker.
 *
 *   SELF_HOSTED_AGENT_URL=http://127.0.0.1:8765 WORKER_API_TOKEN=… npx tsx tests/teach-clara-real-worker.e2e.mts
 */
import { randomUUID } from "node:crypto";
import { MemorySkillRepo } from "../src/lib/agency-runs/skills/skillLibrary";
import {
  answerTeachQuestion,
  finishTeachSession,
  saveTeachSession,
  secureFillTeach,
  startTeachSession,
  syncTeachSession,
  teachShot,
  validateTeachSession,
  type TeachSessionView,
} from "../src/lib/agency-runs/teach/teachSessions";
import { fetchWorkerTeachEvents, fetchWorkerTeachShot, probeTeachWorker, secureFillWorker, startWorkerTeach, stopWorkerTeach } from "../src/lib/agency-runs/teach/teachWorkerClient";
import { listLearnedRoutines, routineForRow } from "../src/lib/agency-runs/teach/learnedRoutines";
import { startWorkerDrive, stopWorkerDrive, WorkerDriver } from "../src/lib/agency-runs/replay/workerDriver";
import { agentRelocator } from "../src/lib/agency-runs/replay/relocate";
import { continueReplaySession, planReplaySession, secureInputReplay, startReplaySession, stopReplaySession, type ReplayDeps } from "../src/lib/agency-runs/replay/replaySessions";

const PORTAL = "https://permisos-prueba.pr.gov/";
const PASSWORD = "Cl4ve-Secreta!";
const SSN = "123-45-6789";
const A = { business: { legalName: "Panaderia La Esquina LLC" }, contact: { email: "hola@laesquina.pr", phone: "787-555-0142" }, addresses: { municipality: "San Juan" } };
const B = { business: { legalName: "Caribe Precision Manufacturing LLC" }, contact: { email: "ops@caribeprecision.pr" }, addresses: { municipality: "Bayamón" } };

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The fixture portal is a test host mapped to 127.0.0.1 (self-signed): this process talks to it directly.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const portal = async (path: string) => (await fetch(`${PORTAL}${path.replace(/^\//, "")}`)).text();

const worker = { start: startWorkerTeach, events: fetchWorkerTeachEvents, stop: stopWorkerTeach, secureFill: secureFillWorker, shot: fetchWorkerTeachShot };
const viewer = { userId: randomUUID(), isAdmin: false };

const probe = await probeTeachWorker({ fresh: true });
check("probe: real worker reachable, authorized, browser launches, live view wired", probe.ok, JSON.stringify({ reason: probe.reason, hint: probe.operator_hint }));
if (!probe.ok) process.exit(1);

await portal("__mode?set=teach");
let v: TeachSessionView = await startTeachSession({ worker }, { viewer, tier: "user", businessId: "biz-a", passport: A, startUrl: PORTAL, portalName: "Municipio (prueba)", form: "Patente Municipal", requirementKey: "MUNI-PATENTE", agency: "Municipio (prueba)" });
check("teach session started on the real worker", v.status === "recording" && Boolean(v.live_url), String(v.live_url));

async function until(pred: (v: TeachSessionView) => boolean, label: string, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    v = await syncTeachSession({ worker }, viewer, v.id);
    if (pred(v)) return true;
    await sleep(700);
  }
  check(`reached: ${label}`, false, JSON.stringify(v.steps.map((s) => s.title)));
  return false;
}

// The fixture "person" opens the sign-in screen; the password comes through the secure card.
await until((x) => x.secret_fields.some((f) => f.kind === "password"), "sign-in screen with a password field");
check("sign-in screen: current gate is the person's (login)", v.current_gate === "login", String(v.current_gate));
const sent = await secureFillTeach({ worker }, viewer, v.id, { value: PASSWORD, selector: v.secret_fields.find((f) => f.kind === "password")!.selector });
check("secure one-time password typed into the portal by the worker", sent.ok, JSON.stringify(sent));
await until((x) => x.secret_fields.some((f) => f.kind === "ssn"), "identity screen with an SSN field");
const sentSsn = await secureFillTeach({ worker }, viewer, v.id, { value: SSN, selector: v.secret_fields.find((f) => f.kind === "ssn")!.selector });
check("secure one-time SSN typed into the portal by the worker", sentSsn.ok);
await until((x) => x.steps.some((s) => /Revisi/.test(s.title)), "review screen", 40000);
await sleep(1500);
v = await syncTeachSession({ worker }, viewer, v.id);

const observed = JSON.parse(await portal("__state")).observed as Record<string, string>;
check("the portal received the password and SSN (length only in this log)", observed.clave === `len:${PASSWORD.length}` && observed.ssn === `len:${SSN.length}`, JSON.stringify(observed));
const viewJson = JSON.stringify({ ...v, live_url: null });
for (const secret of [PASSWORD, SSN, "6789", "marisol.r", "La Esquina", "787-555-0142", "hola@laesquina.pr", "token="]) {
  check(`teach session view never contains "${secret}"`, !viewJson.includes(secret));
}
const shotPaths = v.actions.map((a) => a.screenshot).filter(Boolean) as string[];
check("per-step screenshots exist, as SmartPR proxy paths (no worker token)", shotPaths.length > 0 && shotPaths.every((p) => p.startsWith("/api/teach-sessions/")), shotPaths.slice(0, 2).join(" "));
const firstSeq = Number(shotPaths[0]?.split("/").at(-1));
const bytes = firstSeq ? await teachShot({ worker }, viewer, v.id, firstSeq) : null;
check("a screenshot is fetched from the worker server-side with the bearer token", Boolean(bytes && bytes.byteLength > 1000), String(bytes?.byteLength));
check("no screenshot kept for the sensitive steps", v.actions.filter((a) => a.valueKind === "secret").every((a) => !a.screenshot), JSON.stringify(v.actions.filter((a) => a.valueKind === "secret").map((a) => a.label)));
check("walkthrough: one step per screen (welcome, sign-in, identity, business, review)", v.steps.length >= 5, v.steps.map((s) => `${s.title}:${s.gate ?? "-"}`).join(" | "));
check("sign-in and identity screens are the person's", v.steps.some((s) => s.gate === "login") && v.steps.some((s) => s.gate === "identity"));

// Passport binding.
for (const q of v.questions) v = answerTeachQuestion(viewer, v.id, q.id, q.kind === "mapping" ? (q.proposal ? { kind: "mapping", choice: "confirm" } : { kind: "mapping", choice: "ask" }) : { kind: "yes_no", value: "yes" });
const biz = v.steps.find((s) => /negocio/i.test(s.title));
const bound = biz?.fields.map((f) => `${f.label}→${f.binding.kind === "passport" ? f.binding.path : f.binding.kind}`) ?? [];
check("business screen fields bound to Passport fields", bound.length === 4 && bound.every((b) => /→(business|contact|addresses)\./.test(b)), bound.join(", "));

await finishTeachSession({ worker }, viewer, v.id);
const { validation } = await validateTeachSession(viewer, v.id);
check("validation passes", validation.status === "pass", JSON.stringify(validation.checks.filter((c) => !c.ok).map((c) => c.id)));
const repo = new MemorySkillRepo();
const row = await saveTeachSession({ repo }, viewer, v.id, { submit: false, learn: true, name: "Patente municipal (prueba)" });
const stored = JSON.stringify(row);
check("saved routine has no entered values or secrets", ![PASSWORD, SSN, "La Esquina", "787-555", "laesquina", "token="].some((s) => stored.includes(s)));
const routine = routineForRow(await listLearnedRoutines(repo, viewer), { key: "MUNI-PATENTE" });
check("routine retrieved for the requirement, named and versioned", routine?.name === "Patente municipal (prueba)" && routine.version === 1, JSON.stringify(routine));

// Replay for business B on the real drive endpoints.
await portal("__mode?set=replay");
await sleep(500);
const deps: ReplayDeps = { repo, startDrive: startWorkerDrive, stopDrive: stopWorkerDrive, driver: (id) => new WorkerDriver(id), relocate: agentRelocator(null), secureFill: secureFillWorker };
const plan = await planReplaySession(deps, viewer, { ref: routine!.ref, businessId: "biz-b", passport: B });
check("preflight names B's missing Passport value (phone)", plan.plan.missingRequired.some((m) => m.field === "Teléfono"), JSON.stringify(plan.plan.missingRequired));
let r = await startReplaySession(deps, viewer, plan.id);
check("replay pauses at sign-in with the password field for a secure card", r.pause?.kind === "gate" && r.secret_fields.some((f) => f.kind === "password"), JSON.stringify({ pause: r.pause, sf: r.secret_fields }));
await secureInputReplay(deps, viewer, plan.id, { value: PASSWORD, selector: r.secret_fields.find((f) => f.kind === "password")?.selector ?? null });
await sleep(2500);
r = await continueReplaySession(deps, viewer, plan.id);
check("replay pauses at the identity (SSN) screen", r.pause?.kind === "gate" && r.pause.gate === "identity", JSON.stringify(r.pause));
await secureInputReplay(deps, viewer, plan.id, { value: SSN, selector: r.secret_fields.find((f) => f.kind === "ssn")?.selector ?? null });
await sleep(2500);
r = await continueReplaySession(deps, viewer, plan.id);
check("B's missing phone is asked for", r.pause?.kind === "ask" && r.pause.fields.some((f) => f.label === "Teléfono"), JSON.stringify(r.pause));
if (r.pause?.kind === "ask") r = await continueReplaySession(deps, viewer, plan.id, { [r.pause.fields[0].key]: "787-555-0199" });
for (let i = 0; i < 4 && r.status !== "review"; i++) r = await continueReplaySession(deps, viewer, plan.id);
const state = JSON.parse(await portal("__state"));
check("replay typed B's own Passport values into the real portal", state.observed["nombre-legal"] === B.business.legalName && state.observed["email-negocio"] === B.contact.email && state.observed.telefono === "787-555-0199" && state.observed.municipio === "Bayamón", JSON.stringify(state.observed));
check("never A's values", !JSON.stringify(state.observed).includes("Esquina"));
check("stops at the review checkpoint (final submission is the person's)", r.status === "review" && r.pause?.kind === "gate" && r.pause.gate === "submit", JSON.stringify({ status: r.status, pause: r.pause }));
check("Radicar (final submit) was never pressed", state.submitted === 0);
check("replay view never contains the password / SSN / answers", ![PASSWORD, SSN, "787-555-0199"].some((s) => JSON.stringify(r).includes(s)));
await stopReplaySession(deps, viewer, plan.id);

console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
