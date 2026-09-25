import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_OBLIGATION_ID,
  DEMO_REQUIREMENT_ID,
  isAgencyId,
  resolveAgencyActions,
  resolveFilingOptions,
  type FilingGroup,
  type ObligationLike,
} from "./agencyActions";
import type { AgencyFilingType } from "./types";
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
    // Legacy registry listing: one entry per Dept. of State variant.
    assert.deepEqual(
      ds.map((a) => a.filing_type).sort(),
      ["DEPT_STATE_ANNUAL_REPORT", "DEPT_STATE_CORPORATE_FILING", "DEPT_STATE_LLC_FORMATION"]
    );
    const corp = ds.find((a) => a.filing_type === "DEPT_STATE_CORPORATE_FILING")!;
    assert.equal(corp.status, "ready");
    assert.equal(corp.agency_id, "DEPT_STATE");
    assert.ok(corp.agency_es.includes("Estado"));

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

describe("Dept. of State corporation objective", () => {
  // One config = one variant. Passport formation signals no longer switch
  // the corporation filing into an annual report (or an LLC).
  for (const [label, passport] of [
    ["registry number present", fullPassport],
    ["not formed", { business: { legalName: "New Co", formationStatus: "not_formed" } }],
    ["no signals", thinPassport],
  ] as const) {
    it(`${label} → corporation formation objective only`, async () => {
      const actions = await resolveAgencyActions({
        business_id: "biz-1",
        agency_id: "DEPT_STATE",
        passport: passport as Record<string, unknown>,
        priorRuns: [],
      });
      const corp = actions.filter((a) => a.filing_type === "DEPT_STATE_CORPORATE_FILING");
      assert.equal(corp.length, 1);
      assert.ok(corp[0].objective_en?.includes("NEW corporation"));
      assert.ok(corp[0].objective_en?.includes("Do NOT form an LLC"));
      assert.ok(!/ANNUAL REPORT \(informe/.test(corp[0].objective_en ?? ""));
    });
  }
});

describe("resolveFilingOptions", () => {
  const obligations: ObligationLike[] = [
    { id: "obl-suri", name: "Register with SURI", requirement_id: "DOC_SURI_REGISTRATION", agency: "Hacienda / SURI", status: "MISSING" },
    { id: "obl-permiso", name: "Permiso Único", requirement_id: "DOC_PERMISO_UNICO", agency: "OGPe", status: "MISSING" },
    { id: "obl-ds", name: "Certificate of incorporation", requirement_id: "DOC_CERT_INCORPORATION", agency: "Department of State", status: "MISSING" },
    { id: "obl-merchant", name: "Merchant registration", requirement_id: "DOC_MERCHANT_REGISTRATION", agency: "Hacienda / SURI", status: "MISSING" },
    { id: "obl-unknown", name: "Mystery requirement", requirement_id: "DOC_DOES_NOT_EXIST", agency: "Hacienda / SURI", status: "MISSING" },
    { id: "obl-noname", name: "Name-only requirement", requirement_id: null, agency: "Hacienda / SURI", status: "MISSING" },
  ];
  const base = {
    business_id: "biz-1",
    passport: fullPassport,
    priorRuns: [] as { filing_type: AgencyFilingType; status: string }[],
  };
  const all = (groups: FilingGroup[]) => groups.flatMap((g) => g.filings);

  it("joins obligations to the filing registry by requirement_id", () => {
    const filings = all(resolveFilingOptions({ ...base, obligations }));
    const suri = filings.find((f) => f.obligation_id === "obl-suri");
    assert.ok(suri);
    assert.equal(suri.supported, true);
    assert.equal(suri.action?.filing_type, "SURI_REGISTER_TAXPAYER");
    assert.equal(suri.requirement_id, "DOC_SURI_REGISTRATION");
    assert.equal(suri.obligation_name, "Register with SURI");
    assert.equal(suri.filing_status, "ready_to_start");
    assert.equal(suri.action?.obligation_id, "obl-suri");
    assert.equal(suri.action?.requirement_id, "DOC_SURI_REGISTRATION");

    const permiso = filings.find((f) => f.obligation_id === "obl-permiso");
    assert.ok(permiso);
    assert.equal(permiso.action?.filing_type, "OGPE_PERMISO_UNICO");
    assert.equal(permiso.agency_id, "OGPE");
  });

  it("routes the corporation requirement to corporation formation — off by default", () => {
    const filings = all(resolveFilingOptions({ ...base, obligations, env: {} }));
    const ds = filings.find((f) => f.obligation_id === "obl-ds");
    assert.ok(ds);
    assert.equal(ds.action?.filing_type, "DEPT_STATE_CORPORATE_FILING");
    assert.equal(ds.title_en, "Dept. of State — Form a corporation");
    assert.ok(ds.action?.objective_en?.includes("NEW corporation"));
    // Launch switch off by default: visible, never startable.
    assert.equal(ds.filing_status, "not_available");
    assert.equal(ds.supported, false);
  });

  it("the corporation launch switch makes it startable", () => {
    const filings = all(
      resolveFilingOptions({ ...base, obligations, env: { MITA_FLOW_DEPT_STATE_CORPORATION: "on" } })
    );
    const ds = filings.find((f) => f.obligation_id === "obl-ds")!;
    assert.equal(ds.supported, true);
    assert.equal(ds.filing_status, "ready_to_start");
  });

  it("routes each rule-emitted Dept. of State requirement to its own variant", () => {
    const dosObligations: ObligationLike[] = [
      { id: "obl-llc", name: "Certificate of Organization", requirement_id: "DOC_CERT_ORGANIZATION", agency: "Department of State", status: "MISSING" },
      { id: "obl-articles", name: "Articles of Organization", requirement_id: "DOC_ARTICLES_ORGANIZATION", agency: "Department of State", status: "MISSING" },
      { id: "obl-annual", name: "Annual report", requirement_id: "DOC_ANNUAL_REPORT", agency: "Department of State", status: "MISSING" },
      { id: "obl-dba", name: "DBA", requirement_id: "DOC_DBA_REGISTRATION", agency: "Department of State", status: "MISSING" },
    ];
    // Even with every launch switch on, only real, enabled flows could start.
    const env = {
      MITA_FLOW_DEPT_STATE_CORPORATION: "on",
      MITA_FLOW_DEPT_STATE_LLC: "on",
      MITA_FLOW_DEPT_STATE_ANNUAL_REPORT: "on",
    };
    const filings = all(resolveFilingOptions({ ...base, obligations: dosObligations, env }));
    const byId = (id: string) => filings.find((f) => f.obligation_id === id)!;
    for (const id of ["obl-llc", "obl-articles"]) {
      assert.equal(byId(id).action?.filing_type, "DEPT_STATE_LLC_FORMATION", `${id} is an LLC filing`);
      assert.notEqual(byId(id).action?.filing_type, "DEPT_STATE_CORPORATE_FILING");
      assert.equal(byId(id).filing_status, "not_available");
      assert.equal(byId(id).supported, false);
      assert.equal(byId(id).agency_id, "DEPT_STATE", "visible under its agency");
    }
    assert.equal(byId("obl-annual").action?.filing_type, "DEPT_STATE_ANNUAL_REPORT");
    assert.equal(byId("obl-annual").filing_status, "not_available");
    // A trade name is not an entity formation.
    assert.equal(byId("obl-dba").action, null);
    assert.equal(byId("obl-dba").filing_status, "unsupported");
  });

  it("never matches by requirement name — unmapped ids surface as disabled", () => {
    const groups = resolveFilingOptions({ ...base, obligations });
    const filings = all(groups);
    for (const id of ["obl-unknown", "obl-noname"]) {
      const f = filings.find((x) => x.obligation_id === id);
      assert.ok(f, id);
      assert.equal(f.supported, false);
      assert.equal(f.action, null);
      assert.equal(f.filing_status, "unsupported");
    }
    // Disabled registry entries (merchant registration) stay visible under
    // their agency as "not available" — never a launchable card.
    const merchant = filings.find((x) => x.obligation_id === "obl-merchant");
    assert.ok(merchant);
    assert.equal(merchant.supported, false);
    assert.equal(merchant.filing_status, "not_available");
    assert.equal(merchant.agency_id, "HACIENDA_SURI");
    // Unsupported options trail in their own group — never mixed into an
    // agency's filings as a launchable card.
    const other = groups[groups.length - 1];
    assert.equal(other.agency_id, "OTHER");
    assert.ok(other.filings.every((f) => !f.supported));
  });

  it("marks submitted when the obligation completed or a run finished review", () => {
    const filings = all(
      resolveFilingOptions({
        ...base,
        priorRuns: [{ filing_type: "SURI_REGISTER_TAXPAYER", status: "review" }],
        obligations: [
          { id: "obl-done", name: "Register with SURI", requirement_id: "DOC_SURI_REGISTRATION", agency: "Hacienda / SURI", status: "COMPLETED" },
        ],
      })
    );
    assert.equal(filings.length, 1);
    assert.equal(filings[0].filing_status, "submitted");
  });

  it("marks in_progress for active runs and IN_PROGRESS obligations", () => {
    const filings = all(
      resolveFilingOptions({
        ...base,
        priorRuns: [{ filing_type: "OGPE_PERMISO_UNICO", status: "running" }],
        obligations: [
          { id: "obl-p", name: "Permiso Único", requirement_id: "DOC_PERMISO_UNICO", agency: "OGPe", status: "IN_PROGRESS" },
        ],
      })
    );
    assert.equal(filings.length, 1);
    assert.equal(filings[0].filing_status, "in_progress");
  });

  it("exposes the active run id on in-progress filings for Resume", () => {
    const filings = all(
      resolveFilingOptions({
        ...base,
        priorRuns: [{ filing_type: "OGPE_PERMISO_UNICO", status: "running", id: "run-123" }],
        obligations: [
          { id: "obl-p", name: "Permiso Único", requirement_id: "DOC_PERMISO_UNICO", agency: "OGPe", status: "MISSING" },
        ],
      })
    );
    assert.equal(filings.length, 1);
    assert.equal(filings[0].filing_status, "in_progress");
    assert.equal(filings[0].active_run_id, "run-123");
  });

  it("leaves active_run_id absent when in-progress comes from the obligation alone", () => {
    const filings = all(
      resolveFilingOptions({
        ...base,
        priorRuns: [],
        obligations: [
          { id: "obl-p", name: "Permiso Único", requirement_id: "DOC_PERMISO_UNICO", agency: "OGPe", status: "IN_PROGRESS" },
        ],
      })
    );
    assert.equal(filings.length, 1);
    assert.equal(filings[0].filing_status, "in_progress");
    assert.equal(filings[0].active_run_id, undefined);
  });

  it("flags missing SmartPR information instead of ready", () => {
    const filings = all(
      resolveFilingOptions({
        business_id: "biz-1",
        passport: thinPassport,
        priorRuns: [],
        obligations: [
          { id: "obl-suri", name: "Register with SURI", requirement_id: "DOC_SURI_REGISTRATION", agency: "Hacienda / SURI", status: "MISSING" },
        ],
      })
    );
    assert.equal(filings.length, 1);
    assert.equal(filings[0].filing_status, "missing_information");
  });

  it("routes the demo rehearsal portal through the same objective code path", () => {
    const groups = resolveFilingOptions({ ...base, obligations: [], includeDemo: true });
    const demo = groups.find((g) => g.agency_id === "DEMO_REHEARSAL");
    assert.ok(demo);
    assert.equal(demo.demo, true);
    assert.equal(demo.filings.length, 1);
    const filing = demo.filings[0];
    assert.equal(filing.obligation_id, DEMO_OBLIGATION_ID);
    assert.equal(filing.requirement_id, DEMO_REQUIREMENT_ID);
    assert.equal(filing.action?.filing_type, "DEMO_REHEARSAL_PORTAL");
    assert.equal(filing.supported, true);
  });

  it("never leaks passport values into filing options", () => {
    const groups = resolveFilingOptions({ ...base, obligations, includeDemo: true });
    const dumped = JSON.stringify(groups);
    assert.ok(!dumped.includes("66-1234567"), "EIN value leaked");
    assert.ok(!dumped.includes("787-555-0100"), "phone value leaked");
    assert.ok(!dumped.includes("Café Plaza"), "name value leaked");
    assert.ok(!dumped.includes("123 Calle Principal"), "address value leaked");
  });
});
