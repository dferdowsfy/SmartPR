/**
 * Phase 3 acceptance: replay skill ogpe.permiso_unico v1 against the OGPe
 * portal simulator (public/simulators/ogpe-permiso-unico.html) in a real
 * browser, with a test passport and a scripted human at every pause.
 *
 *  - every mapped field is filled from the passport (transforms applied)
 *  - every declared gate on the path pauses, in order
 *  - the engine never touches Radicar (or Pagar); only the human does
 *  - drift (renamed field / unexpected screen) pauses, reports, and marks
 *    the skill needs_reteach without editing it
 *
 *   CHROMIUM_PATH=/path/to/chromium npx tsx --test src/lib/agency-runs/replay/replay.e2e.test.ts
 * Skipped when Chromium can't launch.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { Skill } from "../skills/skill";
import { DRIVER_SCRIPT } from "./driverScript";
import { PlaywrightDriver } from "./playwrightDriver";
import { advanceReplay, newReplayState, type ReplayContext, type ReplayState } from "./engine";
import { MemorySkillRepo, markNeedsReteach, saveTaughtSkill } from "../skills/skillLibrary";

const ROOT = join(__dirname, "..", "..", "..", "..");
const SIM = readFileSync(join(ROOT, "public", "simulators", "ogpe-permiso-unico.html"), "utf8");
const SKILL = JSON.parse(readFileSync(join(__dirname, "..", "skills", "ogpe.permiso_unico.v1.json"), "utf8")) as Skill;

const PASSPORT = {
  business: { legalName: "Panadería La Esquina LLC", entityType: "limited_liability_company" },
  contact: { fullName: "Marisol Rivera", email: "marisol@laesquina.pr", phone: "(787) 555-0142" },
  addresses: { municipality: "Bayamón", principalPhysical: { line1: "Calle Luna 10", postalCode: "00961" } },
};

let browser: Browser | null = null;
let launchError = "";

before(async () => {
  try {
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  } catch (err) {
    launchError = (err as Error).message.split("\n")[0];
  }
});
after(async () => {
  await browser?.close();
});

async function openSimulator(query = ""): Promise<{ page: Page; driver: PlaywrightDriver }> {
  const context = await browser!.newContext();
  await context.addInitScript(DRIVER_SCRIPT);
  // The simulator answers for the real host, so the skill's page_match
  // (url_contains "sbp.ogpe.pr.gov") is exercised as written. No network.
  await context.route("https://sbp.ogpe.pr.gov/**", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: SIM }));
  const page = await context.newPage();
  await page.goto(`https://sbp.ogpe.pr.gov/${query}`);
  return { page, driver: new PlaywrightDriver(page, 120) };
}

/** What the human does at each kind of pause in the simulator. */
async function humanActs(page: Page, state: ReplayState): Promise<Record<string, string>> {
  const p = state.pause!;
  if (p.kind === "ask") return Object.fromEntries(p.fields.map((f) => [f.key, "Proyecto Pan Caliente"]));
  if (p.kind !== "gate") throw new Error(`unexpected pause ${JSON.stringify(p)}`);
  switch (p.gate) {
    case "login":
      await page.getByRole("button", { name: "Iniciar sesión" }).click();
      await page.fill("#usuario", "marisol");
      await page.fill("#clave", "not-a-real-password");
      await page.getByRole("button", { name: "Entrar" }).click();
      break;
    case "mfa":
      await page.fill("#otp", "123456");
      await page.getByRole("button", { name: "Verificar" }).click();
      break;
    case "parcel":
      await page.locator("#s-detalles button").click();
      await page.getByRole("button", { name: "Seleccionar parcela en el mapa" }).click();
      await page.locator("#s-localizacion button", { hasText: "Continuar" }).click();
      break;
    case "upload":
      await page.locator("#s-permiso button").click();
      await page.locator("#s-anejos button").click();
      break;
    case "certification":
      await page.check("#cert");
      await page.locator("#cert-next").click();
      break;
    case "submit":
      await page.evaluate(() => ((window as unknown as { __submittedBy: string }).__submittedBy = "human"));
      await page.locator("#radicar").click();
      break;
    case "payment":
      await page.fill("#tarjeta", "4111");
      await page.getByRole("button", { name: "Pagar" }).click();
      break;
    default:
      throw new Error(`no human script for gate ${p.gate}`);
  }
  return {};
}

