import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actionStatusChipLabel,
  buildChatMilestones,
  chatScrollKey,
  failureReason,
  filingGateCopy,
  filingPassportCtaCopy,
  filingPickerIntro,
  filingStatusChipLabel,
  filingUnsupportedCopy,
  gateCopy,
  humanizeValidationError,
  interventionHeading,
  isTerminalWorkflowState,
  workflowStateForRun,
  workflowStatusLine,
  type AgencyAction,
  type AgencyRunEvent,
  type FilingOption,
  type FilingStatus,
} from "./chatContracts";

function event(index: number, message: string, kind?: "info" | "pause" | "review"): AgencyRunEvent {
  return {
    index,
    message,
    message_es: `${message} (es)`,
    screenshot_url: "",
    created_at: `2026-09-16T0${index}:00:00Z`,
    kind,
  };
}

const baseAction: AgencyAction = {
  id: "a1",
  filing_type: "SURI_MERCHANT_REGISTRATION",
  agency_id: "HACIENDA_SURI",
  title_en: "Merchant Registration",
  title_es: "Registro de Comerciante",
  agency_en: "Hacienda / SURI",
  agency_es: "Hacienda / SURI",
  status: "ready",
  known: 18,
  total: 20,
  missing_items: [],
  blocked_by: [],
  evidence_available: [],
};

describe("actionStatusChipLabel", () => {
  it("labels ready / blocked / not_required / completed in EN and PR Spanish", () => {
    assert.equal(actionStatusChipLabel(baseAction, "en"), "Ready to start");
    assert.equal(actionStatusChipLabel(baseAction, "es"), "Lista para empezar");

    const blocked = {
      ...baseAction,
      status: "blocked" as const,
      missing_items: [
        { id: "m1", label_en: "Photo ID", label_es: "ID con foto", sensitive: false },
        { id: "m2", label_en: "Utility bill", label_es: "Factura de utilidad", sensitive: false },
      ],
    };
    assert.equal(actionStatusChipLabel(blocked, "en"), "Ready once you add 2 items");
    assert.equal(actionStatusChipLabel(blocked, "es"), "Lista cuando completes 2 piezas");

    const blockedNone = { ...baseAction, status: "blocked" as const, missing_items: [] };
    assert.equal(actionStatusChipLabel(blockedNone, "en"), "Waiting on another step");

    const notReq = { ...baseAction, status: "not_required" as const };
    assert.equal(actionStatusChipLabel(notReq, "es"), "No se requiere por ahora");

    const done = { ...baseAction, status: "completed" as const };
    assert.equal(actionStatusChipLabel(done, "es"), "Completada");
  });
});

describe("workflowStateForRun", () => {
  it("maps run status + pause streak to workflow states", () => {
    assert.equal(
      workflowStateForRun({ status: "queued", pauseReason: null }),
      "PREPARING"
    );
    assert.equal(
      workflowStateForRun({ status: "running", pauseReason: null }),
      "AUTOMATING"
    );
    assert.equal(
      workflowStateForRun({ status: "paused", pauseReason: "CAPTCHA", pauseStreak: 1 }),
      "WAITING_FOR_USER"
    );
    assert.equal(
      workflowStateForRun({ status: "paused", pauseReason: "CAPTCHA", pauseStreak: 3 }),
      "BLOCKED"
    );
    assert.equal(
      workflowStateForRun({ status: "review", pauseReason: null }),
      "READY_FOR_REVIEW"
    );
    assert.equal(
      workflowStateForRun({ status: "failed", pauseReason: null }),
      "FAILED"
    );
  });

  it("marks COMPLETED/FAILED as terminal", () => {
    assert.ok(isTerminalWorkflowState("COMPLETED"));
    assert.ok(isTerminalWorkflowState("FAILED"));
    assert.ok(!isTerminalWorkflowState("AUTOMATING"));
    assert.ok(!isTerminalWorkflowState("WAITING_FOR_USER"));
  });

  it("produces human bilingual status lines with no technical leakage", () => {
    const line = workflowStatusLine("AUTOMATING", "es", "SURI");
    assert.ok(line.includes("Trabajando en SURI"));
    assert.ok(!/selector|timeout|DOM/i.test(line));
  });

  it("appends the waiting detail on a second line", () => {
    const line = workflowStatusLine(
      "WAITING_FOR_USER",
      "en",
      "SURI",
      "Waiting on you: upload the documents"
    );
    assert.ok(line.includes("I need one item from you."));
    assert.ok(line.includes("Waiting on you: upload the documents"));
  });
});

