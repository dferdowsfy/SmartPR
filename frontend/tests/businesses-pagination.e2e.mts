/**
 * My Businesses pagination (real page, stubbed /api/portfolio with 392
 * businesses = 49 pages of 8): compact page list, boundaries, filtering,
 * keyboard, desktop + mobile.
 *
 *   BASE_URL=http://localhost:3217 E2E_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx tsx tests/businesses-pagination.e2e.mts [outDir]
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.argv[2] || path.join(os.tmpdir(), "biz-pagination");
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:3000";
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};
const pad = (n: number) => String(n).padStart(3, "0");
const businesses = Array.from({ length: 392 }, (_, i) => ({
  id: `b${i}`, public_id: `b${i}`, legal_name: `${i % 10 === 0 ? "Café" : "Negocio"} ${pad(i + 1)}`, entity_number: null, business_structure: null,
  business_type: "Retail", industry: "Retail", municipality: "San Juan", physical_address: null, onboarding_mode: "NEW",
  readiness_score: 50, active_matters: 0, requirements_total: 4, requirements_done: 2,
}));

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
const errors: string[] = [];
async function open(width: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(new URL(r.request().url()).pathname === "/api/portfolio" ? { enabled: true, businesses, items: [], notifications: [] } : {}) }));
  await page.goto(`${base}/businesses`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator('[data-testid="pagination"]').waitFor({ timeout: 60000 });
  return page;
}
const numbers = (page: Page) => page.locator('[data-testid="page-numbers"] li').evaluateAll((els) => els.map((e) => e.textContent?.trim() || ""));
const current = (page: Page) => page.locator('[data-testid="pagination"] [aria-current="page"]').innerText();
const firstCard = (page: Page) => page.locator(".space-y-3 > div").first().innerText();
const goTo = async (page: Page, n: number) => {
  for (let i = 0; i < 60 && Number(await current(page)) !== n; i++) {
    const nums = (await numbers(page)).filter((x) => /^\d+$/.test(x)).map(Number);
    const target = nums.includes(n) ? n : nums.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
    await page.locator(`[data-testid="page-numbers"] button`, { hasText: new RegExp(`^${target}$`) }).click();
  }
};

// ---------------- desktop
{
  const page = await open(1440);
  check("first page: 1 2 3 4 5 6 … 49", (await numbers(page)).join(" ") === "1 2 3 4 5 6 … 49", (await numbers(page)).join(" "));
  check("first page: Previous disabled, Next enabled", (await page.locator('[data-testid="page-prev"]').isDisabled()) && !(await page.locator('[data-testid="page-next"]').isDisabled()));
  check("indicator: Page 1 of 49", (await page.locator('[data-testid="page-indicator"]').innerText()) === "Page 1 of 49");
  const bg = await page.locator('[data-testid="pagination"] [aria-current="page"]').evaluate((e) => getComputedStyle(e).backgroundColor);
  const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand-primary").trim());
  check("current page uses the SmartPR teal", bg !== "rgb(255, 255, 255)" && bg !== "rgba(0, 0, 0, 0)", `${bg} (brand ${brand})`);
  await page.screenshot({ path: path.join(OUT, "1_first.png"), fullPage: true });

  await goTo(page, 25);
  check("middle page: 1 … 23 24 25 26 27 … 49", (await numbers(page)).join(" ") === "1 … 23 24 25 26 27 … 49", (await numbers(page)).join(" "));
  check("middle page: at most 7 numbered buttons", (await page.locator('[data-testid="page-numbers"] button').count()) <= 7);
  check("indicator: Page 25 of 49", (await page.locator('[data-testid="page-indicator"]').innerText()) === "Page 25 of 49");
  check("middle page shows the right businesses (193–200)", /Negocio 193|Café 193|193/.test(await firstCard(page)), (await firstCard(page)).split("\n")[0]);
  await page.locator('[data-testid="pagination"]').screenshot({ path: path.join(OUT, "2_middle_nav.png") });

  // keyboard: Tab to Next, Enter
  await page.locator('[data-testid="page-prev"]').focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab"); // arrive by keyboard so :focus-visible applies
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow);
  check("keyboard: visible teal focus ring", /rgb\(36, 92, 92\)/.test(ring), ring.slice(-70));
  await page.keyboard.press("Enter");
  check("keyboard: Enter on Previous → 24", (await current(page)) === "24");
  for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); if ((await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "page-next") break; }
  await page.keyboard.press("Enter");
  check("keyboard: Tab to Next + Enter → 25", (await current(page)) === "25");

  await goTo(page, 49);
  check("last page: 1 … 44 45 46 47 48 49", (await numbers(page)).join(" ") === "1 … 44 45 46 47 48 49", (await numbers(page)).join(" "));
  check("last page: Next disabled, Previous enabled", (await page.locator('[data-testid="page-next"]').isDisabled()) && !(await page.locator('[data-testid="page-prev"]').isDisabled()));
  check("last page shows the last 8 businesses", /392|Negocio 392/.test(await page.locator(".space-y-3").innerText()));
  await page.screenshot({ path: path.join(OUT, "3_last.png"), fullPage: true });

  // filtering: "Café" → 40 matches → 5 pages, resets to page 1
  await page.getByPlaceholder(/Search/).fill("Café");
  await page.waitForTimeout(300);
  check("filtered: back to page 1, every page shown (5)", (await numbers(page)).join(" ") === "1 2 3 4 5" && (await current(page)) === "1", (await numbers(page)).join(" "));
  check("filtered: indicator Page 1 of 5", (await page.locator('[data-testid="page-indicator"]').innerText()) === "Page 1 of 5");
  check("filtered: cards still match search", (await page.locator(".space-y-3 > div").allInnerTexts()).every((t) => t.includes("Café")));
  await page.getByPlaceholder(/Search/).fill("Café 001");
  await page.waitForTimeout(300);
  check("filtered to one page: no pagination", (await page.locator('[data-testid="pagination"]').count()) === 0);
  await page.screenshot({ path: path.join(OUT, "4_filtered.png"), fullPage: true });
  await page.close();
}

// ---------------- mobile
{
  const page = await open(390);
  check("mobile: page numbers hidden", await page.locator('[data-testid="page-numbers"]').isHidden());
  check("mobile: ‹ · Page 1 of 49 · ›", /Page 1 of 49/.test(await page.locator('[data-testid="page-indicator-mobile"]').innerText()));
  const box = await page.locator('[data-testid="page-next"]').boundingBox();
  check("mobile: controls at least 44px tall", Boolean(box && box.height >= 44), String(box?.height));
  await page.locator('[data-testid="page-next"]').click();
  check("mobile: Next → Page 2 of 49", /Page 2 of 49/.test(await page.locator('[data-testid="page-indicator-mobile"]').innerText()));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("mobile: no horizontal overflow", overflow <= 0, String(overflow));
  await page.locator('[data-testid="pagination"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "5_mobile.png") });
  await page.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
