// ============================================================================
// Narrow requirement augmentation for entity-type-driven documents.
//
// The pure rules engine keys off municipality / business type / question
// answers and has no concept of entity TYPE. Formation certificates are
// mutually exclusive: an LLC receives Certificate of Organization and must
// not keep Certificate of Incorporation. Foreign-corporation authorization
// and LLP registration remain additive.
// ============================================================================

import { applyEntityFormationExclusivity } from "../../requirementApplicability";
import type { CanonicalApplicationData } from "./types.ts";

export interface MinimalRequirement {
  document_id?: string;
  code?: string;
  name?: string;
  agency?: string;
  category?: string;
  mandatory?: boolean;
  reason?: string;
}

interface AugmentDef {
  document_id: string;
  code: string;
  name: string;
  reason: string;
  applies: (c: CanonicalApplicationData) => boolean;
}

const AUGMENTS: AugmentDef[] = [
  {
    document_id: "DOC_CERT_INCORPORATION",
    code: "certificate_of_incorporation",
    name: "Certificate of Incorporation",
    reason: "Entity type is a Puerto Rico corporation, which forms by filing the applicable Certificate of Incorporation.",
    applies: (c) => CORPORATION_TYPES.has(c.business.entityType),
  },
  {
    document_id: "DOC_FOREIGN_CORPORATION_AUTHORIZATION",
    code: "foreign_corporation_authorization",
    name: "Certificate of Authorization to Do Business (Foreign Corporation)",
    reason: "Entity was formed outside Puerto Rico and must be authorized to do business here.",
    applies: (c) =>
      c.business.formationStatus === "formed_outside_puerto_rico" ||
      c.business.entityType === "foreign_corporation",
  },
  {
    document_id: "DOC_LLP_REGISTRATION",
    code: "llp_registration",
    name: "Limited Liability Partnership Registration",
    reason: "Entity type is a Limited Liability Partnership (SRL), which must register with the Department of State.",
    applies: (c) => c.business.entityType === "limited_liability_partnership",
  },
  {
    document_id: "DOC_ARTICLES_ORGANIZATION",
    code: "articles_of_organization",
    name: "Certificate of Organization (Limited Liability Company)",
    reason:
      "Entity type is a Limited Liability Company, which files a Certificate of Organization (CORPLLC02) rather than a Certificate of Incorporation.",
    applies: (c) => c.business.entityType === "limited_liability_company",
  },
];

const CORPORATION_TYPES = new Set([
  "stock_corporation",
  "close_corporation",
  "professional_corporation",
  "nonprofit_nonstock_corporation",
]);

/**
 * Return formation requirements implied by the canonical entity type.
 * LLC formation is mutually exclusive with Certificate of Incorporation:
 * callers must also drop DOC_CERT_INCORPORATION for an LLC (see
 * applyEntityFormationExclusivity). Foreign-corp and LLP remain additive.
 */
export function entityTypeRequirements<T extends MinimalRequirement>(
  canonical: CanonicalApplicationData,
  existing: T[],
  make: (def: { document_id: string; code: string; name: string; reason: string }) => T
): T[] {
  const presentDocs = new Set(existing.map((r) => r.document_id).filter(Boolean));
  const out: T[] = [];
  for (const aug of AUGMENTS) {
    if (presentDocs.has(aug.document_id)) continue;
    if (!aug.applies(canonical)) continue;
    out.push(make(aug));
  }
  return out;
}

/** Drop the formation certificate that does not belong to this entity type. */
export function exclusiveFormationRequirements<T extends MinimalRequirement>(
  canonical: CanonicalApplicationData,
  existing: T[]
): T[] {
  return applyEntityFormationExclusivity(existing, canonical.business.entityType);
}

export interface AugmentMake {
  document_id: string;
  code: string;
  name: string;
  reason: string;
}

/**
 * Shared formation normalization used by BOTH the intake UI and the server
 * obligation pipeline (F10): drop the formation certificate that does not
 * belong to this entity type, add the one the entity type implies, then
 * enforce exclusivity again so no path can resurrect the wrong certificate.
 * The caller shapes the added rows via `make` (UI Requirement vs server
 * obligation rows).
 */
export function normalizeEntityFormationRequirements<T extends MinimalRequirement>(
  entityType: string | null | undefined,
  existing: T[],
  make: (def: AugmentMake, entityType: string) => T
): T[] {
  const canonical = {
    business: { entityType: (entityType || "other") as CanonicalApplicationData["business"]["entityType"] },
  } as CanonicalApplicationData;
  const withoutWrongFormation = exclusiveFormationRequirements(canonical, existing);
  const augments = entityTypeRequirements(canonical, withoutWrongFormation, (def) =>
    make(def, canonical.business.entityType)
  );
  return exclusiveFormationRequirements(canonical, [...withoutWrongFormation, ...augments]);
}
