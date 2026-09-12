// Regression tests for the 2026-09-12 regulatory-knowledge remediation,
// continued on top of PR #72. Each test encodes a legal counterexample the
// audit surfaced that PR #72 did not cover: KB data corrections (deleted
// overreach rules, new employer/alcohol rules, agency fixes) and the
// entity-scoped rule exclusions (F02). Cases already covered by
// regulatoryCorrectness.test.ts are referenced, not duplicated.
//
// Run: node --test src/app/remediation.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runRulesEngine, type KnowledgeBase } from "./rulesEngine.ts";
import { classifyEngineRequirements } from "./requirementApplicability.ts";
import {
  exclusiveFormationRequirements,
  entityTypeRequirements,
} from "./forms/engine/requirementAugment.ts";
import type { CanonicalApplicationData } from "./forms/engine/types.ts";

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

function classify(
  businessType: string,
  municipality: string,
  answers: Record<string, boolean | string>,
  entityType: string,
  potentialDecisions?: Record<string, "applies" | "not_applies" | "not_sure">
) {
  const generated = runRulesEngine(KB, {
    municipalityName: municipality,
    businessTypeName: businessType,
    answers,
    entityType,
  }).requirements;
  return classifyEngineRequirements(generated, {
    kb: KB,
    entityType,
    answers,
    potentialDecisions,
  });
}

const docIds = (rows: { document_id: string }[]) => rows.map((r) => r.document_id);

// --- F01: formation exclusivity -------------------------------------------
// (sole_proprietorship / partnership cases live in regulatoryCorrectness.test.ts)

test("foreign corporation is told to authorize, not incorporate", () => {
  const rows = classify(
    "Restaurant", "San Juan",
    { Q_PHYSICAL_LOCATION: true, Q_ENTITY_FOREIGN_CORP: true },
    "foreign_corporation"
  );
  const ids = docIds(rows);
  assert.equal(ids.includes("DOC_CERT_INCORPORATION"), false);
  assert.equal(ids.includes("DOC_FOREIGN_CORPORATION_AUTHORIZATION"), true);
});

test("LLP is never told to incorporate", () => {
  const rows = classify("Restaurant", "San Juan", { Q_PHYSICAL_LOCATION: true }, "limited_liability_partnership");
  assert.equal(docIds(rows).includes("DOC_CERT_INCORPORATION"), false);
});

test("stock corporation receives incorporation, not organization", () => {
  const rows = classify("Restaurant", "San Juan", { Q_PHYSICAL_LOCATION: true }, "stock_corporation");
  const ids = docIds(rows);
  assert.equal(ids.includes("DOC_CERT_INCORPORATION"), true);
  assert.equal(ids.includes("DOC_ARTICLES_ORGANIZATION"), false);
  const incorp = rows.find((r) => r.document_id === "DOC_CERT_INCORPORATION")!;
  assert.equal(incorp.applicability, "required");
});

test("LLC receives organization, not incorporation", () => {
  // The organization certificate is added by the deterministic formation
  // augment (not by engine rules), mirroring the production pipeline.
  const rows = classify("Restaurant", "San Juan", { Q_PHYSICAL_LOCATION: true }, "limited_liability_company");
  const ids = docIds(rows);
  assert.equal(ids.includes("DOC_CERT_INCORPORATION"), false);
  const canonical = { business: { entityType: "limited_liability_company" } } as CanonicalApplicationData;
  const exclusive = exclusiveFormationRequirements(canonical, rows);
  const added = entityTypeRequirements<{ document_id?: string }>(canonical, exclusive, (d) => ({
    document_id: d.document_id,
  }));
  const finalIds = docIds([...exclusive, ...added] as { document_id: string }[]);
  assert.equal(finalIds.includes("DOC_ARTICLES_ORGANIZATION"), true);
  assert.equal(finalIds.includes("DOC_CERT_INCORPORATION"), false);
});

test("unknown entity type gets incorporation as conditional, never mandatory", () => {
  const rows = classify("Restaurant", "San Juan", { Q_PHYSICAL_LOCATION: true }, "other");
  const incorp = rows.find((r) => r.document_id === "DOC_CERT_INCORPORATION");
  assert.ok(incorp, "incorporation still surfaces so it can be labeled");
  assert.equal(incorp.applicability, "conditional");
  assert.equal(incorp.mandatory, false);
});

// --- Deleted overreach rules ------------------------------------------------

test("children merely present do not trigger a childcare license", () => {
  const rows = classify(
    "Restaurant", "San Juan",
    { Q_PHYSICAL_LOCATION: true, Q_CHILDREN_PRESENT: true },
    "limited_liability_company"
  );
  assert.equal(docIds(rows).some((id) => /CHILDCARE/i.test(id)), false);
});

