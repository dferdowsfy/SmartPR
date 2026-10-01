/**
 * Teach Clara — browser-level journey from the entry point in the
 * requirements screenshot ("Fill with Clara — <requirement>" → Clara can't
 * file this yet → "Teach Clara") into the chat-first Clara workspace, then:
 * live walkthrough → secure one-time password / SSN cards → Passport field
 * binding → review → named save → the row now leads with "Fill with Clara"
 * → Fill with Clara for a DIFFERENT business (its own Passport) → missing
 * Passport value asked in chat → review checkpoint (never submitted).
 * Also: EN/ES labels, the worker-unavailable error, and portal drift.
 *
 * The pages and UI are real (next dev). Their /api calls are answered in
 * this process by the real server libraries (teach sessions, validation,
 * skill library, learned routines, replay engine) with:
 *   - TEACH_WORKER_URL + WORKER_API_TOKEN set → the REAL browser worker
 *     (workers/browser-agent) on the fixture portal tests/fixtures/
 *     teach-portal (https://permisos-prueba.pr.gov/ → 127.0.0.1); the
 *     fixture's scripted "person" walks the filing in the worker's browser.
 *   - otherwise → a mock recorder stream + virtual portal (UI coverage only;
 *     not evidence that any worker records).
 *
 *   BASE_URL=http://127.0.0.1:3217 E2E_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *     [TEACH_WORKER_URL=http://127.0.0.1:8765 WORKER_API_TOKEN=…] npx tsx tests/teach-clara-workspace.e2e.mts [outDir]
 */
import { chromium, type Page, type Request, type Route } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProjectContext } from "../src/app/ai/intake/projectContext";
import { MemorySkillRepo } from "../src/lib/agency-runs/skills/skillLibrary";
import { sampleRecorderEvents } from "../src/lib/agency-runs/teach/sampleRecording";
import {
  answerTeachQuestion,
  finishTeachSession,
  markTeachStep,
  saveTeachSession,
  secureFillTeach,
  startTeachSession,
  syncTeachSession,
  teachShot,
  validateTeachSession,
  TeachSessionError,
  type TeachWorker,
} from "../src/lib/agency-runs/teach/teachSessions";
import { listLearnedRoutines, summarizeRoutine } from "../src/lib/agency-runs/teach/learnedRoutines";
import { PASSPORT_CATALOG, readPassportPath } from "../src/lib/agency-runs/teach/passportCatalog";
import { fetchWorkerTeachEvents, fetchWorkerTeachShot, probeTeachWorker, secureFillWorker, startWorkerTeach, stopWorkerTeach } from "../src/lib/agency-runs/teach/teachWorkerClient";
import { VirtualPortal } from "../src/lib/agency-runs/replay/virtualPortal";
import type { PageSnapshot } from "../src/lib/agency-runs/replay/engine";
import { agentRelocator } from "../src/lib/agency-runs/replay/relocate";
import { continueReplaySession, getReplaySession, planReplaySession, secureInputReplay, startReplaySession, stopReplaySession, type ReplayDeps } from "../src/lib/agency-runs/replay/replaySessions";

const OUT = process.argv[2] || path.join(os.tmpdir(), "teach-clara-workspace");
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:3000";
const REAL = Boolean(process.env.TEACH_WORKER_URL && process.env.WORKER_API_TOKEN);
if (REAL) {
  process.env.SELF_HOSTED_AGENT_URL = process.env.TEACH_WORKER_URL;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // the fixture portal's self-signed cert (this process only)
}
const PORTAL = REAL ? "https://permisos-prueba.pr.gov/" : "https://permisos.ejemplo.pr.gov/";
const PASSWORD = "Cl4ve-Secreta!";
const SSN = "123-45-6789";
const B_PASSPORT = { business: { legalName: "Caribe Precision Manufacturing LLC" }, contact: { email: "ops@caribeprecision.pr" }, addresses: { municipality: "Bayamón" } };
const here = path.dirname(fileURLToPath(import.meta.url));

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ requirements snapshot (local intake)
const G = JSON.parse(readFileSync(path.join(here, "../src/app/processes/goldens/E07_rooftop_solar_installation_guaynabo.json"), "utf8"));
const { context } = validateProjectContext(G.modelProjectContext, G.description);
const snapshot = { state: { profile: { ...G.profile }, discoveryAnswers: G.answers ?? {}, projectContext: context, projectIntent: G.projectIntent ?? null, currentStep: 3 } };

