/**
 * Requirements step — browser test of the REAL SmartPRIntake page.
 *
 * The component-only harness missed layout bugs (double numbering, group
 * order, groups rendered open), so this drives the actual page: a workflow
 * snapshot is restored through `?resume=`, the rules engine computes the
 * requirements in the browser exactly as it does live, and the rendered DOM
 * is checked. Only the network edge is stubbed (/api/**; the database-free
 * /api/incentives/evaluate route runs for real): the snapshot
 * carries the golden's profile, intake answers and the project context the
 * REAL validator (validateProjectContext) produces from the model fixture
 * and the user's own description.
 *
 * Usage (dev server running without Supabase env):
 *   BASE_URL=http://localhost:3000 npx tsx tests/requirements-checklist.e2e.mts [outDir] [golden]
 *   BASE_URL=… npx tsx tests/requirements-checklist.e2e.mts [outDir] location   (intake location step)
 *   (E2E_CHROME=/path/to/chromium to use a system browser)
 * Exits non-zero on any failed check.
 */
import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProjectContext } from "../src/app/ai/intake/projectContext";

const OUT = process.argv[2] || os.tmpdir();
const GOLDEN = process.argv[3] || "E07_rooftop_solar_installation_guaynabo.json";
const base = process.env.BASE_URL || "http://localhost:3000";
const here = path.dirname(fileURLToPath(import.meta.url));

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

