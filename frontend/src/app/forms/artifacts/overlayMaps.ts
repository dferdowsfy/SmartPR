// ============================================================================
// Coordinate overlays for official PDFs that carry no AcroForm fields.
//
// The government background is never redrawn or altered — SmartPR writes text
// on top of the untouched page. Coordinates are in PDF user space (origin at
// the bottom-left of the page) and were derived from the position of the ruled
// blanks in each form's own text layer, then rounded to whole points.
//
// Coordinates are VERSION-BOUND. A new agency revision must be re-measured and
// stored under its own revision key — never migrated silently, because a moved
// blank would print a value into the wrong box on an official filing.
// ============================================================================

import type { FieldMapping } from "./types.ts";

const PLACEMENT_NOTE =
  "Coordinates derived from the ruled blanks in the form's text layer. Validate visually with the mapping preview before production use.";

/** Defaults every placement to unreviewed with a validation note. */
function overlay(mapping: Omit<FieldMapping, "reviewed" | "transform"> & Partial<Pick<FieldMapping, "reviewed" | "transform">>): FieldMapping {
  return {
    reviewed: false,
    transform: "none",
    ...mapping,
    reviewNote: mapping.reviewNote ?? PLACEMENT_NOTE,
  };
}

/**
 * CORPREG01 — Certificate of Incorporation (Stock Corporation), 2 pages,
 * 612 × 792 pt. Measured against the file recorded in the template manifest.
 */
