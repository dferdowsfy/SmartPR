/**
 * SURI merchant registration — rehearsal browser test.
 *
 * Drives the real Clara run page against the fictional SURI clone
 * (/rehearsal-portal/suri). The run API is stubbed, but every state it
 * serves is produced by the real code under test:
 *   - the filing picker comes from resolveFilingOptions (routing + launch
 *     switch),
 *   - every pause goes through resolvePauseForFiling (portal-step model +
 *     flow-catalog reconciliation) from an agent report built out of what
 *     the fixture page actually shows.
 * The test then asserts each chat request against the visible screen, and
 * acts as the human inside the fixture for takeover steps.
 *
 * Honest scope: SURI_MERCHANT_REGISTRATION is NOT launchable in production
 * (enabled:false — the real SURI host was unreachable during every
 * walkthrough attempt, so the flow is procedure-derived, not observed).
 * The test asserts that picker truth, then simulates an in-progress run
 * (as a supervised pilot would produce) to regression-test Clara's gate
 * behavior: login pause, passport prefill, human-only submit, unknown
 * screens. It proves behavior, not SURI's layout.
 *
 * Usage (dev server running):
 *   BASE_URL=http://localhost:3000 npx tsx tests/clara-suri-merchant.e2e.mts [outDir] [width] [height] [tag]
 * Exits non-zero on any failed check.
 */
import { chromium, type Frame, type Page } from "playwright";
import os from "node:os";
import { resolveFilingOptions, type ObligationLike } from "../src/lib/agency-runs/agencyActions";
import { resolvePauseForFiling } from "../src/lib/agency-runs/flows";
import { stepPauseMessage } from "../src/lib/agency-runs/portalStep";
import type { AgencyPauseReason } from "../src/lib/agency-runs/types";

const OUT = process.argv[2] || os.tmpdir();
const W = Number(process.argv[3]) || 1440;
const H = Number(process.argv[4]) || 860;
const TAG = process.argv[5] || "desk";
const base = process.env.BASE_URL || "http://localhost:3000";
const FT = "SURI_MERCHANT_REGISTRATION";
const SURI = (step: string) => `${base}/rehearsal-portal/suri/merchant?step=${step}`;

const passport = {
  business: { legalName: "Café Brisa LLC", tradeName: "Café Brisa", entityType: "llc" },
  contact: { fullName: "Ana Rivera", email: "ana@example.com", phone: "787-555-0199" },
  addresses: {
    municipality: "San Juan",
    principalPhysical: { line1: "123 Calle Loíza", postalCode: "00911" },
  },
};
const obligations: ObligationLike[] = [
  { id: "obl-suri", name: "Merchant registration (SURI)", requirement_id: "DOC_MERCHANT_REGISTRATION", agency: "Departamento de Hacienda", status: "MISSING" },
];
const filingGroups = () => {
  const groups = resolveFilingOptions({ business_id: "b1", passport, priorRuns: [], obligations, env: {} });
  // Simulate an in-progress run as a supervised pilot would produce it.
  // Production truth (asserted below) is "not yet supported".
  for (const g of groups)
    for (const f of g.filings)
      if (f.requirement_id === "DOC_MERCHANT_REGISTRATION" && f.action) {
        (f as { filing_status: string }).filing_status = "in_progress";
        (f as { active_run_id: string }).active_run_id = "r1";
        (f as { supported: boolean }).supported = true;
      }
  return groups;
};

/* ---------------- run state served by the stub ---------------- */
const events: Record<string, unknown>[] = [];
const ev = (m: string, kind = "info") =>
  events.push({ index: events.length, message: m, message_es: m, screenshot_url: "", created_at: new Date().toISOString(), kind });
const brief = { goal_en: "Register the business as a merchant in SURI.", goal_es: "", known_fields: [], user_input_expected: [], expected_outcome_en: "Ready for your review", expected_outcome_es: "" };
let run: Record<string, unknown> = {
  id: "r1", business_id: "b1", filing_type: FT, status: "running", pause_reason: null, created_at: "", updated_at: "",
  events, worker: "browser_use", live_url: `${base}/rehearsal-portal/suri/login`, browser_use_session_id: "s",
  provider: "browser_use_cloud", pause_streak: 0, pending_fields: [], portal_step: null, supplied_field_ids: [],
  goal_brief: brief, submission_objective: null, filing_authorized: false, filing_confirmation: null, passport_snapshot: passport,
};
const resumes: string[] = [];
let onResume: () => void = () => {};

