import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAgencyId, resolveAgencyActions } from "./agencyActions";
import { getFilingConfig } from "./filingTypes";

const fullPassport = {
  business: {
    legalName: "Café Plaza LLC",
    tradeName: "Café Plaza",
    email: "hola@cafeplaza.pr",
    phone: "787-555-0100",
    ein: "66-1234567",
    registryNumber: "12345",
    entityType: "limited_liability_company",
  },
  contact: {
    fullName: "Ana Rivera",
    email: "ana@cafeplaza.pr",
    phone: "787-555-0199",
  },
  addresses: {
    principalPhysical: {
      line1: "123 Calle Principal",
      line2: "Ste 2",
      cityOrMunicipality: "San Juan",
      state: "PR",
      postalCode: "00901",
    },
  },
  _denormalized: {
    legal_name: "Café Plaza LLC",
    name: "Café Plaza",
    entity_number: "12345",
    business_structure: "llc",
    municipality: "San Juan",
    physical_address: "123 Calle Principal, San Juan, PR 00901",
  },
};

const thinPassport = {
  business: { legalName: "Café Plaza LLC", tradeName: "Café Plaza" },
};

describe("resolveAgencyActions", () => {
  it("resolves HACIENDA_SURI actions with full-passport readiness", async () => {
    const actions = await resolveAgencyActions({
      business_id: "biz-1",
      agency_id: "HACIENDA_SURI",
      passport: fullPassport,
      priorRuns: [],
    });
    assert.equal(actions.length, 2);
    const register = actions.find((a) => a.filing_type === "SURI_REGISTER_TAXPAYER");
    assert.ok(register);
    assert.equal(register.status, "ready");
    assert.equal(register.agency_id, "HACIENDA_SURI");
    assert.equal(register.title_en, getFilingConfig("SURI_REGISTER_TAXPAYER").labelEn);
    assert.equal(register.known, register.total);
    assert.ok(register.total > 0);
    // Only the sensitive SSN need remains as a missing item.
    assert.equal(register.missing_items.length, 1);
    const ssn = register.missing_items[0];
    assert.equal(ssn.id, "ssn");
    assert.equal(ssn.sensitive, true);
    assert.ok(ssn.label_es.includes("Seguro Social"));
    // Evidence tags flow straight from the config.
    assert.deepEqual(register.evidence_available, [
      "DOC_PHOTO_ID",
      "DOC_UTILITY_BILL",
      "DOC_SSN_CARD",
    ]);
  });

  it("marks missing non-sensitive passport fields as non-sensitive missing items", async () => {
    const actions = await resolveAgencyActions({
      business_id: "biz-1",
      agency_id: "HACIENDA_SURI",
      passport: thinPassport,
      priorRuns: [],
    });
    const register = actions.find((a) => a.filing_type === "SURI_REGISTER_TAXPAYER");
    assert.ok(register);
    assert.ok(register.known < register.total);
    const phone = register.missing_items.find((m) => m.id === "contact.phone");
    assert.ok(phone, "expected contact.phone as a missing item");
    assert.equal(phone.sensitive, false);
    assert.ok(phone.label_es.length > 0);
  });

  it("marks a filing completed when a prior run reached review", async () => {
    const actions = await resolveAgencyActions({
      business_id: "biz-1",
      agency_id: "HACIENDA_SURI",
      passport: fullPassport,
      priorRuns: [{ filing_type: "SURI_REGISTER_TAXPAYER", status: "review" }],
    });
    const register = actions.find((a) => a.filing_type === "SURI_REGISTER_TAXPAYER");
    assert.ok(register);
    assert.equal(register.status, "completed");
  });

  it("keeps merchant registration not_required and notes its blocker", async () => {
    const actions = await resolveAgencyActions({
      business_id: "biz-1",
      agency_id: "HACIENDA_SURI",
      passport: fullPassport,
      priorRuns: [],
    });
    const merchant = actions.find(
      (a) => a.filing_type === "SURI_MERCHANT_REGISTRATION"
    );
    assert.ok(merchant);
    // requiresExistingAccount / disabled → not_required (not blocked).
    assert.equal(merchant.status, "not_required");
    assert.deepEqual(merchant.blocked_by, ["SURI_REGISTER_TAXPAYER"]);
  });

  it("merchant registration stays not_required even after taxpayer registration", async () => {
    const actions = await resolveAgencyActions({
      business_id: "biz-1",
      agency_id: "HACIENDA_SURI",
      passport: fullPassport,
      priorRuns: [{ filing_type: "SURI_REGISTER_TAXPAYER", status: "review" }],
    });
    const merchant = actions.find(
      (a) => a.filing_type === "SURI_MERCHANT_REGISTRATION"
    );
    assert.ok(merchant);
    assert.equal(merchant.status, "not_required");
    assert.deepEqual(merchant.blocked_by, []);
  });

  it("resolves DEPT_STATE and OGPE agencies independently", async () => {
    const ds = await resolveAgencyActions({
      business_id: "biz-1",
      agency_id: "DEPT_STATE",
      passport: fullPassport,
      priorRuns: [],
    });
    assert.equal(ds.length, 1);
    assert.equal(ds[0].filing_type, "DEPT_STATE_CORPORATE_FILING");
    assert.equal(ds[0].status, "ready");
    assert.equal(ds[0].agency_id, "DEPT_STATE");
    assert.ok(ds[0].agency_es.includes("Estado"));

    const ogpe = await resolveAgencyActions({
      business_id: "biz-1",
      agency_id: "OGPE",
      passport: fullPassport,
      priorRuns: [],
    });
    assert.equal(ogpe.length, 1);
    assert.equal(ogpe[0].filing_type, "OGPE_PERMISO_UNICO");
    assert.equal(ogpe[0].status, "ready");
    assert.ok(ogpe[0].agency_es.includes("Gerencia de Permisos"));
  });

  it("handles a null passport with zero known fields", async () => {
    const actions = await resolveAgencyActions({
      business_id: "biz-1",
      agency_id: "OGPE",
      passport: null,
      priorRuns: [],
    });
    const action = actions[0];
    assert.ok(action);
    assert.equal(action.known, 0);
    assert.ok(action.total > 0);
    assert.equal(action.status, "ready");
    assert.ok(
      action.missing_items.every((m) => m.sensitive === false),
      "no sensitive needs configured for OGPE"
    );
  });

  it("never leaks passport values into the action payload", async () => {
    const actions = await resolveAgencyActions({
      business_id: "biz-1",
      agency_id: "HACIENDA_SURI",
      passport: fullPassport,
      priorRuns: [],
    });
    const dumped = JSON.stringify(actions);
    assert.ok(!dumped.includes("66-1234567"), "EIN value leaked");
    assert.ok(!dumped.includes("787-555-0100"), "phone value leaked");
    assert.ok(!dumped.includes("Café Plaza"), "name value leaked");
    assert.ok(!dumped.includes("123 Calle Principal"), "address value leaked");
  });
});

describe("isAgencyId", () => {
  it("validates known agency ids", () => {
    assert.equal(isAgencyId("HACIENDA_SURI"), true);
    assert.equal(isAgencyId("DEPT_STATE"), true);
    assert.equal(isAgencyId("OGPE"), true);
    assert.equal(isAgencyId("IRS"), false);
    assert.equal(isAgencyId(""), false);
  });
});
