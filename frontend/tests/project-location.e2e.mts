/**
 * Intake "Project location" — one embedded workflow (real page, next dev).
 * Address search → pin + municipality; "Choose on map" expands the map inline
 * (no modal); tapping / moving the pin reverse-geocodes and re-resolves; the
 * municipality select appears only when detection fails; mobile + keyboard.
 *
 * Stubbed: /api/geocode (search + reverse), basemap style, map layers
 * (recorded fixtures). Real: /api/locations/resolve (Census municipio).
 *
 *   BASE_URL=http://localhost:3217 E2E_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx tsx tests/project-location.e2e.mts [outDir]
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAYER_SOURCES } from "../src/app/locations/layers";
import { LayerCache, resolveSiteLayers, type FetchLike } from "../src/app/locations/layerService";

const OUT = process.argv[2] || path.join(os.tmpdir(), "project-location");
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:3000";
const here = path.dirname(fileURLToPath(import.meta.url));
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const FX = JSON.parse(readFileSync(path.join(here, "../src/app/locations/fixtures/arcgisLayers.json"), "utf8"));
const URL_LAYER: Array<[string, string]> = [
  [LAYER_SOURCES.fema_flood_zones.url, "fema_zones"], [LAYER_SOURCES.fema_firm_panels.url, "fema_panels"],
  [LAYER_SOURCES.jp_calificacion.url, "jp_calif"], [LAYER_SOURCES.crim_parcels.url, "crim"],
  [LAYER_SOURCES.jp_zona_costanera.url, "czm_official"], [LAYER_SOURCES.jp_linea_costa.url, "coastline"],
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
const GUAYNABO = { formatted_address: "Calle José de Diego, Guaynabo, PR 00969", address_line_1: "Calle José de Diego", latitude: gLat, longitude: gLng, municipality: "Guaynabo", city: "Guaynabo", postal_code: "00969", country_code: "PR", place_source: "stub", place_source_id: "g1" };
const OCEAN = { ...GUAYNABO, formatted_address: "Somewhere offshore", latitude: 18.9, longitude: -66.5, place_source_id: "o1" };
const reverseCalls: string[] = [];
const layerCalls: string[] = [];

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const errors: string[] = [];
async function open(width: number, height = 900): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("https://tiles.openfreemap.org/**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#e8efe9" } }] }) }));
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    const j = (b: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (p === "/api/me") return j({ user: null });
    if (p === "/api/geocode") {
      const q = u.searchParams.get("q");
      if (q) return j({ results: /ocean/i.test(q) ? [OCEAN] : [GUAYNABO, { ...GUAYNABO, formatted_address: "Guaynabo City Hall, Guaynabo, PR", place_source_id: "g2" }] });
      reverseCalls.push(`${u.searchParams.get("lat")},${u.searchParams.get("lng")}`);
      return j({ result: { ...GUAYNABO, formatted_address: "Carr. 2 km 8, Guaynabo, PR", latitude: Number(u.searchParams.get("lat")), longitude: Number(u.searchParams.get("lng")) } });
    }
    if (p === "/api/locations/layers") {
      layerCalls.push(`${u.searchParams.get("lat")},${u.searchParams.get("lng")}`);
      return j({ layers: await resolveSiteLayers(Number(u.searchParams.get("lat")), Number(u.searchParams.get("lng")), { fetchImpl: fixtureFetch, cache: new LayerCache(), skipOptional: true }) });
    }
    if (p === "/api/locations/resolve" || p === "/api/incentives/evaluate") return route.continue();
    return j({}, 404);
  });
  await page.goto(`${base}/?entry=new-business`, { waitUntil: "networkidle", timeout: 120000 });
  await page.locator('[data-testid="project-location"]').waitFor({ timeout: 60000 });
  return page;
}

// ---------------- desktop
{
  const page = await open(1440);
  const sec = page.locator('[data-testid="project-location"]');
  check("one 'Project location' card with the supporting text", (await sec.getByRole("heading", { name: "Project location" }).count()) === 1 && /Enter an address or select the exact site/.test(await sec.innerText()));
  const input = page.locator('[data-testid="project-location-search"]');
  check("address search is the primary input (placeholder, icon, ≥16px)", (await input.getAttribute("placeholder")) === "Search address, business, or place" && (await sec.locator(".spr-plc-search-icon").count()) === 1 && parseFloat(await input.evaluate((e) => getComputedStyle(e).fontSize)) >= 16);
  const [iw, sw] = await Promise.all([input.evaluate((e) => e.getBoundingClientRect().width), sec.evaluate((e) => e.getBoundingClientRect().width)]);
  check("search is (near) full width", iw > sw * 0.75, `${Math.round(iw)} of ${Math.round(sw)}`);
  check("municipality dropdown not shown up front", (await page.locator("#spr-municipality").count()) === 0);
  check("workspace hidden until the user starts", (await page.locator('[data-testid="project-location-map"]').count()) === 0);
  await page.screenshot({ path: path.join(OUT, "0_initial.png"), fullPage: false });

  // keyboard: type + Enter → map + selected details, not yet saved
  await input.click();
  await input.fill("Calle José de Diego Guaynabo");
  await page.keyboard.press("Enter");
  const conf = page.locator('[data-testid="project-location-confirmed"]');
  await conf.waitFor({ timeout: 30000 });
  check("Enter geocodes → 'Exact site selected' details next to the map", /Exact site selected/.test(await conf.innerText()) && (await page.locator('[data-testid="project-location-map"]').count()) === 1);
  const [mb, cb] = [await page.locator('[data-testid="project-location-map"]').boundingBox(), await conf.boundingBox()];
  check("desktop: map left, details right", Boolean(mb && cb && cb.x > mb.x + mb.width - 1 && Math.abs(mb.width - cb.width) < mb.width * 0.25), JSON.stringify({ mb, cb }));
  check("details: clean address (no United States)", /Calle José de Diego|Guaynabo/.test(await page.locator('[data-testid="project-location-address"]').innerText()) && !/United States/.test(await conf.innerText()));
  check("details: municipality derived automatically", /^Guaynabo/.test(await page.locator('[data-testid="project-location-municipality"]').innerText()));
  check("details: coordinates", /^18\.\d+, -66\.\d+$/.test((await page.locator('[data-testid="project-location-coordinates"]').innerText()).trim()));
  check("other matches offered", (await sec.getByText("Not the right place?").count()) === 1);
  check("no modal", (await page.locator('[role="dialog"]').count()) === 0);
  await page.screenshot({ path: path.join(OUT, "1_selected.png"), fullPage: false });

  await page.locator('[data-testid="project-location-use"]').click();
  await page.locator('[data-testid="project-location"][data-state="saved"]').waitFor({ timeout: 10000 });
  check("Use this location → 'Location saved' + Edit location", /Location saved/.test(await conf.innerText()) && (await sec.getByRole("button", { name: "Edit location" }).count()) === 1);
  check("sidebar + still-needed updated (municipality no longer missing)", /Guaynabo/.test(await page.locator(".spr-project-summary").innerText()) && !(await page.locator(".spr-still-needed-chip").allInnerTexts()).includes("Municipality"));
  await page.locator('[data-testid="location-layer-chips"][data-state="done"]').waitFor({ timeout: 30000 });
  check("existing site checks ran (FEMA / zoning / parcel)", layerCalls.length >= 1 && (await sec.locator('[data-testid="site-intelligence"]').count()) === 1);
  await page.screenshot({ path: path.join(OUT, "2_saved.png"), fullPage: false });

  // Edit → map tap moves the pin, reverse-geocodes, details follow
  await sec.getByRole("button", { name: "Edit location" }).click();
  await page.locator('[data-testid="project-location-map"] canvas').waitFor({ timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const canvas = page.locator('[data-testid="project-location-map"] canvas').first();
  if (await canvas.count()) {
    const box = (await canvas.boundingBox())!;
    const before = await page.locator('[data-testid="project-location-coordinates"]').innerText();
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);
    await page.waitForFunction((b) => { const el = document.querySelector('[data-testid="project-location-coordinates"]'); return el && el.textContent !== b; }, before, { timeout: 20000 }).catch(() => undefined);
    const after = await page.locator('[data-testid="project-location-coordinates"]').innerText().catch(() => before);
    const fallback = await page.locator('[data-testid="project-location-fallback"]').count();
    check("map tap moves the pin: coordinates update (or fallback if off-island)", after !== before || fallback === 1, `${before} → ${after}`);
    check("map tap reverse-geocodes the address into the search", reverseCalls.length >= 1 && ((await input.inputValue()).includes("Carr. 2") || fallback === 1), await input.inputValue());
  } else {
    check("map canvas rendered (WebGL)", false, "no canvas");
  }
  await page.screenshot({ path: path.join(OUT, "3_edit_pin.png"), fullPage: false });

  // fallback: detection fails → municipality select appears with the message
  await input.fill("ocean point");
  await page.keyboard.press("Enter");
  const fb = page.locator('[data-testid="project-location-fallback"]');
  await fb.waitFor({ timeout: 30000 });
  check("fallback message when municipality can't be determined", /We couldn’t determine the municipality/.test(await fb.innerText()));
  check("fallback shows the existing municipality select", (await fb.locator("#spr-municipality option").count()) > 70);
  check("unresolved address drops the previous site (address, pin and municipality stay in sync)", (await page.locator('[data-testid="summary-site-label"]').count()) === 0 && (await page.locator('[data-testid="project-location-confirmed"]').count()) === 0);
  await fb.locator("#spr-municipality").selectOption({ label: "Ponce" });
  check("fallback selection sets the municipality", /Ponce/.test(await page.locator(".spr-project-summary").innerText()));
  await page.screenshot({ path: path.join(OUT, "4_fallback.png"), fullPage: false });
  await page.close();
}

// ---------------- mobile
{
  const page = await open(390, 844);
  const fs = await page.locator('[data-testid="project-location-search"]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  check("mobile: search text ≥16px", fs >= 16, String(fs));
  await page.locator('[data-testid="project-location-search"]').fill("Guaynabo");
  await page.locator('[data-testid="project-location-find"]').click();
  const conf = page.locator('[data-testid="project-location-confirmed"]');
  await conf.waitFor({ timeout: 30000 });
  const mb = await page.locator('[data-testid="project-location-map"]').boundingBox();
  const cb = await conf.boundingBox();
  const secW = (await page.locator('[data-testid="project-location"]').boundingBox())!.width;
  check("mobile: map full card width, details stacked below", Boolean(mb && cb && mb.width >= secW - 34 && mb.height >= 250 && cb.y >= mb.y + mb.height - 1), JSON.stringify({ mb, cb }));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("mobile: no horizontal overflow", overflow <= 0, String(overflow));
  await page.locator('[data-testid="project-location-use"]').click();
  check("mobile: Use this location saves it", /Guaynabo/.test(await page.locator('[data-testid="project-location-municipality"]').innerText()) && (await page.locator('[data-testid="project-location"][data-state="saved"]').count()) === 1);
  await page.locator('[data-testid="project-location"]').screenshot({ path: path.join(OUT, "5_mobile.png") });
  await page.close();
}

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
