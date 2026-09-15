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

test("SAM.gov worksheet covers all required registration fields", () => {
  const definition = getSampleApplication("sam_registration")!;
  const keys = definition.sections.flatMap((section) => section.fields.map((field) => field.key));
  for (const key of [
    "login_gov_email",      // Login.gov account
    "legal_name",           // legal name exactly as registered with IRS
    "physical_address",     // physical address
    "mailing_address",      // mailing address
    "ein",                  // EIN/TIN
    "entity_type",          // business structure/type
    "naics_codes",          // NAICS codes
    "registration_purpose", // federal contracts and/or grants/awards
    "bank_name", "routing_number", "account_number", // EFT banking details
    "poc_name", "poc_email", "poc_phone",            // points of contact
    "reps_certs_ack",       // FAR/DFARS representations and certifications
  ]) {
    assert.ok(keys.includes(key), `sam_registration worksheet missing field ${key}`);
  }
});

test("SAM.gov worksheet is framed as a preparation worksheet, not an official form", () => {
  for (const language of ["en", "es"] as const) {
    const definition = getSampleApplication("sam_registration", language)!;
    assert.match(definition.description, /sam\.gov/i, `sam.gov web-only notice missing (${language})`);
    assert.doesNotMatch(definition.title, /official/i, `worksheet must not be called official (${language})`);
    assert.ok(definition.filename.toLowerCase().includes("worksheet"), "worksheet PDF filename must say worksheet");
  }
});

test("SAM.gov worksheet pre-fills profile fields and localizes", () => {
  const definition = getSampleApplication("sam_registration")!;
  const prefilled = prefillSampleApplication(definition, {
    name: "Taller Caribe LLC",
    municipality: "Yabucoa",
    business_structure: "llc",
  });
  assert.equal(prefilled.legal_name, "Taller Caribe LLC");
  assert.equal(prefilled.entity_type, "llc");

  const spanish = getSampleApplication("sam_registration", "es")!;
  assert.notEqual(spanish.title, definition.title, "Spanish title should differ");
  assert.match(spanish.title, /SAM\.gov/i);
  assert.match(spanish.sections[0].title, /[a-záéíóúñ]/i);

  for (const language of ["en", "es"] as const) {
    const blob = generateSampleApplicationPdf(getSampleApplication("sam_registration", language)!, { legal_name: "Taller Caribe LLC" }, language);
    assert.ok(blob.size > 0, `SAM.gov worksheet PDF should not be empty (${language})`);
  }
});

test("Entity Administrator letter covers the required appointment statements", () => {
  const definition = getSampleApplication("sam_admin_letter")!;
  assert.equal(definition.layout, "letter");
  assert.equal(definition.kicker, "Supporting document");
  const keys = definition.sections.flatMap((section) => section.fields.map((field) => field.key));
  for (const key of [
    "entity_legal_name",      // entity legal name
    "uei",                    // UEI, if known (optional)
    "entity_physical_address",// entity physical address matching SAM.gov
    "admin_name", "admin_title", "admin_email", "admin_phone", // administrator name/title/email/phone
    "admin_preference",       // self-administration vs third-party agent
  ]) {
    assert.ok(keys.includes(key), `sam_admin_letter missing field ${key}`);
  }
  // The letter is a supporting document: only blank blocks are hand-completed.
  assert.match(definition.description, /letterhead/i);
  assert.match(definition.description, /notariz/i);
  assert.match(definition.description, /hand/i);
});

