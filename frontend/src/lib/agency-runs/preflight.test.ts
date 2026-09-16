import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getFilingConfig } from "./filingTypes";
import { buildGoalBrief, goalBriefToPromptBlock } from "./goalBrief";
import {
  buildPreflight,
  MAX_PREFLIGHT_QUESTIONS,
  parseAccountStatusAnswer,
  type PortalAccountStatus,
} from "./preflight";
import type { AgencyAction } from "./agencyActions";
import type { GoalBrief } from "./goalBrief";

function actionWithMissing(missing: AgencyAction["missing_items"]): AgencyAction {
  return {
    id: "SURI_REGISTER_TAXPAYER",
    filing_type: "SURI_REGISTER_TAXPAYER",
    agency_id: "HACIENDA_SURI",
    title_en: "Register as a taxpayer",
    title_es: "Registrarse como contribuyente",
    agency_en: "Hacienda / SURI",
    agency_es: "Hacienda / SURI",
    status: "ready",
    known: 12,
    total: 14,
    missing_items: missing,
    blocked_by: [],
    evidence_available: [],
  };
}

const noEvidenceConfig = {
  ...getFilingConfig("SURI_REGISTER_TAXPAYER"),
  evidenceTags: [],
  uploadsEn: "",
};

function briefFor(action: AgencyAction, portal_account?: PortalAccountStatus): GoalBrief {
  return buildGoalBrief({
    config: getFilingConfig("SURI_REGISTER_TAXPAYER"),
    action,
    portal_account,
  });
}

describe("buildPreflight", () => {
  it("asks the account question first when status is unknown", () => {
    const preflight = buildPreflight({
      config: getFilingConfig("SURI_REGISTER_TAXPAYER"),
      action: actionWithMissing([]),
      brief: briefFor(actionWithMissing([])),
      portalAccount: "unknown",
    });
    assert.equal(preflight.questions[0]?.kind, "account_status");
  });

  it("skips the account question when the status is remembered", () => {
    for (const status of ["has_account", "no_account"] as const) {
      const preflight = buildPreflight({
        config: getFilingConfig("SURI_REGISTER_TAXPAYER"),
        action: actionWithMissing([]),
        brief: briefFor(actionWithMissing([])),
        portalAccount: status,
      });
      assert.ok(
        preflight.questions.every((q) => q.kind !== "account_status"),
        `account_status asked despite ${status}`
      );
    }
  });

  it("turns sensitive missing items into secure-field questions", () => {
    const missing = [
      { id: "owner.ssn", label_en: "Owner SSN", label_es: "SSN del dueño", sensitive: true },
      { id: "business.phone", label_en: "Phone", label_es: "Teléfono", sensitive: false },
    ];
    const preflight = buildPreflight({
      config: getFilingConfig("SURI_REGISTER_TAXPAYER"),
      action: actionWithMissing(missing),
      brief: briefFor(actionWithMissing(missing)),
      portalAccount: "has_account",
    });
    const sensitive = preflight.questions.filter((q) => q.kind === "sensitive_field");
    assert.equal(sensitive.length, 1);
    assert.equal(sensitive[0].kind === "sensitive_field" && sensitive[0].id, "owner.ssn");
    assert.equal(sensitive[0].kind === "sensitive_field" && sensitive[0].label_en, "Owner SSN");
    // non-sensitive missing items never become pre-flight questions
    assert.ok(
      preflight.questions.every(
        (q) => q.kind !== "sensitive_field" || (q as { id: string }).id !== "business.phone"
      )
    );
  });

  it("caps questions at MAX_PREFLIGHT_QUESTIONS", () => {
    const missing = Array.from({ length: 5 }, (_, i) => ({
      id: `field.${i}`,
      label_en: `Field ${i}`,
      label_es: `Campo ${i}`,
      sensitive: true,
    }));
    const preflight = buildPreflight({
      config: getFilingConfig("SURI_REGISTER_TAXPAYER"),
      action: actionWithMissing(missing),
      brief: briefFor(actionWithMissing(missing)),
      portalAccount: "unknown",
    });
    assert.ok(preflight.questions.length <= MAX_PREFLIGHT_QUESTIONS);
    assert.equal(preflight.questions[0]?.kind, "account_status");
  });

  it("adds the evidence question only when the filing needs uploads", () => {
    const withEvidence = buildPreflight({
      config: getFilingConfig("SURI_REGISTER_TAXPAYER"),
      action: actionWithMissing([]),
      brief: briefFor(actionWithMissing([])),
      portalAccount: "has_account",
    });
    assert.ok(withEvidence.questions.some((q) => q.kind === "evidence"));

    const withoutEvidence = buildPreflight({
      config: noEvidenceConfig,
      action: actionWithMissing([]),
      brief: briefFor(actionWithMissing([])),
      portalAccount: "has_account",
    });
    assert.ok(withoutEvidence.questions.every((q) => q.kind !== "evidence"));
    assert.equal(withoutEvidence.questions.length, 0);
  });

  it("passport_items carry labels only — never values", () => {
    const brief = briefFor(actionWithMissing([]));
    const preflight = buildPreflight({
      config: getFilingConfig("SURI_REGISTER_TAXPAYER"),
      action: actionWithMissing([]),
      brief,
      portalAccount: "unknown",
    });
    assert.ok(preflight.passport_items.length > 0);
    const dumped = JSON.stringify(preflight.passport_items);
    assert.ok(!/66-1234567|Café Plaza/.test(dumped));
    for (const item of preflight.passport_items) {
      assert.equal(typeof item.label_en, "string");
      assert.equal(typeof item.label_es, "string");
      assert.equal(Object.keys(item).sort().join(","), "label_en,label_es");
    }
  });
});

