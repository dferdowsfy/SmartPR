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
const G = JSON.parse(readFileSync(path.join(here, "../src/app/processes/goldens", GOLDEN), "utf8"));
const tag = String(G.id ?? "golden");

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

const { context } = validateProjectContext(G.modelProjectContext, G.description);
const snapshot = {
  state: {
    profile: { ...G.profile },
    discoveryAnswers: G.answers ?? {},
    projectContext: context,
    projectIntent: G.projectIntent,
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

// Questions render their options.
const qs = page.locator(".ck-questions > [role=listitem]");
for (let i = 0; i < (await qs.count()); i++) {
  const q = qs.nth(i);
  const text = (await q.innerText()).replace(/\s+/g, " ");
  const opts = await q.locator("button, input, select").count();
  check(`question ${i + 1} renders options`, opts >= 2 || (await q.locator("input, select").count()) > 0, text.slice(0, 90));
}

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
  } else if (kind && kind !== "answer") {
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
    const chooser = page.waitForEvent("filechooser", { timeout: 4000 }).then(() => "filechooser").catch(() => "none");
    await lineCta.click();
    flow = await chooser;
    check(`"${name}": ${label} opens the upload flow`, flow === "filechooser");
  } else if (kind === "download" || kind === "instructions") {
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
    const chooser = page.waitForEvent("filechooser", { timeout: 4000 }).then(() => true).catch(() => false);
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