test("Entity Administrator letter PDF has blank signature and notary blocks", async () => {
  const { extractPdfText } = await import("./forms/artifacts/pdfReadback.ts");
  for (const language of ["en", "es"] as const) {
    const definition = getSampleApplication("sam_admin_letter", language)!;
    const blob = generateSampleApplicationPdf(definition, {
      entity_legal_name: "Taller Caribe LLC",
      uei: "K1L2M3N4P5Q6",
      entity_physical_address: "Carr. 901 Km 2.3, Yabucoa, PR 00767",
      admin_name: "María Pagán",
      admin_title: "Presidenta",
      admin_email: "maria@tallercaribe.com",
      admin_phone: "787-555-0100",
      admin_preference: "self_admin",
    }, language);
    assert.ok(blob.size > 0, `letter PDF should not be empty (${language})`);
    const text = await extractPdfText(new Uint8Array(await blob.arrayBuffer()));

    // Required appointment statements appear in the letter body.
    for (const expected of language === "es"
      ? ["Administrador de la Entidad", "SAM.gov", "coincidir exactamente", "Federal Service Desk"]
      : ["Entity Administrator", "SAM.gov", "match the SAM.gov entity registration exactly", "Federal Service Desk"]) {
      assert.ok(text.includes(expected), `letter PDF missing "${expected}" (${language})`);
    }

    // Signature and notary blocks are present but never pre-filled with data:
    // the admin's name/email must not appear after the signature block starts.
    const signatureStart = language === "es" ? "Firma" : "Signature";
    const tail = text.slice(text.indexOf(signatureStart));
    assert.ok(tail.includes(language === "es" ? "Notariz" : "Notarization"), `notary block missing (${language})`);
    assert.ok(!tail.includes("María Pagán"), `signature/notary blocks must stay blank (${language})`);
    assert.ok(!tail.includes("maria@tallercaribe.com"), `signature/notary blocks must stay blank (${language})`);
  }
});

test("DACO contractor supporting checklist covers bond and package attachments", () => {
  const definition = getSampleApplication("daco_contractor_checklist")!;
  assert.ok(definition, "daco_contractor_checklist definition missing");
  assert.equal(definition.kicker, "Supporting checklist");
  const keys = definition.sections.flatMap((section) => section.fields.map((field) => field.key));
  for (const key of [
    "legal_name",
    "activity_type",
    "application_type",
    "doc_bond",
    "doc_merchant_reg",
    "doc_consumer_declaration",
    "dacouc01_prepared",
  ]) {
    assert.ok(keys.includes(key), `daco_contractor_checklist missing field ${key}`);
  }
  assert.match(definition.description, /DACOUC01/i);
  assert.match(definition.description, /never present this checklist as an official/i);
  assert.ok(definition.filename.toLowerCase().includes("checklist"), "checklist PDF filename");
});

test("DACO contractor checklist pre-fills and localizes; PDF non-empty", () => {
  const definition = getSampleApplication("daco_contractor_checklist")!;
  const prefilled = prefillSampleApplication(definition, {
    name: "Reciclaje Textil del Este LLC",
    municipality: "Yabucoa",
  });
  assert.equal(prefilled.legal_name, "Reciclaje Textil del Este LLC");
  assert.equal(prefilled.municipality, "Yabucoa");

  const spanish = getSampleApplication("daco_contractor_checklist", "es")!;
  assert.notEqual(spanish.title, definition.title);
  assert.match(spanish.title, /DACO/i);

  for (const language of ["en", "es"] as const) {
    const blob = generateSampleApplicationPdf(
      getSampleApplication("daco_contractor_checklist", language)!,
      { legal_name: "Reciclaje Textil del Este LLC", activity_type: "constructor", application_type: "new" },
      language
    );
    assert.ok(blob.size > 0, `DACO checklist PDF should not be empty (${language})`);
  }
});

test("OGPe Permiso Único prep checklist is bilingual and covers locker-tagged evidence", () => {
  const definition = getSampleApplication("permiso_unico")!;
  assert.equal(definition.kicker, "Preparation checklist");
  assert.match(definition.description, /never present this checklist as an official/i);
  assert.match(definition.description, /ogpe\.pr\.gov/i);
  assert.ok(definition.filename.toLowerCase().includes("checklist"));
  const keys = definition.sections.flatMap((section) => section.fields.map((field) => field.key));
  for (const key of [
    "legal_name",
    "business_address",
    "proposed_use",
    "occupancy_description",
    "doc_lease",
    "doc_floor_plans",
    "doc_merchant_reg",
    "portal_ack",
  ]) {
    assert.ok(keys.includes(key), `permiso_unico missing field ${key}`);
  }
  const lease = definition.sections.flatMap((s) => s.fields).find((f) => f.key === "doc_lease")!;
  assert.match(lease.label, /DOC_LEASE_AGREEMENT/);

  const spanish = getSampleApplication("permiso_unico", "es")!;
  assert.notEqual(spanish.title, definition.title);
  assert.match(spanish.title, /OGPe|Permiso/i);
  assert.match(spanish.kicker!, /Lista/i);

  const prefilled = prefillSampleApplication(definition, {
    name: "Café Plaza LLC",
    municipality: "Bayamón",
    physical_address: "Calle Principal 12, Bayamón PR",
    contact_name: "Ana Ruiz",
    contact_email: "ana@cafeplaza.pr",
    contact_phone: "787-555-0100",
  });
  assert.equal(prefilled.legal_name, "Café Plaza LLC");
  assert.equal(prefilled.municipality, "Bayamón");
  assert.equal(prefilled.business_address, "Calle Principal 12, Bayamón PR");
  assert.equal(prefilled.applicant_name, "Ana Ruiz");

  for (const language of ["en", "es"] as const) {
    const blob = generateSampleApplicationPdf(
      getSampleApplication("permiso_unico", language)!,
      { legal_name: "Café Plaza LLC", proposed_use: "Restaurant", occupancy_description: "Ground floor" },
      language
    );
    assert.ok(blob.size > 0, `OGPe prep checklist PDF should not be empty (${language})`);
  }
});

