/**
 * Clara — missing requirements completed inside Clara (real browser).
 *
 * The page and components are real (next dev). /api calls are stubbed with a
 * small stateful backend: the Business Passport lives in memory, PATCH
 * /api/businesses/[id] { passport, mergePassport } merges into it, and
 * /api/agency-actions/filings recomputes each workflow's own missing items
 * from it — so a workflow becomes ready only when ITS fields are saved.
 *
 * Covers: interactive border/elevation tokens, Teach Clara admin styling and
 * admin-only visibility, Complete requirements opens a modal (no navigation),
 * only that workflow's missing fields, validation, cancel writes nothing,
 * partial save updates the count, full save moves the card to Ready to file
 * without a page reload, failed save keeps the modal and the values, focus
 * management + Escape.
 *
 *   BASE_URL=http://localhost:3217 E2E_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx tsx tests/clara-missing-requirements.e2e.mts [outDir]
 */
import { chromium, type Route, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.argv[2] || path.join(os.tmpdir(), "clara-missing");
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:3000";
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

// Workflow → the coverage keys its config needs (mirrors passportCoverageKeys).
const WORKFLOWS = [
  { ft: "OGPE_PERMISO_UNICO", agency: "OGPE", aen: "OGPe", title: "Permiso Único", keys: ["business.legalName", "contact.phone", "business.ein"] },
  { ft: "DEMO_REHEARSAL", agency: "DEMO_REHEARSAL", aen: "SmartPR Demo Portal", title: "Demo rehearsal portal", keys: ["business.legalName"] },
];
const LABELS: Record<string, string> = { "business.legalName": "Legal business name", "contact.phone": "Phone", "business.ein": "EIN" };

function initialPassport(): Record<string, Record<string, string>> {
  // Global Passport is far from complete (no address, entity type, email, …).
  return { business: { legalName: "Café Luna LLC" }, contact: {} };
}
let passport = initialPassport();
let patches: unknown[] = [];
let failNextPatch = false;
let filingsCalls = 0;
const has = (key: string) => { const [a, b] = key.split("."); return Boolean(passport[a!]?.[b!]); };

function filings() {
  return WORKFLOWS.map((w) => {
    const missing = w.keys.filter((k) => !has(k)).map((k) => ({ id: k, label_en: LABELS[k], label_es: LABELS[k], sensitive: false }));
    missing.push({ id: "suri_password", label_en: "SURI password", label_es: "Contraseña SURI", sensitive: true });
    const action = { id: w.ft, filing_type: w.ft, agency_id: w.agency, title_en: w.title, title_es: w.title, agency_en: w.aen, agency_es: w.aen, status: (w as { blocked?: string[] }).blocked?.length ? "blocked" : "ready", known: w.keys.length - missing.length + 1, total: w.keys.length, missing_items: missing, blocked_by: (w as { blocked?: string[] }).blocked ?? [], evidence_available: [], obligation_id: `ob-${w.ft}`, objective_en: `File ${w.title}.`, objective_es: `Radica ${w.title}.` };
    const status = (w as { blocked?: string[] }).blocked?.length ? "blocked" : missing.some((m) => !m.sensitive) ? "missing_information" : "ready_to_start";
    return { agency_id: w.agency, agency_name_en: w.aen, agency_name_es: w.aen, filings: [{ id: w.ft, action, obligation_id: `ob-${w.ft}`, requirement_id: null, obligation_name: w.title, obligation_status: "MISSING", filing_status: status, supported: true, title_en: w.title, title_es: w.title, agency_id: w.agency, agency_en: w.aen, agency_es: w.aen }] };
  });
}

function merge(into: Record<string, unknown>, from: Record<string, unknown>) {
  for (const [k, v] of Object.entries(from)) {
    if (v && typeof v === "object") merge((into[k] ??= {}) as Record<string, unknown>, v as Record<string, unknown>);
    else if (v !== "" && v != null) into[k] = v;
  }
}

function makeServe(admin: boolean) {
  return async (route: Route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname;
    const j = (b: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (p === "/api/me") return j({ user: { id: "u", email: "a@b.c", isAdmin: admin } });
    if (p === "/api/admin/me") return j({ admin });
    if (p === "/api/skills/match") return j({ matches: [] });
    if (p === "/api/businesses/b1" && req.method() === "PATCH") {
      if (failNextPatch) { failNextPatch = false; return j({ error: "query_failed" }, 500); }
      const body = req.postDataJSON() as { passport: Record<string, unknown>; mergePassport: boolean };
      patches.push(body);
      merge(passport as Record<string, unknown>, body.passport);
      return j({ business: {} });
    }
    if (p.startsWith("/api/businesses/")) return j({ business: { legal_name: "Café Luna LLC", municipality: "San Juan" }, evidence: [] });
    if (p === "/api/agency-actions/filings") { filingsCalls++; return j({ groups: filings(), readiness: { documents: [], filings: [] } }); }
    if (p === "/api/clara-workspace/passport") return j({ loaded: true, fields: [] });
    return j({ error: "stubbed" }, 404);
  };
}

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
const errors: string[] = [];

async function open(admin: boolean): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/**", makeServe(admin));
  await page.goto(`${base}/businesses/b1/agency-run`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator('[data-testid="clara-launch"]').waitFor({ timeout: 60000 });
  await page.locator('[data-testid="clara-not-ready-card"]').first().waitFor({ timeout: 30000 });
  return page;
}

// ---------------------------------------------------------------- non-admin
{
  const page = await open(false);
  await page.waitForTimeout(800);
  check("non-admin: Teach Clara is not rendered", (await page.locator('[data-testid="teach-clara-button"]').count()) === 0);
  await page.close();
}

// ---------------------------------------------------------------- admin
const page = await open(true);
await page.locator('[data-testid="teach-clara-button"]').waitFor({ timeout: 15000 });
const style = (sel: string) => page.locator(sel).first().evaluate((el) => { const c = getComputedStyle(el); return { border: c.borderTopColor, width: c.borderTopWidth, shadow: c.boxShadow, bg: c.backgroundColor, color: c.color }; });

// 1 — borders / elevation
const pass = await style('[data-testid="clara-passport-button"]');
check("Business Passport button: blue 1.5px border + elevation", pass.border === "rgb(147, 180, 255)" && /border-\[1\.5px\]/.test((await page.locator('[data-testid="clara-passport-button"]').getAttribute("class")) ?? "") && pass.shadow.includes("rgba(15, 23, 42, 0.06)"), JSON.stringify(pass));
const toggle = await style('[data-testid="clara-lang-toggle"]');
check("EN/ES toggle: #D7DEE8 border + elevation", toggle.border === "rgb(215, 222, 232)" && toggle.shadow !== "none", JSON.stringify(toggle));
const cta = await style('[data-testid="clara-complete-requirements"]');
check("Complete requirements button: #D7DEE8 border + elevation", cta.border === "rgb(215, 222, 232)" && cta.shadow.includes("0.06"), JSON.stringify(cta));

// 2 — Teach Clara admin styling
const teach = await style('[data-testid="teach-clara-button"]');
check("Teach Clara: amber admin styling", teach.bg === "rgb(255, 247, 230)" && teach.border === "rgb(242, 196, 109)" && teach.color === "rgb(138, 90, 0)", JSON.stringify(teach));
check("Teach Clara: Admin badge", (await page.locator('[data-testid="teach-clara-admin-badge"]').innerText()).trim().toLowerCase() === "admin");
await page.screenshot({ path: path.join(OUT, "1_launch_not_ready.png") });

// 12 — global Passport incompleteness does not gate: Demo needs only legalName (on file) → ready
const readyTitles = await page.locator('[data-testid="clara-launch"] [data-testid="clara-workflow-card"]').allInnerTexts();
check("workflow with its own fields complete is ready despite an incomplete Passport", readyTitles.length === 1 && /Demo rehearsal portal/.test(readyTitles[0]!), readyTitles.join(" | "));
const card = () => page.locator('[data-testid="clara-not-ready-card"]', { hasText: "Permiso Único" });
check("Permiso Único shows 2 items missing (sensitive run-time value not counted)", /2 items missing/.test(await card().locator('[data-testid="clara-missing-count"]').innerText()));

// 4/5 — opens a modal, no navigation
const urlBefore = page.url();
await page.evaluate(() => { (window as unknown as { __same: number }).__same = 7; });
const opener = card().locator('[data-testid="clara-complete-requirements"]');
await opener.click();
const modal = page.locator('[data-testid="clara-missing-modal"]');
await modal.waitFor({ timeout: 5000 });
check("Complete requirements opens a dialog", (await modal.getAttribute("role")) === "dialog" && (await modal.getAttribute("aria-modal")) === "true");
check("no navigation away (same URL, same document)", page.url() === urlBefore && (await page.evaluate(() => (window as unknown as { __same?: number }).__same)) === 7);

// 6/7 — only this workflow's missing fields
const fields = await modal.locator("[data-field]").evaluateAll((els) => els.map((e) => e.getAttribute("data-field")));
check("modal lists only the missing fields for this workflow", JSON.stringify(fields.sort()) === JSON.stringify(["business.ein", "contact.phone"]), fields.join(","));
check("completed Passport fields and sensitive values are not asked", !(await modal.innerText()).includes("Legal business name") && !(await modal.innerText()).includes("SURI password"));
check("focus moves into the dialog", await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="clara-missing-modal"]'))));
const save = modal.locator('[data-testid="clara-missing-save"]');
const primary = await save.evaluate((el) => getComputedStyle(el).backgroundColor);
check("Save & continue is the solid blue primary", primary === "rgb(37, 99, 235)", primary);
await page.screenshot({ path: path.join(OUT, "2_modal.png") });

// 14 — validation
check("Save disabled while required fields are empty", await save.isDisabled());
await modal.locator('[data-field="business.ein"]').fill("12-34");
await modal.locator('[data-field="business.ein"]').blur();
check("inline validation message for a bad EIN", /9 digits/.test(await modal.innerText()) && (await modal.locator('[data-field="business.ein"]').getAttribute("aria-invalid")) === "true");
check("Save still disabled with invalid input", await save.isDisabled());
await page.screenshot({ path: path.join(OUT, "3_validation.png") });

// 15 — cancel writes nothing; Escape closes and focus returns
await modal.locator('[data-testid="clara-missing-cancel"]').click();
check("Cancel closes without writing", (await modal.count()) === 0 && patches.length === 0);
check("focus returns to the opening button", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "clara-complete-requirements"));
await opener.click();
await modal.waitFor();
await page.keyboard.press("Escape");
check("Escape closes the dialog", (await modal.count()) === 0 && patches.length === 0);

// keyboard-only + focus trap
await opener.focus();
await page.keyboard.press("Enter");
await modal.waitFor();
for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
check("focus is trapped in the dialog", await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="clara-missing-modal"]'))));

// 14 (error) — failed save keeps the modal and the values
await modal.locator('[data-field="contact.phone"]').fill("787-555-0100");
await modal.locator('[data-field="business.ein"]').fill("66-1234567");
failNextPatch = true;
await save.click();
await modal.locator('[data-testid="clara-missing-error"]').waitFor({ timeout: 5000 });
check("failed save: modal stays open with an error", /couldn't save/.test(await modal.innerText()));
check("failed save: entered values kept", (await modal.locator('[data-field="business.ein"]').inputValue()) === "66-1234567");

// 8/10/11/16 — save → canonical Passport → eligibility → ready, no reload
const callsBefore = filingsCalls;
await save.click();
await modal.waitFor({ state: "detached", timeout: 10000 });
const last = patches[patches.length - 1] as { passport: Record<string, Record<string, string>>; mergePassport: boolean };
check("saved to the canonical Business Passport (PATCH /api/businesses/[id], merge)", last.mergePassport === true && last.passport.business?.ein === "66-1234567" && last.passport.contact?.phone === "787-555-0100", JSON.stringify(last));
check("only the modal's fields were written", Object.keys(last.passport.business ?? {}).join() === "ein" && Object.keys(last.passport.contact ?? {}).join() === "phone");
check("eligibility re-read after save", filingsCalls > callsBefore);
const promoted = page.locator('[data-testid="clara-launch"] [data-testid="clara-workflow-card"]', { hasText: "Permiso Único" });
await promoted.waitFor({ timeout: 5000 });
check("Permiso Único moved to Ready to file", (await card().count()) === 0);
check("newly ready card is highlighted", (await promoted.getAttribute("data-highlight")) === "1");
check("success toast", /ready to file Permiso Único/.test(await page.locator('[data-testid="clara-toast"]').innerText()));
check("no page reload happened", (await page.evaluate(() => (window as unknown as { __same?: number }).__same)) === 7);
await page.screenshot({ path: path.join(OUT, "4_ready.png") });

// 13 — partial completion updates the count: Demo also waits on a
// prerequisite filing, so saving its 2 fields leaves 1 blocker.
passport = initialPassport();
WORKFLOWS[1]!.keys = ["business.legalName", "contact.email", "addresses.municipality"];
(WORKFLOWS[1] as { blocked?: string[] }).blocked = ["DEPT_STATE_LLC_FORMATION"];
LABELS["contact.email"] = "Email"; LABELS["addresses.municipality"] = "Municipality";
await page.reload({ waitUntil: "domcontentloaded" });
const demo = () => page.locator('[data-testid="clara-not-ready-card"]', { hasText: "Demo rehearsal portal" });
await demo().waitFor({ timeout: 30000 });
check("Demo shows 3 items missing (2 fields + 1 prerequisite filing)", /3 items missing/.test(await demo().innerText()), await demo().innerText());
await page.evaluate(() => { (window as unknown as { __same: number }).__same = 9; });
await demo().locator('[data-testid="clara-complete-requirements"]').click();
await modal.waitFor();
check("prerequisite shown read-only, not as an input", (await modal.locator('[data-testid="clara-missing-prereqs"]').count()) === 1 && (await modal.locator("[data-field]").count()) === 2);
await modal.locator('[data-field="contact.email"]').fill("ana@example.com");
await modal.locator('[data-field="addresses.municipality"]').fill("San Juan");
await save.click();
await modal.waitFor({ state: "detached" });
await page.waitForFunction(() => /1 item missing/.test(Array.from(document.querySelectorAll('[data-testid="clara-not-ready-card"]')).map((e) => e.textContent).join()), null, { timeout: 5000 });
check("partial completion: 3 → 1 item missing, still not ready", /1 item missing/.test(await demo().innerText()));
check("partial completion toast: Saved to Business Passport", /Saved to Business Passport/.test(await page.locator('[data-testid="clara-toast"]').innerText()));
check("still no reload", (await page.evaluate(() => (window as unknown as { __same?: number }).__same)) === 9);

// ES
await page.getByRole("button", { name: "ES", exact: true }).click();
await page.locator('[data-testid="clara-not-ready-card"]').first().locator('[data-testid="clara-complete-requirements"]').click();
await modal.waitFor();
check("ES: modal in Spanish", /Guardar y continuar/.test(await modal.innerText()) && /para empezar este trámite/.test(await modal.innerText()));
await page.screenshot({ path: path.join(OUT, "5_es_modal.png") });
await page.keyboard.press("Escape");

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
