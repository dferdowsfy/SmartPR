import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getFilingConfig } from "../filingTypes";
import { buildAgencyTaskPrompt } from "../taskPrompt";
import {
  detectFlowStep,
  fieldMapForStep,
  flowFor,
  passportValueFor,
  recoveryFor,
  resolvePauseForFiling,
} from "./index";
import { DEPT_STATE_CORPORATION_FLOW as flow } from "./deptStateCorporation";

const FT = "DEPT_STATE_CORPORATE_FILING";
const corpPassport = {
  business: { legalName: "Brisa Tropical Corp.", entityType: "corporation", ssn: "123-45-6789" },
  contact: { fullName: "Ana Rivera", email: "Ana@Example.com", phone: "(787) 555-0199" },
  addresses: { principalPhysical: { line1: "123 Calle Principal", postalCode: "00901" } },
};
const step = (id: string) => flow.steps.find((s) => s.id === id)!;
const pause = (lines: string[]) => lines.join("\n");

describe("Dept. of State corporation flow — catalog", () => {
  it("is registered for the corporation filing only", () => {
    assert.equal(flowFor(FT), flow);
    assert.equal(flowFor("DEPT_STATE_LLC_FORMATION"), null);
  });

  it("orders the observed wizard screens, then the human gates", () => {
    assert.deepEqual(
      flow.steps.map((s) => s.id),
      ["login", "name_availability", "general_information", "filer", "designated_office", "resident_agent",
        "incorporators", "officers", "capital_stock", "supporting_docs", "review", "signatures", "payment", "thank_you"]
    );
    for (const id of ["login", "signatures", "payment", "thank_you"]) {
      assert.equal(step(id).observed, false, `${id} was never seen live`);
    }
    assert.equal(step("signatures").kind, "signature");
    assert.equal(step("payment").kind, "payment");
    assert.equal(step("login").kind, "login");
  });

  it("human-only steps carry no fields and no step asks for credentials", () => {
    for (const s of flow.steps) {
      if (["login", "signature", "payment", "review", "submission"].includes(s.kind)) assert.deepEqual(s.fields, [], s.id);
      for (const f of s.fields) assert.ok(!/password|mfa|otp|card|cvv/i.test(f.id + f.label_en), `${s.id}.${f.id}`);
    }
  });

  it("detects each screen from its visible heading (EN and ES)", () => {
    for (const s of flow.steps) {
      assert.equal(detectFlowStep(flow, { title: s.title_en })?.id, s.id, s.title_en);
    }
    assert.equal(detectFlowStep(flow, { title: "Disponibilidad de nombre" })?.id, "name_availability");
    assert.equal(detectFlowStep(flow, { title: "Firmas" })?.id, "signatures");
    assert.equal(detectFlowStep(flow, { title: "Annual Report — Officers Survey Results" }), null, "unknown screen");
    assert.equal(detectFlowStep(flow, { url: "/en/creationfilings/wizard#filer" })?.id, "filer");
  });
});

describe("Dept. of State corporation flow — chat matches the visible step", () => {
  it("login fields reported on the Signatures screen resolve to the signature step with no inputs", () => {
    const st = resolvePauseForFiling(
      pause([
        "PAUSE_USER_LOGIN",
        "PORTAL_STEP: kind=signature; title=Signatures",
        "REQUIRED_FIELDS:",
        "- id=email; label=Email; type=email; sensitive=false",
        "- id=password; label=Password; type=password; sensitive=true",
      ]),
      "USER_LOGIN",
      FT
    );
    assert.equal(st.step.kind, "signature");
    assert.equal(st.step.flowStepId, "signatures");
    assert.deepEqual(st.fields, []);
  });

  it("a kind that contradicts the identified screen → unknown", () => {
    const st = resolvePauseForFiling(
      pause(["PAUSE_USER_LOGIN", "PORTAL_STEP: kind=login; title=Capital Stock"]),
      "USER_LOGIN",
      FT
    );
    assert.equal(st.step.kind, "unknown");
    assert.deepEqual(st.fields, []);
  });

  it("an unrecognised (changed) screen → unknown, even if the agent says form", () => {
    const st = resolvePauseForFiling(
      pause([
        "PAUSE_FOR_USER",
        "PORTAL_STEP: kind=form; title=Beneficial Ownership Survey",
        "REQUIRED_FIELDS:",
        "- id=owner_pct; label=Ownership percentage; type=number; sensitive=false",
      ]),
      "USER_ACTION",
      FT
    );
    assert.equal(st.step.kind, "unknown");
    assert.match(st.step.missing[0], /not in the recorded flow/);
  });

  it("asking for a field that is not on the identified screen → unknown", () => {
    const st = resolvePauseForFiling(
      pause([
        "PAUSE_FOR_USER",
        "PORTAL_STEP: kind=form; title=Filer",
        "REQUIRED_FIELDS:",
        "- id=shares_number; label=Number of shares; type=number; sensitive=false",
      ]),
      "USER_ACTION",
      FT
    );
    assert.equal(st.step.kind, "unknown");
  });

  it("a legitimate data request keeps the catalog's field ids and labels", () => {
    const st = resolvePauseForFiling(
      pause([
        "PAUSE_FOR_USER",
        "PORTAL_STEP: kind=form; title=Capital Stock; url=#capitalstock",
        "REQUIRED_FIELDS:",
        "- id=number_of_shares; label=Number of shares; type=number; sensitive=false",
      ]),
      "USER_ACTION",
      FT
    );
    assert.equal(st.step.kind, "form");
    assert.equal(st.step.title, "Capital Stock");
    assert.deepEqual(st.fields.map((f) => [f.id, f.label]), [["shares_number", "Number of shares"]]);
  });

  it("payment step carries the portal amount for display, never inputs", () => {
    const st = resolvePauseForFiling(
      pause(["PAUSE_PAYMENT", "PORTAL_STEP: kind=payment; title=Payment; amount=$150.00"]),
      "PAYMENT",
      FT
    );
    assert.equal(st.step.kind, "payment");
    assert.equal(st.step.amount, "$150.00");
    assert.deepEqual(st.fields, []);
  });

  it("a non-currency amount is dropped rather than shown", () => {
    const st = resolvePauseForFiling(
      pause(["PAUSE_PAYMENT", "PORTAL_STEP: kind=payment; title=Payment; amount=please pay now"]),
      "PAYMENT",
      FT
    );
    assert.equal(st.step.amount, null);
  });
});

