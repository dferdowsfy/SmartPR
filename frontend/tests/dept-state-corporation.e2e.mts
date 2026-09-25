/**
 * Dept. of State corporation formation — rehearsal browser test.
 *
 * Drives the real Clara run page against the fictional clone of the
 * recorded registry wizard (/rehearsal-portal/dept-state). The run API is
 * stubbed, but every state it serves is produced by the real code under
 * test:
 *   - the filing picker comes from resolveFilingOptions (routing + launch
 *     switch),
 *   - every pause goes through resolvePauseForFiling (portal-step model +
 *     flow-catalog reconciliation) from an agent report built out of what
 *     the fixture page actually shows.
 * The test then asserts each chat request against the visible screen, and
 * acts as the human inside the fixture for takeover steps.
 *
 * Usage (dev server running):
 *   BASE_URL=http://localhost:3000 npx tsx tests/dept-state-corporation.e2e.ts [outDir] [width] [height] [tag]
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
const FT = "DEPT_STATE_CORPORATE_FILING";
const WIZ = (step: string) => `${base}/rehearsal-portal/dept-state/wizard?step=${step}`;

const passport = {
  business: { legalName: "Brisa Tropical Corp.", entityType: "corporation" },
  contact: { fullName: "Ana Rivera", email: "ana@example.com", phone: "787-555-0199" },
  // A PO box on purpose: the registry rejects it (recorded validation).
  addresses: { principalPhysical: { line1: "PO Box 9021", postalCode: "00901" } },
};
const obligations: ObligationLike[] = [
  { id: "obl-corp", name: "Certificate of Incorporation", requirement_id: "DOC_CERT_INCORPORATION", agency: "Department of State", status: "MISSING" },
  { id: "obl-llc", name: "Certificate of Organization (LLC)", requirement_id: "DOC_CERT_ORGANIZATION", agency: "Department of State", status: "MISSING" },
  { id: "obl-annual", name: "Annual report", requirement_id: "DOC_ANNUAL_REPORT", agency: "Department of State", status: "MISSING" },
  { id: "obl-health", name: "Health / Sanitary Permit", requirement_id: "DOC_HEALTH_PERMIT", agency: "Departamento de Salud", status: "MISSING" },
];
let launchEnv: Record<string, string> = {};
const filingGroups = () => resolveFilingOptions({ business_id: "b1", passport, priorRuns: [], obligations, env: launchEnv });

/* ---------------- run state served by the stub ---------------- */
const events: Record<string, unknown>[] = [];
const ev = (m: string, kind = "info") =>
  events.push({ index: events.length, message: m, message_es: m, screenshot_url: "", created_at: new Date().toISOString(), kind });
const brief = { goal_en: "Form a NEW corporation.", goal_es: "", known_fields: [], user_input_expected: [], expected_outcome_en: "Ready for your review", expected_outcome_es: "" };
let run: Record<string, unknown> = {
  id: "r1", business_id: "b1", filing_type: FT, status: "running", pause_reason: null, created_at: "", updated_at: "",
  events, worker: "browser_use", live_url: `${base}/rehearsal-portal/dept-state`, browser_use_session_id: "s",
  provider: "browser_use_cloud", pause_streak: 0, pending_fields: [], portal_step: null, supplied_field_ids: [],
  goal_brief: brief, submission_objective: null, filing_authorized: false, filing_confirmation: null, passport_snapshot: passport,
};
const resumes: string[] = [];
let onResume: () => void = () => {};

