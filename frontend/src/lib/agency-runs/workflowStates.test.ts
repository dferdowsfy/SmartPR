import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isTerminalWorkflowState,
  workflowStateForRun,
  workflowStatusLine,
} from "./workflowStates";
import type { AgencyPauseReason, AgencyRunStatus } from "./types";

describe("workflowStateForRun", () => {
  it("maps queued -> PREPARING", () => {
    assert.equal(
      workflowStateForRun({ status: "queued", pauseReason: null }),
      "PREPARING"
    );
  });

  it("maps running -> AUTOMATING", () => {
    assert.equal(
      workflowStateForRun({ status: "running", pauseReason: null }),
      "AUTOMATING"
    );
  });

  it("maps paused -> WAITING_FOR_USER for every pause reason", () => {
    const reasons: AgencyPauseReason[] = [
      "USER_LOGIN",
      "USER_UPLOAD",
      "CAPTCHA",
      "PAYMENT",
      null,
    ];
    for (const pauseReason of reasons) {
      assert.equal(
        workflowStateForRun({ status: "paused", pauseReason }),
        "WAITING_FOR_USER",
        `reason ${pauseReason}`
      );
    }
  });

  it("maps paused with pauseStreak >= 3 -> BLOCKED", () => {
    for (const pauseStreak of [3, 4, 10]) {
      assert.equal(
        workflowStateForRun({ status: "paused", pauseReason: "CAPTCHA", pauseStreak }),
        "BLOCKED",
        `streak ${pauseStreak}`
      );
    }
  });

  it("keeps paused with pauseStreak < 3 -> WAITING_FOR_USER", () => {
    for (const pauseStreak of [0, 1, 2, undefined]) {
      assert.equal(
        workflowStateForRun({
          status: "paused",
          pauseReason: "USER_LOGIN",
          pauseStreak,
        }),
        "WAITING_FOR_USER",
        `streak ${pauseStreak}`
      );
    }
  });

  it("maps review -> READY_FOR_REVIEW", () => {
    assert.equal(
      workflowStateForRun({ status: "review", pauseReason: null }),
      "READY_FOR_REVIEW"
    );
  });

  it("maps stopped -> NOT_STARTED (user stopped it)", () => {
    assert.equal(
      workflowStateForRun({ status: "stopped", pauseReason: null }),
      "NOT_STARTED"
    );
  });

  it("maps failed -> FAILED", () => {
    assert.equal(
      workflowStateForRun({ status: "failed", pauseReason: null }),
      "FAILED"
    );
  });

  it("covers every AgencyRunStatus without throwing", () => {
    const statuses: AgencyRunStatus[] = [
      "queued",
      "running",
      "paused",
      "review",
      "stopped",
      "failed",
    ];
    for (const status of statuses) {
      assert.ok(workflowStateForRun({ status, pauseReason: null }));
    }
  });
});

describe("workflowStatusLine", () => {
  it("PREPARING copy in EN and ES", () => {
    assert.equal(
      workflowStatusLine("PREPARING", "en"),
      "Preparing your filing…"
    );
    assert.equal(
      workflowStatusLine("PREPARING", "es"),
      "Preparando tu radicación…"
    );
  });

  it("AUTOMATING names the portal and appends the detail on a second line", () => {
    const line = workflowStatusLine(
      "AUTOMATING",
      "en",
      { en: "SURI", es: "SURI" },
      {
        en: "Completing business information",
        es: "Completando la información del negocio",
      }
    );
    assert.equal(line, "Working on SURI…\nCompleting business information");

    const lineEs = workflowStatusLine(
      "AUTOMATING",
      "es",
      { en: "SURI", es: "SURI" },
      {
        en: "Completing business information",
        es: "Completando la información del negocio",
      }
    );
    assert.equal(lineEs, "Trabajando en SURI…\nCompletando la información del negocio");
  });

  it("AUTOMATING falls back to a generic portal when no portalName", () => {
    assert.equal(
      workflowStatusLine("AUTOMATING", "en"),
      "Working on the portal…"
    );
    assert.equal(
      workflowStatusLine("AUTOMATING", "es"),
      "Trabajando en el portal…"
    );
  });

  it("WAITING_FOR_USER / BLOCKED / FAILED copy in both languages", () => {
    assert.equal(
      workflowStatusLine("WAITING_FOR_USER", "en"),
      "I need one item from you."
    );
    assert.equal(
      workflowStatusLine("WAITING_FOR_USER", "es"),
      "Necesito un dato tuyo."
    );
    assert.equal(
      workflowStatusLine("BLOCKED", "en"),
      "I'm stuck on something I can't fix alone."
    );
    assert.equal(
      workflowStatusLine("BLOCKED", "es"),
      "Me tranqué en algo que no puedo resolver solo."
    );
    assert.equal(
      workflowStatusLine("FAILED", "en"),
      "Something didn't work — here's what happened."
    );
    assert.equal(
      workflowStatusLine("FAILED", "es"),
      "Algo no funcionó — esto fue lo que pasó."
    );
  });

  it("READY_FOR_REVIEW copy", () => {
    assert.equal(
      workflowStatusLine("READY_FOR_REVIEW", "en"),
      "Your application is ready for review."
    );
    assert.equal(
      workflowStatusLine("READY_FOR_REVIEW", "es"),
      "Tu solicitud está lista para revisión."
    );
  });
});

describe("isTerminalWorkflowState", () => {
  it("COMPLETED and FAILED are terminal", () => {
    assert.equal(isTerminalWorkflowState("COMPLETED"), true);
    assert.equal(isTerminalWorkflowState("FAILED"), true);
  });

  it("all other states are non-terminal", () => {
    const states = [
      "NOT_STARTED",
      "PREPARING",
      "READY",
      "AUTOMATING",
      "WAITING_FOR_USER",
      "VALIDATING_USER_INPUT",
      "RESUMING",
      "BLOCKED",
      "READY_FOR_REVIEW",
      "SUBMITTING",
    ] as const;
    for (const s of states) {
      assert.equal(isTerminalWorkflowState(s), false, s);
    }
  });
});
