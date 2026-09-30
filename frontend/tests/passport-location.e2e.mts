/**
 * Passport → Property / Location — browser test of the location flow.
 *
 * Drives the real business page, Passport panel, location section, picker
 * dialog and MapLibre map. Only the network edge is stubbed:
 *   - /api/businesses/:id           minimal business detail
 *   - /api/businesses/:id/locations stateful store whose POST/PATCH bodies
 *                                   are validated by the REAL server parser
 *                                   (parseLocationInput) — a body the API
 *                                   would reject fails this test too
 *   - /api/geocode                  switchable: unavailable / no address / results
 *   - basemap style                 served inline (offline, deterministic)
 *
 * Covers: empty state → add → tap map → drag pin → invalid + valid manual
 * coordinates → address search → explicit confirm → saved render → reload →
 * edit → save failure stays open → mobile layout.
 *
 * Usage (dev server running without Supabase env, so /businesses is open):
 *   BASE_URL=http://localhost:3000 npx tsx tests/passport-location.e2e.mts [outDir]
 *   (E2E_CHROME=/path/to/chromium to use a system browser)
 * Exits non-zero on any failed check.
 */
import { chromium, type Page, type Route } from "playwright";
import os from "node:os";
import path from "node:path";
import { ensureSignedIn } from "./e2e-auth.mjs";
import { parseLocationInput, type PassportLocationWithGeographies } from "../src/app/locations/geo";

const OUT = process.argv[2] || os.tmpdir();
const base = process.env.BASE_URL || "http://localhost:3000";
const BIZ = "e2eloc01";
const BIZ_UUID = "5a0c2d5e-8f7a-4c3b-9e1d-2b6f4a8c0e11";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

// ---------------------------------------------------------------- stubs --
const store: PassportLocationWithGeographies[] = [];
let geocodeMode: "unavailable" | "none" | "results" = "unavailable";
let failNextSave = false;
const bodies: Record<string, unknown>[] = [];

const STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#dfe9ec" } }],
};

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installStubs(page: Page) {
  await page.route(/tiles\.openfreemap\.org|\/styles\//, (route) => json(route, 200, STYLE));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (p === `/api/businesses/${BIZ}`) {
      return json(route, 200, {
        business: { id: BIZ_UUID, public_id: BIZ, name: "Caribe Precision Manufacturing, LLC", legal_name: "Caribe Precision Manufacturing, LLC", municipality: "Guaynabo", passport_json: {} },
        passport: { filled: [], empty: [], canonical: {} },
        overall_readiness: null, matters: [], obligations: [], evidence: [], submissions: [], deliverables: [], notifications: [],
      });
    }
    if (p === `/api/businesses/${BIZ}/locations` && req.method() === "GET") {
      return json(route, 200, { locations: store });
    }
    const save = p.startsWith(`/api/businesses/${BIZ}/locations`) && ["POST", "PATCH"].includes(req.method());
    if (save) {
      const body = req.postDataJSON() as Record<string, unknown>;
      bodies.push(body);
      if (failNextSave) {
        failNextSave = false;
        return json(route, 500, { error: "save_failed" });
      }
      const parsed = parseLocationInput(body);
      if (!parsed.ok) return json(route, 400, { error: "invalid_location", details: parsed.errors });
      const now = new Date().toISOString();
      const id = req.method() === "PATCH" ? p.split("/").pop()! : `0000000${store.length + 1}-0000-4000-8000-000000000000`;
      const existing = store.find((l) => l.id === id);
      const { is_primary, ...fields } = parsed.value;
      const location: PassportLocationWithGeographies = {
        id,
        business_id: BIZ_UUID,
        coordinate_system: "EPSG:4326",
        ...fields,
        is_primary: is_primary ?? existing?.is_primary ?? store.length === 0,
        confirmed_at: now,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        geographies: [],
      };
      if (existing) store.splice(store.indexOf(existing), 1, location);
      else store.push(location);
      return json(route, req.method() === "POST" ? 201 : 200, { location, warnings: [] });
    }
    if (p === "/api/geocode") {
      if (geocodeMode === "unavailable") return json(route, 503, { error: "geocoding_not_configured" });
      if (url.searchParams.get("q")) {
        return json(route, 200, {
          results: [{
            latitude: 18.3912301, longitude: -66.1178405,
            formatted_address: "123 Calle Ejemplo, Guaynabo, Puerto Rico, 00968",
            address_line_1: "123 Calle Ejemplo", city: "Guaynabo", municipality: "Guaynabo",
            state_or_region: "PR", postal_code: "00968", country_code: "PR",
            place_source: "nominatim", place_source_id: "way/1",
          }],
        });
      }
      return json(route, 200, { result: null });
    }
    // Everything else on the page degrades gracefully when unavailable.
    return json(route, 404, { error: "not_found" });
  });
}

