// Regression tests for the 2026-09-16 blind-test remediation (B-1 … B-4).
//
// Four human-validated false positives from the blind-test generalization
// exercise. Each test encodes the corrected behavior through the full
// product pipeline (permit-model corrections + rules engine + classifier),
// not by hardcoding the fix: the underlying rules/data model changed, so
// any scenario with the same trigger pattern gets the corrected output.
//
// - B-1: RULE_0117 deleted — a generic marketing agency does not require a
//   PR professional license. Sibling rules RULE_0116 / RULE_0121 /
//   RULE_0122 were NOT touched; they are flagged as regulatory research
//   gaps, not assumed bugs.
// - B-2: RULE_0034 deleted — Q_TOURISM_ACTIVITY=true no longer triggers the
//   PRTC Innkeeper/Hotelier registration for non-lodging businesses.
//   Lodging stays covered by business_type rules (RULE_0139/0142/0145/0148)
//   and the short-term-rental trigger (RULE_0033).
// - B-3: RULE_0191 deleted — a private school is not a childcare
//   establishment under Ley 173-2016. Actual daycare keeps the license
//   (RULE_0194). No private-school licensing document exists in the KB;
//   recorded as a regulatory research gap, not invented.
// - B-4: the 15 business_type -> DOC_PERMISO_UNICO rules now carry
//   excluded_when_home_based (engine-enforced): a home-based business
//   follows the domiciliary-use Permiso Único pathway (RULE_0652) instead
//   of receiving the generic commercial Permiso Único on top of it.
//
// Run: node --experimental-strip-types --test src/app/blindRemediation.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { computeRequirementsFromKB, applyPermitModelCorrections } from "./kb.ts";
import { runRulesEngine, type KnowledgeBase } from "./rulesEngine.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const kbDir = join(here, "..", "kb");
const load = (f: string) => JSON.parse(readFileSync(join(kbDir, f), "utf8"));
const KB: KnowledgeBase = {
  municipalities: load("municipalities.json"),
  businessTypes: load("business_types.json"),
  questions: load("questions.json"),
  documents: load("documents.json"),
  rules: load("rules.json"),
};

function rows(
  businessType: string,
  municipality: string,
  answers: Record<string, unknown>,
  entityType: string = "limited_liability_company"
) {
  return computeRequirementsFromKB(
    { business_type: businessType, municipality },
    answers,
    {},
    { entityType, projectIntent: "new_business" }
  );
}
const docIds = (r: { document_id?: string | null }[]) => r.map((x) => x.document_id ?? "");

// --- B-1: marketing agency professional license ------------------------------
test("B-1: a generic marketing agency is NOT told to get a professional license", () => {
  const docs = docIds(
    rows("Marketing Agency", "Trujillo Alto", {
      Q_PHYSICAL_LOCATION: true,
      Q_EMPLOYEES_HIRED: true,
    })
  );
  assert.ok(
    !docs.includes("DOC_PROFESSIONAL_LICENSE"),
    "marketing agency should not require DOC_PROFESSIONAL_LICENSE: " + docs.join(",")
  );
  // Sanity: the business still gets its ordinary baseline requirements.
  assert.ok(docs.includes("DOC_MERCHANT_REGISTRATION"));
  assert.ok(docs.includes("DOC_PERMISO_UNICO"));
});

test("B-1: no rule in the KB maps a marketing agency to a professional license", () => {
  const offenders = (KB.rules as Array<{ id: string; business_type_id: string | null; requires_document_id: string }>).filter(
    (r) => r.business_type_id === "BT_MARKETING_AGENCY" && r.requires_document_id === "DOC_PROFESSIONAL_LICENSE"
  );
  assert.deepEqual(offenders.map((r) => r.id), [], "RULE_0117 (or a copy) still maps BT_MARKETING_AGENCY to DOC_PROFESSIONAL_LICENSE");
});

// --- B-2: tour operator innkeeper registration --------------------------------
test("B-2: a tour operator with tourism activity does NOT get the innkeeper/hotelier registration", () => {
  const docs = docIds(
    rows("Tour Operator", "Cataño", {
      Q_PHYSICAL_LOCATION: true,
      Q_TOURISM_ACTIVITY: true,
      Q_EXCURSIONS: true,
    })
  );
  assert.ok(
    !docs.includes("DOC_TOURISM_REGISTRATION"),
    "non-lodging tour operator should not receive DOC_TOURISM_REGISTRATION: " + docs.join(",")
  );
});

test("B-2: hotels still receive the innkeeper/hotelier registration", () => {
  const docs = docIds(
    rows("Hotel", "San Juan", {
      Q_PHYSICAL_LOCATION: true,
      Q_TOURISM_ACTIVITY: true,
      Q_GUESTS_OVERNIGHT: true,
    })
  );
  assert.ok(
    docs.includes("DOC_TOURISM_REGISTRATION"),
    "hotel must still receive DOC_TOURISM_REGISTRATION: " + docs.join(",")
  );
});

