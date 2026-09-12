import type {
  CriterionEvaluation,
  EligibilityStatus,
  IncentiveAssessment,
  IncentiveCriterion,
  IncentiveEligibilityResult,
  IncentiveFollowUpQuestion,
  IncentiveProgram,
  NormalizedProjectProfile,
  ProjectFactValue,
} from "./types";

const OWNERSHIP_FACTS = new Set(["veteran_owned", "minority_owned", "woman_owned"]);

function hasKnownValue(value: ProjectFactValue): boolean {
  return value !== undefined && value !== null && value !== "";
}

function normalized(value: unknown): unknown {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (Array.isArray(value)) return value.map(normalized);
  return value;
}

function comparableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function expectedFor(criterion: IncentiveCriterion): ProjectFactValue | string[] {
  return criterion.expectedValues?.length ? criterion.expectedValues : criterion.expectedValue;
}

function evaluateKnownCriterion(criterion: IncentiveCriterion, actual: ProjectFactValue): boolean | null {
  const expected = expectedFor(criterion);
  const a = normalized(actual);
  const e = normalized(expected);
  switch (criterion.operator) {
    case "equals": return a === e;
    case "not_equals": return a !== e;
    case "in": return Array.isArray(e) ? e.includes(a) : false;
    case "not_in": return Array.isArray(e) ? !e.includes(a) : false;
    case "contains": return Array.isArray(a) ? a.includes(e) : typeof a === "string" && typeof e === "string" ? a.includes(e) : false;
    case "truthy": return actual === true;
    case "falsy": return actual === false;
    case "exists": return hasKnownValue(actual);
    case "gte":
    case "lte":
    case "gt":
    case "lt": {
      const left = comparableNumber(actual);
      const right = comparableNumber(criterion.expectedValue);
      if (left === null || right === null) return null;
      if (criterion.operator === "gte") return left >= right;
      if (criterion.operator === "lte") return left <= right;
      if (criterion.operator === "gt") return left > right;
      return left < right;
    }
    case "date_on_or_after":
    case "date_on_or_before": {
      const left = Date.parse(String(actual));
      const right = Date.parse(String(criterion.expectedValue));
      if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
      return criterion.operator === "date_on_or_after" ? left >= right : left <= right;
    }
    default:
      return null;
  }
}

function describeExpected(criterion: IncentiveCriterion): string {
  const expected = expectedFor(criterion);
  if (criterion.operator === "truthy") return "yes";
  if (criterion.operator === "falsy") return "no";
  if (criterion.operator === "exists") return "a provided value";
  if (Array.isArray(expected)) return expected.join(", ");
  return String(expected ?? "the source-backed threshold");
}

function evaluateCriterion(
  criterion: IncentiveCriterion,
  profile: NormalizedProjectProfile,
  evidenceById: Map<string, { id: string; name: string }>,
  verifiedEvidenceTypeIds: Set<string>
): CriterionEvaluation {
  const actual = profile[criterion.factKey];
  const evidence = criterion.evidenceTypeIds.map((id) => evidenceById.get(id) ?? { id, name: id });
  const satisfyingEvidence = criterion.evidenceCanSatisfy
    ? criterion.evidenceTypeIds.find((id) => verifiedEvidenceTypeIds.has(id))
    : undefined;
  if (satisfyingEvidence) {
    return {
      criterionId: criterion.id,
      name: criterion.name,
      description: criterion.description,
      factKey: criterion.factKey,
      status: "satisfied",
      actualValue: satisfyingEvidence,
      expectedValue: expectedFor(criterion),
      required: criterion.required,
      material: criterion.material,
      evidence,
      citation: criterion.citation,
      explanation: `Validated evidence (${evidenceById.get(satisfyingEvidence)?.name || satisfyingEvidence}) satisfies this source-backed criterion.`,
    };
  }
  if (!hasKnownValue(actual)) {
    return {
      criterionId: criterion.id,
      name: criterion.name,
      description: criterion.description,
      factKey: criterion.factKey,
      status: "missing",
      actualValue: actual,
      expectedValue: expectedFor(criterion),
      required: criterion.required,
      material: criterion.material,
      evidence,
      citation: criterion.citation,
      explanation: `SmartPR needs ${criterion.question || criterion.description.toLowerCase()} before this criterion can be evaluated.`,
    };
  }

  const passed = evaluateKnownCriterion(criterion, actual);
  const status = passed === null ? "not_evaluable" : passed ? "satisfied" : "not_satisfied";
  return {
    criterionId: criterion.id,
    name: criterion.name,
    description: criterion.description,
    factKey: criterion.factKey,
    status,
    actualValue: actual,
    expectedValue: expectedFor(criterion),
    required: criterion.required,
    material: criterion.material,
    evidence,
    citation: criterion.citation,
    explanation: passed === null
      ? `The published rule uses an unsupported comparison and remains under review.`
      : passed
        ? `The confirmed project fact satisfies the source-backed criterion (${describeExpected(criterion)}).`
        : `The confirmed project fact does not satisfy the source-backed criterion (${describeExpected(criterion)}).`,
  };
}

