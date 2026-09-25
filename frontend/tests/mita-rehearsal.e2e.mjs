/**
 * Mita rehearsal — end-to-end acceptance walkthrough.
 *
 * Drives the real run page against a stubbed run API while the embedded
 * browser shows the actual /rehearsal-portal pages (the test acts as the
 * human inside them during takeover). Checks that every chat request
 * matches the visible portal step, human-only steps never show inputs,
 * no password inputs appear, unknown states pause safely, the chat stays
 * pinned to the newest activity, and the human — not Mita — submits.
 *
 * Usage (dev server running):
 *   BASE_URL=http://localhost:3000 node tests/mita-rehearsal.e2e.mjs [outDir] [width] [height] [tag]
 * Exits non-zero on any failed check.
 */
import { chromium } from "playwright";
import os from "node:os";
const OUT = process.argv[2] || os.tmpdir();
const base = process.env.BASE_URL || "http://localhost:3000";
const W = +process.argv[3] || 1440, H = +process.argv[4] || 860, TAG = process.argv[5] || "desk";
const action = { id: "DEMO_REHEARSAL_PORTAL", filing_type: "DEMO_REHEARSAL_PORTAL", agency_id: "DEMO_REHEARSAL", title_en: "Demo rehearsal portal — practice filing", title_es: "Demo", agency_en: "Demo", agency_es: "Demo", status: "ready", known: 11, total: 12, missing_items: [], blocked_by: [], evidence_available: [], obligation_id: "demo:rehearsal" };
const filing = { id: "DEMO_REHEARSAL_PORTAL", action, obligation_id: "demo:rehearsal", requirement_id: "x", obligation_name: "Demo rehearsal filing", obligation_status: "MISSING", filing_status: "ready_to_start", supported: true, demo: true, title_en: action.title_en, title_es: action.title_es, agency_id: "DEMO_REHEARSAL", agency_en: "Demo", agency_es: "Demo" };
const preflight = { passport_items: [{ label_en: "Legal business name", label_es: "x" }], questions: [], portal_name_en: "Demo Filing Portal", portal_name_es: "Demo", evidence_tags: [] };
const brief = { goal_en: "File the annual report on the demo portal.", goal_es: "", known_fields: [], user_input_expected: [], expected_outcome_en: "Ready for your review", expected_outcome_es: "" };
const events = [];
const ev = (m, kind = "info") => events.push({ index: events.length, message: m, message_es: m, screenshot_url: "", created_at: new Date().toISOString(), kind });
const P = (path) => `${base}/rehearsal-portal/${path}`;
// Each stage: what the run looks like when the agent pauses there.
const stages = [
  { name: "login", url: "login", status: "paused", reason: "USER_LOGIN", step: { kind: "login", title: "Log in", missing: [], declared: true }, fields: [], msg: "Sign in on the portal yourself — take over the browser, then press “I'm done”" },
  { name: "form", url: "filing", status: "paused", reason: "USER_ACTION", step: { kind: "form", title: "Annual report (rehearsal)", missing: [], declared: true }, fields: [{ id: "fiscal_year_end", label: "Fiscal year end", type: "text", sensitive: false, hint: "MM/DD/YYYY" }], msg: "The portal needs: Fiscal year end — answer in the chat" },
  { name: "identity", url: "ssn", status: "paused", reason: "USER_ACTION", step: { kind: "identity", title: "Identity verification (rehearsal)", missing: [], declared: true }, fields: [{ id: "ssn", label: "Social Security Number", type: "text", sensitive: true, hint: "9 digits" }], msg: "The portal needs: Social Security Number — answer in the chat" },
  { name: "certification", url: "attestation", status: "paused", reason: "USER_ACTION", step: { kind: "certification", title: "Certification (rehearsal)", missing: ["Signature (printed name)"], declared: true }, fields: [], msg: "Certification step — review and sign it in the browser — missing: Signature (printed name)" },
  { name: "unknown", url: "payment", status: "paused", reason: "USER_ACTION", step: { kind: "unknown", title: "Payment (rehearsal)", missing: [], declared: true }, fields: [], msg: "I can't tell what this page needs — take over the browser to continue" },
  { name: "review", url: "review", status: "review", reason: null, step: null, fields: [], msg: "Turn complete — review the live browser before submitting." , kind: "review"},
  { name: "submitted", url: "success", status: "submitted", reason: null, step: null, fields: [], msg: "Filing submitted on the portal — confirmation DEMO-48213.", kind: "submitted", confirmation: "DEMO-48213" },
];
let si = -1;
let run = { id: "r1", business_id: "b1", filing_type: "DEMO_REHEARSAL_PORTAL", status: "running", pause_reason: null, created_at: "", updated_at: "", events, worker: "browser_use", live_url: P(""), browser_use_session_id: "s", provider: "browser_use_cloud", pause_streak: 0, pending_fields: [], portal_step: null, supplied_field_ids: [], goal_brief: brief, submission_objective: null, filing_authorized: false, filing_confirmation: null, passport_snapshot: null };
ev("Opened the demo portal.");
const advance = () => {
  si += 1; const st = stages[si];
  for (let i = 0; i < 3; i++) ev(`Working through the filing steps (${st.name} ${i})`);
  ev(st.msg, st.kind ?? "pause");
  run = { ...run, status: st.status, pause_reason: st.reason, portal_step: st.step, pending_fields: st.fields, pause_streak: st.status === "paused" ? 1 : 0, live_url: P(st.url), filing_confirmation: st.confirmation ?? null, events: [...events] };
};
const resumes = [];
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
await page.route("**/api/**", async (route) => {
  const u = new URL(route.request().url()); const p = u.pathname; const m = route.request().method();
  const j = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  if (p === "/api/admin/me") return j({ admin: true });
  if (p.startsWith("/api/businesses/")) return j({ business: { legal_name: "Ana L. Pérez Díaz", municipality: "Bayamón" } });
  if (p === "/api/agency-actions/filings") return j({ groups: [{ agency_id: "DEMO_REHEARSAL", agency_name_en: "SmartPR demo portal (fictional)", agency_name_es: "Demo", demo: true, filings: [filing] }] });
  if (p === "/api/agency-actions/preflight") return j({ preflight, filing_label_en: action.title_en, filing_label_es: action.title_es });
  if (p === "/api/agency-actions" && m === "POST") { advance(); return j({ run, brief }); }
  if (p === "/api/agency-runs/r1/resume") { resumes.push(route.request().postData() || ""); advance(); return j({ run }); }
  if (p === "/api/agency-runs/r1/takeover") return j({ run });
  if (p.startsWith("/api/agency-runs/")) return j({ run });
  if (p === "/api/me") return j({ user: { id: "u", email: "a@b.co", name: "Ana" } });
  return j({});
});
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
const chat = () => page.locator("[aria-label='Mita chat']");
const card = () => page.locator("#agency-intervention");
const chatMetrics = () => page.evaluate(() => {
  const box = document.querySelector("[aria-label='Mita chat'] .overflow-y-auto");
  const content = box.firstElementChild; const last = content.lastElementChild;
  const b = box.getBoundingClientRect(), l = last.getBoundingClientRect();
  return { fromBottom: Math.round(box.scrollHeight - box.scrollTop - box.clientHeight), lastVisible: l.bottom <= b.bottom + 2 && l.top >= b.top - 2 || (l.top < b.bottom && l.bottom <= b.bottom + 2), docScroll: document.documentElement.scrollHeight - innerHeight };
});
const pwInputs = () => page.evaluate(() => document.querySelectorAll("input[type=password]").length);
const frame = () => page.frameLocator("iframe");
const takeOver = async () => { await card().getByRole("button", { name: "Take over the browser" }).click(); await page.waitForTimeout(700); };
const imDone = async () => { await page.getByRole("button", { name: "I'm done" }).click(); await page.waitForTimeout(1800); };
const mobile = W < 1024;
const showChat = async () => { if (mobile) { await page.getByRole("tab", { name: "Conversation" }).click(); await page.waitForTimeout(300); } };

