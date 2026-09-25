import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AGENCY_FILING_CONFIGS,
  type FilingPlaybook,
  type PlaybookChannel,
  type PlaybookFieldType,
  type PlaybookGateKind,
} from "./filingTypes";
import { CANONICAL_LABELS } from "./canonicalFields";

const CHANNELS: PlaybookChannel[] = ["INLINE", "VAULT", "IN_BROWSER", "AGENT"];
const FIELD_TYPES: PlaybookFieldType[] = [
  "text",
  "email",
  "password",
  "tel",
  "number",
  "select",
  "checkbox",
];
const GATE_KINDS: PlaybookGateKind[] = [
  "login",
  "captcha",
  "signature",
  "payment",
  "upload",
  "phone_call",
];
/** Gates that may only appear on IN_BROWSER steps (legal/payment acts). */
const IN_BROWSER_ONLY_GATES: PlaybookGateKind[] = [
  "signature",
  "payment",
  "captcha",
];

function playbooks(): { id: string; playbook: FilingPlaybook }[] {
  return AGENCY_FILING_CONFIGS.filter((c) => c.playbook).map((c) => ({
    id: c.id,
    playbook: c.playbook!,
  }));
}

describe("filing playbook schema integrity", () => {
  it("at least one filing config carries a playbook", () => {
    assert.ok(playbooks().length >= 1, "expected ≥1 playbook");
  });

  for (const { id, playbook } of playbooks()) {
    describe(`playbook for ${id}`, () => {
      it("has scope, steps, confirmation, and quirks", () => {
        assert.ok(playbook.scope_en.trim(), "scope_en empty");
        assert.ok(playbook.scope_es.trim(), "scope_es empty");
        assert.ok(playbook.steps.length > 0, "no steps");
        assert.ok(playbook.confirmation.reference_en.trim(), "reference_en empty");
        assert.ok(playbook.confirmation.reference_es.trim(), "reference_es empty");
        assert.ok(playbook.confirmation.where_en.trim(), "where_en empty");
        assert.ok(playbook.confirmation.where_es.trim(), "where_es empty");
        assert.ok(playbook.quirks_en.length > 0, "quirks_en empty");
        assert.ok(playbook.quirks_es.length > 0, "quirks_es empty");
      });

      it("steps have unique ids and valid channels", () => {
        const ids = playbook.steps.map((s) => s.id);
        assert.equal(new Set(ids).size, ids.length, "duplicate step ids");
        for (const step of playbook.steps) {
          assert.ok(step.id.trim(), "step id empty");
          assert.ok(step.label_en.trim(), `step ${step.id}: label_en empty`);
          assert.ok(step.label_es.trim(), `step ${step.id}: label_es empty`);
          assert.ok(
            CHANNELS.includes(step.channel),
            `step ${step.id}: bad channel ${step.channel}`
          );
          assert.ok(Array.isArray(step.fields), `step ${step.id}: fields missing`);
          if (step.gate) {
            assert.ok(
              GATE_KINDS.includes(step.gate),
              `step ${step.id}: bad gate ${step.gate}`
            );
          }
        }
      });

      it("field ids are globally unique across the playbook", () => {
        const ids = playbook.steps.flatMap((s) => s.fields.map((f) => f.id));
        assert.equal(new Set(ids).size, ids.length, "duplicate field ids");
      });

      it("fields have valid types, labels, and real passport paths", () => {
        for (const step of playbook.steps) {
          for (const field of step.fields) {
            assert.ok(field.id.trim(), `step ${step.id}: field id empty`);
            assert.ok(
              field.label_en.trim(),
              `field ${field.id}: label_en empty`
            );
            assert.ok(
              field.label_es.trim(),
              `field ${field.id}: label_es empty`
            );
            assert.ok(
              FIELD_TYPES.includes(field.type),
              `field ${field.id}: bad type ${field.type}`
            );
            assert.equal(
              typeof field.required,
              "boolean",
              `field ${field.id}: required must be boolean`
            );
            if (field.type === "select") {
              assert.ok(
                (field.options ?? []).length > 0,
                `field ${field.id}: select needs options`
              );
            }
            if (field.passportPath) {
              assert.ok(
                field.passportPath in CANONICAL_LABELS,
                `field ${field.id}: passportPath ${field.passportPath} is not a canonical path`
              );
            }
          }
        }
      });

      it("signature/payment/captcha gates only appear on IN_BROWSER steps", () => {
        for (const step of playbook.steps) {
          if (step.gate && IN_BROWSER_ONLY_GATES.includes(step.gate)) {
            assert.equal(
              step.channel,
              "IN_BROWSER",
              `step ${step.id}: gate ${step.gate} requires IN_BROWSER channel`
            );
          }
          if (step.channel === "IN_BROWSER") {
            assert.equal(
              step.fields.length,
              0,
              `step ${step.id}: IN_BROWSER steps must not define fill fields`
            );
          }
        }
      });

      it("has at least one INLINE step and ends with human-controlled completion", () => {
        assert.ok(
          playbook.steps.some((s) => s.channel === "INLINE"),
          "no INLINE steps"
        );
        const last = playbook.steps[playbook.steps.length - 1]!;
        assert.ok(
          last.channel === "IN_BROWSER" || last.channel === "AGENT",
          `last step ${last.id} should be human-controlled or agent capture`
        );
      });
    });
  }
});