describe("Dept. of State corporation flow — passport field map", () => {
  it("normalizes passport values for the portal", () => {
    const f = (sid: string, fid: string) => step(sid).fields.find((x) => x.id === fid)!;
    assert.equal(passportValueFor(f("name_availability", "entity_class"), corpPassport), "Corporation");
    assert.equal(passportValueFor(f("name_availability", "entity_name"), corpPassport), "Brisa Tropical Corp.");
    assert.equal(passportValueFor(f("name_availability", "name_designation"), corpPassport), "Corp.");
    assert.equal(passportValueFor(f("general_information", "entity_type"), corpPassport), "For Profit");
    assert.equal(passportValueFor(f("general_information", "jurisdiction"), corpPassport), "Domestic");
    assert.equal(passportValueFor(f("filer", "filer_phone"), corpPassport), "7875550199");
    assert.equal(passportValueFor(f("filer", "filer_email"), corpPassport), "ana@example.com");
  });

  it("never invents: unmapped or unusable values come back null", () => {
    const f = (sid: string, fid: string) => step(sid).fields.find((x) => x.id === fid)!;
    assert.equal(passportValueFor(f("general_information", "purposes"), corpPassport), null);
    assert.equal(passportValueFor(f("incorporators", "incorporator_name"), corpPassport), null, "incorporator ≠ contact");
    assert.equal(passportValueFor(f("name_availability", "entity_class"), { business: { entityType: "limited_liability_company" } }), null, "an LLC is not a corporation");
    assert.equal(passportValueFor(f("filer", "filer_phone"), { contact: { phone: "555-01" } }), null);
    assert.equal(passportValueFor(f("name_availability", "name_designation"), { business: { legalName: "Brisa Tropical" } }), null);
    const map = fieldMapForStep(step("filer"), null);
    assert.ok(map.every((m) => m.value === null));
  });
});

describe("Dept. of State corporation flow — recovery", () => {
  it("maps known validation messages to their fix", () => {
    assert.equal(recoveryFor(flow, "filer", "PO Box addresses are not accepted")?.id, "address_rejected");
    assert.equal(recoveryFor(flow, "filer", "Emails do not match")?.id, "email_mismatch");
    assert.equal(recoveryFor(flow, "name_availability", "The name Brisa Corp. is not available")?.askField, "entity_name");
    assert.equal(recoveryFor(flow, "officers", "At least two officers are required")?.askField, "officer_name");
    assert.equal(recoveryFor(flow, "capital_stock", "Your session has expired")?.id, "session_expired");
    assert.equal(recoveryFor(flow, "review", "totally new message"), null);
  });
});

describe("Dept. of State corporation flow — agent prompt", () => {
  const task = buildAgencyTaskPrompt({ config: getFilingConfig(FT), passport: corpPassport, goalBrief: null });

  it("carries the step catalog, field map and recovery rules", () => {
    assert.ok(task.includes("STEP CATALOG"));
    assert.ok(task.includes('FIELD entity_class ("Entity class"): from passport business.entityType: Corporation'));
    assert.ok(task.includes('FIELD filer_phone ("Phone"): from passport contact.phone: 7875550199'));
    assert.ok(task.includes('FIELD purposes ("Purposes"): not in the passport — ask the human'));
    assert.ok(task.includes("signatures — kind=signature"));
    assert.ok(task.includes("NOT yet observed live"));
    assert.ok(task.includes("PAYMENT: the human pays Puerto Rico Department of State directly"));
  });

  it("never leaks sensitive passport values", () => {
    assert.ok(!task.includes("123-45-6789"));
  });
});
