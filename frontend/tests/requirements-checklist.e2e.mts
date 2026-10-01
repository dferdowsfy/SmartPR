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
 *   BASE_URL=… npx tsx tests/requirements-checklist.e2e.mts [outDir] flood      (map layers: AE pin → Reg. 13 step)
 *   BASE_URL=… npx tsx tests/requirements-checklist.e2e.mts [outDir] picker     (picker opens in the viewport; card placement; layer loading state)
 *   (E2E_CHROME=/path/to/chromium to use a system browser)
 * Exits non-zero on any failed check.
 */
import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProjectContext } from "../src/app/ai/intake/projectContext";
import { LAYER_SOURCES } from "../src/app/locations/layers";
import { LayerCache, resolveSiteLayers, type FetchLike } from "../src/app/locations/layerService";

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
// Picker viewport + placement + layer-loading flow
// (`… tests/requirements-checklist.e2e.mts <outDir> picker`):
//   1. The inline "Where is it?" card sits right under the project
//      description (top of the intake, before the intent and yes/no list).
//   2. With the user scrolled far down a long intake, "Find it in <muni>"
//      opens LocationPickerDialog FULLY inside the current viewport —
//      desktop 1280x800 and mobile 390x844. The dialog is portalled to
//      <body>, locks page scroll, takes focus, Escape closes, and the page
//      scroll position is unchanged afterwards. The stage grid keeps no
//      lingering transform (the containing-block root cause).
//   3. Desktop: the summary sidebar's "Site → Find on map" row opens the same
//      picker, also inside the viewport.
//   4. After confirming a pin the map-layer lookup shows an obvious loading
//      state (spinner + "Checking flood zone, zoning and parcel for this
//      site…" at ≥16px, skeleton chips), then a clear done state with chips.
// Geocoding is stubbed; /api/locations/layers is served from the recorded
// ArcGIS fixtures with an artificial delay; /api/locations/resolve is real.
// ---------------------------------------------------------------------------
if (GOLDEN === "picker") {
  const FX = JSON.parse(readFileSync(path.join(here, "../src/app/locations/fixtures/arcgisLayers.json"), "utf8"));
  const URL_LAYER: Array<[string, string]> = [
    [LAYER_SOURCES.fema_flood_zones.url, "fema_zones"],
    [LAYER_SOURCES.fema_firm_panels.url, "fema_panels"],
    [LAYER_SOURCES.jp_calificacion.url, "jp_calif"],
    [LAYER_SOURCES.crim_parcels.url, "crim"],
    [LAYER_SOURCES.jp_zona_costanera.url, "czm_official"],
    [LAYER_SOURCES.jp_linea_costa.url, "coastline"],
  ];
  const fixtureFetch: FetchLike = async (url) => {
    const layer = URL_LAYER.find(([u]) => url.startsWith(`${u}/query?`))?.[1];
    const [lng, lat] = new URL(url).searchParams.get("geometry")!.split(",").map(Number);
    const pt = Object.entries(FX.points as Record<string, [number, number]>).find(([, [a, b]]) => a === lat && b === lng)?.[0];
    const resp = layer && pt ? FX.responses[`${layer}:${pt}`] : undefined;
    if (!resp || resp._http_status) return { ok: false, status: resp?._http_status ?? 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => resp };
  };
  const [gLat, gLng] = FX.points.guaynabo_pueblo as [number, number];
  const candidate = {
    latitude: gLat,
    longitude: gLng,
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
  const LAYER_DELAY_MS = 2500;
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
  const errors: string[] = [];

  async function openIntake(viewport: { width: number; height: number }, mobile: boolean) {
    const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname;
      if (p === "/api/snapshots/e2e-picker") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snap) });
      if (p === "/api/me") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null }) });
      if (p === "/api/locations/resolve" || p === "/api/incentives/evaluate") return route.continue();
      if (p === "/api/locations/layers") {
        const lat = Number(u.searchParams.get("lat"));
        const lng = Number(u.searchParams.get("lng"));
        await new Promise((r) => setTimeout(r, LAYER_DELAY_MS));
        const layers = await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch, cache: new LayerCache(), skipOptional: true });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ layers }) }).catch(() => undefined);
      }
      if (p === "/api/geocode") {
        if (u.searchParams.get("q")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [candidate] }) });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: candidate }) });
      }
      return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"stubbed"}' });
    });
    await page.goto(`${base}/?resume=e2e-picker`, { waitUntil: "domcontentloaded", timeout: 90000 });
    const input = page.locator("#spr-nl-input");
    await input.waitFor({ timeout: 90000 });
    await input.fill("I want to open an auto repair shop in Guaynabo");
    await page.getByRole("button", { name: /Interpret description/ }).click();
    await page.locator('[data-testid="location-step"]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(700); // stage-enter animation settles
    return page;
  }

  /** Simulate a long intake: a tall spacer above the card, then scroll down to the card. */
  async function scrollFarDown(page: Page) {
    await page.evaluate(() => {
      const slot = document.querySelector('[data-testid="intake-location-slot"]');
      if (slot && !document.getElementById("e2e-long-intake")) {
        const spacer = document.createElement("div");
        spacer.id = "e2e-long-intake";
        spacer.className = "spr-field full";
        spacer.style.height = "2600px";
        spacer.style.background = "repeating-linear-gradient(#fff 0 60px, #f4f7f6 60px 120px)";
        slot.parentElement!.insertBefore(spacer, slot);
      }
    });
    // Center (not "end"): the sticky Continue footer would cover the button and
    // Playwright would scroll again before clicking.
    await page.locator('[data-testid="location-step-open"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(250);
    return page.evaluate(() => {
      // The intake panel may scroll internally (desktop) or with the page (mobile).
      const inner = document.querySelector(".spr-intake-scroll") as HTMLElement | null;
      return Math.max(window.scrollY, inner?.scrollTop ?? 0);
    });
  }

  async function assertDialogInViewport(page: Page, label: string, vw: number, vh: number, shot: string) {
    const dialog = page.locator('[data-testid="location-picker-dialog"]');
    await dialog.waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    const box = await dialog.boundingBox();
    const inside = !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vw + 0.5 && box.y + box.height <= vh + 0.5;
    check(`${label}: dialog fully inside the ${vw}x${vh} viewport`, inside, JSON.stringify(box));
    const overlay = await page.locator('[data-testid="location-picker-overlay"]').boundingBox();
    // On desktop html keeps `scrollbar-gutter: stable`, so the fixed overlay
    // spans the viewport minus the reserved scrollbar gutter (≤ 20px).
    check(`${label}: overlay covers the viewport`, !!overlay && Math.abs(overlay.x) < 1 && Math.abs(overlay.y) < 1 && overlay.width <= vw && overlay.width >= vw - 20 && Math.abs(overlay.height - vh) < 1, JSON.stringify(overlay));
    const facts = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="location-picker-dialog"]')!;
      const ov = d.parentElement!;
      return {
        portalled: ov.parentElement === document.body,
        fixed: getComputedStyle(ov).position === "fixed",
        focusInside: d.contains(document.activeElement),
        scrollLocked: getComputedStyle(document.documentElement).overflow === "hidden" || getComputedStyle(document.body).overflow === "hidden",
      };
    });
    check(`${label}: dialog portalled to <body> with position: fixed`, facts.portalled && facts.fixed, JSON.stringify(facts));
    check(`${label}: focus moved into the dialog`, facts.focusInside);
    check(`${label}: page scroll locked while open`, facts.scrollLocked);
    const footer = await dialog.locator('[data-testid="location-confirm"]').boundingBox();
    check(`${label}: 'Use this site' is on screen`, !!footer && footer.y >= 0 && footer.y + footer.height <= vh);
    await page.screenshot({ path: path.join(OUT, shot), fullPage: false });
  }

  // ------------------------------------------------------------ desktop --
  {
    const VW = 1280, VH = 800;
    const page = await openIntake({ width: VW, height: VH }, false);
    // Placement: the card is near the top, right under the description.
    const order = await page.evaluate(() => {
      const slot = document.querySelector('[data-testid="intake-location-slot"]');
      const nl = document.querySelector("#spr-nl-input");
      const intent = Array.from(document.querySelectorAll(".spr-form .spr-field")).find((el) => /existing business|new business|Is this for/i.test(el.textContent ?? "") && !el.contains(slot));
      const questions = document.querySelector(".spr-scn-questions, .spr-saved-answers");
      // (no named helpers inside evaluate: tsx's keepNames would inject __name)
      return {
        afterDescription: !!nl && !!slot && !!(nl.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING),
        beforeIntent: !!slot && (!intent || !!(slot.compareDocumentPosition(intent) & Node.DOCUMENT_POSITION_FOLLOWING)),
        beforeQuestions: !!slot && (!questions || !!(slot.compareDocumentPosition(questions) & Node.DOCUMENT_POSITION_FOLLOWING)),
        hasIntent: !!intent,
        hasQuestions: !!questions,
      };
    });
    check("placement: 'Where is it?' card comes right after the project description", order.afterDescription, JSON.stringify(order));
    check("placement: card comes before the intent question and the yes/no list", order.beforeIntent && order.beforeQuestions, JSON.stringify(order));
    const cardTop = await page.locator('[data-testid="location-step"]').evaluate((el) => el.getBoundingClientRect().top + (document.querySelector(".spr-intake-scroll")?.scrollTop ?? 0) + window.scrollY);
    check("placement: card is within the first screen of the intake", cardTop < VH, `${Math.round(cardTop)}px`);
    await page.locator('[data-testid="location-step"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, "desktop_card_placement.png"), fullPage: false });
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector(".spr-intake-scroll")?.scrollTo(0, 0); });
    await page.screenshot({ path: path.join(OUT, "desktop_intake_top.png"), fullPage: false });

    // Root cause guard: no ancestor keeps a transform after the stage animation.
    const transformed = await page.locator('[data-testid="location-step"]').evaluate((el) => {
      const out: string[] = [];
      for (let n = el.parentElement; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.transform !== "none" || cs.filter !== "none" || cs.perspective !== "none" || /transform/.test(cs.willChange)) out.push(`${n.tagName}.${n.className}`);
      }
      return out;
    });
    check("no ancestor of the card creates a fixed-position containing block", transformed.length === 0, transformed.join(", "));

    // Scrolled far down → Find it in Guaynabo → dialog inside the viewport.
    const scrolled = await scrollFarDown(page);
    check("desktop: intake scrolled far down before opening", scrolled > 1500, `${Math.round(scrolled)}px`);
    await page.screenshot({ path: path.join(OUT, "desktop_scrolled_card.png"), fullPage: false });
    await page.locator('[data-testid="location-step-open"]').click();
    await assertDialogInViewport(page, "desktop", VW, VH, "desktop_dialog_scrolled.png");
    await page.keyboard.press("Escape");
    await page.locator('[data-testid="location-picker-dialog"]').waitFor({ state: "detached", timeout: 5000 });
    const scrolledAfter = await page.evaluate(() => Math.max(window.scrollY, (document.querySelector(".spr-intake-scroll") as HTMLElement | null)?.scrollTop ?? 0));
    check("desktop: Escape closes and the scroll position is kept", Math.abs(scrolledAfter - scrolled) < 2, `${Math.round(scrolled)} → ${Math.round(scrolledAfter)}`);
    const unlocked = await page.evaluate(() => getComputedStyle(document.documentElement).overflow !== "hidden" && getComputedStyle(document.body).overflow !== "hidden");
    check("desktop: page scroll unlocked after close", unlocked);

    // Sidebar "Site" row opens the same picker (still scrolled far down).
    const sideFind = page.locator('[data-testid="summary-site-open"]');
    const sideShown = await sideFind.isVisible().catch(() => false);
    check("desktop: summary sidebar shows a 'Site → Find on map' row", sideShown);
    if (sideShown) {
      await sideFind.click();
      await assertDialogInViewport(page, "desktop sidebar", VW, VH, "desktop_dialog_from_sidebar.png");
    } else {
      await page.locator('[data-testid="location-step-open"]').click();
      await page.locator('[data-testid="location-picker-dialog"]').waitFor();
    }

    // Confirm a pin → obvious layer-loading state → done state.
    const dialog = page.locator('[data-testid="location-picker-dialog"]');
    await dialog.locator('[data-testid="location-latitude"]').fill(String(gLat));
    await dialog.locator('[data-testid="location-longitude"]').fill(String(gLng));
    await dialog.getByRole("button", { name: /^Place pin$/ }).click();
    await dialog.locator('[data-testid="location-selected-placement"]').filter({ hasText: /Guaynabo/ }).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !(document.querySelector('[data-testid="location-confirm"]') as HTMLButtonElement | null)?.disabled, null, { timeout: 15000 });
    await dialog.locator('[data-testid="location-confirm"]').click();
    await dialog.waitFor({ state: "detached", timeout: 10000 });
    const loading = page.locator('[data-testid="location-step"], [data-testid="location-rules-for"]').locator('[data-testid="location-layer-chips"][data-state="loading"]').first();
    const loadingShown = await loading.waitFor({ timeout: 2000 }).then(() => true).catch(() => false);
    check("layers: loading state appears after confirming the site", loadingShown);
    if (loadingShown) {
      const status = loading.locator('[data-testid="location-layers-status"]');
      const txt = (await status.innerText()).replace(/\s+/g, " ");
      check("layers: loading text names what is checked", /Checking flood zone, zoning and parcel for this site/.test(txt), txt);
      const fontPx = await status.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      check("layers: loading text is body size (≥16px)", fontPx >= 16, `${fontPx}px`);
      check("layers: spinner shown", (await loading.locator(".spr-loc-spin").count()) === 1);
      check("layers: skeleton chips shown", (await loading.locator(".spr-loc-chip-skeleton").count()) === 3);
      check("layers: loading is a live status region", (await loading.getAttribute("role")) === "status" && (await loading.getAttribute("aria-busy")) === "true");
      const sideChecking = await page.locator('[data-testid="summary-site"] .spr-loc-summary-checking').isVisible().catch(() => false);
      check("layers: sidebar Site row shows 'Checking site…' while loading", sideChecking);
      await loading.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: path.join(OUT, "desktop_layers_loading.png"), fullPage: false });
    }
    const done = page.locator('[data-testid="location-rules-for"] [data-testid="location-layer-chips"][data-state="done"]').first();
    const doneShown = await done.waitFor({ timeout: LAYER_DELAY_MS + 15000 }).then(() => true).catch(() => false);
    check("layers: done state replaces the loading state", doneShown);
    if (doneShown) {
      const txt = (await done.innerText()).replace(/\s+/g, " ");
      check("layers: done state reads 'Site checked' with the chips", /Site checked on the official maps/.test(txt) && /Flood zone X/.test(txt), txt);
      const sideLabel = await page.locator('[data-testid="summary-site-label"]').innerText().catch(() => "");
      check("sidebar Site row shows the confirmed site", /Guaynabo/.test(sideLabel), sideLabel);
      await done.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT, "desktop_layers_done.png"), fullPage: false });
    }
    await page.close();
  }

  // ------------------------------------------------------------- mobile --
  {
    const VW = 390, VH = 844;
    const page = await openIntake({ width: VW, height: VH }, true);
    await page.locator('[data-testid="location-step"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, "mobile_card_placement.png"), fullPage: false });
    const scrolled = await scrollFarDown(page);
    check("mobile: intake scrolled far down before opening", scrolled > 1500, `${Math.round(scrolled)}px`);
    await page.screenshot({ path: path.join(OUT, "mobile_scrolled_card.png"), fullPage: false });
    await page.locator('[data-testid="location-step-open"]').tap();
    await assertDialogInViewport(page, "mobile", VW, VH, "mobile_dialog_scrolled.png");
    await page.keyboard.press("Escape");
    await page.locator('[data-testid="location-picker-dialog"]').waitFor({ state: "detached", timeout: 5000 });
    const scrolledAfter = await page.evaluate(() => Math.max(window.scrollY, (document.querySelector(".spr-intake-scroll") as HTMLElement | null)?.scrollTop ?? 0));
    check("mobile: Escape closes and the scroll position is kept", Math.abs(scrolledAfter - scrolled) < 2, `${Math.round(scrolled)} → ${Math.round(scrolledAfter)}`);
    await page.close();
  }

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
  process.exit(failures.length ? 1 : 0);
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

// ---------------------------------------------------------------------------
// Map-layer flow (`… tests/requirements-checklist.e2e.mts <outDir> flood`):
// a new building whose pin is in FEMA flood zone AE (Toa Baja) lists the
// Planning Regulation 13 flood-zone review, explained "Because your pin is in
// flood zone AE (FEMA, 2009-11-18)", with chips for what the pin resolved.
// Moving the pin to Guaynabo pueblo (zone X) removes the step. The layers
// endpoint is stubbed with the fixtures recorded from the live services
// (src/app/locations/fixtures/arcgisLayers.json); the Census municipio
// lookup (/api/locations/resolve) runs for real.
// ---------------------------------------------------------------------------
if (GOLDEN === "flood") {
  const FX = JSON.parse(readFileSync(path.join(here, "../src/app/locations/fixtures/arcgisLayers.json"), "utf8"));
  const URL_LAYER: Array<[string, string]> = [
    [LAYER_SOURCES.fema_flood_zones.url, "fema_zones"],
    [LAYER_SOURCES.fema_firm_panels.url, "fema_panels"],
    [LAYER_SOURCES.jp_calificacion.url, "jp_calif"],
    [LAYER_SOURCES.crim_parcels.url, "crim"],
    [LAYER_SOURCES.jp_zona_costanera.url, "czm_official"],
    [LAYER_SOURCES.jp_linea_costa.url, "coastline"],
  ];
  const fixtureFetch: FetchLike = async (url) => {
    const layer = URL_LAYER.find(([u]) => url.startsWith(`${u}/query?`))?.[1];
    const [lng, lat] = new URL(url).searchParams.get("geometry")!.split(",").map(Number);
    const pt = Object.entries(FX.points as Record<string, [number, number]>).find(([, [a, b]]) => a === lat && b === lng)?.[0];
    const resp = layer && pt ? FX.responses[`${layer}:${pt}`] : undefined;
    if (!resp || resp._http_status) return { ok: false, status: resp?._http_status ?? 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => resp };
  };
  const layersFor = (lat: number, lng: number) => resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch, cache: new LayerCache(), skipOptional: true });
  const [aeLat, aeLng] = FX.points.toa_baja_ae as [number, number];
  const [xLat, xLng] = FX.points.guaynabo_pueblo as [number, number];
  const description = "New construction of a two-story retail building on our lot in Toa Baja.";
  const { context } = validateProjectContext(
    {
      project_type: { value: "new_construction", confidence: 0.95, evidence: "New construction of a two-story retail building" },
      municipality: { value: "Toa Baja", confidence: 0.95, evidence: "Toa Baja" },
    },
    description
  );
  const snap = {
    state: {
      profile: { name: "Tienda Sabana Seca", industry: "Retail", business_type: "Retail Store", municipality: "Toa Baja" },
      discoveryAnswers: {},
      projectContext: context,
      projectIntent: "new_business",
      intakeDescription: description,
      intakeSite: {
        latitude: aeLat,
        longitude: aeLng,
        coordinate_source: "MAP_PIN",
        formatted_address: null,
        municipality: { name: "Toa Baja", fips: "137" },
        barrio: { name: "Sabana Seca", geoid: null },
        near_boundary: false,
        designations: [],
        boundary_source: null,
        location_id: null,
        confirmed_at: "2026-09-30T21:30:00.000Z",
      },
      currentStep: 3,
    },
  };
  const layerQueries: string[] = [];
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    if (p === "/api/snapshots/e2e-flood") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snap) });
    if (p === "/api/me") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null }) });
    if (p === "/api/locations/resolve" || p === "/api/incentives/evaluate") return route.continue();
    if (p === "/api/locations/layers") {
      const lat = Number(u.searchParams.get("lat"));
      const lng = Number(u.searchParams.get("lng"));
      layerQueries.push(`${lat},${lng}`);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ layers: await layersFor(lat, lng) }) });
    }
    if (p === "/api/geocode") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: null, results: [] }) });
    return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"stubbed"}' });
  });
  await page.goto(`${base}/?resume=e2e-flood`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const compute = page.getByRole("button", { name: /Compute Requirements from Rules Engine/ });
  await Promise.race([compute.waitFor({ timeout: 90000 }), page.locator(".ck-summary").waitFor({ timeout: 90000 })]).catch(() => undefined);
  if (await compute.isVisible().catch(() => false)) await compute.click();
  await page.locator(".ck-summary").waitFor({ timeout: 30000 }).catch(async (e) => {
    await page.screenshot({ path: path.join(OUT, "flood_debug.png"), fullPage: true });
    console.log(errors.join("\n"));
    throw e;
  });
  const chips = page.locator('.ck-summary [data-testid="location-layer-chips"]');
  await page.waitForFunction(() => /Flood zone/.test(document.querySelector('.ck-summary [data-testid="location-layer-chips"]')?.textContent ?? ""), null, { timeout: 15000 }).catch(() => undefined);
  const chipText = (await chips.innerText().catch(() => "")).replace(/\s+/g, " ");
  check("layers fetched for the pin", layerQueries.includes(`${aeLat},${aeLng}`), layerQueries.join(" | "));
  check("chips show what the pin resolved (Flood zone AE · Zoning C-R · Rustic)", /Flood zone AE/.test(chipText) && /Zoning C-R/.test(chipText) && /Rustic/.test(chipText), chipText);
  check("unknown layer shown subtly (coastal zone unknown)", (await page.locator('.ck-summary .spr-loc-chip-unknown').filter({ hasText: /Coastal zone unknown/ }).count()) === 1);
  await page.waitForTimeout(500);
  const reqText = async () => (await page.locator(".spr-requirements-main").innerText()).replace(/\s+/g, " ");
  let text = await reqText();
  check("AE pin adds the Planning Regulation 13 flood-zone step", /Flood-Zone Review \(Planning Regulation 13\)/.test(text));
  check("rustic (SREP) land adds the consulta de ubicación step", /Consulta de Ubicación/.test(text));
  // The row is an ordinary numbered row; its details name the pin's zone.
  const row = page.locator(".ck-row, .ck-card").filter({ hasText: /Flood-Zone Review \(Planning Regulation 13\)/ }).first();
  await row.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => undefined);
  const head = row.locator(".ck-row-head, .ck-card-head, summary, button").first();
  await head.click().catch(() => undefined);
  await page.waitForTimeout(400);
  const rowText = (await row.innerText().catch(() => "")).replace(/\s+/g, " ");
  check("details: 'Because your pin is in flood zone AE (FEMA, 2009-11-18)'", /Because your pin is in flood zone AE \(FEMA, 2009-11-18\)/.test(rowText) || /Because your pin is in flood zone AE \(FEMA, 2009-11-18\)/.test(await reqText()), rowText.slice(0, 300));
  await page.screenshot({ path: path.join(OUT, "flood_ae_row_details.png"), fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(".ck-summary").evaluate((el) => el.scrollIntoView({ block: "start" })).catch(() => undefined);
  await page.screenshot({ path: path.join(OUT, "flood_ae_rules_for_chips.png"), fullPage: false });

  // Change → move the pin to Guaynabo pueblo (zone X): the step goes away.
  await page.locator('.ck-summary [data-testid="location-change"]').click();
  const dialog = page.locator('[data-testid="location-picker-dialog"]');
  await dialog.waitFor({ timeout: 10000 });
  await dialog.locator('[data-testid="location-latitude"]').fill(String(xLat));
  await dialog.locator('[data-testid="location-longitude"]').fill(String(xLng));
  await dialog.getByRole("button", { name: /^Place pin$/ }).click();
  await dialog.locator('[data-testid="location-selected-placement"]').filter({ hasText: /Guaynabo/ }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => !(document.querySelector('[data-testid="location-confirm"]') as HTMLButtonElement | null)?.disabled, null, { timeout: 15000 });
  await dialog.locator('[data-testid="location-confirm"]').click();
  await dialog.waitFor({ state: "detached", timeout: 10000 });
  await page.waitForFunction(() => /Flood zone X/.test(document.querySelector('.ck-summary [data-testid="location-layer-chips"]')?.textContent ?? ""), null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  const chipAfter = (await chips.innerText().catch(() => "")).replace(/\s+/g, " ");
  check("layers re-read for the moved pin", layerQueries.includes(`${xLat},${xLng}`), layerQueries.join(" | "));
  check("chips now read 'Flood zone X'", /Flood zone X/.test(chipAfter) && !/Flood zone AE/.test(chipAfter), chipAfter);
  text = await reqText();
  check("moving the pin out of the AE zone removes the flood-zone step", !/Flood-Zone Review \(Planning Regulation 13\)/.test(text));
  check("…and the rustic-land consulta (pueblo is not SREP)", !/Consulta de Ubicación/.test(text));
  await page.locator(".ck-summary").evaluate((el) => el.scrollIntoView({ block: "start" })).catch(() => undefined);
  await page.screenshot({ path: path.join(OUT, "flood_moved_to_zone_x.png"), fullPage: false });

  // Spanish: chips localize.
  const langBtn = page.getByRole("button", { name: /^(ES|Español)$/ }).first();
  if (await langBtn.isVisible().catch(() => false)) {
    await langBtn.click();
    await page.waitForTimeout(500);
    const es = (await chips.innerText().catch(() => "")).replace(/\s+/g, " ");
    check("chips in Spanish (Zona inundable X)", /Zona inundable X/.test(es), es);
    await page.screenshot({ path: path.join(OUT, "flood_chips_es.png"), fullPage: false });
  }

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
    // Teach Clara v1, signed out: nothing saved yet; saving keeps it on the device.
    if (p === "/api/clara-playbooks") {
      return route.request().method() === "POST"
        ? route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "sign_in_required" }) })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signed_in: false, live_recorder: false, playbooks: [] }) });
    }
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