await page.goto(`${base}/businesses/b1/agency-run?demo=1`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Submit", exact: true }).click();
await page.waitForTimeout(900);
await page.getByRole("button", { name: "Start filing" }).click();
await page.waitForTimeout(2200);

// 1 — login: takeover, human signs in inside the browser
let txt = await card().innerText();
check("login step: no inline inputs", (await card().locator("input").count()) === 0);
check("login step: tells the user to sign in on the portal", /Sign in on the portal/.test(txt));
await page.screenshot({ path: `${OUT}/e2e-${TAG}-1-login.png` });
await takeOver();
if (mobile) check("takeover switches small screens to the browser", await page.locator("iframe").isVisible());
await frame().locator("#login-email").fill("ana@example.com");
await frame().locator("#login-password").fill("demo-only");
await frame().getByRole("button", { name: "Log in" }).click();
await imDone();
await showChat();
check("I'm done → resume sent with no credentials", resumes.length === 1 && !/password|ana@/.test(resumes[0]));

// 2 — form: fiscal year inline, submit with Enter
txt = await card().innerText();
check("form step: asks exactly for Fiscal year end", /Fiscal year end/.test(txt) && !/Password|MFA|Email/i.test(txt));
check("form step: shows the matching portal page title", /Annual report \(rehearsal\)/.test(txt));
check("no password inputs anywhere (form step)", (await pwInputs()) === 0);
const fy = card().locator("input").first();
await fy.fill("12/31/2025");
await fy.press("Enter");
await page.waitForTimeout(1800);
let mtr = await chatMetrics();
check("after inline submit: chat pinned to newest activity", mtr.fromBottom <= 2 && mtr.lastVisible, JSON.stringify(mtr));
check("page itself never scrolls", mtr.docScroll === 0);
check("Enter submitted the fiscal year", /fiscal_year_end/.test(resumes[1] || ""));

// 3 — identity: SSN inline, masked, no password manager hooks
const ssn = card().locator("input").first();
const attrs = await ssn.evaluate((el) => ({ type: el.type, ac: el.autocomplete, sec: getComputedStyle(el).webkitTextSecurity, lp: el.getAttribute("data-lpignore"), op: el.hasAttribute("data-1p-ignore") }));
check("SSN input is not a password input and is masked", attrs.type === "text" && attrs.sec === "disc" && attrs.lp === "true" && attrs.op, JSON.stringify(attrs));
check("no password inputs anywhere (identity step)", (await pwInputs()) === 0);
await page.screenshot({ path: `${OUT}/e2e-${TAG}-3-identity.png` });
await ssn.fill("123-45-6789");
await ssn.press("Enter");
await page.waitForTimeout(1800);
mtr = await chatMetrics();
check("after SSN submit: chat pinned to newest activity", mtr.fromBottom <= 2 && mtr.lastVisible, JSON.stringify(mtr));

// 4 — certification: never login fields; names the printed-name field
txt = await card().innerText();
check("certification step: no inputs at all", (await card().locator("input").count()) === 0);
check("certification step: no login fields", !/Email|Password|MFA/i.test(txt));
check("certification step: names Signature (printed name)", /Signature \(printed name\)/.test(txt));
check("certification step: says the user certifies in the browser", /never certify or sign for you/.test(txt));
await page.screenshot({ path: `${OUT}/e2e-${TAG}-4-certification.png` });
await takeOver();
await frame().locator("#attest-cert").check();
await frame().locator("#attest-signature").fill("Ana L. Pérez Díaz");
await frame().getByRole("button", { name: "Continue to payment" }).click();
await imDone();
await showChat();

// 5 — unknown: pauses safely, offers take over, no guessing
txt = await card().innerText();
check("unknown step: pauses with take-over, no inputs", /can't tell what this page needs/.test(txt) && (await card().locator("input").count()) === 0 && /Take over the browser/.test(txt));
await page.screenshot({ path: `${OUT}/e2e-${TAG}-5-unknown.png` });
await takeOver();
await imDone();
await showChat();

// 6 — review: human submits in the browser
const reviewText = await chat().innerText();
check("review: no 'File it for me' — the human submits", !/File it for me/.test(reviewText) && /Take over to review & submit/.test(reviewText));
await page.getByRole("button", { name: "Take over to review & submit" }).click();
await page.waitForTimeout(700);
await frame().getByRole("button", { name: /Submit filing/ }).click();
await imDone();
await showChat();
const done = await chat().innerText();
check("confirmation recorded after the human submitted", /DEMO-48213/.test(done) && /You submitted this filing/.test(done));
mtr = await chatMetrics();
check("final: chat pinned to newest activity", mtr.fromBottom <= 2, JSON.stringify(mtr));
await page.screenshot({ path: `${OUT}/e2e-${TAG}-6-submitted.png` });
console.log(results.join("\n"));
await browser.close();
if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