function scopeEvaluation(input: {
  id: string;
  name: string;
  factKey: "industry" | "municipality";
  description: string;
  expected: string[];
  actual: ProjectFactValue;
  citation: string;
}): CriterionEvaluation {
  const known = hasKnownValue(input.actual);
  const actual = normalized(input.actual);
  const expected = input.expected.map((value) => normalized(value));
  const satisfied = known && expected.includes(actual);
  return {
    criterionId: input.id,
    name: input.name,
    description: input.description,
    factKey: input.factKey,
    status: !known ? "missing" : satisfied ? "satisfied" : "not_satisfied",
    actualValue: input.actual,
    expectedValue: input.expected,
    required: true,
    material: true,
    evidence: [],
    citation: input.citation,
    explanation: !known
      ? `SmartPR needs the project ${input.factKey} to evaluate the program's published scope.`
      : satisfied
        ? `The confirmed project ${input.factKey} is within the program's published scope.`
        : `The confirmed project ${input.factKey} is outside the program's published scope.`,
  };
}

function lifecycleBlocks(program: IncentiveProgram, now: Date): string | null {
  if (program.supersededBy) return `Program was superseded by ${program.supersededBy}.`;
  if (program.status !== "active") return `Program status is ${program.status}.`;
  if (program.effectiveFrom && Date.parse(program.effectiveFrom) > now.getTime()) return "The program is not effective yet.";
  if (program.effectiveTo && Date.parse(program.effectiveTo) < now.getTime()) return "The program has passed its effective end date.";
  return null;
}

function classificationFor(evaluations: CriterionEvaluation[], blocked: string | null): EligibilityStatus {
  if (blocked) return "not_eligible";
  const required = evaluations.filter((item) => item.required);
  if (required.some((item) => item.status === "not_satisfied")) return "not_eligible";
  if (required.some((item) => item.status === "missing" || item.status === "not_evaluable")) return "potentially_eligible";
  if (required.length > 0 && required.every((item) => item.status === "satisfied")) return "likely_eligible";
  if (evaluations.some((item) => item.status === "satisfied")) return "likely_eligible";
  if (evaluations.some((item) => item.status === "missing" || item.status === "not_evaluable")) return "potentially_eligible";
  return evaluations.some((item) => item.status === "not_satisfied") ? "unlikely_eligible" : "potentially_eligible";
}

function confidenceFor(evaluations: CriterionEvaluation[], eligibility: EligibilityStatus): number {
  if (evaluations.length === 0) return 0;
  const known = evaluations.filter((item) => item.status === "satisfied" || item.status === "not_satisfied").length;
  const coverage = known / evaluations.length;
  const required = evaluations.filter((item) => item.required);
  const requiredKnown = required.length
    ? required.filter((item) => item.status === "satisfied" || item.status === "not_satisfied").length / required.length
    : coverage;
  const classificationWeight = eligibility === "likely_eligible" || eligibility === "not_eligible" ? 1 : 0.75;
  return Math.round(Math.min(100, Math.max(0, (coverage * 0.45 + requiredKnown * 0.55) * classificationWeight * 100)));
}

