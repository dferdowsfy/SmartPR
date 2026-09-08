// ============================================================================
// Which government artifacts apply to this business?
//
// The regulatory graph (rulesEngine + the requirement knowledge base) decides
// which REQUIREMENTS exist. This module decides which ARTIFACT satisfies each
// applicable requirement for this particular profile — and reports honestly
// when SmartPR has no artifact to offer.
//
// Nothing here fabricates coverage: a requirement whose artifact is missing is
// returned with availability "form_pending_source" (statewide/federal) or
// "municipal_requirements_only" (municipal), never as a fillable official form.
// ============================================================================

import { getTemplate, isOfficialArtifact } from "./catalog.ts";
import { resolveMunicipalImplementation } from "./municipalities.ts";
import type { CanonicalApplicationData, EntityType } from "../engine/types.ts";
import type { ArtifactScope, ArtifactType, TemplateDescriptor } from "./types.ts";

export type ArtifactAvailability =
  | "official_form_available"
  | "development_template_only"
  | "form_pending_source"
  | "municipal_official_form"
  | "municipal_portal"
  | "municipal_requirements_only";

export interface ApplicableArtifact {
  requirementCode: string;
  title: string;
  agency: string;
  scope: ArtifactScope;
  municipality?: string;
  formCode?: string;
  artifactType?: ArtifactType;
  availability: ArtifactAvailability;
  /** Plain-language reason this artifact applies, for the "why" surface. */
  reason: string;
  /** Operator/user-facing caveats carried from the catalog and the adapter. */
  notes: string[];
  portalUrl?: string;
}

/** Corporate entity types that file a Certificate of Incorporation. */
const CORPORATION_TYPES: EntityType[] = [
  "stock_corporation",
  "close_corporation",
  "professional_corporation",
  "nonprofit_nonstock_corporation",
];

/**
 * Activities that make a Hacienda internal-revenue licence (SC 2309) plausible.
 * Food service is deliberately NOT in this list: a restaurant does not need
 * SC 2309 unless it also does one of these.
 */
export const HACIENDA_LICENSE_TRIGGERS: (keyof CanonicalApplicationData["activities"])[] = [
  "alcoholSales",
  "coinOperatedMachines",
  "fuelSales",
  "cigaretteSales",
  "weaponsSales",
  "preciousMetals",
  "publicShowPromoter",
];

export function haciendaLicenseTriggers(profile: CanonicalApplicationData): string[] {
  return HACIENDA_LICENSE_TRIGGERS.filter((key) => profile.activities[key] === true);
}

export interface ApplicabilityOptions {
  /**
   * "formation" (default) is a new business getting registered. Ongoing
   * compliance artifacts (extension requests, taxpayer maintenance) are never
   * bundled into formation just because SmartPR happens to hold the layout.
   */
  phase?: "formation" | "ongoing_compliance";
  /** Ongoing compliance: the filer is asking for a declaration extension. */
  requestingFilingExtension?: boolean;
  /** Ongoing compliance: the filer is updating their municipal taxpayer record. */
  updatingMunicipalTaxpayerRecord?: boolean;
  /** Set false when the business has no physical presence in a municipality. */
  hasPhysicalLocation?: boolean;
}

function templateNotes(template: TemplateDescriptor | undefined): string[] {
  return template?.usageNotes ? [...template.usageNotes] : [];
}

function statewideEntry(
  formCode: string,
  requirementCode: string,
  reason: string
): ApplicableArtifact {
  const template = getTemplate(formCode);
  if (!template) {
    return {
      requirementCode,
      title: formCode,
      agency: "Unknown agency",
      scope: "statewide",
      availability: "form_pending_source",
      reason,
      notes: [`No catalog entry for ${formCode}.`],
    };
  }
  const available = template.sourceStatus !== "pending_source" && isOfficialArtifact(template);
  return {
    requirementCode,
    title: template.title,
    agency: template.agency,
    scope: template.scope,
    formCode: template.formCode,
    artifactType: template.artifactType,
    availability: available ? "official_form_available" : "form_pending_source",
    reason,
    notes: templateNotes(template),
  };
}

/**
 * Resolve every government artifact that applies to the profile.
 * Order is stable: Department of State, IRS, municipality, Hacienda.
 */
