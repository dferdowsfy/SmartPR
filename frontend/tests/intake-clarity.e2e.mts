/**
 * Intake clarity (real page under next dev): compact header + sticky
 * stepper, grouped "Where will your business operate?" section, specific
 * "still needed" list matching the sidebar, inline missing-field flags, one
 * primary "Continue" action, keyboard, mobile, and the
 * transition to Requirements.
 *
 *   BASE_URL=http://localhost:3217 E2E_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx tsx tests/intake-clarity.e2e.mts [outDir]
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.argv[2] || path.join(os.tmpdir(), "intake-clarity");
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
  // Address search → a San Juan (Condado) point; the municipio is then resolved for real.
  await page.route("**/api/geocode**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [{ formatted_address: "Calle Ashford, San Juan, PR 00907", latitude: 18.4573, longitude: -66.0614, place_source: "stub", place_source_id: "sj" }], result: null }) }));
  await page.route("**/api/locations/layers**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.goto(`${base}/?entry=new-business`, { waitUntil: "networkidle", timeout: 120000 });
  await page.locator('[data-testid="intake-where"]').waitFor({ timeout: 60000 });
  return page;
}
const rect = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });

/** One UI font, nothing meaningful under 14px, serif headings kept, CTA 16px semibold sans. */
async function typography(page: Page, tag: string) {
  const r = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *")) as HTMLElement[]) {
      if (!el.closest(".spr-guided-intake-shell, header.appbar")) continue;
      if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim().length > 1)) continue;
      const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
      const cs = getComputedStyle(el); if (cs.visibility === "hidden") continue;
      if (parseFloat(cs.fontSize) < 14 || /mono/i.test(cs.fontFamily)) bad.push(`${cs.fontSize} ${el.className.toString().slice(0, 30)} "${el.textContent!.trim().slice(0, 30)}"`);
    }
    const cta = getComputedStyle(document.querySelector(".spr-form-footer .spr-primary")!);
    const label = getComputedStyle(document.querySelector('[data-testid="intake-where"] label')!);
    const input = getComputedStyle(document.querySelector('[data-testid="project-location-search"]')!);
    const h1 = getComputedStyle(document.querySelector(".spr-intake-panel h1")!);
    return { bad, cta: [cta.fontFamily, cta.fontSize, cta.fontWeight, cta.letterSpacing], label: [label.fontFamily, label.fontSize, label.fontWeight], input: input.fontSize, h1: [h1.fontFamily, h1.fontSize] };
  });
  check(`${tag}: no monospace and no meaningful text under 14px`, r.bad.length === 0, r.bad.slice(0, 4).join(" | "));
  check(`${tag}: Continue is 16px semibold sans, normal tracking`, /Plex|sans/.test(r.cta[0]!) && !/mono/i.test(r.cta[0]!) && r.cta[1] === "16px" && r.cta[2] === "600" && r.cta[3] === "normal", r.cta.join(" "));
  check(`${tag}: labels 16px semibold in the same sans`, r.label[0] === r.cta[0] && r.label[1] === "16px" && r.label[2] === "600");
  check(`${tag}: inputs 16px`, r.input === "16px");
  check(`${tag}: headline keeps the serif`, /Georgia|serif/.test(r.h1[0]!) && !/Plex/.test(r.h1[0]!), r.h1.join(" "));
}

