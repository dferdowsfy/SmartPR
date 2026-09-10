import type { CanonicalAddress, FormData } from "../engine/types.ts";

export interface DirectAcroValue {
  pdfField: string;
  type: "text" | "checkbox" | "radio";
  value: string;
  /** Prevent the raw value from being copied into population metadata. */
  sensitive?: boolean;
}

const P = "topmostSubform[0].Page1[0].";
const field = (name: string) => `${P}${name}`;

function textValue(data: FormData, id: string): string {
  const value = data[id];
  if (value === undefined || value === null || typeof value === "object") return "";
  return String(value).trim().slice(0, 500);
}

function addressValue(data: FormData, id: string): CanonicalAddress | null {
  const value = data[id];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as CanonicalAddress;
}

function addressLines(address: CanonicalAddress | null): [string, string] {
  if (!address) return ["", ""];
  const street = [address.line1, address.line2].filter(Boolean).join(", ").slice(0, 200);
  const locality = [
    address.cityOrMunicipality,
    [address.stateOrTerritory, address.postalCode].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  const country = address.country?.trim();
  const includeCountry = country && !/^(united states|u\.?s\.?a?\.?|puerto rico)$/i.test(country);
  return [street, `${locality}${includeCountry ? `, ${country}` : ""}`.slice(0, 200)];
}

function pushText(values: DirectAcroValue[], pdfField: string, value: string, sensitive = false) {
  if (value) values.push({ pdfField, type: "text", value, sensitive });
}

function clearText(values: DirectAcroValue[], pdfField: string) {
  values.push({ pdfField, type: "text", value: "" });
}

function setChoice(values: DirectAcroValue[], pdfField: string, selected: boolean) {
  values.push({ pdfField, type: "checkbox", value: selected ? "Yes" : "" });
}

const PA02_TIPO_NEGOCIO: Record<string, string> = {
  individual: "Individuo",
  partnership: "Sociedad",
  corporation: "Corporación",
};

/**
 * PA02 (Solicitud de Patente Provisional) fields answered on the form itself
 * rather than derived from the shared canonical profile: the two radio groups
 * (Tipo de Patente, Tipo de Negocio), the exemption percentage, and the
 * filing-year fields the taxpayer confirms for this specific filing.
 */
function pa02Values(data: FormData): DirectAcroValue[] {
  const values: DirectAcroValue[] = [];

  const patenteType = textValue(data, "patente_type");
  if (patenteType === "normal" || patenteType === "exenta") {
    values.push({ pdfField: "Tipo de Patente", type: "radio", value: patenteType === "exenta" ? "Exenta" : "Normal" });
  }
  if (patenteType === "exenta") {
    pushText(values, "Porciento Patente Exenta", textValue(data, "patente_exempt_percent"));
  }

  const tipoNegocio = PA02_TIPO_NEGOCIO[textValue(data, "business_type_pr")];
  if (tipoNegocio) values.push({ pdfField: "Tipo de Negocio", type: "radio", value: tipoNegocio });

  const filingYear = textValue(data, "filing_year");
  pushText(values, "Año Natural", filingYear);
  pushText(values, "Año", filingYear);

  if (data.uses_fiscal_year === true) {
    pushText(values, "Mes desde Rango", textValue(data, "fiscal_year_from_month"));
    pushText(values, "Año desde Rango", textValue(data, "fiscal_year_from_year"));
    pushText(values, "Mes hasta Rango", textValue(data, "fiscal_year_to_month"));
    pushText(values, "Año hasta Rango", textValue(data, "fiscal_year_to_year"));
  }

  return values;
}

export interface DirectOverlayValue {
  /** Matches a `pdfField` id in the form's mapping JSON, which supplies the placement. */
  pdfField: string;
  value: string;
  /** Prevent the raw value from being copied into population metadata. */
  sensitive?: boolean;
}

function pushOverlay(values: DirectOverlayValue[], pdfField: string, value: string, sensitive = false) {
  if (value) values.push({ pdfField, value, sensitive });
}

const NC001_MONTHS_ES: Record<string, string> = {
  "1": "enero", "2": "febrero", "3": "marzo", "4": "abril", "5": "mayo", "6": "junio",
  "7": "julio", "8": "agosto", "9": "septiembre", "10": "octubre", "11": "noviembre", "12": "diciembre",
};

/** "YYYY-MM-DD" -> "<mes> D, YYYY". Any other shape is passed through as typed. */
function nc001SpanishDate(raw: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) return raw;
  const [, year, month, day] = match;
  const monthName = NC001_MONTHS_ES[String(Number(month))] ?? month;
  return `${monthName} ${Number(day)}, ${year}`;
}

