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
  check("active filing: name + agency", /Permiso Único/.test(await af.innerText()) && /OGPe/.test(await af.innerText()));
  check("stage: Action needed", (await af.getAttribute("data-stage")) === "action_needed");
  check("filing readiness 1 of 3 (only this filing's requirements)", /1 of 3 filing requirements done/.test(await af.innerText()));
  const next = await page.locator('[data-testid="active-filing-next"]').innerText();
  check("next step is the specific blocker with a reason", /Permiso Único/.test(next) && next.split("\n").length >= 3, next.replace(/\n/g, " | "));
  check("Continue names the blocker", /Continue: Permiso Único/.test(await page.locator('[data-testid="active-filing-continue"]').innerText()));
  const notice = await page.locator('[data-testid="municipality-conflict"]').innerText();
  check("conflict notice shows both values", /Camuy/.test(notice) && /Hatillo/.test(notice));
  check("conflict notice names affected requirements", /Patente Municipal/.test(notice));
  check("readiness flagged as possibly affected", /May change/.test(await page.locator('[data-testid="business-readiness"]').innerText()));
  check("never claims agency approval", !/approved/i.test(await af.innerText()));
  await page.screenshot({ path: path.join(OUT, "1_blockers_conflict.png"), fullPage: true });

  // ---- tiles: one shared panel, unsaved edits survive switching
  check("tiles start closed", (await page.locator('[data-testid="tile-detail-panel"]').isHidden()));
  await page.locator('[data-testid="tile-passport"]').click();
  check("tile highlighted + panel open", (await page.locator('[data-testid="tile-passport"]').getAttribute("data-selected")) === "1" && (await page.locator('[data-testid="tile-detail-panel"]').isVisible()));
  await page.getByRole("button", { name: "Edit passport" }).click();
  const input = page.locator('[data-testid="tile-passport-detail"] input[type="text"]').first();
  await input.waitFor({ timeout: 10000 });
  await input.fill("Unsaved edit 123");
  await page.locator('[data-testid="tile-location"]').click();
  check("switching: only one detail visible", (await page.locator('[data-testid="tile-passport-detail"]').isHidden()) && (await page.locator('[data-testid="tile-location-detail"]').isVisible()));
  check("switching: previous tile no longer highlighted", (await page.locator('[data-testid="tile-passport"]').getAttribute("data-selected")) === "0");
  await page.locator('[data-testid="tile-missing"]').click();
  await page.locator('[data-testid="tile-passport"]').click();
  check("unsaved Passport edit kept after switching tiles", (await input.inputValue()) === "Unsaved edit 123");
  check("only one panel container", (await page.locator('[data-testid="tile-detail-panel"]').count()) === 1);
  await page.screenshot({ path: path.join(OUT, "2_tile_panel.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="tile-passport"]').focus();
  await page.keyboard.press("Enter");
  check("keyboard: Enter on selected tile closes the panel", await page.locator('[data-testid="tile-detail-panel"]').isHidden());

  // review buttons open the matching tile, never overwrite
  await page.getByRole("button", { name: "Review location" }).click();
  check("Review location opens the location tile", (await page.locator('[data-testid="tile-location"]').getAttribute("data-selected")) === "1");
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
  await page.locator('[data-testid="tile-evidence"]').click();
  check("mobile: tile panel opens below tiles", await page.locator('[data-testid="tile-evidence-detail"]').isVisible());
  await page.screenshot({ path: path.join(OUT, "6_mobile_panel.png"), fullPage: true });
  await page.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
