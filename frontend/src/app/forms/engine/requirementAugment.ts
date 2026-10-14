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
  /** Other document ids that refer to the same filing — their presence
   *  suppresses this augment (the engine may emit the alias instead). */
  aliases?: string[];
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
    // RULE_0651 (validated review 2026-09-16) fires DOC_CERT_ORGANIZATION,
    // the same LLC certificate — one present means no augment (live QA
    // 2026-09-18 21:00 / 2026-09-19 00:00: duplicate formation cards).
    aliases: ["DOC_CERT_ORGANIZATION"],
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
    // An alias present in the engine output suppresses the augment — the
    // same filing must never render as two cards.
    if (aug.aliases?.some((alias) => presentDocs.has(alias))) continue;
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
  return consolidateUndecidedFormation(
    canonical.business.entityType,
    exclusiveFormationRequirements(canonical, [...withoutWrongFormation, ...augments])
  );
}

/** The single formation step shown while the entity type is still open. */
export const ENTITY_REGISTRATION_DOC = "DOC_BUSINESS_ENTITY_REGISTRATION";
export const ENTITY_REGISTRATION_NAME =
  "Business Entity Registration (Certificate of Organization for LLC or Certificate of Incorporation for Corp.)";
const CORP_FORMATION_DOC = "DOC_CERT_INCORPORATION";
const LLC_FORMATION_IDS = new Set(["DOC_CERT_ORGANIZATION", "DOC_ARTICLES_ORGANIZATION"]);

/**
 * Entity type not chosen yet ("Not sure yet", or never answered): the engine
 * cannot tell an LLC from a corporation, so it emits both formation
 * certificates — two conflicting cards. Show one consolidated step instead,
 * keeping the first certificate's position and applicability. Once the user
 * picks LLC or corporation, exclusivity above leaves the right certificate.
 */
export function consolidateUndecidedFormation<T extends MinimalRequirement>(
  entityType: string | null | undefined,
  rows: T[]
): T[] {
  const type = entityType || "other";
  if (type !== "other") return rows;
  const corp = rows.findIndex((r) => r.document_id === CORP_FORMATION_DOC);
  const llc = rows.findIndex((r) => LLC_FORMATION_IDS.has(r.document_id ?? ""));
  if (corp === -1 || llc === -1) return rows;
  const first = Math.min(corp, llc);
  const merged = {
    ...rows[first],
    document_id: ENTITY_REGISTRATION_DOC,
    code: "business_entity_registration",
    name: ENTITY_REGISTRATION_NAME,
    agency: "Department of State",
    reason:
      "Your business entity type is not chosen yet. An LLC files a Certificate of Organization and a corporation files a Certificate of Incorporation with the Department of State; a sole proprietorship files neither. Choose the structure to see the exact filing.",
  } as T;
  return rows
    .map((r, i) => (i === first ? merged : r))
    .filter((r, i) => i === first || !(r.document_id === CORP_FORMATION_DOC || LLC_FORMATION_IDS.has(r.document_id ?? "")));
}