/**
 * NC001 (Solicitud de Registro de Nombre Comercial) fields answered on the
 * form itself: the trade name being registered, entity-kind mark, the
 * first-use-in-commerce declaration and date, the state/country of
 * organization or citizenship line, and the page-3 trade-name description —
 * none of these belong in the shared canonical business profile (a trade name
 * is the very thing being registered, not an existing profile fact).
 *
 * `pdfField` ids here are a contract with form-mappings/NC001.json: each one
 * must match a mapping row's `pdfField` so population.ts can find that row's
 * `placement`. Renaming an id on either side silently stops it reaching the
 * overlay — see nc001.e2e.test.ts, which reads values back out of the
 * generated PDF rather than trusting either side alone.
 */
function nc001Values(data: FormData): DirectOverlayValue[] {
  const values: DirectOverlayValue[] = [];

  pushOverlay(values, "trade_name", textValue(data, "trade_name"));
  pushOverlay(values, "state_or_country_or_citizenship", textValue(data, "state_or_country_or_citizenship"));
  pushOverlay(values, "words_claimed", textValue(data, "words_claimed"));
  pushOverlay(values, "disclaimer_non_registrable", textValue(data, "disclaimer_non_registrable"));
  const applicationDate = textValue(data, "application_date");
  if (applicationDate) pushOverlay(values, "application_date", nc001SpanishDate(applicationDate));

  const entityKind = textValue(data, "entity_kind");
  if (entityKind === "natural") pushOverlay(values, "entity_kind_natural_mark", "X");
  if (entityKind === "juridica") pushOverlay(values, "entity_kind_juridica_mark", "X");

  const usedSince = textValue(data, "used_since");
  if (usedSince === "yes") {
    pushOverlay(values, "used_since_mark", "X");
    pushOverlay(values, "used_since_date", nc001SpanishDate(textValue(data, "used_since_date")));
  } else if (usedSince === "no") {
    pushOverlay(values, "not_used_mark", "X");
  }

  return values;
}

/**
 * LUMAINT01 (Confirmación de Orientación al Cliente — interconexión de GD)
 * fields answered on the form itself: the LUMA account number, the installer
 * who gave the orientation, the applicable-regulation mark, and the project
 * details. The customer name, project address and signer address resolve from
 * the canonical profile via their mapping rows' canonicalField (generic
 * pass in population.ts) — they are not repeated here.
 *
 * `pdfField` ids here are a contract with form-mappings/LUMAINT01.json: each
 * one must match a mapping row's `pdfField` so population.ts can find that
 * row's `placement`. The customer_signature row is ownership "signature" and
 * is blocked from writing by the backstop in population.ts even if named here.
 */
function lumaInt01Values(data: FormData): DirectOverlayValue[] {
  const values: DirectOverlayValue[] = [];

  pushOverlay(values, "account_number", textValue(data, "account_number"));
  pushOverlay(values, "installer_name", textValue(data, "installer_name"));
  pushOverlay(values, "installer_company", textValue(data, "installer_company"));
  pushOverlay(values, "project_name", textValue(data, "project_name"));
  pushOverlay(values, "project_number", textValue(data, "project_number"));
  pushOverlay(values, "capacity_kw", textValue(data, "capacity_kw"));
  pushOverlay(values, "project_address_line2", textValue(data, "project_address_line2"));

  const signatureDate = textValue(data, "signature_date");
  if (signatureDate) pushOverlay(values, "signature_date", nc001SpanishDate(signatureDate));

  const regulation = textValue(data, "regulation");
  if (regulation === "distribution") pushOverlay(values, "regulation_distribution_mark", "X");
  if (regulation === "transmission") pushOverlay(values, "regulation_transmission_mark", "X");

  return values;
}