test("renovating the location does not trigger a contractor credential", () => {
  const rows = classify(
    "Retail Store", "San Juan",
    { Q_PHYSICAL_LOCATION: true, Q_RENOVATIONS: true },
    "limited_liability_company"
  );
  assert.equal(docIds(rows).some((id) => /CONTRACTOR/i.test(id)), false);
});

// --- F05: basis-specific flag gating ----------------------------------------
// (hazardous-material / coastal cases live in regulatoryCorrectness.test.ts)

// --- Employer rules ----------------------------------------------------------

test("hiring employees produces the DTRH employer registration", () => {
  const rows = classify(
    "Restaurant", "San Juan",
    { Q_PHYSICAL_LOCATION: true, Q_EMPLOYEES_HIRED: true },
    "limited_liability_company"
  );
  const dtrh = rows.find((r) => r.document_id === "DOC_DTRH_EMPLOYER_REG");
  assert.ok(dtrh, "DTRH employer registration is required");
  assert.equal(dtrh.applicability, "required");
  assert.match(dtrh.agency, /Trabajo/i);
});

test("hiring employees produces an EIN requirement for a known entity", () => {
  const rows = classify(
    "Restaurant", "San Juan",
    { Q_PHYSICAL_LOCATION: true, Q_EMPLOYEES_HIRED: true },
    "limited_liability_company"
  );
  const ein = rows.find((r) => r.document_id === "DOC_EIN");
  assert.ok(ein, "EIN is required");
  assert.equal(ein.applicability, "required");
});

test("no employees and unknown entity keeps EIN conditional", () => {
  const rows = classify("Restaurant", "San Juan", { Q_PHYSICAL_LOCATION: true }, "other");
  const ein = rows.find((r) => r.document_id === "DOC_EIN");
  assert.ok(ein, "EIN still surfaces so it can be labeled");
  assert.equal(ein.applicability, "conditional");
  assert.equal(ein.mandatory, false);
});

// --- Alcohol shared prerequisites --------------------------------------------

test("selling alcohol triggers the shared Hacienda prerequisites", () => {
  const rows = classify(
    "Bar", "San Juan",
    { Q_PHYSICAL_LOCATION: true, Q_ALCOHOL_SOLD: true, Q_ALCOHOL_SERVED: true },
    "limited_liability_company"
  );
  const ids = docIds(rows);
  for (const expected of [
    "DOC_ALCOHOL_LICENSE",
    "DOC_CRIM_CLEARANCE",
    "DOC_ASUME_CLEARANCE",
    "DOC_BACKGROUND_CHECK",
  ]) {
    assert.equal(ids.includes(expected), true, `expected ${expected}`);
  }
  const license = rows.find((r) => r.document_id === "DOC_ALCOHOL_LICENSE")!;
  assert.equal(license.applicability, "required");
});

test("no alcohol answers produce no alcohol prerequisites", () => {
  const rows = classify(
    "Restaurant", "San Juan",
    { Q_PHYSICAL_LOCATION: true, Q_ALCOHOL_SOLD: false, Q_ALCOHOL_SERVED: false },
    "limited_liability_company"
  );
  const ids = docIds(rows);
  assert.equal(ids.includes("DOC_CRIM_CLEARANCE"), false);
  assert.equal(ids.includes("DOC_ASUME_CLEARANCE"), false);
});

// --- Annual report / annual fee (RULE_0636) --------------------------------
// Verified: corporations file Informe Anual and LLCs pay the annual fee with
// the Dept of State by April 15 each year (Law 164-2009, Arts. 15.01(A) /
// 21.03(C)). Non-corporate forms must never see it.

test("corporation receives the annual report requirement", () => {
  const rows = classify("Restaurant", "San Juan", {}, "stock_corporation");
  assert.equal(docIds(rows).includes("DOC_ANNUAL_REPORT"), true);
});

test("LLC receives the annual report requirement", () => {
  const rows = classify("Restaurant", "San Juan", {}, "limited_liability_company");
  assert.equal(docIds(rows).includes("DOC_ANNUAL_REPORT"), true);
});

test("sole proprietorship never receives the annual report requirement", () => {
  const rows = classify("Restaurant", "San Juan", {}, "sole_proprietorship");
  assert.equal(docIds(rows).includes("DOC_ANNUAL_REPORT"), false);
});

test("partnership never receives the annual report requirement", () => {
  const rows = classify("Restaurant", "San Juan", {}, "partnership");
  assert.equal(docIds(rows).includes("DOC_ANNUAL_REPORT"), false);
});
