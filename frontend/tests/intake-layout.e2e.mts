/** Focused browser regression for the intake-to-requirements layout. Run with
 * BASE_URL=http://127.0.0.1:3000 E2E_CHROME=/path/to/chrome node --import tsx tests/intake-layout.e2e.mts
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(String(error)));
const snapshot = {
  state: {
    profile: { name: "Migos Pediatrics", business_type: "Medical Office", industry: "Healthcare", municipality: "Aguada", location_type: "Medical Office" },
    projectIntent: "new_business",
    discoveryAnswers: {},
    currentStep: 1,
  },
};
await page.route("**/api/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/snapshots/e2e-intake-layout") {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  }
  if (path === "/api/me") {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null }) });
  }
  return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
});

try {
  await page.goto(`${process.env.BASE_URL || "http://127.0.0.1:3000"}/?resume=e2e-intake-layout`, { waitUntil: "domcontentloaded" });
  const location = page.locator("#spr-location-type");
  await location.waitFor();
  await page.locator('[data-testid="guided-project-brief"]').waitFor();
  const stepperBox = await page.locator(".spr-stepper-bar").first().boundingBox();
  const locationBox = await location.boundingBox();
  assert.ok(stepperBox && locationBox && locationBox.y > stepperBox.y + stepperBox.height, "location selection belongs below the stepper");

  const promptBox = await page.locator("#spr-nl-input").boundingBox();
  const submitBox = await page.locator(".spr-nl-go").boundingBox();
  assert.ok(promptBox && submitBox && Math.abs(promptBox.y + promptBox.height / 2 - submitBox.y - submitBox.height / 2) < 3, "prompt action stays centered");

  await page.getByRole("button", { name: /Expand details/i }).first().click();
  const minimize = page.getByRole("button", { name: /Minimize details/i }).first();
  await minimize.waitFor();
  await minimize.click();
  await page.getByRole("button", { name: /Expand details/i }).first().waitFor();

  const question = page.locator(".spr-scn-questions").first();
  await question.getByRole("button", { name: /^Yes$/i }).first().click();
  await page.locator(".spr-answer-option.selected").first().waitFor();
  assert.equal(await page.locator(".spr-answer-option.selected").first().innerText(), "Yes");
  assert.equal((await page.locator(".spr-follow-up .spr-kicker").first().innerText()).toLowerCase(), "question to confirm");
  assert.deepEqual(errors, [], "no browser errors");
  console.log("PASS intake layout, expand/minimize, centered prompt and persistent answer");
} finally {
  await browser.close();
}