/** The agent paused: resolve its final message with the REAL code and serve it. */
function agentPauses(finalMessage: string, reason: AgencyPauseReason) {
  const st = resolvePauseForFiling(finalMessage, reason, FT);
  ev("Working through the SURI merchant registration.");
  ev(stepPauseMessage(st.step, st.fields).message, "pause");
  run = { ...run, status: "paused", pause_reason: reason, portal_step: st.step, pending_fields: st.fields, pause_streak: 1, events: [...events] };
  return st;
}
function agentMovesTo(url: string) {
  ev("Continuing in SURI.");
  run = { ...run, status: "running", pause_reason: null, portal_step: null, pending_fields: [], live_url: url, events: [...events] };
}

/* ---------------- checks ---------------- */
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);

async function fixtureFrame(page: Page, urlPart: string): Promise<Frame> {
  for (let i = 0; i < 60; i++) {
    const f = page.frames().find((fr) => fr.url().includes(urlPart));
    if (f) {
      try {
        await f.waitForSelector("main[data-smartpr-step] h1", { timeout: 2000, state: "attached" });
        return f;
      } catch { /* retry */ }
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`fixture frame ${urlPart} never loaded`);
}
const visible = (f: Frame) =>
  f.evaluate(() => {
    const main = document.querySelector("main[data-smartpr-step]") as HTMLElement;
    return {
      kind: main.dataset.smartprStep!,
      flowStep: main.dataset.flowStep ?? null,
      heading: (main.querySelector("h1")?.textContent ?? "").trim(),
      labels: [...main.querySelectorAll("label")].map((l) => (l.textContent ?? "").replace("*", "").trim()),
      text: main.innerText,
    };
  });
const card = (page: Page) => page.locator("#agency-intervention");
const pwInputs = (page: Page) => page.evaluate(() => document.querySelectorAll("input[type=password]").length);
const chatPinned = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector("[aria-label='Clara chat'] .overflow-y-auto") as HTMLElement;
    return Math.round(box.scrollHeight - box.scrollTop - box.clientHeight);
  });
const mobile = W < 1024;
const showBrowser = async (page: Page) => { if (mobile) { await page.getByRole("tab", { name: "Browser" }).click(); await page.waitForTimeout(300); } };
const showChat = async (page: Page) => { if (mobile) { await page.getByRole("tab", { name: "Conversation" }).click(); await page.waitForTimeout(300); } };
const waitCard = async (page: Page) => { await card(page).waitFor({ timeout: 8000 }); await page.waitForTimeout(400); };

/** The chat request must describe the screen the browser shows. */
async function assertMatches(page: Page, f: Frame, label: string) {
  const v = await visible(f);
  const txt = await card(page).innerText();
  const inputs = await card(page).locator("input").count();
  const human = !["form", "identity"].includes(v.kind);
  check(`${label}: card names the visible screen "${v.heading}"`, txt.includes(v.heading), v.heading);
  if (human) {
    check(`${label}: human-only screen → no chat inputs`, inputs === 0, `${inputs} inputs`);
  } else {
    const asked = await card(page).locator("label > span").allInnerTexts();
    const cleaned = asked.map((a) => a.replace(/\(optional\)/, "").trim());
    check(`${label}: every requested field exists on the visible screen`, cleaned.length > 0 && cleaned.every((a) => v.labels.includes(a)), `${cleaned.join(", ")} ⊆ [${v.labels.join(", ")}]`);
  }
  check(`${label}: never login fields in chat`, !/\b(Password|MFA|Contraseña)\b/.test(txt));
  check(`${label}: no password inputs outside the portal`, (await pwInputs(page)) === 0);
}

