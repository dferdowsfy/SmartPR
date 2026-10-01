/**
 * Record-first Teach Clara — browser test of the REAL requirements page.
 *
 * Teach → record (mock recorder) → validate → Learned → "Fill with Clara"
 * becomes the row's primary action. The page and every UI component are
 * real; the network edge is served IN THIS PROCESS by the real server
 * libraries (teachSessions, recording normalization, validateRoutine,
 * skill library, learnedRoutines, replay planning) with:
 *   - a mock recorder worker that releases a sample recorder stream
 *     (structure only) a few events per poll, with per-action screenshots;
 *   - a mock live view (a static portal page) for the in-app browser;
 *   - an in-memory skill repo and a fixed signed-in viewer (no Supabase).
 *
 * Usage (dev server running):
 *   E2E_CHROME=/usr/bin/google-chrome BASE_URL=http://localhost:3217 npx tsx tests/clara-teach-record.e2e.mts [outDir]
 */
import { chromium, type Browser, type Page, type Route } from "playwright";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
  startTeachSession,
  syncTeachSession,
  validateTeachSession,
  TeachSessionError,
  type TeachWorker,
} from "../src/lib/agency-runs/teach/teachSessions";
import { listLearnedRoutines, summarizeRoutine } from "../src/lib/agency-runs/teach/learnedRoutines";

const OUT = process.argv[2] || path.join(os.tmpdir(), "clara-teach-record");
const base = process.env.BASE_URL || "http://localhost:3000";
const here = path.dirname(fileURLToPath(import.meta.url));
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

const G = JSON.parse(readFileSync(path.join(here, "../src/app/processes/goldens/E07_rooftop_solar_installation_guaynabo.json"), "utf8"));
const { context } = validateProjectContext(G.modelProjectContext, G.description);
const snapshot = { state: { profile: { ...G.profile }, discoveryAnswers: G.answers ?? {}, projectContext: context, projectIntent: G.projectIntent ?? null, currentStep: 3 } };

