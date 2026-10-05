/**
 * Property & Site Report + prompt/pin reconciliation — real intake page (next dev).
 *
 * Stubbed: /api/geocode, /api/me, /api/snapshots, basemap tiles, and the
 * site-layer / parcel services (served from RECORDED live answers in
 * src/app/locations/fixtures/propertyReportCases.json, with controllable
 * delays and failures). Real: /api/locations/resolve (Census municipio).
 * Professional review endpoints are served in-memory through the same pure
 * applyReviewAction() the server uses.
 *
 *   BASE_URL=http://localhost:3217 E2E_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx tsx tests/property-report.e2e.mts [outDir]
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyReviewAction, attachReportVersion, emptyReview, parseReviewAction, type PropertyReview } from "../src/app/locations/propertyReview";
import { resolveParcelFindings } from "../src/app/locations/parcelService";
import { LAYER_SOURCES } from "../src/app/locations/layers";
import { parseFloodZones, parseParcelBoundary, parseZoningDistricts } from "../src/app/locations/parcel";

const OUT = process.argv[2] || path.join(os.tmpdir(), "property-report");
mkdirSync(OUT, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:3000";
const here = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(readFileSync(path.join(here, "../src/app/locations/fixtures/propertyReportCases.json"), "utf8"));
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

type Case = { latitude: number; longitude: number; place: { municipio: { name: string; fips?: string }; barrio?: { name: string; geoid?: string } }; layers: unknown; parcel: unknown };
const C = FX.cases as Record<string, Case>;
// Aguas Buenas 224-000-006-78: whole-parcel answers recorded live 2026-10-04
// (fixtures/parcelRaw.json) replayed through the real parcel service; pin
// layers mirror the report the user pasted for that parcel.
{
  const RAW = JSON.parse(readFileSync(path.join(here, "../src/app/locations/fixtures/parcelRaw.json"), "utf8")).sites.aguas_buenas;
  const at = "2026-10-04T21:18:46.000Z";
  const parcel = await resolveParcelFindings(RAW.latitude, RAW.longitude, {
    fetchImpl: (async (u: string) => ({ ok: RAW.gets[u]?.ok ?? false, status: RAW.gets[u]?.status ?? 599, json: async () => RAW.gets[u]?.body ?? null })) as never,
    postJson: async (_u, b) => RAW.posts.find((x: { query: string }) => x.query === (b as { query: string }).query)?.response ?? "not_recorded",
    refresh: true, now: () => new Date(at),
  });
  const s = (k: keyof typeof LAYER_SOURCES, version: string | null = null, date: string | null = null) => ({ id: LAYER_SOURCES[k].id, name: LAYER_SOURCES[k].name, url: LAYER_SOURCES[k].url, layer: LAYER_SOURCES[k].layer, dataset_date: date ?? LAYER_SOURCES[k].dataset_date, version });
  const b = { tags: [] as string[], attributes: {}, retrieval: "live", approximate: false, reason: null, retrieved_at: at };
  C.aguas_buenas = {
    latitude: RAW.latitude, longitude: RAW.longitude,
    place: { municipio: { name: "Aguas Buenas", fips: "72007" }, barrio: { name: "Sumidero" } },
    layers: { latitude: RAW.latitude, longitude: RAW.longitude, resolved_at: at, results: [
      { ...b, layer: "flood_zone", status: "resolved", code: "X", name: "Zone X", attributes: { FIRM_PAN: "72000C1185H", EFF_DATE: "2005-04-19" }, source: s("fema_flood_zones") },
      { ...b, layer: "flood_advisory", status: "unknown", code: null, name: null, reason: "timeout_9000ms", retrieval: "none", source: s("jp_advisory_flood") },
      { ...b, layer: "zoning", status: "resolved", code: "R-G", name: "Rural General", tags: ["rural"], source: s("jp_calificacion", "JP-PT-45 · 15-SEP-2011", "2011-09-15") },
      { ...b, layer: "land_class", status: "resolved", code: "SRC", name: "Suelo Rústico Común", tags: ["SRC", "RUSTICO"], source: s("jp_calificacion", "JP-PT-45 · 15-SEP-2011", "2011-09-15") },
      { ...b, layer: "terrain", status: "resolved", code: "Moderate", name: "Moderate", tags: ["LANDSLIDE_MODERATE"], source: s("usgs_landslide") },
      { ...b, layer: "coastal_zone", status: "none", code: null, name: null, source: s("jp_zona_costanera") },
    ] },
    parcel,
  };
}
// Guayama · Machete (reconstructed from the reported failure): no CRIM parcel
// at the pin, VIAL / Sistema vial at the pin, everything answered point-only.
{
  const lat = 17.9851, lng = -66.1418, at = "2026-10-05T14:00:00.000Z";
  const s = (k: keyof typeof LAYER_SOURCES) => ({ id: LAYER_SOURCES[k].id, name: LAYER_SOURCES[k].name, url: LAYER_SOURCES[k].url, layer: LAYER_SOURCES[k].layer, dataset_date: LAYER_SOURCES[k].dataset_date, version: null });
  const b = { tags: [] as string[], attributes: {}, retrieval: "live", approximate: false, reason: null, retrieved_at: at };
  C.guayama_machete = {
    latitude: lat, longitude: lng,
    place: { municipio: { name: "Guayama", fips: "72057" }, barrio: { name: "Machete" } },
    layers: { latitude: lat, longitude: lng, resolved_at: at, results: [
      { ...b, layer: "flood_zone", status: "resolved", code: "X", name: "Zone X", attributes: { FIRM_PAN: "72000C1425J", EFF_DATE: "2009-11-18", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" }, source: s("fema_flood_zones") },
      { ...b, layer: "flood_advisory", status: "none", code: null, name: null, source: s("jp_advisory_flood") },
      { ...b, layer: "zoning", status: "resolved", code: "VIAL", name: "Sistema vial", tags: ["road"], source: s("jp_calificacion") },
      { ...b, layer: "terrain", status: "resolved", code: "Low", name: "Low", tags: ["LANDSLIDE_LOW"], source: s("usgs_landslide") },
      { ...b, layer: "coastal_zone", status: "none", code: null, name: null, source: s("jp_zona_costanera") },
    ] },
    parcel: {
      latitude: lat, longitude: lng, retrieved_at: at,
      boundary: parseParcelBoundary({ features: [] } as never, lng, lat),
      zoning: parseZoningDistricts({ features: [{ attributes: { cali: "VIAL", descrip: "Sistema vial" } }] } as never, "point"),
      flood: parseFloodZones({ features: [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F" } }] } as never, "point"),
      areas_reliable: { zoning: false, flood: false },
      extras: {},
    },
  };
}
const GURABO = C.protected_rural!, CAGUAS = C.straightforward!, CAROLINA = C.multi_district_b!;
const byPoint = (lat: number, lng: number) => Object.values(C).find((c) => Math.abs(c.latitude - lat) < 1e-6 && Math.abs(c.longitude - lng) < 1e-6);
const siteOf = (c: Case, extra: Record<string, unknown> = {}) => ({
  latitude: c.latitude, longitude: c.longitude, coordinate_source: "MAP_PIN", formatted_address: null,
  municipality: { name: c.place.municipio.name, fips: c.place.municipio.fips ?? null },
  barrio: c.place.barrio ? { name: c.place.barrio.name, geoid: c.place.barrio.geoid ?? null } : null,
  near_boundary: false, designations: [], boundary_source: null, location_id: null, confirmed_at: "2026-10-04T10:00:00.000Z", ...extra,
});
const geo = (c: Case, label: string) => ({ formatted_address: label, address_line_1: label, latitude: c.latitude, longitude: c.longitude, municipality: c.place.municipio.name, city: c.place.municipio.name, postal_code: null, country_code: "PR", place_source: "stub", place_source_id: label });

interface Opts {
  state: Record<string, unknown>;
  businessId?: string | null;
  signedIn?: boolean;
  parcelDelay?: (lat: number) => number;
  failSources?: boolean;
}
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const errors: string[] = [];
let parcelCalls: string[] = [];
let reviewStore: PropertyReview = emptyReview();
let savedVersions = 0;

async function open(width: number, height: number, o: Opts): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("https://tiles.openfreemap.org/**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#e8efe9" } }] }) }));
  await page.route(/server\.arcgisonline\.com|hazards\.fema\.gov|sigejp\.pr\.gov/, (r) => r.fulfill({ status: 204, body: "" }));
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    const j = (b: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (p === "/api/me") return j({ user: o.signedIn ? { id: "u-pro", email: "pro@example.com" } : null });
    if (p === "/api/snapshots/e2e-pr") return route.request().method() === "GET" ? j({ state: o.state, business_id: o.businessId ?? null }) : j({ ok: true });
    if (p.startsWith("/api/snapshots")) return j({ ok: true });
    if (p === "/api/geocode") {
      const q = (u.searchParams.get("q") ?? "").toLowerCase();
      if (q) {
        if (q.includes("calle luna")) return j({ results: [geo(CAROLINA, "Calle Luna 12, Carolina, PR")] });
        if (q.includes("caguas")) return j({ results: [geo(CAGUAS, "Caguas, Puerto Rico")] });
        if (q.includes("carolina")) return j({ results: [geo(CAROLINA, "Carolina, Puerto Rico")] });
        if (q.includes("gurabo")) return j({ results: [geo(GURABO, "Gurabo, Puerto Rico")] });
        return j({ results: [] });
      }
      const c = byPoint(Number(u.searchParams.get("lat")), Number(u.searchParams.get("lng")));
      return j({ result: c ? geo(c, `${c.place.barrio?.name ?? ""}, ${c.place.municipio.name}, PR`) : null });
    }
    if (p === "/api/locations/layers") {
      const lat = Number(u.searchParams.get("lat")), lng = Number(u.searchParams.get("lng"));
      if (o.failSources) return j({ error: "down" }, 503);
      const c = byPoint(lat, lng);
      return j({ layers: c ? c.layers : null, reason: c ? undefined : "no_fixture" });
    }
    if (p === "/api/locations/parcel") {
      const lat = Number(u.searchParams.get("lat")), lng = Number(u.searchParams.get("lng"));
      parcelCalls.push(`${lat},${lng}`);
      const wait = o.parcelDelay?.(lat) ?? 0;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (o.failSources) return j({ error: "down" }, 503).catch(() => undefined);
      const c = byPoint(lat, lng);
      return j({ parcel: c ? c.parcel : null }).catch(() => undefined);
    }
    if (/\/site-reports\/review$/.test(p)) {
      if (route.request().method() === "GET") return j({ review: reviewStore.report_version ? reviewStore : null });
      const action = parseReviewAction((route.request().postDataJSON() as { action: unknown }).action);
      const bound = attachReportVersion(reviewStore, savedVersions || 1, `fp${savedVersions}`, { id: "u-pro", name: "Arq. Rivera" }, new Date().toISOString());
      const r = action ? applyReviewAction(bound, action, { id: "u-pro", name: "Arq. Rivera" }, new Date().toISOString(), () => Math.random().toString(36).slice(2)) : { ok: false as const, error: "invalid_action" };
      if (!r.ok) return j({ error: r.error }, 409);
      reviewStore = r.review;
      return j({ review: r.review });
    }
    if (/\/site-reports$/.test(p)) {
      savedVersions += 1;
      return j({ ok: true, created: true, saved: { id: "r1", version: savedVersions, fingerprint: "x", created_at: new Date().toISOString() } });
    }
    if (p === "/api/locations/resolve" || p === "/api/incentives/evaluate") return route.continue();
    return j({}, 404);
  });
  await page.goto(`${base}/?resume=e2e-pr`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator('[data-testid="project-location"]').first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(800);
  return page;
}
const state = (description: string, site: unknown = null, extra: Record<string, unknown> = {}) => ({
  profile: { name: "Café Prueba", industry: "Food & Beverage", business_type: "Restaurant", municipality: site ? (site as { municipality: { name: string } }).municipality.name : "" },
  discoveryAnswers: {}, projectIntent: "new_business", intakeDescription: description, intakeSite: site, currentStep: 1, ...extra,
});
const text = (page: Page, sel: string) => page.locator(sel).first().innerText().catch(() => "");
/** "Detailed site findings" and per-row "Source details" are collapsed by default: open them to inspect. */
const expandAll = async (p: Page) => {
  await p.locator('[data-testid="property-report"]').waitFor();
  await p.evaluate(`document.querySelectorAll('[data-testid="property-report"] details').forEach((d) => { d.open = true; })`);
};
const visible = (page: Page, sel: string) => page.locator(sel).first().isVisible().catch(() => false);
const preview = '[data-testid="site-report-preview"]';
const waitPreviewCatastro = (page: Page, cat: string, ms = 20000) => page.locator(`[data-testid="project-location"] [data-testid="project-location-catastro"] >> text=${cat}`).first().waitFor({ timeout: ms }).then(() => true).catch(() => false);