export function resolveApplicableArtifacts(
  profile: CanonicalApplicationData,
  options: ApplicabilityOptions = {}
): ApplicableArtifact[] {
  const phase = options.phase ?? "formation";
  const out: ApplicableArtifact[] = [];
  const entityType = profile.business.entityType;
  const municipality = profile.addresses.municipality;
  const hasPhysicalLocation = options.hasPhysicalLocation ?? Boolean(municipality);

  if (phase === "formation") {
    // --- Puerto Rico Department of State ---------------------------------
    if (profile.business.formationStatus === "not_formed") {
      if (entityType === "limited_liability_company") {
        out.push(
          statewideEntry(
            "CORPLLC02",
            "DOC_ARTICLES_ORGANIZATION",
            "Entity type is a limited liability company, which organizes with a Certificate of Organization."
          )
        );
      } else if (CORPORATION_TYPES.includes(entityType)) {
        out.push(
          statewideEntry(
            "CORPREG01",
            "DOC_CERT_INCORPORATION",
            "Entity type is a corporation, which forms with a Certificate of Incorporation."
          )
        );
      }
    }

    // --- IRS ---------------------------------------------------------------
    const needsEin =
      !profile.business.ein &&
      (profile.business.einPending === true ||
        entityType !== "sole_proprietorship" ||
        (profile.operations.employeeCount ?? profile.business.employeeCount ?? 0) > 0);
    if (needsEin) {
      out.push(
        statewideEntry(
          "SS4",
          "DOC_EIN",
          "No EIN is recorded and the business structure or payroll plan requires a federal employer identification number."
        )
      );
    }
  }

  // --- Municipality --------------------------------------------------------
  if (phase === "formation" && hasPhysicalLocation) {
    // PA02 does NOT route through the municipality adapter. OCAM publishes it as
    // one standardized STATEWIDE intake form whose printed layout is identical
    // in every municipality — `Municipio` is a blank applicant field, not a
    // per-municipality variant (catalog.ts carries the provenance note). The
    // adapter exists for artifacts that genuinely differ by municipality, which
    // PA03/PA04 below still do.
    const patente = statewideEntry(
      "PA02",
      "DOC_PATENTE_MUNICIPAL",
      "The business will operate from a physical location in a Puerto Rico municipality."
    );
    // The FORM is statewide; the money and the counter are not. Say so.
    patente.municipality = municipality;
    patente.notes = [
      ...(patente.notes ?? []),
      "Patente rates, due dates and exemptions are set by each municipality's own ordinance — confirm the amount owed with the municipality's finance office.",
      "The completed PA02 is filed at the municipality's collections office; SmartPR produces the populated, signable PDF.",
    ];
    out.push(patente);
  }
  if (phase === "ongoing_compliance" && options.requestingFilingExtension) {
    out.push(municipalArtifact("DOC_PATENTE_DECLARATION_EXTENSION", "Municipal declaration extension request", municipality, "PA03",
      "An extension of the municipal volume-of-business declaration was requested."));
  }
  if (phase === "ongoing_compliance" && options.updatingMunicipalTaxpayerRecord) {
    out.push(municipalArtifact("DOC_MUNICIPAL_TAXPAYER_MAINTENANCE", "Municipal taxpayer record maintenance", municipality, "PA04",
      "A change to the municipal taxpayer/debtor record was requested."));
  }

  // --- Departamento de Hacienda -------------------------------------------
  const triggers = haciendaLicenseTriggers(profile);
  if (triggers.length > 0) {
    const entry = statewideEntry(
      "SC2309",
      "DOC_HACIENDA_LICENSE",
      `Activities that may require a Hacienda internal-revenue licence were reported: ${triggers.join(", ")}.`
    );
    out.push(entry);
  }

  return out;
}

/**
 * Municipal artifacts route through the municipality adapter. A genericized
 * template never becomes the answer: at best it tells SmartPR which municipal
 * information to collect.
 */
function municipalArtifact(
  requirementCode: string,
  title: string,
  municipality: string | undefined,
  genericTemplateCode: string,
  reason: string
): ApplicableArtifact {
  const implementation = resolveMunicipalImplementation(municipality, requirementCode);
  const genericTemplate = getTemplate(genericTemplateCode);
  const notes = templateNotes(genericTemplate);
  if (implementation.notes) notes.push(implementation.notes);

  if (implementation.kind === "official_form" && implementation.formCode) {
    const official = getTemplate(implementation.formCode);
    return {
      requirementCode,
      title: official?.title ?? title,
      agency: official?.agency ?? `Municipio de ${municipality ?? ""}`.trim(),
      scope: "municipality_specific",
      municipality,
      formCode: implementation.formCode,
      artifactType: official?.artifactType,
      availability: "municipal_official_form",
      reason,
      notes: templateNotes(official),
    };
  }

  if (implementation.kind === "portal") {
    return {
      requirementCode,
      title,
      agency: `Municipio de ${municipality ?? ""}`.trim(),
      scope: "municipality_specific",
      municipality,
      availability: "municipal_portal",
      reason,
      notes,
      portalUrl: implementation.portalUrl,
    };
  }

  return {
    requirementCode,
    title,
    agency: municipality ? `Municipio de ${municipality}` : "Municipal government",
    scope: "municipality_specific",
    municipality,
    // The generic layout is carried for field modelling only — the caller must
    // not present it as this municipality's form.
    formCode: genericTemplate ? genericTemplate.formCode : undefined,
    artifactType: genericTemplate?.artifactType,
    availability: "municipal_requirements_only",
    reason,
    notes,
  };
}

/** True when this artifact may be shown to a user as an official form. */
export function isPresentableAsOfficial(artifact: ApplicableArtifact): boolean {
  return artifact.availability === "official_form_available" || artifact.availability === "municipal_official_form";
}