// In-platform rule (Darius 2026-09-30): no row's inline primary takes the
// user out of SmartPR — portals / agency sites / PDFs live in ⋯ or details.
{
  const offenders = await main.evaluate((root) => Array.from(root.querySelectorAll('[data-testid="row-actions"] > [data-testid="row-cta"]'))
    .filter((el) => (el as HTMLElement).offsetParent !== null)
    .filter((el) => {
      const kind = el.getAttribute("data-cta") ?? "";
      const href = el.getAttribute("href");
      return ["portal", "site", "instructions", "download"].includes(kind) || el.getAttribute("target") === "_blank" || (!!href && !href.startsWith("/"));
    })
    .map((el) => `${el.closest(".ck-card-line")?.querySelector(".ck-name")?.textContent?.trim()} → ${el.getAttribute("data-cta")}`));
  check("no inline primary action leaves SmartPR", offenders.length === 0, offenders.join(" | ") || "none");
  const kinds = await main.evaluate((root) => Array.from(root.querySelectorAll('[data-testid="row-actions"] > [data-testid="row-cta"]')).map((el) => el.getAttribute("data-cta")));
  console.log("inline primaries:", kinds.join(","));
  check("energy rows lead with 'Complete form' (guided) when they have no form of their own", kinds.includes("guided"), kinds.join(","));
}
await page.screenshot({ path: path.join(OUT, `${tag}_inline_actions.png`), fullPage: true });

