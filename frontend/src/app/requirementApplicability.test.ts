import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runRulesEngine, type KnowledgeBase } from "./rulesEngine.ts";
import {
  classifyEngineRequirements,
  applyEntityFormationExclusivity,
} from "./requirementApplicability.ts";
import { exclusiveFormationRequirements, entityTypeRequirements } from "./forms/engine/requirementAugment.ts";
import type { CanonicalApplicationData } from "./forms/engine/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const kbDir = join(here, "..", "kb");
const load = (f: string) => JSON.parse(readFileSync(join(kbDir, f), "utf8"));
const KB: KnowledgeBase = {
  municipalities: load("municipalities.json"),
  businessTypes: load("business_types.json"),
  questions: load("questions.json"),
  documents: load("documents.json"),
  rules: load("rules.json"),
};

const restaurantAnswers = {
  Q_PHYSICAL_LOCATION: true,
  Q_FOOD_PREPARED: true,
  Q_FOOD_SOLD: true,
  Q_ALCOHOL_SOLD: false,
  Q_OUTDOOR_SEATING: true,
  Q_LIVE_ENTERTAINMENT: false,
  Q_EMPLOYEES_HIRED: true,
};

function classify(entityType: string, decisions: Record<string, "applies" | "not_applies" | "not_sure">) {
  const generated = runRulesEngine(KB, {
    municipalityName: "San Juan",
    businessTypeName: "Restaurant",
    answers: restaurantAnswers,
  }).requirements;
  return classifyEngineRequirements(generated, {
    kb: KB,
    entityType,
    potentialDecisions: decisions,
  });
}

test("LLC does not receive Certificate of Incorporation", () => {
  const classified = classify("limited_liability_company", {
    historic: "not_applies",
    coastal: "not_applies",
    metro: "applies",
    tourism: "not_sure",
    capital: "applies",
  });
  assert.equal(classified.some((r) => r.document_id === "DOC_CERT_INCORPORATION"), false);
  const canonical = { business: { entityType: "limited_liability_company" } } as CanonicalApplicationData;
  const exclusive = exclusiveFormationRequirements(canonical, classified);
  const added = entityTypeRequirements<{ document_id: string; code?: string; name?: string; reason?: string }>(canonical, exclusive, (d) => ({
    document_id: d.document_id,
    code: d.code,
    name: d.name,
    reason: d.reason,
  }));
  const final = exclusiveFormationRequirements(canonical, [...exclusive, ...added]);
  // RULE_0651 (validated review 2026-09-16) fires DOC_CERT_ORGANIZATION —
  // the same LLC certificate as DOC_ARTICLES_ORGANIZATION. The augment is
  // suppressed when the engine already emitted the alias (live QA 2026-09-19
  // 00:00: duplicate formation cards) — so exactly one LLC formation
  // document must survive, never the corporation certificate.
  const llcFormation = final.filter(
    (r) => r.document_id === "DOC_ARTICLES_ORGANIZATION" || r.document_id === "DOC_CERT_ORGANIZATION"
  );
  assert.equal(llcFormation.length, 1, "exactly one LLC formation certificate: " + llcFormation.map((r) => r.document_id).join(","));
  assert.equal(final.some((r) => r.document_id === "DOC_CERT_INCORPORATION"), false);
});

test("deleted historic docs do NOT fire (validated review)", () => {
  const classified = classify("limited_liability_company", {
    historic: "not_applies",
    coastal: "not_applies",
    metro: "applies",
  });
  // Validated review 2026-09-16: historic district review, facade
  // preservation, and sign variance were deleted. No historic docs should fire.
  const historic = classified.filter((r) =>
    /historic|facade/i.test(r.document_id + r.document_name)
  );
  assert.ok(historic.length === 0, "deleted historic docs should not fire: " + historic.map(r => r.document_id).join(","));
});

