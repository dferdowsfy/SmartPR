// ============================================================================
// Core Application Details intake (Part 1).
//
// Collect the SHARED business information once, immediately before "See
// Requirements". This deliberately omits per-filing questions (capital stock,
// members, incorporator/director/partner lists, licensing/signature
// attestations) — those live in the applicable form, not universal intake.
// ============================================================================

import type {
  CanonicalAddress,
  CanonicalApplicationData,
  EntityType,
  FormOption,
} from "./types.ts";
import { emptyCanonicalData } from "./types.ts";
import { t } from "../definitions/pr/department-of-state/shared.ts";

/** Entity / filing type options (Part 1). */
export const ENTITY_TYPE_OPTIONS: FormOption[] = [
  { value: "stock_corporation", label: t("Stock corporation", "Corporación con acciones") },
  { value: "nonprofit_nonstock_corporation", label: t("Nonprofit non-stock corporation", "Corporación sin fines de lucro sin acciones") },
  { value: "close_corporation", label: t("Close / intimate corporation", "Corporación íntima") },
  { value: "professional_corporation", label: t("Professional corporation", "Corporación profesional") },
  { value: "foreign_corporation", label: t("Foreign corporation seeking authorization in Puerto Rico", "Corporación foránea que busca autorización en Puerto Rico") },
  { value: "limited_liability_partnership", label: t("Limited liability partnership", "Sociedad de responsabilidad limitada") },
  { value: "limited_liability_company", label: t("Limited liability company", "Compañía de responsabilidad limitada") },
  { value: "sole_proprietorship", label: t("Sole proprietorship", "Empresa individual") },
  { value: "partnership", label: t("Partnership", "Sociedad") },
  { value: "other", label: t("Other / not sure", "Otro / no estoy seguro") },
];

export const FORMATION_STATUS_OPTIONS: FormOption[] = [
  { value: "not_formed", label: t("Not yet formed", "Aún no formada") },
  { value: "formed_in_puerto_rico", label: t("Already formed in Puerto Rico", "Ya formada en Puerto Rico") },
  { value: "formed_outside_puerto_rico", label: t("Formed outside Puerto Rico", "Formada fuera de Puerto Rico") },
];

/** The intake field spec — shape only; the renderer/UI reads this. */
export interface IntakeFieldSpec {
  id: string;
  group: "business" | "contact" | "address" | "property";
  canonicalKey: string;
  label: { en: string; es: string };
  type: "text" | "textarea" | "select" | "email" | "phone" | "date" | "number" | "checkbox" | "address";
  required?: boolean;
  optional?: boolean;
  options?: FormOption[];
}

export const INTAKE_FIELDS: IntakeFieldSpec[] = [
  { id: "legalName", group: "business", canonicalKey: "business.legalName", label: { en: "Legal entity name", es: "Nombre legal de la entidad" }, type: "text", required: true },
  { id: "tradeName", group: "business", canonicalKey: "business.tradeName", label: { en: "Trade name / DBA", es: "Nombre comercial / DBA" }, type: "text", optional: true },
  { id: "entityType", group: "business", canonicalKey: "business.entityType", label: { en: "Entity or filing type", es: "Tipo de entidad o presentación" }, type: "select", required: true, options: ENTITY_TYPE_OPTIONS },
  { id: "formationStatus", group: "business", canonicalKey: "business.formationStatus", label: { en: "Is the entity already formed?", es: "¿Está la entidad ya formada?" }, type: "select", required: true, options: FORMATION_STATUS_OPTIONS },
  { id: "jurisdictionOfFormation", group: "business", canonicalKey: "business.jurisdictionOfFormation", label: { en: "Jurisdiction of formation", es: "Jurisdicción de formación" }, type: "text", optional: true },
  { id: "forProfitStatus", group: "business", canonicalKey: "business.forProfitStatus", label: { en: "For-profit or nonprofit", es: "Con o sin fines de lucro" }, type: "select", options: [{ value: "for_profit", label: t("For-profit", "Con fines de lucro") }, { value: "nonprofit", label: t("Nonprofit", "Sin fines de lucro") }] },
  { id: "purpose", group: "business", canonicalKey: "business.purpose", label: { en: "Business purpose or activity description", es: "Propósito del negocio o descripción de la actividad" }, type: "textarea" },
  { id: "email", group: "business", canonicalKey: "business.email", label: { en: "Entity email", es: "Correo electrónico de la entidad" }, type: "email" },
  { id: "phone", group: "business", canonicalKey: "business.phone", label: { en: "Main telephone number", es: "Teléfono principal" }, type: "phone" },
  { id: "ein", group: "business", canonicalKey: "business.ein", label: { en: "EIN", es: "EIN" }, type: "text" },
  { id: "operationsStartDate", group: "business", canonicalKey: "business.operationsStartDate", label: { en: "Planned operations start date", es: "Fecha prevista de inicio de operaciones" }, type: "date" },
  { id: "employeeCount", group: "business", canonicalKey: "business.employeeCount", label: { en: "Number of employees", es: "Número de empleados" }, type: "number", optional: true },

  { id: "contactFullName", group: "contact", canonicalKey: "contact.fullName", label: { en: "Full name", es: "Nombre completo" }, type: "text" },
  { id: "contactEmail", group: "contact", canonicalKey: "contact.email", label: { en: "Email", es: "Correo electrónico" }, type: "email" },
  { id: "contactPhone", group: "contact", canonicalKey: "contact.phone", label: { en: "Phone", es: "Teléfono" }, type: "phone" },
  { id: "contactRole", group: "contact", canonicalKey: "contact.role", label: { en: "Role or relationship to the business", es: "Rol o relación con el negocio" }, type: "text" },

  { id: "principalPhysical", group: "address", canonicalKey: "addresses.principalPhysical", label: { en: "Principal physical address", es: "Dirección física principal" }, type: "address" },
  { id: "mailingSameAsPhysical", group: "address", canonicalKey: "addresses.mailingSameAsPhysical", label: { en: "Mailing address same as physical address", es: "Dirección postal igual a la física" }, type: "checkbox" },
  { id: "principalMailing", group: "address", canonicalKey: "addresses.principalMailing", label: { en: "Principal mailing address", es: "Dirección postal principal" }, type: "address" },
  { id: "operatingAddress", group: "address", canonicalKey: "addresses.operatingAddress", label: { en: "Puerto Rico operating address", es: "Dirección de operaciones en Puerto Rico" }, type: "address" },
  { id: "municipality", group: "address", canonicalKey: "addresses.municipality", label: { en: "Municipality", es: "Municipio" }, type: "text" },

  { id: "occupancyType", group: "property", canonicalKey: "property.occupancyType", label: { en: "Property ownership status", es: "Estado de propiedad del inmueble" }, type: "select", options: [{ value: "owned", label: t("Owned", "Propia") }, { value: "leased", label: t("Leased", "Arrendada") }, { value: "other", label: t("Other", "Otra") }] },
  { id: "ownerName", group: "property", canonicalKey: "property.ownerName", label: { en: "Property owner name", es: "Nombre del dueño del inmueble" }, type: "text", optional: true },
  { id: "cadastralNumber", group: "property", canonicalKey: "property.cadastralNumber", label: { en: "Cadastral number", es: "Número catastral" }, type: "text", optional: true },
  { id: "squareFootage", group: "property", canonicalKey: "property.squareFootage", label: { en: "Approximate square footage", es: "Pies cuadrados aproximados" }, type: "number", optional: true },
];