// "Complete form" opens SmartPR's guided form in place (the row stays collapsed).
{
  const guidedRow = main.locator('.ck-row, .ck-card').filter({ has: page.locator(':scope > .ck-card-line [data-testid="row-actions"] > [data-cta="guided"]') }).first();
  if (await guidedRow.count()) {
    const name = (await guidedRow.locator(".ck-name").first().innerText()).trim();
    await guidedRow.locator(':scope > .ck-card-line [data-testid="row-actions"] > [data-cta="guided"]').click();
    const dlg = page.locator('[data-testid="guided-form"]');
    const opened = await dlg.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    check("'Complete form' opens the guided in-platform form", opened, name);
    check("…without expanding the row", (await guidedRow.locator(".ck-row-head").first().getAttribute("aria-expanded")) === "false");
    if (opened) {
      const fields = await dlg.locator(".cl-field").count();
      check("guided form has a field per 'What you'll need' item plus business details", fields >= 6, `${fields} fields`);
      check("guided form keeps the portal secondary (no portal button in the footer)", (await dlg.locator('footer a[target="_blank"]').count()) === 0);
      await page.screenshot({ path: path.join(OUT, `${tag}_guided_form.png`), fullPage: false });
      await page.keyboard.press("Escape");
      await dlg.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
    }
  }
}

