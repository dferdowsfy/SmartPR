/**
 * Real browser: an IRS-style "What type of legal structure is applying for
 * an EIN?" screen (radio group without a fieldset, a Continue button and a
 * Submit button). The recorder must report the question with its options;
 * Teach Clara must map it to the Passport's entity type, pick the matching
 * option from the Passport and press Continue — never Submit.
 *
 *   npx tsx --test src/lib/agency-runs/teach/irsChoice.e2e.test.ts
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";
import { RECORDER_SCRIPT } from "./recorderScript";
import { CHOOSE_TARGET_JS } from "./cloudBrowser";
import { fillPageFromPassportTeach, savePassportFieldTeach, startTeachSession, syncTeachSession, type TeachWorker } from "./teachSessions";
import type { PassportStore } from "../passportWrite";

const IRS = "https://sa.www4.irs.gov/modiein/";
const OPTIONS = ["Sole Proprietor", "Partnerships", "Corporations", "Limited Liability Company (LLC)", "Estate", "Trusts", "Indian Tribal Governments/Enterprises", "View Additional Types, Including Tax-Exempt and Governmental Organizations"];
const HTML = `<!doctype html><meta charset=utf-8><title>EIN Assistant</title>
<main>
  <h1 id="h">What type of legal structure is applying for an EIN?</h1>
  <p>If you still don't see your organization type, click on "View Additional Types".</p>
  <div class="q"><span class="lbl">Choose type of legal structure</span> <span class="req">*</span></div>
  <div class="opts">
    ${OPTIONS.map((o, i) => `<div class="opt"><input type="radio" name="entityType" id="et${i}" value="v${i}"><label for="et${i}">${o}</label><div class="help">Help text ${i}</div></div>`).join("")}
  </div>
  <button type="button" id="continueBtn" onclick="var c=document.querySelector('input[name=entityType]:checked'); document.getElementById('h').textContent = c ? 'Step 2: ' + document.querySelector('label[for='+c.id+']').textContent : 'Pick one';">Continue</button>
  <button type="button" id="submitBtn" onclick="document.title='SUBMITTED'">Submit</button>
</main>`;

let server: Server;
let base = "";
let browser: Browser | null = null;
let skip: string | null = null;
before(async () => {
  server = createServer((_q, r) => { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(HTML); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ein`;
  try {
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  } catch (e) {
    skip = (e as Error).message.split("\n")[0];
  }
});
after(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

async function openPage(): Promise<Page> {
  const page = await browser!.newPage();
  await page.addInitScript(RECORDER_SCRIPT);
  await page.goto(base);
  await page.waitForTimeout(600);
  return page;
}

/** A TeachWorker backed by the real page (what the worker / cloud browser do). */
function pageWorker(page: Page): TeachWorker & { clicked: string[] } {
  const clicked: string[] = [];
  return {
    clicked,
    async start() { return { sessionId: "w", liveUrl: null }; },
    async events(_id, after) {
      const evs = (await page.evaluate("window.__claraEvents")) as Record<string, unknown>[];
      const pages = evs.filter((e) => e.kind === "page").map((e) => ({ ...e, url: IRS }));
      return { items: pages.slice(after).map((event, i) => ({ seq: after + i + 1, event, shot: false })), nextAfter: pages.length, status: "running" };
    },
    async stop() {},
    async secureFill(_id, input) { await page.fill(input.selector!, input.value); return { ok: true }; },
    async choose(_id, input) {
      const r = (await page.evaluate(`(${CHOOSE_TARGET_JS})(${JSON.stringify(input)})`)) as { ok: boolean; reason?: string; done?: boolean };
      if (!r.ok) return r;
      if (!r.done) {
        clicked.push(input.selector);
        await page.locator('[data-clara-choose="1"]').first().click({ force: true });
        await page.locator('[data-clara-choose="1"]').first().evaluate((e) => e.removeAttribute("data-clara-choose")).catch(() => undefined);
      }
      return { ok: true };
    },
  };
}

