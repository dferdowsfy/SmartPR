/**
 * Business page — active filing focus, readiness, municipality conflict and
 * the shared tile detail panel (real page under next dev, stubbed /api).
 *
 * Scenarios: active filing with blockers; Clara run at review (ready for
 * review); Clara run submitted (waiting on agency); Passport vs saved
 * location municipality conflict; switching tiles with unsaved Passport
 * edits; header actions at 390px with no horizontal overflow.
 *
 *   BASE_URL=http://localhost:3217 E2E_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx tsx tests/business-page.e2e.mts [outDir]
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENCY_FILING_CONFIGS } from "../src/lib/agency-runs/filingTypes";

const OUT = process.argv[2] || path.join(os.tmpdir(), "business-page");
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:3000";
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const PU_REQ = AGENCY_FILING_CONFIGS.find((c) => c.id === "OGPE_PERMISO_UNICO")!.requirementIds![0]!;
const ob = (id: string, name: string, status: string, extra: Record<string, unknown> = {}) => ({ id, name, agency: "OGPe", matter_id: "m1", matter_title: "Permiso Único", requirement_id: null, status, due_date: null, due_date_source: "UNKNOWN", source_reference: null, next_action: "Upload", ...extra });

function detail(runs: { filing_type: string; status: string }[], municipality = "Camuy") {
  return {
    business: { id: "amigos", public_id: "amigos", legal_name: "Amigos", name: "Amigos", business_type: "Bar", municipality, entity_number: "123456", onboarding_mode: "NEW", created_at: "2026-09-01", passport_json: { business: { legalName: "Amigos" } } },
    matters: [{ id: "m1", matter_type: "OTHER", title: "Permiso Único", status: "IN_PROGRESS", readiness_score: 50, opened_at: "2026-09-01", completed_at: null, submission_id: null, due_date: null, due_date_source: "UNKNOWN", source_reference: null }],
    obligations: [
      ob("o1", "Permiso Único", "MISSING", { requirement_id: PU_REQ }),
      ob("o2", "Licencia de alcohol", "NEEDS_ATTENTION", { requirement_id: "DOC_ALCOHOL_LICENSE", agency: "Hacienda" }),
      ob("o3", "Certificación de Bomberos", "COMPLETED"),
      ob("o4", "Patente Municipal", "MISSING", { matter_id: null, agency: "Municipio de Camuy" }),
    ],
    evidence: [], submissions: [], notifications: [], deliverables: [], agency_runs: runs,
  };
}
const hatillo = { id: "l1", name: "Local principal", is_primary: true, municipality: "Hatillo", latitude: 18.4, longitude: -66.8, geographies: [{ geography_type: "municipality", geography_name: "Hatillo", determination_method: "SPATIAL_INTERSECTION", determined_at: "2026-09-01" }] };

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
const errors: string[] = [];

async function open(runs: { filing_type: string; status: string }[], locations: unknown[], width = 1440): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const j = (b: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(b) });
    if (p === "/api/businesses/amigos") return j(detail(runs));
    if (p.endsWith("/locations")) return j({ locations, can_edit: true });
    if (p === "/api/me") return j({ user: { id: "u" } });
    return j({});
  });
  await page.goto(`${base}/businesses/amigos`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator('[data-testid="active-filing"]').waitFor({ timeout: 60000 });
  return page;
}

// ---- 1. active filing with blockers + mismatch, desktop
{
  const page = await open([], [hatillo]);
  await page.locator('[data-testid="municipality-conflict"]').waitFor({ timeout: 10000 });
  const af = page.locator('[data-testid="active-filing"]');
  check("no Clara banner in the content flow", (await page.getByText("File with Clara").count()) === 0);
  check("Open Clara is a secondary header action → Clara route", (await page.locator('[data-testid="open-clara"]').getAttribute("href")) === "/businesses/amigos/agency-run");
  const order = await page.evaluate(() => ["header", '[data-testid="active-filing"]', '[data-testid="business-readiness"]', '[data-testid="business-tiles"]'].map((s) => document.querySelector(s)!.getBoundingClientRect().top));
  check("hierarchy: overview → active filing → (readiness beside) → tiles", order[0]! < order[1]! && order[1]! <= order[2]! && order[2]! < order[3]!, order.join(","));
  check("compact card: filing name", /Permiso Único/.test(await af.innerText()));
  check("stage: Action needed", (await af.getAttribute("data-stage")) === "action_needed");
  check("filing readiness 1 of 3 (only this filing's requirements)", /1 of 3 requirements done/.test(await af.innerText()));
  const next = await page.locator('[data-testid="active-filing-next"]').innerText();
  check("compact card: next action names the specific blocker", /Next:\s*Permiso Único/.test(next), next.replace(/\n/g, " | "));
  check("compact card: no inline blocker list", (await page.locator('[data-testid="active-filing-blockers"]').count()) === 0);
  check("Continue → the blocker's requirement row", (await page.locator('[data-testid="active-filing-continue"]').getAttribute("href")) === "#obligation-o1");
  await page.locator('[data-testid="active-filing-view-requirements"]').click();
  await page.locator("#all-requirements").waitFor({ timeout: 5000 });
  check("View requirements opens the full list", await page.locator("#all-requirements").isVisible());

  // ---- municipality: short alert + expandable explanation
  const notice = page.locator('[data-testid="municipality-conflict"]');
  check("alert shows both values in one line", /Camuy/.test(await notice.innerText()) && /Hatillo/.test(await notice.innerText()));
  check("explanation collapsed by default", !(await page.locator('[data-testid="mismatch-details"]').evaluate((d) => (d as HTMLDetailsElement).open)));
  await page.locator('[data-testid="mismatch-details"] summary').click();
  check("explanation expands and names affected requirements", /Patente Municipal/.test(await page.locator('[data-testid="mismatch-details"]').innerText()));
  check("readiness flagged as possibly affected", /May change/.test(await page.locator('[data-testid="business-readiness"]').innerText()));
  check("never claims agency approval", !/approved/i.test(await af.innerText()));
  await page.screenshot({ path: path.join(OUT, "1_blockers_conflict.png"), fullPage: true });

  // ---- accordions: single column, content directly under its own header
  check("sections start closed, counts/status visible", (await page.locator('[data-testid="tile-evidence-metric"]').innerText()) === "0" && (await page.locator('[data-testid="tile-missing-metric"]').innerText()) === "3");
  const xs = await page.locator('[data-testid="business-tiles"] > section').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  check("single column", new Set(xs).size === 1 && xs.length === 7, xs.join(","));
  await page.locator('[data-testid="tile-missing-toggle"]').click();
  const geo = await page.evaluate(() => ({
    head: document.querySelector('[data-testid="tile-missing-toggle"]')!.getBoundingClientRect().bottom,
    body: document.querySelector('[data-testid="tile-missing-detail"]')!.getBoundingClientRect().top,
    nextHead: document.querySelector('[data-testid="tile-calendar-toggle"]')!.getBoundingClientRect().top,
  }));
  check("content opens directly under its own header (not at the bottom)", geo.body >= geo.head - 1 && geo.body - geo.head < 24 && geo.nextHead > geo.body, JSON.stringify(geo));
  check("aria-expanded reflects state", (await page.locator('[data-testid="tile-missing-toggle"]').getAttribute("aria-expanded")) === "true");
  await page.locator('[data-testid="tile-passport-toggle"]').click();
  check("one open at a time", (await page.locator('[data-testid="tile-missing-detail"]').isHidden()) && (await page.locator('[data-testid="tile-passport-detail"]').isVisible()));
  await page.getByRole("button", { name: "Edit passport" }).click();
  const input = page.locator('[data-testid="tile-passport-detail"] input[type="text"]').first();
  await input.waitFor({ timeout: 10000 });
  await input.fill("Unsaved edit 123");
  await page.locator('[data-testid="tile-location-toggle"]').click();
  await page.locator('[data-testid="tile-missing-toggle"]').click();
  await page.locator('[data-testid="tile-passport-toggle"]').click();
  check("unsaved Passport edit kept after switching sections", (await input.inputValue()) === "Unsaved edit 123");
  await page.screenshot({ path: path.join(OUT, "2_accordion.png"), fullPage: true });

  // ---- keyboard
  await page.locator('[data-testid="tile-evidence-toggle"]').focus();
  await page.keyboard.press("Enter");
  check("keyboard: Enter opens a section", await page.locator('[data-testid="tile-evidence-detail"]').isVisible());
  await page.keyboard.press("Space");
  check("keyboard: Space closes it", await page.locator('[data-testid="tile-evidence-detail"]').isHidden());
  await page.keyboard.press("Tab");
  check("keyboard: Tab moves to the next section header", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "tile-missing-toggle"));
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow);
  check("keyboard: visible focus ring", /rgb\((?!0, 0, 0\))|rgba\([^)]*, (?:0\.[1-9]|1)\)/.test(ring) || /inset/.test(ring), ring.slice(-60));

  // ---- resolve mismatch opens + scrolls to the location section
  await page.locator('[data-testid="resolve-mismatch"]').click();
  await page.waitForTimeout(800);
  const locTop = await page.locator('[data-testid="tile-location"]').evaluate((e) => e.getBoundingClientRect().top);
  check("Resolve mismatch opens the location section in view", (await page.locator('[data-testid="tile-location-detail"]').isVisible()) && locTop >= 0 && locTop < 400, String(locTop));

  // ---- routes unchanged
  check("routes: Start filing", (await page.getByRole("link", { name: "Start New Filing / Renewal" }).first().getAttribute("href")) === "/businesses/amigos/matters/new");
  await page.close();
}

// ---- 2. ready for review (Clara run at the submit gate)
{
  const page = await open([{ filing_type: "OGPE_PERMISO_UNICO", status: "review" }], []);
  const af = page.locator('[data-testid="active-filing"]');
  check("Clara run at review → Ready for review", (await af.getAttribute("data-stage")) === "ready_for_review" && /nothing has been submitted/.test(await af.innerText()));
  check("Continue goes to Clara", (await page.locator('[data-testid="active-filing-continue"]').getAttribute("href")) === "/businesses/amigos/agency-run");
  check("no conflict notice without a location", (await page.locator('[data-testid="municipality-conflict"]').count()) === 0);
  await page.screenshot({ path: path.join(OUT, "3_review.png") });
  await page.close();
}

// ---- 3. submitted, waiting on agency
{
  const page = await open([{ filing_type: "OGPE_PERMISO_UNICO", status: "submitted" }], []);
  const af = page.locator('[data-testid="active-filing"]');
  check("Clara run submitted → waiting on agency (not approved)", (await af.getAttribute("data-stage")) === "submitted_waiting" && /doesn't receive the agency's decision/.test(await af.innerText()));
  await page.screenshot({ path: path.join(OUT, "4_submitted.png") });
  await page.close();
}

// ---- 4. mobile header + layout
{
  const page = await open([], [hatillo], 390);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("mobile: no horizontal overflow", overflow <= 0, String(overflow));
  const [start, clara] = await Promise.all([
    page.getByRole("link", { name: "Start New Filing / Renewal" }).first().boundingBox(),
    page.locator('[data-testid="open-clara"]').boundingBox(),
  ]);
  check("mobile: header actions visible and inside the viewport", Boolean(start && clara && clara.x + clara.width <= 390 && start.x + start.width <= 390));
  const claraBg = await page.locator('[data-testid="open-clara"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  check("Clara stays secondary (white, not the brand fill)", claraBg === "rgb(255, 255, 255)", claraBg);
  await page.screenshot({ path: path.join(OUT, "5_mobile.png"), fullPage: true });
  await page.locator('[data-testid="tile-evidence-toggle"]').click();
  check("mobile: section opens under its header", await page.locator('[data-testid="tile-evidence-detail"]').isVisible());
  await page.screenshot({ path: path.join(OUT, "6_mobile_panel.png"), fullPage: true });
  await page.close();
}

// ---- reduced motion
{
  const page = await open([], [hatillo]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dur = await page.locator('[data-testid="tile-passport-toggle"] svg').last().evaluate((el) => getComputedStyle(el).transitionProperty);
  check("reduced motion: chevron has no transition", dur === "none", dur);
  await page.locator('[data-testid="municipality-conflict"]').waitFor();
  const t0 = Date.now();
  await page.locator('[data-testid="resolve-mismatch"]').click();
  await page.waitForTimeout(100);
  const y1 = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(500);
  const y2 = await page.evaluate(() => window.scrollY);
  check("reduced motion: scroll jumps and settles at once (no smooth animation)", y1 > 0 && y1 === y2, `${y1} → ${y2} (${Date.now() - t0}ms)`);
  await page.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
