/**
 * Clara filing workspace (launch → active filing) in a real browser.
 *
 * The page and every component are real (next dev); its /api calls are
 * stubbed with a scripted run so each backend state is deterministic:
 * launch screen (no composer, no browser, only applicable+ready filings,
 * "Not ready yet", Passport strip) → pick Permiso Único → pre-flight →
 * Start filing → run queued → running → paused (sign-in) → review → the
 * stepper/checklist follow each state; the sidebar collapses without
 * reloading the live browser; Business Passport opens over the run;
 * Stop Clara calls the stop endpoint; EN/ES.
 *
 *   BASE_URL=http://localhost:3217 E2E_CHROME=/path/to/chrome npx tsx tests/clara-workspace.e2e.mts [outDir]
 */
import { chromium, type Route } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.argv[2] || path.join(os.tmpdir(), "clara-workspace");
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:3000";
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const act = (ft: string, agency: string, aen: string, title: string, over: Record<string, unknown> = {}) => ({ id: ft, filing_type: ft, agency_id: agency, title_en: title, title_es: title, agency_en: aen, agency_es: aen, status: "ready", known: 9, total: 10, missing_items: [], blocked_by: [], evidence_available: [], ...over });
const opt = (ft: string, agency: string, aen: string, title: string, ob: string, status: string, over: Record<string, unknown> = {}) => ({ id: ft, action: act(ft, agency, aen, title, { obligation_id: ob, objective_en: `File ${title} with ${aen}.`, objective_es: `Radica ${title} con ${aen}.`, ...over }), obligation_id: ob, requirement_id: ob, obligation_name: title, obligation_status: "MISSING", filing_status: status, supported: true, title_en: title, title_es: title, agency_id: agency, agency_en: aen, agency_es: aen });
const groups = [
  { agency_id: "OGPE", agency_name_en: "OGPe", agency_name_es: "OGPe", filings: [opt("OGPE_PERMISO_UNICO", "OGPE", "OGPe", "Permiso Único", "ob-pu", "ready_to_start")] },
  { agency_id: "DEPT_STATE", agency_name_en: "Departamento de Estado", agency_name_es: "Departamento de Estado", filings: [opt("DEPT_STATE_LLC_FORMATION", "DEPT_STATE", "Departamento de Estado", "Registro de Corporación", "ob-llc", "ready_to_start")] },
  { agency_id: "HACIENDA_SURI", agency_name_en: "Departamento de Hacienda", agency_name_es: "Departamento de Hacienda", filings: [opt("SURI_MERCHANT_REGISTRATION", "HACIENDA_SURI", "Departamento de Hacienda", "Registro de Comerciante", "ob-rc", "missing_information", { missing_items: [{ id: "ein", label_en: "EIN", label_es: "EIN", sensitive: false }, { id: "naics", label_en: "NAICS", label_es: "NAICS", sensitive: false }] })] },
  { agency_id: "OTHER", agency_name_en: "Departamento de Salud", agency_name_es: "Departamento de Salud", filings: [{ ...opt("x", "OTHER", "Departamento de Salud", "Licencia Sanitaria", "ob-ls", "unsupported"), id: "unsupported:ob-ls", action: null, supported: false }] },
];
const preflight = { passport_items: [{ label_en: "Legal business name", label_es: "Nombre legal" }], questions: [], portal_name_en: "OGPe", portal_name_es: "OGPe", evidence_tags: [] };
const events: Record<string, unknown>[] = [];
const ev = (m: string, kind = "info") => events.push({ index: events.length, message: m, message_es: m, screenshot_url: "", created_at: new Date().toISOString(), kind });
let run: Record<string, unknown> = {};
let polls = 0;
let stopCalls = 0;
const script = (state: string) => {
  if (state === "queued") run = { ...run, status: "queued", live_url: null };
  if (state === "running-open") { ev("Opened OGPe."); run = { ...run, status: "running", live_url: `${base}/rehearsal-portal/login` }; }
  if (state === "running-fill") { ev("Filled business name"); ev("Filled address"); run = { ...run, status: "running" }; }
  if (state === "paused") { ev("Sign in on the portal yourself", "pause"); run = { ...run, status: "paused", pause_reason: "USER_LOGIN", pause_streak: 1, portal_step: { kind: "login", title: "Log in", missing: [], declared: true } }; }
  if (state === "review") { ev("Ready for your review", "review"); run = { ...run, status: "review", pause_reason: null, portal_step: null }; }
  run = { ...run, events: [...events] };
};
const passportFields = [
  { path: "business.legalName", en: "Business legal name", es: "Nombre legal", has: true, preview: "Joyas del Tropicana LLC" },
  { path: "contact.fullName", en: "Contact name", es: "Contacto", has: true, preview: "Ana L. Pérez Díaz" },
  { path: "property.cadastralNumber", en: "Cadastral number", es: "Catastro", has: false, preview: null },
];

