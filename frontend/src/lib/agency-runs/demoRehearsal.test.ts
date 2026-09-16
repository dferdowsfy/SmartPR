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

  it("brief is goal-oriented and names every pause gate", () => {
    const proc = config.procedureEn.join("\n").toLowerCase();
    for (const gate of [
      "pause_user_login",
      "pause at password creation",
      "never invent a password",
      "never type credentials unprompted",
      "pause for the human",
      "social security number",
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
