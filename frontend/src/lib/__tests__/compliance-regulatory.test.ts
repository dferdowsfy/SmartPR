// Unit tests for deterministic regulatory-development matching (spec section 10,
// revised): fresh news is matched to the business before every digest, and only
// verified developments that actually apply are ever shown.
// Run with: npx tsx --test src/lib/__tests__/compliance-regulatory.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIDENCE_RUBRIC,
  REGULATORY_SCAN_SOURCES,
  developmentApplicability,
  guidanceForRequirement,
  matchDevelopmentToBusiness,
  obligationApplicability,
  sortByPriority,
  type DigestBusinessProfile,
  type DigestObligationProfile,
  type RegulatoryDevelopment,
} from "../compliance-regulatory";

const b1: DigestBusinessProfile = {
  businessId: "b1",
  businessName: "Café Luna",
  businessType: "restaurant",
  industry: "food",
  municipality: "San Juan",
  businessStructure: "llc",
};

const o1: DigestObligationProfile = {
  obligationId: "o1",
  obligationName: "Patente Municipal",
  requirementId: "DOC_PATENTE_MUNICIPAL",
  agency: "Municipio de San Juan",
  businessId: "b1",
};

function dev(over: Partial<RegulatoryDevelopment> = {}): RegulatoryDevelopment {
  return {
    id: "d1",
    title: "T",
    summary: "S",
    sourceName: "OGPe",
    sourceUrl: "https://www.ogpe.pr.gov/x",
    publishedDate: "2026-09-20",
    effectiveDate: null,
    affectedRequirementCodes: [],
    agencyNames: [],
    municipalities: [],
    businessTypes: [],
    industries: [],
    requirementNames: [],
    applicabilityNotes: null,
    recommendedAction: null,
    confidence: "high",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Deterministic matching
// ---------------------------------------------------------------------------

test("requirement-code match is Confirmed and deterministic", () => {
  const d = dev({ affectedRequirementCodes: ["DOC_PATENTE_MUNICIPAL"] });
  const m1 = matchDevelopmentToBusiness(d, b1, [o1]);
  const m2 = matchDevelopmentToBusiness(d, b1, [o1]);
  assert.equal(m1.matched, true);
  assert.equal(m2.matched, true);
  assert.deepEqual(m1, m2);
  assert.match(m1.basis, /Patente Municipal/);
});

test("no targeting criteria → never matched (generic news never reaches the digest)", () => {
  const m = matchDevelopmentToBusiness(dev(), b1, [o1]);
  assert.equal(m.matched, false);
});

test("municipality-only targeting matches only that municipality", () => {
  const d = dev({ municipalities: ["Ponce"], requirementNames: ["Patente Municipal"] });
  assert.equal(matchDevelopmentToBusiness(d, b1, [o1]).matched, false);
  const bPonce = { ...b1, municipality: "Ponce" };
  assert.equal(matchDevelopmentToBusiness(d, bPonce, [o1]).matched, true);
});

test("agency + requirement-name targeting with no matching obligation → no match", () => {
  const d = dev({ agencyNames: ["Departamento de Salud"], requirementNames: ["Certificado de Salud"] });
  assert.equal(matchDevelopmentToBusiness(d, b1, [o1]).matched, false);
});

test("requirement code targeting matches by obligation name when profile lacks the code", () => {
  const d = dev({ requirementNames: ["Permiso Único"] });
  const m = matchDevelopmentToBusiness(d, b1, [
    { obligationId: "o9", obligationName: "Permiso Único", requirementId: null, agency: "OGPe", businessId: "b1" },
  ]);
  assert.equal(m.matched, true);
  assert.match(m.basis, /Permiso Único/);
});

test("business-type targeting matches the right type only", () => {
  const d = dev({ businessTypes: ["restaurant"], requirementNames: ["Patente Municipal"] });
  assert.equal(matchDevelopmentToBusiness(d, b1, [o1]).matched, true);
  const bOther = { ...b1, businessType: "construction" };
  assert.equal(matchDevelopmentToBusiness(d, bOther, [o1]).matched, false);
});

// ---------------------------------------------------------------------------
// Applicability labels
// ---------------------------------------------------------------------------

test("developmentApplicability: high/medium confidence → confirmed/likely; low → conditional", () => {
  const d = dev();
  assert.equal(developmentApplicability(d, { matched: true, basis: "b", viaRequirementCode: true }), "confirmed");
  assert.equal(developmentApplicability({ ...d, confidence: "medium" }, { matched: true, basis: "b", viaRequirementCode: false }), "likely");
  assert.equal(developmentApplicability({ ...d, confidence: "low" }, { matched: true, basis: "b", viaRequirementCode: false }), "conditional");
});

test("obligationApplicability: confirmed for sourced/known, likely when unverified, conditional when optional", () => {
  assert.equal(
    obligationApplicability({ status: "CURRENT", mandatory: true, sourceReference: "RULE_1" }),
    "confirmed"
  );
  assert.equal(
    obligationApplicability({ status: "UNKNOWN", mandatory: true, sourceReference: null }),
    "likely"
  );
  assert.equal(
    obligationApplicability({ status: "CURRENT", mandatory: false, sourceReference: "RULE_1" }),
    "conditional"
  );
  assert.equal(
    obligationApplicability({ status: "CURRENT", mandatory: true, sourceReference: null }),
    "likely"
  );
});

// ---------------------------------------------------------------------------
// Guidance concepts
// ---------------------------------------------------------------------------

test("guidanceForRequirement reuses validated concepts; unknown codes return null", () => {
  const g = guidanceForRequirement("DOC_PERMISO_UNICO");
  assert.ok(g);
  assert.match(g!.nextAction.en, /SBP/);
  assert.ok(g!.nextAction.es.length > 10);
  assert.equal(guidanceForRequirement("DOC_NOPE_NOT_REAL"), null);
});

// ---------------------------------------------------------------------------
// sortByPriority
// ---------------------------------------------------------------------------

test("sortByPriority: overdue first (most overdue), then soonest, then stalled, then dateless", () => {
  const mk = (over: Partial<{ overdue: boolean; daysRemaining: number | null; daysStalled: number | null; mandatory: boolean; name: string }>) => ({
    overdue: false, daysRemaining: null, daysStalled: null, mandatory: true, name: "", ...over,
  });
  const a = mk({ name: "A", overdue: true, daysRemaining: -5 });
  const b = mk({ name: "B", overdue: true, daysRemaining: -1 });
  const c = mk({ name: "C", daysRemaining: 10 });
  const d = mk({ name: "D", daysRemaining: 10, mandatory: false });
  const e = mk({ name: "E", daysStalled: 30 });
  const f = mk({ name: "F" });
  const sorted = sortByPriority([f, e, d, c, b, a]);
  assert.deepEqual(sorted.map((x) => x.name), ["A", "B", "C", "D", "E", "F"]);
});

// ---------------------------------------------------------------------------
// Scan inventory + confidence rubric guardrails
// ---------------------------------------------------------------------------

test("REGULATORY_SCAN_SOURCES covers the primary government sources", () => {
  assert.ok(REGULATORY_SCAN_SOURCES.length >= 8, "at least 8 sources");
  const names = REGULATORY_SCAN_SOURCES.map((s) => s.agency).join(" | ");
  for (const agency of ["OGPe", "SURI", "Departamento de Estado", "DRNA", "Bomberos", "Salud", "DTRH", "CFSE"]) {
    assert.ok(names.includes(agency), `source list includes ${agency}`);
  }
  for (const s of REGULATORY_SCAN_SOURCES) {
    assert.ok(s.urls.every((u) => u.startsWith("https://")), `${s.agency} has real https URLs`);
    assert.ok(s.check.length > 10, `${s.agency} documents what to check`);
  }
});

test("CONFIDENCE_RUBRIC forces a primary-source basis for high confidence", () => {
  assert.match(CONFIDENCE_RUBRIC.high, /primary/i);
  assert.match(CONFIDENCE_RUBRIC.medium, /primary/i);
  assert.ok(CONFIDENCE_RUBRIC.low.length > 10);
});
