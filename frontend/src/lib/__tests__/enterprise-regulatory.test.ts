// Unit tests for the Phase 5 regulatory change impact core (pure logic).
// Run with:
//   npx tsx --test src/lib/__tests__/enterprise-regulatory.test.ts
//
// DB-level idempotency (ON CONFLICT upsert preserving ack/implementation
// status; no obligation_work writes for non-effective events) is verified
// against the live project via data-level checks — see the phase 5 report.
import test from "node:test";
import assert from "node:assert/strict";
import {
  REGULATORY_LIFECYCLES,
  LIFECYCLE_LABELS,
  LIFECYCLE_TRANSITIONS,
  canTransitionLifecycle,
  mayTriggerRemediation,
  applicabilityFor,
  sanitizeTargeting,
  normalizeTag,
  matchObligation,
  matchFacility,
  impactMatchKey,
  requiredActionForObligation,
  requiredActionForBusiness,
  requiredActionForFacility,
  requiredActionForProject,
  isImplementationStatus,
  type ObligationCandidate,
} from "../enterprise-regulatory";

const candidate: ObligationCandidate = {
  obligation_id: "11111111-1111-1111-1111-111111111111",
  obligation_name: "Permiso Único",
  agency: "OGPe",
  requirement_id: "DOC_PERMISO_UNICO",
  business_id: "22222222-2222-2222-2222-222222222222",
  business_name: "Caribe Industrial Manufacturing LLC",
  business_type: "Manufacturing",
  industry: "Manufacturing",
  municipality: "San Juan",
  matter_id: null,
};

// ---------------------------------------------------------------------------
// Lifecycle state machine
// ---------------------------------------------------------------------------

test("lifecycle transition guards: the happy path", () => {
  assert.ok(canTransitionLifecycle("proposed", "pending_review"));
  assert.ok(canTransitionLifecycle("pending_review", "enacted_not_effective"));
  assert.ok(canTransitionLifecycle("enacted_not_effective", "effective"));
});

test("lifecycle transition guards: skipping stages is rejected", () => {
  assert.ok(!canTransitionLifecycle("proposed", "enacted_not_effective"));
  assert.ok(!canTransitionLifecycle("proposed", "effective"));
  assert.ok(!canTransitionLifecycle("pending_review", "effective"));
});

test("lifecycle transition guards: backward movement is rejected", () => {
  assert.ok(!canTransitionLifecycle("pending_review", "proposed"));
  assert.ok(!canTransitionLifecycle("effective", "enacted_not_effective"));
  assert.ok(!canTransitionLifecycle("effective", "pending_review"));
});

test("lifecycle transition guards: any state may be superseded, superseded is terminal", () => {
  for (const from of REGULATORY_LIFECYCLES) {
    if (from === "superseded") continue;
    assert.ok(canTransitionLifecycle(from, "superseded"), `${from} -> superseded`);
  }
  for (const to of REGULATORY_LIFECYCLES) {
    assert.ok(!canTransitionLifecycle("superseded", to), `superseded -> ${to}`);
  }
});

test("LIFECYCLE_TRANSITIONS covers all five states", () => {
  assert.deepEqual(Object.keys(LIFECYCLE_TRANSITIONS).sort(), [...REGULATORY_LIFECYCLES].sort());
});

// ---------------------------------------------------------------------------
// The critical rule: remediation only when effective
// ---------------------------------------------------------------------------

test("only effective events may trigger remediation", () => {
  assert.ok(mayTriggerRemediation("effective"));
  assert.ok(!mayTriggerRemediation("proposed"));
  assert.ok(!mayTriggerRemediation("pending_review"));
  assert.ok(!mayTriggerRemediation("enacted_not_effective"));
  assert.ok(!mayTriggerRemediation("superseded"));
});

test("non-effective events produce projected impacts; effective produces confirmed", () => {
  assert.equal(applicabilityFor("proposed"), "projected");
  assert.equal(applicabilityFor("pending_review"), "projected");
  assert.equal(applicabilityFor("enacted_not_effective"), "projected");
  assert.equal(applicabilityFor("superseded"), "projected");
  assert.equal(applicabilityFor("effective"), "confirmed");
});

test("required action text differs between projected and effective", () => {
  const projected = requiredActionForObligation(
    {
      title: "Fee schedule update",
      regulatory_source: "OGPe",
      source_version: "2026-09",
      lifecycle: "enacted_not_effective",
      effective_date: "2026-10-01",
    },
    "Permiso Único",
    "Caribe Industrial"
  );
  const effective = requiredActionForObligation(
    {
      title: "Fee schedule update",
      regulatory_source: "OGPe",
      source_version: "2026-09",
      lifecycle: "effective",
      effective_date: "2026-10-01",
    },
    "Permiso Único",
    "Caribe Industrial"
  );
  assert.ok(projected.includes("Not yet effective"));
  assert.ok(!projected.includes("Effective 2026-10-01"));
  assert.ok(effective.includes("Effective 2026-10-01"));
  assert.ok(!effective.includes("Not yet effective"));
  // The human-entered source is always cited; nothing is invented.
  assert.ok(projected.includes("OGPe"));
  assert.ok(projected.includes("2026-09"));
});

