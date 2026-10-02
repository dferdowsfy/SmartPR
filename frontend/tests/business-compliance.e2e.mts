/**
 * Compliance calendar + annual filings inside the business dashboard
 * (real page under next dev; /api stubbed). Verifies the horizon filters
 * and counts match the standalone /calendar page for the same business,
 * annual-filing counts, opening an item stays in the dashboard, other
 * businesses' items are excluded, navigation stays visible, and mobile.
 *
 *   BASE_URL=http://localhost:3217 E2E_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx tsx tests/business-compliance.e2e.mts [outDir]
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.argv[2] || path.join(os.tmpdir(), "business-compliance");
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:3000";
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const UUID = "11111111-1111-1111-1111-111111111111";
const item = (id: string, name: string, dueIn: number | null, extra: Record<string, unknown> = {}) => ({
  id, business_id: UUID, business_public_id: "amigos", business_name: "Amigos", name, agency: "Municipio de Camuy",
  due_date: dueIn == null ? null : day(dueIn), status: dueIn != null && dueIn < 0 ? "OVERDUE" : "UPCOMING",
  matter_title: null, reminder_scheduled_for: null, renewal_frequency_months: null, item_type: "OBLIGATION", ...extra,
});
const items = [
  item("o1", "Patente Municipal", -3, { renewal_frequency_months: 12, status: "OVERDUE" }),
  item("o2", "Permiso Único", 5),
  item("o3", "Certificación de Bomberos", 20),
  item("o4", "Licencia Sanitaria", 45),
  item("o5", "Informe Anual", 80, { renewal_frequency_months: 12, agency: "Departamento de Estado" }),
  item("o6", "CRIM", 200, { renewal_frequency_months: 12, agency: "CRIM" }),
  item("o7", "Seguro", 500),
  item("o8", "Registro de Comerciante", null),
  item("o9", "Patente 2025", -400, { renewal_frequency_months: 12, status: "COMPLETED" }),
  { ...item("x1", "OTHER BUSINESS ITEM", 3, { renewal_frequency_months: 12 }), business_id: "22222222-2222-2222-2222-222222222222", business_public_id: "other", business_name: "Other" },
];
const portfolio = { enabled: true, businesses: [{ id: UUID, legal_name: "Amigos" }, { id: "22222222-2222-2222-2222-222222222222", legal_name: "Other" }], items, notifications: [] };
const obligations = items.filter((i) => i.business_id === UUID).map((i) => ({ id: i.id, name: i.name, agency: i.agency, matter_id: null, matter_title: null, requirement_id: null, status: i.status, due_date: i.due_date, due_date_source: "USER_PROVIDED", source_reference: null, next_action: "Upload" }));
const detail = {
  business: { id: UUID, public_id: "amigos", legal_name: "Amigos", name: "Amigos", business_type: "Bar", municipality: "Camuy", entity_number: "1", onboarding_mode: "NEW", created_at: "2026-09-01", passport_json: {} },
  matters: [], obligations, evidence: [], submissions: [], notifications: [], deliverables: [], agency_runs: [],
};

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
const errors: string[] = [];
let portfolioCalls = 0;
const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
async function open(url: string, width = 1440): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    const j = (b: unknown) => r.fulfill({ contentType: "application/json", body: JSON.stringify(b) });
    if (p === "/api/portfolio") { portfolioCalls++; return j(portfolio); }
    if (/\/obligations(\/[^/]+)?$/.test(p) && ["POST", "PATCH"].includes(r.request().method())) {
      writes.push({ method: r.request().method(), path: p, body: r.request().postDataJSON() });
      return r.fulfill({ status: r.request().method() === "POST" ? 201 : 200, contentType: "application/json", body: JSON.stringify({ created: true, updated: true, id: "new1" }) });
    }
    if (p === "/api/businesses/amigos") return j(detail);
    if (p.endsWith("/locations")) return j({ locations: [], can_edit: true });
    if (p === "/api/me") return j({ user: { id: "u" } });
    return j({});
  });
  await page.goto(`${base}${url}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  return page;
}
const horizonCounts = (page: Page, scope: string) => page.locator(`${scope} [data-testid="calendar-horizons"] button`).evaluateAll((els) => els.map((e) => `${e.getAttribute("data-horizon")}:${e.querySelectorAll("span")[1]?.textContent}`));
const rows = (page: Page, scope: string) => page.locator(`${scope} [data-testid="calendar-row"]`).count();

// Reference numbers from the standalone page (same business)
const ref = await open("/calendar?business=amigos");
await ref.locator('[data-testid="calendar-row"]').first().waitFor({ timeout: 60000 });
const refCounts = await horizonCounts(ref, "body");
const refRows: Record<string, number> = {};
for (const h of ["7", "30", "60", "90", "365", "all"]) { await ref.locator(`[data-horizon="${h}"]`).click(); refRows[h] = await rows(ref, "body"); }
await ref.close();

// ---------------- desktop dashboard
{
  const page = await open("/businesses/amigos");
  await page.locator('[data-testid="tile-calendar-toggle"]').waitFor({ timeout: 60000 });
  check("no 'View full calendar' link to a separate page", (await page.locator('a[href^="/calendar"]').count()) === 0 && (await page.locator('a[href^="/filings"]').count()) === 0);
  await page.locator('[data-testid="tile-calendar-toggle"]').click();
  const scope = '[data-testid="tile-calendar-detail"]';
  await page.locator(`${scope} [data-testid="calendar-row"]`).first().waitFor({ timeout: 30000 });
  const url0 = page.url();
  check("full calendar renders inside the dashboard panel", await page.locator(`${scope} [data-testid="compliance-calendar-view"]`).isVisible());
  const counts = await horizonCounts(page, scope);
  check("filters 7/30/60/90/annual/all with counts", counts.length === 6 && counts.map((c) => c.split(":")[0]).join(",") === "7,30,60,90,365,all", counts.join(" "));
  check("counts match the standalone calendar for this business", JSON.stringify(counts) === JSON.stringify(refCounts), refCounts.join(" "));
  for (const h of ["7", "30", "60", "90", "365", "all"]) {
    await page.locator(`${scope} [data-horizon="${h}"]`).click();
    const n = await rows(page, scope);
    const label = await page.locator(`${scope} [data-testid="calendar-count"]`).innerText();
    check(`filter ${h}: ${n} result(s), matches standalone, count line agrees`, n === refRows[h] && label.startsWith(String(n)) && (await page.locator(`${scope} [data-horizon="${h}"]`).getAttribute("aria-pressed")) === "true", label.split("\n")[0]);
  }
  check("other businesses excluded", !(await page.locator(scope).innerText()).includes("OTHER BUSINESS ITEM"));
  check("completed items excluded (rules unchanged)", !(await page.locator(scope).innerText()).includes("Patente 2025"));
  check("overdue count shown", /1\s*overdue/.test(await page.locator(`${scope} [data-testid="calendar-count"]`).innerText()));
  await page.screenshot({ path: path.join(OUT, "1_calendar.png"), fullPage: true });

  // action: open an item → stays in dashboard, reveals its requirement row
  await page.locator(`${scope} [data-testid="calendar-row"]`, { hasText: "Permiso Único" }).click();
  await page.locator("#obligation-o2").waitFor({ timeout: 5000 });
  await page.waitForTimeout(600);
  const top = await page.locator("#obligation-o2").evaluate((e) => e.getBoundingClientRect().top);
  check("opening an item stays on the dashboard (same URL)", page.url() === url0, page.url());
  check("…and shows that requirement with its actions in view", top > -10 && top < 900 && (await page.locator("#obligation-o2").getByRole("button").count()) > 0, String(Math.round(top)));

  // annual filings tab
  await page.locator('[data-testid="tile-calendar-toggle"]').click();
  await page.locator('[data-testid="compliance-tab-filings"]').click();
  const fscope = '#compliance-tabpanel-filings';
  await page.locator(`${fscope} [data-testid="filing-row"]`).first().waitFor();
  const fnames = await page.locator(`${fscope} [data-testid="filing-row"]`).allInnerTexts();
  check("annual filings: only this business's yearly filings", fnames.length === 4 && fnames.every((t) => !/OTHER/.test(t)), fnames.map((t) => t.split("\n")[0]).join(", "));
  const chips = await page.locator(`${fscope} [data-testid="filings-counts"] > span`).allInnerTexts();
  check("annual filings: status counts (overdue/due soon/upcoming/filed)", chips.length === 4 && /Overdue\s*1/.test(chips[0]!) && /Filed\s*1/.test(chips[3]!), chips.join(" | "));
  check("tab semantics", (await page.locator('[data-testid="compliance-tab-filings"]').getAttribute("aria-selected")) === "true");
  await page.screenshot({ path: path.join(OUT, "2_filings.png"), fullPage: true });
  await page.locator(`${fscope} [data-testid="filing-row"]`, { hasText: "Informe Anual" }).click();
  await page.locator("#obligation-o5").waitFor({ timeout: 5000 });
  check("filing action stays in the dashboard", page.url() === url0);
  check("no duplicate cross-link inside the dashboard (tabs switch views)", (await page.getByRole("button", { name: /View (annual filings|full compliance calendar)/ }).count()) === 0);
  await page.locator('[data-testid="tile-calendar-toggle"]').click();
  await page.locator('[data-testid="compliance-tab-calendar"]').click();

  // keyboard: arrow keys between tabs, Enter on a filter
  await page.locator('[data-testid="compliance-tab-calendar"]').focus();
  await page.keyboard.press("ArrowRight");
  check("keyboard: ArrowRight moves to Annual filings", (await page.locator('[data-testid="compliance-tab-filings"]').getAttribute("aria-selected")) === "true" && await page.evaluate(() => document.activeElement?.id === "compliance-tab-filings"));
  await page.keyboard.press("ArrowLeft");
  await page.locator(`${scope} [data-horizon="30"]`).focus();
  await page.keyboard.press("Enter");
  check("keyboard: Enter applies a filter", (await page.locator(`${scope} [data-horizon="30"]`).getAttribute("aria-pressed")) === "true");

  // Add filing date: custom filing with repeat, reminders and email choice.
  check("calendar pill title has no 'annual filings'", !/annual filings/i.test(await page.locator('[data-testid="tile-calendar-toggle"]').innerText()), await page.locator('[data-testid="tile-calendar-toggle"]').innerText());
  await page.locator(`${scope} [data-testid="calendar-add-date"]`).click();
  const form = page.locator(`${scope} [data-testid="filing-date-form"]`);
  await form.waitFor();
  check("form defaults to an undated tracked filing", (await form.locator('[data-testid="filing-date-filing"]').inputValue()) === "o8");
  const defaults = await form.locator('[data-testid="filing-date-reminders"] button[aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-days")).join(","));
  check("default reminders 60/30/7 + email on", defaults === "60,30,7" && (await form.locator('[data-testid="filing-date-email"]').isChecked()), defaults);
  check("save disabled until a date is set", await form.locator('[data-testid="filing-date-save"]').isDisabled());
  await form.locator('[data-testid="filing-date-due"]').fill(day(40));
  await form.locator('[data-testid="filing-date-reminders"] [data-days="14"]').click();
  await form.locator('[data-testid="filing-date-save"]').click();
  await form.waitFor({ state: "detached", timeout: 5000 });
  const w1 = writes.at(-1);
  check("tracked filing: PATCH with date, source, reminders, email", w1?.method === "PATCH" && w1.path === "/api/obligations/o8" && w1.body.due_date === day(40) && w1.body.due_date_source === "USER_PROVIDED" && JSON.stringify(w1.body.reminder_days) === "[60,30,14,7]" && w1.body.reminder_email === true, JSON.stringify(w1));
  const callsBefore = portfolioCalls;
  await page.locator(`${scope} [data-testid="calendar-add-date"]`).click();
  await form.locator('[data-testid="filing-date-filing"]').selectOption("__custom__");
  check("custom filing shows name + repeats (default every year)", (await form.locator('[data-testid="filing-date-name"]').count()) === 1 && (await form.locator('[data-testid="filing-date-repeat"]').inputValue()) === "12");
  await form.locator('[data-testid="filing-date-name"]').fill("Póliza de seguro");
  await form.locator('[data-testid="filing-date-due"]').fill(day(90));
  await form.locator('[data-testid="filing-date-email"]').uncheck();
  await page.screenshot({ path: path.join(OUT, "4_add_date.png"), fullPage: false });
  await form.locator('[data-testid="filing-date-save"]').click();
  await form.waitFor({ state: "detached", timeout: 5000 });
  const w2 = writes.at(-1);
  check("custom filing: POST to the business with name, repeat, in-app only", w2?.method === "POST" && w2.path === `/api/businesses/${UUID}/obligations` && w2.body.name === "Póliza de seguro" && w2.body.renewal_frequency_months === 12 && w2.body.reminder_email === false, JSON.stringify(w2));
  await page.waitForTimeout(500);
  check("calendar reloads after saving", portfolioCalls > callsBefore);

  // navigation + business context remain visible
  check("business context visible (name in header)", await page.getByRole("heading", { name: "Amigos" }).first().isVisible());
  await page.locator('[data-testid="section-panel"]').evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(200);
  const navOk = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="section-nav"] li')).every((li) => { const r = li.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }));
  check("section navigation stays visible", navOk);
  // deep link
  await page.goto("about:blank");
  await page.goto(`${base}/businesses/amigos#annual-filings`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="compliance-tab-filings"][aria-selected="true"]').waitFor({ timeout: 30000 });
  check("#annual-filings deep link opens the filings tab", true);
  await page.close();
}

// ---------------- mobile
{
  const page = await open("/businesses/amigos", 390);
  await page.locator('[data-testid="tile-calendar-toggle"]').click();
  const scope = '[data-testid="tile-calendar-detail"]';
  await page.locator(`${scope} [data-testid="calendar-row"]`).first().waitFor({ timeout: 60000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("mobile: no horizontal overflow", overflow <= 0, String(overflow));
  const pills = await page.locator(`${scope} [data-testid="calendar-horizons"] button`).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.right <= 390 && r.height >= 44; }));
  check("mobile: all six filters visible and tappable (wrap, no scroll)", pills.length === 6 && pills.every(Boolean));
  await page.locator(`${scope} [data-horizon="7"]`).click();
  check("mobile: filter works", (await rows(page, scope)) === refRows["7"]);
  await page.screenshot({ path: path.join(OUT, "3_mobile.png"), fullPage: true });
  await page.locator('[data-testid="compliance-tab-filings"]').click();
  check("mobile: annual filings tab", (await page.locator('#compliance-tabpanel-filings [data-testid="filing-row"]').count()) === 4);
  await page.close();
}

check("standalone /calendar and /filings still work", portfolioCalls >= 1);
check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