describe("IRS legal-structure screen", () => {
  it("the recorder reports the radio question with its options and the Continue button", async (t) => {
    if (skip) return t.skip(skip);
    const page = await openPage();
    const ev = ((await page.evaluate("window.__claraEvents")) as Record<string, unknown>[]).filter((e) => e.kind === "page").at(-1) as { inputFields: { label: string; kind: string; options?: { label: string }[] }[] };
    const choice = ev.inputFields.find((f) => f.kind === "choice")!;
    assert.match(choice.label, /Choose type of legal structure/);
    assert.deepEqual(choice.options!.map((o) => o.label), OPTIONS);
    const next = ev.inputFields.find((f) => f.kind === "next")!;
    assert.equal(next.label, "Continue");
    assert.ok(!ev.inputFields.some((f) => /Submit/.test(f.label)), "a submit button is never offered as Continue");
    await page.close();
  });

  it("Passport has the entity type → Clara picks LLC and presses Continue (never Submit)", async (t) => {
    if (skip) return t.skip(skip);
    const page = await openPage();
    const worker = pageWorker(page);
    const viewer = { userId: randomUUID(), isAdmin: false };
    let v = await startTeachSession({ worker }, { viewer, tier: "user", businessId: "b", passport: { business: { legalName: "Enrique's LLC", entityType: "limited_liability_company" } }, startUrl: IRS, portalName: "IRS", form: "EIN" });
    v = await syncTeachSession({ worker }, viewer, v.id);
    const sug = v.page_fields.find((f) => f.kind === "choice")!.suggestion!;
    assert.equal(sug.path, "business.entityType");
    assert.equal(sug.status, "ready");
    assert.equal(sug.choice?.selected, "Limited Liability Company (LLC)");
    const out = await fillPageFromPassportTeach({ worker }, viewer, v.id, { continue: true });
    assert.deepEqual({ chosen: out.chosen, continued: out.continued, ok: out.ok }, { chosen: 1, continued: true, ok: true });
    assert.equal(await page.evaluate("document.querySelector('#et3').checked"), true);
    assert.equal(await page.textContent("#h"), "Step 2: Limited Liability Company (LLC)");
    assert.notEqual(await page.title(), "SUBMITTED");
    // The guard: a Submit button can't be pressed through this path.
    assert.deepEqual(await worker.choose!("w", { selector: "#submitBtn", option: null }), { ok: false, reason: "not_allowed" });
    await page.close();
  });

  it("Passport lacks it → 'needed'; picking LLC saves the canonical entity type, then fill + Continue", async (t) => {
    if (skip) return t.skip(skip);
    const page = await openPage();
    const worker = pageWorker(page);
    const viewer = { userId: randomUUID(), isAdmin: false };
    const saved: { path: string; value: string }[] = [];
    const store: PassportStore = { async save(i) { saved.push({ path: i.path, value: i.value }); return { preview: i.value }; }, async readProtected() { return null; } };
    let v = await startTeachSession({ worker }, { viewer, tier: "user", businessId: "b", passport: { business: { legalName: "Untitled business" } }, startUrl: IRS, portalName: "IRS", form: "EIN" });
    v = await syncTeachSession({ worker }, viewer, v.id);
    const field = v.page_fields.find((f) => f.kind === "choice")!;
    assert.equal(field.suggestion?.status, "needed");
    assert.deepEqual(field.suggestion?.choice?.options, OPTIONS);
    const before = await fillPageFromPassportTeach({ worker }, viewer, v.id, { continue: true });
    assert.deepEqual({ needed: before.needed, continued: before.continued }, { needed: 1, continued: false }, "never continues while something is missing");
    const r = await savePassportFieldTeach({ passportStore: store }, viewer, v.id, { path: "business.entityType", option: "Limited Liability Company (LLC)" });
    assert.deepEqual(saved, [{ path: "business.entityType", value: "limited_liability_company" }]);
    assert.equal(r.session.page_fields.find((f) => f.kind === "choice")!.suggestion?.status, "ready");
    const out = await fillPageFromPassportTeach({ worker }, viewer, v.id, { continue: true });
    assert.equal(out.continued, true);
    assert.equal(await page.textContent("#h"), "Step 2: Limited Liability Company (LLC)");
    await assert.rejects(savePassportFieldTeach({ passportStore: store }, viewer, v.id, { path: "business.entityType", option: "Estate" }), /doesn't track that structure/);
    await page.close();
  });
});