describe("parseAccountStatusAnswer", () => {
  it("accepts only the two explicit choices", () => {
    assert.equal(parseAccountStatusAnswer("has_account"), "has_account");
    assert.equal(parseAccountStatusAnswer("no_account"), "no_account");
    assert.equal(parseAccountStatusAnswer("yes"), null);
    assert.equal(parseAccountStatusAnswer(""), null);
    assert.equal(parseAccountStatusAnswer(null), null);
    assert.equal(parseAccountStatusAnswer(undefined), null);
    assert.equal(parseAccountStatusAnswer({}), null);
  });
});

describe("goal brief portal-account line", () => {
  it("directs the agent to a login gate when the human has an account", () => {
    const block = goalBriefToPromptBlock(
      briefFor(actionWithMissing([]), "has_account")
    );
    assert.ok(block.includes("PORTAL ACCOUNT"));
    assert.ok(block.includes("USER_LOGIN"));
    assert.ok(!/invent.*password/i.test(block));
  });

  it("directs the agent to registration and forbids invented passwords", () => {
    const block = goalBriefToPromptBlock(
      briefFor(actionWithMissing([]), "no_account")
    );
    assert.ok(block.includes("PORTAL ACCOUNT"));
    assert.ok(/never invent/i.test(block));
  });

  it("covers the unknown case without inventing an answer", () => {
    const block = goalBriefToPromptBlock(briefFor(actionWithMissing([]), "unknown"));
    assert.ok(block.includes("PORTAL ACCOUNT"));
    assert.ok(block.includes("unknown"));
  });

  it("omits the line when no status is set (backwards compatible)", () => {
    const block = goalBriefToPromptBlock(briefFor(actionWithMissing([])));
    assert.ok(!block.includes("PORTAL ACCOUNT"));
  });
});

describe("portalAccounts memory (no-database path)", () => {
  it("returns unknown and no-ops without DATABASE_URL", async () => {
    // These tests run without a database — the memory layer must degrade
    // gracefully so the pre-flight question is simply asked every time.
    const { getPortalAccountStatus, setPortalAccountStatus } = await import(
      "./portalAccounts"
    );
    assert.equal(
      await getPortalAccountStatus("00000000-0000-0000-0000-000000000000", "HACIENDA_SURI"),
      "unknown"
    );
    await setPortalAccountStatus("00000000-0000-0000-0000-000000000000", "HACIENDA_SURI", true);
  });
});
