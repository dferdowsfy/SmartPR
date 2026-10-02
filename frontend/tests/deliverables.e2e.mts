/**
 * Deliverables page (real page under next dev): business summary above a
 * 2×2 tile grid (Report · Package / Worksheets · Workspace), one main action
 * and a concise status per tile, missing documents collapsed behind
 * "View N missing documents", a next-action-only sidebar, an intro that
 * matches readiness, stacking in order on mobile.
 *
 *   BASE_URL=http://localhost:3217 E2E_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx tsx tests/deliverables.e2e.mts [outDir] [--before]
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.argv[2] || path.join(os.tmpdir(), "deliverables");
const BEFORE = process.argv.includes("--before");
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:3000";
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};
const snap = {
  state: {
    profile: { name: "Enrique's", industry: "Hospitality", business_type: "Hotel", municipality: "Arecibo", location_type: "Commercial Building" },
    discoveryAnswers: {},
    projectIntent: "new_business",
    currentStep: 3,
  },
};

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
const errors: string[] = [];
async function open(width: number, height = 1000): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    const j = (b: unknown, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (p === "/api/snapshots/e2e-deliv") return j(snap);
    if (p === "/api/me") return j({ user: null });
    if (p === "/api/incentives/evaluate") return r.continue();
    return j({ error: "stubbed" }, 404);
  });
  await page.goto(`${base}/?resume=e2e-deliv`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const compute = page.getByRole("button", { name: /Compute Requirements from Rules Engine/ });
  await Promise.race([compute.waitFor({ timeout: 90000 }), page.getByRole("button", { name: /Continue to deliverables/ }).waitFor({ timeout: 90000 })]).catch(() => undefined);
  if (await compute.isVisible().catch(() => false)) await compute.click();
  await page.getByRole("button", { name: /Continue to deliverables/ }).click();
  await page.locator(".packages, [data-testid='deliverables-grid']").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  return page;
}

{
  const page = await open(1440);
  await page.screenshot({ path: path.join(OUT, `${BEFORE ? "before" : "after"}_desktop.png`), fullPage: true });
  if (!BEFORE) {
    const grid = page.locator('[data-testid="deliverables-grid"]');
    const tiles = await grid.locator('[data-testid^="tile-"]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-testid"), x: Math.round(r.left), y: Math.round(r.top) }; }));
    const [rep, pkg, ws, wk] = ["tile-report", "tile-package", "tile-worksheets", "tile-workspace"].map((id) => tiles.find((t) => t.id === id)!);
    check("2×2 grid: report TL, package TR, worksheets BL, workspace BR", Boolean(rep && pkg && ws && wk && rep.y === pkg.y && ws.y === wk.y && ws.y > rep.y && rep.x === ws.x && pkg.x === wk.x && pkg.x > rep.x), JSON.stringify(tiles));
    const summaryBottom = await page.locator('[data-testid="deliverables-summary"]').evaluate((e) => e.getBoundingClientRect().bottom);
    check("business summary above the grid", summaryBottom <= rep.y);
    const mains = await grid.locator('[data-testid^="tile-"]').evaluateAll((els) => els.map((e) => e.querySelectorAll("[data-main-action]").length));
    check("one main action per tile", mains.every((n) => n === 1), mains.join(","));
    const statuses = await grid.locator('[data-testid^="tile-"] .pkg-status-pill').allInnerTexts();
    check("concise status per tile (≤ 3 words)", statuses.length === 4 && statuses.every((s) => s.trim().split(/\s+/).length <= 3), statuses.join(" | "));
    const toggle = page.locator('[data-testid="missing-docs-toggle"]');
    const label = (await toggle.innerText()).trim();
    check("missing documents collapsed behind 'View N missing documents'", /^View \d+ missing documents?$/.test(label) && (await page.locator('[data-testid="missing-docs-list"]').count()) === 0, label);
    await toggle.click();
    const n = Number(label.match(/\d+/)![0]);
    check("expands to the full missing list", (await page.locator('[data-testid="missing-docs-list"] li').count()) === n && (await toggle.getAttribute("aria-expanded")) === "true");
    await page.screenshot({ path: path.join(OUT, "after_desktop_missing_open.png"), fullPage: true });
    await toggle.click();
    const side = page.locator('[data-testid="deliverables-next-action"]');
    const sideTxt = await side.innerText();
    check("sidebar is next action only", /Next action/i.test(sideTxt) && (await page.locator(".spr-live-metrics, .spr-live-readiness").count()) === 0, sideTxt.replace(/\s+/g, " "));
    const intro = await page.locator('[data-testid="deliverables-intro"]').innerText();
    check("intro matches readiness (not 'All validated materials are ready')", !/All validated materials are ready/.test(intro) && /missing/i.test(intro), intro);
  }
  await page.close();
}
{
  const page = await open(390, 844);
  await page.screenshot({ path: path.join(OUT, `${BEFORE ? "before" : "after"}_mobile.png`), fullPage: true });
  if (!BEFORE) {
    const ys = await page.locator('[data-testid="deliverables-grid"] [data-testid^="tile-"]').evaluateAll((els) => els.map((e) => [e.getAttribute("data-testid"), Math.round(e.getBoundingClientRect().top)] as const));
    check("mobile: stacked report → package → worksheets → workspace", ys.map((y) => y[0]).join(",") === "tile-report,tile-package,tile-worksheets,tile-workspace" && ys.every((y, i) => i === 0 || y[1] > ys[i - 1]![1]), JSON.stringify(ys));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("mobile: no horizontal overflow", overflow <= 0, String(overflow));
  }
  await page.close();
}
check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
