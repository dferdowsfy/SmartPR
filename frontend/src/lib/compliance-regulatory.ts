/**
 * Regulatory developments pipeline for the monthly compliance digest
 * (spec section 10a).
 *
 * Pure functions only — no network, no next/headers imports — so the
 * matching, labeling, and prioritization logic is unit-testable and the
 * email builder can reuse it.
 *
 * Design notes:
 * - A development reaches a digest ONLY when it matches a specific
 *   business's profile or obligations with an explainable basis. A
 *   development with no targeting criteria specified never matches
 *   anything: no generic Puerto Rico news, ever.
 * - Matching mirrors the enterprise regulatory-events pattern: AND
 *   across specified tag groups, OR within a group, plus direct
 *   requirement-code matching against the business's obligations.
 * - Confidence rubric: high = primary government source (law, regulation,
 *   agency announcement) directly verified; medium = consistent with a
 *   primary source but with ambiguity (date, scope); low = single
 *   secondary source, not yet verified against a primary source.
 * - Nothing here invents dates, changes, or applicability. Every input
 *   fact comes from the DB row or the knowledge graph.
 */

export type DevelopmentConfidence = "high" | "medium" | "low";
export type ApplicabilityLabel = "confirmed" | "likely" | "conditional";

export interface RegulatoryDevelopment {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  publishedDate: string | null;
  effectiveDate: string | null;
  affectedRequirementCodes: string[];
  agencyNames: string[];
  municipalities: string[];
  businessTypes: string[];
  industries: string[];
  requirementNames: string[];
  applicabilityNotes: string | null;
  recommendedAction: string | null;
  confidence: DevelopmentConfidence;
}

/** Minimal business profile used for development matching. */
export interface DigestBusinessProfile {
  businessId: string;
  businessName: string;
  businessType: string | null;
  industry: string | null;
  municipality: string | null;
  businessStructure: string | null;
}

/** Minimal obligation view used for development matching. */
export interface DigestObligationProfile {
  obligationId: string;
  obligationName: string;
  requirementId: string | null;
  agency: string | null;
  businessId: string;
}

