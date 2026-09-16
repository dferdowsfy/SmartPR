import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAgencyActions } from "./agencyActions";
import { getFilingConfig } from "./filingTypes";
import {
  buildGoalBrief,
  goalBriefToPromptBlock,
  stripSensitivePassport,
} from "./goalBrief";

const passport = {
  business: {
    legalName: "Café Plaza LLC",
    tradeName: "Café Plaza",
    ein: "66-1234567",
  },
  contact: { fullName: "Ana Rivera", email: "ana@cafeplaza.pr" },
};

async function suriBrief() {
  const actions = await resolveAgencyActions({
    business_id: "biz-1",
    agency_id: "HACIENDA_SURI",
    passport,
    priorRuns: [],
  });
  const action = actions.find((a) => a.filing_type === "SURI_REGISTER_TAXPAYER");
  assert.ok(action);
  return buildGoalBrief({ config: getFilingConfig("SURI_REGISTER_TAXPAYER"), action });
}

describe("buildGoalBrief", () => {
  it("carries labels only — never passport values", async () => {
    const brief = await suriBrief();
    const dumped = JSON.stringify(brief);
    for (const secret of ["Café Plaza", "66-1234567", "Ana Rivera", "ana@cafeplaza.pr"]) {
      assert.ok(!dumped.includes(secret), `leaked value: ${secret}`);
    }
    assert.ok(brief.agency_en.length > 0);
    assert.ok(brief.agency_es.length > 0);
    assert.ok(brief.goal_en.length > 0);
    assert.ok(brief.goal_es.length > 0);
    assert.ok(brief.expected_outcome_en.length > 0);
    assert.ok(brief.expected_outcome_es.length > 0);
  });

  it("known_fields = coverage keys with values, as labels", async () => {
    const brief = await suriBrief();
    const labels = brief.known_fields.map((f) => f.label_en);
    assert.ok(labels.includes("Legal business name"));
    assert.ok(labels.includes("Contact full name"));
    // contact.phone was not in the passport → must not be "known".
    assert.ok(!labels.includes("Phone"));
    for (const f of brief.known_fields) {
      assert.ok(f.label_en.length > 0 && f.label_es.length > 0);
    }
  });

  it("user_input_expected lists missing items with sensitivity, no values", async () => {
    const brief = await suriBrief();
    const ssn = brief.user_input_expected.find((f) => f.id === "ssn");
    assert.ok(ssn, "expected ssn as user input");
    assert.equal(ssn.sensitive, true);
    assert.ok(ssn.label_es.includes("Seguro Social"));
    const phone = brief.user_input_expected.find((f) => f.id === "contact.phone");
    assert.ok(phone, "expected contact.phone as user input");
    assert.equal(phone.sensitive, false);
    const dumped = JSON.stringify(brief.user_input_expected);
    assert.ok(!dumped.includes("787"), "no phone value may appear");
  });

  it("evidence_available flows from the action", async () => {
    const brief = await suriBrief();
    assert.deepEqual(brief.evidence_available, [
      "DOC_PHOTO_ID",
      "DOC_UTILITY_BILL",
      "DOC_SSN_CARD",
    ]);
  });
});

describe("goalBriefToPromptBlock", () => {
  it("renders all sections as plain text, labels only", async () => {
    const brief = await suriBrief();
    const block = goalBriefToPromptBlock(brief);
    for (const section of [
      "AGENCY:",
      "GOAL:",
      "EXPECTED OUTCOME:",
      "KNOWN INFORMATION",
      "USER INPUT EXPECTED",
      "AVAILABLE EVIDENCE",
    ]) {
      assert.ok(block.includes(section), `missing section: ${section}`);
    }
    assert.ok(block.includes("Legal business name"));
    assert.ok(block.includes("SSN (Social Security Number)"));
    assert.ok(!block.includes("Café Plaza"), "value leaked into prompt block");
    assert.ok(!block.includes("66-1234567"), "EIN leaked into prompt block");
  });
});

describe("stripSensitivePassport", () => {
  it("removes sensitive leaves at any depth, keeps the rest", () => {
    const cleaned = stripSensitivePassport({
      business: { legalName: "Café Plaza LLC", ssn: "123-45-6789", tax_id: "66-1234567" },
      contact: { email: "ana@cafeplaza.pr", mfa: "000000" },
      password: "hunter2",
      addresses: [{ line1: "123 Calle Principal", pin: "1234" }],
    });
    assert.deepEqual(cleaned, {
      business: { legalName: "Café Plaza LLC" },
      contact: { email: "ana@cafeplaza.pr" },
      addresses: [{ line1: "123 Calle Principal" }],
    });
  });

  it("returns null for null input and passes through non-sensitive data", () => {
    assert.equal(stripSensitivePassport(null), null);
    assert.deepEqual(stripSensitivePassport({ a: 1 }), { a: 1 });
  });

  it("does not mutate the original passport", () => {
    const original = { business: { ssn: "x", legalName: "Y" } };
    stripSensitivePassport(original);
    assert.deepEqual(original, { business: { ssn: "x", legalName: "Y" } });
  });
});