async function serve(route: Route) {
  const u = new URL(route.request().url());
  const p = u.pathname;
  const m = route.request().method();
  const j = (b: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
  if (p === "/api/admin/me") return j({ admin: false });
  if (p === "/api/me") return j({ user: { id: "u", email: "a@b.c" } });
  if (p.startsWith("/api/businesses/")) return j({ business: { legal_name: "Ana L. Pérez Díaz", municipality: "Bayamón" }, evidence: [] });
  if (p === "/api/agency-actions/filings") return j({ groups, readiness: { documents: [{ id: "d1" }], filings: [] } });
  if (p === "/api/agency-actions/preflight") return j({ preflight, filing_label_en: "Permiso Único", filing_label_es: "Permiso Único" });
  if (p === "/api/clara-workspace/passport") return j({ loaded: true, fields: passportFields });
  if (p === "/api/agency-actions" && m === "POST") {
    run = { id: "r1", business_id: "b1", filing_type: "OGPE_PERMISO_UNICO", status: "queued", pause_reason: null, created_at: "", updated_at: "", events: [], worker: "browser_use", live_url: null, browser_use_session_id: "s", provider: "browser_use_cloud", pause_streak: 0, pending_fields: [], portal_step: null, supplied_field_ids: [], goal_brief: null, filing_authorized: false, filing_confirmation: null };
    script("queued");
    return j({ run, brief: null });
  }
  if (p === "/api/agency-runs/r1/stop") { stopCalls++; run = { ...run, status: "stopped" }; return j({ run }); }
  if (p === "/api/agency-runs/r1") { polls++; return j({ run }); }
  if (p.startsWith("/api/agency-runs/r1/")) return j({ run });
  return j({ error: "stubbed" }, 404);
}

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/api/**", serve);
await page.goto(`${base}/businesses/b1/agency-run`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.locator('[data-testid="clara-launch"]').waitFor({ timeout: 60000 });
await page.locator('[data-testid="clara-workflow-card"]').first().waitFor({ timeout: 30000 });

// ---- launch screen
check("launch: 'Ready to file with Clara'", (await page.getByRole("heading", { name: "Ready to file with Clara" }).count()) === 1);
check("launch: no chat composer / free-form box", (await page.locator('[data-testid="chat-composer"], textarea').count()) === 0);
check("launch: no browser panel before a run", (await page.locator('[data-testid="clara-browser"]').count()) === 0);
const titles = await page.locator('[data-testid="clara-launch"] [data-testid="clara-workflow-card"]').allInnerTexts();
check("launch: only ready filings are cards (Permiso Único, Registro de Corporación)", titles.length === 2 && titles.some((t) => /Permiso Único/.test(t)) && titles.some((t) => /Registro de Corporación/.test(t)), titles.map((t) => t.split("\n")[1]).join(", "));
check("launch: unsupported (Licencia Sanitaria) not shown", !(await page.locator('[data-testid="clara-launch"]').innerText()).includes("Licencia Sanitaria"));
const notReady = await page.locator('[data-testid="clara-not-ready-card"]').allInnerTexts();
check("launch: not-ready filing listed separately, not launchable", notReady.length === 1 && /Registro de Comerciante/.test(notReady[0]) && /2 items missing/.test(notReady[0]) && (await page.locator('[data-testid="clara-not-ready-card"] [data-testid="clara-workflow-card"]').count()) === 0, notReady.join(" | "));
const strip = await page.locator('[data-testid="clara-autofill-strip"] li').evaluateAll((els) => els.map((e) => `${e.textContent?.trim()}:${e.getAttribute("data-available")}`));
check("launch: Passport strip reflects this business", strip.some((s) => s.startsWith("Business details") && s.endsWith(":1")) && strip.some((s) => s.startsWith("Documents") && s.endsWith(":1")), strip.join(", "));
check("launch: Business Passport button top-right", (await page.locator('[data-testid="clara-passport-button"]').count()) === 1);
await page.screenshot({ path: path.join(OUT, "1_launch.png") });

// ---- pick Permiso Único
await page.locator('[data-testid="clara-workflow-card"]', { hasText: "Permiso Único" }).first().click();
await page.locator('[data-testid="clara-active"]').waitFor({ timeout: 15000 });
await page.getByRole("button", { name: "Start filing" }).waitFor({ timeout: 15000 });
check("active: filing header shows the workflow", /Permiso Único/.test(await page.locator('[data-testid="clara-filing-header"]').innerText()));
check("active: stepper at Prepare, waiting on you (pre-flight)", (await page.locator('[data-testid="clara-stepper"] li').first().getAttribute("data-state")) === "waiting");
check("active: still no browser before the run starts", (await page.locator('[data-testid="clara-browser"]').count()) === 0);
await page.screenshot({ path: path.join(OUT, "2_prepare.png") });
await page.getByRole("button", { name: "Start filing" }).click();
await page.locator('[data-testid="clara-browser"]').waitFor({ timeout: 15000 });
check("run: browser panel appears once the run starts", true);
const stepState = async () => page.locator('[data-testid="clara-stepper"]').getAttribute("data-step");
check("run queued → Open portal", (await stepState()) === "1");

script("running-open");
script("running-fill");
await page.waitForFunction(() => document.querySelector('[data-testid="clara-stepper"]')?.getAttribute("data-step") === "2", null, { timeout: 15000 });
check("run running in the portal → Complete forms (from the polled run, not a timer)", (await stepState()) === "2");
check("checklist: Filling application is current", (await page.locator('[data-testid="clara-phase"][data-phase="FILL_FIELDS"]').getAttribute("data-state")) === "current");
await page.screenshot({ path: path.join(OUT, "3_filling.png") });

// ---- collapse the sidebar: the live browser must not reload
const frameSrc = await page.locator('[data-testid="clara-browser"] iframe').first().getAttribute("src");
await page.evaluate(() => { (document.querySelector('[data-testid="clara-browser"] iframe') as HTMLIFrameElement & { __mark?: number }).__mark = 42; });
await page.locator('[data-testid="clara-sidebar-toggle"]').click();
await page.waitForTimeout(400);
check("sidebar collapses", (await page.locator('[data-testid="clara-sidebar"]').getAttribute("data-collapsed")) === "1");
const sameFrame = await page.evaluate(() => (document.querySelector('[data-testid="clara-browser"] iframe') as HTMLIFrameElement & { __mark?: number })?.__mark === 42);
check("collapsing keeps the same browser element (no reload)", sameFrame && (await page.locator('[data-testid="clara-browser"] iframe').first().getAttribute("src")) === frameSrc);
await page.screenshot({ path: path.join(OUT, "4_collapsed.png") });
await page.locator('[data-testid="clara-sidebar-toggle"]').click();

// ---- Business Passport during the run
await page.locator('[data-testid="clara-passport-button"]').click();
await page.locator('[data-testid="clara-passport-drawer"]').waitFor({ timeout: 5000 });
check("Business Passport opens over the running filing", /Joyas del Tropicana/.test(await page.locator('[data-testid="clara-passport-drawer"]').innerText()) && (await page.locator('[data-testid="clara-browser"]').count()) === 1);
await page.screenshot({ path: path.join(OUT, "5_passport.png") });
await page.keyboard.press("Escape");
await page.locator('[data-testid="clara-passport-drawer"] button[aria-label="Close"]').click();

// ---- pause, then review (approval gate)
script("paused");
await page.waitForFunction(() => document.querySelector('[data-testid="clara-progress-heading"]')?.textContent?.includes("needs your help"), null, { timeout: 15000 });
check("paused → 'Clara needs your help', step waiting", (await page.locator('[data-testid="clara-stepper"] li[aria-current="step"]').getAttribute("data-state")) === "waiting");
script("review");
await page.waitForFunction(() => document.querySelector('[data-testid="clara-stepper"]')?.getAttribute("data-step") === "4", null, { timeout: 15000 });
check("review → Ready to submit (waiting on you), never auto-submitted", (await page.locator('[data-testid="clara-progress-heading"]').innerText()).includes("Ready for your review"));
await page.screenshot({ path: path.join(OUT, "6_review.png") });

// ---- Stop Clara uses the real stop endpoint
await page.locator('[data-testid="clara-stop"]').click();
await page.waitForFunction(() => document.querySelector('[data-testid="clara-progress-heading"]')?.textContent?.includes("stopped"), null, { timeout: 15000 });
check("Stop Clara calls POST /api/agency-runs/[id]/stop", stopCalls === 1);
check("after stopping: 'Clara stopped' + Start again", (await page.locator('[data-testid="clara-start-again"]').count()) === 1);
await page.screenshot({ path: path.join(OUT, "7_stopped.png") });

// ---- Spanish
await page.getByRole("button", { name: "ES", exact: true }).click();
await page.waitForTimeout(400);
const header = await page.locator('[data-testid="clara-workspace-shell"] header').innerText();
check("ES: header and Passport button in Spanish", /Pasaporte del negocio/.test(header) && /asistente/.test(header));
await page.locator('[data-testid="clara-back-to-workflows"]').click();
await page.locator('[data-testid="clara-launch"]').waitFor({ timeout: 5000 });
check("ES: launch screen in Spanish", (await page.getByRole("heading", { name: "Lista para radicar con Clara" }).count()) === 1);
await page.screenshot({ path: path.join(OUT, "8_es_launch.png") });
check("polled the real run endpoint", polls > 0);
check("no page errors", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
