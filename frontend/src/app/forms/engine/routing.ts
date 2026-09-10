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
  // The municipal patente has TWO filings under one requirement id, split by
  // formation status — first match wins, so the annual row sits first:
  //   * a business ALREADY operating in Puerto Rico files the ANNUAL
  //     Declaración de Volumen de Negocios (PA01) for the contributive year;
  //   * a not-yet-formed business (or one formed outside PR opening its first
  //     PR operation) files the PROVISIONAL application (PA02).
  // DOC_PATENTE_MUNICIPAL as emitted by the rules engine means "this business
  // owes the municipal patente" in either phase, so the formationStatus gate
  // is the honest discriminator — the same pattern as the CORPREG03
  // foreign-registration row above.
  { requirementId: "DOC_PATENTE_MUNICIPAL", formationStatus: "formed_in_puerto_rico", formId: "FORM_PR_PATENTE_ANUAL" },
  { requirementId: "DOC_PATENTE_MUNICIPAL", formId: "FORM_PR_PATENTE_MUNICIPAL" },
  // The DACO urbanizador/constructor license application applies to any
  // contractor business type carrying the requirement — no entity-type gate.
  { requirementId: "DOC_CONTRACTOR_LICENSE", formId: "FORM_PR_DACO_URBANIZADOR_CONSTRUCTOR" },
  // The CBP customs bond (Form 301) is federal and applies to any business
  // carrying the requirement — import/export, freight forwarding, logistics,
  // wholesale distribution — regardless of entity type, so this row carries
  // no entityType gate. See the CBP301 definition for the eBond/ACE and OMB
  // caveats: the paper form is the legacy path, not the modern filing route.
  { requirementId: "DOC_CUSTOMS_BROKER_BOND", formId: "FORM_CBP_301" },
  // The Bona Fide Farmer (Corporaciones) application is the juridical-entity
  // variant of the agriculture registration: the eight corporation/partnership
  // entity types route here explicitly. These rows must stay ABOVE the
  // individuo rows, since first match wins.
  { requirementId: "DOC_AGRICULTURE_REGISTRATION", entityType: "stock_corporation", formId: "FORM_PR_AGRI_BONAFIDE_CORPORACION" },
  { requirementId: "DOC_AGRICULTURE_REGISTRATION", entityType: "nonprofit_nonstock_corporation", formId: "FORM_PR_AGRI_BONAFIDE_CORPORACION" },
  { requirementId: "DOC_AGRICULTURE_REGISTRATION", entityType: "close_corporation", formId: "FORM_PR_AGRI_BONAFIDE_CORPORACION" },
  { requirementId: "DOC_AGRICULTURE_REGISTRATION", entityType: "professional_corporation", formId: "FORM_PR_AGRI_BONAFIDE_CORPORACION" },
  { requirementId: "DOC_AGRICULTURE_REGISTRATION", entityType: "foreign_corporation", formId: "FORM_PR_AGRI_BONAFIDE_CORPORACION" },
  { requirementId: "DOC_AGRICULTURE_REGISTRATION", entityType: "limited_liability_company", formId: "FORM_PR_AGRI_BONAFIDE_CORPORACION" },
  { requirementId: "DOC_AGRICULTURE_REGISTRATION", entityType: "limited_liability_partnership", formId: "FORM_PR_AGRI_BONAFIDE_CORPORACION" },
  { requirementId: "DOC_AGRICULTURE_REGISTRATION", entityType: "partnership", formId: "FORM_PR_AGRI_BONAFIDE_CORPORACION" },
  // The Bona Fide Farmer (Individuos) application is the natural-person
  // variant of the agriculture registration: sole proprietors route here
  // explicitly, and the ungated row is the honest catch-all for entityType
  // "other"/unmatched — a natural-person fallback. The corporación
  // (juridical-entity) variant rows must be inserted ABOVE these rows, since
  // first match wins.
  { requirementId: "DOC_AGRICULTURE_REGISTRATION", entityType: "sole_proprietorship", formId: "FORM_PR_AGRI_BONAFIDE_INDIVIDUO" },
  { requirementId: "DOC_AGRICULTURE_REGISTRATION", formId: "FORM_PR_AGRI_BONAFIDE_INDIVIDUO" },
  // The NPDES industrial permit application is a TWO-FORM package under one
  // requirement id: EPA Form 3510-1 (General Information, the cover every
  // applicant files) plus EPA Form 3510-2C (the substantive application for
  // existing dischargers). Both rows match every entity type, so
  // resolveFormIds returns both in filing order; the requirement card renders
  // the package, never just one form. See selectEntriesForRequirement below.
  { requirementId: "DOC_NPDES_INDUSTRIAL", formId: "FORM_EPA_NPDES_FORM1" },
  { requirementId: "DOC_NPDES_INDUSTRIAL", formId: "FORM_EPA_NPDES_FORM2C" },
];

/**
 * Resolve the form id for a requirement given the canonical entity type.
 * Returns null when no verified form applies to that requirement.
 */
export function resolveFormId(requirementId: string, canonical: CanonicalApplicationData): string | null {
  const ids = resolveFormIds(requirementId, canonical);
  return ids.length > 0 ? ids[0] : null;
}

/**
 * Resolve EVERY form id a requirement carries, in routing-table order.
 * Single-form requirements return exactly one id (or none); the NPDES
 * industrial application is a two-form package and returns both. This is
 * the honest primitive — callers that only take the first element must say
 * so, and the requirement card renders the full package.
 */
export function resolveFormIds(requirementId: string, canonical: CanonicalApplicationData): string[] {
  const entityType = canonical.business.entityType;
  const formationStatus = canonical.business.formationStatus;
  const ids: string[] = [];
  for (const route of ROUTES) {
    if (route.requirementId !== requirementId) continue;
    if (route.entityType && route.entityType !== entityType) continue;
    if (route.formationStatus && route.formationStatus !== formationStatus) continue;
    if (!ids.includes(route.formId)) ids.push(route.formId);
  }
  return ids;
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
 * The same five-condition gate as selectFormForRequirement, but returning
 * every displayable entry for the requirement — the full package for
 * multi-form requirements (NPDES), a single entry otherwise. Entries come
 * back in routing-table order.
 */
export function selectEntriesForRequirement(
  requirementId: string,
  canonical: CanonicalApplicationData,
  requirementIdsPresent: Set<string>
): RegistryEntry[] {
  // (1) rules engine returned the requirement.
  if (!requirementIdsPresent.has(requirementId)) return [];

  const canonicalAsForm: FormData = {};
  const out: RegistryEntry[] = [];
  for (const formId of resolveFormIds(requirementId, canonical)) {
    // (2) registry has a matching entry, (5) displayForm true.
    const entry = FORM_REGISTRY.find((e) => e.id === formId);
    if (!entry || !entry.displayForm) continue;

    // (4) schema status allows display is already encoded in entry.displayForm.
    const def = getDefinition(formId);
    if (!def) continue;

    // (3) applicability conditions match the canonical entity type.
    if (!evaluateConditions(def.applicability, canonicalAsForm, canonical)) continue;

    out.push(entry);
  }
  return out;
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