/** The agent paused: resolve its final message with the REAL code and serve it. */
function agentPauses(finalMessage: string, reason: AgencyPauseReason) {
  const st = resolvePauseForFiling(finalMessage, reason, FT);
  ev("Working through the registry wizard.");
  ev(stepPauseMessage(st.step, st.fields).message, "pause");
  run = { ...run, status: "paused", pause_reason: reason, portal_step: st.step, pending_fields: st.fields, pause_streak: 1, events: [...events] };
  return st;
}
function agentMovesTo(url: string) {
  ev("Continuing in the registry wizard.");
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
  if (p === "/api/businesses/b1/payment-settings") return j({ filingFeeCard: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2031, consentedAt: "2026-09-01T00:00:00Z", expired: false } });
  if (p.startsWith("/api/businesses/")) return j({ business: { legal_name: "Brisa Tropical Corp.", municipality: "San Juan" } });
  if (p === "/api/agency-actions/filings") return j({ groups: filingGroups(), readiness: {
    documents: [
      { id: "DOC_EIN", label_en: "EIN Confirmation Letter", label_es: "Carta de confirmación del EIN", status: "verified" },
      { id: "business_passport", label_en: "Business Passport", label_es: "Pasaporte comercial", status: "verified" },
    ],
    filings: [],
  } });
  if (p === "/api/chat") { asked.push(route.request().postDataJSON()); return j({ reply: "The Certificate of Incorporation is filed with the Department of State." }); }
  if (p === "/api/agency-actions/preflight") return j({ preflight: { passport_items: [{ label_en: "Legal business name", label_es: "x" }], questions: [], portal_name_en: "Corporate & Entities Registry", portal_name_es: "x", evidence_tags: [] }, filing_label_en: "Dept. of State — Form a corporation", filing_label_es: "x" });
  if (p === "/api/agency-actions" && m === "POST") return j({ run, brief });
  if (p === "/api/agency-runs/r1/resume") { resumes.push(route.request().postData() || ""); onResume(); return j({ run }); }
  if (p === "/api/agency-runs/r1/takeover") return j({ run });
  if (p.startsWith("/api/agency-runs/")) return j({ run });
  if (p === "/api/me") return j({ user: { id: "u", email: "a@b.co", name: "Ana" } });
  return j({});
});