export const CORPREG01_OVERLAY: FieldMapping[] = [
  overlay({
    pdfField: "first_corporation_name",
    canonicalField: "business.legal_name",
    confidence: 0.95,
    placement: { page: 1, x: 60, y: 547, width: 490, height: 12, fontSize: 10 },
  }),
  overlay({
    pdfField: "second_designated_office_physical",
    canonicalField: "location.physical_address",
    confidence: 0.86,
    placement: { page: 1, x: 96, y: 432, width: 150, height: 46, fontSize: 8, maxLines: 4, lineHeight: 11.6 },
  }),
  overlay({
    pdfField: "second_designated_office_mailing",
    canonicalField: "location.mailing_address",
    confidence: 0.86,
    placement: { page: 1, x: 348, y: 432, width: 172, height: 46, fontSize: 8, maxLines: 4, lineHeight: 11.6 },
  }),
  overlay({
    pdfField: "second_resident_agent_name",
    canonicalField: "parties.resident_agent_name",
    confidence: 0.9,
    placement: { page: 1, x: 268, y: 374, width: 280, height: 12, fontSize: 9 },
  }),
  overlay({
    pdfField: "second_resident_agent_physical",
    canonicalField: "parties.resident_agent_physical_address",
    confidence: 0.88,
    placement: { page: 1, x: 95, y: 294, width: 150, height: 46, fontSize: 8, maxLines: 4, lineHeight: 11.6 },
  }),
  overlay({
    pdfField: "second_resident_agent_mailing",
    canonicalField: "parties.resident_agent_mailing_address",
    confidence: 0.88,
    placement: { page: 1, x: 347, y: 294, width: 172, height: 46, fontSize: 8, maxLines: 4, lineHeight: 11.6 },
  }),
  overlay({
    pdfField: "third_purpose",
    canonicalField: "business.activity_description",
    confidence: 0.9,
    placement: { page: 1, x: 59, y: 211.5, width: 492, height: 45, fontSize: 8.5, maxLines: 4, lineHeight: 11.6 },
  }),
  overlay({
    pdfField: "fourth_authorized_capital_stock",
    canonicalField: null,
    confidence: 0,
    reviewNote:
      "Authorized share classes and par value are answered on this filing, not in the shared business profile.",
    placement: { page: 1, x: 59, y: 107.5, width: 492, height: 34, fontSize: 8.5, maxLines: 3, lineHeight: 11.6 },
  }),
  overlay({
    pdfField: "fourth_stock_rights",
    canonicalField: null,
    confidence: 0,
    reviewNote: "Stock designations, preferences and rights are answered on this filing.",
    placement: { page: 2, x: 59, y: 729.5, width: 492, height: 22, fontSize: 8.5, maxLines: 2, lineHeight: 11.6 },
  }),
  overlay({
    pdfField: "fifth_incorporators",
    canonicalField: "parties.incorporator_list",
    confidence: 0.9,
    placement: { page: 2, x: 59, y: 660.5, width: 492, height: 45, fontSize: 8, maxLines: 4, lineHeight: 11.6 },
  }),
  overlay({
    pdfField: "sixth_directors",
    canonicalField: "parties.director_list",
    confidence: 0.88,
    placement: { page: 2, x: 59, y: 534.5, width: 492, height: 45, fontSize: 8, maxLines: 4, lineHeight: 11.6 },
  }),
  overlay({
    pdfField: "seventh_term_perpetual_mark",
    canonicalField: "filing.term_of_existence",
    constantValue: "X",
    writeWhen: { canonicalField: "filing.term_of_existence", equalsAny: ["perpetual"] },
    confidence: 0.82,
    placement: { page: 2, x: 61, y: 444, width: 12, height: 11, fontSize: 10 },
  }),
  overlay({
    pdfField: "seventh_term_indefinite_mark",
    canonicalField: "filing.term_of_existence",
    constantValue: "X",
    writeWhen: { canonicalField: "filing.term_of_existence", equalsAny: ["indefinite"] },
    confidence: 0.82,
    placement: { page: 2, x: 169, y: 444, width: 12, height: 11, fontSize: 10 },
  }),
  overlay({
    pdfField: "seventh_term_specific_mark",
    canonicalField: "filing.term_of_existence",
    constantValue: "X",
    writeWhen: { canonicalField: "filing.term_of_existence", equalsAny: ["specific_date"] },
    confidence: 0.82,
    placement: { page: 2, x: 277, y: 444, width: 12, height: 11, fontSize: 10 },
  }),
  overlay({
    pdfField: "seventh_term_specific_date",
    canonicalField: "filing.existence_end_date",
    confidence: 0.8,
    placement: { page: 2, x: 398, y: 444, width: 100, height: 11, fontSize: 9 },
  }),
  overlay({
    pdfField: "effective_on_filing_date_mark",
    canonicalField: "filing.effective_date_choice",
    constantValue: "X",
    writeWhen: { canonicalField: "filing.effective_date_choice", equalsAny: ["filing_date"] },
    confidence: 0.82,
    placement: { page: 2, x: 61, y: 375, width: 12, height: 11, fontSize: 10 },
  }),
  overlay({
    pdfField: "effective_on_future_date_mark",
    canonicalField: "filing.effective_date_choice",
    constantValue: "X",
    writeWhen: { canonicalField: "filing.effective_date_choice", equalsAny: ["future_date"] },
    confidence: 0.82,
    placement: { page: 2, x: 61, y: 340, width: 12, height: 11, fontSize: 10 },
  }),
  overlay({
    pdfField: "effective_future_date",
    canonicalField: "filing.future_effective_date",
    confidence: 0.78,
    placement: { page: 2, x: 155, y: 340, width: 110, height: 11, fontSize: 9 },
  }),
  overlay({
    pdfField: "testimony_incorporator_names_es",
    canonicalField: "parties.incorporator_names",
    confidence: 0.84,
    placement: { page: 2, x: 289, y: 272, width: 262, height: 11, fontSize: 8 },
  }),
  overlay({
    pdfField: "testimony_incorporator_names_en",
    canonicalField: "parties.incorporator_names",
    confidence: 0.84,
    placement: { page: 2, x: 214, y: 226, width: 337, height: 11, fontSize: 8 },
  }),
  overlay({
    pdfField: "contact_email",
    canonicalField: "business.email",
    confidence: 0.9,
    placement: { page: 2, x: 175, y: 100, width: 280, height: 11, fontSize: 9 },
  }),
];

