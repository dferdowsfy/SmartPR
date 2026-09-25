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

test("REG-MFK-ANSWERED-001: an answered fact is never reported missing", () => {
  // The alcohol chain's heuristic siblings (RULE_0014 on the license,
  // RULE_0622/0625/0628 on CRIM/ASUME/background, RULE_0664 on tax
  // compliance) all name alcohol_sold as their missing fact. When the
  // intake answered Q_ALCOHOL_SOLD, the fact is known — no card may list
  // it as missing, and no card may be forced into needs_more_information
  // over it (QA 2026-09-22 00:00, S121 Dorado restaurant).
  const answers = {
    Q_PHYSICAL_LOCATION: true,
    Q_ALCOHOL_SOLD: true,
    Q_ALCOHOL_SERVED: true,
    Q_EMPLOYEES_HIRED: true,
  };
  const generated = runRulesEngine(KB, {
    municipalityName: "Dorado",
    businessTypeName: "Restaurant",
    answers,
  }).requirements;
  // NOTE: this direct runRulesEngine path bypasses buildEngineInput, so the
  // answers object here IS the raw intake — pass it as rawAnswers exactly
  // as computeRequirementsFromSnapshot does. Passing only `answers` would
  // not exercise the fix (REG-MFK-ANSWERED-001 v2: input.answers always
  // carries default-false for legacy questions; G07 proved presence there
  // is not an answered question).
  const classified = classifyEngineRequirements(generated, {
    kb: KB,
    entityType: "limited_liability_company",
    businessStatus: "new",
    answers,
    rawAnswers: answers,
  });
  for (const docId of [
    "DOC_ALCOHOL_LICENSE",
    "DOC_CRIM_CLEARANCE",
    "DOC_ASUME_CLEARANCE",
    "DOC_BACKGROUND_CHECK",
    "DOC_HACIENDA_TAX_COMPLIANCE",
  ]) {
    const card = classified.find((r) => r.document_id === docId);
    assert.ok(card, docId + " should surface");
    assert.ok(
      !card.missingFacts.includes("alcohol_sold"),
      docId + " must not name answered alcohol_sold as missing: " +
        JSON.stringify(card.missingFacts)
    );
  }
  const license = classified.find((r) => r.document_id === "DOC_ALCOHOL_LICENSE");
  assert.equal(license?.applicability, "required");

  // Control: served-only (sold genuinely unasked) keeps the honest
  // needs_more_information posture — the fact really is unknown there.
  const servedOnly = {
    Q_PHYSICAL_LOCATION: true,
    Q_ALCOHOL_SERVED: true,
    Q_EMPLOYEES_HIRED: true,
  };
  const generated2 = runRulesEngine(KB, {
    municipalityName: "Dorado",
    businessTypeName: "Restaurant",
    answers: servedOnly,
  }).requirements;
  const classified2 = classifyEngineRequirements(generated2, {
    kb: KB,
    entityType: "limited_liability_company",
    businessStatus: "new",
    answers: servedOnly,
    rawAnswers: servedOnly,
  });
  const license2 = classified2.find((r) => r.document_id === "DOC_ALCOHOL_LICENSE");
  assert.ok(license2, "DOC_ALCOHOL_LICENSE should surface for served-only");
  assert.equal(license2.applicability, "needs_more_information");
  assert.ok(
    license2.missingFacts.includes("alcohol_sold"),
    "served-only must still name the genuinely unknown alcohol_sold: " +
      JSON.stringify(license2.missingFacts)
  );
});