describe("DEPT_STATE_CORPORATE_FILING playbook", () => {
  const config = AGENCY_FILING_CONFIGS.find(
    (c) => c.id === "DEPT_STATE_CORPORATE_FILING"
  )!;
  const playbook = config.playbook!;

  it("has the 13 documented wizard steps in order", () => {
    assert.deepEqual(
      playbook.steps.map((s) => s.id),
      [
        "navigate",
        "name_availability",
        "general_information",
        "filer",
        "designated_office",
        "resident_agent",
        "incorporators",
        "officers",
        "capital_stock",
        "supporting_docs",
        "review",
        "signatures",
        "payment",
      ]
    );
  });

  it("keeps legal acts and payment in the human's browser", () => {
    const signatures = playbook.steps.find((s) => s.id === "signatures")!;
    assert.equal(signatures.channel, "IN_BROWSER");
    assert.equal(signatures.gate, "signature");
    const payment = playbook.steps.find((s) => s.id === "payment")!;
    assert.equal(payment.channel, "IN_BROWSER");
    assert.equal(payment.gate, "payment");
  });

  it("fills every data step inline from chat", () => {
    const fillSteps = [
      "name_availability",
      "general_information",
      "filer",
      "designated_office",
      "resident_agent",
      "incorporators",
      "officers",
      "capital_stock",
      "supporting_docs",
      "review",
    ];
    for (const id of fillSteps) {
      const step = playbook.steps.find((s) => s.id === id)!;
      assert.equal(step.channel, "INLINE", `step ${id} should be INLINE`);
    }
  });

  it("does not duplicate portal identity from the filing config", () => {
    // domains/startUrl/needsLogin stay on the config; the playbook type must
    // not re-declare them as its own keys.
    for (const key of ["domains", "startUrl", "needsLogin"]) {
      assert.ok(
        !(key in playbook),
        `playbook must not re-declare config key: ${key}`
      );
    }
    assert.ok(config.domains.includes("rcp.estado.pr.gov"), "config keeps domains");
  });
});

describe("playbook portal-identity and sensitivity invariants", () => {
  it("playbooks never duplicate portal identity (domains/startUrl live on the config only)", () => {
    for (const { id, playbook } of playbooks()) {
      const config = AGENCY_FILING_CONFIGS.find((c) => c.id === id)!;
      assert.ok(
        !("domains" in playbook) && !("startUrl" in playbook),
        `${id}: playbook must not carry portal identity fields`
      );
      const text = JSON.stringify(playbook);
      for (const domain of config.domains) {
        assert.ok(
          !text.includes(domain),
          `${id}: playbook text must not repeat domain ${domain}`
        );
      }
      assert.ok(
        !text.includes(config.startUrl),
        `${id}: playbook text must not repeat startUrl`
      );
    }
  });

  it("sensitive playbook fields are always maskable types with bilingual labels", () => {
    for (const { id, playbook } of playbooks()) {
      for (const step of playbook.steps) {
        for (const field of step.fields) {
          if (field.sensitive) {
            assert.ok(
              field.type === "password" || field.type === "text",
              `${id} field ${field.id}: sensitive fields must be password or text (maskable)`
            );
            assert.ok(
              field.label_en.trim() && field.label_es.trim(),
              `${id} field ${field.id}: sensitive fields need bilingual labels`
            );
          }
        }
      }
    }
  });

  it("SURI marks every sensitive verification field sensitive", () => {
    const playbook = AGENCY_FILING_CONFIGS.find(
      (c) => c.id === "SURI_REGISTER_TAXPAYER"
    )!.playbook!;
    const sensitiveIds = playbook.steps.flatMap((s) =>
      s.fields.filter((f) => f.sensitive).map((f) => f.id)
    );
    for (const expected of ["ssn", "ssn_confirm", "verification_amount"]) {
      assert.ok(
        sensitiveIds.includes(expected),
        `SURI field ${expected} must be marked sensitive`
      );
    }
  });

  it("no playbook collects portal credentials outside the browser", () => {
    // Login, account passwords and MFA are human-only: they happen in the
    // live browser via Take over, never in SmartPR chat or a vault fill.
    const CREDENTIAL = /password|contrase|otp|one-time|mfa|secret_answer|username/i;
    for (const config of AGENCY_FILING_CONFIGS) {
      for (const step of config.playbook?.steps ?? []) {
        for (const f of step.fields ?? []) {
          assert.ok(
            !(f.type === "password" || CREDENTIAL.test(f.id) || CREDENTIAL.test(f.label_en)),
            `${config.id} step ${step.id} collects credential field ${f.id}`
          );
        }
        if (step.gate === "login") {
          assert.equal(step.channel, "IN_BROWSER", `${config.id} login step ${step.id} must be IN_BROWSER`);
        }
      }
    }
  });
});