// ------------------------------------------------------------ in-process "server"
const repo = new MemorySkillRepo();
const viewer = { userId: randomUUID(), isAdmin: false };
const PER_POLL = 3;
/** Mock recorder: the sample stream for the session's portal, released a few events per poll. */
const releases = new Map<string, { events: Record<string, unknown>[]; shown: number; limit: number }>();
const worker: TeachWorker = {
  async start(input) {
    const id = `mock-${releases.size + 1}`;
    releases.set(id, { events: sampleRecorderEvents(new URL(input.startUrl).origin + "/"), shown: 0, limit: Infinity });
    return { sessionId: id, liveUrl: `${base}/__mock/live?s=${id}` };
  },
  async events(id, after) {
    const r = releases.get(id)!;
    r.shown = Math.min(r.events.length, r.limit, r.shown + PER_POLL);
    const items = r.events.slice(after, r.shown).map((event, i) => ({ seq: after + i + 1, event, screenshot: `${base}/__mock/shot/${after + i + 1}.png` }));
    return { items, nextAfter: r.shown, status: "running" };
  },
  async stop() {},
};
/** The first recording stops early (before the review screen) to show a failing validation. */
let firstRecording = true;

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
async function serve(route: Route, shot: Buffer | null): Promise<void> {
  const req = route.request();
  const u = new URL(req.url());
  const p = u.pathname;
  const body = req.method() === "POST" ? (JSON.parse(req.postData() || "{}") as Record<string, unknown>) : {};
  try {
    if (p === "/api/snapshots/e2e-teach") return json(route, 200, snapshot);
    if (p === "/api/me") return json(route, 200, { user: null });
    if (p === "/api/incentives/evaluate") return route.continue();
    if (p === "/api/clara-routines") return json(route, 200, { signed_in: true, live_recorder: true, routines: await listLearnedRoutines(repo, viewer) });
    if (p === "/api/clara-playbooks") return json(route, 200, { signed_in: true, live_recorder: true, playbooks: [] });
    if (p === "/api/teach-sessions" && req.method() === "POST") {
      const session = await startTeachSession({ worker }, { viewer, tier: "user", businessId: null, passport: null, startUrl: String(body.start_url), portalName: String(body.portal_name ?? ""), form: String(body.form ?? ""), requirementKey: String(body.requirement_key ?? "") });
      const mock = [...releases.values()].at(-1)!;
      if (firstRecording) mock.limit = 12; // stops after the business-info screen
      firstRecording = false;
      return json(route, 201, { session });
    }
    const m = p.match(/^\/api\/teach-sessions\/([^/]+)(?:\/(answer|mark|finish|validate|save))?$/);
    if (m) {
      const [, id, op] = m;
      if (!op) return json(route, 200, { session: await syncTeachSession({ worker }, viewer, id) });
      if (op === "answer") return json(route, 200, { session: answerTeachQuestion(viewer, id, String(body.question_id), body.answer as never) });
      if (op === "mark") {
        if (typeof body.remove_step === "string") return json(route, 200, { session: markTeachStep(viewer, id, { removeStep: body.remove_step }) });
        return json(route, 200, { session: markTeachStep(viewer, id, { stepId: String(body.step_id), gate: (body.gate ?? null) as never }) });
      }
      if (op === "finish") return json(route, 200, await finishTeachSession({ worker }, viewer, id));
      if (op === "validate") return json(route, 200, await validateTeachSession(viewer, id));
      if (op === "save") {
        const row = await saveTeachSession({ repo }, viewer, id, { submit: false, learn: body.learn === true });
        return json(route, 201, { skill: { id: row.id }, routine: summarizeRoutine(row, viewer) });
      }
    }
    if (p.startsWith("/__mock/shot/") && shot) return route.fulfill({ status: 200, contentType: "image/png", body: shot });
    if (p === "/__mock/live") {
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><meta charset=utf-8><body style="margin:0;font:16px system-ui;background:#f4f6f8">
<header style="background:#0b3d63;color:#fff;padding:14px 20px;font-weight:700">Portal de Permisos · Gobierno de Puerto Rico</header>
<main style="max-width:640px;margin:24px auto;background:#fff;border-radius:10px;padding:22px;box-shadow:0 2px 10px #0002">
<h1 style="font-size:22px;margin:0 0 14px">Información del negocio</h1>
<label>Nombre legal del negocio<br><input style="width:100%;padding:8px;margin:4px 0 12px" value="••••••••"></label>
<label>Correo electrónico<br><input style="width:100%;padding:8px;margin:4px 0 12px"></label>
<label>Teléfono<br><input style="width:100%;padding:8px;margin:4px 0 12px"></label>
<label>Municipio<br><select style="width:100%;padding:8px;margin:4px 0 16px"><option>San Juan</option></select></label>
<button style="background:#0b3d63;color:#fff;border:0;padding:10px 18px;border-radius:6px">Siguiente</button></main>`,
      });
    }
    return json(route, 404, { error: "stubbed" });
  } catch (err) {
    if (err instanceof TeachSessionError) return json(route, err.status, { error: err.code, message: err.message });
    console.error("stub error", p, err);
    return json(route, 500, { error: "server_error" });
  }
}

async function openRequirements(browser: Browser, opts: { mobile: boolean; shot: Buffer | null }): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage(opts.mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1360, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/**", (r) => serve(r, opts.shot));
  await page.route("**/__mock/**", (r) => serve(r, opts.shot));
  await page.goto(`${base}/?resume=e2e-teach`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const compute = page.getByRole("button", { name: /Compute Requirements from Rules Engine/ });
  await compute.waitFor({ timeout: 90000 });
  await compute.click();
  await page.locator(".ck-summary").waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  return { page, errors };
}

async function toSpanish(page: Page) {
  const langBtn = page.getByRole("button", { name: /^(ES|Español)$/ }).first();
  if (await langBtn.isVisible().catch(() => false)) {
    await langBtn.click();
    await page.waitForTimeout(600);
    return true;
  }
  return false;
}

const rowsWithMenu = (page: Page) => page.locator('.spr-requirements-main [data-testid="req-group-energy"] .ck-card-line:has([data-testid="row-more"])');
const rowByName = (page: Page, name: string) => page.locator(".spr-requirements-main .ck-card-line").filter({ has: page.locator(".ck-name", { hasText: name }) }).first();

async function openTeach(page: Page, row: ReturnType<typeof rowByName>) {
  await row.locator('[data-testid="row-more"]').click();
  await row.locator('[data-testid="row-more-item"][data-cta="teach"]').click();
  const dlg = page.locator('[data-testid="teach-clara-dialog"]');
  await dlg.waitFor({ timeout: 5000 });
  return dlg;
}

async function answerAll(dlg: ReturnType<Page["locator"]>) {
  for (let i = 0; i < 20; i++) {
    const q = dlg.locator('[data-testid="teach-question"]').first();
    if (!(await q.count())) return;
    const btn = q.locator('[data-testid="q-confirm"], [data-testid="q-yes"], [data-testid="q-ask"]').first();
    await btn.click();
    await dlg.page().waitForTimeout(250);
  }
}

async function recordFull(page: Page, dlg: ReturnType<Page["locator"]>, lang: "en" | "es", shotPrefix: string) {
  await dlg.locator('[data-testid="teach-recording"]').waitFor({ timeout: 10000 });
  // Wait until the whole stream is in (17 actions).
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="teach-recorded-step"]').length >= 17, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${shotPrefix}_recording.png`) });
  await answerAll(dlg);
  await dlg.locator('[data-testid="teach-finish"]').click();
  await dlg.locator('[data-testid="teach-validation"]').waitFor({ timeout: 15000 });
  const status = await dlg.locator('[data-testid="teach-verdict"]').getAttribute("data-status");
  check(`${lang}: a complete recording validates`, status === "pass", String(status));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${shotPrefix}_validation_pass.png`) });
  await dlg.locator('[data-testid="teach-save-learned"]').click();
  await dlg.locator('[data-testid="teach-learned"]').waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(OUT, `${shotPrefix}_learned.png`) });
  await dlg.locator('[data-testid="teach-done"]').click();
  await dlg.waitFor({ state: "detached", timeout: 5000 });
}

// ------------------------------------------------------------ run
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
let shot: Buffer | null = null;
{
  // A per-action "screenshot" the mock recorder serves: the mock portal page itself.
  const p = await browser.newPage({ viewport: { width: 900, height: 560 } });
  await p.route("**/__mock/**", (r) => serve(r, null));
  await p.goto(`${base}/__mock/live`);
  shot = await p.screenshot();
  await p.close();
}

// Desktop EN: Teach → record → (stopped early) issues → record again → pass → Learned → Fill with Clara primary.
{
  const { page, errors } = await openRequirements(browser, { mobile: false, shot });
  const first = rowsWithMenu(page).first();
  const name = (await first.locator(".ck-name").innerText()).trim();
  const row = rowByName(page, name);
  const primaryBefore = (await row.locator('[data-testid="row-actions"] > [data-testid="row-cta"]').first().innerText().catch(() => "")).trim();
  console.log("row:", name, "| primary before:", primaryBefore);
  const dlg = await openTeach(page, row);
  check("Teach Clara starts a recording right away (no typed-steps form)", await dlg.locator('[data-testid="teach-recording"]').waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
  check("no typed-steps form as the entry point", (await dlg.locator('[data-testid="teach-form"]').count()) === 0);
  check("in-app live browser is shown", (await dlg.locator('[data-testid="teach-live-view"]').count()) === 1);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="teach-recorded-step"]').length >= 12, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const kinds = await dlg.locator('[data-testid="teach-recorded-step"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
  check("recorded actions include navigate, click, type and select", ["navigate", "click", "type", "select"].every((k) => kinds.includes(k)), kinds.join(","));
  const listText = await dlg.locator('[data-testid="teach-recorded-steps"]').innerText();
  check("password is hidden and marked as the person's part", /Contraseña[\s\S]*\(hidden\)/.test(listText) && /Your part: Sign-in/.test(listText), "");
  check("typed values are bound to business fields (suggested)", /Which detail\?/.test(listText) || /Business legal name/.test(listText));
  check("per-action screenshots shown", (await dlg.locator(".tr-thumb").count()) > 0);
  await page.screenshot({ path: path.join(OUT, "desktop_en_recording_partial.png") });
  await answerAll(dlg);
  await dlg.locator('[data-testid="teach-finish"]').click();
  await dlg.locator('[data-testid="teach-validation"]').waitFor({ timeout: 15000 });
  const st = await dlg.locator('[data-testid="teach-verdict"]').getAttribute("data-status");
  const issues = await dlg.locator('[data-testid="teach-issue"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-check")));
  check("a recording that stops before review does NOT validate", st === "issues" && issues.includes("ends_at_review"), `${st} ${issues.join(",")}`);
  const fix = await dlg.locator('[data-testid="teach-issue"][data-check="ends_at_review"] small').innerText().catch(() => "");
  check("each issue has a one-line fix", /review screen/.test(fix), fix);
  check("no 'Save — learned' while issues remain", (await dlg.locator('[data-testid="teach-save-learned"]').count()) === 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "desktop_en_validation_issues.png") });
  // Edit steps is the secondary view of the recorded routine.
  await dlg.locator('[data-testid="teach-edit-steps"]').click();
  check("Edit steps shows the recorded screens", (await dlg.locator('[data-testid="teach-edit-screen"]').count()) >= 2);
  await page.screenshot({ path: path.join(OUT, "desktop_en_edit_steps.png") });
  await dlg.getByRole("button", { name: "Back" }).click();
  await dlg.locator('[data-testid="teach-record-again"]').click();
  await recordFull(page, dlg, "en", "desktop_en");

  // The row now leads with Fill with Clara + chip.
  await page.waitForTimeout(400);
  const after = rowByName(page, name);
  const primary = after.locator('[data-testid="row-actions"] > [data-testid="row-cta"]').first();
  const label = (await primary.innerText()).trim();
  check("learned row: 'Fill with Clara' is the primary action", label === "Fill with Clara" && (await primary.getAttribute("data-cta")) === "assist", label);
  check("learned row: 'Clara learned this' chip", (await after.locator('[data-testid="row-learned"]').innerText().catch(() => "")).includes("Clara learned this"));
  await after.locator('[data-testid="row-more"]').click();
  const moreItems = await after.locator('[data-testid="row-more-item"]').allInnerTexts();
  check("learned row: Re-teach Clara + portal in ⋯", moreItems.some((t) => /Re-teach Clara/.test(t)) && moreItems.some((t) => /portal/i.test(t)), moreItems.join(" | "));
  await page.keyboard.press("Escape");
  await after.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "desktop_en_learned_row.png") });
  await primary.click();
  const fillDlg = page.locator('[data-testid="learned-fill-dialog"]');
  check("Fill with Clara opens the strict replay (business needed first here)", await fillDlg.waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
  await page.screenshot({ path: path.join(OUT, "desktop_en_fill_with_clara.png") });
  await page.keyboard.press("Escape");

  // Spanish: learned row + a second recording on another row.
  if (await toSpanish(page)) {
    // Names are translated; find the learned row by its chip.
    const esRow = page.locator('.spr-requirements-main .ck-card-line:has([data-testid="row-learned"])').first();
    const esLabel = (await esRow.locator('[data-testid="row-actions"] > [data-testid="row-cta"]').first().innerText().catch(() => "")).trim();
    check("ES: learned row primary 'Llenar con Clara' + chip", esLabel === "Llenar con Clara" && /Clara lo aprendió/.test(await esRow.locator('[data-testid="row-learned"]').innerText().catch(() => "")), esLabel);
    await esRow.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, "desktop_es_learned_row.png") });
    const other = rowsWithMenu(page).filter({ hasNot: page.locator('[data-testid="row-learned"]') }).first();
    if (await other.count()) {
      const otherName = (await other.locator(".ck-name").innerText()).trim();
      const dlgEs = await openTeach(page, rowByName(page, otherName));
      // This row has no approved portal on file: the person types the portal's address (any portal).
      if (await dlgEs.locator('[data-testid="teach-need-url"]').waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) {
        await dlgEs.locator('[data-testid="teach-portal-url"]').fill("https://permisos.ejemplo.pr.gov/");
        await page.screenshot({ path: path.join(OUT, "desktop_es_portal_url.png") });
        await dlgEs.locator('[data-testid="teach-need-url"] button[type="submit"]').click();
      }
      await dlgEs.locator('[data-testid="teach-recording"]').waitFor({ timeout: 10000 }).catch(() => undefined);
      const banner = await dlgEs.locator(".tr-rec-banner").innerText().catch(() => "");
      check("ES: recording banner in Spanish", /Grabando/.test(banner), banner);
      await recordFull(page, dlgEs, "es", "desktop_es");
      const esOther = rowByName(page, otherName);
      check("ES: second learned row leads with 'Llenar con Clara'", (await esOther.locator('[data-testid="row-actions"] > [data-testid="row-cta"]').first().innerText()).trim() === "Llenar con Clara");
    }
  }
  check("desktop: no page errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

// Mobile EN/ES: recording needs a desktop (fallback, not the typed form); learned row on mobile.
{
  const { page, errors } = await openRequirements(browser, { mobile: true, shot });
  const learned = page.locator('.spr-requirements-main .ck-card-line:has([data-testid="row-learned"])').first();
  check("mobile: learned rows show 'Fill with Clara' + chip", (await learned.count()) > 0 && /Fill with Clara/.test(await learned.innerText()));
  if (await learned.count()) {
    await learned.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, "mobile_en_learned_row.png") });
  }
  const row = rowsWithMenu(page).filter({ hasNot: page.locator('[data-testid="row-learned"]') }).first();
  const name = (await row.locator(".ck-name").innerText()).trim();
  let dlg = await openTeach(page, rowByName(page, name));
  check("mobile: 'Recording needs a desktop' fallback", await dlg.locator('[data-testid="teach-needs-desktop"]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
  check("mobile: offers a screen-recording upload", (await dlg.locator('[data-testid="teach-upload-recording"]').count()) === 1);
  check("mobile: typed steps are secondary (not shown until asked)", (await dlg.locator('[data-testid="teach-form"]').count()) === 0);
  const fs = await dlg.locator(".tr-option b").first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  check("mobile: 16px body text", fs >= 16, String(fs));
  await page.screenshot({ path: path.join(OUT, "mobile_en_needs_desktop.png") });
  await page.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
  if (await toSpanish(page)) {
    // Names are translated now: take the same (first not-yet-learned) row.
    const esRow = rowsWithMenu(page).filter({ hasNot: page.locator('[data-testid="row-learned"]') }).first();
    dlg = await openTeach(page, esRow as unknown as ReturnType<typeof rowByName>);
    const t = await dlg.locator('[data-testid="teach-needs-desktop"]').innerText().catch(() => "");
    check("mobile ES: 'Grabar requiere una computadora'", /Grabar requiere una computadora/.test(t), t.slice(0, 80));
    await page.screenshot({ path: path.join(OUT, "mobile_es_needs_desktop.png") });
    await page.keyboard.press("Escape");
    const learnedEs = page.locator('.spr-requirements-main .ck-card-line:has([data-testid="row-learned"])').first();
    if (await learnedEs.count()) {
      await learnedEs.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, "mobile_es_learned_row.png") });
    }
  }
  check("mobile: no page errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

// Desktop with the live recorder not connected: clear fallback, not the typed form.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/**", (r) => (new URL(r.request().url()).pathname === "/api/clara-routines" ? json(r, 200, { signed_in: true, live_recorder: false, routines: [] }) : serve(r, shot)));
  await page.goto(`${base}/?resume=e2e-teach`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("button", { name: /Compute Requirements from Rules Engine/ }).click({ timeout: 90000 });
  await page.locator(".ck-summary").waitFor({ timeout: 30000 });
  const row = rowsWithMenu(page).first();
  const dlg = await openTeach(page, rowByName(page, (await row.locator(".ck-name").innerText()).trim()));
  check("no live recorder: clear fallback", await dlg.locator('[data-testid="teach-unavailable"]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
  await page.screenshot({ path: path.join(OUT, "desktop_en_recorder_unavailable.png") });
  await dlg.locator('[data-testid="teach-describe-instead"]').click();
  check("typed steps reachable as the secondary option", await dlg.locator('[data-testid="teach-form"]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
  check("recorder-unavailable: no page errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