describe("buildChatMilestones", () => {
  it("opens with a start message and merges the burst into one stage milestone", () => {
    const milestones = buildChatMilestones(
      [
        event(0, "Opened the SURI portal"),
        event(1, "Filled the taxpayer name"),
        event(2, "Filled the address"),
      ],
      { portalEn: "SURI", portalEs: "SURI" }
    );
    assert.equal(milestones.length, 2);
    assert.equal(milestones[0].tone, "info");
    assert.ok(milestones[0].heading_en.includes("I'm starting your SURI filing"));
    assert.equal(milestones[1].tone, "info");
    assert.equal(milestones[1].heading_es, "Avanzando con los pasos de la radicación");
    assert.equal(milestones[1].details?.length, 2);
    assert.ok(milestones[1].details?.every((d) => d.done));
  });

  it("splits pause and review events into their own milestones", () => {
    const milestones = buildChatMilestones(
      [
        event(0, "Opened the portal"),
        event(1, "Need your login", "pause"),
        event(2, "Ready for final review", "review"),
      ],
      { portalEn: "SURI", portalEs: "SURI" }
    );
    assert.equal(milestones.length, 3);
    assert.equal(milestones[1].tone, "action");
    assert.equal(milestones[2].tone, "success");
    assert.ok(milestones[2].heading_en.toLowerCase().includes("ready for final review"));
  });

  it("keeps a single info event as just the start message", () => {
    const milestones = buildChatMilestones([event(0, "Opened the portal")], {
      portalEn: "SURI",
      portalEs: "SURI",
    });
    assert.equal(milestones.length, 1);
    assert.ok(milestones[0].heading_en.includes("I'm starting your SURI filing"));
    assert.equal(milestones[0].details, undefined);
  });
});

describe("validationErrors", () => {
  it("translates technical errors into human language", () => {
    const technical = humanizeValidationError(
      "waiting for selector '#ssn-input' timed out after 15000ms",
      "en"
    );
    assert.ok(technical);
    assert.ok(!/selector|timed out|15000/i.test(technical));

    // Never invents an explanation: quotes the raw text when it has no
    // better translation, in the user's language frame.
    const creds = humanizeValidationError("Invalid password for user", "es");
    assert.ok(creds.includes("El portal indica:"));
    assert.ok(creds.includes("Invalid password for user"));
  });

  it("falls back to a human generic message on empty input", () => {
    const empty = humanizeValidationError("", "en");
    assert.ok(empty.length > 0);
    assert.ok(empty.toLowerCase().includes("did not give a specific reason"));
  });

  it("quotes short human messages with the site-says frame", () => {
    assert.equal(
      humanizeValidationError("Code expired", "en"),
      'The site says: "Code expired"'
    );
  });

  it("heads interventions by pause reason", () => {
    assert.equal(interventionHeading("CAPTCHA", "es"), "Verificación rápida en el portal");
    assert.equal(interventionHeading("USER_UPLOAD", "en"), "Documents needed");
    assert.equal(interventionHeading(null, "es"), "Esperándote");
  });

  it("gate copy states SmartPR never final-submits without the user", () => {
    const en = gateCopy("en");
    assert.ok(en.includes("Nothing is submitted until you say so"));
    const es = gateCopy("es");
    assert.ok(es.includes("No se envía nada hasta que tú lo decidas"));
  });
});

describe("chatScrollKey", () => {
  it("changes when anything chat-visible changes", () => {
    const a = { runId: "r1", milestoneCount: 2, transient: "Working", cardOpen: false, msgCount: 1 };
    assert.notEqual(chatScrollKey(a), chatScrollKey({ ...a, milestoneCount: 3 }));
    assert.notEqual(chatScrollKey(a), chatScrollKey({ ...a, transient: "Waiting" }));
    assert.equal(chatScrollKey(a), chatScrollKey(a));
  });
});