test("Salud sanitary prep checklist gates on Salud docs and localizes", () => {
  const definition = getSampleApplication("health_permit")!;
  assert.equal(definition.kicker, "Preparation checklist");
  assert.match(definition.description, /DOC_HEALTH_PERMIT/);
  assert.match(definition.description, /never present this checklist as an official/i);
  const keys = definition.sections.flatMap((section) => section.fields.map((field) => field.key));
  for (const key of [
    "legal_name",
    "operation_type",
    "manager_certified",
    "doc_cfpm",
    "doc_floor_plans",
    "portal_ack",
  ]) {
    assert.ok(keys.includes(key), `health_permit missing field ${key}`);
  }
  const spanish = getSampleApplication("health_permit", "es")!;
  assert.notEqual(spanish.title, definition.title);
  assert.match(spanish.title, /Salud/i);

  const prefilled = prefillSampleApplication(definition, {
    name: "Panadería Sol LLC",
    municipality: "Ponce",
    physical_address: "Calle Marina 5, Ponce PR",
    phone: "787-555-0200",
    email: "hola@panaderiasol.pr",
  });
  assert.equal(prefilled.legal_name, "Panadería Sol LLC");
  assert.equal(prefilled.physical_address, "Calle Marina 5, Ponce PR");

  for (const language of ["en", "es"] as const) {
    const blob = generateSampleApplicationPdf(
      getSampleApplication("health_permit", language)!,
      { legal_name: "Panadería Sol LLC", hours: "6am-6pm", food_handlers: "3" },
      language
    );
    assert.ok(blob.size > 0, `Salud prep checklist PDF should not be empty (${language})`);
  }
});

test("Bomberos fire-safety prep checklist covers inspection readiness and DOC_FIRE_CERT", () => {
  const definition = getSampleApplication("fire_certification")!;
  assert.equal(definition.kicker, "Preparation checklist");
  assert.match(definition.description, /DOC_FIRE_CERT|Bomberos/i);
  assert.match(definition.description, /never present this checklist as an official/i);
  assert.ok(definition.filename.toLowerCase().includes("checklist"));
  const keys = definition.sections.flatMap((section) => section.fields.map((field) => field.key));
  for (const key of [
    "legal_name",
    "occupancy_use",
    "extinguishers",
    "sprinklers",
    "doc_floor_plans",
    "inspection_ready",
    "portal_ack",
  ]) {
    assert.ok(keys.includes(key), `fire_certification missing field ${key}`);
  }
  const spanish = getSampleApplication("fire_certification", "es")!;
  assert.notEqual(spanish.title, definition.title);
  assert.match(spanish.title, /Bomberos/i);

  const prefilled = prefillSampleApplication(definition, {
    name: "Retail Norte LLC",
    municipality: "Carolina",
    physical_address: "Ave. 65 Infantería, Carolina PR",
    contact_name: "Luis Méndez",
    contact_phone: "787-555-0300",
    contact_email: "luis@retailnorte.pr",
  });
  assert.equal(prefilled.legal_name, "Retail Norte LLC");
  assert.equal(prefilled.contact_name, "Luis Méndez");

  for (const language of ["en", "es"] as const) {
    const blob = generateSampleApplicationPdf(
      getSampleApplication("fire_certification", language)!,
      { legal_name: "Retail Norte LLC", square_footage: "1800", occupancy_use: "retail" },
      language
    );
    assert.ok(blob.size > 0, `Bomberos prep checklist PDF should not be empty (${language})`);
  }
});
