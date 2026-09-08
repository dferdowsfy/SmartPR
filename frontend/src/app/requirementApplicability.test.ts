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
  assert.ok(final.some((r) => r.document_id === "DOC_ARTICLES_ORGANIZATION"));
  assert.equal(final.some((r) => r.document_id === "DOC_CERT_INCORPORATION"), false);
});

test("negative historic decision suppresses historic-district requirements", () => {
  const classified = classify("limited_liability_company", {
    historic: "not_applies",
    coastal: "not_applies",
    metro: "applies",
  });
  const historic = classified.filter((r) =>
    /historic|facade/i.test(r.document_id + r.document_name)
  );
  assert.ok(historic.length > 0, "engine still emits historic rows so they can be labeled");
  assert.ok(historic.every((r) => r.applicability === "not_applicable"));
  assert.ok(historic.every((r) => r.mandatory === false));
});

test("unanswered historic stays conditional, not required", () => {
  const classified = classify("limited_liability_company", {});
  const historic = classified.filter((r) => r.document_id === "DOC_HISTORIC_DISTRICT_REVIEW");
  assert.ok(historic.length === 1);
  assert.equal(historic[0].applicability, "conditional");
  assert.equal(historic[0].mandatory, false);
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

test("metro traffic study stays conditional until the metro fact is known", () => {
  const unanswered = classify("limited_liability_company", {});
  const traffic = unanswered.find((r) => r.document_id === "DOC_TRAFFIC_IMPACT_STUDY");
  assert.ok(traffic);
  assert.equal(traffic?.applicability, "conditional");
  const confirmed = classify("limited_liability_company", { metro: "applies" });
  const trafficOn = confirmed.find((r) => r.document_id === "DOC_TRAFFIC_IMPACT_STUDY");
  assert.equal(trafficOn?.applicability, "required");
});

test("applyEntityFormationExclusivity is a pure swap", () => {
  const rows = [
    { document_id: "DOC_CERT_INCORPORATION" },
    { document_id: "DOC_EIN" },
  ];
  const llc = applyEntityFormationExclusivity(rows, "limited_liability_company");
  assert.deepEqual(llc.map((r) => r.document_id), ["DOC_EIN"]);
});
