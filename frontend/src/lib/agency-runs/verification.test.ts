/**
 * Live-workflow evidence and payment feasibility per filing. A requirement
 * mapped to a filing is not evidence that its government workflow works —
 * these checks keep every claim honest (see docs/agency-rollout-plan.md).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AGENCY_FILING_CONFIGS, isFilingLaunchable, type AgencyFilingConfig } from "./filingTypes";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("filing verification status", () => {
  it("every filing declares its evidence", () => {
    for (const c of AGENCY_FILING_CONFIGS) {
      assert.ok(c.verification, `${c.id} has no verification record`);
      assert.ok(c.verification.evidence.trim().length > 20, `${c.id} evidence is too thin`);
    }
  });

  it("observed / rehearsed / verified claims carry a live-observation date", () => {
    for (const c of AGENCY_FILING_CONFIGS) {
      if (["partially_observed", "rehearsed", "verified"].includes(c.verification.status) && c.agencyId !== "DEMO_REHEARSAL") {
        assert.match(c.verification.checkedAt ?? "", DATE, `${c.id} needs checkedAt`);
      }
    }
  });

  it("rehearsed requires a fixture route and a browser test", () => {
    for (const c of AGENCY_FILING_CONFIGS) {
      if (c.verification.status === "rehearsed") {
        assert.ok(c.verification.fixture?.route.startsWith("/rehearsal-portal"), `${c.id} fixture route`);
        assert.ok(c.verification.fixture?.test.match(/\.e2e\.(mjs|mts|ts)$/), `${c.id} fixture test`);
      }
    }
  });

  it("verified requires a recorded portal confirmation — none exists yet", () => {
    for (const c of AGENCY_FILING_CONFIGS) {
      if (c.verification.status === "verified") {
        const conf = c.verification.confirmation;
        assert.ok(conf?.reference && conf.recordedBy && DATE.test(conf.recordedAt), `${c.id} verified without a recorded confirmation`);
      }
    }
    // Update only with recorded pilot evidence — never because a mapping exists.
    assert.deepEqual(
      AGENCY_FILING_CONFIGS.filter((c) => c.verification.status === "verified").map((c) => c.id),
      []
    );
  });

  it("a flow with no playbook is at most 'mapped' or 'documented'", () => {
    for (const c of AGENCY_FILING_CONFIGS) {
      if (!c.playbook && c.agencyId !== "DEMO_REHEARSAL") {
        assert.ok(["mapped", "documented"].includes(c.verification.status), `${c.id} claims ${c.verification.status} without a playbook`);
      }
    }
  });
});

describe("payment feasibility", () => {
  it("every filing has a researched payment record", () => {
    for (const c of AGENCY_FILING_CONFIGS) {
      assert.ok(c.payment, `${c.id} has no payment feasibility`);
      assert.ok(c.payment.integrationEvidence.trim().length > 5, `${c.id} payment evidence`);
    }
  });

  it("without an authorized integration Mita only hands payment to the human", () => {
    for (const c of AGENCY_FILING_CONFIGS) {
      if (c.payment.integration !== "authorized_integration") {
        assert.notEqual(c.payment.smartprPath as string, "smartpr_initiated", c.id);
        assert.ok(["user_pays_in_portal", "no_payment_step"].includes(c.payment.smartprPath), c.id);
      }
      if (c.payment.governmentFee === "yes") {
        assert.equal(c.payment.smartprPath, "user_pays_in_portal", `${c.id} charges a fee: the human pays in the portal`);
      }
    }
  });

  it("no agency has an authorized SmartPR payment integration today", () => {
    assert.deepEqual(
      AGENCY_FILING_CONFIGS.filter((c) => c.payment.integration === "authorized_integration").map((c) => c.id),
      []
    );
  });
});

describe("launch switch", () => {
  const corp = AGENCY_FILING_CONFIGS.find((c) => c.id === "DEPT_STATE_CORPORATE_FILING") as AgencyFilingConfig;

  it("Dept. of State corporation formation is disabled by default", () => {
    assert.equal(isFilingLaunchable(corp, {}), false);
  });

  it("only an explicit env flag turns it on (and off again)", () => {
    assert.equal(isFilingLaunchable(corp, { MITA_FLOW_DEPT_STATE_CORPORATION: "on" }), true);
    assert.equal(isFilingLaunchable(corp, { MITA_FLOW_DEPT_STATE_CORPORATION: "off" }), false);
    assert.equal(isFilingLaunchable(corp, { MITA_FLOW_DEPT_STATE_CORPORATION: "maybe" }), false);
  });

  it("disabled variants never launch, whatever the env says", () => {
    for (const id of ["DEPT_STATE_LLC_FORMATION", "DEPT_STATE_ANNUAL_REPORT", "SURI_MERCHANT_REGISTRATION"]) {
      const c = AGENCY_FILING_CONFIGS.find((x) => x.id === id) as AgencyFilingConfig;
      const env = c.launch ? { [c.launch.envFlag]: "on" } : {};
      assert.equal(isFilingLaunchable(c, env), false, id);
    }
  });
});
