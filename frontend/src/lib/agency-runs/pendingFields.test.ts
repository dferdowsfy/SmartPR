import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOGIN_PENDING_FIELDS,
  parseRequiredFields,
  resolvePendingFields,
} from "./pendingFields";

describe("parseRequiredFields", () => {
  it("parses a standard REQUIRED_FIELDS block after a pause marker", () => {
    const text = `Paused for login.

PAUSE_USER_LOGIN
REQUIRED_FIELDS:
- id=email; label=Email; type=email; sensitive=false
- id=password; label=Password; type=password; sensitive=true
- id=mfa; label=MFA code; type=text; sensitive=true; optional=true
`;
    const fields = parseRequiredFields(text);
    assert.equal(fields.length, 3);
    assert.deepEqual(fields[0], {
      id: "email",
      label: "Email",
      type: "email",
      sensitive: false,
    });
    assert.deepEqual(fields[1], {
      id: "password",
      label: "Password",
      type: "password",
      sensitive: true,
    });
    assert.equal(fields[2].optional, true);
    assert.equal(fields[2].sensitive, true);
  });

  it("parses SSN-style sensitive fields", () => {
    const text = `PAUSE_USER_LOGIN
REQUIRED_FIELDS:
- id=ssn; label=SSN; type=password; sensitive=true
`;
    const fields = parseRequiredFields(text);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].id, "ssn");
    assert.equal(fields[0].type, "password");
    assert.equal(fields[0].sensitive, true);
  });

  it("returns empty when block has no field lines", () => {
    const text = `PAUSE_CAPTCHA
REQUIRED_FIELDS:
`;
    assert.deepEqual(parseRequiredFields(text), []);
  });

  it("returns empty when no block present", () => {
    assert.deepEqual(parseRequiredFields("PAUSE_USER_LOGIN only"), []);
  });

  it("stops at non-field content after entries", () => {
    const text = `REQUIRED_FIELDS:
- id=phone; label=Phone; type=tel; sensitive=false

Next steps for the human.`;
    const fields = parseRequiredFields(text);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].id, "phone");
    assert.equal(fields[0].type, "tel");
  });
});

describe("resolvePendingFields", () => {
  it("falls back to login defaults for USER_LOGIN with no block", () => {
    const fields = resolvePendingFields("PAUSE_USER_LOGIN", "USER_LOGIN");
    assert.deepEqual(fields, DEFAULT_LOGIN_PENDING_FIELDS);
  });

  it("returns empty for CAPTCHA with no block", () => {
    assert.deepEqual(resolvePendingFields("PAUSE_CAPTCHA", "CAPTCHA"), []);
  });

  it("prefers parsed fields over login fallback", () => {
    const text = `PAUSE_USER_LOGIN
REQUIRED_FIELDS:
- id=ssn; label=SSN; type=password; sensitive=true
`;
    const fields = resolvePendingFields(text, "USER_LOGIN");
    assert.equal(fields.length, 1);
    assert.equal(fields[0].id, "ssn");
  });
});
