/**
 * Live-workflow evidence per filing. A requirement mapped to a filing is
 * not evidence that its government workflow works — these checks keep the
 * claim honest (see docs/agency-rollout-plan.md).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AGENCY_FILING_CONFIGS } from "./filingTypes";

describe("filing verification status", () => {
  it("every filing declares its evidence", () => {
    for (const c of AGENCY_FILING_CONFIGS) {
      assert.ok(c.verification, `${c.id} has no verification record`);
      assert.ok(c.verification.evidence.trim().length > 20, `${c.id} evidence is too thin`);
    }
  });

  it("partial / verified claims carry a live-check date", () => {
    for (const c of AGENCY_FILING_CONFIGS) {
      if (c.verification.status === "partial" || c.verification.status === "verified") {
        assert.match(c.verification.checkedAt ?? "", /^\d{4}-\d{2}-\d{2}$/, `${c.id} needs checkedAt`);
      }
    }
  });

  it("only the fictional portal is rehearsal; no real portal is 'verified' yet", () => {
    // Update this list only with recorded pilot evidence — never because a
    // requirement mapping exists.
    const verified = AGENCY_FILING_CONFIGS.filter((c) => c.verification.status === "verified").map((c) => c.id);
    assert.deepEqual(verified, []);
    for (const c of AGENCY_FILING_CONFIGS) {
      if (c.verification.status === "rehearsal") {
        assert.equal(c.agencyId, "DEMO_REHEARSAL", `${c.id} is a real portal and cannot be 'rehearsal'`);
      }
    }
  });
});