describe("objective override", () => {
  it("resolved objective replaces the ambiguous config goal text", async () => {
    const actions = await resolveAgencyActions({
      business_id: "biz-1",
      agency_id: "DEPT_STATE",
      passport,
      priorRuns: [],
    });
    // `passport` fixture has no formation signals → both variants offered.
    assert.equal(actions.length, 2);
    const config = getFilingConfig("DEPT_STATE_CORPORATE_FILING");
    const brief = buildGoalBrief({
      config,
      action: actions[0],
      objective_en: actions[0].objective_en,
      objective_es: actions[0].objective_es,
    });
    assert.equal(brief.goal_en, actions[0].objective_en);
    assert.ok(!brief.goal_en.includes("or file an annual report"));
    const block = goalBriefToPromptBlock(brief);
    assert.ok(block.includes(actions[0].objective_en!));
  });

  it("falls back to config goal when no objective is resolved", async () => {
    const actions = await resolveAgencyActions({
      business_id: "biz-1",
      agency_id: "HACIENDA_SURI",
      passport,
      priorRuns: [],
    });
    const action = actions.find((a) => a.filing_type === "SURI_REGISTER_TAXPAYER");
    assert.ok(action);
    const brief = buildGoalBrief({
      config: getFilingConfig("SURI_REGISTER_TAXPAYER"),
      action,
    });
    assert.equal(brief.goal_en, getFilingConfig("SURI_REGISTER_TAXPAYER").goalEn);
  });
});

describe("portal account status threading", () => {
  it("no_account brief line directs the agent to registration, not login", async () => {
    const brief = await suriBrief();
    const withStatus = buildGoalBrief({
      config: getFilingConfig("SURI_REGISTER_TAXPAYER"),
      action: { id: "x", filing_type: "SURI_REGISTER_TAXPAYER" } as never,
      portal_account: "no_account",
    });
    assert.equal(withStatus.portal_account, "no_account");
    const block = goalBriefToPromptBlock(withStatus);
    assert.ok(
      block.includes("does NOT have an account"),
      "prompt must carry the no-account line"
    );
    assert.ok(
      block.includes("new-account registration"),
      "prompt must direct the agent to registration"
    );
    void brief;
  });

  it("has_account brief line expects a login gate via USER_LOGIN", async () => {
    const withStatus = buildGoalBrief({
      config: getFilingConfig("SURI_REGISTER_TAXPAYER"),
      action: { id: "x", filing_type: "SURI_REGISTER_TAXPAYER" } as never,
      portal_account: "has_account",
    });
    const block = goalBriefToPromptBlock(withStatus);
    assert.ok(block.includes("already has an account"));
    assert.ok(block.includes("USER_LOGIN"));
  });

  it("omits the PORTAL ACCOUNT line when status is unknown (backwards compatible)", async () => {
    const brief = await suriBrief();
    const block = goalBriefToPromptBlock(brief);
    assert.ok(!block.includes("PORTAL ACCOUNT:"));
  });
});

describe("project context block", () => {
  const project_context = {
    renovation: { value: true, confidence: 0.95, evidence: "planning to renovate" },
    square_footage: { value: 12000, confidence: 0.95, evidence: "12,000-square-foot" },
    proposed_use: { value: "warehouse + office", confidence: 0.9, evidence: "warehouse and office area" },
  };

  function briefWithContext() {
    return buildGoalBrief({
      config: getFilingConfig("SURI_REGISTER_TAXPAYER"),
      action: { id: "x", filing_type: "SURI_REGISTER_TAXPAYER" } as never,
      project_context,
    });
  }

  it("renders a safe PROJECT CONTEXT block with values but no evidence quotes", () => {
    const block = goalBriefToPromptBlock(briefWithContext());
    assert.ok(block.includes("PROJECT CONTEXT"), "prompt must carry the project context block");
    assert.ok(block.includes("renovation: true"), "block must include fact values");
    assert.ok(block.includes("square_footage: 12000"));
    assert.ok(!block.includes("12,000-square-foot"), "evidence quotes must not reach the agent prompt");
    assert.ok(
      block.includes("NEVER to decide requirements"),
      "block must restate that the model never decides requirements"
    );
  });

  it("omits the block when there is no project context (backwards compatible)", async () => {
    const brief = await suriBrief();
    const block = goalBriefToPromptBlock(brief);
    assert.ok(!block.includes("PROJECT CONTEXT"));
  });

  it("project_context defaults to empty so existing callers keep working", async () => {
    const brief = await suriBrief();
    assert.deepEqual(brief.project_context, {});
  });
});
