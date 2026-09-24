import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAgencyTaskPrompt, buildAuthorizeTaskPrompt, buildResumeTaskPrompt, renderPlaybookProcedure, submissionObjectivePromptBlock } from "./taskPrompt";
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

describe("buildAgencyTaskPrompt final-submit permission", () => {
  const config = getFilingConfig("SURI_REGISTER_TAXPAYER");

  it("withholds submit permission and the SUBMITTED marker by default", () => {
    const task = buildAgencyTaskPrompt({
      config,
      passport: null,
      goalBrief: null,
      submissionObjective: objective,
    });
    assert.ok(task.includes("NEVER click the final Submit"));
    assert.ok(task.includes("REVIEW_READY"));
    assert.ok(!task.includes("SUBMITTED:"), "unauthorized prompt must not mention the SUBMITTED marker");
    assert.ok(!task.includes("AUTHORIZED FINAL SUBMISSION"));
  });

  it("grants submit permission only when authorizedFiling is true", () => {
    const task = buildAgencyTaskPrompt({
      config,
      passport: null,
      goalBrief: null,
      submissionObjective: objective,
      authorizedFiling: true,
    });
    assert.ok(task.includes("AUTHORIZED FINAL SUBMISSION"));
    assert.ok(task.includes("SUBMITTED:<confirmation>"));
    assert.ok(!task.includes("NEVER click the final Submit"));
  });

  it("buildAuthorizeTaskPrompt produces the authorized resume block", () => {
    const task = buildAuthorizeTaskPrompt({
      config,
      passport: null,
      goalBrief: null,
      submissionObjective: objective,
    });
    assert.ok(task.includes("explicitly authorized final submission"));
    assert.ok(task.includes("filing_authorized=true"));
    assert.ok(task.includes("SUBMITTED:<confirmation>"));
    assert.ok(!task.includes("NEVER click the final Submit"));
  });

  it("buildResumeTaskPrompt threads authorizedFiling through", () => {
    const authed = buildResumeTaskPrompt({
      config,
      pauseReason: "REVIEW_READY",
      passport: null,
      authorizedFiling: true,
    });
    assert.ok(authed.includes("AUTHORIZED FINAL SUBMISSION"));
    const plain = buildResumeTaskPrompt({
      config,
      pauseReason: "USER_LOGIN",
      passport: null,
    });
    assert.ok(plain.includes("NEVER click the final Submit"));
    assert.ok(!plain.includes("SUBMITTED:"));
  });
});

describe("renderPlaybookProcedure", () => {
  it("returns null when the config has no playbook", () => {
    const config = getFilingConfig("SURI_MERCHANT_REGISTRATION");
    assert.equal(renderPlaybookProcedure(config), null);
  });

  it("returns null for a playbook with no steps", () => {
    const config = getFilingConfig("SURI_MERCHANT_REGISTRATION");
    assert.equal(
      renderPlaybookProcedure({ ...config, playbook: { steps: [] } as never }),
      null
    );
  });

  it("renders Department of State steps in recorded order with channel semantics", () => {
    const config = getFilingConfig("DEPT_STATE_CORPORATE_FILING");
    const rendered = renderPlaybookProcedure(config);
    assert.ok(rendered, "playbook should render");
    const lines = rendered!.split("\n");
    // Scope header first, then numbered steps in order.
    assert.ok(lines[0].startsWith("PLAYBOOK PROCEDURE —"));
    const stepLines = lines.filter((l) => /^\d+\. /.test(l));
    const playbook = config.playbook!;
    assert.equal(stepLines.length, playbook.steps.length);
    stepLines.forEach((line, i) => {
      const step = playbook.steps[i];
      assert.ok(
        line.startsWith(`${i + 1}. ${step.label_en} [${step.channel}:`),
        `step ${i + 1} renders in order with its channel: ${line}`
      );
    });
    // Channel notes spell out the inline-first behavior. (Dept. of State has
    // no login step, so no VAULT note renders for it — VAULT rendering is
    // covered below. The walkthrough observed no sensitive fields here, so
    // no sensitive=true flag renders for it either.)
    assert.ok(rendered!.includes("emit REQUIRED_FIELDS with exactly these ids"));
    assert.ok(rendered!.includes("pause and invite takeover"));
    assert.ok(rendered!.includes("drive this step yourself"));
    assert.ok(rendered!.includes("CONFIRMATION — capture and report:"));
    assert.ok(rendered!.includes(playbook.confirmation.reference_en));
    // Quirks render verbatim (they are observed facts, not invented).
    if (playbook.quirks_en.length > 0) {
      assert.ok(rendered!.includes(playbook.quirks_en[0]));
    }
  });

  it("is deterministic — same config renders identically", () => {
    const config = getFilingConfig("DEPT_STATE_CORPORATE_FILING");
    assert.equal(renderPlaybookProcedure(config), renderPlaybookProcedure(config));
  });

  it("renders the VAULT channel note for login steps", () => {
    const config = getFilingConfig("SURI_REGISTER_TAXPAYER");
    const rendered = renderPlaybookProcedure({
      ...config,
      playbook: {
        scope_en: "test",
        scope_es: "prueba",
        steps: [
          {
            id: "login",
            label_en: "Login",
            label_es: "Iniciar sesión",
            channel: "VAULT",
            fields: [
              {
                id: "password",
                label_en: "Password",
                label_es: "Contraseña",
                type: "password",
                required: true,
                sensitive: true,
              },
            ],
            gate: "login",
          },
        ],
        confirmation: {
          reference_en: "code",
          reference_es: "código",
          where_en: "screen",
          where_es: "pantalla",
        },
        quirks_en: [],
        quirks_es: [],
      },
    });
    assert.ok(rendered);
    assert.ok(rendered.includes("[VAULT: credentials come from Secure Vault"));
    assert.ok(rendered.includes("id=password; label=Password; type=password"));
    assert.ok(rendered.includes("sensitive=true"));
    assert.ok(rendered.includes("GATE: login"));
  });
});

describe("buildAgencyTaskPrompt with playbooks", () => {
  it("uses the playbook block when the config carries one", () => {
    const config = getFilingConfig("DEPT_STATE_CORPORATE_FILING");
    const task = buildAgencyTaskPrompt({ config, passport: null });
    assert.ok(task.includes("PLAYBOOK PROCEDURE (goal-oriented"));
    assert.ok(task.includes("[INLINE:"));
    assert.ok(task.includes("sensitive=true"));
    // Portal identity appears once — on the config lines, not duplicated
    // inside playbook steps.
    assert.ok(task.includes(config.startUrl));
  });

  it("falls back to the procedureEn outline when there is no playbook", () => {
    const config = getFilingConfig("SURI_MERCHANT_REGISTRATION");
    assert.equal(renderPlaybookProcedure(config), null);
    const task = buildAgencyTaskPrompt({ config, passport: null });
    assert.ok(task.includes("PROCEDURE OUTLINE (goal-oriented"));
    assert.ok(task.includes(config.procedureEn[0]));
  });
});

describe("buildAgencyTaskPrompt fill reliability", () => {
  it("instructs the agent to read back field values before submitting", () => {
    const config = getFilingConfig("DEMO_REHEARSAL_PORTAL");
    const task = buildAgencyTaskPrompt({ config, passport: null });
    assert.ok(task.includes("FILL RELIABILITY"));
    assert.ok(task.includes("read that field's value back from the page"));
    assert.ok(task.includes("Never click Submit / Log in / Continue / Guardar while a required field still reads back empty or wrong"));
    assert.ok(task.includes("do not blindly re-click the button"));
  });
});