/**
 * SC 2309 — Solicitud de Licencias, 4 pages, 612 × 1008 pt. Only Parte I–III on
 * page 1 are applicant-completed; pages 2–4 are agency-use and instructions and
 * are deliberately left untouched.
 */
export const SC2309_OVERLAY: FieldMapping[] = [
  overlay({
    pdfField: "parte1_nombre",
    canonicalField: "business.legal_name",
    confidence: 0.9,
    placement: { page: 1, x: 24, y: 869, width: 300, height: 12, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte1_numero_registro_comerciante",
    canonicalField: "business.merchant_registration_number",
    confidence: 0.86,
    placement: { page: 1, x: 458, y: 869, width: 125, height: 12, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte1_numero_seguro_social",
    canonicalField: null,
    confidence: 0,
    reviewNote: "Individual social security number — entered by the filer on the artifact, never auto-filled.",
    placement: { page: 1, x: 339, y: 869, width: 110, height: 12, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte1_nombre_comercial",
    canonicalField: "business.trade_name",
    confidence: 0.88,
    placement: { page: 1, x: 24, y: 845, width: 285, height: 12, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte1_numero_identificacion_patronal",
    canonicalField: "business.ein",
    confidence: 0.84,
    placement: { page: 1, x: 322, y: 845, width: 120, height: 12, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte1_numero_telefono",
    canonicalField: "business.phone",
    confidence: 0.7,
    placement: { page: 1, x: 466, y: 845, width: 118, height: 12, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte1_direccion_postal",
    canonicalField: "location.mailing_address",
    confidence: 0.86,
    placement: { page: 1, x: 24, y: 820, width: 280, height: 22, fontSize: 8, maxLines: 2, lineHeight: 10 },
  }),
  overlay({
    pdfField: "parte1_localizacion_negocio",
    canonicalField: "location.physical_address",
    confidence: 0.86,
    placement: { page: 1, x: 314, y: 820, width: 270, height: 22, fontSize: 8, maxLines: 2, lineHeight: 10 },
  }),
  // Tipo de contribuyente — one "X" driven by the canonical entity type.
  overlay({
    pdfField: "parte1_tipo_individuo",
    canonicalField: "business.entity_type",
    constantValue: "X",
    writeWhen: { canonicalField: "business.entity_type", equalsAny: ["sole_proprietorship"] },
    confidence: 0.72,
    placement: { page: 1, x: 115, y: 896, width: 10, height: 10, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte1_tipo_sociedad",
    canonicalField: "business.entity_type",
    constantValue: "X",
    writeWhen: { canonicalField: "business.entity_type", equalsAny: ["partnership", "limited_liability_partnership"] },
    confidence: 0.72,
    placement: { page: 1, x: 171, y: 896, width: 10, height: 10, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte1_tipo_corporacion",
    canonicalField: "business.entity_type",
    constantValue: "X",
    writeWhen: {
      canonicalField: "business.entity_type",
      equalsAny: [
        "stock_corporation",
        "close_corporation",
        "professional_corporation",
        "nonprofit_nonstock_corporation",
        "foreign_corporation",
      ],
    },
    confidence: 0.72,
    placement: { page: 1, x: 228, y: 896, width: 10, height: 10, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte1_tipo_llc",
    canonicalField: "business.entity_type",
    constantValue: "X",
    writeWhen: { canonicalField: "business.entity_type", equalsAny: ["limited_liability_company"] },
    confidence: 0.72,
    placement: { page: 1, x: 296, y: 896, width: 10, height: 10, fontSize: 9 },
  }),
  // Parte II — licencia(s) que solicita. Each mark is driven by one activity.
  overlay({
    pdfField: "parte2_bebidas_alcoholicas",
    canonicalField: "activities.alcohol_sales",
    constantValue: "X",
    writeWhen: { canonicalField: "activities.alcohol_sales", equalsAny: ["true"] },
    confidence: 0.88,
    placement: { page: 1, x: 35, y: 546, width: 10, height: 10, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte2_gasolina",
    canonicalField: "activities.fuel_sales",
    constantValue: "X",
    writeWhen: { canonicalField: "activities.fuel_sales", equalsAny: ["true"] },
    confidence: 0.85,
    placement: { page: 1, x: 134, y: 546, width: 10, height: 10, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte2_cigarrillos",
    canonicalField: "activities.cigarette_sales",
    constantValue: "X",
    writeWhen: { canonicalField: "activities.cigarette_sales", equalsAny: ["true"] },
    confidence: 0.85,
    placement: { page: 1, x: 195, y: 546, width: 10, height: 10, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte2_promotor_espectaculos",
    canonicalField: "activities.public_show_promoter",
    constantValue: "X",
    writeWhen: { canonicalField: "activities.public_show_promoter", equalsAny: ["true"] },
    confidence: 0.82,
    placement: { page: 1, x: 381, y: 546, width: 10, height: 10, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte2_metales_preciosos",
    canonicalField: "activities.precious_metals",
    constantValue: "X",
    writeWhen: { canonicalField: "activities.precious_metals", equalsAny: ["true"] },
    confidence: 0.82,
    placement: { page: 1, x: 35, y: 531, width: 10, height: 10, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte2_armas_municiones",
    canonicalField: "activities.weapons_sales",
    constantValue: "X",
    writeWhen: { canonicalField: "activities.weapons_sales", equalsAny: ["true"] },
    confidence: 0.82,
    placement: { page: 1, x: 198, y: 531, width: 10, height: 10, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte2_maquinas_monedas",
    canonicalField: "activities.coin_operated_machines",
    constantValue: "X",
    writeWhen: { canonicalField: "activities.coin_operated_machines", equalsAny: ["true"] },
    confidence: 0.8,
    placement: { page: 1, x: 35, y: 516, width: 10, height: 10, fontSize: 9 },
  }),
  overlay({
    pdfField: "parte3_comentarios",
    canonicalField: "business.activity_description",
    confidence: 0.6,
    reviewNote:
      "Comentarios is a free-text block; confirm the district office accepts the activity description here.",
    placement: { page: 1, x: 80, y: 489, width: 500, height: 10, fontSize: 7.5 },
  }),
];

/**
 * CORPLLC02 — Certificate of Formation of a Limited Liability Company,
 * 2 pages, 612 × 792 pt.
 *
 * Unlike CORPREG01 (whose blanks are underscore glyphs in the text layer),
 * this form rules its blanks as vector lines. Coordinates below were read from
 * those line segments; a text baseline sits ~4 pt above its rule so the value
 * rests on the line rather than through it. The two EN TESTIMONIO name blanks
 * are underscore runs inside a sentence, so those two are offset from the text
 * item instead.
 *
 * Deliberately NOT populated:
 *   * the four "Persona(s) Autorizada(s)" signature rules on page 2 — a
 *     signature is an act, never something inferred from a name on file;
 *   * the day/month/year blanks in the attestation sentence, which date that
 *     same signing act.
 */
export const CORPLLC02_OVERLAY: FieldMapping[] = [
  // --- Page 1 -------------------------------------------------------------
  overlay({
    pdfField: "first_llc_name",
    canonicalField: "business.legal_name",
    confidence: 0.95,
    placement: { page: 1, x: 48, y: 526, width: 515, height: 12, fontSize: 10 },
  }),
  overlay({
    pdfField: "second_main_office_physical",
    canonicalField: "location.physical_address",
    confidence: 0.88,
    placement: { page: 1, x: 48, y: 399, width: 215, height: 39, fontSize: 8, maxLines: 3, lineHeight: 13 },
  }),
  overlay({
    pdfField: "second_main_office_mailing",
    canonicalField: "location.mailing_address",
    confidence: 0.88,
    placement: { page: 1, x: 345, y: 399, width: 225, height: 39, fontSize: 8, maxLines: 3, lineHeight: 13 },
  }),
  overlay({
    pdfField: "second_resident_agent_name",
    canonicalField: "parties.resident_agent_name",
    confidence: 0.9,
    reviewNote:
      "This form gives the resident agent a name line only — unlike CORPREG01 it carries no separate agent address block.",
    placement: { page: 1, x: 292, y: 347, width: 278, height: 12, fontSize: 9 },
  }),
  overlay({
    pdfField: "third_purpose",
    canonicalField: "business.activity_description",
    confidence: 0.85,
    placement: { page: 1, x: 48, y: 270, width: 520, height: 52, fontSize: 8, maxLines: 4, lineHeight: 13 },
  }),
  overlay({
    pdfField: "fourth_authorized_persons",
    canonicalField: "parties.incorporator_list",
    confidence: 0.82,
    reviewNote:
      "CUARTO asks for the LLC's authorized person(s); SmartPR carries them in the same canonical list as a corporation's incorporators.",
    placement: { page: 1, x: 48, y: 153, width: 520, height: 78, fontSize: 8, maxLines: 6, lineHeight: 13 },
  }),

  // --- Page 2 -------------------------------------------------------------
  overlay({
    pdfField: "fifth_administrators",
    canonicalField: "parties.director_list",
    confidence: 0.82,
    placement: { page: 2, x: 48, y: 660, width: 520, height: 53, fontSize: 8, maxLines: 4, lineHeight: 13.4 },
  }),
  overlay({
    pdfField: "sixth_term_indefinite_mark",
    canonicalField: "filing.term_of_existence",
    constantValue: "X",
    writeWhen: { canonicalField: "filing.term_of_existence", equalsAny: ["indefinite"] },
    confidence: 0.82,
    placement: { page: 2, x: 55, y: 557, width: 12, height: 11, fontSize: 10 },
  }),
  overlay({
    pdfField: "sixth_term_perpetual_mark",
    canonicalField: "filing.term_of_existence",
    constantValue: "X",
    writeWhen: { canonicalField: "filing.term_of_existence", equalsAny: ["perpetual"] },
    confidence: 0.82,
    placement: { page: 2, x: 239, y: 557, width: 12, height: 11, fontSize: 10 },
  }),
  overlay({
    pdfField: "sixth_term_specific_date",
    canonicalField: "filing.existence_end_date",
    confidence: 0.78,
    reviewNote:
      "The form rules a date line after 'Fecha Especifica:' but no separate tick box before it, so a specific term is indicated by the date alone — no mark is invented.",
    placement: { page: 2, x: 486, y: 557, width: 85, height: 11, fontSize: 8 },
  }),
  overlay({
    pdfField: "effective_on_filing_date_mark",
    canonicalField: "filing.effective_date_choice",
    constantValue: "X",
    writeWhen: { canonicalField: "filing.effective_date_choice", equalsAny: ["filing_date"] },
    confidence: 0.82,
    placement: { page: 2, x: 55, y: 481, width: 12, height: 11, fontSize: 10 },
  }),
  overlay({
    pdfField: "effective_on_future_date_mark",
    canonicalField: "filing.effective_date_choice",
    constantValue: "X",
    writeWhen: { canonicalField: "filing.effective_date_choice", equalsAny: ["future_date"] },
    confidence: 0.82,
    placement: { page: 2, x: 55, y: 443, width: 12, height: 11, fontSize: 10 },
  }),
  overlay({
    pdfField: "effective_future_date",
    canonicalField: "filing.future_effective_date",
    confidence: 0.78,
    placement: { page: 2, x: 180, y: 443, width: 88, height: 11, fontSize: 8 },
  }),
  overlay({
    pdfField: "testimony_authorized_persons_es",
    canonicalField: "parties.incorporator_names",
    confidence: 0.84,
    placement: { page: 2, x: 289, y: 367, width: 262, height: 11, fontSize: 8 },
  }),
  overlay({
    pdfField: "testimony_authorized_persons_en",
    canonicalField: "parties.incorporator_names",
    confidence: 0.84,
    placement: { page: 2, x: 213, y: 304, width: 337, height: 11, fontSize: 8 },
  }),
  overlay({
    pdfField: "entity_email",
    canonicalField: "business.email",
    confidence: 0.9,
    placement: { page: 2, x: 202, y: 149, width: 365, height: 12, fontSize: 9 },
  }),
];

/**
 * NC001 — Solicitud de Registro de Nombre Comercial (Trade Name / DBA), 6
 * pages, 612 x 792 pt (only pages 1-3 are fillable; 4-6 are instructions).
 *
 * Unlike the forms above, coordinates here were not read off ruled-line
 * glyphs alone: every x/y was taken from the PDF's own text-content layer
 * (one label per line, no ambiguity), then the populated PDF was re-rendered
 * to an image and visually checked page by page — four placements printed on
 * top of a ruled line on the first pass and were nudged clear. Still
 * `reviewed: false`, same standard as the rest of this file.
 *
 * `ownership` is used explicitly here (applicant / signature / notary /
 * government_only) for every never-written field, rather than omitting them
 * the way the CORPREG* maps above do — the fuller PA02-style convention, kept
 * so the mapping documents where every one of those blocks sits instead of
 * only what SmartPR writes.
 */
export const NC001_OVERLAY: FieldMapping[] = [
  overlay({
    pdfField: "trade_name",
    canonicalField: null,
    ownership: "applicant",
    confidence: 0,
    placement: { page: 1, x: 131, y: 584.5, width: 430, height: 12, fontSize: 10 },
    reviewNote:
      "'NOMBRE COMERCIAL :' blank (right of the colon at x=120.5,y=583.4). Written via directOverlayValues — the trade name is the asset being registered, not an existing canonical fact.",
  }),
  overlay({
    pdfField: "reg_number",
    canonicalField: null,
    ownership: "government_only",
    confidence: 0,
    reviewed: true,
    placement: { page: 1, x: 420, y: 649.4, width: 150, height: 10, fontSize: 9 },
    reviewNote: "'Núm. Reg. / Reg. No.' — assigned by the Department of State when it processes the filing. Never written by SmartPR.",
  }),
  overlay({
    pdfField: "application_date",
    canonicalField: null,
    ownership: "applicant",
    confidence: 0,
    placement: { page: 1, x: 396, y: 681.5, width: 160, height: 10, fontSize: 9 },
    reviewNote: "'Fecha/Date' line — the date the application is filed. Defaults to today's date in the capture UI; the applicant can change it.",
  }),
  overlay({
    pdfField: "applicant_name",
    canonicalField: "owner.full_name",
    ownership: "smartpr_derived",
    confidence: 0.7,
    placement: { page: 1, x: 250, y: 538.2, width: 125, height: 10, fontSize: 8 },
    reviewNote:
      "Left portion of the 'NOMBRE DEL SOLICITANTE Y NÚM. DE TELÉFONO :' blank. The 'Tel.' caption at x=382.5,y=548.8 sits directly above where the phone portion of this same line goes — see applicant_phone.",
  }),
  overlay({
    pdfField: "applicant_phone",
    canonicalField: "business.phone",
    ownership: "smartpr_derived",
    confidence: 0.7,
    placement: { page: 1, x: 385, y: 538.2, width: 180, height: 10, fontSize: 8 },
    reviewNote: "Right portion of the same blank as applicant_name, under the 'Tel.' caption.",
  }),
  overlay({
    pdfField: "entity_kind_natural_mark",
    canonicalField: null,
    ownership: "applicant",
    confidence: 0,
    placement: { page: 1, x: 134, y: 477.1, width: 15, height: 10, fontSize: 9 },
    reviewNote:
      "Mark inside the '(_____)' before 'PERSONA NATURAL (Individual/Person)'. Written via directOverlayValues from the entity_kind radio; mutually exclusive with entity_kind_juridica_mark.",
  }),
  overlay({
    pdfField: "entity_kind_juridica_mark",
    canonicalField: null,
    ownership: "applicant",
    confidence: 0,
    placement: { page: 1, x: 134, y: 466.7, width: 15, height: 10, fontSize: 9 },
    reviewNote: "Mark inside the '(_____)' before 'PERSONA JURIDICA (Juristic Entity)'.",
  }),
  overlay({
    pdfField: "state_or_country_or_citizenship",
    canonicalField: null,
    ownership: "applicant",
    confidence: 0,
    placement: { page: 1, x: 22.5, y: 405, width: 560, height: 10, fontSize: 9 },
    reviewNote:
      "Blank between the bilingual 'INDIQUE EL ESTADO O PAÍS... / INDIQUE LA CIUDADANÍA' instruction (ends y=417.1) and the address section header (starts y=382.5).",
  }),
  overlay({
    pdfField: "principal_address",
    canonicalField: "location.physical_address",
    ownership: "smartpr_derived",
    confidence: 0.75,
    placement: { page: 1, x: 22.5, y: 360, width: 560, height: 40, fontSize: 9, maxLines: 3, lineHeight: 14 },
    reviewNote:
      "The form asks for physical AND postal address in one combined block; only the operating (physical) address is written here. A mismatched mailing address is a known limitation.",
  }),
  overlay({
    pdfField: "principal_phone",
    canonicalField: "business.phone",
    ownership: "smartpr_derived",
    confidence: 0.85,
    placement: { page: 1, x: 280, y: 309.5, width: 300, height: 10, fontSize: 9 },
    reviewNote: "'TELÉFONO DE LA OFICINA PRINCIPAL DE NEGOCIOS:' blank.",
  }),
  overlay({
    pdfField: "nature_of_business",
    canonicalField: "business.activity_description",
    ownership: "smartpr_derived",
    confidence: 0.8,
    placement: { page: 1, x: 22.5, y: 245, width: 560, height: 55, fontSize: 9, maxLines: 4, lineHeight: 14 },
    reviewNote: "'IDENTIFIQUE LA ACTIVIDAD EMPRESARIAL O PROPÓSITOS DEL NEGOCIO:' blank (label ends y=269.0, next section starts y=177.8).",
  }),
  overlay({
    pdfField: "used_since_mark",
    canonicalField: null,
    ownership: "applicant",
    confidence: 0,
    placement: { page: 1, x: 26, y: 177.8, width: 12, height: 9, fontSize: 9 },
    reviewNote:
      "Mark inside the '(____)' before 'EL NOMBRE COMERCIAL SE USA EN EL COMERCIO... DESDE'. Mutually exclusive with not_used_mark.",
  }),
  overlay({
    pdfField: "used_since_date",
    canonicalField: null,
    ownership: "applicant",
    confidence: 0,
    placement: { page: 1, x: 430, y: 177.8, width: 95, height: 9, fontSize: 8 },
    reviewNote:
      "The '(mes/día/año)' blank on the same line, estimated from the string's proportional width — validate visually with the mapping preview before production use, more so than the label-anchored fields above.",
  }),
  overlay({
    pdfField: "not_used_mark",
    canonicalField: null,
    ownership: "applicant",
    confidence: 0,
    placement: { page: 1, x: 26, y: 147.8, width: 12, height: 9, fontSize: 9 },
    reviewNote: "Mark inside the '(____)' before 'EL NOMBRE COMERCIAL NO HA SIDO USADO...'.",
  }),
  overlay({
    pdfField: "applicant_signature_p1",
    canonicalField: null,
    ownership: "signature",
    confidence: 0,
    reviewed: true,
    placement: { page: 1, x: 238.5, y: 60, width: 249, height: 10, fontSize: 9 },
    reviewNote: "'Nombre, firma y título del solicitante' — the filer's own wet/e-signature. Never written.",
  }),
  overlay({
    pdfField: "applicant_name_p2",
    canonicalField: "owner.full_name",
    ownership: "smartpr_derived",
    confidence: 0.7,
    placement: { page: 2, x: 200, y: 730, width: 220, height: 10, fontSize: 9 },
    reviewNote:
      "The applicant's name repeated at the top of the sworn-declaration page, above the 'Nombre del Solicitante' caption (y=718.0). Same canonical source as the page-1 applicant_name field, resolved independently — not re-typed, not routed through formData.",
  }),
  overlay({
    pdfField: "declaration_body",
    canonicalField: null,
    ownership: "notary",
    confidence: 0,
    reviewed: true,
    placement: { page: 2, x: 22.5, y: 686.9, width: 547, height: 120, fontSize: 9 },
    reviewNote: "The printed sworn-statement text itself (declara y dice que...). Not a blank to fill; recorded only so the block's extent is documented as never-written.",
  }),
  overlay({
    pdfField: "applicant_signature_p2",
    canonicalField: null,
    ownership: "signature",
    confidence: 0,
    reviewed: true,
    placement: { page: 2, x: 346.5, y: 520, width: 209, height: 10, fontSize: 9 },
    reviewNote: "'Nombre, firma y título del solicitante' on the declaration page. Never written.",
  }),
  overlay({
    pdfField: "affidavit_number",
    canonicalField: null,
    ownership: "notary",
    confidence: 0,
    reviewed: true,
    placement: { page: 2, x: 100, y: 455.3, width: 150, height: 10, fontSize: 9 },
    reviewNote: "'Affidavit Núm.' — assigned by the notary at signing. Never written.",
  }),
  overlay({
    pdfField: "sworn_date",
    canonicalField: null,
    ownership: "notary",
    confidence: 0,
    reviewed: true,
    placement: { page: 2, x: 60, y: 413.8, width: 260, height: 10, fontSize: 9 },
    reviewNote: "'Jurado y suscrito ante mí, hoy ___ de ___ de 20__' — completed by the notary at the moment of signing. Never written.",
  }),
  overlay({
    pdfField: "notary_seal",
    canonicalField: null,
    ownership: "notary",
    confidence: 0,
    reviewed: true,
    placement: { page: 2, x: 22.5, y: 332, width: 60, height: 30, fontSize: 9 },
    reviewNote: "'Sello Notarial' / Notary Seal. Never written.",
  }),
  overlay({
    pdfField: "notary_signature",
    canonicalField: null,
    ownership: "notary",
    confidence: 0,
    reviewed: true,
    placement: { page: 2, x: 346.4, y: 332, width: 209, height: 10, fontSize: 9 },
    reviewNote: "'*Firma del Notario Público'. Never written.",
  }),
  overlay({
    pdfField: "words_claimed",
    canonicalField: null,
    ownership: "applicant",
    confidence: 0,
    placement: { page: 3, x: 22.5, y: 616, width: 560, height: 70, fontSize: 9, maxLines: 4, lineHeight: 17 },
    reviewNote: "'PALABRAS (Words):' — the words claimed as part of the trade name. The form's own instructions say the applicant may leave this blank if not applicable.",
  }),
  overlay({
    pdfField: "disclaimer_non_registrable",
    canonicalField: null,
    ownership: "applicant",
    confidence: 0,
    placement: { page: 3, x: 22.5, y: 493, width: 560, height: 70, fontSize: 9, maxLines: 4, lineHeight: 17 },
    reviewNote: "'RENUNCIA DE COMPONENTES NO REGISTRABLES' — disclaimer of non-registrable components. Optional, same as words_claimed.",
  }),
];

export const OVERLAY_MAPS: Record<string, FieldMapping[]> = {
  CORPREG01: CORPREG01_OVERLAY,
  CORPLLC02: CORPLLC02_OVERLAY,
  SC2309: SC2309_OVERLAY,
  NC001: NC001_OVERLAY,
};
