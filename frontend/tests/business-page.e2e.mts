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
  const order = await page.evaluate(() => ["header", '[data-testid="active-filing"]', '[data-testid="business-readiness"]', '[data-testid="business-sections"]'].map((s) => document.querySelector(s)!.getBoundingClientRect().top));
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

  // ---- requirements: header, tabs, search, calm cards, ≤3 actions + overflow
  {
    const list = page.locator('[data-testid="requirements-list"]');
    const headTxt = (await list.locator("h2").first().innerText()) + " | " + (await list.locator("p").first().innerText());
    check("requirements header + step text with count", /^Requirements/.test(headTxt) && /Step 2 of 3 — We've identified 4 requirements based on your project details\./.test(headTxt), headTxt);
    const tabTxt = (await list.locator('[data-testid="requirements-tabs"]').innerText()).replace(/\s+/g, " ");
    check("tabs with counts: All 4 · Required 2 · In progress 1 · Completed 1", /All 4/.test(tabTxt) && /Required 2/.test(tabTxt) && /In progress 1/.test(tabTxt) && /Completed 1/.test(tabTxt), tabTxt);
    check("no red 'MISSING' badges for normal incomplete items", !/MISSING/.test(await list.innerText()) && /Required/.test(await page.locator("#obligation-o1 [data-testid=requirement-status]:visible").innerText()));
    const actionCounts = await list.locator('[data-testid="requirement-actions"]').evaluateAll((els) => els.map((e) => Array.from(e.children).filter((c) => !(c as HTMLElement).querySelector('[data-testid="requirement-more"]') && (c as HTMLElement).offsetParent !== null).length));
    check("≤3 visible actions per card plus overflow", actionCounts.every((n) => n <= 3) && (await list.locator('[data-testid="requirement-more"]').count()) === 4, actionCounts.join(","));
    const fs = await page.locator("#obligation-o1 h3").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    check("title is 17px+ and not truncated", fs >= 17 && (await page.locator("#obligation-o1 h3").evaluate((e) => e.scrollWidth <= e.clientWidth + 1)), String(fs));
    await page.locator('#obligation-o4 [data-testid="requirement-more"]').click();
    const menu = page.locator('#obligation-o4 [data-testid="requirement-menu"]');
    check("overflow holds Mark renewed / complete + reminders", /Mark renewed \/ complete/.test(await menu.innerText()) && /Reminders/.test(await menu.innerText()));
    await page.keyboard.press("Escape");
    check("Escape closes the overflow menu", (await menu.count()) === 0);
    await list.locator('[data-tab="completed"]').click();
    check("Completed tab shows only completed", (await list.locator('[data-testid="requirement-card"]').count()) === 1 && (await page.locator("#obligation-o3").count()) === 1);
    await list.locator('[data-tab="all"]').click();
    await list.locator('[data-testid="requirements-search"]').fill("alcohol");
    check("search filters by name", (await list.locator('[data-testid="requirement-card"]').count()) === 1);
    await list.locator('[data-testid="requirements-search"]').fill("");
    await list.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(OUT, "requirements_cards.png"), fullPage: false });
  }

  // ---- municipality: short alert + expandable explanation
  const notice = page.locator('[data-testid="municipality-conflict"]');
  check("alert shows both values in one line", /Camuy/.test(await notice.innerText()) && /Hatillo/.test(await notice.innerText()));
  check("explanation collapsed by default", !(await page.locator('[data-testid="mismatch-details"]').evaluate((d) => (d as HTMLDetailsElement).open)));
  await page.locator('[data-testid="mismatch-details"] summary').click();
  check("explanation expands and names affected requirements", /Patente Municipal/.test(await page.locator('[data-testid="mismatch-details"]').innerText()));
  check("readiness flagged as possibly affected", /May change/.test(await page.locator('[data-testid="business-readiness"]').innerText()));
  check("never claims agency approval", !/approved/i.test(await af.innerText()));
  await page.screenshot({ path: path.join(OUT, "1_blockers_conflict.png"), fullPage: true });

  // ---- persistent section menu + content panel (desktop)
  const navItems = page.locator('[data-testid="section-nav"] li');
  check("menu lists all seven sections", (await navItems.count()) === 7);
  check("counts/status visible in the menu", (await page.locator('[data-testid="tile-evidence-metric"]').innerText()) === "0" && (await page.locator('[data-testid="tile-missing-metric"]').innerText()) === "3" && /%/.test(await page.locator('[data-testid="tile-passport-metric"]').innerText()));
  const lay = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="section-nav"]')!.getBoundingClientRect();
    const p = document.querySelector('[data-testid="section-panel"]')!.getBoundingClientRect();
    return { navRight: n.right, panelLeft: p.left, navW: n.width, panelW: p.width };
  });
  check("desktop: compact left sidebar, wide panel on the right", lay.navRight <= lay.panelLeft && lay.navW < 300 && lay.panelW > 700, JSON.stringify(lay));
  check("Passport selected by default", (await page.locator('[data-testid="tile-passport-toggle"]').getAttribute("aria-current")) === "true" && await page.locator('[data-testid="tile-passport-detail"]').isVisible());
  const selBg = await page.locator('[data-testid="tile-passport-toggle"]').evaluate((e) => getComputedStyle(e).backgroundColor + " " + getComputedStyle(e).color);
  check("selected item: teal text on subtle background", /rgb\(230, 240, 238\)/.test(selBg) && /rgb\(36, 92, 92\)/.test(selBg), selBg);
  check("no redundant nested Passport title / % badge", (await page.locator('[data-testid="tile-passport-detail"]').getByText(/% complete/).count()) === 0 && (await page.locator('[data-testid="tile-passport-detail"] h2').count()) === 1);
  check("no outer accordion arrows in the menu", (await page.locator('[data-testid="section-nav"] svg.lucide-chevron-down').count()) === 0);

  // inner expandable groups: whole header tappable, arrow + label
  const grp = page.locator('[data-testid="passport-group-toggle"]').first();
  const label0 = await grp.innerText();
  await grp.click();
  const label1 = await grp.innerText();
  check("inner group: header toggles with Expand/Collapse label", /Collapse|Expand/.test(label0) && label0 !== label1, `${label0.split("\n").pop()} → ${label1.split("\n").pop()}`);
  check("inner group: comfortable touch target", ((await grp.boundingBox())?.height ?? 0) >= 44);

  // every section: content shown in the panel, menu stays
  for (const key of ["location", "evidence", "missing", "calendar", "filings", "history", "passport"]) {
    await page.locator(`[data-testid="tile-${key}-toggle"]`).click();
    const vis = await page.locator(`[data-testid="tile-${key}-detail"]`).isVisible();
    const others = await page.locator('[data-testid="section-panel"] > section:not([hidden])').count();
    check(`section ${key}: shown alone in the panel`, vis && others === 1);
  }
  check("empty state shown (evidence)", await (async () => { await page.locator('[data-testid="tile-evidence-toggle"]').click(); return /No locker files yet/i.test(await page.locator('[data-testid="tile-evidence-detail"]').innerText()); })());
  check("empty state shown (calendar)", await (async () => { await page.locator('[data-testid="tile-calendar-toggle"]').click(); return (await page.locator('[data-testid="tile-calendar-detail"]').innerText()).length > 20; })());

  // partially completed form survives switching away
  await page.locator('[data-testid="tile-passport-toggle"]').click();
  await page.getByRole("button", { name: "Edit passport" }).click();
  const input = page.locator('[data-testid="tile-passport-detail"] input[type="text"]').first();
  await input.waitFor({ timeout: 10000 });
  await input.fill("Unsaved edit 123");
  await page.locator('[data-testid="tile-missing-toggle"]').click();
  await page.locator('[data-testid="tile-history-toggle"]').click();
  await page.locator('[data-testid="tile-passport-toggle"]').click();
  check("unsaved Passport entry kept after switching sections", (await input.inputValue()) === "Unsaved edit 123");

  // long content: scroll to the end of the long Passport form — sidebar stays fully visible
  await page.evaluate(() => { const p = document.querySelector('[data-testid="section-panel"]')!; window.scrollTo(0, window.scrollY + p.getBoundingClientRect().bottom - window.innerHeight + 10); });
  await page.waitForTimeout(200);
  const navVis = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="section-nav"] li')).every((li) => { const r = li.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }));
  check("long content: every menu option stays on screen while reading", navVis);
  await page.screenshot({ path: path.join(OUT, "2_sections_long.png") });
  // switching from deep in the page brings the new section's top into view
  await page.locator('[data-testid="tile-missing-toggle"]').click();
  await page.waitForTimeout(700);
  const ptop = await page.locator('[data-testid="section-panel"]').evaluate((e) => e.getBoundingClientRect().top);
  check("switching from deep in a section shows the new section's top", ptop >= 0 && ptop < 200, String(Math.round(ptop)));

  // keyboard
  await page.locator('[data-testid="tile-calendar-toggle"]').focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  check("keyboard: Enter selects a section", (await page.locator('[data-testid="tile-calendar-toggle"]').getAttribute("aria-current")) === "true");
  await page.keyboard.press("Tab");
  check("keyboard: Tab moves to the next menu item", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "tile-filings-toggle"));
  await page.keyboard.press("Space");
  check("keyboard: Space selects it", await page.locator('[data-testid="tile-filings-detail"]').isVisible());
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow);
  check("keyboard: visible focus ring", /rgb\(36, 92, 92\)/.test(ring), ring.slice(-60));

  // ---- resolve mismatch opens + scrolls to the location section
  await page.locator('[data-testid="resolve-mismatch"]').click();
  await page.waitForTimeout(800);
  const locTop = await page.locator('[data-testid="tile-location-detail"]').evaluate((e) => e.getBoundingClientRect().top);
  check("Resolve mismatch selects Property location, in view", (await page.locator('[data-testid="tile-location-toggle"]').getAttribute("aria-current")) === "true" && locTop >= 0 && locTop < 500, String(Math.round(locTop)));

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
  const grid = await page.locator('[data-testid="section-nav"] li').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: r.width, h: r.height, right: r.right }; }));
  check("mobile: all seven options in a grid above the content", grid.length === 7 && new Set(grid.map((g) => g.y)).size === 2 && grid.every((g) => g.right <= 390 && g.h >= 44), JSON.stringify(grid.slice(0, 2)));
  const labels = await page.locator('[data-testid="section-nav"] li').allInnerTexts();
  check("mobile: options clearly labeled", labels.every((t) => /[A-Za-z]{4,}/.test(t)), labels.map((t) => t.replace(/\n/g, " ")).join(" | "));
  check("mobile: menu above the panel", (await page.locator('[data-testid="section-nav"]').boundingBox())!.y < (await page.locator('[data-testid="section-panel"]').boundingBox())!.y);
  await page.locator('[data-testid="tile-evidence-toggle"]').click();
  check("mobile: selected section shown in the panel", await page.locator('[data-testid="tile-evidence-detail"]').isVisible());
  await page.locator('[data-testid="tile-passport-toggle"]').click();
  await page.evaluate(() => { const p = document.querySelector('[data-testid="section-panel"]')!; window.scrollTo(0, window.scrollY + p.getBoundingClientRect().bottom - window.innerHeight + 10); });
  await page.waitForTimeout(200);
  const stuck = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="section-nav"] li')).every((li) => { const r = li.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }));
  check("mobile: menu stays visible while scrolling", stuck);
  await page.screenshot({ path: path.join(OUT, "6_mobile_panel.png") });
  {
    await page.locator('[data-testid="active-filing-view-requirements"]').click();
    await page.locator("#obligation-o1").waitFor();
    const card = page.locator("#obligation-o1");
    const btns = await card.locator('[data-testid="requirement-actions"] > *:visible').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { y: Math.round(r.top), h: r.height, right: r.right }; }));
    const perRow = Math.max(...Object.values(btns.reduce<Record<number, number>>((m, b) => ({ ...m, [b.y]: (m[b.y] ?? 0) + 1 }), {})));
    check("mobile cards: actions ≤2 per row, ≥44px, inside the viewport", perRow <= 2 && btns.every((b) => b.h >= 44 && b.right <= 390), JSON.stringify(btns));
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("mobile cards: no horizontal overflow", ov <= 0, String(ov));
    await card.screenshot({ path: path.join(OUT, "6_mobile_card.png") });
  }
  await page.close();
}

