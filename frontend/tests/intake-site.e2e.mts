/**
 * Intake page with a confirmed site (recorded official-map fixtures):
 *  1. the "Where will your business operate?" section, with its site card,
 *     stays inside the visible layout (no clipping/overflow, not under the
 *     sticky footer when scrolled to);
 *  2. the Fill-by-voice control is small and never covers the project
 *     sidebar;
 *  3. site results are clear labeled groups with consistent spacing and
 *     per-group expandable source details; the findings themselves are
 *     unchanged (same pills, considerations and sources).
 *
 *   BASE_URL=http://localhost:3217 E2E_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx tsx tests/intake-site.e2e.mts [outDir]
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAYER_SOURCES } from "../src/app/locations/layers";
import { LayerCache, resolveSiteLayers, type FetchLike } from "../src/app/locations/layerService";
import { buildSiteIntelligence } from "../src/app/locations/siteIntelligence";
import { validateProjectContext } from "../src/app/ai/intake/projectContext";

const OUT = process.argv[2] || path.join(os.tmpdir(), "intake-site");
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
const [lat, lng] = FX.points.toa_baja_ae as [number, number];
const layers = await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch, cache: new LayerCache(), skipOptional: true });
const expected = buildSiteIntelligence(layers, { municipality: "Toa Baja" });
const description = "New construction of a two-story retail building on our lot in Toa Baja.";
const { context } = validateProjectContext({ project_type: { value: "new_construction", confidence: 0.95, evidence: "New construction" }, municipality: { value: "Toa Baja", confidence: 0.95, evidence: "Toa Baja" } }, description);
const snap = { state: {
  profile: { name: "Tienda Sabana Seca", industry: "Retail", business_type: "Retail Store", municipality: "Toa Baja" },
  discoveryAnswers: {}, projectContext: context, projectIntent: "new_business", intakeDescription: description,
  intakeSite: { latitude: lat, longitude: lng, coordinate_source: "MAP_PIN", formatted_address: null, municipality: { name: "Toa Baja", fips: "137" }, barrio: { name: "Sabana Seca", geoid: null }, near_boundary: false, designations: [], boundary_source: null, location_id: null, confirmed_at: "2026-09-30T21:30:00.000Z" },
  currentStep: 1,
} };

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
const errors: string[] = [];
async function open(width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    const j = (b: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (p === "/api/snapshots/e2e-site") return j(snap);
    if (p === "/api/me") return j({ user: null });
    if (p === "/api/locations/layers") return j({ layers });
    if (p === "/api/locations/resolve" || p === "/api/incentives/evaluate") return route.continue();
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto(`${base}/?resume=e2e-site`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator('[data-testid="site-intelligence"]').first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(500);
  return page;
}
const box = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });
const overlap = (a: { top: number; bottom: number; left: number; right: number }, b: { top: number; bottom: number; left: number; right: number }) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);

for (const [w, h, tag] of [[1440, 900, "desktop"], [1280, 800, "laptop"], [390, 844, "mobile"]] as const) {
  const page = await open(w, h);
  const where = '[data-testid="intake-where"]';
  // 1 — location section inside the layout
  const wb = await box(page, where);
  const main = await box(page, ".spr-main-workarea");
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${tag}: location section within the form column`, wb.left >= main.left - 1 && wb.right <= main.right + 1, `${Math.round(wb.left)}–${Math.round(wb.right)} in ${Math.round(main.left)}–${Math.round(main.right)}`);
  check(`${tag}: no horizontal overflow`, overflowX <= 0, String(overflowX));
  const clipped = await page.locator(where).evaluate((el) => Array.from(el.querySelectorAll("*")).some((c) => { const r = c.getBoundingClientRect(); const p = el.getBoundingClientRect(); return r.width > 1 && !c.classList.contains("sr-only") && (r.right > p.right + 1 || r.left < p.left - 1); }));
  check(`${tag}: nothing inside the section spills out`, !clipped);
  // scroll the section's bottom into view: it must not sit under the sticky footer
  await page.locator(where).evaluate((e) => e.scrollIntoView({ block: "end" }));
  await page.waitForTimeout(300);
  const wb2 = await box(page, where);
  const foot = await box(page, ".spr-form-footer");
  const footerSticky = await page.locator(".spr-form-footer").evaluate((e) => getComputedStyle(e).position === "sticky" || getComputedStyle(e).position === "fixed");
  check(`${tag}: section end visible, not hidden under the footer`, wb2.bottom <= h + 1 && (!footerSticky || wb2.bottom <= foot.top + 1), `section bottom ${Math.round(wb2.bottom)}, footer top ${Math.round(foot.top)}`);

  // 2 — voice control: inline "Fill out by voice" pill under the describe box; no floating orb
  check(`${tag}: no floating voice orb`, (await page.locator('[data-testid="intake-voice-orb"]').count()) === 0);
  const pill = page.locator('[data-testid="intake-voice-start"]');
  const pb = await box(page, '[data-testid="intake-voice-start"]');
  const inputBox = await box(page, ".spr-nl-input");
  const pos = await pill.evaluate((e) => { for (let n: Element | null = e; n; n = n.parentElement) if (getComputedStyle(n).position === "fixed") return "fixed"; return "flow"; });
  check(`${tag}: voice pill is inline below the describe box, 52–58px tall`, pos === "flow" && pb.top >= inputBox.bottom && pb.height >= 52 && pb.height <= 58 && /Fill out by voice/.test(await pill.innerText()), `${Math.round(pb.width)}×${Math.round(pb.height)} ${pos}`);
  check(`${tag}: helper copy + separate Ask Clara row below`, /Complete your intake by speaking\./.test(await page.locator(".spr-voice-help").innerText()) && (await box(page, '[data-testid="intake-ask-clara"]')).top > pb.bottom);
  await page.evaluate(() => window.scrollTo(0, 0));

  // 3 — site results
  const si = page.locator(`${where} [data-testid="site-intelligence"]`);
  const groups = await si.locator(".spr-si-group").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-group"), title: e.querySelector(".spr-si-group-title")?.textContent?.trim(), pills: Array.from(e.querySelectorAll(".spr-si-pill")).map((p) => p.getAttribute("data-layer") + ":" + p.getAttribute("data-tone")) })));
  const exp = expected.groups.map((g) => ({ id: g.id, pills: g.pills.map((p) => `${p.layer}:${p.tone}`) }));
  check(`${tag}: same groups and findings as before (data unchanged)`, JSON.stringify(groups.map((g) => ({ id: g.id, pills: g.pills }))) === JSON.stringify(exp), groups.map((g) => `${g.title}[${g.pills.length}]`).join(" "));
  check(`${tag}: every group has a visible label`, groups.every((g) => (g.title ?? "").length > 2));
  check(`${tag}: considerations kept`, (await si.locator('[data-testid="site-consideration"]').count()) === expected.considerations.length);
  const gaps = await si.locator(".spr-si-group").evaluateAll((els) => els.slice(1).map((e, i) => Math.round(e.getBoundingClientRect().top - els[i]!.getBoundingClientRect().bottom)));
  check(`${tag}: consistent spacing between groups`, gaps.length > 0 && new Set(gaps).size === 1, gaps.join(","));
  // per-group source details
  const firstGroup = si.locator(".spr-si-group").first();
  const toggle = firstGroup.locator('[data-testid="site-group-sources-toggle"]');
  check(`${tag}: group source details collapsed by default`, (await toggle.getAttribute("aria-expanded")) === "false" && (await firstGroup.locator("a").count()) === 0);
  await toggle.click();
  const det = firstGroup.locator('[data-testid="site-group-sources"]');
  check(`${tag}: expanding shows that group's sources`, (await det.locator("article").count()) > 0 && (await det.locator("a[href^='http']").count()) > 0);
  await toggle.press("Enter");
  check(`${tag}: keyboard collapses it again`, (await toggle.getAttribute("aria-expanded")) === "false");
  check(`${tag}: all-sources control kept`, (await si.locator('[data-testid="site-sources-button"]').count()) === 1);
  await page.locator(where).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, `${tag}.png`), fullPage: true });
  await page.close();
}

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
