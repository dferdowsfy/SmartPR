import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeFiling, createRun, listRunsForBusiness, peekRun } from "./store";
import type { SubmissionObjective } from "./types";

const objective: SubmissionObjective = {
  submission_objective_id: "obj-123",
  business_id: "biz-1",
  requirement_id: "DOC_SURI_REGISTRATION",
  requirement_name: "Register with SURI",
  obligation_id: "obl-1",
  obligation_status: "MISSING",
  agency: "Hacienda / SURI",
  transaction_type: "SURI_REGISTER_TAXPAYER",
  target_portal: "SURI (https://suri.hacienda.pr.gov)",
  approved_fields: [],
  approved_documents: [],
  ready_to_start: true,
};

describe("createRun submission-objective gate", () => {
  it("refuses a filing whose launch switch is off (Dept. of State corporation by default)", async () => {
    const prev = process.env.MITA_FLOW_DEPT_STATE_CORPORATION;
    delete process.env.MITA_FLOW_DEPT_STATE_CORPORATION;
    try {
      await assert.rejects(
        () => createRun({ business_id: "biz-1", filing_type: "DEPT_STATE_CORPORATE_FILING", submissionObjective: { ...objective, transaction_type: "DEPT_STATE_CORPORATE_FILING" } }),
        /not available to launch/
      );
      await assert.rejects(
        () => createRun({ business_id: "biz-1", filing_type: "DEPT_STATE_LLC_FORMATION", submissionObjective: objective }),
        /not available to launch/
      );
    } finally {
      if (prev !== undefined) process.env.MITA_FLOW_DEPT_STATE_CORPORATION = prev;
    }
  });

  it("refuses to create a run when the objective is not ready to start", async () => {
    await assert.rejects(
      () =>
        createRun({
          business_id: "biz-1",
          filing_type: "SURI_REGISTER_TAXPAYER",
          submissionObjective: { ...objective, ready_to_start: false },
        }),
      /not ready to start/
    );
  });

  it("exposes the objective on the public run payload", async () => {
    const run = await createRun({
      business_id: "biz-1",
      filing_type: "SURI_REGISTER_TAXPAYER",
      submissionObjective: objective,
    });
    assert.ok(run.id);
    assert.equal(run.submission_objective?.submission_objective_id, "obj-123");
    assert.equal(run.submission_objective?.obligation_id, "obl-1");
    assert.equal(run.submission_objective?.requirement_id, "DOC_SURI_REGISTRATION");
  });

  it("starts with filing unauthorized and no confirmation", async () => {
    const run = await createRun({
      business_id: "biz-1",
      filing_type: "SURI_REGISTER_TAXPAYER",
      submissionObjective: objective,
    });
    assert.equal(run.filing_authorized, false);
    assert.equal(run.filing_confirmation, null);
  });
});

describe("listRunsForBusiness", () => {
  it("returns the run id so in-progress filings can offer Resume", async () => {
    const run = await createRun({
      business_id: "biz-resume",
      filing_type: "SURI_REGISTER_TAXPAYER",
      submissionObjective: { ...objective, business_id: "biz-resume" },
    });
    const listed = listRunsForBusiness("biz-resume");
    const entry = listed.find((r) => r.filing_type === "SURI_REGISTER_TAXPAYER");
    assert.ok(entry);
    assert.equal(entry.id, run.id);
    assert.equal(entry.status, run.status);
  });
});

describe("authorizeFiling", () => {
  it("returns null for an unknown run id", async () => {
    assert.equal(await authorizeFiling("nope"), null);
  });

  it("is a no-op when the run is not at pre-submit review", async () => {
    const run = await createRun({
      business_id: "biz-1",
      filing_type: "SURI_REGISTER_TAXPAYER",
      submissionObjective: objective,
    });
    // Fresh mock run is mid-flow, not review — authorization must not arm.
    assert.notEqual(run.status, "review");
    const after = await authorizeFiling(run.id);
    assert.ok(after);
    assert.equal(after.filing_authorized, false);
    assert.equal(after.status, run.status);
  });

  it("never lets the agent submit — final submission is human-only", async () => {
    const run = await createRun({
      business_id: "biz-1",
      filing_type: "SURI_REGISTER_TAXPAYER",
      submissionObjective: objective,
    });
    // Deterministic review state without wall-clock mock beats.
    const internal = peekRun(run.id);
    assert.ok(internal);
    internal.status = "review";
    const after = await authorizeFiling(run.id);
    assert.ok(after);
    assert.equal(after.status, "review", "run stays at review for the human to submit");
    assert.equal(after.filing_authorized, false);
    assert.equal(after.filing_confirmation, null);
  });
});
