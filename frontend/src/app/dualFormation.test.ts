// REG-SOLEPROP-DUALFORMATION-001 follow-up (2026-10-01 00:00 QA, live S331/S332).
// The 7bdea01 fix put the Q_BUSINESS_STRUCTURE fallback in buildEngineInput, but
// the live intake passes entityType explicitly
// (entityTypeFromLegacyStructure(profile.business_structure) -> "other" when the
// tiered filing_specific field is null), and computeRequirementsFromSnapshot let
// that "other" clobber the fallback — so production still showed BOTH the
// Certificate of Incorporation and the Certificate of Organization (LLC) to sole
// proprietors (S331) and to LLCs (S332). The engine must treat a bare "other" as
// the absence of a known entity, never as a choice that overrides the answer
// fallback. These tests pin the live defeat path and the intact behaviors.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRequirementsFromKB } from "./kb.ts";

const FORMATION_IDS = ["DOC_CERT_INCORPORATION", "DOC_CERT_ORGANIZATION"];

function livePath(structureAnswer: string | undefined, explicitEntityType: string) {
  // Mirrors SmartPRIntake.tsx: the live caller passes entityType explicitly from
  // the (often null) profile field, while the structure answer sits in answers.
  const reqs = computeRequirementsFromKB(
    {
      business_type: "Bakery",
      municipality: "Mayagüez",
      location_type: "Home-Based Business",
      number_of_employees: 0,
      industry: "Food & Beverage",
      business_structure: null,
    } as never,
    structureAnswer === undefined ? {} : { Q_BUSINESS_STRUCTURE: structureAnswer },
    {},
    {
      projectIntent: "new_business",
      entityType: explicitEntityType,
    } as never
  );
  return new Map(reqs.map((r: any) => [r.document_id, r]));
}

describe("REG-SOLEPROP-DUALFORMATION-001 live-path follow-up", () => {
  it("live defeat: explicit 'other' + answered 'Sole Proprietorship' -> zero formation cards", () => {
    const byId = livePath("Sole Proprietorship", "other");
    for (const id of FORMATION_IDS) {
      assert.ok(!byId.has(id), `${id} must be suppressed for a sole proprietorship (was: both shown live S331)`);
    }
  });

  it("live defeat: explicit 'other' + answered 'LLC' -> only the LLC organization certificate", () => {
    const byId = livePath("LLC", "other");
    assert.ok(byId.has("DOC_CERT_ORGANIZATION"), "LLC keeps its Certificate of Organization");
    assert.ok(!byId.has("DOC_CERT_INCORPORATION"), "Certificate of Incorporation must not appear for an LLC (was: shown live S332)");
  });

  it("explicit real entity type still wins over the answer fallback", () => {
    const byId = livePath("LLC", "sole_proprietorship");
    for (const id of FORMATION_IDS) {
      assert.ok(!byId.has(id), `${id} must be suppressed when the caller pins sole_proprietorship`);
    }
  });

  it("unknown stays unknown: explicit 'other' + no structure answer -> both formation cards conditional (legacy behavior)", () => {
    const byId = livePath(undefined, "other");
    for (const id of FORMATION_IDS) {
      const card = byId.get(id);
      assert.ok(card, `${id} must still surface when the entity is genuinely unknown`);
      assert.equal(card.applicability, "conditional", `${id} must be conditional, not required, for an unknown entity`);
    }
  });
});