/* ---------------- run ---------------- */
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const asked: unknown[] = [];
await page.route("**/api/**", async (route) => {
  const p = new URL(route.request().url()).pathname;
  const m = route.request().method();
  const j = (b: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  if (p === "/api/admin/me") return j({ admin: false });
  if (p === "/api/businesses/b1/payment-settings") return j({ filingFeeCard: null });
  if (p.startsWith("/api/businesses/")) return j({ business: { legal_name: "Café Brisa LLC", municipality: "San Juan" } });
  if (p === "/api/agency-actions/filings") return j({ groups: filingGroups(), readiness: { documents: [], filings: [] } });
  if (p === "/api/chat") { asked.push(route.request().postDataJSON()); return j({ reply: "Merchant registration is filed in SURI." }); }
  if (p === "/api/agency-actions/preflight") return j({ preflight: { passport_items: [], questions: [], portal_name_en: "SURI", portal_name_es: "SURI", evidence_tags: [] }, filing_label_en: "SURI — Merchant registration", filing_label_es: "x" });
  if (p === "/api/agency-actions" && m === "POST") return j({ run, brief });
  if (p === "/api/agency-runs/r1/resume") { resumes.push(route.request().postData() || ""); onResume(); return j({ run }); }
  if (p === "/api/agency-runs/r1/takeover") return j({ run });
  if (p.startsWith("/api/agency-runs/")) return j({ run });
  if (p === "/api/me") return j({ user: { id: "u", email: "a@b.co", name: "Ana" } });
  return j({});
});

// 1 — picker truth: SURI merchant is not launchable (portal unverified) →
// "not yet supported", no Submit for it.
await page.goto(`${base}/businesses/b1/agency-run`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const pickerText = await page.locator("[aria-label='Clara chat']").innerText();
check("picker: SURI merchant filing is visible", /Merchant registration/.test(pickerText));
// The override only applies on the ?requirement= resume path below; the raw
// picker keeps production truth.
{
  const raw = resolveFilingOptions({ business_id: "b1", passport, priorRuns: [], obligations, env: {} });
  const opt = raw.flatMap((g) => g.filings).find((f) => f.requirement_id === "DOC_MERCHANT_REGISTRATION");
  check("picker: SURI merchant is not launchable (portal unverified)", opt?.filing_status === "not_available" && opt?.supported === false);
}
check("picker: no Submit button for the SURI merchant filing", (await page.getByRole("button", { name: "Submit", exact: true }).count()) === 0);
await page.screenshot({ path: `${OUT}/suri-${TAG}-0-picker.png` });

// 2 — supervised-pilot resume: ?requirement= reopens the in-progress run.
await page.goto(`${base}/businesses/b1/agency-run?requirement=DOC_MERCHANT_REGISTRATION`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// 3 — login gate: Clara pauses; the human signs in via takeover.
let f = await fixtureFrame(page, "/rehearsal-portal/suri/login");
let v = await visible(f);
agentPauses(`PAUSE_USER_LOGIN\nPORTAL_STEP: kind=${v.kind}; title=${v.heading}`, "USER_LOGIN");
await showChat(page); await waitCard(page);
await assertMatches(page, f, "login");
check("login: offers Take over the browser", /Take over the browser/.test(await card(page).innerText()));
await card(page).getByRole("button", { name: "Take over the browser" }).click();
await page.waitForTimeout(600);
f = await fixtureFrame(page, "/rehearsal-portal/suri/login");
await f.fill("#suri-login-username", "pilot-user");
await f.fill("#suri-login-password", "rehearsal-only");
onResume = () => agentMovesTo(`${base}/rehearsal-portal/suri/home`);
await page.getByRole("button", { name: "I'm done" }).click();
await page.waitForTimeout(1500);
check("I'm done → resume carries no credentials", resumes.length === 1 && !/rehearsal-only|pilot-user/.test(resumes[0]));

// 4 — dashboard menu: the agent opens Registro de Comerciante itself (no pause).
f = await fixtureFrame(page, "/rehearsal-portal/suri/home");
await showBrowser(page);
const dash = await visible(f);
check("dashboard: offers Registro de Comerciante", /Registro de Comerciante/.test(dash.text));
await f.getByRole("button", { name: "Registro de Comerciante" }).click();
// The agent navigates the menu itself (AGENT channel) — update the run so the
// poll loop converges the browser on the merchant form.
agentMovesTo(SURI("merchant_info"));
f = await fixtureFrame(page, "step=merchant_info");

// 5 — merchant form: the one field the passport can't fill is asked in chat.
f = await fixtureFrame(page, "step=merchant_info");
v = await visible(f);
agentPauses(
  `PAUSE_FOR_USER\nPORTAL_STEP: kind=form; title=${v.heading}\nREQUIRED_FIELDS:\n- id=merchant_role; label=Merchant role; type=select; sensitive=false`,
  "USER_ACTION"
);
await showChat(page); await waitCard(page);
await assertMatches(page, f, "merchant form");
onResume = () => agentMovesTo(SURI("review"));
const roleInput = card(page).locator("input").first();
await roleInput.fill("owner");
await roleInput.press("Enter");
await page.waitForTimeout(1500);
check("merchant form: answer sent for merchant_role only", /merchant_role/.test(resumes[1] ?? "") && !/password/i.test(resumes[1] ?? ""));
check("after inline answer: chat pinned to newest activity", (await chatPinned(page)) <= 2);

// 6 — review: Someter is the legal submission act — human only, no chat inputs.
f = await fixtureFrame(page, "step=review");
await showBrowser(page);
v = await visible(f);
agentPauses(`PAUSE_FOR_USER\nPORTAL_STEP: kind=review; title=${v.heading}`, "USER_ACTION");
await showChat(page); await waitCard(page);
await assertMatches(page, f, "review");
check("review: Clara says the human submits", /submit it yourself|envíala tú mismo/.test(await card(page).innerText()));
await page.screenshot({ path: `${OUT}/suri-${TAG}-1-review.png` });
// 7 — drift: the portal changed (survey screen) → unknown, take over, no guesses.
onResume = () => agentMovesTo(SURI("survey"));
await page.evaluate(() => fetch("/api/agency-runs/r1/resume", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
await page.waitForTimeout(1200);
f = await fixtureFrame(page, "step=survey");
v = await visible(f);
agentPauses(`PAUSE_FOR_USER\nPORTAL_STEP: kind=form; title=${v.heading}`, "USER_ACTION");
await showChat(page); await waitCard(page);
const unknownText = await card(page).innerText();
check("changed screen: pauses as unknown and offers Take over", /can't tell what this page needs/.test(unknownText) && /Take over the browser/.test(unknownText));
check("changed screen: no guessed inputs", (await card(page).locator("input").count()) === 0);
await page.screenshot({ path: `${OUT}/suri-${TAG}-3-unknown.png` });
// The human takes over, sees the portal changed, and goes back to the review.
await card(page).getByRole("button", { name: "Take over the browser" }).click();
await page.waitForTimeout(500);
onResume = () => agentMovesTo(SURI("review"));
await page.getByRole("button", { name: "I'm done" }).click();
await page.waitForTimeout(1500);

// 8 — review again, then the human clicks Someter inside the portal.
f = await fixtureFrame(page, "step=review");
await showBrowser(page);
await f.getByRole("button", { name: /Simulate the human clicking Someter/ }).click();
await page.waitForTimeout(500);
onResume = () => agentMovesTo(SURI("success"));
await page.evaluate(() => fetch("/api/agency-runs/r1/resume", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
await page.waitForTimeout(1500);

// 9 — confirmation: the agent captures the reference; the run is submitted
// with it and the confirmation panel shows the portal's reference.
f = await fixtureFrame(page, "step=success");
await showBrowser(page);
v = await visible(f);
const conf = (await f.locator("[data-testid=suri-confirmation]").innerText()).trim();
agentPauses(`PAUSE_FOR_USER\nPORTAL_STEP: kind=submission; title=${v.heading}\nCONFIRMATION: ${conf}`, "USER_ACTION");
await showChat(page); await waitCard(page);
const confText = await card(page).innerText();
check("confirmation: card names the visible screen", confText.includes(v.heading), v.heading);
// The server records the agent-reported reference and marks the run submitted.
run = { ...run, status: "submitted", filing_confirmation: conf, events: [...events] };
await page.waitForTimeout(1500);
const submittedText = await page.locator("[aria-label='Clara chat']").innerText();
check("confirmation: reference captured from the portal page", new RegExp(conf.replace(/-/g, "-")).test(submittedText), conf);
await page.screenshot({ path: `${OUT}/suri-${TAG}-2-confirmation.png` });

/* ---------------- summary ---------------- */
console.log(results.join("\n"));
const fails = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - fails}/${results.length} checks passed`);
await browser.close();
process.exit(fails ? 1 : 0);
