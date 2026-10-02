/**
 * Progressive intake questionnaire (real page under next dev): answered
 * questions stay as compact rows, the next question opens underneath,
 * Change reopens a question in its own slot, Yes/No are equal side-by-side
 * choices (stacked on mobile), and the scroll position does not jump.
 *
 *   BASE_URL=http://localhost:3217 E2E_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx tsx tests/progressive-questionnaire.e2e.mts [outDir]
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.argv[2] || path.join(os.tmpdir(), "progressive-questionnaire");
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:3000";
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
const errors: string[] = [];
async function open(width: number, height = 1000): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/me", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ user: null }) }));
  await page.route("**/api/locations/layers**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.goto(`${base}/?entry=new-business`, { waitUntil: "networkidle", timeout: 120000 });
  await page.route("**/api/geocode**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [{ formatted_address: "Calle Ashford, San Juan, PR 00907", latitude: 18.4573, longitude: -66.0614, place_source: "stub", place_source_id: "sj" }], result: null }) }));
  await page.locator('[data-testid="intake-where"]').waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "New business", exact: true }).click();
  await page.locator('[data-testid="project-location-search"]').fill("Calle Ashford San Juan");
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="project-location-use"]:not([disabled])').waitFor({ timeout: 30000 });
  await page.locator('[data-testid="project-location-use"]').click();
  await page.locator(".spr-still-needed-chip", { hasText: /Business Type/ }).click();
  await page.waitForTimeout(300);
  const ind = page.locator("#spr-industry");
  if (await ind.count()) await ind.selectOption({ label: (await ind.locator("option").allInnerTexts()).find((t) => /food|restaurant/i.test(t)) ?? (await ind.locator("option").nth(1).innerText()) });
  const bt = page.locator("#spr-business-type");
  await bt.waitFor();
  await bt.selectOption({ label: (await bt.locator("option").allInnerTexts()).find((t) => /restaurant/i.test(t)) ?? (await bt.locator("option").nth(1).innerText()) });
  await page.locator("#spr-location-type").selectOption((await page.locator("#spr-location-type option").nth(1).getAttribute("value"))!);
  await page.locator('[data-testid="progressive-questionnaire"] .spr-pq-active').waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  return page;
}
const activeTitle = (page: Page) => page.locator(".spr-pq-active h2, .spr-pq-active h4, .spr-pq-active legend").first().innerText().catch(() => "");