test("deleted historic review does NOT appear as conditional", () => {
  const classified = classify("limited_liability_company", {});
  const historic = classified.filter((r) => r.document_id === "DOC_HISTORIC_DISTRICT_REVIEW");
  // Validated review 2026-09-16: DOC_HISTORIC_DISTRICT_REVIEW deleted.
  assert.ok(historic.length === 0);
});

test("alcohol no does not create an alcohol license", () => {
  const classified = classify("limited_liability_company", { metro: "applies" });
  assert.equal(classified.some((r) => /alcohol/i.test(r.document_name) && r.applicability === "required"), false);
});

test("review conditions do not accept official upload", () => {
  const classified = classify("stock_corporation", { historic: "applies", metro: "applies" });
  const reviews = classified.filter((r) => r.kind === "review_condition" || /historic district review/i.test(r.document_name));
  assert.ok(reviews.every((r) => r.acceptsOfficialUpload === false || r.kind === "review_condition"));
});

test("deleted metro traffic study does NOT fire (validated review)", () => {
  const unanswered = classify("limited_liability_company", {});
  const traffic = unanswered.find((r) => r.document_id === "DOC_TRAFFIC_IMPACT_STUDY");
  // Validated review 2026-09-16: traffic impact study deleted — not a
  // universal requirement. The document must not appear.
  assert.equal(traffic, undefined, "deleted DOC_TRAFFIC_IMPACT_STUDY should not fire");
  const confirmed = classify("limited_liability_company", { metro: "applies" });
  const trafficOn = confirmed.find((r) => r.document_id === "DOC_TRAFFIC_IMPACT_STUDY");
  assert.equal(trafficOn, undefined, "deleted DOC_TRAFFIC_IMPACT_STUDY should not fire even when metro applies");
});

test("applyEntityFormationExclusivity is a pure swap", () => {
  const rows = [
    { document_id: "DOC_CERT_INCORPORATION" },
    { document_id: "DOC_EIN" },
  ];
  const llc = applyEntityFormationExclusivity(rows, "limited_liability_company");
  assert.deepEqual(llc.map((r) => r.document_id), ["DOC_EIN"]);
});

test("unknown entity type: formation certificates are conditional, never required (S18)", () => {
  // S18 (Trujillo Alto café, entity type "Other / not sure"): the LLC
  // Certificate of Organization fired as REQUIRED while the mutually
  // exclusive Certificate of Incorporation was correctly conditional.
  // A specific formation certificate can never be required when the legal
  // form is unknown — both stay conditional until the form is confirmed.
  const generated = runRulesEngine(KB, {
    municipalityName: "Trujillo Alto",
    businessTypeName: "Cafe",
    businessStatus: "new",
    entityNotFormed: true,
    entityType: "other",
    answers: {
      Q_PHYSICAL_LOCATION: true,
      Q_FOOD_PREPARED: true,
      Q_FOOD_SOLD: true,
      Q_EMPLOYEES_HIRED: true,
    },
  }).requirements;
  const classified = classifyEngineRequirements(generated, {
    kb: KB,
    entityType: "other",
    businessStatus: "new",
  });
  const byDoc = new Map(classified.map((r) => [r.document_id, r]));
  const llcCert = byDoc.get("DOC_CERT_ORGANIZATION");
  assert.ok(llcCert, "DOC_CERT_ORGANIZATION should still surface for an unknown legal form");
  assert.equal(llcCert.applicability, "conditional");
  assert.ok(llcCert.triggerFacts.some((t) => t.includes("entityType:unknown")));
  const corpCert = byDoc.get("DOC_CERT_INCORPORATION");
  if (corpCert) {
    assert.equal(corpCert.applicability, "conditional");
  }
  // A confirmed LLC still resolves the certificate to required.
  const llcKnown = classifyEngineRequirements(generated, {
    kb: KB,
    entityType: "limited_liability_company",
    businessStatus: "new",
  });
  const llcKnownCert = llcKnown.find((r) => r.document_id === "DOC_CERT_ORGANIZATION");
  assert.ok(llcKnownCert, "DOC_CERT_ORGANIZATION should surface for a known LLC");
  assert.equal(llcKnownCert.applicability, "required");
});