// 1 — pin-first conflict + Keep selected property
{
  const page = await open(1440, 900, { state: state("We are opening a restaurant in Ponce.", siteOf(GURABO)) });
  const notice = '[data-testid="location-conflict"]';
  check("pin-first: conflict notice names both places", (await text(page, notice)).includes("Ponce") && (await text(page, notice)).includes("Gurabo"), await text(page, notice));
  check("pin-first: confirmed pin kept (municipality still Gurabo)", (await text(page, '[data-testid="project-location-municipality"]')).includes("Gurabo"));
  await page.locator('[data-testid="project-location-catastro"]').first().waitFor({ timeout: 20000 }).catch(() => undefined);
  check("compact preview: catastro + key findings for the confirmed parcel", (await text(page, '[data-testid="project-location-catastro"]')).includes("173-000-001-39") && (await visible(page, `${preview} [data-finding="zoning"]`)));
  check("compact preview: no professional review controls", (await page.locator(`${preview} [data-testid="finding-review"], [data-testid="project-location"] [data-testid="review-panel"]`).count()) === 0);
  check("compact preview: colour-coded plain-language pills only (no source list, no long text)", (await page.locator(`${preview} .spr-srp-pill`).count()) >= 3 && (await page.locator(`${preview} .spr-srp-sources`).count()) === 0 && /FEMA Zone X/.test(await text(page, preview)) && !/Low flood risk/.test(await text(page, preview)));
  check("no unexplained numeric 'Place name'", (await page.locator('[data-testid="project-location-place"]').count()) === 0);
  await page.screenshot({ path: path.join(OUT, "1-conflict.png"), fullPage: false });
  await page.click('[data-testid="conflict-keep"]');
  await page.waitForTimeout(300);
  check("Keep selected property: notice resolves, pin stays authoritative", !(await visible(page, notice)) && (await text(page, '[data-testid="project-location-municipality"]')).includes("Gurabo"));
  // map layers: easiest-to-read base map by default; satellite + official overlays on demand
  const card = page.locator('[data-testid="project-location"]').first();
  await card.locator('[data-testid="map-layer-controls"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  check("map: layer panel starts collapsed", (await card.locator('[data-testid="map-base-streets"]').count()) === 0);
  await card.locator('[data-testid="map-layers-toggle"]').click();
  check("map: plain street map is the default base", (await card.locator('[data-testid="map-base-streets"]').getAttribute("aria-pressed")) === "true");
  check("map: saved map has zoom controls", (await card.locator(".maplibregl-ctrl-zoom-out").count()) === 1);
  await card.locator('[data-testid="map-base-satellite"]').click();
  await card.locator('[data-testid="map-overlay-flood"]').check();
  check("map: satellite + FEMA flood overlay can be switched on", (await card.locator('[data-testid="map-base-satellite"]').getAttribute("aria-pressed")) === "true" && (await card.locator('[data-testid="map-overlay-flood"]').isChecked()));
  const cb = await card.locator('[data-testid="map-overlay-flood"]').boundingBox();
  check("map: overlay checkbox keeps a normal size", !!cb && cb.width <= 20 && cb.height <= 20, JSON.stringify(cb));
  check("map: credit is plain text (no outbound link)", (await card.locator('[data-testid="map-credit"]').count()) === 1 && (await card.locator(".maplibregl-ctrl-attrib a").count()) === 0);
  await card.locator('[data-testid="map-base-streets"]').click();
  await card.locator('[data-testid="map-layers-toggle"]').click();
  check("map: layer panel can be minimised", (await card.locator('[data-testid="map-base-streets"]').count()) === 0);
  await card.screenshot({ path: path.join(OUT, "1b-card.png") });
  // 2 — open the report: focus, scroll, Esc
  await page.locator('[data-testid="open-property-report"]').scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.click('[data-testid="open-property-report"]');
  await expandAll(page);
  await page.locator('[data-testid="property-report"]').waitFor({ timeout: 10000 });
  check("drawer: dialog with aria-modal and focus on Close", (await page.locator('[role="dialog"][aria-modal="true"]').count()) === 1 && (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "property-report-close");
  const r = await text(page, '[data-testid="property-report"]');
  check("drawer: reviewer layout — key findings, next steps, detailed findings (land, flood, environment), approvals", /Key regulatory findings/.test(r) && /Recommended next steps/.test(r) && /Detailed site findings/.test(r) && /Land & zoning/.test(r) && /Flood & water/.test(r) && /Required approvals/.test(r));
  // Checks this (older) parcel record never ran read "Not checked" with that basis — never "Official map finding".
  const notRun = page.locator('[data-finding][data-state="not_performed"]');
  const notRunBases = await notRun.evaluateAll((els) => els.map((e) => `${e.getAttribute("data-basis")}|${e.querySelector('[data-testid="finding-basis"]')?.textContent}`));
  check("drawer: checks not performed are labelled as such, never as official findings", notRunBases.every((x) => x === "not_performed|Check not performed"), notRunBases.join(","));
  const severe = await page.locator('[data-testid="key-findings"] [data-status="review"] li[data-severe]').count();
  check("drawer: protection designations lead 'Review required' (severe) and rank first in next steps, with the 'do not remove' rationale behind Why?", severe >= 1 && /do not remove/.test(await text(page, '[data-testid="next-steps"] li:first-child .spr-rv-why')));
  check("drawer: AI explanations kept separate (none generated)", /None in this report/.test(await text(page, '[data-testid="ai-explanations"]')));
  check("drawer: signed-out → draft note, no Passport claim", /Sign in to save/.test(await text(page, '[data-testid="report-draft-note"]')) && !(await visible(page, '[data-testid="report-save-passport"]')));
  check("drawer: professional review needs a saved report", await visible(page, '[data-testid="review-unavailable"]'));
  await page.click('button[aria-expanded="false"].spr-prd-tech-toggle');
  check("drawer: NAD83 X/Y expandable", /EPSG:32161/.test(await text(page, '[data-testid="report-technical"]')));
  // exports
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="report-json"]')]);
  const json = JSON.parse(readFileSync((await dl.path())!, "utf8"));
  check("export JSON: same model, confirmed parcel, every finding at the confirmed point", json.schema === "smartpr.property-report/v3" && Array.isArray(json.summary?.mapped) && json.property.catastro.value === "173-000-001-39" && json.findings.every((f: { point: { latitude: number } | null }) => !f.point || Math.abs(f.point.latitude - GURABO.latitude) < 1e-7));
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="report-pdf"]')]);
  check("export PDF downloads", /\.pdf$/.test(pdf.suggestedFilename()), pdf.suggestedFilename());
  await pdf.saveAs(path.join(OUT, "report.pdf"));
  await page.click('[data-testid="report-copy"]');
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check("copy summary", clip.includes("173-000-001-39") && /Review required:\n• Land classification: Specially protected rustic land/.test(clip));
  await page.screenshot({ path: path.join(OUT, "2-drawer-desktop.png") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Esc closes; focus returns to the opener; scroll preserved", !(await visible(page, '[data-testid="property-report"]')) && (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "open-property-report" && Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore) < 4);
  await page.context().close();
}

// 3 — "Use location from description" → proposal; cancel keeps the confirmed site
{
  const page = await open(1440, 900, { state: state("Opening a restaurant in Caguas.", siteOf(GURABO)) });
  await page.click('[data-testid="conflict-use"]');
  await page.locator('[data-testid="location-proposal"]').waitFor({ timeout: 10000 });
  check("use description: area proposal shown, never confirmed as a site", /area, not a site/.test(await text(page, '[data-testid="location-proposal"]')));
  check("use description: requirements keep using the confirmed site meanwhile", /keep using Gurabo/.test(await text(page, '[data-testid="location-proposal"]')));
  await page.click('[data-testid="location-edit-cancel"]');
  await page.waitForTimeout(400);
  check("cancel: previous confirmed site preserved; conflict still unresolved", (await text(page, '[data-testid="project-location-municipality"]')).includes("Gurabo") && (await visible(page, '[data-testid="location-conflict"]')));
  await page.context().close();
}

// 4 — prompt-first: area only, address, multiple, incidental, same municipality
{
  const page = await open(1280, 860, { state: state("I want to open a bakery in Caguas.") });
  check("prompt-first area: proposal asks for the exact property", /select the exact property/.test(await text(page, '[data-testid="location-proposal"]')) && (await page.locator('[data-testid="project-location-confirmed"]').count()) === 0);
  await page.context().close();
}
{
  const page = await open(1280, 860, { state: state("Café at Calle Luna 12 in Carolina.") });
  await page.locator('[data-testid="project-location-use"]:not([disabled])').waitFor({ timeout: 20000 }).catch(() => undefined);
  check("prompt-first address: proposed pin labelled, needs confirmation", (await page.locator('[data-proposed="true"]').count()) === 1 && (await page.locator('[data-testid="project-location-use"]:not([disabled])').count()) === 1);
  await page.click('[data-testid="project-location-use"]');
  check("confirm proposal → site, parcel and findings refresh together", await waitPreviewCatastro(page, "041-087-017-17"));
  await page.context().close();
}
{
  const page = await open(1280, 860, { state: state("Choosing between a local in Caguas or a local in Carolina.") });
  await page.locator('[data-testid="ambiguous-option"]').nth(1).waitFor({ timeout: 15000 }).catch(() => undefined);
  const opts = await page.locator('[data-testid="ambiguous-option"]').allInnerTexts();
  check("multiple locations → asks which is the project site", opts.length === 2, opts.join(" | "));
  await page.context().close();
}
for (const [desc, tag] of [["Restaurant in Gurabo serving customers from Caguas and Carolina.", "incidental mentions"], ["A family restaurant in Gurabo.", "same municipality"]] as const) {
  const page = await open(1280, 860, { state: state(desc, siteOf(GURABO)) });
  check(`${tag}: no conflict, pin kept`, !(await visible(page, '[data-testid="location-conflict"]')) && !(await visible(page, '[data-testid="location-ambiguous"]')));
  await page.context().close();
}

// 5 — rapid location changes: a slow answer for the old site never shows under the new one
{
  parcelCalls = [];
  const page = await open(1440, 900, { state: state("Restaurant.", siteOf(GURABO)), parcelDelay: (lat) => (Math.abs(lat - GURABO.latitude) < 1e-6 ? 6000 : 0) });
  await page.click('[data-testid="location-change"]');
  await page.fill('[data-testid="project-location-search"]', "Caguas");
  await page.click('[data-testid="project-location-find"]');
  await page.locator('[data-testid="project-location-use"]:not([disabled])').waitFor({ timeout: 20000 });
  await page.click('[data-testid="project-location-use"]');
  const ok = await waitPreviewCatastro(page, "225-085-948-54");
  await page.waitForTimeout(6500); // let the slow Gurabo answer arrive
  const t = await text(page, '[data-testid="project-location"]');
  check("rapid change: only the confirmed site's parcel is shown", ok && !t.includes("173-000-001-39") && t.includes("225-085-948-54"), parcelCalls.join(" | "));
  await page.context().close();
}

// 6 — source failures: unavailable, never "none"
{
  const page = await open(1440, 900, { state: state("Restaurant.", siteOf(CAGUAS)), failSources: true });
  await page.locator(`${preview} [data-finding="flood_zone"][data-state="unavailable"]`).waitFor({ timeout: 20000 }).catch(() => undefined);
  check("source failure: findings unavailable + retry offered", (await page.locator(`${preview} [data-state="unavailable"]`).count()) >= 2 && (await visible(page, ".spr-srp-retry")));
  await page.context().close();
}

// 7 — reopen saved intake: report restored from the snapshot (no new parcel lookup)
{
  parcelCalls = [];
  const page = await open(1440, 900, { state: state("Restaurant.", siteOf(GURABO, { layers: GURABO.layers }), { parcelFindings: GURABO.parcel, locationState: { revision: 3, kept: [], dismissed: [] } }) });
  check("reopen: parcel + findings restored without re-querying", (await waitPreviewCatastro(page, "173-000-001-39", 8000)) && parcelCalls.length === 0, parcelCalls.join(","));
  await page.context().close();
}

// 8 — mobile: full-screen report, no horizontal overflow
{
  const page = await open(390, 844, { state: state("Restaurant.", siteOf(CAROLINA)) });
  await page.locator('[data-testid="open-property-report"]').waitFor({ timeout: 20000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("mobile intake: no horizontal overflow", overflow <= 0, String(overflow));
  await page.click('[data-testid="open-property-report"]');
  await expandAll(page);
  const [w, vw] = await page.locator('[data-testid="property-report"]').evaluate((e) => [e.getBoundingClientRect().width, document.documentElement.getBoundingClientRect().width]);
  check("mobile: report fills the visible viewport", Math.abs(w - vw) <= 1, `${w} of ${vw}`);
  check("mobile: multi-district + conflicting flood data listed", /CT-3/.test(await text(page, '[data-finding="zoning"]')) && /At the pin, the JP advisory map shows/.test(await text(page, '[data-testid="property-report"]')));
  // Copy summary when the async Clipboard API is refused (iOS Safari / Chrome on iPhone).
  await page.evaluate(`(() => {
    window.__copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) } });
    document.addEventListener("copy", () => { window.__copied = document.activeElement && document.activeElement.value || ""; });
  })()`);
  await page.click('[data-testid="report-copy"]');
  await page.waitForTimeout(300);
  const legacy = String(await page.evaluate("window.__copied"));
  check("mobile copy: falls back when the Clipboard API is refused", /Catastro: 041-087-017-17/.test(legacy) && /Copied/.test(await text(page, '[data-testid="report-copy"]')), legacy.slice(0, 60));
  // Every copy route blocked → the summary is shown selected for manual copy.
  await page.evaluate("document.execCommand = () => false");
  await page.click('[data-testid="report-copy"]');
  await page.locator('[data-testid="report-copy-fallback"]').waitFor({ timeout: 5000 }).catch(() => undefined);
  check("mobile copy: blocked everywhere → selectable text, never silent", /041-087-017-17/.test(await page.locator('[data-testid="report-copy-fallback"] textarea').inputValue().catch(() => "")));
  await page.screenshot({ path: path.join(OUT, "8-mobile-report.png") });
  await page.context().close();
}

// 9 — signed in: save versioned report to the Passport, professional review
{
  reviewStore = emptyReview();
  savedVersions = 0;
  const page = await open(1440, 900, { signedIn: true, businessId: "biz-pro-1", state: state("Agro-tourism lodge.", siteOf(GURABO, { location_id: "9b1f4c2e-1111-4a1a-9a9a-222233334444" })) });
  await page.locator('[data-testid="open-property-report"]').waitFor({ timeout: 20000 });
  await waitPreviewCatastro(page, "173-000-001-39");
  await page.click('[data-testid="open-property-report"]');
  await expandAll(page);
  await page.click('[data-testid="report-save-passport"]');
  await page.locator('[data-testid="report-save-passport"] >> text=v1').waitFor({ timeout: 10000 }).catch(() => undefined);
  check("Passport: report saved as version 1", /v1/.test(await text(page, '[data-testid="report-save-passport"]')));
  await page.locator('[data-testid="review-panel"]').waitFor({ timeout: 10000 });
  check("review: disclaimer says not a government approval", /not a government approval/.test(await text(page, '[data-testid="review-disclaimer"]')));
  const zoningRow = page.locator('[data-finding="zoning"]').first();
  await zoningRow.locator('[data-testid="finding-flag-question"]').click();
  await zoningRow.locator('[data-testid="finding-review-text"]').fill("Which district covers the proposed lodge footprint?");
  await zoningRow.locator('[data-testid="finding-review-save"]').click();
  await page.waitForTimeout(300);
  await page.click('[data-testid="review-status-reviewed"]');
  await page.waitForTimeout(300);
  check("review: Reviewed blocked while questions are open", /Resolve the open questions/.test(await text(page, '[data-testid="review-error"]')));
  await page.locator('[data-finding="flood_zone"] [data-testid="finding-add-note"]').first().click();
  await page.locator('[data-finding="flood_zone"] [data-testid="finding-review-text"]').fill("Effective FIRM Zone X across the whole lot.");
  await page.locator('[data-finding="flood_zone"] [data-testid="finding-review-save"]').click();
  await page.click('[data-testid="review-resolve"]');
  await page.fill('[data-testid="review-resolution"]', "Lodge footprint is within R-G per JP map review.");
  await page.click('[data-testid="review-resolve-save"]');
  await page.waitForTimeout(300);
  await page.click('[data-testid="review-status-reviewed"]');
  await page.waitForTimeout(300);
  check("review: status Reviewed with a 'not a government approval' pill", /Reviewed/.test(await text(page, '[data-testid="review-status-pill"]')) && /not a government approval/.test(await text(page, '[data-testid="review-status-pill"]')));
  await page.click(".spr-prv-history summary");
  check("review: history recorded", (await page.locator('[data-testid="review-history"] li').count()) >= 5);
  await page.click('[data-testid="report-copy"]');
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check("client export includes selected notes and review status", /Effective FIRM Zone X/.test(clip) && /Reviewed/.test(clip) && /not a government approval/.test(clip));
  await page.screenshot({ path: path.join(OUT, "9-review.png"), fullPage: false });
  await page.context().close();
}

// 10 — land-use intelligence on the Santurce regression parcel
{
  const SJ = C.santurce!;
  const page = await open(1440, 900, { state: state("Build a 120-room hotel", siteOf(SJ)) });
  await page.locator('[data-testid="open-property-report"]').waitFor({ timeout: 20000 });
  await page.locator('[data-testid="project-location-catastro"] >> text=040-028-001-24').waitFor({ timeout: 20000 });
  await page.click('[data-testid="open-property-report"]');
  await expandAll(page);
  const groups = await page.locator('[data-testid="key-findings"] [data-status]').evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  check("santurce: key findings grouped (review before clear; no 'unable' group when every source answered)", groups.join(",") === "review,clear", groups.join(","));
  check("santurce: description pre-fills the proposed activity (not asked twice)", /120-room hotel/.test(await page.locator('[data-testid="activity-input"]').inputValue()));
  const compat = page.locator('[data-testid="land-use-compatibility"]');
  check("santurce hotel: professional review (APE-ZC overlay), base zoning conditional", (await compat.getAttribute("data-outcome")) === "professional_review" && /Conditional/.test(await compat.innerText()));
  check("santurce hotel: floodplain review likely, triggered by VE share", /Zone VE \(19\.\d% of the parcel\)/.test(await page.locator('[data-rule="SR_FLOOD_SFHA_CONSTRUCTION"]').innerText().catch(() => "")));
  check("santurce: zoning shows area shares; the small P intersection is kept and named", /CT 99\.\d% · P 0\.3% \(small\)/.test(await page.locator('[data-finding="zoning"]').first().innerText()) && /Zone X 80\.\d% · VE 19\.\d%/.test(await page.locator('[data-finding="flood_zone"]').first().innerText()));
  check("santurce: PUT / Plan Territorial / soils verified", /Verified|SU — Suelo Urbano/.test(await page.locator('[data-finding="put"]').innerText()) && /13-Mar-2003/.test(await page.locator('[data-finding="municipal_plan"]').innerText()) && /Urban land/.test(await page.locator('[data-finding="soils"]').innerText()));
  check("santurce: 'Why?' reasoning path down to source and evidence", /44 CFR/.test(await page.locator('[data-rule="SR_FLOOD_SFHA_CONSTRUCTION"] [data-testid="reasoning-path"]').innerText()));
  await page.screenshot({ path: path.join(OUT, "10-santurce-hotel.png"), fullPage: false });
  await page.fill('[data-testid="activity-input"]', "Open a restaurant in the existing building");
  await page.click('[data-testid="activity-analyze"]');
  await page.waitForTimeout(300);
  check("santurce restaurant: base permitted, no construction floodplain review", /Permitted/.test(await compat.innerText()) && (await page.locator('[data-rule="SR_FLOOD_SFHA_CONSTRUCTION"]').count()) === 0 && (await page.locator('[data-rule="SR_FOOD_HEALTH"]').count()) === 1);
  await page.fill('[data-testid="activity-input"]', "Construct a warehouse");
  await page.click('[data-testid="activity-analyze"]');
  await page.waitForTimeout(300);
  check("santurce warehouse: potentially prohibited + consulta de ubicación", (await compat.getAttribute("data-outcome")) === "potentially_prohibited" && (await page.locator('[data-rule="SR_USE_NOT_LISTED"]').count()) === 1);
  check("evaluate gives visible feedback", /Evaluated: Warehouse/i.test(await page.locator('[data-testid="activity-status"]').innerText()));
  await page.fill('[data-testid="activity-input"]', "something for my cousin");
  await page.click('[data-testid="activity-analyze"]');
  await page.waitForTimeout(300);
  check("unrecognized activity says so and offers choices", /couldn't match/.test(await page.locator('[data-testid="activity-status"]').innerText()) && await page.locator('[data-testid="activity-question-use"]').isVisible());
  await page.fill('[data-testid="activity-input"]', "A daycare");
  await page.click('[data-testid="activity-analyze"]');
  await page.waitForTimeout(300);
  check("follow-up only when a fact matters (construction?)", await page.locator('[data-testid="activity-question-construction"]').isVisible());
  await page.locator('[data-testid="activity-question-construction"] button', { hasText: "Existing building" }).click();
  await page.waitForTimeout(300);
  check("answering the follow-up removes the question", (await page.locator('[data-testid="activity-question-construction"]').count()) === 0);
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="report-pdf"]')]);
  await pdf.saveAs(path.join(OUT, "santurce.pdf"));
  check("santurce: PDF downloads with land-use sections", /\.pdf$/.test(pdf.suggestedFilename()));
  await page.context().close();
}
// 12 — hardening: Aguas Buenas (real recorded parcel), no activity described
{
  const AB = C.aguas_buenas!;
  const page = await open(1440, 900, { state: state("", siteOf(AB)) });
  await page.locator('[data-testid="open-property-report"]').waitFor({ timeout: 20000 });
  await page.locator('[data-testid="project-location-catastro"] >> text=224-000-006-78').waitFor({ timeout: 20000 });
  await page.click('[data-testid="open-property-report"]');
  const rep = page.locator('[data-testid="property-report"]');
  await rep.waitFor();
  const order = await page.evaluate(`(() => { const r = document.querySelector('[data-testid="property-report"]'); const ids = ["site-summary", "key-findings", "next-steps", "still-needed", "detailed-findings", "report-footer"].map((id) => r.querySelector('[data-testid="' + id + '"]')); return ids.every(Boolean) && ids.every((el, i) => i === 0 || (ids[i - 1].compareDocumentPosition(el) & 4)); })()`);
  check("AB: four sections in order — site summary, key findings, next steps (+ still needed), detailed findings, footer", order === true);
  check("AB: detailed site findings collapsed by default", (await page.locator('[data-testid="detailed-findings"]').getAttribute("open")) === null && !(await page.locator('[data-testid="detailed-findings"] [data-finding="zoning"]').isVisible()));
  const concl = await text(page, '[data-testid="reviewer-conclusion"]');
  check("AB: reviewer conclusion first, hedged, from the findings", /^Based on available official map sources, site review found/.test(concl) && /land-use compatibility cannot be determined until the proposed activity is provided/.test(concl) && /could not be verified/.test(concl) && !/\b(approved|prohibited|compliant|rejected)\b/i.test(concl), concl);
  const kf = async (s: string) => page.locator(`[data-testid="key-findings"] [data-status="${s}"] li`).evaluateAll((els) => els.map((e) => e.getAttribute("data-item")));
  const [rv, cl, un] = [await kf("review"), await kf("clear"), await kf("unable")];
  check("AB: review / clear / unable groups", rv.includes("compatibility") && rv.includes("terrain") && cl.includes("coastal_zone") && cl.includes("floodway") && un.includes("historic_zone") && un.includes("put") && !cl.some((x) => un.includes(x)), `${rv} | ${cl} | ${un}`);
  const colors = await page.evaluate(`(() => ["review", "clear", "unable"].map((s) => getComputedStyle(document.querySelector('[data-testid="key-findings"] [data-status="' + s + '"]')).backgroundColor))()`) as string[];
  check("AB: 'clear' and 'unable to verify' are styled differently", new Set(colors).size === 3, colors.join(" "));
  const steps = await page.locator('[data-testid="next-steps"] li[data-action]').evaluateAll((els) => els.map((e) => e.getAttribute("data-action")));
  check("AB: ranked next steps; citations behind Why?", steps[0] === "compatibility" && steps.includes("unverified") && (await page.locator('[data-testid="next-steps"] li[data-action] > p').first().innerText()).length < 200, steps.join(","));
  const need = await page.locator('[data-testid="still-needed"] [data-needed]').evaluateAll((els) => els.map((e) => e.getAttribute("data-needed")));
  check("AB: still needed lists only user input (proposed activity)", need.join(",") === "activity" && !/did not respond/.test(await text(page, '[data-testid="still-needed"] ul')), need.join(","));
  check("AB: footer disclaimer simplified", /Reference information from official map sources\. This is not a survey, permit decision, or approval\./.test(await text(page, '[data-testid="report-footer"]')));
  await page.screenshot({ path: path.join(OUT, "12a-reviewer-top.png"), fullPage: false });
  await expandAll(page);
  const z = await text(page, '[data-testid="property-report"] [data-finding="zoning"]');
  check("AB: whole-parcel zoning R-G 86.1% · R-I 13.9%, pin kept separately", /R-G 86\.1% · R-I 13\.9%/.test(z) && /At the pin:\s*R-G — Rural General/.test(z) && /C-I, VIAL: touches the parcel's edge only/.test(z));
  const pu = page.locator('[data-testid="property-report"] [data-finding="permitted_uses"]');
  check("AB: 'Permitted-use analysis: Pending proposed activity', never 'Not applicable'", (await pu.getAttribute("data-state")) === "not_evaluated" && /Permitted-use analysis/.test(await pu.innerText()) && /Pending proposed activity/.test(await pu.innerText()) && !/Not applicable/.test(await pu.innerText()));
  const pt = await text(page, '[data-testid="property-report"] [data-finding="municipal_plan"]');
  check("AB: Plan Territorial due date is not shown as 'revised'", /Approved 15-Sep-2011 · first revision was due 15-Sep-2019; no approval recorded/.test(pt) && !/revised/i.test(pt));
  const soils = await text(page, '[data-testid="property-report"] [data-finding="soils"]');
  check("AB: parcel-wide soils with shares; pin answer separate", /HtF 75\.3% · MxF 23\.9% · HtE 0\.8% \(small\)/.test(soils) && /At the pin:\s*Humatas clay, 40 to 60 percent slopes \(HtF\)/.test(soils) && /survey area PR686/.test(soils) && /Well drained · flooding: None/.test(soils));
  const hz = page.locator('[data-testid="property-report"] [data-finding="historic_zone"]');
  check("AB: refused source → 'Unable to verify' + reason, basis 'Source unavailable'", (await hz.getAttribute("data-basis")) === "source_unavailable" && /refused the request \(HTTP 403\)/.test(await hz.innerText()) && !/Official map finding/.test(await hz.innerText()));
  check("AB: approximate area is a number with units", /^15,152 m² \(3\.86 cuerdas\)/.test((await text(page, '[data-testid="report-area"]')).trim()));
  await page.click(".spr-prd-tech-toggle");
  const nad = await text(page, '[data-testid="report-nad83"]');
  check("AB: NAD83 X/Y expandable with exact CRS and units", /X [\d,.]+ m · Y [\d,.]+ m/.test(nad) && /Units: metres · Lambert Conformal Conic/.test(nad) && /NAD83 \/ Puerto Rico & Virgin Is\. \(EPSG:32161\)/.test(await text(page, '[data-testid="report-technical"]')));
  const zeros = await page.evaluate(`(() => { const out = []; const w = document.createTreeWalker(document.querySelector('[data-testid="property-report"]'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.textContent.trim() === "0") out.push(n.parentElement.outerHTML.slice(0, 120)); } return out; })()`) as string[];
  check("AB: no stray '0' anywhere in the report", zeros.length === 0, zeros.join(" | "));
  check("AB: no complexity score without an activity", (await page.locator('[data-flag="complexity"]').count()) === 0 && !/How complexity is scored/.test(await rep.innerText()));
  const prescribing = /elevation certificate|plan a geotechnical|budget for a geotechnical|expect coastal/i.test(await rep.innerText());
  check("AB: nothing prescribed without an activity and a verified rule", !prescribing);
  await page.click('[data-testid="report-copy"]');
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  const idx = ["Based on available official map sources", "KEY REGULATORY FINDINGS", "RECOMMENDED NEXT STEPS", "STILL NEEDED FROM YOU", "DETAILED SOURCE FINDINGS"].map((h) => clip.indexOf(h));
  check("AB: copied summary follows the reviewer order", idx.every((i, k) => i > 0 && (k === 0 || i > idx[k - 1]!)) && /Approximate area: 15,152 m²/.test(clip) && /EPSG:32161\): X/.test(clip), JSON.stringify(idx));
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="report-pdf"]')]);
  const pdfText = readFileSync((await pdf.path())!, "latin1");
  check("AB: PDF follows the reviewer order with coverage and technical CRS", /Based on available official map sources/.test(pdfText) && /Key regulatory findings/.test(pdfText) && /Recommended next steps/.test(pdfText) && /Detailed site findings/.test(pdfText) && /R-G 86\.1% · R-I 13\.9%/.test(pdfText) && /EPSG:32161/.test(pdfText));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="report-json"]')]);
  const json = JSON.parse(readFileSync((await dl.path())!, "utf8"));
  const zj = json.findings.find((f: { id: string }) => f.id === "zoning");
  check("AB: JSON keeps precise shares, coverage method and versions", zj.coverage.parts[0].share > 0.8614 && zj.coverage.parts[0].share < 0.8616 && String(zj.coverage.parts[0].share).length > 6 && /EPSG:32161/.test(json.versions.coverage_method) && json.schema === "smartpr.property-report/v3");
  await page.screenshot({ path: path.join(OUT, "12-aguas-buenas-report.png"), fullPage: false });
  await page.locator('[data-testid="key-findings"]').screenshot({ path: path.join(OUT, "12b-key-findings.png") });
  await page.locator('[data-testid="next-steps"]').screenshot({ path: path.join(OUT, "12f-next-steps.png") });
  await page.locator('[data-testid="property-report"] [data-finding="zoning"]').screenshot({ path: path.join(OUT, "12c-zoning.png") });
  await page.locator('[data-testid="property-report"] [data-finding="soils"]').screenshot({ path: path.join(OUT, "12d-soils.png") });
  await page.click('[data-testid="property-report-close"]');
  const pills = await text(page, '[data-testid="site-report-preview"]');
  check("AB: compact intake preview kept (pills + open report)", /Rural/.test(pills) && (await page.locator('[data-testid="open-property-report"]').count()) === 1);
  await page.context().close();
  // phone width: no horizontal scroll in the drawer
  const m = await open(390, 844, { state: state("", siteOf(AB)) });
  await m.locator('[data-testid="open-property-report"]').waitFor({ timeout: 20000 });
  await m.locator('[data-testid="project-location-catastro"] >> text=224-000-006-78').waitFor({ timeout: 20000 });
  await m.click('[data-testid="open-property-report"]');
  await expandAll(m);
  const over = await m.locator('[data-testid="property-report"]').evaluate((e) => e.scrollWidth - e.clientWidth);
  check("AB mobile: coverage tables and summary fit (no horizontal scroll)", over <= 1, String(over));
  await m.screenshot({ path: path.join(OUT, "12e-mobile.png"), fullPage: false });
  await m.context().close();
}
// 13 — location validation: Guayama / Machete (no parcel, VIAL at the pin)
{
  const GM = C.guayama_machete!;
  const NO_PARCEL = "No cadastral parcel was identified. Findings describe the selected point only; parcel-wide checks have not been performed.";
  const ROADWAY = "This point may be on a roadway rather than your intended property. Move or confirm the pin before evaluating site-specific requirements.";
  const page = await open(1440, 900, { state: state("Open a small retail store", siteOf(GM)) });
  const pn = page.locator('[data-testid="preview-location-notice"]');
  await pn.waitFor({ timeout: 20000 });
  const pt = await pn.innerText();
  check("GM preview: no-parcel + roadway notice with Adjust pin / Confirm this point", pt.includes(NO_PARCEL) && pt.includes(ROADWAY) && (await page.locator('[data-testid="preview-adjust-pin"]').isVisible()) && (await page.locator('[data-testid="preview-confirm-point"]').isVisible()));
  check("GM preview: FEMA zone named, never 'Low flood risk'", !/Low flood risk/.test(await text(page, '[data-testid="site-report-preview"]')) && /FEMA Zone X/.test(await text(page, '[data-testid="site-report-preview"]')));
  await page.click('[data-testid="open-property-report"]');
  const rep = page.locator('[data-testid="property-report"]');
  await rep.waitFor();
  const ln = await text(page, '[data-testid="location-notice"]');
  check("GM report: notice prominent in the site summary, with both actions", ln.includes(NO_PARCEL) && ln.includes(ROADWAY) && (await page.locator('[data-testid="adjust-pin"]').isVisible()) && (await page.locator('[data-testid="confirm-point"]').isVisible()));
  check("GM report: labelled preliminary, selected point only", /Preliminary — selected point only/i.test(await text(page, '[data-testid="report-preliminary"]')));
  check("GM report: catastro + area say what is missing (no disclaimer text, no number)", (await text(page, '[data-testid="report-catastro"]')).trim() === "No cadastral parcel identified at the selected point" && /^Not available/.test((await text(page, '[data-testid="report-area"]')).trim()));
  check("GM report: exact-property confirmation ranks first, before use", (await page.locator('[data-testid="next-steps"] li[data-action]').first().getAttribute("data-action")) === "location");
  check("GM report: 'No mapped intersection identified' group, qualified by scope + dataset", /No mapped intersection identified/i.test(await text(page, '[data-testid="key-findings"] [data-status="clear"] h4')) && /At selected point only/.test(await text(page, '[data-testid="key-findings"] [data-status="clear"] li[data-item="coastal_zone"]')));
  check("GM report: FEMA Zone X with FEMA's own description", /FEMA Zone X — Area of Minimal Flood Hazard/.test(await text(page, '[data-testid="key-findings"] li[data-item="flood_zone"]')));
  await expandAll(page);
  const all = await rep.innerText();
  check("GM report: nothing claims parcel-wide checks or polygon clipping", !/Checked across (verified )?parcel/i.test(all) && !/clipped to the CRIM parcel/.test(all) && /Parcel calculations not performed/.test(all), "");
  check("GM report: zoning VIAL shown as a roadway at the selected point, not a district with uses", /Roadway|roadway/.test(await text(page, '[data-testid="property-report"] [data-finding="zoning"]')) && /At selected point only/.test(await text(page, '[data-testid="property-report"] [data-finding="zoning"] [data-testid="finding-scope"]')));
  const pu = page.locator('[data-testid="property-report"] [data-finding="permitted_uses"]');
  check("GM report: permitted uses not evaluated (scope 'Not evaluated'), even with an activity described", (await pu.getAttribute("data-state")) === "not_evaluated" && /Scope: Not evaluated/.test(await pu.innerText()) && /not a developable zoning district/.test(await pu.innerText()));
  check("GM report: every finding shows scope + retrieval + source link", (await page.locator('[data-testid="property-report"] [data-finding] [data-testid="finding-evidence"]').count()) === (await page.locator('[data-testid="property-report"] [data-finding]').count()) && (await page.locator('[data-testid="property-report"] [data-finding="flood_zone"] a[href^="https://hazards.fema.gov"]').count()) > 0);
  check("GM report: regulation publication date kept apart from applicability (not verified)", /publication date 2023-06-16 · applicability to this site: not verified/.test(await text(page, '[data-testid="report-regulation"]')));
  await page.screenshot({ path: path.join(OUT, "13-guayama-machete.png"), fullPage: false });
  await page.click('[data-testid="confirm-point"]');
  await page.waitForTimeout(300);
  const ln2 = await text(page, '[data-testid="location-notice"]');
  check("GM confirm: recorded, still no parcel, still preliminary", /You confirmed this point as your property/.test(ln2) && ln2.includes(NO_PARCEL) && (await page.locator('[data-testid="confirm-point"]').count()) === 0 && (await page.locator('[data-testid="report-preliminary"]').count()) === 1 && (await page.locator('[data-testid="location-notice"]').getAttribute("data-parcel")) === "not_identified");
  await page.click('[data-testid="report-copy"]');
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check("GM copy: preliminary label, notices, catastro text, no parcel-wide claims", clip.includes("PRELIMINARY — SELECTED POINT ONLY") && clip.includes(NO_PARCEL) && clip.includes(ROADWAY) && clip.includes("Catastro: No cadastral parcel identified at the selected point") && !/Checked across (verified )?parcel/i.test(clip));
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="report-pdf"]')]);
  const pdfText = readFileSync((await pdf.path())!, "latin1");
  check("GM PDF: preliminary label + roadway notice, no parcel-wide claims", /PRELIMINARY/.test(pdfText) && /may be on a roadway/.test(pdfText) && !/Checked across verified parcel/.test(pdfText) && /Parcel calculations not performed/.test(pdfText));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="report-json"]')]);
  const json = JSON.parse(readFileSync((await dl.path())!, "utf8"));
  check("GM JSON: v3, location status, every scope evidence-based", json.schema === "smartpr.property-report/v3" && json.property.location.parcel === "not_identified" && json.property.location.roadway === true && json.property.location.point_confirmed === true && json.findings.every((f: { scope: string }) => f.scope !== "parcel"));
  await page.click('[data-testid="adjust-pin"]');
  await page.locator('[data-testid="location-edit-cancel"]').waitFor({ timeout: 10000 });
  check("GM adjust pin: report closes and the location editor opens (pin not moved automatically)", (await page.locator('[data-testid="property-report"]').count()) === 0 && (await page.locator('[data-testid="location-edit-cancel"]').isVisible()));
  await page.context().close();
}
// 11 — admin QA: parcel scenarios
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/admin/knowledge-base`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("button", { name: "Scenario Reasoning & Land Use" }).click({ timeout: 90000 });
  await page.click('[data-testid="reasoning-view-parcels"]');
  await page.locator('[data-testid="scenario-matrix"]').waitFor({ timeout: 20000 });
  const outcomes = await page.locator('[data-testid="scenario-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-outcome")));
  check("admin: six activities on Santurce give different determinations", outcomes.length === 6 && new Set(outcomes).size >= 2, outcomes.join(","));
  await page.selectOption('[data-testid="scenario-parcel"]', "straightforward");
  await page.waitForTimeout(300);
  check("admin: R-I parcel now has district coverage (no missing-district gap)", !/No graph district/.test(await page.locator('[data-testid="scenario-gaps"]').innerText().catch(() => "")) && (await page.locator('[data-testid="scenario-row"]').count()) === 6);
  await page.screenshot({ path: path.join(OUT, "11-admin-scenarios.png"), fullPage: false });
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n${failures.length ? `${failures.length} FAILED` : "ALL PASSED"} — screenshots in ${OUT}`);
process.exit(failures.length ? 1 : 0);
