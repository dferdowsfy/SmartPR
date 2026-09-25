import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getFilingConfig } from "./filingTypes";
import { getSiteUrl } from "../siteUrl";
import { isAgencyId, resolveAgencyActions } from "./agencyActions";
import { buildAgencyTaskPrompt } from "./taskPrompt";

describe("DEMO_REHEARSAL_PORTAL filing config", () => {
  const config = getFilingConfig("DEMO_REHEARSAL_PORTAL");

  it("is enabled and grouped under the DEMO_REHEARSAL agency", () => {
    assert.equal(config.enabled, true);
    assert.equal(config.agencyId, "DEMO_REHEARSAL");
    assert.equal(config.requiresExistingAccount, false);
    assert.ok(isAgencyId("DEMO_REHEARSAL"));
  });

  it("domains/startUrl resolve from the app site URL (env-driven, no hardcoded portal domain)", () => {
    const site = getSiteUrl().replace(/\/+$/, "");
    const host = new URL(site).hostname;
    assert.deepEqual(config.domains, [host]);
    assert.equal(config.startUrl, `${site}/rehearsal-portal`);
    assert.ok(
      !config.startUrl.includes("estado.pr.gov") &&
        !config.startUrl.includes("hacienda.pr.gov") &&
        !config.startUrl.includes("ogpe.pr.gov"),
      "demo portal must never point at a real government domain"
    );
  });

  it("brief is goal-oriented and names every human gate", () => {
    const proc = config.procedureEn.join("\n").toLowerCase();
    for (const gate of [
      "pause_user_login with portal_step kind=login",
      "never type a password yourself",
      "portal_step kind=identity",
      "never check legal certifications",
      "never enter card details or pay",
      "never click the final submit",
    ]) {
      assert.ok(proc.includes(gate), `procedure missing gate: ${gate}`);
    }
    assert.ok(
      config.goalEn.includes("REHEARSAL") && config.goalEn.includes("fictional"),
      "goal must stay honest that this is a fictional rehearsal"
    );
  });

  it("deterministic validation error is part of the agent brief", () => {
    const hints = config.hintsEn.join("\n");
    assert.ok(
      hints.includes("first form submit always fails on phone format"),
      "brief should warn the agent about the deterministic phone validation error"
    );
  });

  it("SSN is a declared sensitive need (drives pre-flight Q2)", () => {
    const ids = (config.sensitiveNeeds ?? []).map((n) => n.id);
    assert.ok(ids.includes("demo_ssn"));
  });

  it("task prompt embeds the demo start URL and domain allowlist", () => {
    const task = buildAgencyTaskPrompt({ config, passport: null, goalBrief: null });
    assert.ok(task.includes(config.startUrl), "prompt must include the demo start URL");
    assert.ok(task.includes(config.domains[0]), "prompt must include the demo domain");
  });

  it("resolves as a ready action via resolveAgencyActions", async () => {
    const actions = await resolveAgencyActions({
      business_id: "biz-demo",
      agency_id: "DEMO_REHEARSAL",
      passport: null,
      priorRuns: [],
    });
    const action = actions.find((a) => a.filing_type === "DEMO_REHEARSAL_PORTAL");
    assert.ok(action, "demo action should resolve");
    assert.equal(action.status, "ready");
  });
});

describe("DEMO_REHEARSAL_PORTAL registration-path hardening", () => {
  const config = getFilingConfig("DEMO_REHEARSAL_PORTAL");
  const proc = config.procedureEn.join("\n");

  it("create-account path never touches login", () => {
    assert.ok(
      proc.includes("NEVER click Log in"),
      "brief must forbid the login path when the human has no account"
    );
  });

  it("registration path skips entity search via the fictional-number Continue", () => {
    assert.ok(
      proc.includes("go DIRECTLY to the filing form"),
      "brief must send the agent straight to filing after registration"
    );
    assert.ok(
      proc.includes("Never visit the entity search page on the registration path")
    );
  });

  it("agent must never ask the human for a registry number on the demo portal", () => {
    assert.ok(
      proc.includes("NEVER ask the human for a registry number"),
      "demo numbers are fictional — the agent supplies them itself"
    );
    assert.ok(
      proc.includes("enter any 6+ digits yourself"),
      "search path must be self-service with any 6+ digits"
    );
  });

  it("task prompt carries the registration-path directives", () => {
    const task = buildAgencyTaskPrompt({ config, passport: null, goalBrief: null });
    assert.ok(task.includes("NEVER click Log in"));
    assert.ok(task.includes("NEVER ask the human for a registry number"));
  });
});

describe("DEMO_REHEARSAL_PORTAL login is a human step (takeover)", () => {
  const config = getFilingConfig("DEMO_REHEARSAL_PORTAL");
  const proc = config.procedureEn.join("\n");

  it("procedure never has the agent type credentials", () => {
    assert.ok(!/invent a clearly-fictional password/i.test(proc));
    assert.ok(proc.includes("the human signs in in the browser via Take over"));
  });

  it("task prompt has no demo credential carve-out and keeps human-only steps", () => {
    const task = buildAgencyTaskPrompt({ config, passport: null, goalBrief: null });
    assert.ok(!task.includes("DEMO PORTAL CREDENTIALS"));
    assert.ok(task.includes("HUMAN-ONLY STEPS"));
    assert.ok(task.includes("Never certify, sign, pay, or submit on the human's behalf."));
    assert.ok(task.includes("PORTAL_STEP: kind=<kind>"));
  });
});