test("B-2: short-term rentals still receive the innkeeper/hotelier registration", () => {
  const docs = docIds(
    rows("Airbnb / Short-Term Rental", "Bayamón", {
      Q_PHYSICAL_LOCATION: true,
      Q_SHORT_TERM_RENTAL: true,
    })
  );
  assert.ok(docs.includes("DOC_TOURISM_REGISTRATION"), "STR must still receive DOC_TOURISM_REGISTRATION: " + docs.join(","));
});

// --- B-3: private school childcare license ------------------------------------
test("B-3: a private school is NOT mapped to the childcare license", () => {
  const docs = docIds(
    rows("Private School", "Mayagüez", {
      Q_PHYSICAL_LOCATION: true,
      Q_CHILDREN_PRESENT: true,
      Q_CLASSES_ON_SITE: true,
      Q_EMPLOYEES_HIRED: true,
    })
  );
  assert.ok(
    !docs.includes("DOC_CHILDCARE_LICENSE"),
    "private school should not receive DOC_CHILDCARE_LICENSE: " + docs.join(",")
  );
  // Sanity: no other licensing document was invented as a substitute.
  assert.ok(docs.includes("DOC_MERCHANT_REGISTRATION"));
});

test("B-3: an actual daycare still receives the childcare license", () => {
  const docs = docIds(
    rows("Daycare", "Mayagüez", {
      Q_PHYSICAL_LOCATION: true,
      Q_CHILDREN_PRESENT: true,
    })
  );
  assert.ok(docs.includes("DOC_CHILDCARE_LICENSE"), "daycare must keep DOC_CHILDCARE_LICENSE: " + docs.join(","));
});

// --- B-4: home bakery dual permit --------------------------------------------
test("B-4: a home-based bakery gets the domiciliary Permiso Único pathway only, not two permits", () => {
  const got = rows(
    "Bakery",
    "Trujillo Alto",
    {
      Q_HOME_BASED: true,
      Q_PHYSICAL_LOCATION: true, // intake counts a home as a physical place; permit model corrects it
      Q_FOOD_PREPARED: true,
      Q_FOOD_SOLD: true,
    },
    "sole_proprietorship"
  );
  const docs = docIds(got);
  assert.ok(
    docs.includes("DOC_DOMICILIARY_USE_PERMIT"),
    "home bakery must receive the domiciliary-use Permiso Único pathway: " + docs.join(",")
  );
  assert.ok(
    !docs.includes("DOC_PERMISO_UNICO"),
    "home bakery must NOT also receive the generic commercial Permiso Único: " + docs.join(",")
  );
});

test("B-4: a commercial bakery gets the normal Permiso Único, not the domiciliary pathway", () => {
  const got = rows("Bakery", "Trujillo Alto", {
    Q_PHYSICAL_LOCATION: true,
    Q_FOOD_PREPARED: true,
    Q_FOOD_SOLD: true,
  });
  const docs = docIds(got);
  assert.ok(docs.includes("DOC_PERMISO_UNICO"), "commercial bakery must receive DOC_PERMISO_UNICO: " + docs.join(","));
  assert.ok(
    !docs.includes("DOC_DOMICILIARY_USE_PERMIT"),
    "commercial bakery must NOT receive the domiciliary pathway: " + docs.join(",")
  );
});

test("B-4: the home exclusion is engine-enforced and recorded (generalizes beyond bakeries)", () => {
  // A home-based restaurant hits the same defect class (RULE_0049 is the
  // business_type -> PERMISO_UNICO rule for restaurants): the rule must be
  // suppressed by the engine, not merely outvoted by another rule. Mirror the
  // product pipeline's permit-model correction (a home is not a
  // nonresidential physical location for permit rules) before evaluating.
  const answers: Record<string, boolean | string> = { Q_HOME_BASED: true, Q_PHYSICAL_LOCATION: true };
  applyPermitModelCorrections(answers);
  const { debug } = runRulesEngine(KB, {
    municipalityName: "Carolina",
    businessTypeName: "Restaurant",
    answers,
  });
  const suppressed = debug.rulesSuppressed.find(
    (s) => s.rule_id === "RULE_0049" && s.suppressed_by === "Q_HOME_BASED=true"
  );
  assert.ok(suppressed, "RULE_0049 should be suppressed for a home-based restaurant: " + JSON.stringify(debug.rulesSuppressed));
  assert.ok(
    !debug.documentsGenerated.includes("DOC_PERMISO_UNICO"),
    "home-based restaurant must not generate DOC_PERMISO_UNICO"
  );
  assert.ok(
    debug.documentsGenerated.includes("DOC_DOMICILIARY_USE_PERMIT"),
    "home-based restaurant must still get the domiciliary pathway"
  );
});