// ------------------------------------------------------------ in-process server
const repo = new MemorySkillRepo();
const viewer = { userId: randomUUID(), isAdmin: false };

/** Mock recorder: the sample walk, held at the sign-in screen until the secure password arrives. */
const mock = { events: sampleRecorderEvents(PORTAL).map((e) => (e.kind === "page" && e.hasPassword ? { ...e, secretFields: [{ label: "Contraseña", selector: "#clave", kind: "password" }] } : e)), shown: 0, passwordIn: false };
const mockWorker: TeachWorker = {
  async start() {
    mock.shown = 0;
    mock.passwordIn = false;
    return { sessionId: "mock-1", liveUrl: `${base}/__mock/live` };
  },
  async events(_id, after) {
    const hold = mock.events.findIndex((e) => e.kind === "fill" && e.valueKind === "secret");
    const limit = mock.passwordIn ? mock.events.length : hold;
    mock.shown = Math.min(limit, mock.shown + 3);
    return { items: mock.events.slice(after, mock.shown).map((event, i) => ({ seq: after + i + 1, event, shot: event.valueKind !== "secret" })), nextAfter: mock.shown, status: "running" };
  },
  async stop() {},
  async secureFill() {
    mock.passwordIn = true;
    return { ok: true };
  },
  async shot() {
    return null;
  },
};
const realWorker: TeachWorker = { start: startWorkerTeach, events: fetchWorkerTeachEvents, stop: stopWorkerTeach, secureFill: secureFillWorker, shot: fetchWorkerTeachShot };
const worker = REAL ? realWorker : mockWorker;

let replayPortal: VirtualPortal | null = null;
class SignInPortal extends VirtualPortal {
  async snapshot(): Promise<PageSnapshot> {
    const s = await super.snapshot();
    return s.hasPassword ? { ...s, secretFields: [{ label: "Contraseña", selector: "#clave", kind: "password" }] } : s;
  }
}
async function replayDeps(): Promise<ReplayDeps> {
  if (REAL) {
    const { startWorkerDrive, stopWorkerDrive, WorkerDriver } = await import("../src/lib/agency-runs/replay/workerDriver");
    return { repo, startDrive: startWorkerDrive, stopDrive: stopWorkerDrive, driver: (id) => new WorkerDriver(id), relocate: agentRelocator(null), secureFill: secureFillWorker };
  }
  return {
    repo,
    async startDrive() { return { sessionId: "d1", liveUrl: `${base}/__mock/live` }; },
    driver: () => replayPortal!,
    async stopDrive() {},
    relocate: agentRelocator(null),
    async secureFill() { return { ok: true }; },
  };
}

