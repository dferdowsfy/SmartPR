/**
 * Teach Clara UI end to end: drives /businesses/[id]/teach in a real
 * browser. The page's API calls are answered in-process by the REAL server
 * functions (teachSessions + skill library) with a fake worker that replays
 * a 5-screen walkthrough, so the UI, the mapping dialogue, the skill card
 * and saving are exercised together without a live portal.
 *
 *   E2E_BASE=http://127.0.0.1:3000 CHROMIUM_PATH=… npx tsx tests/teach-clara.e2e.mts
 *
 * Needs the app running (next dev). Writes screenshots to E2E_SHOTS if set.
 * Exits 0 on pass, 1 on failure.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, type Page, type Route } from "playwright";
import {
  answerTeachQuestion,
  finishTeachSession,
  markTeachStep,
  previewTeachSession,
  saveTeachSession,
  startTeachSession,
  syncTeachSession,
  type TeachWorker,
} from "../src/lib/agency-runs/teach/teachSessions.ts";
import { MemorySkillRepo, getVisibleSkill } from "../src/lib/agency-runs/skills/skillLibrary.ts";
import { validateSkill } from "../src/lib/agency-runs/skills/skillValidate.ts";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3000";
const SHOTS = process.env.E2E_SHOTS ?? "";
const SITE = "https://permisos.ejemplo.pr.gov/";

const WALK = [
  { kind: "page", url: `${SITE}login`, title: "Portal", heading: "Iniciar sesión", hasPassword: true },
  { kind: "page", url: `${SITE}app#datos`, title: "Portal", heading: "Datos del negocio" },
  { kind: "fill", url: `${SITE}app#datos`, role: "textbox", label: "Nombre legal", selector: "#legal", inputType: "text", valueKind: "text", required: true },
  { kind: "fill", url: `${SITE}app#datos`, role: "textbox", label: "Teléfono", selector: "#tel", inputType: "tel", valueKind: "phone" },
  { kind: "fill", url: `${SITE}app#datos`, role: "textbox", label: "Nombre del proyecto", selector: "#proj", inputType: "text", valueKind: "text" },
  { kind: "page", url: `${SITE}app#dueno`, title: "Portal", heading: "¿A nombre de quién sale el permiso?" },
  { kind: "click", url: `${SITE}app#dueno`, role: "radio", label: "Usted", selector: "#r1", inputType: "radio", optionText: "Usted" },
  { kind: "page", url: `${SITE}app#empleados`, title: "Portal", heading: "Empleados" },
  { kind: "fill", url: `${SITE}app#empleados`, role: "textbox", label: "Cantidad de empleados", selector: "#emp", inputType: "number", valueKind: "number" },
  { kind: "page", url: `${SITE}app#revision`, title: "Portal", heading: "Revisión" },
  { kind: "click", url: `${SITE}app#revision`, role: "button", label: "Radicar", selector: "#radicar", inputType: "button" },
];

let released = 0; // how much of the walkthrough the "teacher" has done so far
const worker: TeachWorker = {
  async start() {
    return { sessionId: "w1", liveUrl: `${BASE}/teach-live-placeholder` };
  },
  async events(_id, after) {
    const items = WALK.slice(after, released).map((event, i) => ({ seq: after + i + 1, event }));
    return { items, nextAfter: Math.max(after, released), status: "running" };
  },
  async stop() {},
};
const repo = new MemorySkillRepo();
const viewer = { userId: randomUUID(), isAdmin: false };
const deps = { worker };

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function handle(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()!) : {};
  const m = url.pathname.match(/^\/api\/teach-sessions(?:\/([^/]+))?(?:\/(answer|mark|finish|save))?$/);
  try {
    if (url.pathname === "/api/me") return json(route, { configured: true, user: { id: viewer.userId, isAdmin: false } });
    if (!m) return route.continue();
    const [, id, action] = m;
    if (!id) {
      const session = await startTeachSession(deps, { viewer, tier: "user", businessId: "b1", passport: null, startUrl: body.start_url, portalName: body.portal_name, form: body.form });
      return json(route, { session }, 201);
    }
    if (!action) return json(route, { session: await syncTeachSession(deps, viewer, id) });
    if (action === "answer") return json(route, { session: answerTeachQuestion(viewer, id, body.question_id, body.answer) });
    if (action === "mark") return json(route, { session: markTeachStep(viewer, id, body.add_step ? { addStep: body.add_step } : { stepId: body.step_id, gate: body.gate, conditional: body.conditional }) });
    if (action === "finish") return json(route, req.method() === "POST" ? await finishTeachSession(deps, viewer, id) : previewTeachSession(viewer, id));
    if (action === "save") {
      const row = await saveTeachSession({ repo }, viewer, id, { submit: body.submit === true });
      return json(route, { skill: { id: row.id, scope: row.scope, status: row.status } }, 201);
    }
    return route.continue();
  } catch (err) {
    return json(route, { error: "e2e", message: (err as Error).message }, 400);
  }
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function answerVisibleQuestions(page: Page, clicks: { n: number }) {
  // Answer each open question the way a teacher would.
  for (let guard = 0; guard < 20; guard++) {
    const ask = page.getByRole("button", { name: "Ask me each time" });
    const yes = page.getByRole("button", { name: "Yes", exact: true });
    const pick = page.locator("select").filter({ hasText: "Choose one of the business's details" });
    if ((await pick.count()) && (await page.getByText("Which of the business's details goes here?").count())) {
      await ask.first().click();
    } else if (await page.getByText("only shows up sometimes. What decides it?").count()) {
      await page.locator("select").filter({ hasText: "Choose one of the business's details" }).first().selectOption("operations.employeeCount");
      await page.getByRole("button", { name: "Use this" }).first().click();
    } else if (await yes.count()) {
      await yes.first().click();
    } else break;
    clicks.n += 1;
    await page.waitForTimeout(250);
  }
}

async function main() {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  lastPage = page;
  if (process.env.E2E_DEBUG) {
    page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 300)));
    page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 300)));
    page.on("request", (r) => r.url().includes("/api/") && console.log("[req]", r.method(), r.url()));
  }
  await page.route("**/api/**", handle);
  await page.route("**/teach-live-placeholder", (r) => r.fulfill({ contentType: "text/html", body: "<body style='background:#222;color:#aaa;font:16px sans-serif;padding:24px'>(the agency site, in your own browser session)</body>" }));
  const clicks = { n: 0 };

  await page.goto(`${BASE}/businesses/b1/teach?url=${encodeURIComponent(SITE)}&form=${encodeURIComponent("Permiso de Uso")}&portal=${encodeURIComponent("Portal de Permisos")}`, { waitUntil: "networkidle" });
  await page.getByText("Show Clara a filing once").waitFor();
  await shot(page, "1-setup");
  // Dev mode hydrates late: retry until the click lands.
  for (let i = 0; i < 10; i++) {
    await page.getByRole("button", { name: "Open the site and start" }).click();
    if (await page.getByText("Screens so far").waitFor({ timeout: 2000 }).then(() => true, () => false)) break;
  }
  clicks.n += 1;

  // Screens 1–2: login (human gate) and business details.
  released = 5;
  await page.getByText("This looks like the sign-in screen.").waitFor({ timeout: 10000 });
  await page.getByText('This looks like "Business legal name" from the business\'s info. Remember it that way?').waitFor();
  await shot(page, "2-recording-questions");
  await answerVisibleQuestions(page, clicks);

  // Screens 3–5.
  released = WALK.length;
  await page.getByText('You picked "Usted". Should I always choose this?').waitFor({ timeout: 10000 });
  await answerVisibleQuestions(page, clicks);

  await page.getByRole("button", { name: "I'm done — show me what Clara learned" }).click();
  clicks.n += 1;
  await page.getByText("Always yours, every time:").waitFor({ timeout: 10000 });
  await shot(page, "3-skill-card");

  const text = await page.locator("main").innerText();
  assert.match(text, /Nombre legal/);
  assert.match(text, /Business legal name/);
  assert.match(text, /Nombre del proyecto[\s\S]*Clara asks you each time/);
  assert.match(text, /Always picks "Usted"/);
  assert.match(text, /You do this yourself: Sign in/);
  assert.match(text, /You do this yourself: Final submit/);

  await page.getByRole("button", { name: "Save it for me" }).click();
  clicks.n += 1;
  await page.getByText("Clara learned it.").waitFor();
  await page.getByText("It's saved just for you.").waitFor();
  await shot(page, "4-saved");

  const rows = [...repo.rows.values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scope, "private");
  assert.deepEqual(validateSkill(rows[0].skill), []);
  assert.equal(await getVisibleSkill(repo, { userId: randomUUID(), isAdmin: false }, rows[0].id), null, "another account can't see it");

  // Spanish copy renders too.
  await page.goto(`${BASE}/businesses/b1/teach`, { waitUntil: "networkidle" });
  await page.getByRole("banner").getByRole("button", { name: "ES" }).first().click();
  await page.getByText("Muéstrale a Clara un trámite una vez").waitFor();
  await shot(page, "5-setup-es");

  console.log(`PASS teach-clara UI e2e — ${clicks.n} teacher clicks for a 5-screen form`);
  await browser.close();
}

let lastPage: Page | null = null;
main().catch(async (err) => {
  if (lastPage) {
    console.error("PAGE TEXT:", (await lastPage.locator("body").innerText().catch(() => "")).slice(0, 1500));
    if (SHOTS) await lastPage.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => undefined);
  }
  console.error("FAIL teach-clara UI e2e:", err);
  process.exit(1);
});
