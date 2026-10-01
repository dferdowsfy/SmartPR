// Teach Clara v1 — described playbooks: validation, secret scrubbing,
// versioning, run lookup, prompt block, learned bindings.
// Run: npx tsx --test src/lib/agency-runs/teach/taughtPlaybooks.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryPlaybookRepo,
  PlaybookError,
  learnedBindingsFromRun,
  normalizePlaybookInput,
  playbookForRun,
  recordRunLearning,
  renderTaughtPlaybookBlock,
  saveTaughtPlaybook,
  scrubSecrets,
} from "./taughtPlaybooks";
import { buildAgencyTaskPrompt } from "../taskPrompt";
import { getFilingConfig } from "../filingTypes";

const OWNER = "00000000-0000-4000-8000-000000000001";
const base = {
  requirement_key: "PR_ENERGY_ENVIRONMENTAL_REVIEW",
  requirement_name: "Environmental review",
  agency: "OGPe",
  portal_url: "https://www.sbp.pr.gov/",
  steps: ["Sign in with the business account", "New application → Environmental (DEA)", "Upload the site plan"],
  bindings: [{ label: "Nombre legal", path: "business.legalName" }, { label: "Número de catastro", path: null }],
};

describe("taught playbooks", () => {
  it("normalizes: host from the portal URL, unknown passport paths become 'ask each time'", () => {
    const n = normalizePlaybookInput({ ...base, bindings: [...base.bindings, { label: "Bogus", path: "not.a.path" }] });
    assert.equal(n.portal_host, "www.sbp.pr.gov");
    assert.deepEqual(n.bindings.map((b) => b.path), ["business.legalName", null, null]);
  });

  it("rejects a missing portal URL, no steps, and non-media attachments", () => {
    assert.throws(() => normalizePlaybookInput({ ...base, portal_url: "sbp" }), PlaybookError);
    assert.throws(() => normalizePlaybookInput({ ...base, steps: ["  "] }), /at least one step/);
    assert.throws(() => normalizePlaybookInput({ ...base, attachments: [{ name: "x.exe", type: "application/octet-stream", size: 1, data_url: null }] }), /Screenshots/);
  });

  it("never stores secrets typed into the steps", () => {
    assert.equal(scrubSecrets("SSN 123-45-6789 then password: hunter2"), "SSN [removed] then password [removed]");
    assert.equal(scrubSecrets("EIN 66-1234567"), "EIN [removed]");
    const n = normalizePlaybookInput({ ...base, steps: ["Log in, contraseña: abc123"] });
    assert.ok(!/abc123/.test(n.steps[0]));
  });

  it("saving again makes a new version of the same requirement + portal; run lookup falls back to the host", async () => {
    const repo = new MemoryPlaybookRepo();
    const v1 = await saveTaughtPlaybook(repo, OWNER, base);
    const v2 = await saveTaughtPlaybook(repo, OWNER, { ...base, steps: [...base.steps, "Stop at the review page"] });
    assert.equal(v1.version, 1);
    assert.equal(v2.version, 2);
    assert.equal(v2.id, v1.id);
    assert.equal((await playbookForRun(repo, OWNER, { requirementKeys: ["PR_ENERGY_ENVIRONMENTAL_REVIEW"], portalUrl: "https://www.sbp.pr.gov/x" }))?.version, 2);
    assert.equal((await playbookForRun(repo, OWNER, { requirementKeys: ["OTHER"], portalUrl: "https://www.sbp.pr.gov/" }))?.id, v1.id, "same portal");
    assert.equal(await playbookForRun(repo, OWNER, { requirementKeys: ["OTHER"], portalUrl: "https://suri.hacienda.pr.gov/" }), null);
    assert.equal(await playbookForRun(repo, "someone-else", { requirementKeys: ["PR_ENERGY_ENVIRONMENTAL_REVIEW"], portalUrl: "https://www.sbp.pr.gov/" }), null, "private to the owner");
  });

  it("Clara's run prompt reads the playbook as guidance under the safety rules", async () => {
    const repo = new MemoryPlaybookRepo();
    const pb = await saveTaughtPlaybook(repo, OWNER, base);
    const block = renderTaughtPlaybookBlock(pb);
    assert.match(block, /TAUGHT PLAYBOOK/);
    assert.match(block, /1\. Sign in with the business account/);
    assert.match(block, /"Nombre legal" ← business\.legalName/);
    assert.match(block, /ASK THE PERSON EACH TIME.*"Número de catastro"/);
    assert.match(block, /never click the final submit/);
    const prompt = buildAgencyTaskPrompt({ config: getFilingConfig("OGPE_PERMISO_UNICO"), passport: null, taughtPlaybook: pb });
    assert.ok(prompt.includes("TAUGHT PLAYBOOK"));
    assert.ok(prompt.indexOf("HARD RULES") < prompt.indexOf("TAUGHT PLAYBOOK"), "hard rules come first");
    assert.ok(!buildAgencyTaskPrompt({ config: getFilingConfig("OGPE_PERMISO_UNICO"), passport: null }).includes("TAUGHT PLAYBOOK"));
  });

  it("a run's answered (non-sensitive) fields are remembered as bindings — labels only", async () => {
    const repo = new MemoryPlaybookRepo();
    const pb = await saveTaughtPlaybook(repo, OWNER, base);
    const learned = learnedBindingsFromRun(
      [
        { id: "fiscal_year_end", label: "Cierre del año fiscal", sensitive: false },
        { id: "ssn", label: "Seguro social", sensitive: true },
        { id: "email", label: "Correo electrónico", sensitive: false },
        { id: "legal", label: "Nombre legal", sensitive: false },
      ],
      ["fiscal_year_end", "ssn", "email", "legal"]
    );
    assert.ok(!learned.some((l) => /Seguro social/.test(l.label)), "sensitive never recorded");
    const next = await recordRunLearning(repo, pb, learned);
    assert.ok(next);
    const labels = next!.bindings.map((b) => `${b.label}:${b.path ?? "ask"}:${b.source}`);
    assert.ok(labels.includes("Cierre del año fiscal:ask:run"));
    assert.ok(labels.includes("Nombre legal:business.legalName:teacher"), "teacher's binding wins");
    // A re-teach keeps what runs learned.
    const v2 = await saveTaughtPlaybook(repo, OWNER, base);
    assert.ok(v2.bindings.some((b) => b.label === "Cierre del año fiscal" && b.source === "run"));
  });
});