/**
 * Values collected by the schema-driven builder that do not belong in the
 * shared canonical business profile. Only known form codes are accepted; a
 * client cannot name arbitrary PDF fields.
 */
export function directOverlayValues(formCode: string, data: FormData | undefined): DirectOverlayValue[] {
  if (!data) return [];
  if (formCode === "NC001") return nc001Values(data);
  if (formCode === "LUMAINT01") return lumaInt01Values(data);
  return [];
}

/**
 * Values collected by the schema-driven builder that do not belong in the
 * shared canonical business profile. Only known form codes are accepted; a
 * client cannot name arbitrary PDF fields.
 */
export function directAcroValues(formCode: string, data: FormData | undefined): DirectAcroValue[] {
  if (!data) return [];
  if (formCode === "PA02") return pa02Values(data);
  if (formCode !== "SS4") return [];
  const values: DirectAcroValue[] = [];

  // Lines 1–7.
  pushText(values, field("f1_2[0]"), textValue(data, "legal_name"));
  pushText(values, field("f1_3[0]"), textValue(data, "trade_name"));
  pushText(values, field("f1_4[0]"), textValue(data, "care_of_name"));
  const [mailStreet, mailLocality] = addressLines(addressValue(data, "mailing_address"));
  pushText(values, field("Line4ReadOrder[0].f1_5[0]"), mailStreet);
  pushText(values, field("Line4ReadOrder[0].f1_6[0]"), mailLocality);
  if (data.street_address_different === true) {
    const [physicalStreet, physicalLocality] = addressLines(addressValue(data, "street_address"));
    pushText(values, field("f1_7[0]"), physicalStreet);
    pushText(values, field("f1_8[0]"), physicalLocality);
  } else {
    clearText(values, field("f1_7[0]"));
    clearText(values, field("f1_8[0]"));
  }
  pushText(values, field("f1_9[0]"), textValue(data, "principal_location"));
  pushText(values, field("f1_10[0]"), textValue(data, "responsible_party_name"));
  pushText(values, field("f1_11[0]"), textValue(data, "responsible_party_tin"), true);

  // Lines 8a–8c.
  const llc = textValue(data, "is_llc");
  setChoice(values, field("c1_1[0]"), llc === "yes");
  setChoice(values, field("c1_1[1]"), llc === "no");
  if (llc === "yes") {
    pushText(values, field("f1_12[0]"), textValue(data, "llc_member_count"));
    const domestic = textValue(data, "llc_organized_us");
    setChoice(values, field("c1_2[0]"), domestic === "yes");
    setChoice(values, field("c1_2[1]"), domestic === "no");
  } else {
    clearText(values, field("f1_12[0]"));
    setChoice(values, field("c1_2[0]"), false);
    setChoice(values, field("c1_2[1]"), false);
  }

  // Line 9a entity checkbox and its associated detail blank.
  const classification = textValue(data, "entity_classification");
  const entityBoxes: Record<string, number> = {
    sole_proprietor: 0, estate: 1, partnership: 2, plan_administrator: 3,
    corporation: 4, trust: 5, personal_service_corporation: 6, military: 7,
    state_local_government: 8, church: 9, farmers_cooperative: 10,
    federal_government: 11, nonprofit: 12, remic: 13, tribal_government: 14, other: 15,
  };
  for (let index = 0; index < 16; index += 1) {
    setChoice(values, field(`c1_3[${index}]`), entityBoxes[classification] === index);
  }
  pushText(values, field("f1_13[0]"), textValue(data, "sole_proprietor_tin"), true);
  pushText(values, field("f1_14[0]"), textValue(data, "estate_decedent_tin"), true);
  pushText(values, field("f1_15[0]"), textValue(data, "plan_administrator_tin"), true);
  pushText(values, field("f1_16[0]"), textValue(data, "corporation_return_form"));
  pushText(values, field("f1_17[0]"), textValue(data, "trust_grantor_tin"), true);
  pushText(values, field("f1_18[0]"), textValue(data, "nonprofit_type"));
  pushText(values, field("f1_19[0]"), textValue(data, "other_entity_type"));
  pushText(values, field("f1_20[0]"), textValue(data, "group_exemption_number"));
  if (["corporation", "personal_service_corporation"].includes(classification)) {
    const incorporationType = textValue(data, "incorporation_location_type");
    pushText(values, field("f1_21[0]"), incorporationType === "state" ? textValue(data, "incorporation_state") : "");
    pushText(values, field("f1_22[0]"), incorporationType === "foreign_country" ? textValue(data, "incorporation_foreign_country") : "");
  }

  // Lines 10–15.
  const reason = textValue(data, "reason_for_applying");
  const reasonBoxes: Record<string, number> = {
    started_new_business: 0, changed_organization: 1, purchased_business: 2,
    hired_employees: 3, created_trust: 4, withholding: 5,
    created_pension: 6, other: 7, banking: 8,
  };
  for (let index = 0; index < 9; index += 1) {
    setChoice(values, field(`c1_4[${index}]`), reasonBoxes[reason] === index);
  }
  const reasonDetailFields: Record<string, string> = {
    banking: "f1_24[0]", started_new_business: "f1_25[0]", changed_organization: "f1_27[0]",
    created_trust: "f1_28[0]", created_pension: "f1_29[0]", other: "f1_30[0]",
  };
  if (reasonDetailFields[reason]) pushText(values, field(reasonDetailFields[reason]), textValue(data, "reason_detail"));
  pushText(values, field("f1_31[0]"), textValue(data, "date_business_started"));
  pushText(values, field("f1_32[0]"), textValue(data, "closing_month"));
  pushText(values, field("f1_33[0]"), textValue(data, "agricultural_employee_count"));
  pushText(values, field("f1_34[0]"), textValue(data, "household_employee_count"));
  pushText(values, field("f1_35[0]"), textValue(data, "other_employee_count"));
  setChoice(values, field("c1_5[0]"), data.form_944_election === true);
  pushText(values, field("f1_36[0]"), textValue(data, "first_wage_date_or_na"));

  // Lines 16–18.
  const activity = textValue(data, "principal_activity_category");
  const activityBoxes: Record<string, number> = {
    health_care: 0, wholesale_agent: 1, construction: 2, rental_leasing: 3,
    transportation: 4, food_service: 5, wholesale_other: 6, retail: 7,
    real_estate: 8, manufacturing: 9, finance: 10, other: 11,
  };
  for (let index = 0; index < 12; index += 1) {
    setChoice(values, field(`c1_6[${index}]`), activityBoxes[activity] === index);
  }
  pushText(values, field("f1_37[0]"), textValue(data, "principal_activity_other"));
  pushText(values, field("f1_38[0]"), textValue(data, "principal_activity_line"));
  const prior = textValue(data, "previous_ein_received");
  setChoice(values, field("c1_7[0]"), prior === "yes");
  setChoice(values, field("c1_7[1]"), prior === "no");
  if (prior === "yes") pushText(values, field("f1_39[0]"), textValue(data, "previous_ein"), true);

  // Optional third-party designee and applicant contact block.
  if (textValue(data, "use_third_party_designee") === "yes") {
    pushText(values, field("f1_40[0]"), textValue(data, "designee_name"));
    pushText(values, field("f1_41[0]"), textValue(data, "designee_phone"));
    pushText(values, field("f1_42[0]"), textValue(data, "designee_address"));
    pushText(values, field("f1_43[0]"), textValue(data, "designee_fax"));
  }
  pushText(values, field("f1_44[0]"), textValue(data, "signer_name_and_title"));
  pushText(values, field("f1_45[0]"), textValue(data, "applicant_phone"));
  pushText(values, field("f1_46[0]"), textValue(data, "applicant_fax"));

  return values;
}
