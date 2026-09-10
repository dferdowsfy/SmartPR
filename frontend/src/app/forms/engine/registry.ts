// ============================================================================
// Form registry (Part 11).
//
// The registry is the gate between the rules engine and the renderer. A form is
// only shown when ALL of these hold:
//   1. the rules engine returned the associated requirement,
//   2. the registry has a matching, display-enabled entry,
//   3. the schema's applicability conditions match the canonical entity type,
//   4. the schema verification status allows display,
//   5. displayForm is true.
//
// Disabled placeholders for not-yet-sourced documents keep the catalog honest:
// they advertise that a form is planned without ever rendering an unverified UI.
// ============================================================================

import { CORPREG01 } from "../definitions/pr/department-of-state/CORPREG01.ts";
import { CORPREG02 } from "../definitions/pr/department-of-state/CORPREG02.ts";
import { CORPREG03 } from "../definitions/pr/department-of-state/CORPREG03.ts";
import { CORPREG04 } from "../definitions/pr/department-of-state/CORPREG04.ts";
import { CORPREG05 } from "../definitions/pr/department-of-state/CORPREG05.ts";
import { CORPREG06 } from "../definitions/pr/department-of-state/CORPREG06.ts";
import { CORPLLC02 } from "../definitions/pr/department-of-state/CORPLLC02.ts";
import { SS4 } from "../definitions/federal/irs/SS4.ts";
import { NC001 } from "../definitions/pr/department-of-state/NC001.ts";
import { LUMAINT01 } from "../definitions/pr/luma/LUMAINT01.ts";
import { PA02 } from "../definitions/pr/municipal/PA02.ts";
import type { DigitalFormDefinition, FormVerificationStatus } from "./types.ts";

export interface RegistryEntry {
  id: string;
  officialFormNumber: string;
  requirementId: string;
  variantKey: string;
  verificationStatus: FormVerificationStatus;
  displayForm: boolean;
  sourceDocument: string;
  submissionMethod: DigitalFormDefinition["submissionMethod"];
  officialEvidenceStillRequired: boolean;
  /** Present only for entries backed by a real schema. */
  definition?: DigitalFormDefinition;
}

const DEFINITIONS: DigitalFormDefinition[] = [
  CORPREG01,
  CORPREG02,
  CORPREG03,
  CORPREG04,
  CORPREG05,
  CORPREG06,
  CORPLLC02,
  SS4,
  NC001,
  LUMAINT01,
  PA02,
];

function entryFromDefinition(def: DigitalFormDefinition): RegistryEntry {
  const displayable: FormVerificationStatus[] = [
    "extracted_from_official_pdf",
    "verified_against_live_portal",
    "published",
  ];
  return {
    id: def.id,
    officialFormNumber: def.officialFormNumber,
    requirementId: def.requirementId,
    variantKey: def.variantKey,
    verificationStatus: def.verificationStatus,
    displayForm: displayable.includes(def.verificationStatus),
    sourceDocument: def.sourceDocument,
    submissionMethod: def.submissionMethod,
    officialEvidenceStillRequired: def.officialEvidenceStillRequired,
    definition: def,
  };
}

/**
 * Disabled placeholders (Part 11). These have no verified schema yet and MUST
 * NOT render a form.
 *
 * DOC_ARTICLES_ORGANIZATION used to sit here as needs_source. Its official
 * source (34-CORPLLC02.pdf) has since been added, so it is now served by the
 * real CORPLLC02 schema above — still deliberately NOT by CORPREG06, which is
 * an LLP registration.
 *
 * FORM_PR_DOS_DBA is no longer a placeholder either: the official PR
 * Department of State NC001 PDF is in RealForms with a human-reviewed overlay
 * mapping, so it is served by the real NC001 schema above.
 */
const PLACEHOLDER_ENTRIES: RegistryEntry[] = [
  ph("FORM_PR_MERCHANT_REGISTRATION", "DOC_MERCHANT_REGISTRATION", "merchant", "Merchant Registration"),
  ph("FORM_PR_PERMISO_UNICO", "DOC_PERMISO_UNICO", "permiso_unico", "Permiso Único"),
  // FORM_PR_PATENTE_MUNICIPAL is no longer a placeholder: the official OCAM
  // PA02 PDF is in RealForms with a human-reviewed mapping, so it is served by
  // the real PA02 schema above.
  ph("FORM_PR_HEALTH_PERMIT", "DOC_HEALTH_PERMIT", "health", "Health Permit"),
  ph("FORM_PR_ALCOHOL_LICENSE", "DOC_ALCOHOL_LICENSE", "alcohol", "Alcohol License"),
  ph("FORM_PR_TOURISM_REGISTRATION", "DOC_TOURISM_REGISTRATION", "tourism", "Tourism Registration"),
  ph("FORM_PR_SIGN_PERMIT", "DOC_SIGN_PERMIT", "sign", "Sign Permit"),
  ph("FORM_PR_OUTDOOR_SEATING", "DOC_OUTDOOR_SEATING_AUTH", "outdoor_seating", "Outdoor Seating Authorization"),
  ph("FORM_PR_ENTERTAINMENT_PERMIT", "DOC_ENTERTAINMENT_PERMIT", "entertainment", "Entertainment Permit"),
  ph("FORM_PR_HOME_DECLARATION", "DOC_HOME_DECLARATION", "home_business", "Home Business Declaration"),
  ph("FORM_PR_TRANSPORT_PERMIT", "DOC_TRANSPORT_PERMIT", "transport", "Transportation Permit"),
  ph("FORM_PR_CHILDCARE_LICENSE", "DOC_CHILDCARE_LICENSE", "childcare", "Childcare License"),
  ph("FORM_PR_PESTICIDE_LICENSE", "DOC_PESTICIDE_LICENSE", "pesticide", "Pesticide Applicator License"),
  ph("FORM_PR_AGRICULTURE_REGISTRATION", "DOC_AGRICULTURE_REGISTRATION", "agriculture", "Agriculture Registration"),
  ph("FORM_PR_NOISE_VARIANCE", "DOC_NOISE_VARIANCE", "noise", "Noise Variance"),
  ph("FORM_PR_SAN_JUAN_USE_PERMIT", "DOC_SAN_JUAN_USE_PERMIT", "san_juan_use", "San Juan Municipal Use Permit"),
];

function ph(id: string, requirementId: string, variantKey: string, sourceDocument: string): RegistryEntry {
  return {
    id,
    officialFormNumber: "",
    requirementId,
    variantKey,
    verificationStatus: "needs_source",
    displayForm: false,
    sourceDocument,
    submissionMethod: "external_portal",
    officialEvidenceStillRequired: true,
  };
}

export const FORM_REGISTRY: RegistryEntry[] = [
  ...DEFINITIONS.map(entryFromDefinition),
  ...PLACEHOLDER_ENTRIES,
];

export const DEFINITIONS_BY_ID: Record<string, DigitalFormDefinition> = Object.fromEntries(
  DEFINITIONS.map((d) => [d.id, d])
);

export function getDefinition(formId: string): DigitalFormDefinition | undefined {
  return DEFINITIONS_BY_ID[formId];
}

export function getRegistryEntry(formId: string): RegistryEntry | undefined {
  return FORM_REGISTRY.find((e) => e.id === formId);
}

export function displayableEntriesForRequirement(requirementId: string): RegistryEntry[] {
  return FORM_REGISTRY.filter((e) => e.requirementId === requirementId && e.displayForm);
}
