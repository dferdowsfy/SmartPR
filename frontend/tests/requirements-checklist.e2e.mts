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
