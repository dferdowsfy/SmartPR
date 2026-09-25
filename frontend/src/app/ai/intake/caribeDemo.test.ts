/**
 * Demo regression: an existing business expanding into a new leased
 * warehouse. Proves, end to end and without any demo-specific code:
 * semantic understanding → Passport reuse → graph-driven questions →
 * requirement generation → document mapping → Clara filing handoff.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KB, computeRequirementsFromKB, discoveryQuestionsForBusinessType, INTAKE_INDUSTRIES } from "../../kb.ts";
import type { KnowledgeBase } from "../../rulesEngine.ts";
import { interpretScenario } from "./scenario/interpret.ts";
import { combineScenario, normalizeScenario } from "./scenario/normalize.ts";
import { applyScenarioAnswer, evaluateScenario } from "./scenario/graph.ts";
import { identityFieldsKnown, isNewPremises, mergePassportIntoScenario, passportDeltas, type PassportSnapshot } from "./scenario/passport.ts";
import { scenarioToProjectContext } from "./scenario/adapter.ts";
import { businessTypeFromScenario, locationTypeFromScenario, planIntake, scenarioStatedAnswers } from "./infoNeeds.ts";
import { matchBusinessByName } from "./linkBusiness.ts";
import { kbQuestionIdFor } from "./questionKeyMap.ts";
import { resolveIntakeFacts } from "./relationships.ts";
import { claraSupportFor, groupRequirements } from "../../components/filing/requirementGroups.ts";
import { planClaraHandoff, CLARA_HANDOFF_INTRO_EN } from "../../businesses/[id]/agency-run/claraHandoff.ts";
import { projectFilingFacts, withProjectFacts } from "../../../lib/agency-runs/filingFacts.ts";
import { prefillFromPassport } from "../../../lib/agency-runs/prefillFromPassport.ts";
import type { FilingGroup } from "../../../lib/agency-runs/agencyActions.ts";
import type { AgencyPendingField } from "../../../lib/agency-runs/types.ts";

const kb = KB as unknown as KnowledgeBase;

const NARRATIVE =
  "An existing Puerto Rico business, Caribe Precision Manufacturing, LLC, is expanding into a leased 12,000-square-foot warehouse and office facility in Guaynabo. The company is an LLC in the manufacturing industry, specifically a furniture manufacturing business, with approximately 28 employees. This will be a leased commercial/industrial warehouse location used for furniture manufacturing, warehousing, and administrative offices. The existing building is currently configured as warehouse and office space. The company plans to renovate the interior, including interior demolition, office build-out, electrical work, plumbing work, and layout modifications. No expansion of the building footprint is currently planned. The business wants to determine all permits, land-use approvals, construction permits, operating permits, municipal requirements, fire or safety reviews, and supporting documentation needed to renovate and operate at this location. Identify anything that still depends on facts we have not provided and ask only the next questions that materially affect the permitting path.";

/** The account's Business Passports (a second, unrelated business included). */
const ACCOUNT = [
  { public_id: "cpm01", name: "Caribe Precision", legal_name: "Caribe Precision Manufacturing LLC", municipality: "Bayamón" },
  { public_id: "hv02", name: "Hotel Vista", legal_name: "Hotel Vista Inc.", municipality: "San Juan" },
];
const PASSPORT: PassportSnapshot = {
  businessId: "cpm01",
  name: "Caribe Precision Manufacturing LLC",
  entityType: "llc",
  businessType: "Furniture Manufacturing",
  industry: "Manufacturing",
  municipality: "Bayamón",
  address: "Carr. 2 km 10, Bayamón",
  hasEin: true,
  hasMerchantRegistration: true,
  hasContact: true,
};
const LOCATIONS = ["Industrial Facility"];

const read = interpretScenario(NARRATIVE);
const v = <T,>(f: { value: T } | undefined) => f?.value;

