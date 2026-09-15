// ============================================================================
// Business Passport — enter-once entity facts that stamp every applicable
// government artifact, worksheet, checklist, and package deliverable.
//
// This is NOT a parallel profile system. It is the durable, business-scoped
// slice of `CanonicalApplicationData` (the same model Core Application Details
// and the artifact engine already use). Forms declare canonical field ids;
// population reads those ids from the passport-backed canonical object.
//
// Empty vs filled: `readCanonicalField` returns undefined for blank/missing
// values, so unanswered blanks stay unanswered — SmartPR never invents data.
// ============================================================================

import { formatAddressLine, readCanonicalField } from "../artifacts/canonicalFields.ts";
import {
  buildCanonicalFromIntake,
  INTAKE_FIELDS,
  type IntakeFieldSpec,
  type IntakeProfileInput,
} from "./intake.ts";
import {
  emptyCanonicalData,
  type CanonicalApplicationData,
  type EntityType,
  type FormationStatus,
} from "./types.ts";

/** Canonical field ids that constitute the Business Passport (source of truth). */
export const BUSINESS_PASSPORT_FIELDS = [
  // Identity
  "business.legal_name",
  "business.trade_name",
  "business.entity_type",
  "business.ein",
  "business.naics_code",
  "business.activity_description",
  "business.start_date",
  "business.incorporation_date",
  "business.email",
  "business.phone",
  "business.merchant_registration_number",
  "business.registry_number",
  // Officers / primary contact
  "owner.full_name",
  "owner.title",
  "owner.email",
  "owner.phone",
  "parties.resident_agent_name",
  "parties.resident_agent_physical_address",
  // Addresses
  "location.physical_address",
  "location.mailing_address",
  "location.municipality",
  "location.state",
  "location.postal_code",
  "location.mailing_postal_code",
  // Operations + property / lease pointers already in the graph model
  "operations.employee_count",
] as const;

export type BusinessPassportFieldId = (typeof BUSINESS_PASSPORT_FIELDS)[number];

/**
 * Intake fields that edit the passport. Extends core intake with NAICS,
 * formation date, and registry number so one surface covers the passport set.
 */
export const PASSPORT_INTAKE_FIELDS: IntakeFieldSpec[] = [
  ...INTAKE_FIELDS,
  {
    id: "incorporationDate",
    group: "business",
    canonicalKey: "business.incorporationDate",
    label: { en: "Formation / incorporation date", es: "Fecha de formación / incorporación" },
    type: "date",
    optional: true,
  },
  {
    id: "naicsCode",
    group: "business",
    canonicalKey: "business.naicsCode",
    label: { en: "NAICS code", es: "Código NAICS" },
    type: "text",
    optional: true,
  },
  {
    id: "registryNumber",
    group: "business",
    canonicalKey: "business.registryNumber",
    label: { en: "Department of State registry number", es: "Número de registro del Departamento de Estado" },
    type: "text",
    optional: true,
  },
  {
    id: "merchantRegistrationNumber",
    group: "business",
    canonicalKey: "business.merchantRegistrationNumber",
    label: { en: "Hacienda merchant registration number", es: "Número de Registro de Comerciante (Hacienda)" },
    type: "text",
    optional: true,
  },
];

/** Persistable passport payload (JSON column). Versioned canonical slice. */
export type BusinessPassportJson = Partial<CanonicalApplicationData> & {
  version?: number;
};

/** Denormalized business-row columns used for lists and legacy callers. */
export interface BusinessRowFacts {
  legal_name?: string | null;
  name?: string | null;
  entity_number?: string | null;
  business_structure?: string | null;
  municipality?: string | null;
  physical_address?: string | null;
  onboarding_mode?: "NEW" | "EXISTING" | null;
  passport_json?: BusinessPassportJson | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Deep-merge objects; `overlay` wins when its leaf is non-empty. */
export function mergePreferFilled<T extends Record<string, unknown>>(base: T, overlay: Partial<T> | null | undefined): T {
  if (!overlay) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, overlayValue] of Object.entries(overlay)) {
    if (overlayValue === undefined || overlayValue === null || overlayValue === "") continue;
    const baseValue = out[key];
    if (isPlainObject(overlayValue) && isPlainObject(baseValue)) {
      out[key] = mergePreferFilled(baseValue, overlayValue);
    } else if (Array.isArray(overlayValue)) {
      if (overlayValue.length > 0) out[key] = overlayValue;
    } else {
      out[key] = overlayValue;
    }
  }
  return out as T;
}