const selectedCoords = (page: Page) => page.getByTestId("location-selected-coordinates").innerText().catch(() => "");

// ----------------------------------------------------------------- run --
const browser = await chromium.launch({
  // Optional: a system Chromium when the bundled Playwright build is absent.
  ...(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {}),
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

try {
  // ---------------------------------------------------------- desktop --
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await installStubs(page);
  await ensureSignedIn(page, base, `/businesses/${BIZ}`);
  await page.goto(`${base}/businesses/${BIZ}`, { waitUntil: "domcontentloaded" });

  const section = page.getByTestId("passport-location-section");
  await section.waitFor({ timeout: 60000 });
  await section.scrollIntoViewIfNeeded();
  check("Passport shows the Property / Location section", await section.getByText("Property / Location").isVisible());
  check("empty state offers Add location", await page.getByTestId("location-add").isVisible());
  await page.screenshot({ path: path.join(OUT, "loc-1-empty.png"), fullPage: false });

  await page.getByTestId("location-add").click();
  const dialog = page.getByTestId("location-picker-dialog");
  await dialog.waitFor();
  check("confirm is disabled before a point is chosen", await page.getByTestId("location-confirm").isDisabled());

  const map = page.getByTestId("location-map-picker");
  await page.locator(".maplibregl-canvas").waitFor({ timeout: 30000 });
  await page.getByText("Loading map…").waitFor({ state: "hidden", timeout: 30000 });
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId("location-selected-coordinates").waitFor();
  const afterTap = await selectedCoords(page);
  check("tapping the map drops a pin and shows lat/lng", /Latitude: 18\.\d{6}/.test(afterTap) && /Longitude: -6[56]\.\d{6}/.test(afterTap), afterTap.replace(/\n/g, " "));
  await page.getByText("couldn't be looked up").waitFor({ timeout: 10000 });
  check("reverse-geocoding unavailable is explained, save still allowed", await page.getByTestId("location-confirm").isEnabled());

  const marker = page.locator(".maplibregl-marker");
  const mb = (await marker.boundingBox())!;
  await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
  await page.mouse.down();
  await page.mouse.move(mb.x + mb.width / 2 + 80, mb.y + mb.height / 2 + 50, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterDrag = await selectedCoords(page);
  check("dragging the pin updates the coordinates", afterDrag !== afterTap && /Latitude: 18\.\d{6}/.test(afterDrag), afterDrag.replace(/\n/g, " "));

  await page.getByTestId("location-latitude").fill("95");
  await page.getByTestId("location-longitude").fill("-66.1");
  await page.getByRole("button", { name: "Place pin" }).click();
  check("invalid latitude is rejected with a readable message", await page.getByRole("alert").filter({ hasText: "Latitude must be between -90 and 90." }).isVisible());
  check("invalid entry does not move the pin", (await selectedCoords(page)) === afterDrag);
  check("unconfigured address search is disabled and explained",
    (await page.getByLabel("Search address or place").isDisabled()) &&
      (await page.getByText("Address search isn't available right now.").isVisible()));

  // Cancel: exploring the map never saves anything.
  await page.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "hidden" });
  check("cancel closes without saving", bodies.length === 0);

  // Second session: a configured geocoder.
  geocodeMode = "none";
  await page.getByTestId("location-add").click();
  await dialog.waitFor();
  await page.getByText("Loading map…").waitFor({ state: "hidden", timeout: 30000 });
  await page.getByTestId("location-latitude").fill("18.39123");
  await page.getByTestId("location-longitude").fill("-66.11784");
  await page.getByRole("button", { name: "Place pin" }).click();
  await page.waitForTimeout(200);
  const manual = await selectedCoords(page);
  check("manual coordinates reposition the pin", manual.includes("Latitude: 18.391230") && manual.includes("Longitude: -66.117840"), manual.replace(/\n/g, " "));
  await page.getByText("No street address was found for this point").waitFor({ timeout: 10000 });
  check("no-address result keeps the save available", await page.getByTestId("location-confirm").isEnabled());
  const markerPx = (await marker.boundingBox())!;
  const mapPx = (await map.boundingBox())!;
  check("the pin is visible on the map after manual entry",
    markerPx.x >= mapPx.x && markerPx.x <= mapPx.x + mapPx.width && markerPx.y >= mapPx.y - markerPx.height && markerPx.y <= mapPx.y + mapPx.height);

  geocodeMode = "results";
  await page.getByLabel("Search address or place").fill("Calle Ejemplo Guaynabo");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: /123 Calle Ejemplo, Guaynabo/ }).click();
  check("choosing a search result fills the address", (await page.getByLabel(/Address or site description/).inputValue()).startsWith("123 Calle Ejemplo"));
  await page.getByLabel(/Location name/).fill("Guaynabo Manufacturing Facility");
  await page.screenshot({ path: path.join(OUT, "loc-2-picker.png") });

  check("nothing is saved while exploring the map", bodies.length === 0);
  await page.getByTestId("location-confirm").click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
  const posted = bodies.at(-1) ?? {};
  check("confirm posts the chosen point with provenance",
    posted.latitude === 18.3912301 && posted.coordinate_source === "GEOCODED_ADDRESS" && posted.address_source === "PROVIDER_GEOCODE",
    JSON.stringify({ lat: posted.latitude, cs: posted.coordinate_source, as: posted.address_source }));
  await page.getByTestId("location-coordinates").waitFor();
  check("saved coordinates render on the Passport", (await page.getByTestId("location-coordinates").innerText()).includes("18.391230, -66.117840"));
  check("saved name renders", (await page.getByTestId("location-name").innerText()).includes("Guaynabo Manufacturing Facility"));
  check("unknown geography reads 'Not yet determined' (nothing invented)", (await section.getByText("Not yet determined").count()) === 3);
  check("address-derived municipality is labeled as not boundary-verified", await section.getByText("From address lookup — not boundary-verified").isVisible());
  check("map preview renders with the saved pin", await section.getByTestId("location-map-preview").isVisible() && (await section.locator(".maplibregl-marker").count()) === 1);
  await section.screenshot({ path: path.join(OUT, "loc-3-saved.png") });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("location-coordinates").waitFor({ timeout: 60000 });
  check("the location is there when the Passport is reopened", (await page.getByTestId("location-coordinates").innerText()).includes("18.391230, -66.117840"));

  await page.getByTestId("location-edit").click();
  await dialog.waitFor();
  check("edit opens with the saved coordinates", (await page.getByTestId("location-latitude").inputValue()) === "18.3912301");
  await page.getByTestId("location-latitude").fill("18.4");
  await page.getByTestId("location-longitude").fill("-66.12");
  await page.getByRole("button", { name: "Place pin" }).click();
  failNextSave = true;
  await page.getByTestId("location-confirm").click();
  await page.getByRole("alert").filter({ hasText: "could not be saved" }).waitFor({ timeout: 10000 });
  check("a failed save is reported and the dialog stays open", await dialog.isVisible());
  await page.getByTestId("location-confirm").click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
  check("editing updates the saved location", (await page.getByTestId("location-coordinates").innerText()).includes("18.400000, -66.120000"));
  check("edit is a PATCH of the same id (stable id)", store.length === 1 && store[0].id.startsWith("00000001"));
  check("no uncaught page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  await page.close();

  // ----------------------------------------------------------- mobile --
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await installStubs(mobile);
  await mobile.goto(`${base}/businesses/${BIZ}`, { waitUntil: "domcontentloaded" });
  await mobile.getByTestId("location-coordinates").waitFor({ timeout: 60000 });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("mobile: no horizontal page overflow", overflow <= 0, `${overflow}px`);
  const coordBox = (await mobile.getByTestId("location-coordinates").boundingBox())!;
  check("mobile: coordinates fit inside the viewport", coordBox.x >= 0 && coordBox.x + coordBox.width <= 390);
  await mobile.getByTestId("passport-location-section").screenshot({ path: path.join(OUT, "loc-4-mobile-saved.png") });
  await mobile.getByTestId("location-edit").tap();
  await mobile.getByTestId("location-picker-dialog").waitFor();
  const confirm = (await mobile.getByTestId("location-confirm").boundingBox())!;
  check("mobile: confirm control is on screen and large enough", confirm.y + confirm.height <= 844 && confirm.height >= 44, JSON.stringify(confirm));
  const mapBox = (await mobile.getByTestId("location-map-picker").boundingBox())!;
  check("mobile: map has a usable height", mapBox.height >= 260, `${mapBox.height}px`);
  await mobile.screenshot({ path: path.join(OUT, "loc-5-mobile-picker.png") });
  await mobile.keyboard.press("Escape");
  await mobile.getByTestId("location-picker-dialog").waitFor({ state: "hidden" });
  check("mobile: Escape closes without saving", bodies.length === 3);
  await mobile.close();
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