describe("failureReason", () => {
  it("extracts and humanizes the provider error from the failure event", () => {
    const events = [
      event(0, "Run started", "info"),
      event(1, "Agent run failed: the login page never loaded (timeout after 30000 ms)", "info"),
    ];
    const reason = failureReason(events, "en");
    assert.ok(reason);
    // Technical internals are translated, never shown raw.
    assert.ok(!reason.includes("timeout after 30000 ms"));
    assert.ok(!reason.includes("Agent run failed:"));
  });

  it("quotes a human-readable portal error verbatim", () => {
    const events = [
      event(0, "Agent run failed: Invalid credentials. Please try again.", "info"),
    ];
    const reason = failureReason(events, "en");
    assert.ok(reason?.includes("Invalid credentials. Please try again."));
  });

  it("uses the Spanish event text when lang is es", () => {
    const events = [
      {
        index: 0,
        message: "Agent run failed: boom",
        message_es: "El agente falló: boom",
        screenshot_url: "",
        created_at: "",
        kind: "info" as const,
      },
    ];
    const reason = failureReason(events, "es");
    assert.ok(reason);
    assert.ok(!reason.includes("Agent run failed:"));
  });

  it("returns null when no failure event exists", () => {
    assert.equal(failureReason([event(0, "Run started", "info")], "en"), null);
    assert.equal(failureReason([], "en"), null);
    assert.equal(failureReason(null, "en"), null);
  });

  it("never echoes SSN-shaped values from the raw error", () => {
    const events = [
      event(0, "Agent run failed: rejected value 123-45-6789 on the form", "info"),
    ];
    const reason = failureReason(events, "en");
    assert.ok(reason);
    assert.ok(!reason.includes("123-45-6789"));
  });
});

describe("filingStatusChipLabel", () => {
  function filingOption(filing_status: FilingStatus): FilingOption {
    return {
      id: "SURI_REGISTER_TAXPAYER",
      action: null,
      obligation_id: "obl-1",
      requirement_id: "DOC_SURI_REGISTRATION",
      obligation_name: "Register with SURI",
      obligation_status: "MISSING",
      filing_status,
      supported: filing_status !== "unsupported",
      title_en: "Register with SURI",
      title_es: "Registrarse en SURI",
      agency_id: "HACIENDA_SURI",
      agency_en: "Hacienda / SURI",
      agency_es: "Hacienda / SURI",
    };
  }

  it("labels all filing statuses in EN and PR Spanish", () => {
    assert.equal(filingStatusChipLabel(filingOption("ready_to_start"), "en"), "Ready to start");
    assert.equal(filingStatusChipLabel(filingOption("ready_to_start"), "es"), "Lista para empezar");
    assert.equal(filingStatusChipLabel(filingOption("missing_information"), "en"), "Missing information");
    assert.equal(filingStatusChipLabel(filingOption("missing_information"), "es"), "Falta información");
    assert.equal(filingStatusChipLabel(filingOption("in_progress"), "en"), "In progress");
    assert.equal(filingStatusChipLabel(filingOption("in_progress"), "es"), "En curso");
    assert.equal(filingStatusChipLabel(filingOption("submitted"), "en"), "Submitted");
    assert.equal(filingStatusChipLabel(filingOption("submitted"), "es"), "Enviada");
    assert.equal(filingStatusChipLabel(filingOption("blocked"), "en"), "Blocked");
    assert.equal(filingStatusChipLabel(filingOption("blocked"), "es"), "Bloqueada");
    assert.equal(filingStatusChipLabel(filingOption("unsupported"), "en"), "Not yet supported");
    assert.equal(filingStatusChipLabel(filingOption("unsupported"), "es"), "Aún no soportado");
  });
});

describe("filing picker copy", () => {
  it("states SmartPR identified the filings — the human only picks which to prepare", () => {
    assert.ok(
      filingPickerIntro("en").includes("the filings SmartPR has identified for this business")
    );
    assert.ok(
      filingPickerIntro("es").includes("los trámites que SmartPR identificó para este negocio")
    );
  });

  it("gate copy counts the missing items the assistant will ask for mid-run", () => {
    assert.equal(
      filingGateCopy(2, "en"),
      "2 items are still missing from your Business Passport — the assistant will ask for them during the filing."
    );
    assert.equal(
      filingGateCopy(1, "en"),
      "1 item is still missing from your Business Passport — the assistant will ask for it during the filing."
    );
    assert.equal(
      filingGateCopy(2, "es"),
      "Aún faltan 2 piezas en tu Pasaporte de Negocio — el asistente te las pedirá durante el trámite."
    );
    assert.equal(
      filingGateCopy(1, "es"),
      "Aún falta 1 pieza en tu Pasaporte de Negocio — el asistente te la pedirá durante el trámite."
    );
  });

  it("unsupported copy never promises a browser launch", () => {
    assert.ok(filingUnsupportedCopy("en").includes("isn't available for it yet"));
    assert.ok(filingUnsupportedCopy("es").includes("aún no hay un trámite de navegador disponible"));
  });

  it("missing-information cards link to the Business Passport (never a dead end)", () => {
    assert.equal(filingPassportCtaCopy("en"), "Complete in Business Passport");
    assert.equal(filingPassportCtaCopy("es"), "Completar en el Pasaporte del Negocio");
  });
});
