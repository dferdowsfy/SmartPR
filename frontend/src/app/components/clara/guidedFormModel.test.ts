// The guided in-platform form generated from a requirement's "What you'll need".
// Run: npx tsx --test src/app/components/clara/guidedFormModel.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { emptyDraft, guidedFormSections, guidedProgress, needIsDocument } from "./guidedFormModel.ts";

const RFP = {
  key: "PR_ENERGY_RFP",
  name: "Competitive procurement (RFP)",
  agency: "PREPA / LUMA",
  needs: [
    "Submit a proposal that meets the RFP requirements (technology, capacity, MTR compliance strategy)",
    "Show site ownership, lease or the ability to control the site",
    "Environmental permitting plan covering all potentially applicable permits",
    "Expected commercial operation date",
  ],
};

test("one field per 'What you'll need' item: documents get an attach, answers a text box", () => {
  const s = guidedFormSections(RFP, "en");
  const needs = s.find((x) => x.id === "needs")!;
  assert.equal(needs.fields.length, 4);
  assert.deepEqual(needs.fields.map((f) => f.kind), ["document", "document", "document", "textarea"]);
  assert.equal(needs.fields[0].label, RFP.needs[0]);
  assert.ok(s.some((x) => x.id === "project"), "energy / site agencies get the project + site section");
  assert.equal(needIsDocument("Copia de la escritura"), true);
  assert.equal(needIsDocument("Fecha estimada de operación"), false);
});

test("business details prefill from the Passport / intake; EIN only for tax/registration agencies (EN/ES)", () => {
  const prefill = { legalName: "Sol Guayama LLC", municipality: "Guayama", email: "ops@sol.pr" };
  const s = guidedFormSections(RFP, "es");
  assert.equal(s[0].title, "Datos del negocio");
  const d = emptyDraft(s, prefill);
  assert.equal(d.values.legal_name, "Sol Guayama LLC");
  assert.equal(d.values.municipality, "Guayama");
  assert.ok(!s[0].fields.some((f) => f.id === "ein"));
  const hacienda = guidedFormSections({ key: "DOC_MERCHANT_REGISTRATION", name: "Merchant Registration Certificate", agency: "Hacienda" }, "en");
  assert.ok(hacienda[0].fields.some((f) => f.id === "ein"));
  assert.ok(!hacienda.some((x) => x.id === "project"));
  // No needs list: a generic documents + answers pair, never an empty form.
  assert.equal(hacienda.find((x) => x.id === "needs")!.fields.length, 2);
});

test("progress counts required answers; a document counts when attached or marked 'I have it'", () => {
  const s = guidedFormSections(RFP, "en");
  const d = emptyDraft(s, { legalName: "X", address: "Calle 1", municipality: "Guayama", contactName: "Ana", email: "a@b.pr", projectDescription: "20 MW solar + BESS" });
  const p0 = guidedProgress(s, d);
  assert.ok(p0.total >= 10);
  const needs = s.find((x) => x.id === "needs")!.fields;
  const d2 = { ...d, have: { [needs[0].id]: true }, files: { [needs[1].id]: [{ name: "lease.pdf", size: 10 }] } };
  assert.equal(guidedProgress(s, d2).done, p0.done + 2);
});