describe("1. semantic understanding", () => {
  it("extracts every stated business fact", () => {
    assert.equal(v(read.business.status), "existing");
    assert.equal(v(read.business.name), "Caribe Precision Manufacturing LLC");
    assert.equal(v(read.business.entityType), "llc");
    assert.equal(v(read.business.industry), "Manufacturing");
    assert.equal(businessTypeFromScenario(read, kb), "Furniture Manufacturing");
    assert.equal(v(read.operations.employees), 28);
  });

  it("extracts every stated project fact", () => {
    const p = read.property;
    const pr = read.project;
    assert.equal(v(p.municipality), "Guaynabo");
    assert.equal(v(p.ownershipStatus), "leased");
    assert.equal(locationTypeFromScenario(read, LOCATIONS), "Industrial Facility");
    assert.equal(v(p.existingUse), "warehouse_and_office");
    assert.equal(v(p.proposedUse), "manufacturing_and_warehouse_and_office");
    assert.equal(v(p.squareFeet), 12000);
    assert.equal(v(p.existingBuilding), true);
    assert.equal(v(pr.renovation), true);
    assert.equal(v(pr.demolition), "interior");
    assert.equal(v(pr.officeBuildout), true);
    assert.equal(v(pr.electricalWork), true);
    assert.equal(v(pr.plumbingWork), true);
    assert.equal(v(pr.layoutChanges), true);
    assert.equal(v(pr.footprintChange), false);
  });

  it("does not infer what was not said", () => {
    assert.equal(read.property.authorizedUse, undefined);
    assert.equal(read.project.possibleChangeOfUse, undefined);
    assert.equal(read.property.address, undefined);
    assert.equal(read.property.parcel, undefined);
    assert.equal(read.project.structuralWork, undefined);
    assert.equal(read.project.exteriorWork, undefined);
    for (const k of ["generator", "emissionsEquipment", "hazardousMaterials", "wastewaterDischarge", "fuelStorage"] as const) {
      assert.equal(read.operations[k], undefined, k);
    }
  });

  it("checks the model's reading: free-text uses are canonical, an inferred change of use is dropped", () => {
    const model = normalizeScenario(
      {
        property: { existingUse: { value: "warehouse and office space", source: "explicit", confidence: 0.99, evidenceText: "configured as warehouse and office space" } },
        project: { possibleChangeOfUse: { value: false, source: "inferred", confidence: 0.7, evidenceText: "configured as warehouse and office space" } },
      },
      NARRATIVE
    );
    assert.equal(v(model.scenario.property.existingUse), "warehouse_and_office");
    assert.equal(model.scenario.project.possibleChangeOfUse, undefined);
    assert.equal(combineScenario(read, model.scenario).project.possibleChangeOfUse, undefined);
  });
});

describe("2. Business Passport resolution", () => {
  it("links the one Passport the narrative names; project and registered locations stay separate", () => {
    assert.equal(matchBusinessByName(ACCOUNT, v(read.business.name))?.public_id, "cpm01");
    const merged = mergePassportIntoScenario(read, PASSPORT);
    assert.equal(v(merged.property.municipality), "Guaynabo", "the project location is not replaced by the registered one");
    const delta = passportDeltas(merged, PASSPORT).find((d) => d.kind === "new_location");
    assert.ok(delta && /Registered business location: Bayamón/.test(delta.message) && !/conflict/i.test(delta.message));
    assert.equal(isNewPremises(merged, PASSPORT), true);
  });
});

describe("3. nothing known is asked again", () => {
  it("every generic field is resolved by the Passport or the narrative", () => {
    const known = identityFieldsKnown(PASSPORT);
    known.delete("municipality");
    const plan = planIntake({
      intent: "existing_business",
      profile: { name: PASSPORT.name, business_type: "Furniture Manufacturing", industry: "Manufacturing", business_structure: "llc", municipality: "Guaynabo", location_type: "Industrial Facility", number_of_employees: 28 },
      passportKnown: known,
      descriptionKnown: new Set(["municipality", "location_type", "number_of_employees"]),
    });
    assert.equal(plan.ready, true);
    assert.deepEqual(plan.fields.filter((f) => f.show).map((f) => f.key), [], "no generic field is shown");
    const answers = scenarioStatedAnswers(read);
    assert.equal(answers.existing_lease, true);
    assert.equal(answers.employees_hired, true);
    assert.equal(answers.renovations, true);
    assert.equal(answers.products_manufactured, true);
  });
});