export function normalizeTag(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

export interface DevelopmentMatch {
  matched: boolean;
  /** Human-readable explanation — becomes "why it affects this business". */
  basis: string;
  /** True when the match came from a direct requirement-code hit. */
  viaRequirementCode: boolean;
}

/**
 * Decide whether a development applies to a business.
 *
 * Rules:
 *  1. Direct requirement-code hit: any of the business's obligations has a
 *     requirement_id in affected_requirement_codes → match.
 *  2. Otherwise every SPECIFIED tag group must match (AND across groups,
 *     OR within a group). Tag groups: agency_names (vs the business's
 *     obligation agencies), municipalities, business_types, industries,
 *     requirement_names (vs the business's obligation names).
 *  3. A development with no targeting criteria at all never matches.
 */
export function matchDevelopmentToBusiness(
  dev: RegulatoryDevelopment,
  business: DigestBusinessProfile,
  obligations: DigestObligationProfile[]
): DevelopmentMatch {
  const mine = obligations.filter((o) => o.businessId === business.businessId);

  if (dev.affectedRequirementCodes.length > 0) {
    const codes = new Set(dev.affectedRequirementCodes.map(normalizeTag));
    const hit = mine.find((o) => o.requirementId && codes.has(normalizeTag(o.requirementId)));
    if (hit) {
      return {
        matched: true,
        basis: `Affects your requirement "${hit.obligationName}"`,
        viaRequirementCode: true,
      };
    }
    // Requirement codes were specified but none of this business's
    // obligations carry them → fall through to tag matching only if tags
    // are also specified; codes alone are not enough to claim a match.
  }

  const parts: string[] = [];
  let specified = 0;

  const group = (values: string[], candidateValue: string, label: string): boolean => {
    if (!values || values.length === 0) return true;
    specified += 1;
    const hit = values.find((t) => normalizeTag(t) === normalizeTag(candidateValue));
    if (!hit) return false;
    parts.push(`${label} matches "${candidateValue.trim()}"`);
    return true;
  };

  if (!group(dev.municipalities, business.municipality ?? "", "municipality")) return { matched: false, basis: "", viaRequirementCode: false };
  if (!group(dev.businessTypes, business.businessType ?? "", "business type")) return { matched: false, basis: "", viaRequirementCode: false };
  if (!group(dev.industries, business.industry ?? "", "industry")) return { matched: false, basis: "", viaRequirementCode: false };

  // Agency / requirement-name groups match against the business's obligations.
  if (dev.agencyNames.length > 0) {
    specified += 1;
    const agencies = new Set(dev.agencyNames.map(normalizeTag));
    const hit = mine.find((o) => o.agency && agencies.has(normalizeTag(o.agency)));
    if (!hit) return { matched: false, basis: "", viaRequirementCode: false };
    parts.push(`agency matches "${(hit.agency ?? "").trim()}" (${hit.obligationName})`);
  }
  if (dev.requirementNames.length > 0) {
    specified += 1;
    const names = new Set(dev.requirementNames.map(normalizeTag));
    const hit = mine.find((o) => names.has(normalizeTag(o.obligationName)));
    if (!hit) return { matched: false, basis: "", viaRequirementCode: false };
    parts.push(`requirement matches "${hit.obligationName}"`);
  }

  if (specified === 0) return { matched: false, basis: "", viaRequirementCode: false };
  return { matched: true, basis: parts.join("; "), viaRequirementCode: false };
}

/**
 * Applicability label for a WHAT CHANGED finding. Explainable and honest:
 * a direct hit on one of the business's own requirements with a
 * high-confidence, verified source is Confirmed; a profile-tag match is
 * Likely (verify); low confidence is always Conditional.
 */
export function developmentApplicability(
  dev: RegulatoryDevelopment,
  match: DevelopmentMatch
): ApplicabilityLabel {
  if (dev.confidence === "low") return "conditional";
  if (match.viaRequirementCode && dev.confidence === "high") return "confirmed";
  return "likely";
}

export interface ObligationApplicabilityInput {
  status: string;
  mandatory: boolean;
  sourceReference: string | null;
}

/**
 * Applicability label for a digest obligation:
 * - UNKNOWN status or no traceable source → Likely — verify.
 * - Non-mandatory (may apply depending on circumstances) → Conditional.
 * - Otherwise the graph determined it applicable → Confirmed.
 */
export function obligationApplicability(o: ObligationApplicabilityInput): ApplicabilityLabel {
  if (o.status === "UNKNOWN" || !o.sourceReference) return "likely";
  if (!o.mandatory) return "conditional";
  return "confirmed";
}

// ---------------------------------------------------------------------------
// Validated knowledge-graph guidance for digest items.
// Only "validated" concepts are used; anything else falls back to the
// obligation's own fields and honest generic copy (never invented specifics).
// ---------------------------------------------------------------------------

import type { GuidanceConcept } from "../app/guidance/model";
import { PR_REQUIREMENT_GUIDANCE } from "../app/guidance/pr";

export function guidanceForRequirement(requirementId: string | null): GuidanceConcept | null {
  if (!requirementId) return null;
  const c = PR_REQUIREMENT_GUIDANCE[requirementId];
  if (!c || c.validationStatus !== "validated") return null;
  return c;
}

// ---------------------------------------------------------------------------
// Prioritization: deadline proximity first, then stalled (longest idle),
// then mandatory before optional. Documented because shutdown risk and
// penalty amounts are not in the data model — the ordering below is the
// honest, computable proxy.
// ---------------------------------------------------------------------------

export interface PrioritizableAction {
  overdue: boolean;
  daysRemaining: number | null;
  daysStalled: number | null;
  mandatory: boolean;
}

/** Lower = higher priority. Pure, so the ordering is testable. */
export function actionPriorityScore(a: PrioritizableAction): number {
  // Overdue items dominate, most overdue first.
  if (a.overdue) return -100000 + (a.daysRemaining ?? 0);
  // Dated items: sooner first.
  if (a.daysRemaining !== null) return a.daysRemaining * 10 + (a.mandatory ? 0 : 5);
  // Stalled items: longest idle first, after dated items.
  if (a.daysStalled !== null) return 100000 - a.daysStalled;
  return 200000;
}

export function sortByPriority<T extends PrioritizableAction>(items: T[]): T[] {
  return [...items].sort((a, b) => actionPriorityScore(a) - actionPriorityScore(b));
}

// ---------------------------------------------------------------------------
// Monthly regulatory-scan procedure (spec section 10a).
// The scan itself is a scheduled research pass (human/agent). This module
// documents the procedure in code so the scan runner, the digest, and the
// tests all share one source of truth.
// ---------------------------------------------------------------------------

export interface ScanSource {
  agency: string;
  urls: string[];
  check: string;
}

export const REGULATORY_SCAN_SOURCES: ScanSource[] = [
  {
    agency: "OGPe (Oficina de Gerencia de Permisos)",
    urls: ["https://www.ogpe.pr.gov"],
    check: "Permiso Único rules, Reglamento Conjunto amendments, filing procedures and fees",
  },
  {
    agency: "Departamento de Hacienda / SURI",
    urls: ["https://hacienda.pr.gov", "https://suri.hacienda.pr.gov"],
    check: "IVU, merchant registration, employer filings, forms, deadlines, cartas circulares",
  },
  {
    agency: "Departamento de Estado",
    urls: ["https://www.estado.pr.gov"],
    check: "Corporate annual reports/fees (Law 164-2009 / Law 65-2025), entity filing changes",
  },
  {
    agency: "DRNA",
    urls: ["https://www.drna.pr.gov"],
    check: "Environmental permits, waste/tire/oil handling rules, NPDES, reporting",
  },
  {
    agency: "Negociado de Bomberos",
    urls: ["https://www.dsp.pr.gov"],
    check: "Fire certification rules, inspection requirements",
  },
  {
    agency: "Departamento de Salud",
    urls: ["https://www.salud.pr.gov"],
    check: "Licencia sanitaria rules and renewals",
  },
  {
    agency: "Departamento del Trabajo (DTRH)",
    urls: ["https://www.trabajo.pr.gov"],
    check: "Employer registration, labor filings",
  },
  {
    agency: "CFSE (Fondo del Seguro del Estado)",
    urls: ["https://www.fondopr.com"],
    check: "Workers' compensation premiums, filing changes",
  },
  {
    agency: "Compañía de Turismo (CTPR)",
    urls: ["https://www.discoverpuertorico.com"],
    check: "Tourism registration/licensing changes",
  },
  {
    agency: "OGP (Oficina de Gerencia y Presupuesto)",
    urls: ["https://www.ogp.pr.gov"],
    check: "New leyes, reglamentos, cartas circulares affecting business compliance",
  },
  {
    agency: "Municipalities",
    urls: ["https://www.municipiodeyabucoa.com"],
    check: "Patente municipal ordinances, municipal filing changes (per business municipality)",
  },
];

export const CONFIDENCE_RUBRIC: Record<DevelopmentConfidence, string> = {
  high: "Verified against a primary government source (law, regulation, or agency announcement) that directly states the change.",
  medium: "Consistent with a primary source, but with ambiguity (effective date, scope, or applicability). Verify before acting.",
  low: "Single secondary source, not yet verified against a primary source. Treat as a lead, not a fact.",
};

export const SCAN_PROCEDURE_STEPS: string[] = [
  "For each source in REGULATORY_SCAN_SOURCES, check for announcements, rule changes, new forms/fees, and deadline changes since the previous scan.",
  "News/media may tip off a development, but every material finding MUST be verified against an authoritative (primary government) source before recording.",
  "Record each verified finding in regulatory_developments with: title, summary, source name + URL, published/effective dates, affected requirement codes (DOC_ codes when known), targeting tags (agencies, municipalities, business types, industries), applicability notes, recommended action, and confidence per the rubric.",
  "New findings enter with review_status='unreviewed'. A human reviewer promotes to 'verified' (or 'superseded'). Only 'verified' findings reach the digest.",
  "Never invent effective dates, fees, or applicability. Leave the field empty when unknown.",
];

export type DigestLang = "en" | "es";

const LABEL_COPY: Record<ApplicabilityLabel, { en: string; es: string }> = {
  confirmed: { en: "Confirmed", es: "Confirmado" },
  likely: { en: "Likely — verify", es: "Probable — verifica" },
  conditional: { en: "Conditional", es: "Condicional" },
};

export function applicabilityLabelCopy(label: ApplicabilityLabel, lang: DigestLang): string {
  return LABEL_COPY[label][lang];
}

const CONFIDENCE_COPY: Record<DevelopmentConfidence, { en: string; es: string }> = {
  high: { en: "High confidence", es: "Confianza alta" },
  medium: { en: "Medium confidence", es: "Confianza media" },
  low: { en: "Low confidence", es: "Confianza baja" },
};

export function confidenceCopy(c: DevelopmentConfidence, lang: DigestLang): string {
  return CONFIDENCE_COPY[c][lang];
}
