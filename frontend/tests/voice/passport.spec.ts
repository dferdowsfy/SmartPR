import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validatePassportProposals } from "../../src/app/ai/intake/passportExtraction";
import { emptyCanonicalData } from "../../src/app/forms/engine/types";

const questions = JSON.parse(readFileSync("src/kb/questions.json", "utf8"));
const canonical = emptyCanonicalData();
canonical.business.legalName = "Existing LLC";
canonical.business.entityType = "limited_liability_company";
const profile = { name: "Existing LLC", industry: "Food & Beverage", business_type: "Restaurant", municipality: "San Juan", location_type: "Commercial Facility", business_structure: "llc" };
const snapshot = {
  business_id: "voice-test", matter_id: "matter-test",
  state: { profile, canonicalApplication: canonical, currentStep: 1,
    // Restaurant intake is complete, while a Bar-only question remains
    // unanswered so a stray Passport-time reclassification would reopen it.
    discoveryAnswers: Object.fromEntries(questions
      .filter((q: { id: string }) => q.id !== "Q_ALCOHOL_SERVED")
      .map((q: { id: string; type: string; options?: string[] }) => [q.id, q.type === "boolean" ? false : q.options?.[0]])),
    potentialDecisions: Object.fromEntries(["coastal", "tourism", "historic", "metro", "capital"].map((key) => [key, "not_applies"])),
  },
};
const field = (page: Page, label: RegExp) => page.locator("label").filter({ hasText: label }).locator("..").locator("input").first();