describe("4. only controlling facts are asked, one at a time", () => {
  it("authorized use → location → structural/exterior → done", () => {
    let ctx = mergePassportIntoScenario(read, PASSPORT);
    let ev = evaluateScenario(ctx, kb, { passport: PASSPORT });
    assert.equal(ev.questions[0]?.id, "sq_authorized_use");
    assert.deepEqual(ev.questions[0]?.options?.map((o) => o.label), ["Warehouse and office", "Another authorized use", "Not sure"]);

    ctx = applyScenarioAnswer(ctx, "sq_authorized_use", "warehouse_and_office");
    assert.equal(ctx.project.possibleChangeOfUse?.value, true, "manufacturing is outside the authorized warehouse/office use");
    ev = evaluateScenario(ctx, kb, { passport: PASSPORT });
    assert.equal(ev.questions[0]?.id, "sq_location");
    assert.ok(!ev.questions.some((q) => q.id === "sq_change_of_use"), "the graph compares uses itself");

    ctx = applyScenarioAnswer(ctx, "sq_location", "Carr. 20 km 3.2, Guaynabo");
    ev = evaluateScenario(ctx, kb, { passport: PASSPORT });
    assert.equal(ev.questions[0]?.id, "sq_structural_exterior");

    ctx = applyScenarioAnswer(ctx, "sq_structural_exterior", "neither");
    ev = evaluateScenario(ctx, kb, { passport: PASSPORT });
    assert.equal(ev.questions.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

const profile = { name: PASSPORT.name, municipality: "Guaynabo", industry: "Manufacturing", business_type: "Furniture Manufacturing", location_type: "Industrial Facility", business_structure: "llc", number_of_employees: 28 };
const answers: Record<string, unknown> = { ...scenarioStatedAnswers(read) };
const deferred = (discoveryQuestionsForBusinessType("Furniture Manufacturing") ?? [])
  .filter((q) => answers[q.id] == null)
  .map((q) => ({ questionId: kbQuestionIdFor(q.id, KB.questions), writeKey: q.id }));
const requirementsFor = (registeredMunicipality: string) =>
  computeRequirementsFromKB(profile as never, answers, resolveIntakeFacts({ profile, answers }, { kb, allowedIndustries: INTAKE_INDUSTRIES }).questionValues, {
    entityType: "limited_liability_company",
    projectIntent: "existing_business",
    projectContext: scenarioToProjectContext(read),
    deferredQuestions: deferred,
    newPremises: { registeredMunicipality },
  });
const reqs = requirementsFor("Bayamón");
const byDoc = new Map(reqs.map((r) => [r.document_id, r]));
const groups = groupRequirements(
  reqs.map((r) => ({ documentId: r.document_id, applicability: r.applicability, stage: r.stage, done: false, awaitingAnswer: !!r.unansweredTriggerQuestionId })),
  KB.documents as never
);
const groupOf = (doc: string) => groups[reqs.findIndex((r) => r.document_id === doc)];

describe("5. the full regulatory path", () => {
  it("construction, use/operation, municipal and fire are real filings at the new premises", () => {
    assert.equal(byDoc.get("DOC_OGPE_CONSTRUCTION_PERMIT")?.applicability, "required");
    assert.equal(byDoc.get("DOC_PERMISO_UNICO")?.applicability, "required", "use + operation permit for the new premises");
    assert.equal(byDoc.get("DOC_FIRE_CERT")?.applicability, "required");
    assert.equal(byDoc.get("DOC_PATENTE_MUNICIPAL")?.applicability, "required", "a new municipality needs its own patente");
  });

  it("business-wide registrations are verified, not refiled; the lease is supporting evidence", () => {
    for (const doc of ["DOC_EIN", "DOC_WORKERS_COMP", "DOC_DTRH_EMPLOYER_REG"]) assert.equal(byDoc.get(doc)?.applicability, "verify_existing", doc);
    assert.equal(byDoc.get("DOC_LEASE_AGREEMENT")?.applicability, "supporting_evidence");
  });

  it("deferred questions surface only where a Yes would add a requirement", () => {
    const sign = byDoc.get("DOC_SIGN_PERMIT");
    assert.equal(sign?.applicability, "needs_more_information");
    assert.equal(sign?.unansweredTriggerQuestionId, "Q_COMMERCIAL_SIGNAGE");
    assert.ok(!reqs.some((r) => r.unansweredTriggerQuestionId === "Q_HAZARDOUS_MATERIALS"), "hazmat adds no rule here — not asked");
  });

  it("no environmental permit is invented", () => {
    assert.ok(!reqs.some((r) => /AIR_|HAZMAT|NPDES|WASTEWATER|HAZARDOUS_WASTE/.test(r.document_id ?? "")));
  });

  it("the patente stays a verification when the project is in the registered municipality", () => {
    assert.equal(requirementsFor("Guaynabo").find((r) => r.document_id === "DOC_PATENTE_MUNICIPAL")?.applicability, "verify_existing");
  });

  it("holds under the intake's strict session provenance (what the browser runs)", () => {
    const strict = computeRequirementsFromKB(profile as never, answers, resolveIntakeFacts({ profile, answers }, { kb, allowedIndustries: INTAKE_INDUSTRIES }).questionValues, {
      entityType: "limited_liability_company",
      projectIntent: "existing_business",
      projectContext: scenarioToProjectContext(read),
      deferredQuestions: deferred,
      newPremises: { registeredMunicipality: "Bayamón" },
      sessionId: "intake-session",
      businessId: "cpm01",
      confirmedKeys: [...Object.keys(profile), ...Object.keys(answers)],
      passportKeys: ["name", "business_structure", "business_type", "industry"],
    });
    const at = (doc: string) => strict.find((r) => r.document_id === doc)?.applicability;
    assert.equal(at("DOC_PATENTE_MUNICIPAL"), "required", "a municipality the description names still reaches the municipality rules");
    assert.equal(at("DOC_MERCHANT_REGISTRATION"), "verify_existing");
    assert.equal(at("DOC_SIGN_PERMIT"), "needs_more_information", "the counterfactual Yes is not blocked by the provenance gate");
    assert.equal(at("DOC_PERMISO_UNICO"), "required");
  });

  it("groups the path with prerequisites from the knowledge graph", () => {
    assert.equal(groupOf("DOC_OGPE_CONSTRUCTION_PERMIT").group, "required_now");
    assert.equal(groupOf("DOC_FIRE_CERT").group, "required_now");
    assert.deepEqual(groupOf("DOC_PERMISO_UNICO").waitingOn, ["DOC_OGPE_CONSTRUCTION_PERMIT"]);
    assert.equal(groupOf("DOC_PERMISO_UNICO").group, "prerequisites");
    assert.deepEqual(groupOf("DOC_PATENTE_MUNICIPAL").waitingOn, ["DOC_PERMISO_UNICO"]);
    assert.equal(groupOf("DOC_SIGN_PERMIT").group, "conditional");
    assert.equal(groupOf("DOC_LEASE_AGREEMENT").group, "supporting");
    assert.equal(groupOf("DOC_EIN").group, "registrations");
  });
});

describe("6. Clara filing handoff", () => {
  it("Permiso Único is filed with Clara; unsupported filings get instructions", () => {
    assert.equal(claraSupportFor("DOC_PERMISO_UNICO").support, "file");
    assert.equal(claraSupportFor("DOC_PERMISO_UNICO").config?.startUrl, "https://sbp.ogpe.pr.gov/");
    assert.equal(claraSupportFor("DOC_OGPE_CONSTRUCTION_PERMIT").support, "instructions");
    assert.equal(claraSupportFor("DOC_MERCHANT_REGISTRATION").support, "prepare");
  });

  it("the handoff opens the selected filing's pre-flight — never starts a run by itself", () => {
    const groupsFixture = [
      {
        agency_id: "OGPE", agency_name_en: "OGPe", agency_name_es: "OGPe",
        filings: [{
          id: "OGPE_PERMISO_UNICO", obligation_id: "ob1", requirement_id: "DOC_PERMISO_UNICO", obligation_name: "Permiso Único",
          obligation_status: "pending", filing_status: "missing_information", supported: true,
          title_en: "Permiso Único", title_es: "Permiso Único", agency_id: "OGPE", agency_en: "OGPe", agency_es: "OGPe",
          action: { id: "OGPE_PERMISO_UNICO", filing_type: "OGPE_PERMISO_UNICO", agency_id: "OGPE", title_en: "", title_es: "", agency_en: "", agency_es: "", status: "ready", known: 8, total: 10, missing_items: [], blocked_by: [], evidence_available: [] },
        }],
      },
    ] as unknown as FilingGroup[];
    const plan = planClaraHandoff(groupsFixture, "DOC_PERMISO_UNICO");
    assert.equal(plan.kind, "start");
    assert.ok(/only ask you for anything that's missing/.test(CLARA_HANDOFF_INTRO_EN));
    assert.equal(planClaraHandoff(groupsFixture, "DOC_UNKNOWN").kind, "missing");
  });

  it("Passport + project facts fill the form; only the gaps remain", () => {
    const answered = applyScenarioAnswer(read, "sq_location", "Carr. 20 km 3.2, Guaynabo");
    const facts = projectFilingFacts(scenarioToProjectContext(answered), answered);
    const passport = { business: { legalName: PASSPORT.name, entityType: "llc", ein: "66-7654321" }, _denormalized: { municipality: "Bayamón" } };
    const field = (id: string, label: string) => ({ id, label, type: "text", sensitive: false }) as AgencyPendingField;
    const out = prefillFromPassport(
      [field("legal_name", "Legal name"), field("entity_type", "Entity type"), field("property_address", "Property address"), field("square_footage", "Square footage"), field("municipality", "Municipality"), field("fiscal_year_end", "Fiscal year end")],
      withProjectFacts(passport, facts)
    );
    assert.equal(out.legal_name, PASSPORT.name);
    assert.equal(out.entity_type, "llc");
    assert.equal(out.property_address, "Carr. 20 km 3.2, Guaynabo");
    assert.equal(out.square_footage, "12000");
    assert.equal(out.municipality, "Bayamón", "registered location stays the Passport's");
    assert.equal(out.fiscal_year_end, undefined, "a genuinely missing field is left for the user");
  });
});