function whySurfaced(program: IncentiveProgram, evaluations: CriterionEvaluation[], eligibility: EligibilityStatus): string {
  const satisfied = evaluations.filter((item) => item.status === "satisfied");
  const missing = evaluations.filter((item) => item.status === "missing" || item.status === "not_evaluable");
  const failed = evaluations.filter((item) => item.status === "not_satisfied");
  if (eligibility === "likely_eligible") {
    return satisfied.length
      ? `${satisfied.length} source-backed ${satisfied.length === 1 ? "criterion is" : "criteria are"} satisfied by confirmed project facts.`
      : "The published program has no unmet required criteria in the current profile.";
  }
  if (eligibility === "potentially_eligible") {
    return `${program.name} may apply, but ${missing.length} material ${missing.length === 1 ? "fact is" : "facts are"} still needed.`;
  }
  if (eligibility === "not_eligible") {
    return failed.length
      ? `${failed.length} required ${failed.length === 1 ? "criterion is" : "criteria are"} not satisfied by confirmed project facts.`
      : `The program is not currently available: ${program.status}.`;
  }
  return "The current profile does not match enough source-backed criteria to treat this as a likely opportunity.";
}

function resultFor(
  program: IncentiveProgram,
  profile: NormalizedProjectProfile,
  now: Date,
  verifiedEvidenceTypeIds: Set<string>
): IncentiveEligibilityResult {
  const evidenceById = new Map(program.evidence.map((item) => [item.id, item]));
  const sourceCitation = program.sources.map((source) => source.citation).filter(Boolean).join("; ");
  const evaluations = program.criteria.map((criterion) => evaluateCriterion(criterion, profile, evidenceById, verifiedEvidenceTypeIds));
  if (program.applicableIndustries.ids.length > 0 || program.applicableIndustries.names.length > 0) {
    evaluations.unshift(scopeEvaluation({
      id: `${program.id}:industry_scope`,
      name: "Applicable industry",
      factKey: "industry",
      description: `Industry must be within ${program.applicableIndustries.names.join(", ") || program.applicableIndustries.ids.join(", ")}.`,
      expected: [...program.applicableIndustries.ids, ...program.applicableIndustries.names],
      actual: profile.industry,
      citation: sourceCitation,
    }));
  }
  if (program.geography.municipalityIds.length > 0 || program.geography.municipalityNames.length > 0) {
    evaluations.unshift(scopeEvaluation({
      id: `${program.id}:geography_scope`,
      name: "Available geography",
      factKey: "municipality",
      description: `Project must be located in ${program.geography.municipalityNames.join(", ") || program.geography.municipalityIds.join(", ")}.`,
      expected: [...program.geography.municipalityIds, ...program.geography.municipalityNames],
      actual: profile.municipality,
      citation: sourceCitation,
    }));
  }
  const blocked = lifecycleBlocks(program, now);
  // Scope matching discovers a program; it cannot substitute for missing
  // substantive eligibility rules. Do not ask applicants to fill a KB gap.
  const needsCriteriaReview = !program.criteria.some(criterion =>
    criterion.required && criterion.material && !["industry", "municipality"].includes(criterion.factKey)
  );
  const classified = classificationFor(evaluations, blocked);
  const eligibility = needsCriteriaReview && classified === "likely_eligible" ? "potentially_eligible" : classified;
  const satisfied = evaluations.filter((item) => item.status === "satisfied");
  const failed = evaluations.filter((item) => item.status === "not_satisfied");
  const missing = evaluations.filter((item) => item.status === "missing" || item.status === "not_evaluable");
  const why = blocked || (needsCriteriaReview && eligibility !== "not_eligible"
    ? `${program.name} needs review: substantive eligibility criteria are missing from the knowledge base. Industry or geography alone cannot establish eligibility.`
    : whySurfaced(program, evaluations, eligibility));

  return {
    programId: program.id,
    programName: program.name,
    programType: program.programType,
    eligibility,
    isGuaranteed: program.automaticEligibility && eligibility === "likely_eligible" && evaluations.every((item) => item.status === "satisfied"),
    administeringAgency: program.administeringAgency,
    shortDescription: program.description,
    potentialBenefit: program.benefits,
    relevantGeography: program.geography,
    applicableIndustries: program.applicableIndustries,
    eligibilityCriteria: evaluations,
    criteriaSatisfied: satisfied,
    criteriaNotSatisfied: failed,
    missingInformation: missing,
    requiredSupportingEvidence: program.evidence,
    applicationProcess: program.applicationProcess,
    applicationAgency: program.applicationAgency,
    applicationWindow: program.applicationWindow,
    sources: program.sources,
    sourceEffectiveDate: program.sources.map((source) => source.effectiveDate).find(Boolean) ?? program.effectiveFrom,
    lastVerifiedAt: program.lastVerifiedAt,
    sourceVersion: program.sourceVersion,
    confidenceScore: needsCriteriaReview ? 0 : confidenceFor(evaluations, eligibility),
    whySurfaced: why,
    explanation: `${why} This is an eligibility screen, not an award or approval decision.`,
    lifecycleStatus: program.status,
    compatibleWith: program.compatibleWith,
    conflictsWith: program.conflictsWith,
    prerequisiteFor: program.prerequisiteFor,
  };
}

