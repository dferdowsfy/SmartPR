export const INCENTIVE_PROGRAM_TYPES = [
  "incentive",
  "tax_incentive",
  "tax_credit",
  "tax_exemption",
  "grant",
  "reimbursement_program",
  "funding_program",
] as const;

export type IncentiveProgramType = (typeof INCENTIVE_PROGRAM_TYPES)[number];
export type IncentiveLifecycleStatus = "active" | "expired" | "suspended" | "proposed";
export type EligibilityStatus =
  | "likely_eligible"
  | "potentially_eligible"
  | "unlikely_eligible"
  | "not_eligible";

export type ProjectFactValue = string | number | boolean | string[] | null | undefined;

export interface NormalizedProjectProfile {
  business_type?: string | null;
  industry?: string | null;
  naics_code?: string | null;
  municipality?: string | null;
  physical_location?: string | boolean | null;
  business_stage?: "new" | "existing" | null;
  entity_type?: string | null;
  ownership_structure?: string | null;
  number_of_employees?: number | null;
  planned_job_creation?: number | null;
  annual_payroll?: number | null;
  average_wage?: number | null;
  expected_revenue?: number | null;
  capital_investment?: number | null;
  property_tenure?: "owned" | "leased" | "other" | null;
  export_activity?: boolean | null;
  outside_pr_revenue_percentage?: number | null;
  tourism_activity?: boolean | null;
  manufacturing_activity?: boolean | null;
  research_and_development_activity?: boolean | null;
  renewable_energy_investment?: number | boolean | null;
  construction_or_rehabilitation_activity?: boolean | null;
  agricultural_activity?: boolean | null;
  business_size?: string | null;
  veteran_owned?: boolean | null;
  minority_owned?: boolean | null;
  woman_owned?: boolean | null;
  opportunity_zone?: boolean | string | null;
  project_start_date?: string | null;
  [key: string]: ProjectFactValue;
}

export type EligibilityOperator =
  | "equals"
  | "not_equals"
  | "in"
  | "not_in"
  | "contains"
  | "gte"
  | "lte"
  | "gt"
  | "lt"
  | "truthy"
  | "falsy"
  | "exists"
  | "date_on_or_after"
  | "date_on_or_before";

export interface IncentiveCriterion {
  id: string;
  name: string;
  description: string;
  factKey: string;
  operator: EligibilityOperator;
  expectedValue?: ProjectFactValue;
  expectedValues?: string[];
  required: boolean;
  material: boolean;
  question?: string | null;
  answerType?: "boolean" | "number" | "text" | "date" | "single_select" | null;
  answerOptions?: string[];
  voluntary?: boolean;
  legallyRelevant?: boolean;
  evidenceTypeIds: string[];
  evidenceCanSatisfy?: boolean;
  citation: string;
}

export interface IncentiveBenefit {
  id: string;
  name: string;
  description: string;
  benefitType: string;
  amountDescription?: string | null;
  citation: string;
}

export interface IncentiveApplicationWindow {
  id: string;
  name: string;
  opensAt?: string | null;
  closesAt?: string | null;
  rolling: boolean;
  description: string;
  lastVerifiedAt: string;
  citation: string;
}

export interface IncentiveSource {
  id: string;
  name: string;
  sourceType: string;
  legalStatus: string;
  jurisdiction: string;
  citation: string;
  url: string;
  effectiveDate?: string | null;
  lastVerifiedAt: string;
  sourceVersion: string;
}

export interface IncentiveProgram {
  id: string;
  name: string;
  programType: IncentiveProgramType;
  administeringAgency: { id: string; name: string };
  applicationAgency?: { id: string; name: string } | null;
  description: string;
  benefits: IncentiveBenefit[];
  geography: { level: string; municipalityIds: string[]; municipalityNames: string[]; notes?: string | null };
  applicableIndustries: { ids: string[]; names: string[] };
  criteria: IncentiveCriterion[];
  evidence: { id: string; name: string }[];
  applicationProcess?: string | null;
  applicationWindow?: IncentiveApplicationWindow | null;
  sources: IncentiveSource[];
  status: IncentiveLifecycleStatus;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  lastVerifiedAt: string;
  sourceVersion: string;
  supersedes?: string | null;
  supersededBy?: string | null;
  compatibleWith: string[];
  conflictsWith: string[];
  prerequisiteFor: string[];
  automaticEligibility: boolean;
}

export interface CriterionEvaluation {
  criterionId: string;
  name: string;
  description: string;
  factKey: string;
  status: "satisfied" | "not_satisfied" | "missing" | "not_evaluable";
  actualValue?: ProjectFactValue;
  expectedValue?: ProjectFactValue | string[];
  required: boolean;
  material: boolean;
  /**
   * Scope/discovery evaluation (industry or geography match) vs a substantive
   * statutory criterion. Scope supports discovery and acts as a hard filter
   * (outside the published scope = not eligible), but scope alone can never
   * establish eligibility — see classificationFor (F06).
   */
  scope?: boolean;
  evidence: { id: string; name: string }[];
  citation: string;
  explanation: string;
}

export interface IncentiveEligibilityResult {
  programId: string;
  programName: string;
  programType: IncentiveProgramType;
  eligibility: EligibilityStatus;
  isGuaranteed: boolean;
  administeringAgency: { id: string; name: string };
  shortDescription: string;
  potentialBenefit: IncentiveBenefit[];
  relevantGeography: IncentiveProgram["geography"];
  applicableIndustries: IncentiveProgram["applicableIndustries"];
  eligibilityCriteria: CriterionEvaluation[];
  criteriaSatisfied: CriterionEvaluation[];
  criteriaNotSatisfied: CriterionEvaluation[];
  missingInformation: CriterionEvaluation[];
  requiredSupportingEvidence: { id: string; name: string }[];
  applicationProcess?: string | null;
  applicationAgency?: { id: string; name: string } | null;
  applicationWindow?: IncentiveApplicationWindow | null;
  sources: IncentiveSource[];
  sourceEffectiveDate?: string | null;
  lastVerifiedAt: string;
  sourceVersion: string;
  confidenceScore: number;
  whySurfaced: string;
  explanation: string;
  lifecycleStatus: IncentiveLifecycleStatus;
  compatibleWith: string[];
  conflictsWith: string[];
  prerequisiteFor: string[];
}

export interface IncentiveFollowUpQuestion {
  criterionId: string;
  programIds: string[];
  factKey: string;
  question: string;
  answerType: NonNullable<IncentiveCriterion["answerType"]>;
  answerOptions: string[];
  reason: string;
}

export interface IncentiveAssessment {
  evaluatedAt: string;
  catalogVersion: string;
  publishedProgramCount: number;
  results: IncentiveEligibilityResult[];
  opportunities: IncentiveEligibilityResult[];
  excluded: IncentiveEligibilityResult[];
  followUpQuestions: IncentiveFollowUpQuestion[];
  counts: Record<EligibilityStatus, number>;
  notice?: string;
}