function legacyStructureFromEntityType(entityType: EntityType | undefined): string | undefined {
  switch (entityType) {
    case "stock_corporation":
    case "close_corporation":
      return "corporation";
    case "nonprofit_nonstock_corporation":
      return "nonprofit";
    case "professional_corporation":
      return "professional_corporation";
    case "foreign_corporation":
      return "foreign_corporation";
    case "limited_liability_partnership":
      return "llp";
    case "limited_liability_company":
      return "llc";
    case "sole_proprietorship":
      return "sole_proprietorship";
    case "partnership":
      return "partnership";
    default:
      return undefined;
  }
}

/** Build intake input from denormalized business columns (pre-passport fallback). */
export function intakeInputFromBusinessRow(row: BusinessRowFacts): IntakeProfileInput {
  const formationStatus: FormationStatus | undefined =
    row.onboarding_mode === "EXISTING" ? "formed_in_puerto_rico" : undefined;
  return {
    legalName: row.legal_name || row.name || undefined,
    business_structure: row.business_structure ?? undefined,
    municipality: row.municipality ?? undefined,
    formationStatus,
  };
}

/**
 * Resolve the canonical profile for a business: denormalized columns seed the
 * base, then `passport_json` overlays as the source of truth for filled facts.
 */
export function canonicalFromBusinessRow(row: BusinessRowFacts): CanonicalApplicationData {
  const base = buildCanonicalFromIntake(intakeInputFromBusinessRow(row));
  if (row.entity_number && !base.business.registryNumber) {
    base.business.registryNumber = row.entity_number;
  }
  const passport = (row.passport_json ?? {}) as BusinessPassportJson;
  const merged = mergePreferFilled(
    base as unknown as Record<string, unknown>,
    passport as unknown as Partial<Record<string, unknown>>
  ) as unknown as CanonicalApplicationData;
  // Guarantees required shape after partial JSON merges.
  return {
    ...emptyCanonicalData(),
    ...merged,
    business: { ...emptyCanonicalData().business, ...merged.business },
    contact: { ...emptyCanonicalData().contact, ...merged.contact },
    addresses: { ...emptyCanonicalData().addresses, ...merged.addresses },
    property: { ...emptyCanonicalData().property, ...merged.property },
    parties: {
      ...emptyCanonicalData().parties,
      ...merged.parties,
      incorporators: merged.parties?.incorporators ?? [],
      directors: merged.parties?.directors ?? [],
      officers: merged.parties?.officers ?? [],
      partners: merged.parties?.partners ?? [],
      authorizedSigners: merged.parties?.authorizedSigners ?? [],
    },
    filingPreferences: { ...emptyCanonicalData().filingPreferences, ...merged.filingPreferences },
    operations: { ...emptyCanonicalData().operations, ...merged.operations },
    activities: { ...emptyCanonicalData().activities, ...merged.activities },
    version: typeof merged.version === "number" ? merged.version : 1,
  };
}

/**
 * Population profile: passport-backed business facts win over request body
 * empties. Request may still supply one-off filing answers for gaps.
 */
export function resolvePopulationProfile(args: {
  business?: BusinessRowFacts | null;
  requestProfile?: Partial<CanonicalApplicationData> | null;
}): CanonicalApplicationData {
  const fromBusiness = args.business ? canonicalFromBusinessRow(args.business) : emptyCanonicalData();
  if (!args.requestProfile) return fromBusiness;
  // Request fills gaps only — passport/business remains authoritative when filled.
  return mergePreferFilled(
    mergePreferFilled(
      emptyCanonicalData() as unknown as Record<string, unknown>,
      args.requestProfile as unknown as Partial<Record<string, unknown>>
    ),
    fromBusiness as unknown as Partial<Record<string, unknown>>
  ) as unknown as CanonicalApplicationData;
}