test("REG-MFK-ANSWERED-001 v2: an engine default-false is not an answered question", () => {
  // v1 of this fix checked presence in the engine's answers object — but
  // buildEngineInput always emits a concrete boolean for legacy-mapped
  // questions (false when unanswered), so G07's never-asked Q_ALCOHOL_SOLD
  // read as "answered" and a validated needs_more_information flipped to
  // likely_required. Only rawAnswers/resolvedAnswers establish a fact.
  const engineAnswers = {
    Q_PHYSICAL_LOCATION: true,
    Q_ALCOHOL_SOLD: false, // the unanswered default, as buildEngineInput emits it
    Q_ALCOHOL_SERVED: true,
    Q_EMPLOYEES_HIRED: true,
  };
  const rawAnswers = {
    Q_PHYSICAL_LOCATION: true,
    Q_ALCOHOL_SERVED: true,
    Q_EMPLOYEES_HIRED: true,
  };
  const generated = runRulesEngine(KB, {
    municipalityName: "Dorado",
    businessTypeName: "Restaurant",
    answers: engineAnswers,
  }).requirements;
  const classified = classifyEngineRequirements(generated, {
    kb: KB,
    entityType: "limited_liability_company",
    businessStatus: "new",
    answers: engineAnswers,
    rawAnswers,
  });
  const license = classified.find((r) => r.document_id === "DOC_ALCOHOL_LICENSE");
  assert.ok(license, "DOC_ALCOHOL_LICENSE should surface");
  assert.equal(
    license.applicability,
    "needs_more_information",
    "a default-false must not flip the validated NMI posture"
  );
  assert.ok(
    license.missingFacts.includes("alcohol_sold"),
    "the never-asked fact must still be reported missing: " +
      JSON.stringify(license.missingFacts)
  );
});

// ---------------------------------------------------------------------------
// REG-CHANGE-OF-USE-001 (2026-09-25): an existing business converting its
// premises to a new use (Guaynabo furniture manufacturer: warehouse/office
// -> manufacturing) must surface the use authorization (Permiso Único) as a
// REQUIRED new filing — not just the construction permit, and not demoted
// to verify_existing by the standing physical-location basis (RULE_0007).
// Without a change of use the standing posture is preserved.
// ---------------------------------------------------------------------------
function classifyChangeOfUse(changeOfUse: boolean) {
  const generated = runRulesEngine(KB, {
    municipalityName: "Guaynabo",
    businessTypeName: "Furniture Manufacturing",
    answers: { Q_PHYSICAL_LOCATION: true, Q_EMPLOYEES_HIRED: true },
    projectFacts: { change_of_use: changeOfUse, project_type: "renovation" },
    businessStatus: "existing",
  }).requirements;
  return classifyEngineRequirements(generated, {
    kb: KB,
    entityType: "limited_liability_company",
    businessStatus: "existing",
    answers: { Q_PHYSICAL_LOCATION: true, Q_EMPLOYEES_HIRED: true },
  });
}

test("change of use: Permiso Único is a REQUIRED new filing for an existing business", () => {
  const classified = classifyChangeOfUse(true);
  const unico = classified.find((r) => r.document_id === "DOC_PERMISO_UNICO");
  assert.ok(unico, "DOC_PERMISO_UNICO should surface");
  assert.equal(
    unico.applicability,
    "required",
    "a confirmed change of use asserts a new use-authorization filing; " +
      "RULE_0007's verify_existing posture must not demote it"
  );
  assert.equal(
    unico.source_rule_id,
    "RULE_0699",
    "the card's legal basis must be the change-of-use rule, not the physical-location rule"
  );
  assert.ok(
    /^Project fact: change_of_use = true$/.test(unico.reason),
    "the card reason must name the change of use: " + unico.reason
  );
  const construction = classified.find(
    (r) => r.document_id === "DOC_OGPE_CONSTRUCTION_PERMIT"
  );
  assert.ok(construction, "the renovation still needs its construction permit");
  assert.equal(construction.applicability, "required");
});

test("no change of use: Permiso Único stays verify_existing for an existing business", () => {
  const classified = classifyChangeOfUse(false);
  const unico = classified.find((r) => r.document_id === "DOC_PERMISO_UNICO");
  assert.ok(unico, "DOC_PERMISO_UNICO should surface");
  assert.equal(
    unico.applicability,
    "verify_existing",
    "without a change of use the existing business verifies its standing permit"
  );
  const construction = classified.find(
    (r) => r.document_id === "DOC_OGPE_CONSTRUCTION_PERMIT"
  );
  assert.ok(construction, "the renovation still needs its construction permit");
  assert.equal(construction.applicability, "required");
});
