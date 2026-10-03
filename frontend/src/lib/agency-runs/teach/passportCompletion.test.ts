// Teach Clara → inline Business Passport completion.
// Run: npx tsx --test src/lib/agency-runs/teach/passportCompletion.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  additionalDetailPath,
  catalogEntry,
  catalogEntryApplies,
  passportHas,
  proposeMapping,
  setPassportPath,
} from "./passportCatalog";
import { maskedPreview, normalizeValue, writablePath, type PassportStore } from "../passportWrite";
import { fillFromPassportTeach, savePassportFieldTeach, startTeachSession, syncTeachSession, type TeachWorker, TeachSessionError } from "./teachSessions";
import { applyTeachEvent, newTeachState } from "./teachSession";
import { sanitizeTeachEvent } from "./events";
import type { Skill } from "../skills/skill";
import { advanceReplay, newReplayState } from "../replay/engine";
import { VirtualPortal } from "../replay/virtualPortal";

const PORTAL = "https://sa.www4.irs.gov/";
const SSN = "123-45-6789";

function memoryStore() {
  const passportWrites: { path: string; value: string }[] = [];
  const protectedValues = new Map<string, string>();
  const store: PassportStore & { passportWrites: typeof passportWrites; protectedValues: typeof protectedValues } = {
    passportWrites,
    protectedValues,
    async save({ path, value }) {
      if (catalogEntry(path)?.sensitive) {
        protectedValues.set(path, String(normalizeValue(path, value)));
      } else {
        passportWrites.push({ path, value });
      }
      return { preview: maskedPreview(path, normalizeValue(path, value)) };
    },
    async readProtected({ path }) {
      return protectedValues.get(path) ?? null;
    },
  };
  return store;
}

function pageWorker(inputFields: { label: string; selector: string; kind: string }[]) {
  const typed: { value: string; selector: string | null }[] = [];
  const events = [{ kind: "page", url: `${PORTAL}ein`, title: "EIN", heading: "Responsible party", inputFields }];
  const worker: TeachWorker & { typed: typeof typed } = {
    typed,
    async start() { return { sessionId: "w1", liveUrl: null }; },
    async events(_id, after) { return { items: events.slice(after).map((event, i) => ({ seq: after + i + 1, event, shot: false })), nextAfter: events.length, status: "running" }; },
    async stop() {},
    async secureFill(_id, input) { typed.push(input); return { ok: true }; },
  };
  return worker;
}

describe("Passport catalog for portal fields", () => {
  it("maps SSN / ITIN labels to the protected Passport detail", () => {
    for (const label of ["SSN or ITIN", "Número de Seguro Social", "Social Security Number"]) {
      const p = proposeMapping(label, "text");
      assert.equal(p?.path, "contact.taxId", label);
      assert.equal(p?.confidence, "high");
    }
    assert.equal(catalogEntry("contact.taxId")?.sensitive, true);
  });

  it("LLC member count applies only to LLCs", () => {
    const e = catalogEntry("business.llcMemberCount")!;
    assert.equal(catalogEntryApplies(e, { business: { entityType: "llc" } }), true);
    assert.equal(catalogEntryApplies(e, { business: { entityType: "corporation" } }), false);
  });

  it("new details get a stable path under business.additional; only catalog or additional paths are writable", () => {
    assert.equal(additionalDetailPath("Ciudadanía:*"), "business.additional.ciudadania");
    assert.ok(writablePath("business.additional.ciudadania"));
    assert.ok(writablePath("contact.firstName"));
    assert.ok(!writablePath("owner.ssnLastFour"));
    assert.ok(!writablePath("business.additional.Bad Path"));
  });

  it("protected details count as on file by their marker, never by a value", () => {
    assert.equal(passportHas({ contact: { taxIdOnFile: true, taxIdLast4: "6789" } }, "contact.taxId"), true);
    assert.equal(passportHas({ contact: { taxId: SSN } }, "contact.taxId"), false, "a raw value in passport_json is not how it's stored");
    const p = setPassportPath({} as Record<string, unknown>, "business.additional.ciudadania", "PR");
    assert.deepEqual(p, { business: { additional: { ciudadania: "PR" } } });
    assert.equal(maskedPreview("contact.taxId", normalizeValue("contact.taxId", SSN)), "•••-••-6789");
  });
});