/** Snapshot the passport slice from a full canonical object for persistence. */
export function passportJsonFromCanonical(canonical: CanonicalApplicationData): BusinessPassportJson {
  return {
    version: canonical.version,
    business: { ...canonical.business },
    contact: { ...canonical.contact },
    addresses: { ...canonical.addresses },
    property: { ...canonical.property },
    parties: {
      residentAgent: canonical.parties.residentAgent,
      incorporators: canonical.parties.incorporators,
      directors: canonical.parties.directors,
      officers: canonical.parties.officers,
      partners: canonical.parties.partners,
      authorizedSigners: canonical.parties.authorizedSigners,
    },
    operations: { ...canonical.operations },
    // Activities are requirement triggers, not core passport identity — keep
    // them so regenerated Hacienda/SC-2309 artifacts stay consistent.
    activities: { ...canonical.activities },
    filingPreferences: { ...canonical.filingPreferences },
  };
}

/** Keep list-view columns in sync when the passport is saved. */
export function denormalizedColumnsFromPassport(canonical: CanonicalApplicationData): {
  legal_name: string | null;
  entity_number: string | null;
  business_structure: string | null;
  municipality: string | null;
  physical_address: string | null;
} {
  const physical =
    formatAddressLine(canonical.addresses.operatingAddress ?? canonical.addresses.principalPhysical) || null;
  return {
    legal_name: canonical.business.legalName?.trim() || null,
    entity_number: canonical.business.registryNumber?.trim() || null,
    business_structure: legacyStructureFromEntityType(canonical.business.entityType) ?? null,
    municipality:
      canonical.addresses.municipality?.trim() ||
      canonical.addresses.operatingAddress?.cityOrMunicipality?.trim() ||
      canonical.addresses.principalPhysical?.cityOrMunicipality?.trim() ||
      null,
    physical_address: physical,
  };
}

/** Which passport fields are filled vs empty on a profile. */
export function passportCoverage(profile: CanonicalApplicationData): {
  filled: BusinessPassportFieldId[];
  empty: BusinessPassportFieldId[];
} {
  const filled: BusinessPassportFieldId[] = [];
  const empty: BusinessPassportFieldId[] = [];
  for (const id of BUSINESS_PASSPORT_FIELDS) {
    if (readCanonicalField(profile, id) !== undefined) filled.push(id);
    else empty.push(id);
  }
  return { filled, empty };
}

/** Worksheet prefill bridge: map passport → legacy PrefillProfile keys. */
export function worksheetPrefillFromPassport(profile: CanonicalApplicationData): {
  name?: string;
  municipality?: string;
  business_structure?: string;
  number_of_employees?: number | null;
  trade_name?: string;
  ein?: string;
  email?: string;
  phone?: string;
  naics_code?: string;
  physical_address?: string;
  mailing_address?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
} {
  return {
    name: profile.business.legalName || undefined,
    trade_name: profile.business.tradeName,
    ein: profile.business.ein,
    email: profile.business.email,
    phone: profile.business.phone,
    naics_code: profile.business.naicsCode,
    municipality: profile.addresses.municipality || profile.addresses.operatingAddress?.cityOrMunicipality,
    business_structure: legacyStructureFromEntityType(profile.business.entityType),
    number_of_employees: profile.business.employeeCount ?? profile.operations.employeeCount ?? null,
    physical_address: formatAddressLine(profile.addresses.operatingAddress ?? profile.addresses.principalPhysical) || undefined,
    mailing_address:
      formatAddressLine(
        profile.addresses.mailingSameAsPhysical
          ? profile.addresses.operatingAddress ?? profile.addresses.principalPhysical
          : profile.addresses.principalMailing
      ) || undefined,
    contact_name: profile.contact.fullName,
    contact_email: profile.contact.email,
    contact_phone: profile.contact.phone,
  };
}
