// ============================================================================
// Exact Department of State form routing (Part 4).
//
// Given (a) the requirement ids returned by the rules engine and (b) the
// canonical entity type / formation status, resolve the single applicable form
// variant. This never surfaces all six forms at once: a user sees one
// entity-formation variant, plus a foreign-registration form only when they
// genuinely have that separate requirement.
// ============================================================================

import { evaluateConditions } from "./formConditions.ts";
import { FORM_REGISTRY, getDefinition, type RegistryEntry } from "./registry.ts";
import type { CanonicalApplicationData, EntityType, FormData } from "./types.ts";

/**
 * Declarative routing table mirroring Part 4. Each row states the requirement
 * + entity type (and optional formation status) that select a form id. A row
 * with no entityType applies to every entity type.
 */
export interface RouteRule {
  requirementId: string;
  entityType?: EntityType;
  formationStatus?: CanonicalApplicationData["business"]["formationStatus"];
  formId: string;
}

export const ROUTES: RouteRule[] = [
  { requirementId: "DOC_CERT_INCORPORATION", entityType: "stock_corporation", formId: "FORM_PR_DOS_CORPREG01" },
  { requirementId: "DOC_CERT_INCORPORATION", entityType: "nonprofit_nonstock_corporation", formId: "FORM_PR_DOS_CORPREG02" },
  { requirementId: "DOC_CERT_INCORPORATION", entityType: "close_corporation", formId: "FORM_PR_DOS_CORPREG04" },
  { requirementId: "DOC_CERT_INCORPORATION", entityType: "professional_corporation", formId: "FORM_PR_DOS_CORPREG05" },
  { requirementId: "DOC_FOREIGN_CORPORATION_AUTHORIZATION", formationStatus: "formed_outside_puerto_rico", formId: "FORM_PR_DOS_CORPREG03" },
  { requirementId: "DOC_LLP_REGISTRATION", entityType: "limited_liability_partnership", formId: "FORM_PR_DOS_CORPREG06" },
  { requirementId: "DOC_ARTICLES_ORGANIZATION", entityType: "limited_liability_company", formId: "FORM_PR_DOS_CORPLLC02" },
  // The EIN application is federal and applies to every entity type, so this
  // row intentionally carries no entityType gate.
  { requirementId: "DOC_EIN", formId: "FORM_IRS_SS4" },
  // The LUMA customer-orientation attestation applies to any business adding
  // grid-connected solar, regardless of entity type — same no-gate pattern.
  { requirementId: "DOC_LUMA_INTERCONNECTION", formId: "FORM_PR_LUMA_INTERCONNECTION" },
];

/**
 * Resolve the form id for a requirement given the canonical entity type.
 * Returns null when no verified form applies to that requirement.
 */
export function resolveFormId(requirementId: string, canonical: CanonicalApplicationData): string | null {
  const entityType = canonical.business.entityType;
  const formationStatus = canonical.business.formationStatus;
  for (const route of ROUTES) {
    if (route.requirementId !== requirementId) continue;
    if (route.entityType && route.entityType !== entityType) continue;
    if (route.formationStatus && route.formationStatus !== formationStatus) continue;
    return route.formId;
  }
  return null;
}

/**
 * The full five-condition gate from Part 11 applied to a single requirement.
 * Returns the registry entry to display, or null.
 */
export function selectFormForRequirement(
  requirementId: string,
  canonical: CanonicalApplicationData,
  requirementIdsPresent: Set<string>
): RegistryEntry | null {
  // (1) rules engine returned the requirement.
  if (!requirementIdsPresent.has(requirementId)) return null;

  // Routing by canonical entity type → candidate form id.
  const formId = resolveFormId(requirementId, canonical);
  if (!formId) return null;

  // (2) registry has a matching entry, (5) displayForm true.
  const entry = FORM_REGISTRY.find((e) => e.id === formId);
  if (!entry || !entry.displayForm) return null;

  // (4) schema status allows display is already encoded in entry.displayForm.
  const def = getDefinition(formId);
  if (!def) return null;

  // (3) applicability conditions match the canonical entity type.
  const canonicalAsForm: FormData = {};
  if (!evaluateConditions(def.applicability, canonicalAsForm, canonical)) return null;

  return entry;
}

/**
 * For a set of requirement ids from the rules engine, return every displayable
 * form the user should see (typically one formation variant, optionally a
 * foreign-registration form).
 */
export function selectFormsForRequirements(
  requirementIds: string[],
  canonical: CanonicalApplicationData
): { requirementId: string; entry: RegistryEntry }[] {
  const present = new Set(requirementIds);
  const out: { requirementId: string; entry: RegistryEntry }[] = [];
  const seen = new Set<string>();
  for (const requirementId of requirementIds) {
    const entry = selectFormForRequirement(requirementId, canonical, present);
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      out.push({ requirementId, entry });
    }
  }
  return out;
}
