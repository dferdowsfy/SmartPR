import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agencyTone, classifyWorkflows, filingProgress, missingCount, workflowKey } from "./claraWorkspaceModel";
import type { FilingGroup, FilingOption } from "./agencyActions";
import type { AgencyRunEvent } from "./types";

function option(over: Partial<FilingOption>): FilingOption {
  return {
    id: "OGPE_PERMISO_UNICO",
    action: { id: "a", filing_type: "OGPE_PERMISO_UNICO", agency_id: "OGPE", title_en: "Permiso Único", title_es: "Permiso Único", agency_en: "OGPe", agency_es: "OGPe", status: "ready", known: 8, total: 10, missing_items: [], blocked_by: [], evidence_available: [] },
    obligation_id: "ob1",
    requirement_id: "PU",
    obligation_name: "Permiso Único",
    obligation_status: "pending",
    filing_status: "ready_to_start",
    supported: true,
    title_en: "Permiso Único",
    title_es: "Permiso Único",
    agency_id: "OGPE",
    agency_en: "OGPe",
    agency_es: "OGPe",
    ...over,
  } as FilingOption;
}

const ev = (n: number, kind: AgencyRunEvent["kind"] = "info"): AgencyRunEvent[] =>
  Array.from({ length: n }, (_, i) => ({ index: i, message: "m", message_es: "m", screenshot_url: "", created_at: "", kind }));

describe("Clara workflow eligibility (from SmartPR's resolved filings)", () => {
  it("shows only applicable filings Clara can run; not-ready ones separately; hides the rest", () => {
    const groups: FilingGroup[] = [
      { agency_id: "OGPE", agency_name_en: "OGPe", agency_name_es: "OGPe", filings: [option({}), option({ obligation_id: "ob2", filing_status: "in_progress", active_run_id: "r1" })] },
      {
        agency_id: "HACIENDA_SURI", agency_name_en: "Hacienda", agency_name_es: "Hacienda", filings: [
          option({ id: "SURI_MERCHANT_REGISTRATION", obligation_id: "ob3", agency_id: "HACIENDA_SURI", agency_en: "Hacienda", filing_status: "missing_information", action: { ...option({}).action!, filing_type: "SURI_MERCHANT_REGISTRATION", missing_items: [{ id: "x", label_en: "EIN", label_es: "EIN", sensitive: false }], blocked_by: ["Permiso Único"] } }),
          option({ id: "SURI_REGISTER_TAXPAYER", obligation_id: "ob4", filing_status: "submitted" }),
        ],
      },
      { agency_id: "OTHER", agency_name_en: "Salud", agency_name_es: "Salud", filings: [option({ id: "unsupported:ob5", obligation_id: "ob5", supported: false, action: null, filing_status: "unsupported" }), option({ obligation_id: "ob6", filing_status: "not_available" })] },
    ];
    const w = classifyWorkflows(groups);
    assert.deepEqual(w.ready.map((f) => f.obligation_id), ["ob1", "ob2"]);
    assert.deepEqual(w.notReady.map((f) => f.obligation_id), ["ob3"]);
    assert.equal(missingCount(w.notReady[0]), 2);
    assert.notEqual(workflowKey(w.ready[0]), workflowKey(w.ready[1]));
  });

  it("agency colors follow the agency", () => {
    assert.equal(agencyTone({ agency_id: "OGPE", agency_en: "OGPe", title_en: "Permiso Único" }), "ogpe");
    assert.equal(agencyTone({ agency_id: "HACIENDA_SURI", agency_en: "Hacienda", title_en: "Merchant" }), "hacienda");
    assert.equal(agencyTone({ agency_id: "DEPT_STATE", agency_en: "Department of State", title_en: "LLC" }), "state");
    assert.equal(agencyTone({ agency_id: "X", agency_en: "Cuerpo de Bomberos", title_en: "Fire" }), "fire");
  });
});

describe("Clara stepper + checklist follow the real run state", () => {
  it("prepare → open portal → complete forms → waiting → ready to submit → done", () => {
    let p = filingProgress({ preparing: true, awaitingStart: false, run: null });
    assert.equal(p.step, 0);
    assert.equal(p.phases.LOAD_PASSPORT, "current");
    p = filingProgress({ preparing: false, awaitingStart: true, run: null });
    assert.deepEqual([p.step, p.steps[0], p.needsYou], [0, "waiting", true]);
    p = filingProgress({ preparing: false, awaitingStart: false, run: { status: "queued", pause_reason: null, live_url: null, events: [] } });
    assert.deepEqual([p.step, p.phases.OPEN_PORTAL], [1, "current"]);
    p = filingProgress({ preparing: false, awaitingStart: false, run: { status: "running", pause_reason: null, live_url: "https://live", events: ev(1) } });
    assert.equal(p.step, 1, "the portal isn't open until the agent has worked in it");
    p = filingProgress({ preparing: false, awaitingStart: false, run: { status: "running", pause_reason: null, live_url: "https://live", events: ev(4) } });
    assert.deepEqual([p.step, p.phases.FILL_FIELDS, p.steps[1]], [2, "current", "done"]);
    p = filingProgress({ preparing: false, awaitingStart: false, run: { status: "paused", pause_reason: "USER_LOGIN", live_url: "https://live", events: ev(1) } });
    assert.deepEqual([p.step, p.steps[1], p.needsYou], [1, "waiting", true], "sign-in before the portal is open");
    p = filingProgress({ preparing: false, awaitingStart: false, run: { status: "paused", pause_reason: "USER_UPLOAD", live_url: "https://live", events: ev(5) } });
    assert.deepEqual([p.step, p.phases.FILL_FIELDS], [2, "waiting"]);
    p = filingProgress({ preparing: false, awaitingStart: false, run: { status: "review", pause_reason: null, live_url: "https://live", events: ev(5) } });
    assert.deepEqual([p.step, p.steps[4], p.steps[3], p.phases.AWAIT_USER], [4, "waiting", "done", "waiting"]);
    p = filingProgress({ preparing: false, awaitingStart: false, run: { status: "submitted", pause_reason: null, live_url: null, events: ev(5) } });
    assert.ok(p.steps.every((s) => s === "done"));
    assert.equal(p.terminal, "submitted");
  });

  it("failed / stopped show where it ended", () => {
    const p = filingProgress({ preparing: false, awaitingStart: false, run: { status: "failed", pause_reason: null, live_url: "https://live", events: ev(4) } });
    assert.deepEqual([p.step, p.steps[2], p.phases.FILL_FIELDS, p.terminal], [2, "error", "error", "failed"]);
    const s = filingProgress({ preparing: false, awaitingStart: false, run: { status: "stopped", pause_reason: null, live_url: null, events: ev(1) } });
    assert.deepEqual([s.step, s.terminal], [1, "stopped"]);
  });
});