// 1 — launch switch off: visible, not startable; LLC and annual report non-launchable; others visible.
await page.goto(`${base}/businesses/b1/agency-run`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const corpCard = page.locator("[data-testid=filing-card]", { hasText: "Form a corporation" });
check("switch off: corporation filing is visible", await corpCard.isVisible());
check("switch off: shows 'Not yet available' with no Submit", /Not yet available/.test(await corpCard.innerText()) && (await corpCard.getByRole("button", { name: "Submit", exact: true }).count()) === 0);
const pickerText = await page.locator("[aria-label='Clara chat']").innerText();
check("LLC routes to its own variant, not the corporation", /Form an LLC \(Certificate of Organization\)/.test(pickerText));
check("annual report routes to its own variant", /Annual report \/ annual fee/.test(pickerText));
check("unsupported requirements stay visible", /Health \/ Sanitary Permit/.test(pickerText) && /Not yet supported/.test(pickerText));
check("no Submit anywhere while the switch is off", (await page.getByRole("button", { name: "Submit", exact: true }).count()) === 0);
const docs = await page.locator("[data-testid=documents-on-file]").innerText();
check("picker: documents on file listed with Complete", /EIN Confirmation Letter/.test(docs) && /Complete/.test(docs));
check("picker: assistance quick actions present", (await page.locator("[data-testid=assist-panel]").innerText()).includes("Show missing items"));
if (W < 1024) { /* composer lives in the chat pane on mobile too */ }
const composer = page.getByRole("textbox", { name: "Message SmartPR" });
await composer.fill("my password is hunter2");
await composer.press("Enter");
await page.waitForTimeout(300);
check("composer: refuses a password and sends nothing", asked.length === 0 && /Don't share passwords/.test(await page.locator("[data-testid=chat-composer]").innerText()));
await composer.fill("What does the Department of State need?");
await composer.press("Enter");
await page.waitForTimeout(800);
check("composer: question goes to the SmartPR assistant", asked.length === 1 && /Certificate of Incorporation is filed/.test(await page.locator("[aria-label='Clara chat']").innerText()));
await page.screenshot({ path: `${OUT}/dos-${TAG}-0-picker-off.png` });

// 2 — pilot switch on: startable.
launchEnv = { MITA_FLOW_DEPT_STATE_CORPORATION: "on" };
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
check("switch on: only the corporation filing gets Submit", (await page.getByRole("button", { name: "Submit", exact: true }).count()) === 1);
await page.getByRole("button", { name: "Submit", exact: true }).click();
await page.waitForTimeout(900);
await page.getByRole("button", { name: "Start filing" }).click();
await page.waitForTimeout(1500);

// 3 — login: human signs in via takeover.
let f = await fixtureFrame(page, "/rehearsal-portal/dept-state");
let v = await visible(f);
agentPauses(`PAUSE_USER_LOGIN\nPORTAL_STEP: kind=${v.kind}; title=${v.heading}`, "USER_LOGIN");
await showChat(page); await waitCard(page);
await assertMatches(page, f, "login");
await card(page).getByRole("button", { name: "Take over the browser" }).click();
await page.waitForTimeout(600);
f = await fixtureFrame(page, "/rehearsal-portal/dept-state");
await f.fill("#dos-login-email", "ana@example.com");
await f.fill("#dos-login-password", "rehearsal-only");
onResume = () => agentMovesTo(WIZ("filer"));
await page.getByRole("button", { name: "I'm done" }).click();
await page.waitForTimeout(1500);
check("I'm done → resume carries no credentials", resumes.length === 1 && !/rehearsal-only|ana@/.test(resumes[0]));

// 4 — Filer: the passport's PO box is rejected; chat asks for exactly that field with the portal's message.
f = await fixtureFrame(page, "step=filer");
await showBrowser(page);
await f.fill("#dos-filer_street", "PO Box 9021"); // agent types the passport value
await f.getByRole("button", { name: "Next", exact: true }).click();
await page.waitForTimeout(300);
const portalError = (await f.locator("main [role=alert]").innerText()).trim();
v = await visible(f);
agentPauses(
  `PAUSE_FOR_USER\nPORTAL_STEP: kind=form; title=${v.heading}; url=#filer\nREQUIRED_FIELDS:\n- id=filer_street; label=Street address; type=text; sensitive=false; error=${portalError.replace(/;/g, ",")}`,
  "USER_ACTION"
);
await showChat(page); await waitCard(page);
await assertMatches(page, f, "filer validation");
check("filer: portal's validation message shown in chat", (await card(page).innerText()).includes("PO Box addresses are not accepted"));
check("filer: the rejected passport value is not pre-filled back", (await card(page).locator("input").first().inputValue()) === "");
await page.screenshot({ path: `${OUT}/dos-${TAG}-1-filer-error.png` });
onResume = () => agentMovesTo(WIZ("capital_stock"));
const street = card(page).locator("input").first();
await street.fill("123 Calle Principal");
await street.press("Enter");
await page.waitForTimeout(1500);
check("filer: answer sent for filer_street only", /filer_street/.test(resumes[1] ?? "") && !/password/i.test(resumes[1] ?? ""));

// 5 — Capital Stock: passport can't fill shares → ask exactly that.
f = await fixtureFrame(page, "step=capital_stock");
v = await visible(f);
agentPauses(`PAUSE_FOR_USER\nPORTAL_STEP: kind=form; title=${v.heading}\nREQUIRED_FIELDS:\n- id=number_of_shares; label=Number of shares; type=number; sensitive=false`, "USER_ACTION");
await showChat(page); await waitCard(page);
await assertMatches(page, f, "capital stock");
onResume = () => agentMovesTo(WIZ("signatures"));
const shares = card(page).locator("input").first();
await shares.fill("1000");
await shares.press("Enter");
await page.waitForTimeout(1500);
check("after inline answer: chat pinned to newest activity", (await chatPinned(page)) <= 2);

// 6 — Signatures, with a CONTRADICTORY agent report (login fields): chat must show the signing step.
f = await fixtureFrame(page, "step=signatures");
v = await visible(f);
agentPauses(`PAUSE_USER_LOGIN\nPORTAL_STEP: kind=signature; title=${v.heading}\nREQUIRED_FIELDS:\n- id=email; label=Email; type=email; sensitive=false\n- id=password; label=Password; type=password; sensitive=true`, "USER_LOGIN");
await showChat(page); await waitCard(page);
await assertMatches(page, f, "signatures (contradictory report)");
check("signatures: human signs — Clara never does", /never certify or sign for you/.test(await card(page).innerText()));
await page.screenshot({ path: `${OUT}/dos-${TAG}-2-signatures.png` });
await card(page).getByRole("button", { name: "Take over the browser" }).click();
await page.waitForTimeout(600);
f = await fixtureFrame(page, "step=signatures");
await f.check("#dos-perjury");
await f.fill("#dos-signer_name", "Ana Rivera");
await f.getByRole("button", { name: "Sign", exact: true }).click();
onResume = () => agentMovesTo(WIZ("survey"));
await page.getByRole("button", { name: "I'm done" }).click();
await page.waitForTimeout(1500);

// 7 — portal changed: an unrecorded screen → unknown, take over.
f = await fixtureFrame(page, "step=survey");
v = await visible(f);
agentPauses(`PAUSE_FOR_USER\nPORTAL_STEP: kind=form; title=${v.heading}\nREQUIRED_FIELDS:\n- id=owner_pct; label=Ownership percentage; type=number; sensitive=false`, "USER_ACTION");
await showChat(page); await waitCard(page);
const unknownText = await card(page).innerText();
check("changed screen: pauses as unknown and offers Take over", /can't tell what this page needs/.test(unknownText) && /Take over the browser/.test(unknownText));
check("changed screen: no guessed inputs", (await card(page).locator("input").count()) === 0);
await page.screenshot({ path: `${OUT}/dos-${TAG}-3-unknown.png` });
onResume = () => agentMovesTo(WIZ("payment"));
await card(page).getByRole("button", { name: "Take over the browser" }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: "I'm done" }).click();
await page.waitForTimeout(1500);

// 8 — Payment: handoff shows payee + the portal's amount; the human pays in the portal.
f = await fixtureFrame(page, "step=payment");
await showBrowser(page);
v = await visible(f);
const total = (await f.locator("[data-testid=dos-total]").innerText()).replace(/^Total:\s*/, "").trim();
agentPauses(`PAUSE_PAYMENT\nPORTAL_STEP: kind=payment; title=${v.heading}; amount=${total}`, "PAYMENT");
await showChat(page); await waitCard(page);
await assertMatches(page, f, "payment");
const handoff = await page.locator("[data-testid=payment-handoff]").innerText();
check("payment: payee is the Department of State", /Puerto Rico Department of State/.test(handoff));
check("payment: amount equals what the portal shows", handoff.includes(total), total);
check("payment: SmartPR charges nothing; the human enters the card in the portal", /None/.test(handoff) && /You enter the card directly in the agency portal/.test(handoff));
check("payment: saved filing-fee card shown as a reminder", /Use your Visa •••• 4242/.test(handoff) && /exp\. 12\/31/.test(handoff));
check("payment: SmartPR can't charge the saved card or credit for this fee", /can't charge your saved card or apply SmartPR credit/.test(handoff));
check("payment: no card data ever sent to the agent", resumes.every((b) => !/4242|card/i.test(b)));
await page.screenshot({ path: `${OUT}/dos-${TAG}-4-payment.png` });
await card(page).getByRole("button", { name: "Take over the browser" }).click();
await page.waitForTimeout(600);
f = await fixtureFrame(page, "step=payment");
await f.fill("#dos-card_number", "0000 0000 0000 0000"); // fictional — the fixture sends nothing
await f.fill("#dos-card_expiry", "01/30");
await f.getByRole("button", { name: "Pay and submit" }).click();
onResume = () => {
  // The agent observes the confirmation the HUMAN produced.
  ev("Filing submitted on the portal — confirmation REHEARSAL-DOS-000123.", "submitted");
  run = { ...run, status: "submitted", pause_reason: null, portal_step: null, pending_fields: [], filing_confirmation: "REHEARSAL-DOS-000123", events: [...events], live_url: WIZ("thank_you") };
};
f = await fixtureFrame(page, "step=thank_you");
const conf = (await f.locator("[data-testid=dos-confirmation]").innerText()).match(/REHEARSAL-DOS-\d+/)?.[0];
await page.getByRole("button", { name: "I'm done" }).click();
await page.waitForTimeout(1800);
await showChat(page);
const finalChat = await page.locator("[aria-label='Clara chat']").innerText();
check("confirmation recorded after the human submitted", Boolean(conf) && finalChat.includes(conf!) && /You submitted this filing/.test(finalChat), conf);
await page.screenshot({ path: `${OUT}/dos-${TAG}-5-confirmation.png` });

console.log(results.join("\n"));
await browser.close();
if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
