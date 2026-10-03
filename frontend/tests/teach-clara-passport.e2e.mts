/**
 * Teach Clara → complete missing Business Passport details in place.
 *
 * Real page under next dev; the teach-session server logic runs in this
 * process (same functions the API routes call) with a mock recorder whose
 * current screen asks for First name, Last name, SSN/ITIN, Ciudadanía and a
 * password. Checks: three states (Passport ready / Needs information / New
 * Passport detail), save to Passport without leaving Teach Clara, readiness
 * count refresh, SSN masked and never in the page, Clara fills from the
 * Passport (protected value read only at fill time), passwords stay one-time.
 *
 *   BASE_URL=http://localhost:3217 E2E_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx tsx tests/teach-clara-passport.e2e.mts [outDir]
 */
import { chromium, type Page, type Route } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fillFromPassportTeach,
  fillPageFromPassportTeach,
  savePassportFieldTeach,
  secureFillTeach,
  startTeachSession,
  syncTeachSession,
  TeachSessionError,
  type TeachWorker,
} from "../src/lib/agency-runs/teach/teachSessions";
import { catalogEntry, PASSPORT_CATALOG, passportHas, protectedMarkerPaths, readPassportPath, setPassportPath } from "../src/lib/agency-runs/teach/passportCatalog";
import { maskedPreview, normalizeValue, type PassportStore } from "../src/lib/agency-runs/passportWrite";

const OUT = process.argv[2] || path.join(os.tmpdir(), "teach-clara-passport");
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:3000";
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const PORTAL = "https://sa.www4.irs.gov/modiein/";
const SSN = "123-45-6789";
const BIZ = "biz-p";
const viewer = { userId: randomUUID(), isAdmin: false };

// ---- the business's Passport (what the DB would hold) + the protected store
const passport: Record<string, unknown> = { business: { legalName: "Enrique's LLC" }, contact: { lastName: "Rivera" }, addresses: { municipality: "Arecibo" } };
const protectedValues = new Map<string, string>();
const store: PassportStore = {
  async save({ path: p, value }) {
    const v = normalizeValue(p, value);
    if (catalogEntry(p)?.sensitive) {
      protectedValues.set(p, String(v));
      setPassportPath(passport, protectedMarkerPaths(p).onFile, true);
      setPassportPath(passport, protectedMarkerPaths(p).last4, String(v).slice(-4));
    } else {
      setPassportPath(passport, p, v);
    }
    return { preview: maskedPreview(p, v) };
  },
  async readProtected({ path: p }) {
    return protectedValues.get(p) ?? null;
  },
};