async function setup(page: Page) {
  const saves: Record<string, unknown>[] = [];
  const modes: unknown[] = [];
  const state = {
    transcript: "",
    values: {} as Record<string, unknown>,
    passportInterpretation: {} as Record<string, unknown>,
    failSave: false,
  };
  const business = { id: "voice-test", public_id: "voice-test", name: "Existing LLC", legal_name: "Existing LLC", passport_json: canonical, municipality: "San Juan", created_at: "2026-01-01", onboarding_mode: "NEW" };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/intake/voice") return route.fulfill({ json: { transcript: state.transcript } });
    if (url.pathname === "/api/intake/interpret") {
      const body = route.request().postDataJSON(); modes.push(body.mode);
      return route.fulfill({ json: body.mode === "passport" ? { proposals: validatePassportProposals(Object.entries(state.values).map(([fieldId, value]) => ({ fieldId, value, confidence: 0.99, evidence: state.transcript })), state.transcript, "en"), interpretation: state.passportInterpretation }
        : { interpretation: { businessType: { id: "BT_RESTAURANT", name: "Restaurant", confidence: 0.99 }, municipality: { value: "San Juan", confidence: 0.99 }, profileValues: [], answers: [] } } });
    }
    if (url.pathname === "/api/me") return route.fulfill({ json: { user: { id: "test-user", name: "Test", email: "test@example.com" } } });
    if (url.pathname.startsWith("/api/snapshots/")) return route.fulfill({ json: snapshot });
    if (url.pathname === "/api/businesses/voice-test") {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON(); saves.push(body);
        if (state.failSave) return route.fulfill({ status: 503, json: { error: "Save unavailable" } });
        return route.fulfill({ json: { business: { ...business, passport_json: body.passport } } });
      }
      return route.fulfill({ json: { business, submissions: [], deliverables: [], matters: [], obligations: [], evidence: [], notifications: [] } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return { state, saves, modes };
}

async function dictate(page: Page) {
  const idle = page.getByRole("button", { name: "Start voice input — microphone off", exact: true });
  await expect(idle).toBeEnabled();
  await idle.click();
  const recording = page.getByRole("button", { name: "Stop recording and use speech", exact: true });
  await expect(recording).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Mic on · Listening — tap to finish", { exact: true })).toBeVisible();
  expect((await recording.boundingBox())!.width).toBeGreaterThan(90);
  // Exercise real MediaRecorder final-chunk collection with synthetic audio.
  await page.waitForTimeout(1200);
  await recording.click();
  await expect(page.getByRole("button", { name: "Start voice input — microphone off", exact: true })).toBeEnabled();
  await expect(page.getByText("Mic off · Tap to speak", { exact: true })).toBeVisible();
}

test("post-discovery voice updates canonical fields, autosaves, and requires conflict confirmation", async ({ page }) => {
  const { state, saves, modes } = await setup(page);
  state.transcript = "My legal entity name is Caribe Foods LLC. Our DBA is Caribe Kitchen. My EIN is 66-1234567 and we have twelve employees.";
  state.values = { legalName: "Caribe Foods LLC", tradeName: "Caribe Kitchen", ein: "66-1234567", employeeCount: 12 };
  await page.goto("/?resume=voice-test&business=voice-test&matter=matter-test");
  await expect(page.getByText("Core Application Details", { exact: true })).toBeVisible();
  await dictate(page);
  await expect(field(page, /^Trade name \/ DBA/)).toHaveValue("Caribe Kitchen");
  await expect(field(page, /^EIN\s*$/)).toHaveValue("66-1234567");
  await expect(field(page, /^Legal entity name/)).toHaveValue("Existing LLC");
  await expect(page.getByText("Proposed: Caribe Foods LLC", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(field(page, /^Legal entity name/)).toHaveValue("Caribe Foods LLC");
  await expect.poll(() => saves.some((s) => (s.passport as typeof canonical)?.business.legalName === "Caribe Foods LLC")).toBe(true);
  expect(modes).toEqual(["passport"]);
  await expect(page).toHaveURL(/resume=voice-test/);
});

test("first Passport dictation cannot reclassify the business and reopen discovery", async ({ page }) => {
  const { state, modes } = await setup(page);
  state.transcript = "My legal entity name is Caribe Foods LLC.";
  state.values = { legalName: "Caribe Foods LLC" };
  state.passportInterpretation = {
    businessType: { id: "BT_BAR", name: "Bar", confidence: 0.99 },
    profileValues: [],
    answers: [],
  };

  await page.goto("/?resume=voice-test&business=voice-test&matter=matter-test");
  await expect(page.getByText("Core Application Details", { exact: true })).toBeVisible();
  await dictate(page);

  await expect(page.locator("#spr-business-type")).toHaveValue("Restaurant");
  await expect(page.getByText("Core Application Details", { exact: true })).toBeVisible();
  await expect(page.getByText(/Will alcohol be served/i)).toHaveCount(0);
  await expect(page.getByText("Proposed: Caribe Foods LLC", { exact: true })).toBeVisible();
  expect(modes).toEqual(["passport"]);
});

test("Passport mode remains active when a spoken field makes a new follow-up relevant", async ({ page }) => {
  const { state, modes } = await setup(page);
  state.transcript = "Our business municipality is Ponce.";
  state.values = { municipality: "Ponce" };

  await page.goto("/?resume=voice-test&business=voice-test&matter=matter-test");
  await expect(page.getByText("Core Application Details", { exact: true })).toBeVisible();
  await dictate(page);

  await expect(page.locator("#spr-municipality")).toHaveValue("Ponce");
  await expect(page.getByText("Core Application Details", { exact: true })).toBeVisible();

  state.transcript = "My EIN is 66-1234567.";
  state.values = { ein: "66-1234567" };
  await dictate(page);
  await expect(field(page, /^EIN\s*$/)).toHaveValue("66-1234567");
  expect(modes).toEqual(["passport", "passport"]);
});

test("business profile preserves unsaved typing, saves voice values, and surfaces save failures", async ({ page }) => {
  const { state, saves } = await setup(page);
  await page.goto("/businesses/voice-test");
  await page.getByRole("button", { name: /Edit passport/i }).click();
  await field(page, /^Trade name \/ DBA/).fill("Typed DBA");
  state.transcript = "Our DBA is Spoken DBA and our EIN is 66-1234567.";
  state.values = { tradeName: "Spoken DBA", ein: "66-1234567" };
  await dictate(page);
  await expect(field(page, /^Trade name \/ DBA/)).toHaveValue("Typed DBA");
  await expect(field(page, /^EIN\s*$/)).toHaveValue("66-1234567");
  await expect.poll(() => saves.some((s) => (s.passport as typeof canonical)?.business.ein === "66-1234567")).toBe(true);
  await page.getByRole("button", { name: "Keep current", exact: true }).click();
  state.failSave = true;
  state.transcript = "Our primary contact is Maria Rivera."; state.values = { contactFullName: "Maria Rivera" };
  await dictate(page);
  await expect(page.getByText("Could not save the changes. Review the fields and retry saving.", { exact: true })).toBeVisible();
  await expect(field(page, /^Full name\s*$/)).toHaveValue("Maria Rivera");
});

test("first discovery utterance still follows discovery pipeline", async ({ page }) => {
  const { state, modes } = await setup(page);
  state.transcript = "I want to open a restaurant in San Juan.";
  await page.goto("/?entry=new-business&business=voice-test&matter=matter-test");
  await dictate(page);
  await expect(page.locator("#spr-nl-input")).toHaveValue(state.transcript);
  expect(modes).toEqual([undefined]);
  await expect(page.locator("#spr-municipality")).toHaveValue("San Juan");
});

test("mobile reduced-motion recorder still clearly distinguishes off/on", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?entry=new-business&business=voice-test&matter=matter-test");
  const idle = page.getByRole("button", { name: "Start voice input — microphone off", exact: true });
  await expect(idle).toBeVisible();
  await page.screenshot({ path: "test-results/voice-mobile-off.png" });
  await idle.click();
  const recording = page.getByRole("button", { name: "Stop recording and use speech", exact: true });
  await expect(recording).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/voice-mobile-on.png" });
  const rect = (await recording.boundingBox())!;
  expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(idle).toBeVisible();
});