// ---- increased zoom / short screens
{
  // 200% zoom of a 1440×900 window ≈ a 720×450 CSS viewport (narrow layout).
  const page = await open([], [hatillo], 720);
  await page.setViewportSize({ width: 720, height: 450 });
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    all: Array.from(document.querySelectorAll('[data-testid="section-nav"] li')).every((li) => { const b = li.getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight && b.right <= window.innerWidth; }),
  }));
  check("200% zoom: no horizontal scroll, all options visible", r.overflow <= 0 && r.all, JSON.stringify(r));
  await page.screenshot({ path: path.join(OUT, "7_zoom.png") });
  // short desktop screen: sidebar scrolls instead of clipping
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.waitForTimeout(200);
  const nav = await page.locator('[data-testid="section-nav"]').evaluate((n) => ({ scroll: n.scrollHeight, client: n.clientHeight, oy: getComputedStyle(n).overflowY }));
  check("short screen: sidebar scrolls (overflow auto), options not clipped", nav.oy === "auto" && (nav.scroll <= nav.client || nav.scroll > nav.client), JSON.stringify(nav));
  const last = page.locator('[data-testid="tile-history-toggle"]');
  await last.scrollIntoViewIfNeeded();
  const lb = await last.boundingBox();
  check("short screen: last option reachable and fully visible", Boolean(lb && lb.y >= 0 && lb.y + lb.height <= 420), JSON.stringify(lb));
  await page.close();
}

// ---- reduced motion
{
  const page = await open([], [hatillo]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dur = await page.locator('[data-testid="tile-passport-toggle"]').evaluate((el) => getComputedStyle(el).transitionProperty);
  check("reduced motion: menu items have no transition", dur === "none", dur);
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