function buildFollowUps(results: IncentiveEligibilityResult[], programs: IncentiveProgram[]): IncentiveFollowUpQuestion[] {
  const criterionById = new Map(programs.flatMap((program) => program.criteria).map((criterion) => [criterion.id, criterion]));
  const byFact = new Map<string, IncentiveFollowUpQuestion>();
  for (const result of results) {
    if (result.eligibility !== "potentially_eligible") continue;
    for (const missing of result.missingInformation) {
      const criterion = criterionById.get(missing.criterionId);
      if (!criterion?.material || !criterion.question || !criterion.answerType) continue;
      // Ownership characteristics are used only when the user volunteered them;
      // SmartPR does not prompt for protected or sensitive status.
      if (criterion.voluntary || OWNERSHIP_FACTS.has(criterion.factKey)) continue;
      const existing = byFact.get(criterion.factKey);
      if (existing) {
        if (!existing.programIds.includes(result.programId)) existing.programIds.push(result.programId);
        continue;
      }
      byFact.set(criterion.factKey, {
        criterionId: criterion.id,
        programIds: [result.programId],
        factKey: criterion.factKey,
        question: criterion.question,
        answerType: criterion.answerType,
        answerOptions: criterion.answerOptions ?? [],
        reason: `This answer could materially change eligibility for ${result.programName}.`,
      });
    }
  }
  return [...byFact.values()].slice(0, 5);
}

export function evaluateIncentives(
  profile: NormalizedProjectProfile,
  programs: IncentiveProgram[],
  options: { now?: Date; catalogVersion?: string; verifiedEvidenceTypeIds?: string[] } = {}
): IncentiveAssessment {
  const now = options.now ?? new Date();
  const verifiedEvidenceTypeIds = new Set(options.verifiedEvidenceTypeIds ?? []);
  const results = programs
    .map((program) => resultFor(program, profile, now, verifiedEvidenceTypeIds))
    .sort((a, b) => b.confidenceScore - a.confidenceScore || a.programName.localeCompare(b.programName));
  const opportunities = results.filter((result) => result.eligibility === "likely_eligible" || result.eligibility === "potentially_eligible");
  const excluded = results.filter((result) => !opportunities.includes(result));
  const counts: IncentiveAssessment["counts"] = {
    likely_eligible: 0,
    potentially_eligible: 0,
    unlikely_eligible: 0,
    not_eligible: 0,
  };
  for (const result of results) counts[result.eligibility] += 1;
  return {
    evaluatedAt: now.toISOString(),
    catalogVersion: options.catalogVersion ?? "unversioned",
    publishedProgramCount: programs.length,
    results,
    opportunities,
    excluded,
    followUpQuestions: buildFollowUps(opportunities, programs),
    counts,
    notice: programs.length === 0
      ? "No validated incentive programs are published in the live knowledge graph yet. SmartPR will not invent opportunities from unreviewed sources."
      : undefined,
  };
}
