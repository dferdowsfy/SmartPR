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
  check("compact preview: colour-coded plain-language pills only (no source list, no long text)", (await page.locator(`${preview} .spr-srp-pill`).count()) >= 3 && (await page.locator(`${preview} .spr-srp-sources`).count()) === 0 && /Low flood risk/.test(await text(page, preview)));
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
  await page.locator('[data-testid="property-report"]').waitFor({ timeout: 10000 });
  check("drawer: dialog with aria-modal and focus on Close", (await page.locator('[role="dialog"][aria-modal="true"]').count()) === 1 && (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "property-report-close");
  const r = await text(page, '[data-testid="property-report"]');
  check("drawer: property + considerations + next steps sections", /Property/.test(r) && /Project considerations/.test(r) && /Next steps/.test(r));
  check("drawer: PUT, municipal plan and permitted uses honestly 'not performed'", (await page.locator('[data-finding="put"][data-state="not_performed"], [data-finding="municipal_plan"][data-state="not_performed"], [data-finding="permitted_uses"][data-state="not_performed"]').count()) === 3);
  check("drawer: protection constraints separated from documentation items", (await visible(page, '[data-testid="steps-protection"]')) && /do not remove/.test(await text(page, '[data-testid="steps-protection"]')));
  check("drawer: AI explanations kept separate (none generated)", /None in this report/.test(await text(page, '[data-testid="ai-explanations"]')));
  check("drawer: signed-out → draft note, no Passport claim", /Sign in to save/.test(await text(page, '[data-testid="report-draft-note"]')) && !(await visible(page, '[data-testid="report-save-passport"]')));
  check("drawer: professional review needs a saved report", await visible(page, '[data-testid="review-unavailable"]'));
  await page.click('button[aria-expanded="false"].spr-prd-tech-toggle');
  check("drawer: NAD83 X/Y expandable", /EPSG:32161/.test(await text(page, '[data-testid="report-technical"]')));
  // exports
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="report-json"]')]);
  const json = JSON.parse(readFileSync((await dl.path())!, "utf8"));
  check("export JSON: same model, confirmed parcel, every finding at the confirmed point", json.schema === "smartpr.property-report/v1" && json.property.catastro.value === "173-000-001-39" && json.findings.every((f: { point: { latitude: number } | null }) => !f.point || Math.abs(f.point.latitude - GURABO.latitude) < 1e-7));
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="report-pdf"]')]);
  check("export PDF downloads", /\.pdf$/.test(pdf.suggestedFilename()), pdf.suggestedFilename());
  await pdf.saveAs(path.join(OUT, "report.pdf"));
  await page.click('[data-testid="report-copy"]');
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check("copy summary", clip.includes("173-000-001-39") && clip.includes("[PROTECTION]"));
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
  check("multiple locations → asks which is the project site", (await page.locator('[data-testid="ambiguous-option"]').count()) === 2);
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
  const [w, vw] = await page.locator('[data-testid="property-report"]').evaluate((e) => [e.getBoundingClientRect().width, document.documentElement.getBoundingClientRect().width]);
  check("mobile: report fills the visible viewport", Math.abs(w - vw) <= 1, `${w} of ${vw}`);
  check("mobile: multi-district + conflicting flood data listed", /CT-3/.test(await text(page, '[data-finding="zoning"]')) && /Flood sources differ/.test(await text(page, '[data-testid="property-report"]')));
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

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n${failures.length ? `${failures.length} FAILED` : "ALL PASSED"} — screenshots in ${OUT}`);
process.exit(failures.length ? 1 : 0);
