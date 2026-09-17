import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOGIN_PENDING_FIELDS,
  collectPortalValidationMessages,
  displayMessagesForAgentText,
  fieldHasValidationIssue,
  humanizePauseEvent,
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

  it("parses SSN-style sensitive fields with type=text and hint", () => {
    const text = `PAUSE_USER_LOGIN
REQUIRED_FIELDS:
- id=ssn; label=SSN; type=text; sensitive=true; hint=9 digits as shown on the portal (dashes OK)
`;
    const fields = parseRequiredFields(text);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].id, "ssn");
    assert.equal(fields[0].type, "text");
    assert.equal(fields[0].sensitive, true);
    assert.equal(fields[0].hint, "9 digits as shown on the portal (dashes OK)");
  });

  it("parses error= alongside hint= on re-pause lines", () => {
    const text = `PAUSE_USER_LOGIN
REQUIRED_FIELDS:
- id=ssn; label=SSN; type=text; sensitive=true; hint=9 digits; error=Portal: el número de ID no es válido
`;
    const fields = parseRequiredFields(text);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].id, "ssn");
    assert.equal(fields[0].hint, "9 digits");
    assert.equal(fields[0].error, "Portal: el número de ID no es válido");
  });

  it("parses error= alone without hint", () => {
    const text = `REQUIRED_FIELDS:
- id=ssn; label=SSN; type=text; sensitive=true; error=Invalid ID number
`;
    const fields = parseRequiredFields(text);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].error, "Invalid ID number");
    assert.equal(fields[0].hint, undefined);
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
- id=ssn; label=SSN; type=text; sensitive=true; hint=Must be 9 digits
`;
    const fields = resolvePendingFields(text, "USER_LOGIN");
    assert.equal(fields.length, 1);
    assert.equal(fields[0].id, "ssn");
    assert.equal(fields[0].hint, "Must be 9 digits");
  });
});

describe("humanizePauseEvent", () => {
  it("does not dump raw REQUIRED_FIELDS for SSN pauses", () => {
    const fields = [
      { id: "ssn", label: "SSN", type: "text" as const, sensitive: true, hint: "9 digits" },
    ];
    const h = humanizePauseEvent("USER_LOGIN", fields, "PAUSE_USER_LOGIN\nREQUIRED_FIELDS:\n- id=ssn; ...");
    assert.match(h.message, /SSN/i);
    assert.match(h.message, /Assistant/i);
    assert.doesNotMatch(h.message, /REQUIRED_FIELDS/);
    assert.doesNotMatch(h.message_es, /REQUIRED_FIELDS/);
  });

  it("displayMessagesForAgentText humanizes marker spam", () => {
    const raw = `PAUSE_USER_LOGIN
REQUIRED_FIELDS:
- id=ssn; label=SSN; type=text; sensitive=true; hint=9 digits as shown
`;
    const fields = parseRequiredFields(raw);
    const d = displayMessagesForAgentText(raw, "USER_LOGIN", fields);
    assert.doesNotMatch(d.message, /REQUIRED_FIELDS|id=ssn/);
    assert.match(d.message, /Assistant/i);
  });

  it("prefers rejection copy when fields carry error=", () => {
    const fields = [
      {
        id: "ssn",
        label: "SSN",
        type: "text" as const,
        sensitive: true,
        hint: "9 digits",
        error: "Portal: el número de ID no es válido",
      },
    ];
    const h = humanizePauseEvent("USER_LOGIN", fields);
    assert.match(h.message, /SURI rejected/i);
    assert.match(h.message, /Assistant/i);
    assert.match(h.message_es, /SURI rechazó/i);
    assert.doesNotMatch(h.message, /REQUIRED_FIELDS/);
  });

  it("treats validation-looking hints as field errors for humanize", () => {
    const fields = [
      {
        id: "ssn",
        label: "SSN",
        type: "text" as const,
        sensitive: true,
        hint: "Portal error: no es válido",
      },
    ];
    assert.equal(fieldHasValidationIssue(fields[0]), true);
    const h = humanizePauseEvent("USER_LOGIN", fields);
    assert.match(h.message, /SURI rejected/i);
  });
});

describe("collectPortalValidationMessages", () => {
  it("concatenates unique error= messages and validation-looking hints", () => {
    const msgs = collectPortalValidationMessages([
      {
        id: "ssn",
        label: "SSN",
        type: "text",
        sensitive: true,
        hint: "9 digits",
        error: "Portal: el número de ID no es válido",
      },
      {
        id: "itin",
        label: "ITIN",
        type: "text",
        sensitive: true,
        hint: "Invalid format",
      },
      {
        id: "ssn2",
        label: "SSN again",
        type: "text",
        sensitive: true,
        error: "Portal: el número de ID no es válido",
      },
    ]);
    assert.deepEqual(msgs, [
      "Portal: el número de ID no es válido",
      "Invalid format",
    ]);
  });
});
