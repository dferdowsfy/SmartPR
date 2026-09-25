import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCredentialField,
  parsePortalStep,
  resolvePauseState,
  stepPauseMessage,
} from "./portalStep";

describe("parsePortalStep", () => {
  it("parses kind, title and missing labels", () => {
    const s = parsePortalStep(
      "PAUSE_FOR_USER\nPORTAL_STEP: kind=certification; title=Certification (rehearsal); missing=Signature (printed name), Certify checkbox"
    );
    assert.deepEqual(s, {
      kind: "certification",
      title: "Certification (rehearsal)",
      missing: ["Signature (printed name)", "Certify checkbox"],
      declared: true,
    });
  });

  it("uses the last PORTAL_STEP line and rejects unknown kinds", () => {
    assert.equal(parsePortalStep("PORTAL_STEP: kind=form\nPORTAL_STEP: kind=payment")?.kind, "payment");
    assert.equal(parsePortalStep("PORTAL_STEP: kind=dashboard"), null);
    assert.equal(parsePortalStep("no step here"), null);
  });
});

describe("resolvePauseState — chat always matches the visible step", () => {
  it("certification step never shows login fields (the screenshot bug)", () => {
    // Agent paused on the certification page but emitted a login block.
    const text = [
      "PAUSE_USER_LOGIN",
      "PORTAL_STEP: kind=certification; title=Certification (rehearsal)",
      "REQUIRED_FIELDS:",
      "- id=email; label=Email; type=email; sensitive=false",
      "- id=password; label=Password; type=password; sensitive=true",
      "- id=mfa; label=MFA code; type=text; sensitive=true; optional=true",
    ].join("\n");
    const st = resolvePauseState(text, "USER_LOGIN");
    assert.equal(st.step.kind, "certification");
    assert.deepEqual(st.fields, [], "no inputs on a human-only step");
    assert.ok(!st.step.missing.some((m) => /password|mfa/i.test(m)), "credentials never listed");
  });

  it("names a missing printed name on the certification step without an input", () => {
    const text = [
      "PAUSE_FOR_USER",
      "PORTAL_STEP: kind=certification; title=Certification (rehearsal)",
      "REQUIRED_FIELDS:",
      "- id=signature; label=Signature (printed name); type=text; sensitive=false",
    ].join("\n");
    const st = resolvePauseState(text, "USER_ACTION");
    assert.deepEqual(st.fields, []);
    assert.deepEqual(st.step.missing, ["Signature (printed name)"]);
    assert.match(stepPauseMessage(st.step, st.fields).message, /Signature \(printed name\)/);
  });

  it("an undeclared USER_LOGIN pause with no fields is unknown — never a login form", () => {
    const st = resolvePauseState("PAUSE_USER_LOGIN", "USER_LOGIN");
    assert.equal(st.step.kind, "unknown");
    assert.deepEqual(st.fields, []);
  });

  it("a real login step collects nothing in chat (takeover)", () => {
    const text = [
      "PAUSE_USER_LOGIN",
      "PORTAL_STEP: kind=login; title=Log in",
      "REQUIRED_FIELDS:",
      "- id=email; label=Email; type=email; sensitive=false",
      "- id=password; label=Password; type=password; sensitive=true",
    ].join("\n");
    const st = resolvePauseState(text, "USER_LOGIN");
    assert.equal(st.step.kind, "login");
    assert.deepEqual(st.fields, []);
  });

  it("identity step keeps the SSN field inline", () => {
    const text = [
      "PAUSE_FOR_USER",
      "PORTAL_STEP: kind=identity; title=Identity verification",
      "REQUIRED_FIELDS:",
      "- id=ssn; label=Social Security Number; type=text; sensitive=true; hint=9 digits",
    ].join("\n");
    const st = resolvePauseState(text, "USER_ACTION");
    assert.equal(st.step.kind, "identity");
    assert.deepEqual(st.fields.map((f) => f.id), ["ssn"]);
  });

  it("a data step that lists credentials is contradictory → unknown", () => {
    const text = [
      "PAUSE_FOR_USER",
      "PORTAL_STEP: kind=form",
      "REQUIRED_FIELDS:",
      "- id=fiscal_year_end; label=Fiscal year end; type=text; sensitive=false",
      "- id=password; label=Password; type=password; sensitive=true",
    ].join("\n");
    const st = resolvePauseState(text, "USER_ACTION");
    assert.equal(st.step.kind, "unknown");
    assert.deepEqual(st.fields, []);
  });

  it("a data step with no fields is unknown", () => {
    const st = resolvePauseState("PAUSE_FOR_USER\nPORTAL_STEP: kind=form", "USER_ACTION");
    assert.equal(st.step.kind, "unknown");
  });

  it("infers the step for older undeclared pauses", () => {
    const ssn = resolvePauseState(
      "PAUSE_USER_LOGIN\nREQUIRED_FIELDS:\n- id=ssn; label=SSN; type=text; sensitive=true",
      "USER_LOGIN"
    );
    assert.equal(ssn.step.kind, "identity");
    assert.equal(resolvePauseState("PAUSE_PAYMENT", "PAYMENT").step.kind, "payment");
    assert.equal(resolvePauseState("PAUSE_CAPTCHA", "CAPTCHA").step.kind, "captcha");
  });
});

describe("isCredentialField", () => {
  it("flags passwords and one-time codes by type, id or label", () => {
    assert.ok(isCredentialField({ id: "x", label: "Contraseña", type: "text", sensitive: true }));
    assert.ok(isCredentialField({ id: "otp", label: "Code", type: "text", sensitive: true }));
    assert.ok(isCredentialField({ id: "pw", label: "PW", type: "password", sensitive: true }));
    assert.ok(!isCredentialField({ id: "ssn", label: "Social Security Number", type: "text", sensitive: true }));
  });
});