// ---------------- desktop
{
  const page = await open(1440);
  // compact header aligned with the form
  const bar = await rect(page, ".spr-stepper-bar");
  const h1 = await rect(page, ".spr-intake-panel h1");
  const step1 = await rect(page, ".spr-workflow-step");
  check("compact stepper bar (≤ 48px tall)", bar.height <= 48, `${Math.round(bar.height)}px`);
  check("tight gap to the opening question (≤ 40px)", h1.top - bar.bottom <= 40, `${Math.round(h1.top - bar.bottom)}px`);
  check("stepper aligned with the form column (±12px)", Math.abs(step1.left - h1.left) <= 12, `${Math.round(step1.left)} vs ${Math.round(h1.left)}`);
  check("opening business description question kept", (await page.getByText("What are you looking to open?").count()) === 1);
  check("project summary sidebar kept", (await page.locator(".spr-project-summary").count()) === 1);

  // grouped location section
  const where = page.locator('[data-testid="intake-where"]');
  check("location section has no visible title (kept for screen readers)", (await where.locator("legend").evaluate((e) => { const cs = getComputedStyle(e); return cs.position === "absolute" && cs.clipPath.startsWith("inset") && e.getBoundingClientRect().height <= 1; })) && ((await where.locator("legend").textContent()) ?? "").includes("Where will your business operate?"));
  check("project location (search + map) and location type in one section", (await where.locator("#spr-location-type").count()) === 1 && (await where.locator('[data-testid="project-location-search"]').count()) === 1 && (await where.getByRole("button", { name: "Or place the pin on the map" }).count()) === 1);
  const [lt, mu] = await Promise.all([rect(page, "#spr-location-type"), rect(page, '[data-testid="project-location"]')]);
  check("location card aligned with the other fields", Math.abs(lt.left - mu.left) < 2, `${Math.round(lt.left)}/${Math.round(mu.left)} ${Math.round(lt.height)}/${Math.round(mu.height)}`);
  check("municipality dropdown only as a fallback (not shown up front)", (await page.locator("#spr-municipality").count()) === 0);

  // still needed, matching the sidebar
  const chips = (await page.locator(".spr-still-needed-chip").allInnerTexts()).map((t) => t.trim());
  const side = (await page.locator('[data-testid="sidebar-still-needed"] li').allInnerTexts()).map((t) => t.trim());
  check("specific 'Still needed' list instead of generic details", chips.length >= 3 && chips.includes("Municipality"), chips.join(", "));
  check("sidebar lists the same missing answers", JSON.stringify(chips) === JSON.stringify(side), side.join(", "));
  check("generic 'Add your business details' gone", (await page.getByText("Add your business details").count()) === 0);
  check("footer names what is missing", /Still needed: .*Municipality/.test(await page.locator('[data-testid="intake-footer-status"]').innerText()));

  // one primary action
  check("one primary action: Continue →", (await page.locator(".spr-form-footer .spr-primary").innerText()).trim() === "Continue" && (await page.locator(".spr-form-footer .spr-primary svg").count()) === 1 && (await page.getByRole("button", { name: /See my requirements|Review requirements/ }).count()) === 0);

  // next-step field flagged with the sidebar's wording
  const next = (await page.locator(".spr-project-summary-next p").innerText()).trim();
  const note = (await page.locator('[data-testid="missing-note-municipality"]').innerText()).trim();
  check("missing field flagged beside it with the sidebar's guidance", note === next, note);
  await typography(page, "desktop");
  await page.screenshot({ path: path.join(OUT, "1_desktop.png"), fullPage: true });

  // validation: incomplete submit flags every missing field
  await page.locator(".spr-form-footer .spr-primary").click();
  await page.waitForTimeout(500);
  check("incomplete submit: location type flagged", (await page.locator('[data-testid="missing-note-location_type"]').count()) === 1 && (await page.locator("#spr-location-type").getAttribute("aria-invalid")) === "true");
  check("incomplete submit: location search aria-invalid + described by the note", (await page.locator('[data-testid="project-location-search"]').getAttribute("aria-invalid")) === "true" && ((await page.locator('[data-testid="project-location-search"]').getAttribute("aria-describedby")) ?? "").includes("spr-missing-municipality"));
  check("incomplete submit stays on intake", (await page.locator('[data-testid="intake-where"]').count()) === 1);
  await page.screenshot({ path: path.join(OUT, "2_validation.png"), fullPage: true });

  // keyboard: chip → field focus
  await page.locator(".spr-still-needed-chip", { hasText: "Municipality" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  check("keyboard: Enter on a missing chip focuses its field", await page.evaluate(() => document.activeElement?.id === "spr-project-location"));
  await page.keyboard.press("Tab"); // Find is disabled while the search is empty
  check("keyboard: Tab from the search reaches 'Choose on map'", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "project-location-map-toggle"));

  // scrolling: global nav scrolls away, stepper stays
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(400);
  const nav = await rect(page, "header.appbar");
  const stepper = await rect(page, ".spr-stepper-bar");
  check("scroll: global nav scrolls away", nav.bottom <= 0, `${Math.round(nav.bottom)}`);
  check("scroll: stepper stays visible at the top", stepper.top >= 0 && stepper.top < 40 && stepper.height > 0, `${Math.round(stepper.top)}`);
  await page.evaluate(() => window.scrollTo(0, 0));

  // complete everything and go to requirements
  await page.getByRole("button", { name: "New business", exact: true }).click();
  await page.locator('[data-testid="project-location-search"]').fill("Calle Ashford San Juan");
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="project-location-use"]:not([disabled])').waitFor({ timeout: 30000 });
  await page.locator('[data-testid="project-location-use"]').click();
  await page.locator(".spr-still-needed-chip", { hasText: /Business Type/ }).click();
  await page.waitForTimeout(300);
  const ind = page.locator("#spr-industry");
  if (await ind.count()) { const v = await ind.locator("option").nth(1).getAttribute("value"); await ind.selectOption(v!); }
  const bt = page.locator("#spr-business-type");
  await bt.waitFor();
  const btv = await bt.locator("option").nth(1).getAttribute("value");
  await bt.selectOption(btv!);
  const ltv = await page.locator("#spr-location-type option").nth(1).getAttribute("value");
  await page.locator("#spr-location-type").selectOption(ltv!);
  await page.waitForTimeout(400);
  check("all answered: still-needed list cleared (form + sidebar)", (await page.locator(".spr-still-needed-chip").count()) === 0 && /Nothing/.test(await page.locator('[data-testid="sidebar-still-needed"]').innerText()));
  check("no stale missing flags", (await page.locator(".spr-missing-note").count()) === 0);
  await page.screenshot({ path: path.join(OUT, "3_complete.png"), fullPage: true });
  // Answer any remaining yes/no questions, then submit.
  for (let i = 0; i < 60; i++) {
    if (!/question/.test(await page.locator('[data-testid="intake-footer-status"]').innerText())) break;
    const no = page.getByRole("button", { name: /^\s*(No|Not sure)\s*$/ }).first();
    if (!(await no.count())) break;
    await no.click();
    await page.waitForTimeout(250);
  }
  console.log("   footer before submit:", await page.locator('[data-testid="intake-footer-status"]').innerText());
  await page.locator(".spr-form-footer .spr-primary").click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, "3b_after_submit.png"), fullPage: false });
  await page.locator(".rq-page-head h1").waitFor({ timeout: 60000 });
  check("transition: Continue opens Requirements (step 2)", /requirements? identified/.test(await page.locator(".rq-page-head p").innerText()) && (await page.locator('.spr-workflow-step[aria-current="step"]').innerText()).includes("Requirements"));
  await page.screenshot({ path: path.join(OUT, "4_requirements.png") });
  await page.close();
}

