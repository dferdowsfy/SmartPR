import { chromium } from "playwright";
const base = "http://localhost:3217";
const site = { latitude: 18.231228, longitude: -66.12616, coordinate_source: "MAP_PIN", formatted_address: "Sector Los Rosarios, Sumidero, Aguas Buenas, PR 00703", municipality: { name: "Aguas Buenas", fips: "007" }, barrio: { name: "Sumidero", geoid: null }, near_boundary: false, designations: [], boundary_source: null, location_id: null, confirmed_at: "2026-10-04T10:00:00Z" };
const state = { profile: { municipality: "Aguas Buenas" }, discoveryAnswers: {}, projectIntent: "new_business", intakeDescription: "", intakeSite: site, currentStep: 1 };
const b = await chromium.launch({ executablePath: process.env.E2E_CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 950 } });
const errs: string[] = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
await page.route("https://tiles.openfreemap.org/**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ version: 8, sources: {}, layers: [] }) }));
await page.route("**/api/**", async (route) => {
  const p = new URL(route.request().url()).pathname;
  if (p === "/api/me") return route.fulfill({ contentType: "application/json", body: '{"user":null}' });
  if (p === "/api/snapshots/dbg") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ state }) });
  if (p.startsWith("/api/locations/")) return route.continue();
  return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
});
await page.goto(`${base}/?resume=dbg`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.locator('[data-testid="open-property-report"]').waitFor({ timeout: 120000 });
await page.waitForTimeout(15000);
await page.click('[data-testid="open-property-report"]');
for (const t of ["Build a house", "I want to build an agrotourism lodge with cabins", "Open a small farm store", "Construir una casa"]) {
  await page.fill('[data-testid="activity-input"]', t);
  console.log(t, "| button disabled:", await page.locator('[data-testid="activity-analyze"]').isDisabled());
  await page.click('[data-testid="activity-analyze"]');
  await page.waitForTimeout(500);
  console.log("  facts:", await page.locator('[data-testid="activity-facts"]').innerText().catch(() => "-"), "| compat:", await page.locator('[data-testid="land-use-compatibility"]').getAttribute("data-outcome").catch(() => "none"), "| q:", await page.locator('[data-testid^="activity-question"]').count(), "| approvals:", await page.locator('[data-testid="required-approvals"]').count(), "| input now:", await page.locator('[data-testid="activity-input"]').inputValue());
}
await page.screenshot({ path: process.argv[2] });
console.log("errors:", errs.slice(0, 5));
await b.close();