describe("replay: ogpe.permiso_unico v1 against the portal simulator", () => {
  it("fills every mapped field from the passport, pauses at every gate, never touches submit", async (t) => {
    if (!browser) return t.skip(`chromium unavailable: ${launchError}`);
    const { page, driver } = await openSimulator();
    const drifts: unknown[] = [];
    let state = newReplayState(SKILL);
    const gates: string[] = [];
    const answers: Record<string, string> = {};
    for (let i = 0; i < 20 && state.status !== "done"; i++) {
      const ctx: ReplayContext = { skill: SKILL, passport: PASSPORT, driver, answers, onDrift: (d) => void drifts.push(d) };
      state = await advanceReplay(state, ctx);
      if (state.status === "done") break;
      assert.equal(state.status, "paused", JSON.stringify(state.pause));
      if (state.pause?.kind === "gate") {
        gates.push(state.pause.gate);
        // While paused at submit, nothing has been submitted.
        if (state.pause.gate === "submit") assert.equal(await page.evaluate(() => (window as unknown as { __sim: { submitted: boolean } }).__sim.submitted), false);
      }
      Object.assign(answers, await humanActs(page, state));
    }
    assert.equal(state.status, "done", JSON.stringify(state.pause));
    assert.deepEqual(drifts, []);
    assert.deepEqual(gates, ["login", "mfa", "parcel", "upload", "certification", "submit", "payment"]);

    // Every declared step gate paused.
    const stepGates = SKILL.steps.filter((s) => s.gate).map((s) => s.gate);
    assert.deepEqual([...new Set(gates)].sort(), [...new Set(stepGates)].sort());

    // Mapped fields, filled from the passport with transforms.
    const v = (sel: string) => page.inputValue(sel);
    assert.equal(await v("#legal"), "Panadería La Esquina LLC");
    assert.equal(await v("#dir1"), "Calle Luna 10");
    assert.equal(await v("#zip"), "00961");
    assert.equal(await v("#cname"), "Marisol Rivera");
    assert.equal(await v("#cemail"), "marisol@laesquina.pr");
    assert.equal(await v("#ctel"), "7875550142", "strip_formatting applied");
    assert.equal(await v("#proj"), "Proyecto Pan Caliente", "unmapped field came from the human's answer");
    assert.equal(await page.textContent("#dd-ent .dd-trigger"), "Compañía de Responsabilidad Limitada (LLC)");
    assert.equal(await page.textContent("#dd-mun .dd-trigger"), "Bayamón");
    assert.equal(await v("#p-legal"), "Panadería La Esquina LLC");
    assert.equal(await v("#p-dir"), "Calle Luna 10");
    assert.equal(await page.textContent("#dd-pmun .dd-trigger"), "Bayamón");
    assert.equal(await v("#p-tel"), "7875550142");
    // Fields Clara must never touch stayed untouched by her.
    assert.equal(await v("#dba"), "", "optional field with no passport value left blank");

    // Submit: only the human pressed it; the engine never clicked it or Pagar.
    assert.ok(!driver.clicks.some((c) => /radicar|pagar/i.test(c)), `engine clicked: ${driver.clicks.join(", ")}`);
    assert.equal(await page.evaluate(() => (window as unknown as { __submittedBy?: string }).__submittedBy), "human");
    assert.equal(await page.evaluate(() => (window as unknown as { __sim: { submitted: boolean } }).__sim.submitted), true);

    // Milestones carry labels, never values.
    const chat = JSON.stringify(state.milestones);
    for (const secret of ["Panadería", "Calle Luna", "marisol@", "7875550142", "Proyecto Pan Caliente"]) assert.ok(!chat.includes(secret), secret);
    await page.context().close();
  });

  it("a renamed field pauses, reports, and marks the skill needs_reteach (skill unchanged)", async (t) => {
    if (!browser) return t.skip(`chromium unavailable: ${launchError}`);
    const repo = new MemorySkillRepo();
    const owner = { userId: randomUUID(), isAdmin: false };
    const row = await saveTaughtSkill(repo, owner, SKILL, "user");
    const before = JSON.stringify(row.skill.steps);

    const { page, driver } = await openSimulator("?drift=label");
    let state = newReplayState(SKILL);
    const answers: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      state = await advanceReplay(state, {
        skill: SKILL,
        passport: PASSPORT,
        driver,
        answers,
        onDrift: async (d) => void (await markNeedsReteach(repo, row.id, `${d.reason} on ${d.expected}: ${d.detail}`)),
      });
      if (state.pause?.kind === "drift") break;
      Object.assign(answers, await humanActs(page, state));
    }
    assert.equal(state.pause?.kind, "drift");
    const d = state.pause as Extract<ReplayState["pause"], { kind: "drift" }>;
    assert.equal(d.reason, "control_not_found");
    assert.equal(d.stepId, "proyecto-detalles");
    assert.match(d.detail, /Nombre legal/);
    assert.equal(d.seen.heading, "Detalles del Proyecto");

    const after = await repo.get(row.id);
    assert.equal(after?.status, "needs_reteach");
    assert.match(after?.review_notes ?? "", /control_not_found/);
    assert.equal(JSON.stringify(after?.skill.steps), before, "skill content never edited");
    // It never went on to guess: the rest of the screen is untouched after the miss.
    assert.equal(await page.inputValue("#dir1"), "");
    await page.context().close();
  });

  it("an unexpected screen pauses as drift instead of improvising", async (t) => {
    if (!browser) return t.skip(`chromium unavailable: ${launchError}`);
    const { page, driver } = await openSimulator("?drift=screen");
    let state = newReplayState(SKILL);
    const drifts: string[] = [];
    for (let i = 0; i < 10; i++) {
      state = await advanceReplay(state, { skill: SKILL, passport: PASSPORT, driver, onDrift: (d) => void drifts.push(d.reason) });
      if (state.pause?.kind === "drift") break;
      await humanActs(page, state);
    }
    assert.deepEqual(drifts, ["unexpected_screen"]);
    assert.equal((state.pause as { seen: { heading: string } }).seen.heading, "Encuesta de satisfacción");
    assert.ok(!driver.clicks.includes("Omitir"), "didn't click through the unknown screen");
    await page.context().close();
  });
});