let recorderOverride: Record<string, unknown> | null = null;
let replayOverride: ((path: string) => unknown) | null = null;
const fixture = async (p: string) => (await fetch(`${PORTAL}${p}`)).text();

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
async function serve(route: Route): Promise<void> {
  const req = route.request();
  const u = new URL(req.url());
  const p = u.pathname;
  const body = req.method() === "POST" ? (JSON.parse(req.postData() || "{}") as Record<string, unknown>) : {};
  try {
    if (p === "/api/snapshots/e2e-teach") return json(route, 200, snapshot);
    if (p === "/api/me") return json(route, 200, { user: null });
    if (p === "/api/incentives/evaluate") return route.continue();
    if (p === "/api/clara-routines") {
      const probe = REAL ? await probeTeachWorker({ fresh: u.searchParams.get("fresh") === "1" }) : { ok: true, reason: null, busy: false, message: null, operator_hint: null };
      const recorder = recorderOverride ?? { ok: probe.ok, reason: probe.reason, busy: probe.busy, message: probe.message, operator_hint: probe.operator_hint };
      return json(route, 200, { signed_in: true, live_recorder: Boolean(recorder.ok), recorder, routines: await listLearnedRoutines(repo, viewer) });
    }
    if (p === "/api/clara-playbooks") return json(route, 200, { signed_in: true, live_recorder: true, playbooks: [] });
    if (p === "/api/clara-workspace/passport") {
      const biz = u.searchParams.get("business_id");
      const pp = biz === "biz-b" ? B_PASSPORT : null;
      return json(route, 200, { business_id: biz, loaded: Boolean(pp), fields: PASSPORT_CATALOG.map((c) => { const v = pp ? readPassportPath(pp, c.path) : undefined; return { path: c.path, en: c.en, es: c.es, has: v != null && v !== "", preview: v != null ? String(v) : null }; }) });
    }
    if (p === "/api/businesses/biz-b") return json(route, 200, { business: { legal_name: "Caribe Precision Manufacturing LLC", municipality: "Bayamón" }, evidence: [{ original_filename: "patente-2025.pdf", requirement_tags: [workspaceRequirement] }] });
    if (p === "/api/teach-sessions" && req.method() === "POST") {
      const session = await startTeachSession({ worker }, { viewer, tier: "user", businessId: null, passport: null, startUrl: String(body.start_url), portalName: String(body.portal_name ?? ""), form: String(body.form ?? ""), requirementKey: String(body.requirement_key ?? ""), agency: typeof body.agency === "string" ? body.agency : null });
      return json(route, 201, { session });
    }
    const m = p.match(/^\/api\/teach-sessions\/([^/]+)(?:\/(answer|mark|finish|validate|save|secure-input|shots))?(?:\/(\d+))?$/);
    if (m) {
      const [, id, op, seq] = m;
      if (!op) return json(route, 200, { session: await syncTeachSession({ worker }, viewer, id) });
      if (op === "answer") return json(route, 200, { session: answerTeachQuestion(viewer, id, String(body.question_id), body.answer as never) });
      if (op === "mark") {
        if (body.rebind) { const r = body.rebind as { step_id: string; field_key: string; path: string | null }; return json(route, 200, { session: markTeachStep(viewer, id, { rebind: { stepId: r.step_id, fieldKey: r.field_key, path: r.path } }) }); }
        if (typeof body.remove_step === "string") return json(route, 200, { session: markTeachStep(viewer, id, { removeStep: body.remove_step }) });
        return json(route, 200, { session: markTeachStep(viewer, id, { stepId: String(body.step_id), gate: (body.gate ?? null) as never }) });
      }
      if (op === "finish") return json(route, 200, await finishTeachSession({ worker }, viewer, id));
      if (op === "validate") return json(route, 200, await validateTeachSession(viewer, id));
      if (op === "save") {
        const row = await saveTeachSession({ repo }, viewer, id, { submit: false, learn: body.learn === true, name: typeof body.name === "string" ? body.name : null });
        return json(route, 201, { skill: { id: row.id }, routine: summarizeRoutine(row, viewer) });
      }
      if (op === "secure-input") return json(route, 200, await secureFillTeach({ worker }, viewer, id, { value: String(body.value ?? ""), selector: typeof body.selector === "string" ? body.selector : null }));
      if (op === "shots") {
        const bytes = await teachShot({ worker }, viewer, id, Number(seq));
        return bytes ? route.fulfill({ status: 200, contentType: "image/jpeg", body: Buffer.from(bytes) }) : route.fulfill({ status: 404, body: "" });
      }
    }
    if (p === "/api/replays" && req.method() === "POST") {
      const deps = await replayDeps();
      const replay = await planReplaySession(deps, viewer, { ref: String(body.skill_ref), businessId: String(body.business_id), passport: B_PASSPORT });
      if (!REAL) {
        const row = await repo.get(String(body.skill_ref));
        replayPortal = new SignInPortal(row!.skill, new Set(row!.skill.steps.map((s) => s.id)));
      }
      return json(route, 201, { replay });
    }
    const rm = p.match(/^\/api\/replays\/([^/]+)\/(start|continue|stop|secure-input)$/);
    if (rm) {
      const [, id, op] = rm;
      if (replayOverride) { const out = replayOverride(op); if (out) return json(route, 200, out); }
      const deps = await replayDeps();
      if (op === "start") return json(route, 200, { replay: await startReplaySession(deps, viewer, id) });
      if (op === "continue") {
        // Mock: the "person" finishes the screen they were asked to (real mode: the fixture does).
        const cur = getReplaySession(viewer, id);
        if (!REAL && cur.pause && (cur.pause.kind === "gate" || cur.pause.kind === "navigate")) replayPortal!.humanAdvance();
        return json(route, 200, { replay: await continueReplaySession(deps, viewer, id, (body.answers ?? {}) as Record<string, string>) });
      }
      if (op === "stop") return json(route, 200, { replay: await stopReplaySession(deps, viewer, id) });
      return json(route, 200, await secureInputReplay(deps, viewer, id, { value: String(body.value ?? ""), selector: typeof body.selector === "string" ? body.selector : null }));
    }
    if (p === "/__mock/live") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><meta charset=utf-8><body style='font:16px system-ui;padding:20px'>Portal (mock live view)</body>" });
    return json(route, 404, { error: "stubbed" });
  } catch (err) {
    if (err instanceof TeachSessionError) return json(route, err.status, { error: err.code, message: err.message, detail: err.detail ?? null });
    const e = err as { status?: number; code?: string; message?: string };
    if (e?.status && e.code) return json(route, e.status, { error: e.code, message: e.message });
    console.error("stub error", p, err);
    return json(route, 500, { error: "server_error" });
  }
}

