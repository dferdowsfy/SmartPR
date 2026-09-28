import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectFlowStep,
  flowFor,
  passportValueFor,
  recoveryFor,
  resolvePauseForFiling,
} from "./index";
import { SURI_MERCHANT_FLOW as flow } from "./suriMerchant";

const FT = "SURI_MERCHANT_REGISTRATION";
const passport = {
  business: { legalName: "Café Brisa LLC", tradeName: "Café Brisa", entityType: "llc" },
  contact: { fullName: "Ana Rivera", email: "Ana@Example.com", phone: "(787) 555-0199" },
  addresses: { municipality: "San Juan", principalPhysical: { line1: "123 Calle Loíza", postalCode: "00911" } },
};
const step = (id: string) => flow.steps.find((s) => s.id === id)!;
const pause = (lines: string[]) => lines.join("\n");

describe("SURI merchant flow — catalog", () => {
  it("is registered for the merchant filing only", () => {
    assert.equal(flowFor(FT), flow);
    assert.equal(flowFor("SURI_REGISTER_TAXPAYER"), null);
  });

  it("every step is honestly marked unobserved (portal unreachable)", () => {
    for (const s of flow.steps) {
      assert.equal(s.observed, false, `${s.id} was never seen live`);
      assert.ok(s.source.length > 0, `${s.id} documents its source`);
    }
  });

  it("human-only steps carry no fields and no step asks for credentials", () => {
    for (const s of flow.steps) {
      if (["login", "review", "submission"].includes(s.kind)) assert.deepEqual(s.fields, [], s.id);
      for (const f of s.fields) assert.ok(!/password|mfa|otp|card|cvv/i.test(f.id + f.label_en), `${s.id}.${f.id}`);
    }
  });

  it("detects each screen from its visible heading (EN and ES)", () => {
    for (const s of flow.steps) {
      assert.equal(detectFlowStep(flow, { title: s.title_en })?.id, s.id, s.title_en);
    }
    assert.equal(detectFlowStep(flow, { title: "Acceda a SURI" })?.id, "login");
    assert.equal(detectFlowStep(flow, { title: "Registro de comerciante" })?.id, "merchant_info");
    assert.equal(detectFlowStep(flow, { title: "Tell us about your experience" }), null, "unknown screen");
  });

  it("the merchant form maps all nine passport fields", () => {
    const ids = step("merchant_info").fields.map((f) => f.id);
    assert.deepEqual(ids, [
      "merchant_role", "merchant_legal_name", "merchant_trade_name", "merchant_street",
      "merchant_municipality", "merchant_postal", "merchant_contact_name",
      "merchant_contact_email", "merchant_contact_phone",
    ]);
  });

  it("passport values normalize (phone digits, email)", () => {
    const byId = (id: string) => step("merchant_info").fields.find((f) => f.id === id)!;
    assert.equal(passportValueFor(byId("merchant_contact_phone"), passport), "7875550199");
    assert.equal(passportValueFor(byId("merchant_contact_email"), passport), "ana@example.com");
    assert.equal(passportValueFor(byId("merchant_legal_name"), passport), "Café Brisa LLC");
    assert.equal(passportValueFor(byId("merchant_role"), passport), null, "role has no passport path");
  });

  it("recovery matches session expiry and EIN mismatch", () => {
    assert.equal(recoveryFor(flow, "merchant_info", "the portal says the EIN does not match")?.id, "ein_mismatch");
    assert.equal(recoveryFor(flow, "merchant_info", "Your session has expired")?.id, "session_expired");
  });
});

describe("SURI merchant flow — chat matches the visible step", () => {
  it("login pause resolves to the login step with no fields", () => {
    const st = resolvePauseForFiling(
      pause(["PAUSE_USER_LOGIN", "PORTAL_STEP: kind=login; title=Log in to SURI"]),
      "USER_LOGIN",
      FT
    );
    assert.equal(st.step.kind, "login");
    assert.equal(st.step.flowStepId, "login");
    assert.deepEqual(st.fields, []);
  });

  it("an unrecognised (changed) screen → unknown, even if the agent says form", () => {
    const st = resolvePauseForFiling(
      pause([
        "PAUSE_FOR_USER",
        "PORTAL_STEP: kind=form; title=Tell us about your experience",
        "REQUIRED_FIELDS:",
        "- id=survey_q; label=How was your experience?; type=text; sensitive=false",
      ]),
      "USER_ACTION",
      FT
    );
    assert.equal(st.step.kind, "unknown");
    assert.match(st.step.missing[0], /not in the recorded flow/);
  });

  it("asking for a field that is not on the merchant screen → unknown", () => {
    const st = resolvePauseForFiling(
      pause([
        "PAUSE_FOR_USER",
        "PORTAL_STEP: kind=form; title=Merchant registration",
        "REQUIRED_FIELDS:",
        "- id=bank_routing; label=Bank routing number; type=text; sensitive=false",
      ]),
      "USER_ACTION",
      FT
    );
    assert.equal(st.step.kind, "unknown");
  });

  it("review pause carries no fields — the human submits", () => {
    const st = resolvePauseForFiling(
      pause(["PAUSE_FOR_USER", "PORTAL_STEP: kind=review; title=Review and submit"]),
      "USER_ACTION",
      FT
    );
    assert.equal(st.step.kind, "review");
    assert.deepEqual(st.fields, []);
  });
});
