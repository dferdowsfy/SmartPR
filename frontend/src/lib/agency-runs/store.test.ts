import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRun } from "./store";
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
});
