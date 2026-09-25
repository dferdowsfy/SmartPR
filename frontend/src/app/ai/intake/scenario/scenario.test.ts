/**
 * Semantic intake regressions: the description is read as one scenario —
 * relationships between facts — not as a bag of keywords. Requirements stay
 * with the knowledge graph.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KB } from "../../../kb.ts";
import type { KnowledgeBase } from "../../../rulesEngine.ts";
import { interpretScenario } from "./interpret.ts";
import { combineScenario, normalizeScenario } from "./normalize.ts";
import { applyScenarioAnswer, evaluateScenario } from "./graph.ts";
import { describeScenario } from "./describe.ts";
import {
  identityFieldsKnown,
  mergePassportIntoScenario,
  passportDeltas,
  passportKnownItems,
  type PassportSnapshot,
} from "./passport.ts";
import { reconcileProjectContext, scenarioToProjectContext } from "./adapter.ts";
import { applyScenarioToInterpretation } from "./bridge.ts";
import { businessStatus, changeOfUseStatus, SCENARIO_PATHS, getFact, type ScenarioContext } from "./types.ts";
import type { ValidatedInterpretation } from "../validateInterpretation.ts";

const kb = KB as unknown as KnowledgeBase;
const GUAYNABO =
  "A client has leased an existing 12,000-square-foot warehouse and office facility in Guaynabo. They plan to renovate the interior for a new commercial operation, including interior demolition, electrical and plumbing work, office build-out, and modifications to the existing use.";

const v = <T>(f: { value: T } | undefined) => f?.value;
const docIds = (paths: { documentId: string }[]) => paths.map((p) => p.documentId).sort();

describe("the Guaynabo scenario is read relationally", () => {
  const c = interpretScenario(GUAYNABO);

  it("establishes the facts and how they relate", () => {
    assert.equal(v(c.property.municipality), "Guaynabo");
    assert.equal(v(c.property.existingBuilding), true);
    assert.equal(v(c.property.existingUse), "warehouse_and_office");
    assert.equal(v(c.property.squareFeet), 12000);
    assert.equal(v(c.property.ownershipStatus), "leased");
    assert.equal(v(c.project.renovation), true);
    assert.equal(v(c.project.demolition), "interior");
    assert.equal(v(c.project.electricalWork), true);
    assert.equal(v(c.project.plumbingWork), true);
    assert.equal(v(c.project.layoutChanges), true);
    assert.equal(v(c.property.proposedUse), "commercial_operation");
    assert.equal(v(c.property.proposedUseSpecificity), "insufficient");
  });

  it("keeps a possible change of use as an inference, never a confirmed fact", () => {
    assert.equal(v(c.project.possibleChangeOfUse), true);
    assert.equal(c.project.possibleChangeOfUse?.source, "inferred");
    assert.equal(changeOfUseStatus(c), "possible");
  });

  it('"a new commercial operation" does not make the business new', () => {
    assert.equal(businessStatus(c), "unknown");
  });

  it("every fact carries source, confidence and a verbatim evidence quote", () => {
    for (const path of SCENARIO_PATHS) {
      const f = getFact(c, path);
      if (!f) continue;
      assert.ok(["explicit", "inferred"].includes(f.source), path);
      assert.ok(f.confidence >= 0.6 && f.confidence <= 1, path);
      assert.ok(GUAYNABO.includes(f.evidenceText), `${path} evidence must be quoted: ${f.evidenceText}`);
    }
  });

  it('shows confirmed facts under "We understood" and uncertain ones apart', () => {
    const d = describeScenario(c);
    const understood = d.understood.map((x) => x.label);
    for (const label of ["Guaynabo", "Existing warehouse/office facility", "12,000 sq ft", "Leased property", "Interior renovation", "Interior demolition", "Electrical work", "Plumbing work", "Office build-out"]) {
      assert.ok(understood.includes(label), `missing chip ${label}`);
    }
    const needs = d.needsConfirmation.map((x) => x.label);
    assert.deepEqual(needs.sort(), ["Possible change of use", "Proposed commercial activity not yet specified"]);
    assert.ok(!understood.some((l) => /change of use|commercial operation|new business/i.test(l)));
  });

  it("the graph asks only the controlling question first: the activity", () => {
    const ev = evaluateScenario(c, kb);
    assert.deepEqual(ev.questions.map((q) => q.id), ["sq_activity"]);
    assert.equal(ev.questions[0].text, "What type of commercial operation will occupy this facility?");
    const needs = ev.controlling.map((x) => x.id);
    for (const id of ["activity", "authorized_use", "location"]) assert.ok(needs.includes(id as never), id);
  });

  it("paths come from KB rules, split into likely and potential", () => {
    const ev = evaluateScenario(c, kb);
    assert.deepEqual(docIds(ev.likely), ["DOC_LEASE_AGREEMENT", "DOC_OGPE_CONSTRUCTION_PERMIT"]);
    const pu = ev.potential.find((p) => p.documentId === "DOC_PERMISO_UNICO");
    assert.ok(pu, "use authorization is potential until the activity is known");
    assert.deepEqual(pu!.needs, ["Type of commercial operation"]);
    const all = [...ev.likely, ...ev.potential];
    for (const p of all) {
      const doc = kb.documents.find((d) => d.id === p.documentId);
      assert.ok(doc, `${p.documentId} must be a KB document`);
      assert.ok(p.ruleIds.every((id) => kb.rules.some((r) => r.id === id)), `${p.documentId} must cite KB rules`);
    }
    // Nothing surfaces because a word appeared: no IRS / Dept. of State /
    // Hacienda / Fire / environmental agency for this scenario yet.
    assert.ok(!all.some((p) => /IRS|Department of State|Hacienda|Bomberos|DRNA|EPA/i.test(p.agency)), all.map((p) => p.agency).join(","));
  });

  it("after the activity is known, the graph asks what that branch reads — conditionally", () => {
    const answered = applyScenarioAnswer(c, "sq_activity", "furniture manufacturing");
    const ev = evaluateScenario(answered, kb);
    const ids = ev.questions.map((q) => q.id);
    assert.ok(ids.includes("sq_authorized_use"));
    assert.ok(ids.includes("sq_structural_exterior"));
    assert.ok(!ids.includes("sq_activity"));
    assert.ok(ev.branches.some((b) => b.startsWith("activity:BT_FURNITURE_MANUFACTURING")));
    assert.ok(docIds(ev.likely).includes("DOC_FIRE_CERT"), "manufacturing reaches the fire certification through the KB");
    assert.ok(docIds(ev.likely).includes("DOC_PERMISO_UNICO"));
  });
});

describe("regression tests", () => {
  it("Test 1 — an existing company opening a new operation stays an existing business", () => {
    const c = interpretScenario("Our existing company leased a warehouse in Guaynabo for a new operation.");
    assert.equal(businessStatus(c), "existing");
    assert.equal(c.business.status?.source, "explicit");
    assert.equal(v(c.property.municipality), "Guaynabo");
    assert.equal(v(c.property.ownershipStatus), "leased");
    assert.notEqual(businessStatus(c), "new");
    assert.equal(v(c.property.proposedUseSpecificity), "insufficient");
  });

  it("Test 2 — creating a new LLC is a new business", () => {
    const c = interpretScenario("We are creating a new LLC to operate a warehouse in Guaynabo.");
    assert.equal(businessStatus(c), "new");
    assert.equal(c.business.status?.source, "explicit");
    assert.equal(v(c.operations.activity), "warehouse");
    const ev = evaluateScenario(c, kb);
    assert.ok(ev.branches.includes("formation"), "a new entity reaches the formation branch of the graph");
  });

  it("Test 3 — renovating but continuing the same use is not a change of use", () => {
    const c = interpretScenario("We are renovating an existing warehouse but will continue using it as a warehouse.");
    assert.equal(v(c.project.possibleChangeOfUse), false);
    assert.equal(c.project.possibleChangeOfUse?.source, "explicit");
    assert.equal(changeOfUseStatus(c), "none");
    const ev = evaluateScenario(c, kb);
    assert.ok(ev.branches.includes("use_authorization:same_use"));
    assert.ok(!ev.questions.some((q) => q.id === "sq_change_of_use" || q.id === "sq_authorized_use"));
  });

  it("Test 4 — converting a warehouse into a daycare is a change of use and a different graph path", () => {
    const c = interpretScenario("We're converting an existing warehouse into a daycare.");
    assert.equal(v(c.property.existingUse), "warehouse");
    assert.equal(v(c.property.proposedUse), "daycare");
    assert.equal(v(c.project.possibleChangeOfUse), true);
    assert.equal(changeOfUseStatus(c), "confirmed");

    const same = evaluateScenario(interpretScenario("We are renovating an existing warehouse but will continue using it as a warehouse."), kb);
    const daycare = evaluateScenario(c, kb);
    assert.ok(daycare.branches.includes("use_authorization:change_of_use"));
    assert.ok(daycare.branches.includes("activity:BT_DAYCARE"));
    assert.notDeepEqual(daycare.branches, same.branches);
    assert.ok(docIds(daycare.likely).includes("DOC_CHILDCARE_LICENSE"));
    assert.ok(!docIds(same.likely).includes("DOC_CHILDCARE_LICENSE"));
    // A new occupancy reaches site-circulation review; the same use does not.
    assert.ok(daycare.questions.some((q) => q.id === "sq_site_circulation"));
    assert.ok(!same.questions.some((q) => q.id === "sq_site_circulation"));
  });

  it("Test 5 — an existing business's Passport hides identity fields; only project gaps are asked", () => {
    const passport: PassportSnapshot = {
      businessId: "biz-abc",
      name: "ABC Manufacturing LLC",
      entityType: "llc",
      industry: "Manufacturing",
      businessType: "Furniture Manufacturing",
      municipality: "San Juan",
      address: "10 Calle Luna",
      hasEin: true,
      hasMerchantRegistration: true,
      hasContact: true,
    };
    const hidden = identityFieldsKnown(passport);
    for (const field of ["name", "business_structure", "industry", "business_type", "municipality"]) {
      assert.ok(hidden.has(field), `${field} must not be asked again`);
    }
    assert.deepEqual(
      passportKnownItems(passport).map((k) => k.key),
      ["name", "business_structure", "ein", "registration", "industry", "business_type", "business_address", "contact"]
    );

    const read = interpretScenario("We leased a warehouse in Guaynabo and want to renovate it for manufacturing.");
    const c = mergePassportIntoScenario(read, passport);
    assert.equal(businessStatus(c), "existing");
    assert.equal(c.business.status?.source, "existing_passport");
    assert.equal(v(c.business.name), "ABC Manufacturing LLC");
    assert.equal(v(c.property.municipality), "Guaynabo", "the project location is the description's, not the Passport address");
    assert.deepEqual(passportDeltas(c, passport).map((d) => d.kind), ["new_location"]);

    const ev = evaluateScenario(c, kb, { passport });
    const asked = ev.questions.map((q) => q.text.toLowerCase()).join(" | ");
    assert.ok(!/business name|entity|ein|industry|business type|contact/.test(asked), asked);
    // No formation / registration for an entity that exists; a municipal
    // license only because the project is in a different municipality.
    const all = docIds([...ev.likely, ...ev.potential]);
    for (const doc of ["DOC_EIN", "DOC_CERT_ORGANIZATION", "DOC_CERT_INCORPORATION", "DOC_MERCHANT_REGISTRATION"]) {
      assert.ok(!all.includes(doc), `${doc} must not be asked of an existing business`);
    }
    assert.ok(docIds(ev.likely).includes("DOC_PATENTE_MUNICIPAL"));
    const sameTown = evaluateScenario(mergePassportIntoScenario(interpretScenario("We leased a warehouse in San Juan to renovate it for manufacturing."), passport), kb, { passport });
    assert.ok(!docIds(sameTown.likely).includes("DOC_PATENTE_MUNICIPAL"));
  });

  it("Test 6 — unknown facts stay unknown", () => {
    const c = interpretScenario(GUAYNABO);
    for (const path of [
      "business.status",
      "business.name",
      "property.address",
      "property.parcel",
      "property.authorizedUse",
      "project.structuralWork",
      "project.exteriorWork",
      "project.footprintChange",
      "project.siteCirculationChanges",
      "operations.activity",
      "operations.employees",
      "operations.generator",
      "operations.hazardousMaterials",
      "operations.wastewaterDischarge",
    ] as const) {
      assert.equal(getFact(c, path), undefined, `${path} must stay unknown`);
    }
    // And the model can't fill them from typical assumptions either.
    const { scenario } = normalizeScenario(
      {
        project: { structuralWork: { value: false, source: "inferred", confidence: 0.7, evidenceText: "interior renovations rarely touch structure" } },
        operations: { employees: { value: 12, source: "explicit", confidence: 0.9, evidenceText: "12 employees" } },
      },
      GUAYNABO
    );
    assert.equal(scenario.project.structuralWork, undefined);
    assert.equal(scenario.operations.employees, undefined);
  });
});

describe("the model's reading is checked, not trusted", () => {
  it("drops a new-business conclusion drawn from 'a new commercial operation'", () => {
    const { scenario, report } = normalizeScenario(
      { business: { status: { value: "new", source: "explicit", confidence: 0.9, evidenceText: "for a new commercial operation" } } },
      GUAYNABO
    );
    assert.equal(scenario.business.status, undefined);
    assert.ok(report.some((r) => r.path === "business.status" && r.action === "dropped"));
  });

  it("downgrades an 'explicit' change of use the text only hints at", () => {
    const { scenario } = normalizeScenario(
      { project: { possibleChangeOfUse: { value: true, source: "explicit", confidence: 0.9, evidenceText: "modifications to the existing use" } } },
      GUAYNABO
    );
    assert.equal(scenario.project.possibleChangeOfUse?.source, "inferred");
  });

  it("downgrades an 'explicit' renovation the text describes only as painting and signage", () => {
    const text = "We'll lease a commercial space downtown, no construction beyond painting and signage.";
    const { scenario, report } = normalizeScenario(
      { project: { renovation: { value: true, source: "explicit", confidence: 0.95, evidenceText: "painting and signage" } } },
      text
    );
    assert.equal(scenario.project.renovation?.source, "inferred");
    assert.ok((scenario.project.renovation?.confidence ?? 1) <= 0.72);
    assert.ok(report.some((r) => r.path === "project.renovation" && r.action === "downgraded"));
  });

  it("downgrades a project_type of renovation without renovation language", () => {
    const text = "We'll lease a commercial space downtown, no construction beyond painting and signage.";
    const { scenario } = normalizeScenario(
      { project: { type: { value: "renovation", source: "explicit", confidence: 0.92, evidenceText: "painting and signage" } } },
      text
    );
    assert.equal(scenario.project.type?.source, "inferred");
    assert.ok((scenario.project.type?.confidence ?? 1) <= 0.72);
  });

  it("keeps an 'explicit' renovation when the text states remodeling", () => {
    const text = "We're remodeling the interior of the leased space in Ponce.";
    const { scenario } = normalizeScenario(
      { project: { renovation: { value: true, source: "explicit", confidence: 0.95, evidenceText: "remodeling the interior" } } },
      text
    );
    assert.equal(scenario.project.renovation?.source, "explicit");
    assert.equal(v(scenario.project.renovation), true);
  });

  it("downgrades an 'explicit' ownership claim the text only describes as a home kitchen (REG-PHANTOM-OWNERSHIP-001)", () => {
    // 2026-09-25 15:00 QA carry-over: semantic intake turned "home kitchen"
    // into "Owned property — Needs confirmation". A home location is not
    // ownership evidence — a home may be owned or rented — so the conclusion
    // drops into the needs-confirmation band.
    const text = "I run the bakery from my home kitchen in Bayamón.";
    const { scenario, report } = normalizeScenario(
      { property: { ownershipStatus: { value: "owned", source: "explicit", confidence: 0.93, evidenceText: "home kitchen" } } },
      text
    );
    assert.equal(scenario.property.ownershipStatus?.source, "inferred");
    assert.ok((scenario.property.ownershipStatus?.confidence ?? 1) <= 0.72);
    assert.ok(report.some((r) => r.path === "property.ownershipStatus" && r.action === "downgraded"));
  });

  it("downgrades an 'explicit' ownership claim from Spanish home language too", () => {
    const text = "Monto un negocio de repostería desde la cocina de mi casa en Bayamón.";
    const { scenario } = normalizeScenario(
      { property: { ownershipStatus: { value: "owned", source: "explicit", confidence: 0.91, evidenceText: "cocina de mi casa" } } },
      text
    );
    assert.equal(scenario.property.ownershipStatus?.source, "inferred");
    assert.ok((scenario.property.ownershipStatus?.confidence ?? 1) <= 0.72);
  });

  it("keeps an 'explicit' ownership claim when the text states tenure", () => {
    for (const text of [
      "We own the building in Caguas.",
      "We lease a commercial space downtown.",
      "Alquilé el local en Caguas para el negocio.",
      "Soy dueño del edificio donde está el negocio.",
    ]) {
      const { scenario } = normalizeScenario(
        { property: { ownershipStatus: { value: "owned", source: "explicit", confidence: 0.95, evidenceText: text.slice(0, 40) } } },
        text
      );
      assert.equal(scenario.property.ownershipStatus?.source, "explicit", text);
    }
  });

  it("the deterministic reading wins guarded facts when combined", () => {
    const base = interpretScenario("Our existing company leased a warehouse in Guaynabo for a new operation.");
    const model = normalizeScenario(
      { business: { status: { value: "new", source: "explicit", confidence: 0.95, evidenceText: "for a new operation" } } },
      "Our existing company leased a warehouse in Guaynabo for a new operation."
    ).scenario;
    assert.equal(businessStatus(combineScenario(base, model)), "existing");
  });

  it("accepts a model fact the rules missed, when its quote is real", () => {
    const text = "We lease a bay in Cataño for a pottery studio with a gas-fired kiln.";
    const base = interpretScenario(text);
    assert.equal(base.operations.emissionsEquipment, undefined, "the rules don't know kilns");
    const model = normalizeScenario(
      { operations: { emissionsEquipment: { value: true, source: "explicit", confidence: 0.9, evidenceText: "with a gas-fired kiln" } } },
      text
    ).scenario;
    assert.equal(v(combineScenario(base, model).operations.emissionsEquipment), true);
  });
});

describe("bridge to the existing intake and rules engine", () => {
  const empty = (): ValidatedInterpretation => ({ summary: "", profileValues: [], answers: [], suggested: { profileValues: [], answers: [] }, discarded: [] });

  it("a keyword-level new_business intent does not survive the scenario", () => {
    const validated = empty();
    validated.projectIntent = { value: "new_business", confidence: 0.9, requiresConfirmation: false, evidence: "new commercial operation" };
    const out = applyScenarioToInterpretation(validated, interpretScenario(GUAYNABO));
    assert.equal(out.projectIntent, undefined);
    assert.equal(out.suggested.projectIntent, undefined);
  });

  it("the scenario's own status fills the intent", () => {
    const out = applyScenarioToInterpretation(empty(), interpretScenario("Our existing company leased a warehouse in Guaynabo for a new operation."));
    assert.equal(out.projectIntent?.value, "existing_business");
  });

  it("flat project facts: a possible change of use is never sent as a change of use", () => {
    const flat = reconcileProjectContext(
      { change_of_use: { value: true, confidence: 0.9 }, occupancy_change: { value: true, confidence: 0.9 } },
      interpretScenario(GUAYNABO)
    );
    assert.equal(flat.change_of_use, undefined);
    assert.equal(flat.occupancy_change, undefined);
    assert.equal(flat.project_type?.value, "renovation");
    assert.ok((flat.project_type?.confidence ?? 0) >= 0.85, "stated renovation reaches the engine established");
    assert.equal(flat.property_tenure?.value, "leased");
  });

  it("inferences reach the engine only in the needs-confirmation band", () => {
    const ctx: ScenarioContext = interpretScenario("Our existing company leased a warehouse in Guaynabo for a new operation.");
    const flat = scenarioToProjectContext(ctx);
    assert.ok((flat.existing_building?.confidence ?? 1) < 0.85, "an inferred existing building stays inert");
  });
});

describe("existing business: the Passport's activity is carried over, not re-asked", () => {
  it("a broad activity matching the Passport business type resolves to it, as an inference", () => {
    const passport: PassportSnapshot = { businessId: "b", name: "ABC Manufacturing LLC", industry: "Manufacturing", businessType: "Furniture Manufacturing", municipality: "San Juan" };
    const c = mergePassportIntoScenario(interpretScenario("We leased a warehouse in Guaynabo and want to renovate it for manufacturing."), passport);
    assert.equal(v(c.operations.activity), "furniture manufacturing");
    assert.equal(c.operations.activity?.source, "inferred");
    const ev = evaluateScenario(c, kb, { passport });
    assert.ok(!ev.questions.some((q) => /what exactly/i.test(q.text)), "the exact activity is not re-asked");
    assert.ok(ev.branches.includes("activity:BT_FURNITURE_MANUFACTURING"));
    assert.ok(describeScenario(c).needsConfirmation.some((x) => /Same activity as your Passport/.test(x.label)));
  });
});