/**
 * Map the existing SmartPR `business_structure` string onto a canonical
 * EntityType so the legacy intake continues to seed the canonical model without
 * a breaking migration.
 */
export function entityTypeFromLegacyStructure(structure: string | undefined): EntityType {
  switch ((structure || "").toLowerCase()) {
    case "corporation":
      return "stock_corporation";
    case "professional_corporation":
      return "professional_corporation";
    case "nonprofit":
    case "nonprofit_nonstock_corporation":
      return "nonprofit_nonstock_corporation";
    case "close_corporation":
      return "close_corporation";
    case "llp":
    case "limited_liability_partnership":
      return "limited_liability_partnership";
    case "llc":
      return "limited_liability_company";
    case "sole_proprietorship":
      return "sole_proprietorship";
    case "partnership":
      return "partnership";
    case "foreign_corporation":
      return "foreign_corporation";
    default:
      return "other";
  }
}

export interface IntakeProfileInput {
  legalName?: string;
  tradeName?: string;
  entityType?: EntityType;
  business_structure?: string;
  formationStatus?: CanonicalApplicationData["business"]["formationStatus"];
  jurisdictionOfFormation?: string;
  forProfitStatus?: "for_profit" | "nonprofit";
  purpose?: string;
  email?: string;
  phone?: string;
  ein?: string;
  einPending?: boolean;
  incorporationDate?: string;
  naicsCode?: string;
  merchantRegistrationNumber?: string;
  operationsStartDate?: string;
  employeeCount?: number | null;
  municipality?: string;
  operatingAddress?: CanonicalAddress;
  principalPhysical?: CanonicalAddress;
  principalMailing?: CanonicalAddress;
  mailingSameAsPhysical?: boolean;
  contact?: CanonicalApplicationData["contact"];
  property?: Partial<CanonicalApplicationData["property"]>;
}

/** Build (or update) a canonical object from a core-intake payload. */
export function buildCanonicalFromIntake(
  input: IntakeProfileInput,
  base: CanonicalApplicationData = emptyCanonicalData()
): CanonicalApplicationData {
  const entityType = input.entityType ?? entityTypeFromLegacyStructure(input.business_structure) ?? base.business.entityType;
  return {
    ...base,
    business: {
      ...base.business,
      legalName: input.legalName ?? base.business.legalName,
      tradeName: input.tradeName ?? base.business.tradeName,
      entityType,
      formationStatus: input.formationStatus ?? base.business.formationStatus,
      jurisdictionOfFormation: input.jurisdictionOfFormation ?? base.business.jurisdictionOfFormation,
      forProfitStatus: input.forProfitStatus ?? base.business.forProfitStatus,
      purpose: input.purpose ?? base.business.purpose,
      email: input.email ?? base.business.email,
      phone: input.phone ?? base.business.phone,
      ein: input.ein ?? base.business.ein,
      einPending: input.einPending ?? base.business.einPending,
      incorporationDate: input.incorporationDate ?? base.business.incorporationDate,
      naicsCode: input.naicsCode ?? base.business.naicsCode,
      merchantRegistrationNumber: input.merchantRegistrationNumber ?? base.business.merchantRegistrationNumber,
      operationsStartDate: input.operationsStartDate ?? base.business.operationsStartDate,
      employeeCount: input.employeeCount ?? base.business.employeeCount ?? undefined,
    },
    contact: { ...base.contact, ...input.contact },
    addresses: {
      ...base.addresses,
      principalPhysical: input.principalPhysical ?? base.addresses.principalPhysical,
      principalMailing: input.principalMailing ?? base.addresses.principalMailing,
      operatingAddress: input.operatingAddress ?? base.addresses.operatingAddress,
      mailingSameAsPhysical: input.mailingSameAsPhysical ?? base.addresses.mailingSameAsPhysical,
      municipality: input.municipality ?? base.addresses.municipality,
    },
    property: { ...base.property, ...input.property },
  };
}
