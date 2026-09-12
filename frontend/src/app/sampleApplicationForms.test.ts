import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSampleApplicationPdf,
  getSampleApplication,
  missingRequiredSampleFields,
  prefillSampleApplication,
} from "./sampleApplicationForms.ts";

test("requested requirements have sample application definitions", () => {
  for (const code of ["certificate_of_incorporation", "merchant_registration", "permiso_unico", "health_permit", "fire_certification", "alcohol_permit", "workers_comp"]) {
    assert.ok(getSampleApplication(code), `missing sample form for ${code}`);
  }
});

test("sample applications prefill known profile fields", () => {
  const definition = getSampleApplication("merchant_registration")!;
  const data = prefillSampleApplication(definition, {
    name: "ACME LLC",
    municipality: "San Juan",
    business_structure: "llc",
    number_of_employees: 4,
  });

  assert.equal(data.legal_name, "ACME LLC");
  assert.equal(data.municipality, "San Juan");
  assert.equal(data.entity_type, "llc");
  assert.equal(data.employee_count, "4");
});

test("new worksheets prefill profile fields and generate PDFs", () => {
  const health = getSampleApplication("health_permit")!;
  const prefilled = prefillSampleApplication(health, {
    name: "Café Luna LLC",
    municipality: "Ponce",
  });
  assert.equal(prefilled.legal_name, "Café Luna LLC");
  assert.equal(prefilled.municipality, "Ponce");

  const fire = getSampleApplication("fire_certification")!;
  assert.deepEqual(missingRequiredSampleFields(fire, {}).length > 0, true);

  for (const code of ["health_permit", "fire_certification", "alcohol_permit", "workers_comp"]) {
    const definition = getSampleApplication(code)!;
    assert.ok(definition.sections.length >= 2, `${code} should have at least two sections`);
    for (const section of definition.sections) {
      assert.ok(section.fields.length > 0, `${code}/${section.title} needs fields`);
    }
    const blob = generateSampleApplicationPdf(definition, {});
    assert.ok(blob.size > 0, `${code} PDF should not be empty`);
  }
});
test("required-field validation returns human-readable labels", () => {
  const definition = getSampleApplication("certificate_of_incorporation")!;
  const missing = missingRequiredSampleFields(definition, { legal_name: "ACME LLC" });

  assert.ok(missing.includes("Business purpose"));
  assert.ok(missing.includes("Registered agent name"));
  assert.ok(!missing.includes("Proposed legal entity name"));
});