// ---- mock recorder: one IRS "responsible party" screen
const typed: { value: string; selector: string | null }[] = [];
const inputFields = [
  { label: "First name", selector: "#first", kind: "text" },
  { label: "Last name", selector: "#last", kind: "text" },
  { label: "SSN or ITIN", selector: "#ssn", kind: "ssn" },
  { label: "Ciudadanía", selector: "#ciud", kind: "text" },
  { label: "Password", selector: "#pw", kind: "password" },
  { label: "Choose type of legal structure", selector: "#et0", kind: "choice", options: [{ label: "Sole Proprietor", selector: "#et0" }, { label: "Partnerships", selector: "#et1" }, { label: "Corporations", selector: "#et2" }, { label: "Limited Liability Company (LLC)", selector: "#et3" }, { label: "Estate", selector: "#et4" }] },
  { label: "Continue", selector: "#continueBtn", kind: "next" },
];
const chosen: string[] = [];
const events = [{ kind: "page", url: `${PORTAL}responsible-party`, title: "EIN Assistant", heading: "Responsible party", inputFields }];
const worker: TeachWorker = {
  async start() { return { sessionId: "w1", liveUrl: `${base}/__mock/live` }; },
  async events(_id, after) { return { items: events.slice(after).map((event, i) => ({ seq: after + i + 1, event, shot: false })), nextAfter: events.length, status: "running" }; },
  async stop() {},
  async secureFill(_id, input) { typed.push(input); return { ok: true }; },
  async choose(_id, input) { chosen.push(input.selector); return { ok: true }; },
  async shot() { return null; },
};

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
async function serve(route: Route): Promise<void> {
  const req = route.request();
  const u = new URL(req.url());
  const p = u.pathname;
  const body = req.method() === "POST" ? (JSON.parse(req.postData() || "{}") as Record<string, unknown>) : {};
  try {
    if (p === "/api/me") return json(route, 200, { user: null });
    if (p === "/api/clara-routines") return json(route, 200, { signed_in: true, live_recorder: true, recorder: { ok: true, reason: null, busy: false, message: null, operator_hint: null }, routines: [] });
    if (p === "/api/clara-playbooks") return json(route, 200, { signed_in: true, live_recorder: true, playbooks: [] });
    if (p === "/api/clara-workspace/passport") {
      return json(route, 200, { business_id: BIZ, loaded: true, fields: PASSPORT_CATALOG.filter((c) => !c.when || readPassportPath(passport, c.when.path) === "llc").map((c) => {
        const has = passportHas(passport, c.path);
        return { path: c.path, en: c.en, es: c.es, has, preview: has && !c.sensitive ? String(readPassportPath(passport, c.path)) : null };
      }) });
    }
    if (p === `/api/businesses/${BIZ}`) return json(route, 200, { business: { legal_name: "Enrique's LLC", municipality: "Arecibo" }, evidence: [] });
    if (p === "/api/teach-sessions" && req.method() === "POST") {
      const session = await startTeachSession({ worker }, { viewer, tier: "user", businessId: typeof body.business_id === "string" ? body.business_id : null, passport: JSON.parse(JSON.stringify(passport)), startUrl: String(body.start_url), portalName: String(body.portal_name ?? ""), form: String(body.form ?? "") });
      return json(route, 201, { session });
    }
    const m = p.match(/^\/api\/teach-sessions\/([^/]+)(?:\/(passport-detail|fill-from-passport|fill-page|secure-input))?$/);
    if (m) {
      const [, id, op] = m;
      if (!op) return json(route, 200, { session: await syncTeachSession({ worker }, viewer, id) });
      if (op === "passport-detail") return json(route, 200, await savePassportFieldTeach({ passportStore: store }, viewer, id, { path: String(body.path ?? ""), value: String(body.value ?? ""), option: typeof body.option === "string" ? body.option : undefined }));
      if (op === "fill-page") return json(route, 200, await fillPageFromPassportTeach({ worker, passportStore: store }, viewer, id, { continue: body.continue !== false }));
      if (op === "fill-from-passport") return json(route, 200, await fillFromPassportTeach({ worker, passportStore: store }, viewer, id, String(body.selector ?? "")));
      return json(route, 200, await secureFillTeach({ worker }, viewer, id, { value: String(body.value ?? ""), selector: typeof body.selector === "string" ? body.selector : null }));
    }
    if (p === "/__mock/live") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><body style='font:16px system-ui;padding:20px'>IRS EIN Assistant (mock live view)</body>" });
    return json(route, 404, { error: "stubbed" });
  } catch (err) {
    if (err instanceof TeachSessionError) return json(route, err.status, { error: err.code, message: err.message });
    console.error("stub error", p, err);
    return json(route, 500, { error: "server_error" });
  }
}

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
const errors: string[] = [];
async function open(width: number, height = 1000): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/**", serve);
  await page.route("**/__mock/**", serve);
  const q = new URLSearchParams({ mode: "teach", requirement: "irs_ein", name: "IRS EIN Confirmation Letter", agency: "IRS", portal: PORTAL });
  await page.goto(`${base}/businesses/${BIZ}/agency-run?${q}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator('[data-testid="clara-workspace"][data-mode="teach"]').waitFor({ timeout: 60000 });
  if (await page.locator('[data-testid="ws-portal-url"]').count()) await page.locator('[data-testid="ws-portal-url"]').fill(PORTAL);
  else if (await page.getByRole("button", { name: /Use a different address/ }).count()) {
    await page.getByRole("button", { name: /Use a different address/ }).click();
    await page.locator('[data-testid="ws-portal-url"]').fill(PORTAL);
  }
  await page.locator('[data-testid="ws-start"]').click();
  await page.locator('[data-testid="ws-page-fields"]').waitFor({ timeout: 60000 });
  return page;
}
const onFile = async (page: Page) => (await page.locator('[data-testid="ws-context-passport"]').innerText().catch(() => "")).trim();
const count = (t: string) => Number(t.match(/^(\d+)/)?.[1] ?? NaN);

// ---------------- desktop
{
  const page = await open(1440, 1000);
  const url0 = page.url();
  const card = page.locator('[data-testid="ws-page-fields"]');
  await card.scrollIntoViewIfNeeded();
  const needed = card.locator('[data-testid="ws-info-needed"]');
  const neededText = await needed.innerText();
  check("Needs information: 'Needed for this filing' + reuse copy", /Needed for this filing/.test(neededText) && /Add it once\. Clara can reuse it in future filings\./.test(neededText), neededText.replace(/\s+/g, " ").slice(0, 140));
  check("old 'isn't in the Passport yet' copy is gone", !/isn't in the Passport yet/.test(await card.innerText()));
  const neededPaths = await needed.locator('[data-testid="ws-needed-field"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-path")));
  check("needed: First name and SSN/ITIN (missing in the Passport)", neededPaths.includes("contact.firstName") && neededPaths.includes("contact.taxId"), neededPaths.join(","));
  const readyPaths = await card.locator('[data-testid="ws-ready-field"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-path")));
  check("Passport ready: Last name (on file) with 'Fill on page'", readyPaths.includes("contact.lastName") && (await card.locator('[data-testid="ws-ready-field"][data-path="contact.lastName"] [data-testid="ws-fill-from-passport"]').count()) === 1, readyPaths.join(","));
  check("passwords stay one-time (never offered for the Passport)", (await card.locator('[data-testid="ws-one-time-fields"] [data-kind="password"]').count()) === 1);
  const ssnInput = needed.locator('[data-testid="ws-needed-field"][data-path="contact.taxId"] input');
  check("SSN input is masked", (await ssnInput.getAttribute("type")) === "password");
  const before = await onFile(page);
  await page.screenshot({ path: path.join(OUT, "1_needed.png"), fullPage: false });

  // Save First name → saved to the Passport, shown as ready, readiness +1, no navigation.
  const fn = needed.locator('[data-testid="ws-needed-field"][data-path="contact.firstName"]');
  await fn.locator("input").fill("John");
  await fn.locator('[data-testid="ws-save-to-passport"]').click();
  const savedRow = card.locator('[data-testid="ws-ready-field"][data-path="contact.firstName"]');
  await savedRow.waitFor({ timeout: 10000 });
  check("after save: '✓ First name  John · Saved to Business Passport'", /First name/.test(await savedRow.innerText()) && (await savedRow.locator('[data-testid="ws-ready-preview"]').innerText()) === "John" && /Saved to Business Passport/.test(await savedRow.innerText()));
  check("saved into the business's Passport (canonical path), not a workflow copy", readPassportPath(passport, "contact.firstName") === "John");
  await page.waitForFunction((b) => document.querySelector('[data-testid="ws-context-passport"]')?.textContent?.trim() !== b, before, { timeout: 10000 }).catch(() => undefined);
  const after1 = await onFile(page);
  check("readiness count refreshes (+1)", count(after1) === count(before) + 1, `${before} → ${after1}`);
  check("never leaves Teach Clara", page.url() === url0);

  // SSN → protected store, masked after entry, never in the page.
  await ssnInput.fill(SSN);
  await needed.locator('[data-testid="ws-needed-field"][data-path="contact.taxId"] [data-testid="ws-save-to-passport"]').click();
  const ssnRow = card.locator('[data-testid="ws-ready-field"][data-path="contact.taxId"]');
  await ssnRow.waitFor({ timeout: 10000 });
  check("SSN saved and shown masked (•••-••-6789)", (await ssnRow.locator('[data-testid="ws-ready-preview"]').innerText()) === "•••-••-6789");
  check("SSN went to the protected store, not passport_json", protectedValues.get("contact.taxId") === "123456789" && readPassportPath(passport, "contact.taxId") === undefined && readPassportPath(passport, "contact.taxIdOnFile") === true);
  const html = await page.content();
  check("the full SSN is nowhere in the page", !html.includes(SSN) && !html.includes("123456789"));
  await page.waitForTimeout(500);
  const after2 = await onFile(page);
  check("readiness count refreshes again (+2 total)", count(after2) === count(before) + 2, `${before} → ${after2}`);
  // Legal structure (radio question on the page): pick from the page's options → saved to the Passport.
  const et = needed.locator('[data-testid="ws-needed-field"][data-path="business.entityType"]');
  check("choice question shown as 'Needed' with the page's options", (await et.count()) === 1 && (await et.locator('[data-testid="ws-choice-options"] [role="radio"]').count()) === 5);
  check("never presses Continue while something is missing", !chosen.includes("#continueBtn"));
  await et.getByRole("radio", { name: "Limited Liability Company (LLC)" }).click();
  await et.locator('[data-testid="ws-save-to-passport"]').click();
  await card.locator('[data-testid="ws-ready-field"][data-path="business.entityType"]').waitFor({ timeout: 10000 });
  check("entity type saved to the Passport as SmartPR's canonical type", readPassportPath(passport, "business.entityType") === "limited_liability_company");
  // Nothing missing now → Clara fills the screen from the Passport and presses Continue on her own.
  await page.locator('[data-testid="ws-fill-page-note"]').waitFor({ timeout: 10000 });
  const pageNote = await page.locator('[data-testid="ws-fill-page-note"]').innerText();
  check("auto: LLC picked on the page from the Passport, then Continue pressed", chosen.includes("#et3") && chosen.at(-1) === "#continueBtn" && /pressed “Continue”/.test(pageNote), `${chosen.join(",")} · ${pageNote}`);
  check("the auto-fill typed the Passport values on the page (first name, last name, SSN)", ["#first", "#last", "#ssn"].every((sel) => typed.some((t) => t.selector === sel)), typed.map((t) => t.selector).join(","));
  check("Information needed section empties once everything is added", (await card.locator('[data-testid="ws-info-needed"]').count()) === 0);

  // Clara fills from the Passport (protected value read only now, typed by the browser).
  await ssnRow.locator('[data-testid="ws-fill-from-passport"]').click();
  await page.waitForTimeout(400);
  check("Fill on page: the protected SSN goes only to the browser field", typed.at(-1)?.selector === "#ssn" && typed.at(-1)?.value === "123456789");
  await savedRow.locator('[data-testid="ws-fill-from-passport"]').click();
  await page.waitForTimeout(400);
  check("Fill on page: First name from the Passport", typed.at(-1)?.selector === "#first" && typed.at(-1)?.value === "John");

  // New Passport detail.
  await card.locator('[data-testid="ws-new-details-toggle"]').click();
  const nd = card.locator('[data-testid="ws-new-detail"][data-path="business.additional.ciudadania"]');
  check("New Passport detail offered for an unmapped field (Ciudadanía)", (await nd.count()) === 1 && /Save it to the Passport as/.test(await nd.innerText()));
  await nd.locator("input").fill("Estados Unidos");
  await nd.locator('[data-testid="ws-add-new-detail"]').click();
  await card.locator('[data-testid="ws-ready-field"][data-path="business.additional.ciudadania"]').waitFor({ timeout: 10000 });
  check("new detail saved to the Passport (business.additional.ciudadania)", readPassportPath(passport, "business.additional.ciudadania") === "Estados Unidos");
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "2_saved.png"), fullPage: false });
  await page.close();
}

// ---------------- mobile
{
  const page = await open(390, 844);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("mobile: no horizontal overflow", overflow <= 0, String(overflow));
  await page.locator('[data-testid="ws-page-fields"]').screenshot({ path: path.join(OUT, "3_mobile.png") });
  await page.close();
}

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