// ---------------------------------------------------------------------------
// Targeting sanitization
// ---------------------------------------------------------------------------

test("sanitizeTargeting drops non-arrays, trims, dedupes, and drops empties", () => {
  const out = sanitizeTargeting({
    agency_names: [" OGPe ", "OGPe", "", 42, null],
    municipalities: "San Juan",
    business_types: [],
    unknown_key: ["x"],
  });
  assert.deepEqual(out, { agency_names: ["OGPe"] });
});

test("sanitizeTargeting returns {} for non-objects", () => {
  assert.deepEqual(sanitizeTargeting(null), {});
  assert.deepEqual(sanitizeTargeting("x"), {});
  assert.deepEqual(sanitizeTargeting([]), {});
});

test("normalizeTag is case/whitespace insensitive", () => {
  assert.equal(normalizeTag("  OGPe "), normalizeTag("ogpe"));
  assert.equal(normalizeTag(null), "");
});

// ---------------------------------------------------------------------------
// Obligation matching
// ---------------------------------------------------------------------------

test("explicit obligation pick matches regardless of tags", () => {
  const m = matchObligation(
    {
      obligation_ids: [candidate.obligation_id],
      agency_names: ["IRS"], // would otherwise fail
    },
    candidate
  );
  assert.ok(m.matched);
  assert.ok(m.basis.includes("reviewer"));
});

test("explicit business pick matches the business's obligations", () => {
  const m = matchObligation({ business_ids: [candidate.business_id] }, candidate);
  assert.ok(m.matched);
  assert.ok(m.basis.includes("Caribe Industrial"));
});

test("tag matching: single group matches", () => {
  const m = matchObligation({ agency_names: ["ogpe"] }, candidate);
  assert.ok(m.matched);
  assert.ok(m.basis.includes("agency"));
});

test("tag matching: AND across specified groups", () => {
  const both = matchObligation(
    { agency_names: ["OGPe"], municipalities: ["San Juan"] },
    candidate
  );
  assert.ok(both.matched);
  assert.ok(both.basis.includes("agency"));
  assert.ok(both.basis.includes("municipality"));

  const fail = matchObligation(
    { agency_names: ["OGPe"], municipalities: ["Ponce"] },
    candidate
  );
  assert.ok(!fail.matched);
});

test("tag matching: empty targeting never matches", () => {
  assert.ok(!matchObligation({}, candidate).matched);
  assert.ok(!matchObligation({ agency_names: [] }, candidate).matched);
});

test("tag matching: requirement_names match on obligation name", () => {
  assert.ok(matchObligation({ requirement_names: ["Permiso Único"] }, candidate).matched);
  assert.ok(
    !matchObligation({ requirement_names: ["Patente Municipal"] }, candidate).matched
  );
});

test("tag matching: OR within a group", () => {
  const m = matchObligation(
    { municipalities: ["Ponce", "San Juan", "Bayamón"] },
    candidate
  );
  assert.ok(m.matched);
});

// ---------------------------------------------------------------------------
// Facility matching
// ---------------------------------------------------------------------------

test("facility matching: explicit pick, affected business, municipality tag", () => {
  const fac = {
    facility_id: "33333333-3333-3333-3333-333333333333",
    facility_name: "Planta Norte",
    business_id: candidate.business_id,
    municipality: "San Juan",
  };
  const affected = new Set<string>();

  const byPick = matchFacility(
    { facility_ids: [fac.facility_id] },
    fac,
    affected
  );
  assert.ok(byPick.matched);

  const byBusiness = matchFacility({}, fac, new Set([candidate.business_id]));
  assert.ok(byBusiness.matched);
  assert.ok(byBusiness.basis.includes("affected business"));

  const byMuni = matchFacility({ municipalities: ["san juan"] }, fac, affected);
  assert.ok(byMuni.matched);

  const noMatch = matchFacility({ municipalities: ["Ponce"] }, fac, affected);
  assert.ok(!noMatch.matched);
});

// ---------------------------------------------------------------------------
// Idempotency primitives
// ---------------------------------------------------------------------------

test("impactMatchKey is deterministic per entity level", () => {
  assert.equal(impactMatchKey("obligation", "abc"), "obligation:abc");
  assert.equal(impactMatchKey("obligation", "abc"), impactMatchKey("obligation", "abc"));
  assert.notEqual(impactMatchKey("obligation", "abc"), impactMatchKey("business", "abc"));
});

