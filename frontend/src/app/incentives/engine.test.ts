import test from "node:test";
import assert from "node:assert/strict";
import { evaluateIncentives } from "./engine.ts";
import type { IncentiveProgram } from "./types.ts";

function program(): IncentiveProgram {
  return {
    id: "GRANT_TEST_FIXTURE",
    name: "Test fixture workforce grant",
    programType: "grant",
    administeringAgency: { id: "AGY_TEST", name: "Test Agency" },
    applicationAgency: { id: "AGY_TEST", name: "Test Agency" },
    description: "Test-only program used to verify deterministic eligibility behavior.",
    benefits: [{ id: "BEN_TEST", name: "Test benefit", description: "Source-backed test benefit", benefitType: "grant", citation: "Test § 1" }],
    geography: { level: "Puerto Rico", municipalityIds: [], municipalityNames: [] },
    applicableIndustries: { ids: [], names: [] },
    criteria: [
      {
        id: "CRIT_JOBS",
        name: "Planned jobs",
        description: "Plans at least 10 new jobs",
        factKey: "planned_job_creation",
        operator: "gte",
        expectedValue: 10,
        required: true,
        material: true,
        question: "How many new jobs do you plan to create?",
        answerType: "number",
        evidenceTypeIds: ["EVD_JOBS"],
        citation: "Test § 2",
      },
      {
        id: "CRIT_WAGE",
        name: "Expected wage",
        description: "Provides expected wage information",
        factKey: "average_wage",
        operator: "exists",
        required: true,
        material: true,
        question: "What average wage do you expect to pay?",
        answerType: "number",
        evidenceTypeIds: [],
        citation: "Test § 3",
      },
    ],
    evidence: [{ id: "EVD_JOBS", name: "Hiring plan" }],
    applicationProcess: "Apply to Test Agency.",
    applicationWindow: null,
    sources: [{ id: "SRC_TEST", name: "Official test source", sourceType: "guidance", legalStatus: "effective", jurisdiction: "Puerto Rico", citation: "Test", url: "https://example.gov/test", lastVerifiedAt: "2026-09-01", sourceVersion: "v1" }],
    status: "active",
    lastVerifiedAt: "2026-09-01",
    sourceVersion: "v1",
    compatibleWith: [],
    conflictsWith: [],
    prerequisiteFor: [],
    automaticEligibility: false,
  };
}

test("missing material facts produce a potentially eligible result and adaptive questions", () => {
  const assessment = evaluateIncentives({ planned_job_creation: 12 }, [program()], { now: new Date("2026-09-02T00:00:00Z") });
  assert.equal(assessment.opportunities[0]?.eligibility, "potentially_eligible");
  assert.equal(assessment.opportunities[0]?.criteriaSatisfied.length, 1);
  assert.equal(assessment.opportunities[0]?.missingInformation.length, 1);
  assert.deepEqual(assessment.followUpQuestions.map((item) => item.factKey), ["average_wage"]);
});

test("all required facts satisfied means likely eligible but not guaranteed", () => {
  const assessment = evaluateIncentives({ planned_job_creation: 12, average_wage: 20 }, [program()]);
  assert.equal(assessment.opportunities[0]?.eligibility, "likely_eligible");
  assert.equal(assessment.opportunities[0]?.isGuaranteed, false);
  assert.equal(assessment.opportunities[0]?.confidenceScore, 100);
});

test("a failed required criterion means not eligible", () => {
  const assessment = evaluateIncentives({ planned_job_creation: 3, average_wage: 20 }, [program()]);
  assert.equal(assessment.results[0]?.eligibility, "not_eligible");
  assert.equal(assessment.opportunities.length, 0);
  assert.equal(assessment.excluded[0]?.criteriaNotSatisfied[0]?.factKey, "planned_job_creation");
});

test("published industry and municipality scopes are evaluated as required criteria", () => {
  const fixture = program();
  fixture.applicableIndustries = { ids: ["IND_MANUFACTURING"], names: ["Manufacturing"] };
  fixture.geography = { level: "Municipal", municipalityIds: ["MUN_PONCE"], municipalityNames: ["Ponce"] };
  const assessment = evaluateIncentives({
    industry: "Food & Beverage",
    municipality: "San Juan",
    planned_job_creation: 12,
    average_wage: 20,
  }, [fixture]);
  assert.equal(assessment.results[0]?.eligibility, "not_eligible");
  assert.deepEqual(
    assessment.results[0]?.criteriaNotSatisfied.map((item) => item.factKey).sort(),
    ["industry", "municipality"]
  );
});

test("expired programs cannot be surfaced as current opportunities", () => {
  const expired = { ...program(), status: "expired" as const };
  const assessment = evaluateIncentives({ planned_job_creation: 12, average_wage: 20 }, [expired]);
  assert.equal(assessment.results[0]?.eligibility, "not_eligible");
  assert.equal(assessment.opportunities.length, 0);
});

test("validated evidence satisfies a criterion only when the published rule explicitly allows it", () => {
  const fixture = program();
  fixture.criteria[0] = { ...fixture.criteria[0], evidenceCanSatisfy: true };
  const assessment = evaluateIncentives(
    { average_wage: 20 },
    [fixture],
    { verifiedEvidenceTypeIds: ["EVD_JOBS"] }
  );
  assert.equal(assessment.results[0]?.criteriaSatisfied.some((item) => item.criterionId === "CRIT_JOBS"), true);
  assert.equal(assessment.results[0]?.eligibility, "likely_eligible");
});

test("voluntary ownership facts are never generated as follow-up questions", () => {
  const fixture = program();
  fixture.criteria = [{
    id: "CRIT_WOMAN_OWNED",
    name: "Voluntary ownership status",
    description: "Woman-owned status when voluntarily provided",
    factKey: "woman_owned",
    operator: "truthy",
    required: true,
    material: true,
    question: "Is the business woman-owned?",
    answerType: "boolean",
    voluntary: true,
    legallyRelevant: true,
    evidenceTypeIds: [],
    citation: "Test § 4",
  }];
  const assessment = evaluateIncentives({}, [fixture]);
  assert.equal(assessment.results[0]?.eligibility, "potentially_eligible");
  assert.equal(assessment.followUpQuestions.length, 0);
});

test("an empty catalog is explicit and never fabricates an opportunity", () => {
  const assessment = evaluateIncentives({ industry: "Restaurant" }, []);
  assert.equal(assessment.publishedProgramCount, 0);
  assert.equal(assessment.opportunities.length, 0);
  assert.match(assessment.notice ?? "", /will not invent/i);
});

test("F06: an industry-only match never becomes likely eligible", () => {
  const fixture = program();
  fixture.criteria = [];
  fixture.applicableIndustries = { ids: ["IND_MANUFACTURING"], names: ["Manufacturing"] };
  const assessment = evaluateIncentives({ industry: "Manufacturing" }, [fixture]);
  const result = assessment.results[0];
  assert.equal(result?.eligibility, "potentially_eligible");
  assert.equal(result?.confidenceScore, 0);
  assert.match(result?.explanation ?? "", /needs review/i);
});