describe("Teach Clara: complete missing Passport details in place", () => {
  const teacher = { userId: randomUUID(), isAdmin: false };
  const fields = [
    { label: "First name", selector: "#fn", kind: "text" },
    { label: "SSN or ITIN", selector: "#ssn", kind: "ssn" },
    { label: "Ciudadanía", selector: "#ci", kind: "text" },
    { label: "Password", selector: "#pw", kind: "password" },
  ];

  it("needed → saved to the Passport → ready; values never in the session view; scrubbed from recordings", async () => {
    const worker = pageWorker(fields);
    const store = memoryStore();
    let v = await startTeachSession({ worker }, { viewer: teacher, tier: "user", businessId: "biz-1", passport: { business: { legalName: "Caribe LLC" }, contact: {} }, startUrl: PORTAL, portalName: "IRS", form: "EIN" });
    v = await syncTeachSession({ worker }, teacher, v.id);
    const by = (view: typeof v) => Object.fromEntries(view.page_fields.map((f) => [f.selector, f.suggestion]));
    assert.equal(v.can_save_passport, true);
    assert.equal(by(v)["#fn"]?.status, "needed");
    assert.equal(by(v)["#ssn"]?.status, "needed");
    assert.equal(by(v)["#ci"]?.status, "new");
    assert.equal(by(v)["#pw"], null, "passwords are one-time, never Passport details");

    const saved = await savePassportFieldTeach({ passportStore: store }, teacher, v.id, { path: "contact.firstName", value: "  John " });
    assert.equal(saved.preview, "John");
    assert.deepEqual(store.passportWrites, [{ path: "contact.firstName", value: "  John " }]);
    assert.equal(by(saved.session)["#fn"]?.status, "ready");
    assert.ok(!JSON.stringify(saved.session).includes("John"), "the value is not in the session view");

    const s2 = await savePassportFieldTeach({ passportStore: store }, teacher, v.id, { path: "contact.taxId", value: SSN });
    assert.equal(s2.preview, "•••-••-6789");
    assert.equal(by(s2.session)["#ssn"]?.status, "ready");
    assert.equal(by(s2.session)["#ssn"]?.preview, "•••-••-6789");
    assert.ok(!JSON.stringify(s2.session).includes("123456789") && !JSON.stringify(s2.session).includes(SSN));
    assert.equal(store.passportWrites.length, 1, "the SSN went to the protected store, not passport_json");

    // Clara fills on the page: the protected value is read only now, and only goes to the worker.
    assert.deepEqual(await fillFromPassportTeach({ worker, passportStore: store }, teacher, v.id, "#ssn"), { ok: true, reason: null });
    assert.deepEqual(worker.typed.at(-1), { value: "123456789", selector: "#ssn" });
    assert.deepEqual(await fillFromPassportTeach({ worker, passportStore: store }, teacher, v.id, "#fn"), { ok: true, reason: null });
    assert.deepEqual(worker.typed.at(-1), { value: "John", selector: "#fn" });

    const extra = await savePassportFieldTeach({ passportStore: store }, teacher, v.id, { path: "business.additional.ciudadania", value: "Estados Unidos" });
    assert.equal(by(extra.session)["#ci"]?.status, "ready");
  });

  it("refuses unknown paths and sessions without a saved business", async () => {
    const worker = pageWorker(fields);
    const store = memoryStore();
    const a = await startTeachSession({ worker }, { viewer: teacher, tier: "user", businessId: "biz-2", passport: {}, startUrl: PORTAL, portalName: "IRS", form: "EIN" });
    await assert.rejects(savePassportFieldTeach({ passportStore: store }, teacher, a.id, { path: "owner.secret", value: "x" }), (e: unknown) => e instanceof TeachSessionError && e.code === "unknown_detail");
    const b = await startTeachSession({ worker }, { viewer: teacher, tier: "user", businessId: null, passport: null, startUrl: PORTAL, portalName: "IRS", form: "EIN" });
    assert.equal(b.can_save_passport, false);
    await assert.rejects(savePassportFieldTeach({ passportStore: store }, teacher, b.id, { path: "contact.firstName", value: "John" }), (e: unknown) => e instanceof TeachSessionError && e.code === "no_business");
  });
});

