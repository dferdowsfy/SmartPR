/**
 * Teach-mode end to end in a real browser: serve a 5-screen fixture portal,
 * inject the recorder exactly as the worker does, walk the filing typing
 * real values, run the events through sanitization → teach session →
 * mapping answers → skill, and prove the skill validates and contains none
 * of the typed values.
 *
 *   npx tsx --test src/lib/agency-runs/teach/recorder.e2e.test.ts
 *
 * Skipped when Chromium can't launch. Set CHROMIUM_PATH to use a specific
 * Chromium build (same convention as tests/*.e2e.mts).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { RECORDER_SCRIPT } from "./recorderScript";
import { passportScrubValues, sanitizeTeachEvent, type TeachEvent } from "./events";
import { answerQuestion, applyTeachEvent, markStepConditional, newTeachState, openQuestions, type TeachState } from "./teachSession";
import { buildSkillFromTeach } from "./buildSkill";
import { validateSkill } from "../skills/skillValidate";

const HTML = readFileSync(join(__dirname, "fixtures", "portal5.html"), "utf8");
const PASSPORT = {
  business: { legalName: "Panadería La Esquina LLC" },
  contact: { fullName: "Marisol Rivera", email: "marisol@laesquina.pr", phone: "787-555-0142" },
  addresses: { municipality: "Bayamón" },
  operations: { employeeCount: 12 },
};
/** Everything typed during the demonstration — none may reach the skill. */
const TYPED = ["marisol.r", "S3cr3t!Clave", "Panadería La Esquina LLC", "787-555-0142", "marisol@laesquina.pr", "Proyecto Pan Caliente 77", "12"];

let server: Server;
let base = "";
let browser: Browser | null = null;
let launchError: string | null = null;

before(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  } catch (err) {
    launchError = (err as Error).message.split("\n")[0];
  }
});

after(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

async function demonstrate(): Promise<unknown[]> {
  const context = await browser!.newContext();
  const raw: unknown[] = [];
  await context.exposeBinding("__claraRecord", (_src, json: string) => {
    raw.push(JSON.parse(json));
  });
  await context.addInitScript(RECORDER_SCRIPT);
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.waitForTimeout(400);

  await page.fill("#user", "marisol.r");
  await page.fill("#pass", "S3cr3t!Clave");
  await page.click("#go");
  await page.waitForTimeout(400);

  await page.fill("#legal", "Panadería La Esquina LLC");
  await page.fill("#tel", "787-555-0142");
  await page.fill("#email", "marisol@laesquina.pr");
  await page.click("#muni");
  await page.click("#muni-2");
  await page.selectOption("#tipo", "pu");
  await page.fill("#proj", "Proyecto Pan Caliente 77");
  await page.click("#next1");
  await page.waitForTimeout(400);

  await page.check("#r2");
  await page.check("#r1");
  await page.click("#next2");
  await page.waitForTimeout(400);

  await page.fill("#emp", "12");
  await page.click("#next3");
  await page.waitForTimeout(400);

  await page.check("#cert");
  await page.click("#radicar");
  await page.waitForTimeout(200);
  await context.close();
  return raw;
}

describe("teach mode in a real browser", () => {
  it("records a 5-screen filing into a valid skill with zero entered values", async (t) => {
    if (!browser) return t.skip(`chromium unavailable: ${launchError}`);
    const raw = await demonstrate();

    // The recorder itself never sends values.
    const rawJson = JSON.stringify(raw);
    for (const typed of ["marisol.r", "S3cr3t!Clave", "Proyecto Pan Caliente 77"]) {
      assert.ok(!rawJson.includes(typed), `recorder leaked "${typed}"`);
    }

    const secrets = passportScrubValues(PASSPORT);
    const events = raw.map((r) => sanitizeTeachEvent(r, secrets)).filter((e): e is TeachEvent => e !== null);
    let s: TeachState = newTeachState({ id: "e2e", ownerUserId: "u1", tier: "user", portalName: "Portal de Permisos", form: "Permiso de Uso", startUrl: "https://permisos.ejemplo.pr.gov/" });
    for (const e of events) s = applyTeachEvent(s, e);

    assert.deepEqual(
      s.steps.map((x) => [x.heading, x.gate]),
      [
        ["Iniciar sesión", "login"],
        ["Datos del negocio", null],
        ["¿A nombre de quién sale el permiso?", null],
        ["Empleados", null],
        ["Revisión", "submit"],
      ]
    );

    s = markStepConditional(s, s.steps[3].id);
    const proposals: Record<string, string | null> = {};
    for (const q of openQuestions(s)) {
      if (q.kind === "mapping") {
        proposals[q.label] = q.proposal?.path ?? null;
        if (q.label === "Tipo de solicitud") s = answerQuestion(s, q.id, { kind: "mapping", choice: "always" });
        else if (q.proposal) s = answerQuestion(s, q.id, { kind: "mapping", choice: "confirm" });
        else s = answerQuestion(s, q.id, { kind: "mapping", choice: "ask" });
      } else if (q.kind === "branch") {
        s = answerQuestion(s, q.id, { kind: "branch", path: "operations.employeeCount" });
      } else {
        s = answerQuestion(s, q.id, { kind: "yes_no", value: "yes" });
      }
    }
    assert.equal(proposals["Nombre legal"], "business.legalName");
    assert.equal(proposals["Teléfono"], "contact.phone");
    assert.equal(proposals["Correo electrónico"], "contact.email");
    assert.equal(proposals["Municipio"], "addresses.municipality");
    assert.equal(proposals["Cantidad de empleados"], "operations.employeeCount");
    assert.equal(proposals["Nombre del proyecto"], null);

    const { skill, blockers, errors } = buildSkillFromTeach(s);
    assert.deepEqual(blockers, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(validateSkill(skill), []);

    const json = JSON.stringify(skill);
    for (const typed of TYPED) {
      assert.ok(!json.includes(`"${typed}"`) && !json.includes(typed.length > 3 ? typed : "\u0000"), `skill contains typed value "${typed}"`);
    }
    // Structure that SHOULD be there.
    assert.match(json, /Always choose 'Usted'/);
    assert.match(json, /Always choose 'Permiso de Uso'/);
    assert.equal(skill.steps.at(-1)?.gate, "submit");
    assert.equal(skill.steps.find((x) => x.gate === "login")?.fields.length, 0);
  });
});