test("isImplementationStatus accepts only the three states", () => {
  assert.ok(isImplementationStatus("not_started"));
  assert.ok(isImplementationStatus("in_progress"));
  assert.ok(isImplementationStatus("implemented"));
  assert.ok(!isImplementationStatus("done"));
  assert.ok(!isImplementationStatus(null));
});

// ---------------------------------------------------------------------------
// Guard consistency: applicability === 'confirmed' exactly when remediation
// may be triggered (the invariant compute-impact relies on).
// ---------------------------------------------------------------------------

test("applicability and remediation permission never disagree", () => {
  for (const lc of REGULATORY_LIFECYCLES) {
    const confirmed = applicabilityFor(lc) === "confirmed";
    assert.equal(
      mayTriggerRemediation(lc),
      confirmed,
      `${lc}: applicability=${applicabilityFor(lc)} must agree with mayTriggerRemediation`
    );
  }
});

test("LIFECYCLE_LABELS covers every lifecycle (detail UI never shows a raw key)", () => {
  for (const lc of REGULATORY_LIFECYCLES) {
    assert.ok(LIFECYCLE_LABELS[lc] && LIFECYCLE_LABELS[lc].length > 0, lc);
  }
});

test("enacted_not_effective is the only gateway to effective", () => {
  for (const from of REGULATORY_LIFECYCLES) {
    if (from === "enacted_not_effective") continue;
    assert.ok(
      !canTransitionLifecycle(from, "effective"),
      `${from} must not jump straight to effective`
    );
  }
  assert.ok(canTransitionLifecycle("enacted_not_effective", "effective"));
});

// ---------------------------------------------------------------------------
// Required-action text per entity level
// ---------------------------------------------------------------------------

const BRIEF_EFFECTIVE = {
  title: "Fee schedule update",
  regulatory_source: "OGPe",
  source_version: "2026-09",
  lifecycle: "effective" as const,
  effective_date: "2026-10-01",
};
const BRIEF_PROJECTED = { ...BRIEF_EFFECTIVE, lifecycle: "enacted_not_effective" as const };

test("per-level action text warns when not yet effective, never when effective", () => {
  const projectedTexts = [
    requiredActionForBusiness(BRIEF_PROJECTED, "Caribe Industrial"),
    requiredActionForFacility(BRIEF_PROJECTED, "Planta Norte", "San Juan"),
    requiredActionForProject(BRIEF_PROJECTED, "New filing"),
  ];
  for (const t of projectedTexts) {
    assert.ok(t.includes("not yet effective"), t.slice(0, 60));
    assert.ok(t.includes("OGPe"), "source is always cited");
  }
  const effectiveTexts = [
    requiredActionForBusiness(BRIEF_EFFECTIVE, "Caribe Industrial"),
    requiredActionForFacility(BRIEF_EFFECTIVE, "Planta Norte", "San Juan"),
    requiredActionForProject(BRIEF_EFFECTIVE, "New filing"),
  ];
  for (const t of effectiveTexts) {
    assert.ok(!t.includes("not yet effective"));
  }
});

// ---------------------------------------------------------------------------
// Targeting: remaining groups
// ---------------------------------------------------------------------------

test("sanitizeTargeting keeps explicit id picks (obligation/business/facility)", () => {
  const out = sanitizeTargeting({
    obligation_ids: [candidate.obligation_id, "junk-not-a-uuid"],
    business_ids: [candidate.business_id],
    facility_ids: ["33333333-3333-3333-3333-333333333333"],
    industries: [" Manufacturing "],
  });
  // sanitizeTargeting does not validate UUID shape (routes do); it cleans strings.
  assert.deepEqual(out.obligation_ids, [candidate.obligation_id, "junk-not-a-uuid"]);
  assert.deepEqual(out.business_ids, [candidate.business_id]);
  assert.deepEqual(out.industries, ["Manufacturing"]);
});

test("tag matching: industries and business_types groups", () => {
  assert.ok(
    matchObligation({ industries: ["manufacturing"] }, candidate).matched
  );
  assert.ok(
    matchObligation({ business_types: ["Retail"] }, candidate).matched === false
  );
  // AND across groups still enforced with the new groups
  assert.ok(
    matchObligation(
      { business_types: ["Manufacturing"], industries: ["Manufacturing"] },
      candidate
    ).matched
  );
});

test("facility matching: facility with no business and no municipality never matches", () => {
  const orphan = {
    facility_id: "44444444-4444-4444-4444-444444444444",
    facility_name: "Orphan site",
    business_id: null,
    municipality: null,
  };
  assert.ok(!matchFacility({ municipalities: ["San Juan"] }, orphan, new Set()).matched);
  assert.ok(!matchFacility({}, orphan, new Set()).matched);
});