// ---------------- mobile
{
  const page = await open(390, 844);
  check("mobile: concise step indicator", (await page.locator('[data-testid="stepper-mobile"]').innerText()).replace(/\s+/g, " ").trim() === "Step 1 of 3 · Intake");
  check("mobile: full stepper hidden", await page.locator(".spr-workflow-stepper").isHidden());
  const [mu, lt] = await Promise.all([rect(page, '[data-testid="project-location"]'), rect(page, "#spr-location-type")]);
  check("mobile: project location then location type, stacked, same width", mu.bottom < lt.top && Math.abs(lt.width - mu.width) < 2);
  await typography(page, "mobile");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("mobile: no horizontal overflow", overflow <= 0, String(overflow));
  const btn = await rect(page, ".spr-form-footer .spr-primary");
  check("mobile: primary action wide, tappable, no floating voice control", btn.width > 250 && btn.height >= 44 && (await page.locator('[data-testid="intake-voice-orb"]').count()) === 0, `${Math.round(btn.width)}×${Math.round(btn.height)}`);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(400);
  const ind = await rect(page, '[data-testid="stepper-mobile"]');
  check("mobile: step indicator stays visible while scrolling", ind.top >= 0 && ind.top < 40, `${Math.round(ind.top)}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, "5_mobile.png"), fullPage: true });
  await page.close();
}

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