// ---------------------------------------------------------------------------
// Location flow (`… tests/requirements-checklist.e2e.mts <outDir> location`):
// the prompt mentions Guaynabo → the intake shows the inline "Where is it?"
// card prefilled with Guaynabo → the user confirms a pin → the requirements
// show "Rules for: …" and the municipio-specific rules (patente, metro-flag
// rules for an auto repair shop). "Change" moves the pin to Adjuntas and the
// metro rules go away. Geocoding is stubbed; the Census municipio lookup
// (/api/locations/resolve) runs for real.
// ---------------------------------------------------------------------------
if (GOLDEN === "location") {
  const GUAYNABO = { latitude: 18.3577, longitude: -66.1108 };
  const ADJUNTAS = { latitude: 18.1627, longitude: -66.7224 };
  const guaynaboCandidate = {
    ...GUAYNABO,
    formatted_address: "Calle José de Diego, Guaynabo, PR 00969",
    address_line_1: "Calle José de Diego",
    city: "Guaynabo",
    municipality: "Guaynabo",
    state_or_region: "Puerto Rico",
    postal_code: "00969",
    country_code: "PR",
    place_source: "stub",
    place_source_id: "stub-guaynabo",
  };
  const snap = {
    state: {
      profile: { name: "Taller Guaynabo", industry: "Automotive", business_type: "Auto Repair Shop", municipality: "" },
      discoveryAnswers: {},
      projectIntent: "new_business",
      currentStep: 1,
    },
  };
  const geocodeQueries: string[] = [];
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/**", (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    if (p === "/api/snapshots/e2e-loc") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snap) });
    if (p === "/api/me") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null }) });
    if (p === "/api/locations/resolve" || p === "/api/incentives/evaluate") return route.continue();
    if (p === "/api/geocode") {
      if (u.searchParams.get("q")) {
        geocodeQueries.push(u.searchParams.get("q")!);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [guaynaboCandidate] }) });
      }
      const lat = Number(u.searchParams.get("lat"));
      const result = Math.abs(lat - ADJUNTAS.latitude) < 0.01
        ? { ...guaynaboCandidate, ...ADJUNTAS, formatted_address: "Calle Rodulfo González, Adjuntas, PR 00601", city: "Adjuntas", municipality: "Adjuntas", postal_code: "00601", place_source_id: "stub-adjuntas" }
        : guaynaboCandidate;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"stubbed"}' });
  });
  await page.goto(`${base}/?resume=e2e-loc`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const input = page.locator("#spr-nl-input");
  await input.waitFor({ timeout: 90000 });
  await input.fill("I want to open an auto repair shop in Guaynabo");
  await page.getByRole("button", { name: /Interpret description/ }).click();

  // The inline pin card appears, prefilled from the prompt.
  const card = page.locator('[data-testid="location-step"]');
  const shown = await card.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  check("intake shows the 'Where is it?' card", shown);
  const cardText = shown ? await card.innerText() : "";
  check("card asks 'Where is it?'", /Where is it\?/.test(cardText), cardText.replace(/\s+/g, " ").slice(0, 160));
  check("card is prefilled from the prompt (Guaynabo)", /Guaynabo/.test(cardText));
  await card.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => undefined);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "location_intake_card.png"), fullPage: false });

  // Open the map: the search runs with the prefilled municipio; pick the result.
  await page.locator('[data-testid="location-step-open"]').click();
  const dialog = page.locator('[data-testid="location-picker-dialog"]');
  await dialog.waitFor({ timeout: 15000 });
  const result = dialog.getByRole("button", { name: /Calle José de Diego, Guaynabo/ });
  await result.waitFor({ timeout: 15000 });
  check("map search prefilled with the mentioned municipio", geocodeQueries.some((q) => /Guaynabo/.test(q)), geocodeQueries.join(" | "));
  await result.click();
  await dialog.locator('[data-testid="location-selected-placement"]').filter({ hasText: /Guaynabo/ }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, "location_pin_dialog.png"), fullPage: false });
  const confirm = dialog.locator('[data-testid="location-confirm"]');
  await page.waitForFunction(() => !(document.querySelector('[data-testid="location-confirm"]') as HTMLButtonElement | null)?.disabled, null, { timeout: 15000 });
  await confirm.click();
  await dialog.waitFor({ state: "detached", timeout: 10000 });

  const rulesFor = page.locator('[data-testid="location-rules-for"]').first();
  await rulesFor.waitFor({ timeout: 10000 });
  const rulesForText = await rulesFor.innerText();
  check("intake shows 'Rules for: <address>'", /Rules for:\s*Calle José de Diego, Guaynabo/.test(rulesForText), rulesForText);
  const muni = await page.locator("#spr-municipality").inputValue().catch(() => "");
  const brief = await page.locator('[data-testid="guided-project-brief"]').innerText().catch(() => "");
  check("municipio set from the pin", muni === "Guaynabo" || /Guaynabo/.test(brief), muni || brief.replace(/\s+/g, " "));
  await rulesFor.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => undefined);
  await page.screenshot({ path: path.join(OUT, "location_intake_confirmed.png"), fullPage: false });

  // Requirements: Rules for + municipio-specific rules.
  await page.evaluate(() => window.scrollTo(0, 0));
  // The location type is the one required field the prompt left open.
  const lt = page.locator("#spr-location-type");
  const ltOptions = await lt.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  await lt.selectOption(ltOptions.find((v) => /commercial|shop|storefront|garage/i.test(v)) ?? ltOptions[0]);
  // Remaining intake questions (not about location) are answered "Not sure"/"No".
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    const notSure = page.getByRole("button", { name: /^\s*(Not sure|No)\s*$/ }).first();
    if (!(await notSure.isVisible().catch(() => false))) break;
    await notSure.click();
  }
  await page.locator(".spr-form-footer .spr-primary").click();
  const compute = page.getByRole("button", { name: /Compute Requirements from Rules Engine/ });
  await Promise.race([compute.waitFor({ timeout: 30000 }), page.locator(".ck-summary").waitFor({ timeout: 30000 })]).catch(() => undefined);
  if (await compute.isVisible().catch(() => false)) await compute.click();
  await page.locator(".ck-summary").waitFor({ timeout: 30000 }).catch(async (e) => {
    await page.screenshot({ path: path.join(OUT, "location_debug.png"), fullPage: true });
    console.log(errors.join("\n"));
    throw e;
  });
  await page.waitForTimeout(600);
  const summaryRules = await page.locator('.ck-summary [data-testid="location-rules-for"]').innerText().catch(() => "");
  check("requirements summary shows 'Rules for: …' with Change", /Rules for:[\s\S]*Guaynabo/.test(summaryRules) && /Change/.test(summaryRules), summaryRules.replace(/\s+/g, " "));
  const reqText = async () => (await page.locator(".spr-requirements-main").innerText()).replace(/\s+/g, " ");
  let text = await reqText();
  check("patente municipal is listed", /Patente Municipal/i.test(text));
  check("Guaynabo (metro) rule: used-oil generator ID", /Used-Oil Generator/i.test(text));
  check("Guaynabo (metro) rule: hazardous-waste generator ID", /Hazardous-Waste Generator/i.test(text));
  await page.screenshot({ path: path.join(OUT, "location_requirements_rules_for.png"), fullPage: false });

  // Change → move the pin to Adjuntas (no metro designation): the rules update.
  await page.locator('.ck-summary [data-testid="location-change"]').click();
  await dialog.waitFor({ timeout: 10000 });
  await dialog.locator('[data-testid="location-latitude"]').fill(String(ADJUNTAS.latitude));
  await dialog.locator('[data-testid="location-longitude"]').fill(String(ADJUNTAS.longitude));
  await dialog.getByRole("button", { name: /^Place pin$/ }).click();
  await dialog.locator('[data-testid="location-selected-placement"]').filter({ hasText: /Adjuntas/ }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => !(document.querySelector('[data-testid="location-confirm"]') as HTMLButtonElement | null)?.disabled, null, { timeout: 15000 });
  await dialog.locator('[data-testid="location-confirm"]').click();
  await dialog.waitFor({ state: "detached", timeout: 10000 });
  await page.waitForTimeout(600);
  const summaryAfter = await page.locator('.ck-summary [data-testid="location-rules-for"]').innerText().catch(() => "");
  check("summary now reads 'Rules for: … Adjuntas'", /Rules for:[\s\S]*Adjuntas/.test(summaryAfter), summaryAfter.replace(/\s+/g, " "));
  text = await reqText();
  check("metro-only rules removed after moving the pin to Adjuntas", !/Used-Oil Generator/i.test(text) && !/Hazardous-Waste Generator/i.test(text));
  check("patente municipal still listed (every municipio)", /Patente Municipal/i.test(text));
  await page.screenshot({ path: path.join(OUT, "location_requirements_after_change.png"), fullPage: false });

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
  process.exit(failures.length ? 1 : 0);
}

const G = JSON.parse(readFileSync(path.join(here, "../src/app/processes/goldens", GOLDEN), "utf8"));
const tag = String(G.id ?? "golden");

const { context } = validateProjectContext(G.modelProjectContext, G.description);
const snapshot = {
  state: {
    profile: { ...G.profile },
    discoveryAnswers: G.answers ?? {},
    projectContext: context,
    // E2E_INTENT=none restores an unsettled intent (the developer guard must hold anyway).
    projectIntent: process.env.E2E_INTENT === "none" ? null : (process.env.E2E_INTENT ?? G.projectIntent ?? null),
    currentStep: 3,
  },
};

async function installStubs(page: Page) {
  await page.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/snapshots/e2e-req") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
    if (p === "/api/me") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null }) });
    // Pure computation, no database: the real server route answers.
    if (p === "/api/incentives/evaluate") return route.continue();
    return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"stubbed"}' });
  });
}

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
await installStubs(page);
await page.goto(`${base}/?resume=e2e-req`, { waitUntil: "domcontentloaded", timeout: 90000 });
const compute = page.getByRole("button", { name: /Compute Requirements from Rules Engine/ });
await compute.waitFor({ timeout: 90000 });
await compute.click();
await page.locator(".ck-summary").waitFor({ timeout: 30000 }).catch(async (e) => { await page.screenshot({ path: path.join(OUT, `${tag}_debug.png`), fullPage: true }); console.log(errors.join("\n")); throw e; });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, `${tag}_requirements_default.png`), fullPage: true });

const main = page.locator(".spr-requirements-main");
// Summary line: capitalized, short.
const line = (await page.locator(".ck-summary-line").first().innerText()).trim();
console.log("summary:", line);
check("summary line starts with a capital letter", /^[A-ZÁÉÍÓÚÑ]/.test(line), line);

// One number per row: list markers are off everywhere in the checklist and
// every row carries exactly one number badge.
const markers = await main.evaluate((root) => {
  const bad: string[] = [];
  for (const li of Array.from(root.querySelectorAll("li"))) {
    const cs = getComputedStyle(li);
    const inCk = li.closest(".ck-stages, .ck-rows, .rq-list");
    if (inCk && cs.display === "list-item" && cs.listStyleType !== "none" && li.matches(".ck-row, .ck-stage")) bad.push(li.textContent?.slice(0, 40) ?? "");
  }
  return bad;
});
check("no list marker on numbered rows", markers.length === 0, markers.join(" | "));
const energyNums = await page.locator('[data-testid="req-group-energy"] .ck-row > .ck-row-head .ck-num').allInnerTexts();
check("energy rows number from 1", energyNums.length === 0 || energyNums[0] === "1", energyNums.join(","));
check("energy numbers are consecutive", energyNums.every((n, i) => Number(n) === i + 1), energyNums.join(","));

// Order: secondary groups are collapsed <details> after the main groups.
const order = await main.evaluate((root) =>
  Array.from(root.querySelectorAll(":scope > .rq-group, :scope > details.rq-group, :scope > section.rq-group")).map((el) => ({
    id: el.getAttribute("data-testid") ?? el.className,
    tag: el.tagName.toLowerCase(),
    open: el.tagName === "DETAILS" ? (el as HTMLDetailsElement).open : null,
  }))
);
console.log("groups:", order.map((g) => `${g.id}${g.tag === "details" ? (g.open ? "(open)" : "(closed)") : ""}`).join(" → "));
for (const id of ["req-group-registrations", "req-group-other-checks", "req-group-incentives"]) {
  const g = order.find((x) => x.id === id);
  if (!g) continue;
  check(`${id} is a collapsed <details>`, g.tag === "details" && g.open === false);
}
const firstSecondary = order.findIndex((g) => g.tag === "details");
check("collapsed groups come after every open group", firstSecondary === -1 || order.slice(firstSecondary).every((g) => g.tag === "details"));
const energyIdx = order.findIndex((g) => g.id === "req-group-energy");
const regIdx = order.findIndex((g) => g.id === "req-group-registrations");
check("registrations render after energy", regIdx === -1 || energyIdx === -1 || regIdx > energyIdx);
check("'Decides:' lists are not visible by default", !(await page.getByText(/^Decides:/).first().isVisible().catch(() => false)));
check("filter tabs are not above the checklist", !(await page.locator(".rq-tabs").isVisible().catch(() => false)));

// Relevance.
const energyText = await page.locator('[data-testid="req-group-energy"]').innerText().catch(() => "");
const rowStatus = async (re: RegExp) => {
  const rows = page.locator('[data-testid="req-group-energy"] .ck-row');
  for (let i = 0; i < (await rows.count()); i++) {
    const t = await rows.nth(i).locator(".ck-row-head").innerText();
    if (re.test(t)) return t;
  }
  return null;
};
const mg = await rowStatus(/Microgrid/);
check("microgrid is not Required without microgrid facts", !mg || !/Required/.test(mg), mg ?? "absent");
await page.locator('[data-testid="req-group-incentives"] > summary').click().catch(() => undefined);
const incText = await page.locator('[data-testid="req-group-incentives"]').innerText().catch(() => "");
for (const bad of [/Air and Maritime/i, /Export Logistics/i, /International Trading/i]) check(`no unrelated incentive ${bad.source}`, !bad.test(incText));
check("green energy incentive kept", /Green Energy|energ/i.test(incText));
await page.locator('[data-testid="req-group-incentives"] > summary').click().catch(() => undefined);

// Every Required energy row shows its action on the collapsed line.
{
  const rows = page.locator('[data-testid="req-group-energy"] .ck-row');
  const missing: string[] = [];
  let required = 0;
  for (let i = 0; i < (await rows.count()); i++) {
    const r = rows.nth(i);
    const pill = (await r.locator(".ck-pill").first().innerText().catch(() => "")).trim();
    if (!/^(Required|Requerido)$/.test(pill)) continue;
    required++;
    const cta = r.locator(':scope > .ck-card-line [data-testid="row-actions"] > [data-testid="row-cta"]').first();
    if (!((await cta.count()) > 0 && (await cta.isVisible()))) missing.push((await r.locator(".ck-name").first().innerText()).trim());
  }
  check("every Required energy row has a visible inline action", required > 0 && missing.length === 0, `${required} required, missing: ${missing.join(" | ") || "none"}`);
}

// An energy developer is an existing company: a "New energy project", its
// business registrations collapsed, and the step count = energy steps +
// required business items shown open.
if (G.modelProjectContext?.energy_applicant_role?.value === "developer") {
  const header = await page.locator(".spr-shell, body").first().innerText();
  check("developer: matter reads 'New energy project'", /New energy project/.test(header) && !/New Business Formation/.test(header));
  const openBiz = await main.evaluate((root) => Array.from(root.querySelectorAll(":scope > section.rq-group:not(.rq-group-energy)"))
    .flatMap((g) => Array.from(g.querySelectorAll(".ck-name")).map((n) => n.textContent ?? ""))
    .filter((n) => /Merchant|Comerciante|Patente|EIN|Incorporation|Incorporación|Organization|Organización/.test(n)));
  check("developer: no business-formation item is shown open", openBiz.length === 0, openBiz.join(" | "));
  const energyItems = await page.locator('[data-testid="req-group-energy"] .ck-row').count();
  const openRequired = await page.locator('[data-testid="req-group-required_now"] .ck-card, [data-testid="req-group-prerequisites"] .ck-card').count();
  const steps = Number(/(\d+) (steps?|pasos?)/.exec(line)?.[1] ?? NaN);
  check("summary step count = energy steps + required items shown open", steps === energyItems + openRequired, `${steps} vs ${energyItems}+${openRequired}`);
}

// Regulatory questions are answered in Intake; this page only shows the
// resulting requirements and never repeats the Yes/No controls.
const qs = page.locator(".ck-questions > [role=listitem]");
check("no questions repeated on Requirements", (await qs.count()) === 0);
check("no inline requirement Yes/No", (await page.locator(".rq-answer-prompt").count()) === 0);

// ---- Inline row actions: act without expanding a row ----
// Every row whose expanded card offers an action shows it on the collapsed
// line; clicking it runs that flow and never toggles the row.
await page.context().route(/^https?:\/\/(?!localhost)/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>external</title>" }));
for (const g of ["req-group-registrations"]) {
  const s = page.locator(`[data-testid="${g}"] > summary`);
  if (await s.count()) await s.click();
}
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, `${tag}_requirements_inline.png`), fullPage: true });
const desktopButtonWidths = await page.locator('.spr-requirements-main [data-testid="row-actions"] > [data-testid="row-cta"]').evaluateAll((buttons) =>
  buttons.filter((button) => (button as HTMLElement).offsetParent !== null).map((button) => Math.round(button.getBoundingClientRect().width)));
check("desktop: primary buttons have equal widths", desktopButtonWidths.length > 1 && desktopButtonWidths.every((width) => Math.abs(width - desktopButtonWidths[0]) <= 1), desktopButtonWidths.join(","));
const rowSel = '.spr-requirements-main .ck-row:not(:has(> .ck-row-static)), .spr-requirements-main .ck-card';
const rowCount = await page.locator(rowSel).count();
let actionable = 0;
let clicked = 0;
for (let i = 0; i < rowCount; i++) {
  const row = page.locator(rowSel).nth(i);
  if (!(await row.isVisible())) continue;
  const head = row.locator(":scope > .ck-card-line > .ck-row-head").first();
  const name = (await row.locator(".ck-name").first().innerText()).trim();
  const lineCta = row.locator(':scope > .ck-card-line [data-testid="row-actions"] > [data-testid="row-cta"]').first();
  const lineDone = row.locator(':scope > .ck-card-line [data-testid="row-done"]');
  const hasCta = (await lineCta.count()) > 0 && (await lineCta.isVisible());
  // What the expanded card offers (then collapse again).
  await head.click();
  const body = row.locator(".ck-row-body");
  const bodyActions = await body.locator('.ck-card-actions a, .ck-card-actions button, .ck-action, .rq-answer-prompt button').evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e.textContent ?? "").trim()).filter(Boolean));
  await head.click();
  const offers = bodyActions.length > 0;
  const kind = hasCta ? await lineCta.getAttribute("data-cta") : null;
  const status = (await row.locator(".ck-pill").first().innerText().catch(() => "")).trim();
  console.log(`row: ${name} [${status}] cta=${kind ?? (await lineDone.count() ? "done" : "none")} body=${JSON.stringify(bodyActions)}`);
  if (offers) {
    actionable++;
    check(`"${name}": inline action visible without expanding`, hasCta || (await lineDone.count()) > 0, kind ?? "none");
  } else if (kind && kind !== "answer" && kind !== "start") {
    check(`"${name}": no inline button without a card action`, false, kind);
  }
  if (!hasCta) continue;
  clicked++;
  const expandedBefore = await head.getAttribute("aria-expanded");
  const label = (await lineCta.innerText()).trim();
  let flow = "none";
  if (kind === "answer") {
    await lineCta.click();
    flow = (await row.locator('[data-testid="row-question"]').isVisible()) ? "question" : "none";
    check(`"${name}": Answer opens only the question`, flow === "question" && !(await body.isVisible().catch(() => false)));
    await lineCta.click();
  } else if (kind === "upload" || kind === "confirm") {
    const chooser = page.waitForEvent("filechooser", { timeout: 15000 }).then(() => "filechooser").catch(() => "none");
    await lineCta.click();
    flow = await chooser;
    check(`"${name}": ${label} opens the upload flow`, flow === "filechooser");
  } else if (kind === "start") {
    await lineCta.click();
    flow = (await row.locator('[data-testid="row-checklist"]').isVisible()) ? "checklist" : "none";
    check(`"${name}": Start opens only the prepared checklist`, flow === "checklist" && !(await body.isVisible().catch(() => false)));
    await lineCta.click();
  } else if (kind === "download" || kind === "instructions" || kind === "portal" || kind === "site") {
    const popup = page.waitForEvent("popup", { timeout: 4000 }).then(async (p) => { const u = p.url(); await p.close(); return u; }).catch(() => "");
    await lineCta.click();
    flow = await popup;
    check(`"${name}": ${label} opens the official document`, !!flow, flow);
  } else if (kind === "assist" && (await lineCta.getAttribute("href"))) {
    // A link: the same destination as the expanded card's filing link.
    const href = await lineCta.getAttribute("href");
    await head.click();
    const bodyHref = await body.locator(".rq-filing a").first().getAttribute("href").catch(() => null);
    await head.click();
    flow = `link ${href}`;
    check(`"${name}": ${label} links where the card links`, !!href && href === bodyHref, `${href} vs ${bodyHref}`);
  } else {
    await lineCta.click();
    const dialog = page.locator('[role="dialog"][aria-modal="true"]').first();
    flow = (await dialog.waitFor({ timeout: 5000 }).then(() => "dialog").catch(() => "none"));
    const requirement = await dialog.getAttribute("data-requirement").catch(() => null);
    check(`"${name}": ${label} opens its form`, flow === "dialog", requirement ?? "");
    if (flow === "dialog") {
      await page.screenshot({ path: path.join(OUT, `${tag}_row_cta_flow.png`) }).catch(() => undefined);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      if (await dialog.isVisible().catch(() => false)) {
        const close = dialog.getByRole("button", { name: /close|cerrar|×|✕/i }).first();
        if (await close.count()) await close.click();
      }
      await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
    }
  }
  check(`"${name}": clicking "${label}" does not expand the row`, (await head.getAttribute("aria-expanded")) === expandedBefore && expandedBefore === "false");
}
check("at least one actionable row checked", actionable > 0 && clicked > 0, `${actionable} actionable, ${clicked} clicked`);
// Overflow (⋯): the other actions of a row, same handlers, row stays closed.
const moreBtn = page.locator('.spr-requirements-main [data-testid="row-more"]').first();
if (await moreBtn.count() && await moreBtn.isVisible()) {
  const row = moreBtn.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ck-card ') or contains(concat(' ', normalize-space(@class), ' '), ' ck-row ')][1]");
  const head = row.locator(":scope > .ck-card-line > .ck-row-head").first();
  await moreBtn.click();
  const items = row.locator('[data-testid="row-more-item"]');
  const labels = await items.allInnerTexts();
  check("overflow menu lists the other actions", labels.length > 0, labels.join(" | "));
  const upload = row.locator('[data-testid="row-more-item"][data-cta="upload"]').first();
  if (await upload.count()) {
    const chooser = page.waitForEvent("filechooser", { timeout: 15000 }).then(() => true).catch(() => false);
    await upload.click();
    check("overflow upload opens the upload flow", await chooser);
  } else {
    await page.keyboard.press("Escape");
  }
  check("overflow menu closes", (await items.count()) === 0);
  check("overflow does not expand the row", (await head.getAttribute("aria-expanded")) === "false");
}
for (const g of ["req-group-registrations"]) {
  const s = page.locator(`[data-testid="${g}"] > summary`);
  if (await s.count()) await s.click();
}
// Mobile: the CTA wraps under the name and stays visible.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, `${tag}_requirements_mobile.png`), fullPage: true });
// Width relative to the row line; the action wraps below the name.
const mobileCtas = await page.locator('.spr-requirements-main [data-testid="row-actions"]').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => {
  const line = e.closest(".ck-card-line") as HTMLElement;
  const name = line.querySelector(".ck-name") as HTMLElement;
  return { ratio: e.getBoundingClientRect().width / line.getBoundingClientRect().width, below: e.getBoundingClientRect().top >= name.getBoundingClientRect().bottom - 1 };
}));
check("mobile: inline actions wrap under the name, full width", mobileCtas.every((m) => m.ratio > 0.85 && m.below), mobileCtas.map((m) => `${m.ratio.toFixed(2)}${m.below ? "↓" : "→"}`).join(","));
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(300);
// Desktop: one line per row (the line is no taller than two text lines).
const tall = await page.locator('.spr-requirements-main .ck-card-line').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null && (e as HTMLElement).getBoundingClientRect().height > 64).length);
check("desktop: rows stay one line", tall === 0, `${tall} tall rows`);

// Reasoning: open the first energy row and its full reasoning; no empty <li>.
const firstRow = page.locator('[data-testid="req-group-energy"] .ck-row').first();
if (await firstRow.count()) {
  await firstRow.locator(".ck-row-head").click();
  await firstRow.locator(".ck-full > summary").click();
  await page.waitForTimeout(200);
  const empties = await firstRow.evaluate((row) => Array.from(row.querySelectorAll("li, .ck-trace-line, .ck-trace dd")).filter((el) => !(el.textContent ?? "").trim()).length);
  const lines = await firstRow.locator(".ck-full .ck-trace-line").count();
  const listItems = await firstRow.locator(".ck-full li").count();
  check("full reasoning has content and no empty items", empties === 0 && lines > 0, `${lines} trace lines, ${empties} empty`);
  check("full reasoning renders no list items (copy-safe)", listItems === 0, `${listItems} <li>`);
  // Copy the page as a user would: no row may paste as two numbers.
  const copied = await page.evaluate(() => document.querySelector(".spr-requirements-main")?.textContent ?? "");
  check("no doubled row numbers in page text", !/\b\d+\.\s*\d+[A-Z]/.test(copied));
  await firstRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, `${tag}_requirements_expanded.png`), fullPage: true });
}
check("no page errors", errors.length === 0, errors.join(" | "));
console.log("energy:", energyText.replace(/\s+/g, " ").slice(0, 400));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