describe("OGPE_PERMISO_UNICO playbook", () => {
  const config = AGENCY_FILING_CONFIGS.find(
    (c) => c.id === "OGPE_PERMISO_UNICO"
  )!;
  const playbook = config.playbook!;

  it("has the documented step sequence in order", () => {
    assert.deepEqual(
      playbook.steps.map((s) => s.id),
      [
        "navigate",
        "login",
        "crear_solicitud",
        "crear_proyecto",
        "permiso_unico",
        "anejos",
        "juramento",
        "payment",
        "confirmation",
      ]
    );
  });

  it("gates legal certification and payment in the human's browser", () => {
    const juramento = playbook.steps.find((s) => s.id === "juramento")!;
    assert.equal(juramento.channel, "IN_BROWSER");
    assert.equal(juramento.gate, "signature");
    const payment = playbook.steps.find((s) => s.id === "payment")!;
    assert.equal(payment.channel, "IN_BROWSER");
    assert.equal(payment.gate, "payment");
  });

  it("flags post-login content as manual-sourced, not live-verified", () => {
    assert.ok(
      playbook.quirks_en.some(
        (q) =>
          q.includes("live-verified") && q.toLowerCase().includes("manual")
      ),
      "must disclose the post-login manual basis"
    );
  });
});

describe("SURI_REGISTER_TAXPAYER playbook", () => {
  const config = AGENCY_FILING_CONFIGS.find(
    (c) => c.id === "SURI_REGISTER_TAXPAYER"
  )!;
  const playbook = config.playbook!;

  it("has the documented step sequence in order", () => {
    assert.deepEqual(
      playbook.steps.map((s) => s.id),
      [
        "navigate",
        "id_type_ssn",
        "taxpayer_verification",
        "correspondence",
        "merchant_info",
        "web_user",
        "review_submit",
        "confirmation",
        "first_login",
        "otp",
        "dashboard",
      ]
    );
  });

  it("keeps the legal account-creation act and phone call in the human's browser", () => {
    const review = playbook.steps.find((s) => s.id === "review_submit")!;
    assert.equal(review.channel, "IN_BROWSER");
    assert.equal(review.gate, "signature");
    const correspondence = playbook.steps.find(
      (s) => s.id === "correspondence"
    )!;
    assert.equal(correspondence.channel, "IN_BROWSER");
    assert.equal(correspondence.gate, "phone_call");
  });

  it("has no payment step and discloses the unverified live state", () => {
    assert.ok(
      !playbook.steps.some((s) => s.gate === "payment"),
      "SURI registration is free — no payment gate"
    );
    assert.ok(
      playbook.quirks_en.some((q) => q.includes("UNVERIFIED")),
      "must disclose that live screens are unverified"
    );
  });

  it('encodes that selecting "Dueño" determines Administrador Principal', () => {
    const merchant = playbook.steps.find((s) => s.id === "merchant_info")!;
    const role = merchant.fields.find((f) => f.id === "merchant_role")!;
    assert.ok(role.options!.includes("Dueño"));
    assert.ok(merchant.notes_en!.includes("Administrador Principal"));
  });
});