// ---------------- desktop
{
  const page = await open(1440);
  const pq = page.locator('[data-testid="progressive-questionnaire"]');
  const head = await pq.locator(".spr-pq-head").innerText();
  check("interview header + supporting text", /A few details to finish your requirements/.test(head) && /Your answers help SmartPR determine/.test(head), head.replace(/\s+/g, " "));
  check("old headings gone", !/What SmartPR still needs|We still need for this project/.test(await pq.innerText()));
  const remaining = await pq.locator('[data-testid="questions-remaining"]').innerText().catch(() => "");
  check("small 'N remaining' indicator", /^\d+ remaining$/.test(remaining.trim()), remaining);

  // Find a Yes/No question (skip multiple-choice ones by answering their first option).
  for (let i = 0; i < 6 && (await page.locator(".spr-pq-active .spr-answer-yesno").count()) === 0; i++) {
    await page.locator(".spr-pq-active .spr-answer-choice").first().click();
    await page.waitForTimeout(700);
  }
  const yes = page.locator(".spr-pq-active .spr-answer-yesno .spr-answer-choice").nth(0);
  const no = page.locator(".spr-pq-active .spr-answer-yesno .spr-answer-choice").nth(1);
  const [yb, nb] = [await yes.boundingBox(), await no.boundingBox()];
  check("Yes/No side by side, ≥48px, equal size", Boolean(yb && nb && Math.abs(yb.y - nb.y) < 2 && yb.height >= 48 && Math.abs(yb.width - nb.width) < 2), JSON.stringify({ yb, nb }));
  const style = (l: typeof yes) => l.evaluate((e) => { const c = getComputedStyle(e); return `${c.backgroundColor}|${c.borderColor}|${c.color}|${c.fontWeight}`; });
  check("Yes and No have equal visual weight before selection", (await style(yes)) === (await style(no)), `${await style(yes)} vs ${await style(no)}`);
  await yes.focus();
  check("keyboard focusable", await yes.evaluate((e) => e === document.activeElement));

  const q1 = (await activeTitle(page)).trim();
  await page.evaluate(() => window.scrollTo(0, 400));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: path.join(OUT, "1_question.png"), fullPage: false });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(60);
  check("answer is visibly selected immediately", (await page.locator(".spr-pq-answer-row, .spr-pq-active .spr-answer-choice.selected").count()) >= 1);
  await page.waitForTimeout(900);
  const row = pq.locator('[data-testid="answered-question"]').filter({ hasText: q1 });
  check("answered question stays as a compact row with its answer + Change", (await row.count()) === 1 && /Yes/.test(await row.innerText()) && (await row.getByRole("button", { name: /Change/ }).count()) === 1, await row.innerText().catch(() => "none"));
  const rh = await row.evaluate((e) => e.getBoundingClientRect().height).catch(() => 999);
  check("answered row is compact (≤ 64px)", rh <= 64, String(rh));
  const q2 = (await activeTitle(page)).trim();
  const below = await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-testid="answered-question"]');
    const last = rows[rows.length - 1]; const act = document.querySelector(".spr-pq-active");
    return !act || !last ? true : act.getBoundingClientRect().top >= last.getBoundingClientRect().bottom - 1;
  });
  check("next question opens directly under the answered one", q2 !== q1 && below, `${q1} → ${q2 || "(none)"}`);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  check("scroll position does not jump", Math.abs(scrollAfter - scrollBefore) < 4, `${scrollBefore} → ${scrollAfter}`);
  await page.screenshot({ path: path.join(OUT, "2_answered.png"), fullPage: false });

  // Change → reopens in its own slot (above the later question's row/active).
  await row.getByRole("button", { name: /Change/ }).click();
  await page.waitForTimeout(500);
  check("Change reopens that question inline", (await activeTitle(page)).trim() === q1 && (await page.locator('[role="dialog"]').count()) === 0);
  const slot = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".spr-pq-path > li"));
    return items.findIndex((li) => li.classList.contains("spr-pq-active"));
  });
  const editingState = await page.locator(".spr-pq-active").getAttribute("data-state");
  check("reopened question keeps its place in the path (editing state)", slot >= 0 && editingState === "editing", `slot ${slot} · ${editingState}`);
  await page.screenshot({ path: path.join(OUT, "3_change.png"), fullPage: false });
  await page.locator(".spr-pq-active .spr-answer-choice").nth(1).click();
  await page.waitForTimeout(900);
  const row2 = pq.locator('[data-testid="answered-question"]').filter({ hasText: q1 });
  check("changed answer recorded (No)", /\bNo\b/.test(await row2.innerText().catch(() => "")));

  // Answer a few more → older answers fold under "View previous answers".
  for (let i = 0; i < 6; i++) {
    const c = page.locator(".spr-pq-active .spr-answer-choice").first();
    if (!(await c.isVisible().catch(() => false))) break;
    await c.click();
    await page.waitForTimeout(700);
  }
  const shownRows = await pq.locator('[data-testid="answered-question"]').count();
  const prev = pq.locator('[data-testid="questions-view-previous"]');
  if (await prev.count()) {
    check("only the recent 3 answers shown as rows; older fold away", shownRows <= 3 + 1, String(shownRows));
    await prev.click();
    check("'View previous answers' expands the full path", (await pq.locator('[data-testid="answered-question"]').count()) > shownRows);
  } else {
    check("short path: all answers visible", shownRows >= 1, String(shownRows));
  }
  await page.screenshot({ path: path.join(OUT, "4_path.png"), fullPage: false });
  await page.close();
}

// ---------------- mobile
{
  const page = await open(390, 844);
  for (let i = 0; i < 6 && (await page.locator(".spr-pq-active .spr-answer-yesno").count()) === 0; i++) {
    await page.locator(".spr-pq-active .spr-answer-choice").first().click();
    await page.waitForTimeout(700);
  }
  const [yb, nb] = [await page.locator(".spr-pq-active .spr-answer-yesno .spr-answer-choice").nth(0).boundingBox(), await page.locator(".spr-pq-active .spr-answer-yesno .spr-answer-choice").nth(1).boundingBox()];
  check("mobile: Yes/No stacked, full width, ≥48px", Boolean(yb && nb && nb.y > yb.y && yb.height >= 48 && yb.width > 250), JSON.stringify({ yb, nb }));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("mobile: no horizontal overflow", overflow <= 0, String(overflow));
  await page.locator('[data-testid="progressive-questionnaire"]').screenshot({ path: path.join(OUT, "5_mobile.png") });
  await page.close();
}

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
