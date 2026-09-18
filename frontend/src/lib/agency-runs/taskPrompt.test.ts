import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAgencyTaskPrompt, submissionObjectivePromptBlock } from "./taskPrompt";
import { getFilingConfig } from "./filingTypes";
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
  approved_fields: ["business.legalName", "contact.email"],
  approved_documents: ["DOC_PHOTO_ID"],
  ready_to_start: true,
};

describe("submissionObjectivePromptBlock", () => {
  it("renders the structured objective — ids and labels only", () => {
    const block = submissionObjectivePromptBlock(objective);
    assert.ok(block.includes("=== SUBMISSION OBJECTIVE ==="));
    assert.ok(block.includes("submission_objective_id: obj-123"));
    assert.ok(block.includes("requirement_id: DOC_SURI_REGISTRATION"));
    assert.ok(block.includes("obligation_id: obl-1"));
    assert.ok(block.includes("transaction_type: SURI_REGISTER_TAXPAYER"));
    assert.ok(block.includes("approved_fields: business.legalName, contact.email"));
    assert.ok(block.includes("approved_documents: DOC_PHOTO_ID"));
    assert.ok(block.includes("=== END SUBMISSION OBJECTIVE ==="));
  });

  it("carries the strict one-objective guardrail", () => {
    const block = submissionObjectivePromptBlock(objective);
    assert.ok(
      block.includes("You are executing ONE SmartPR filing objective. Complete only this filing.")
    );
    assert.ok(block.includes("Do not choose a different transaction."));
    assert.ok(block.includes("Do not infer missing facts."));
    assert.ok(block.includes("Do not add new requirements."));
    assert.ok(block.includes("Stop and report a blocker"));
  });

  it("renders (none) for a null requirement_id without breaking the guardrail", () => {
    const block = submissionObjectivePromptBlock({ ...objective, requirement_id: null });
    assert.ok(block.includes("requirement_id: (none)"));
    assert.ok(block.includes("Do not choose a different transaction."));
  });
});

describe("buildAgencyTaskPrompt with a submission objective", () => {
  it("places the objective block at the very top of the prompt", () => {
    const config = getFilingConfig("SURI_REGISTER_TAXPAYER");
    const task = buildAgencyTaskPrompt({
      config,
      passport: null,
      goalBrief: null,
      submissionObjective: objective,
    });
    assert.ok(task.startsWith("=== SUBMISSION OBJECTIVE ==="));
    assert.ok(task.indexOf("=== SUBMISSION OBJECTIVE ===") < task.indexOf("You are SmartPR's agency filing assistant"));
  });

  it("omits the block when no objective is supplied (legacy call sites)", () => {
    const config = getFilingConfig("SURI_REGISTER_TAXPAYER");
    const task = buildAgencyTaskPrompt({ config, passport: null, goalBrief: null });
    assert.ok(!task.includes("=== SUBMISSION OBJECTIVE ==="));
  });
});