describe("routine learns the mapping, never the value", () => {
  it("an SSN typed while teaching becomes an identity step mapped to contact.taxId", () => {
    let st = newTeachState({ id: "t", ownerUserId: "u", tier: "user", portalName: "IRS", form: "EIN", startUrl: PORTAL });
    st = applyTeachEvent(st, sanitizeTeachEvent({ kind: "page", url: `${PORTAL}rp`, title: "t", heading: "Responsible party" })!);
    st = applyTeachEvent(st, sanitizeTeachEvent({ kind: "fill", url: `${PORTAL}rp`, role: "textbox", label: "SSN or ITIN", selector: "#ssn", inputType: "text", valueKind: "number", secretKind: "ssn", value: SSN })!);
    const step = st.steps.at(-1)!;
    assert.equal(step.gate, "identity");
    assert.deepEqual(step.fields.map((f) => [f.label, f.decision]), [["SSN or ITIN", { kind: "passport", path: "contact.taxId" }]]);
    assert.ok(!JSON.stringify(st).includes("6789"));
  });

  it("replay: Clara types the protected value at fill time when on file; otherwise the identity step pauses", async () => {
    const OGPE = JSON.parse(readFileSync(join(process.cwd(), "src/lib/agency-runs/skills/ogpe.permiso_unico.v1.json"), "utf8")) as Skill;
    const skill: Skill = JSON.parse(JSON.stringify(OGPE));
    skill.portal = { name: "IRS", base_url: PORTAL };
    skill.steps = [
      { id: "rp", label: { en: "Responsible party", es: "Parte responsable" }, page_match: { title_contains: "Responsible" }, gate: "identity", observed: true, fallback: "pause_and_ask", actions: [{ type: "click", target: { role: "button", label_contains: "Continue" }, fallback: "pause_and_ask" }], fields: [{ portal_field: { label: "SSN or ITIN", role: "textbox" }, passport_path: "contact.taxId", transform: null, required: true, fallback: "pause_and_ask" }] },
      { id: "review", label: { en: "Review", es: "Revisión" }, page_match: { title_contains: "Review" }, gate: "submit", observed: true, fallback: "pause_and_ask", actions: [], fields: [] },
    ];
    const run = async (protectedValue?: (p: string) => Promise<string | null>) => {
      const portal = new VirtualPortal(skill, new Set(["rp", "review"]));
      const state = await advanceReplay(newReplayState(skill), { skill, passport: { contact: { taxIdOnFile: true } }, driver: portal, protectedValue });
      return { state, portal };
    };
    const without = await run();
    assert.equal(without.state.pause?.kind, "gate");
    assert.equal(without.state.pause?.kind === "gate" ? without.state.pause.gate : null, "identity");
    const reads: string[] = [];
    const withIt = await run(async (p) => { reads.push(p); return "123456789"; });
    assert.deepEqual(reads, ["contact.taxId"]);
    assert.ok(withIt.portal.filledLabels().includes("SSN or ITIN"));
    assert.ok(!(withIt.state.pause?.kind === "gate" && withIt.state.pause.gate === "identity"), JSON.stringify(withIt.state.pause));
    assert.ok(!JSON.stringify(withIt.state).includes("123456789"), "the value is never kept in replay state");
  });
});