// Teach Clara is reachable from every open row's ⋯ menu.
{
  const withMenu = main.locator('[data-testid="row-actions"]:has([data-testid="row-more"])');
  const total = await withMenu.count();
  let teachable = 0;
  for (let i = 0; i < total; i++) {
    const ra = withMenu.nth(i);
    if (!(await ra.isVisible())) continue;
    await ra.locator('[data-testid="row-more"]').click();
    if (await ra.locator('[data-testid="row-more-item"][data-cta="teach"]').count()) teachable++;
    await page.keyboard.press("Escape");
  }
  const visibleRows = await main.locator('[data-testid="row-actions"]').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null && !e.querySelector('[data-testid="row-done"]')).length);
  check("Teach Clara in the ⋯ menu of every open row", teachable > 0 && teachable === visibleRows, `${teachable}/${visibleRows}`);
  const portalRow = main.locator('[data-testid="req-group-energy"] [data-testid="row-actions"]:has([data-testid="row-more"])').first();
  if (await portalRow.count()) {
    await portalRow.locator('[data-testid="row-more"]').click();
    const items = await portalRow.locator('[data-testid="row-more-item"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-cta")));
    check("the official portal is in the ⋯ menu", items.includes("portal"), items.join(","));
    await page.screenshot({ path: path.join(OUT, `${tag}_teach_clara_menu.png`), fullPage: false });
    await portalRow.locator('[data-testid="row-more-item"][data-cta="teach"]').click();
    const dlg = page.locator('[data-testid="teach-clara-dialog"]');
    const opened = await dlg.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    check("Teach Clara opens in SmartPR", opened);
    if (opened) {
      const portal = await dlg.locator('[data-testid="teach-portal"]').inputValue();
      check("Teach Clara is prefilled with the row's portal", /^https:\/\//.test(portal), portal);
      await dlg.locator('[data-testid="teach-step"]').nth(0).fill("Sign in to the portal with the business account");
      await dlg.locator('[data-testid="teach-step"]').nth(1).fill("New application → choose the review type, fill the project details");
      await dlg.locator('[data-testid="teach-step"]').nth(2).fill("Upload the site plan and stop at the review page");
      await page.screenshot({ path: path.join(OUT, `${tag}_teach_clara_dialog.png`), fullPage: false });
      await dlg.locator('[data-testid="teach-save"]').click();
      const saved = await dlg.locator('[data-testid="teach-saved"]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
      check("Teach Clara saves (signed out: on this device)", saved);
      await page.screenshot({ path: path.join(OUT, `${tag}_teach_clara_saved.png`), fullPage: false });
      await page.keyboard.press("Escape");
      await dlg.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
    }
  }
}

// Spanish: the same buttons, localized.
{
  const langBtn = page.getByRole("button", { name: /^(ES|Español)$/ }).first();
  if (await langBtn.isVisible().catch(() => false)) {
    await langBtn.click();
    await page.waitForTimeout(600);
    const labels = await main.locator('[data-testid="row-actions"] > [data-testid="row-cta"]').allInnerTexts();
    check("ES: inline actions are in Spanish", labels.length > 0 && labels.every((l) => !/^(Complete form|Upload|Fill with Clara|Open portal|Start)$/.test(l.trim())), labels.map((l) => l.trim()).join(","));
    await page.screenshot({ path: path.join(OUT, `${tag}_requirements_es.png`), fullPage: true });
    const more = main.locator('[data-testid="req-group-energy"] [data-testid="row-more"]').first();
    if (await more.count()) {
      await more.click();
      const t = await main.locator('[data-testid="row-more-item"][data-cta="teach"]').first().innerText().catch(() => "");
      check("ES: 'Enséñale a Clara' in the ⋯ menu", /Enséñale a Clara/.test(t), t);
      await page.screenshot({ path: path.join(OUT, `${tag}_teach_clara_menu_es.png`), fullPage: false });
      await page.keyboard.press("Escape");
    }
    const enBtn = page.getByRole("button", { name: /^(EN|English)$/ }).first();
    if (await enBtn.isVisible().catch(() => false)) { await enBtn.click(); await page.waitForTimeout(500); }
  }
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