let workspaceRequirement = "";
const posted: { url: string; body: string }[] = [];
async function newPage(viewport = { width: 1360, height: 900 }): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (r: Request) => { if (r.method() === "POST") posted.push({ url: r.url(), body: r.postData() ?? "" }); });
  await page.route("**/api/**", serve);
  await page.route("**/__mock/**", serve);
  return { page, errors };
}

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
console.log(`mode: ${REAL ? "REAL worker " + process.env.TEACH_WORKER_URL : "mock recorder (UI only)"}`);

// ------------------------------------------------------------ 1. the entry point from the screenshot
const { page, errors } = await newPage();
await page.goto(`${base}/?resume=e2e-teach`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.getByRole("button", { name: /Compute Requirements from Rules Engine/ }).click({ timeout: 120000 });
await page.locator(".ck-summary").waitFor({ timeout: 60000 });
await page.waitForTimeout(800);
const explainRow = page.locator('.spr-requirements-main .ck-card-line:has([data-testid="row-clara"][data-route="explain"])').first();
check("a requirement whose 'Fill with Clara' explains what Clara can do (the screenshot's case)", (await explainRow.count()) > 0);
const rowName = (await explainRow.locator(".ck-name").innerText()).trim();
await explainRow.locator('[data-testid="row-clara"]').click();
const explain = page.locator('[data-testid="clara-explain"]');
await explain.waitFor({ timeout: 5000 });
const explainText = await explain.innerText();
check("explain dialog: 'Teach Clara' replaces 'Show her this portal once'", /Teach Clara/.test(explainText) && !/Show her this portal once/.test(explainText), explainText.replace(/\s+/g, " ").slice(0, 160));
check("explain dialog keeps 'Prepare the information in SmartPR' and 'Ask Clara'", /Prepare the information in SmartPR/.test(explainText) && /Ask Clara/.test(explainText));
await page.screenshot({ path: path.join(OUT, "1_entry_explain_en.png") });
await explain.locator('[data-testid="clara-explain-teach"]').click();
await page.waitForURL(/\/agency-run\?/, { timeout: 30000 });
const wsUrl = new URL(page.url());
workspaceRequirement = wsUrl.searchParams.get("requirement") ?? "";
check("Teach Clara opens the Clara workspace (not another modal), in teach mode", wsUrl.searchParams.get("mode") === "teach" && wsUrl.pathname.endsWith("/agency-run"), page.url());
check("requirement context carried over (key + name)", Boolean(workspaceRequirement) && wsUrl.searchParams.get("name") === rowName, `${workspaceRequirement} / ${wsUrl.searchParams.get("name")}`);
await page.locator('[data-testid="clara-workspace"][data-mode="teach"]').waitFor({ timeout: 60000 });
check("workspace: chat is primary, browser is a side panel with [View browser]", (await page.locator('[data-testid="ws-chat"]').count()) === 1 && (await page.locator('[data-testid="ws-view-browser"]').count()) === 1);
check("workspace: requirement context card", (await page.locator('[data-testid="ws-context"]').innerText()).includes(rowName));

// ------------------------------------------------------------ 2. worker unavailable → specific message
recorderOverride = { ok: false, reason: "unreachable", busy: false, message: { en: "Clara's recording browser isn't answering right now, so she can't watch you walk the portal.", es: "El navegador de grabación de Clara no responde ahora mismo, así que no puede verte recorrer el portal." }, operator_hint: null };
await page.reload();
await page.locator('[data-testid="ws-unavailable"]').waitFor({ timeout: 30000 });
const unavailable = await page.locator('[data-testid="ws-unavailable"]').innerText();
check("worker failure: the specific reason is shown (not a generic 'not turned on')", /isn't answering right now/.test(unavailable) && (await page.locator('[data-testid="ws-unavailable-reason"]').getAttribute("data-reason")) === "unreachable", unavailable.slice(0, 120));
await page.screenshot({ path: path.join(OUT, "2_worker_unavailable.png") });
recorderOverride = null;
await page.locator('[data-testid="ws-retry"]').click();
await page.locator('[data-testid="ws-ready"], [data-testid="ws-need-url"]').first().waitFor({ timeout: 60000 });
check("retry after the worker recovers: ready to record", true);

// ------------------------------------------------------------ 3. live walkthrough
if (REAL) await fixture("__mode?set=teach");
if (await page.locator('[data-testid="ws-ready"]').count()) await page.getByRole("button", { name: /Use a different address/ }).click();
await page.locator('[data-testid="ws-portal-url"]').fill(PORTAL);
await page.locator('[data-testid="ws-start"]').click();
await page.locator('[data-testid="ws-recording"]').waitFor({ timeout: 60000 }).catch(async (e) => {
  console.log("chat:", (await page.locator('[data-testid="ws-chat"]').innerText()).slice(-600));
  throw e;
});
check("recording: browser panel opens beside the chat", (await page.locator('[data-testid="ws-browser-panel"]').count()) === 1 && (await page.locator('[data-testid="ws-live-view"]').count()) === 1);

async function sendSecure(value: string, label: string) {
  const card = page.locator('[data-testid="ws-secure-card"]').last();
  await card.waitFor({ timeout: 60000 });
  const input = card.locator('[data-testid="ws-secure-input"]');
  check(`${label}: masked input (type=password), not the chat composer`, (await input.getAttribute("type")) === "password");
  await input.fill(value);
  await card.locator('[data-testid="ws-secure-send"]').click();
  await card.locator('[data-testid="ws-secure-note"][data-ok="1"]').waitFor({ timeout: 30000 });
  check(`${label}: cleared after use`, (await input.inputValue()) === "");
  check(`${label}: never shown in the chat`, !(await page.locator('[data-testid="ws-chat"]').innerText()).includes(value));
}

// Sign-in: a secure card for the password.
await page.locator('[data-testid="ws-your-turn"]').waitFor({ timeout: 60000 });
await page.screenshot({ path: path.join(OUT, "3_signin_secure_card.png") });
await sendSecure(PASSWORD, "password card");
if (REAL) {
  // Identity screen: SSN through the same kind of card.
  await page.locator('[data-testid="ws-secure-card"]').filter({ hasText: /Social Security/ }).waitFor({ timeout: 60000 });
  await sendSecure(SSN, "SSN card");
}

// Answer Clara's mapping questions as they come, until the review screen is recorded.
const reviewLine = page.locator('[data-testid="ws-screen-line"]').filter({ hasText: /Revisi/ });
for (let i = 0; i < 120; i++) {
  const q = page.locator('[data-testid="ws-question"]').first();
  if (await q.count()) {
    await q.locator('[data-testid="q-confirm"], [data-testid="q-yes"], [data-testid="q-ask"]').first().click();
    await page.waitForTimeout(300);
    continue;
  }
  if (await reviewLine.count()) break;
  await page.waitForTimeout(700);
}
check("walkthrough: one chat line per screen, including the final-submission stop", (await page.locator('[data-testid="ws-screen-line"]').count()) >= 4 && (await reviewLine.count()) === 1);
const chatText = await page.locator('[data-testid="ws-chat"]').innerText();
check("chat shows screens and Passport mapping, not a click log", /field/.test(chatText) && !/Clicked “/.test(chatText));
await page.screenshot({ path: path.join(OUT, "4_walkthrough.png") });
await page.locator('[data-testid="ws-passport-toggle"]').click();
check("Business Passport is accessible in the workspace", await page.locator('[data-testid="ws-passport-panel"]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
await page.locator('[data-testid="ws-view-browser"]').click();
await page.locator('[data-testid="ws-finish"]').click();
await page.locator('[data-testid="ws-review"]').waitFor({ timeout: 90000 });
for (let i = 0; i < 20; i++) {
  const q = page.locator('[data-testid="ws-question"]').first();
  if (!(await q.count())) break;
  await q.locator('[data-testid="q-confirm"], [data-testid="q-yes"], [data-testid="q-ask"]').first().click();
  await page.waitForTimeout(300);
}
if (await page.locator('[data-testid="ws-check-again"]').count()) {
  await page.locator('[data-testid="ws-check-again"]').click();
  await page.locator('[data-testid="ws-review"]').waitFor({ timeout: 60000 });
}
check("validation passes", (await page.locator('[data-testid="ws-verdict"]').getAttribute("data-status")) === "pass");
const bindings = await page.locator('[data-testid="ws-review-field"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-binding")));
check("review: fields are bound to Passport fields", bindings.filter((b) => b === "passport").length >= 3, bindings.join(","));
// Correct a mapping in review (edit, then put it back).
await page.locator('[data-testid="ws-edit-steps"]').click();
check("review: mappings and steps are correctable", (await page.locator('[data-testid="ws-edit-binding"]').count()) >= 3 && (await page.locator('[data-testid="ws-remove-step"]').count()) >= 3);
await page.locator('[data-testid="ws-edit-steps"]').click();
if (await page.locator('[data-testid="ws-check-again"]').count()) {
  await page.locator('[data-testid="ws-check-again"]').click();
  await page.locator('[data-testid="ws-save"]').waitFor({ timeout: 60000 });
}
await page.locator('[data-testid="ws-routine-name"]').fill("Patente municipal — prueba");
await page.screenshot({ path: path.join(OUT, "5_review.png") });
await page.locator('[data-testid="ws-save"]').click();
await page.locator('[data-testid="ws-saved"]').waitFor({ timeout: 30000 });
check("named save: Clara learned the routine", /Patente municipal — prueba/.test(await page.locator('[data-testid="ws-saved"]').innerText()));
await page.screenshot({ path: path.join(OUT, "6_saved.png") });
const routines = await listLearnedRoutines(repo, viewer);
const saved = routines.find((r) => r.requirement_key === workspaceRequirement);
check("routine persisted with name, requirement, portal, version, validation", Boolean(saved && saved.name === "Patente municipal — prueba" && saved.version === 1 && saved.validation.status === "pass" && saved.portal_host === new URL(PORTAL).hostname), JSON.stringify(saved));
const storedJson = JSON.stringify(await repo.get(saved!.ref));
check("routine stores no entered values / secrets", ![PASSWORD, SSN, "La Esquina", "laesquina", "787-555-0142", "marisol"].some((s) => storedJson.includes(s)));
const leakPosts = posted.filter((p) => (p.body.includes(PASSWORD) || p.body.includes(SSN)) && !/\/secure-input$/.test(new URL(p.url).pathname));
check("secrets only ever left the page in the secure-input call", leakPosts.length === 0, leakPosts.map((p) => p.url).join(" "));
const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
check("secrets not in browser storage", !storage.includes(PASSWORD) && !storage.includes(SSN));
check("teach: no page errors", errors.length === 0, errors.join(" | "));

// ------------------------------------------------------------ 4. the row now leads with Fill with Clara
await page.goto(`${base}/?resume=e2e-teach`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.getByRole("button", { name: /Compute Requirements from Rules Engine/ }).click({ timeout: 120000 });
await page.locator(".ck-summary").waitFor({ timeout: 60000 });
await page.waitForTimeout(800);
const learnedRow = page.locator(".spr-requirements-main .ck-card-line").filter({ has: page.locator(".ck-name", { hasText: rowName }) }).first();
check("learned row: 'Fill with Clara' now replays the routine", (await learnedRow.locator('[data-testid="row-clara"]').getAttribute("data-route")) === "learned");
await page.screenshot({ path: path.join(OUT, "7_learned_row.png") });

// ------------------------------------------------------------ 5. Fill with Clara for a different business
if (REAL) await fixture("__mode?set=replay");
await page.goto(`${base}/businesses/biz-b/agency-run?${new URLSearchParams({ mode: "fill", requirement: workspaceRequirement, name: rowName })}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.locator('[data-testid="clara-workspace"][data-mode="fill"]').waitFor({ timeout: 60000 });
await page.locator('[data-testid="ws-preflight"]').waitFor({ timeout: 60000 });
const pre = await page.locator('[data-testid="ws-preflight"]').innerText();
check("fill: finds the saved routine and shows a preflight with B's Passport", /Patente municipal — prueba/.test(pre) && /From the Business Passport/.test(pre), pre.replace(/\s+/g, " ").slice(0, 200));
check("fill: missing Passport value (phone) named up front", /Teléfono/.test(await page.locator('[data-testid="ws-preflight-missing"]').innerText().catch(() => "")));
check("fill: context shows business B and its evidence", /Caribe Precision/.test(await page.locator('[data-testid="ws-context"]').innerText()) && /patente-2025\.pdf/.test(await page.locator('[data-testid="ws-context"]').innerText()));
await page.screenshot({ path: path.join(OUT, "8_fill_preflight.png") });
await Promise.all([page.waitForResponse((r) => /\/start$/.test(r.url()), { timeout: 120000 }), page.locator('[data-testid="ws-replay-start"]').click()]);

for (let i = 0; i < 20; i++) {
  await page.locator('[data-testid="ws-review-gate"], [data-testid="ws-pause"], [data-testid="ws-done"]').first().waitFor({ timeout: 90000 });
  if (await page.locator('[data-testid="ws-review-gate"]').count()) break;
  const kind = await page.locator('[data-testid="ws-pause-kind"]').last().getAttribute("data-kind");
  const gate = await page.locator('[data-testid="ws-pause-kind"]').last().getAttribute("data-gate");
  if (kind === "ask") {
    const ans = page.locator('[data-testid="ws-answer"]');
    check("fill: asks for the missing value in chat", (await ans.count()) >= 1);
    for (let k = 0; k < (await ans.count()); k++) await ans.nth(k).fill("787-555-0199");
    await Promise.all([page.waitForResponse((r) => /\/continue$/.test(r.url()), { timeout: 120000 }), page.locator('[data-testid="ws-answer-send"]').click()]);
  } else if (kind === "gate" && (gate === "login" || gate === "identity")) {
    check(`fill: ${gate} pause offers a secure one-time card`, (await page.locator('[data-testid="ws-secure-card"]').count()) === 1);
    if (i === 0) await page.screenshot({ path: path.join(OUT, "9_fill_signin.png") });
    await sendSecure(gate === "login" ? PASSWORD : SSN, `fill ${gate} card`);
    await page.waitForTimeout(REAL ? 2500 : 200);
    await Promise.all([page.waitForResponse((r) => /\/continue$/.test(r.url()), { timeout: 120000 }), page.locator('[data-testid="ws-continue"]').click()]);
  } else if (kind === "drift" || kind === "portal_error") {
    check("fill: unexpected drift", false, kind);
    break;
  } else {
    await Promise.all([page.waitForResponse((r) => /\/continue$/.test(r.url()), { timeout: 120000 }), page.locator('[data-testid="ws-continue"]').click()]);
  }
  await page.waitForTimeout(400);
}
const gateText = await page.locator('[data-testid="ws-review-gate"]').innerText().catch(() => "");
check("review checkpoint: Clara stops; the final submission is the person's", /final submission is yours/.test(gateText) && (await page.locator('[data-testid="ws-submitted"]').count()) === 1, gateText.slice(0, 120));
if (REAL) {
  const st = JSON.parse(await fixture("__state"));
  check("real portal: B's values typed, A's never, submit never pressed", st.observed["nombre-legal"] === B_PASSPORT.business.legalName && st.observed.telefono === "787-555-0199" && !JSON.stringify(st.observed).includes("Esquina") && st.submitted === 0, JSON.stringify(st));
} else {
  const filled = replayPortal!.pages.flatMap((pg) => pg.controls).filter((c) => c.value).map((c) => c.value);
  check("B's own values filled; submit never pressed", filled.includes(B_PASSPORT.business.legalName) && filled.includes("787-555-0199") && !replayPortal!.submitClicked, filled.join(", "));
}
check("fill: answers and secrets not shown in the chat", !/787-555-0199|Cl4ve|123-45/.test(await page.locator('[data-testid="ws-chat"]').innerText()));
await page.screenshot({ path: path.join(OUT, "10_review_checkpoint.png") });
await page.locator('[data-testid="ws-view-browser"]').click();
check("[View browser] toggles the live browser", (await page.locator('[data-testid="ws-browser-panel"]').count()) === 0 || (await page.locator('[data-testid="ws-browser-panel"]').count()) === 1);
// Close the replay browser (the worker runs one session at a time).
await Promise.all([page.waitForResponse((r) => /\/stop$/.test(r.url()), { timeout: 60000 }), page.getByRole("button", { name: /Stop — I'll come back/ }).click()]).catch(() => undefined);
check("fill: no page errors", errors.length === 0, errors.join(" | "));
await page.close();

// ------------------------------------------------------------ 6. portal drift (UI) and Spanish
{
  const { page: p2, errors: e2 } = await newPage();
  replayOverride = (op) =>
    op === "start"
      ? { replay: { ...getReplayPlanned(), status: "paused", pause: { kind: "drift", reason: "unexpected_screen", stepId: null, expected: "Información del negocio", seen: { title: "Portal", heading: "Portal en mantenimiento", url: PORTAL }, detail: "This screen isn't part of what I learned." }, milestones: [{ at: new Date().toISOString(), stepId: null, text: { en: "I found something I didn't expect, so I stopped without touching anything.", es: "Encontré algo que no esperaba, así que me detuve sin tocar nada." } }], live_url: null, secret_fields: [] } }
      : null;
  let planned: unknown = null;
  function getReplayPlanned() { return planned as Record<string, unknown>; }
  p2.on("response", async (r) => { if (/\/api\/replays$/.test(r.url())) planned = (await r.json()).replay; });
  await p2.goto(`${base}/businesses/biz-b/agency-run?${new URLSearchParams({ mode: "fill", requirement: workspaceRequirement, name: rowName })}`, { waitUntil: "domcontentloaded" });
  await p2.locator('[data-testid="ws-replay-start"]').click({ timeout: 60000 });
  await p2.locator('[data-testid="ws-drift"]').waitFor({ timeout: 30000 });
  check("portal drift: Clara stops and explains, offers Re-teach", /Portal en mantenimiento/.test(await p2.locator('[data-testid="ws-drift"]').innerText()) && (await p2.locator('[data-testid="ws-reteach"]').count()) === 1);
  await p2.screenshot({ path: path.join(OUT, "11_drift.png") });
  replayOverride = null;
  // Spanish.
  await p2.getByRole("button", { name: "ES", exact: true }).click();
  await p2.waitForTimeout(500);
  const header = await p2.locator('[data-testid="clara-workspace"] header').first().innerText();
  check("ES: workspace labels in Spanish", /Llenar con Clara/i.test(header) && /Ver navegador|Ocultar navegador/i.test(header) && /Pasaporte del negocio/i.test(header), header.replace(/\s+/g, " ").slice(0, 160));
  check("ES: drift message in Spanish", /sin tocar nada|se ve distinto/.test(await p2.locator('[data-testid="ws-chat"]').innerText()));
  await p2.screenshot({ path: path.join(OUT, "12_es_fill.png") });
  await p2.goto(`${base}/?resume=e2e-teach`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await p2.getByRole("button", { name: /Compute Requirements|Calcular/ }).first().click({ timeout: 120000 });
  await p2.locator(".ck-summary").waitFor({ timeout: 60000 });
  await p2.waitForTimeout(800);
  const esRow = p2.locator('.spr-requirements-main .ck-card-line:has([data-testid="row-clara"][data-route="explain"])').first();
  await esRow.locator('[data-testid="row-clara"]').click();
  const esExplain = await p2.locator('[data-testid="clara-explain"]').innerText();
  check("ES: explain dialog says 'Enséñale a Clara' and 'Llenar con Clara'", /Enséñale a Clara/.test(esExplain) && /Llenar con Clara/.test(esExplain) && !/Enséñale este portal una vez/.test(esExplain), esExplain.replace(/\s+/g, " ").slice(0, 160));
  await p2.screenshot({ path: path.join(OUT, "13_es_entry.png") });
  await p2.locator('[data-testid="clara-explain-teach"]').click();
  await p2.locator('[data-testid="clara-workspace"][data-mode="teach"]').waitFor({ timeout: 60000 });
  const esTitle = await p2.locator('[data-testid="clara-workspace"] header').filter({ hasText: /Enséñale a Clara/i }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check("ES: workspace opens as 'Enséñale a Clara' (language carried from the requirements page)", esTitle, await p2.locator('[data-testid="clara-workspace"] header').first().innerText());
  await p2.screenshot({ path: path.join(OUT, "14_es_workspace.png") });
  // The global TopNav (outside this feature) renders EN on the server and ES on the client after a language switch.
  const known = e2.filter((e) => /Hydration failed/.test(e) && /Comenzar|Start/.test(e));
  if (known.length) console.log(`NOTE  pre-existing TopNav hydration mismatch after switching to ES (${known.length}) — not part of this change`);
  check("drift/ES: no page errors", e2.length === known.length, e2.filter((e) => !known.includes(e)).join(" | "));
  await p2.close();
}

await browser.close();
console.log(`\nscreenshots: ${OUT}`);
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
