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

const PA01_TIPO_NEGOCIO: Record<string, string> = {
  individual: "Individuo",
  partnership: "Sociedad",
  corporation: "Corporación",
  disregarded: "Entidad Ignorada",
};

/**
 * PA01 (Declaración de Volumen de Negocios, OGP PA01 – REV FEBRERO 2025) fields
 * answered on the form itself rather than derived from the shared canonical
 * profile: the filing-year blanks, the amended/final checkboxes, the two
 * checkbox groups (Tipo de Patente, Tipo de Negocio), the exemption
 * percentage, the "Otros" specification and the fiscal-year designation the
 * filer confirms for this specific declaration.
 *
 * Unlike PA02's radio groups, PA01's choices are INDEPENDENT checkboxes in the
 * PDF, so each group writes exactly one checked box and explicitly unchecks
 * the rest — a stale answer (e.g. Exenta left over after switching to Normal)
 * can never survive on the printed form.
 *
 * The "Número de Seguro Social o Número de Identificación Patronal" blank is
 * shared: SmartPR prints the business EIN into it ONLY for Corporación and
 * Sociedad. For Individuo and Entidad Ignorada it stays blank on purpose so
 * the filer hand-writes their own social security number — SmartPR never
 * prints a person's government identifier.
 */
function pa01Values(data: FormData): DirectAcroValue[] {
  const values: DirectAcroValue[] = [];

  pushText(values, "Text1", textValue(data, "filing_year"));
  if (data.uses_fiscal_year === true) {
    pushText(values, "Text2", textValue(data, "fiscal_year_from_month"));
    pushText(values, "Text3", textValue(data, "fiscal_year_from_year"));
    pushText(values, "Text4", textValue(data, "fiscal_year_to_month"));
    pushText(values, "Text5", textValue(data, "fiscal_year_to_year"));
  }
  pushText(values, "Año Fiscal", textValue(data, "fiscal_year_designation"));

  setChoice(values, "Planilla Enmendada", data.amended_return === true);
  setChoice(values, "Planilla Final", data.final_return === true);

  const patenteType = textValue(data, "patente_type");
  setChoice(values, "Normal", patenteType === "normal");
  setChoice(values, "Exenta", patenteType === "exenta");
  setChoice(values, "Oficio", patenteType === "oficio");
  setChoice(values, "Otros", patenteType === "otros");
  if (patenteType === "exenta") {
    pushText(values, "Text6", textValue(data, "patente_exempt_percent"));
  }
  if (patenteType === "otros") {
    pushText(values, "Text7", textValue(data, "patente_type_other"));
  }

  const tipoNegocio = PA01_TIPO_NEGOCIO[textValue(data, "business_type_pr")];
  for (const box of Object.values(PA01_TIPO_NEGOCIO)) {
    setChoice(values, box, box === tipoNegocio);
  }

  // A corporation or partnership files under its own EIN. An individuo or
  // entidad ignorada files under the person's own social security number,
  // which SmartPR never stores or prints — the blank stays for hand entry.
  const businessType = textValue(data, "business_type_pr");
  if (businessType === "corporation" || businessType === "partnership") {
    pushText(values, "Número de Seguro Social o Número de Identificación Patronal", textValue(data, "employer_ein"));
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
 * AGRICORP01 (Solicitud Agricultor Bona Fide — Corporaciones, Sociedades
 * Especiales o Sucesiones, DA-OCAB-05 (Corporaciones), Rev. ABRIL 2021)
 * fields answered on the form itself rather than derived from the shared
 * canonical profile: the filing-kind mark, the requested year, the employer
 * identifier and foundation date, the non-canonical contact fields, the
 * section-6 member table, the business-type/employment answers, the three
 * finca blocks, the fishing and processor blocks, the section-13 income
 * narrative, and the signature date (split into the form's Día/Mes/Año
 * blanks — the signature line itself is hand-signed and never written).
 *
 * The employer identifier (employer_ssn) and the member SSNs are written to
 * the PDF marked `sensitive: true` — they print on the document, but the
 * population metadata records only "[provided]", never the raw number
 * (SS-4 precedent). This differs from the individuo variant (AGRIIND01),
 * whose SSN boxes stay blank and are hand-written.
 *
 * `pdfField` ids here are a contract with form-mappings/AGRICORP01.json:
 * each one must match a mapping row's `pdfField` so population.ts can find
 * that row's `placement`. Signature/notary/government_only rows are blocked
 * from writing by the backstop in population.ts even if named here.
 */
function agriBonafideCorpValues(data: FormData): DirectOverlayValue[] {
  const values: DirectOverlayValue[] = [];

  // Solicitud: renovación vs. caso nuevo.
  const casoTipo = textValue(data, "caso_tipo");
  if (casoTipo === "renovacion") pushOverlay(values, "renovacion_mark", "X");
  if (casoTipo === "caso_nuevo") pushOverlay(values, "caso_nuevo_mark", "X");
  pushOverlay(values, "anio_solicitado", textValue(data, "anio_solicitado"));

  // Entidad: datos que no vienen del perfil canónico.
  pushOverlay(values, "employer_ssn", textValue(data, "employer_ssn"), true);
  const foundation = textValue(data, "foundation_date");
  if (foundation) pushOverlay(values, "foundation_date", nc001SpanishDate(foundation));
  pushOverlay(values, "cell", textValue(data, "cell"));
  pushOverlay(values, "fax", textValue(data, "fax"));

  // Sección 6: socios, miembros o beneficiarios (6 renglones impresos).
  for (let n = 1; n <= 6; n++) {
    pushOverlay(values, `member_${n}_name`, textValue(data, `member_${n}_name`));
    pushOverlay(values, `member_${n}_ssn`, textValue(data, `member_${n}_ssn`), true);
  }

  // Tipo de empresa y empleo (secciones 7–9).
  const tipoEmpresa = textValue(data, "tipo_empresa");
  if (tipoEmpresa === "negocio_nuevo") pushOverlay(values, "negocio_nuevo_mark", "X");
  if (tipoEmpresa === "negocio_existente") pushOverlay(values, "negocio_existente_mark", "X");
  for (const id of [
    "empleo_nuevo_nuevos", "empleo_nuevo_actuales", "empleo_nuevo_fijos", "empleo_nuevo_temporeros",
    "empleo_exist_nuevos", "empleo_exist_actuales", "empleo_exist_fijos", "empleo_exist_temporeros",
    "inversion_presente_anio",
  ]) {
    pushOverlay(values, id, textValue(data, id));
  }

  // Sección 10: fincas (a), (b) y (c).
  for (const prefix of ["finca_a", "finca_b", "finca_c"]) {
    for (const id of [
      "carr", "km", "hm", "bo", "sector", "municipio", "catastro", "cuerdas",
      "propias", "usufructos", "arrendadas",
    ]) {
      pushOverlay(values, `${prefix}_${id}`, textValue(data, `${prefix}_${id}`));
    }
    for (const id of ["fecha_adquisicion", "fecha_otorgacion", "fecha_vencimiento"]) {
      const raw = textValue(data, `${prefix}_${id}`);
      if (raw) pushOverlay(values, `${prefix}_${id}`, nc001SpanishDate(raw));
    }
    for (let row = 1; row <= 3; row++) {
      for (const id of ["negocio", "cuerdas", "produccion", "desarrollo"]) {
        pushOverlay(values, `${prefix}_r${row}_${id}`, textValue(data, `${prefix}_r${row}_${id}`));
      }
    }
  }

  // Sección 11: pesca marítima comercial.
  pushOverlay(values, "pesca_licencia_drna", textValue(data, "pesca_licencia_drna"));
  pushOverlay(values, "pesca_registro_embarcacion", textValue(data, "pesca_registro_embarcacion"));
  if (data.pesca_estadisticas === true) pushOverlay(values, "pesca_estadisticas_mark", "X");
  for (let row = 1; row <= 3; row++) {
    for (const id of ["negocio", "clase", "produccion", "salidas"]) {
      pushOverlay(values, `pesca_r${row}_${id}`, textValue(data, `pesca_r${row}_${id}`));
    }
  }

  // Sección 12: planta elaboradora.
  for (const id of [
    "elab_planta_bo", "elab_planta_carr", "elab_planta_km", "elab_planta_hm",
    "elab_municipio", "elab_cuerdas", "elab_catastro", "elab_tenencia_legal",
    "elab_declaracion_jurada",
  ]) {
    pushOverlay(values, id, textValue(data, id));
  }
  for (let row = 1; row <= 4; row++) {
    for (const id of ["subproducto", "agricultor", "producto", "desarrollo"]) {
      pushOverlay(values, `elab_r${row}_${id}`, textValue(data, `elab_r${row}_${id}`));
    }
  }

  // Sección 13: ingresos no agrícolas o no elegibles (narrativa de 15 líneas).
  pushOverlay(values, "ingresos_no_agricolas", textValue(data, "ingresos_no_agricolas"));

  // Fecha de la firma, dividida en los blancos Día/Mes/Año del formulario.
  const signing = textValue(data, "signature_date");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(signing);
  if (m) {
    pushOverlay(values, "firma_fecha_dia", String(Number(m[3])));
    pushOverlay(values, "firma_fecha_mes", m[2]);
    pushOverlay(values, "firma_fecha_anio", m[1]);
  } else if (signing) {
    pushOverlay(values, "firma_fecha_dia", signing);
  }

  return values;
}

/**
 * Values collected by the schema-driven builder that do not belong in the
 * shared canonical business profile. Only known form codes are accepted; a
 * client cannot name arbitrary PDF fields.
 */
/**
 * DACOUC01 (Solicitud de Licencia para Urbanizador y/o Constructor, DACO
 * Rev. Ene 2019 v2) fields answered on the form itself: the two license
 * checkbox rows (kind of request + license class), the activity-type mark
 * and the organization-type mark. The applicant name, phone and both
 * addresses resolve from the canonical profile via their mapping rows'
 * canonicalField (generic pass in population.ts) — they are not repeated
 * here.
 *
 * `pdfField` ids here are a contract with DACOUC01_OVERLAY in overlayMaps.ts:
 * each one must match a mapping row's `pdfField` so population.ts can find
 * that row's `placement`. Renaming an id on either side silently stops it
 * reaching the overlay. There is no signature/notary row in the overlay map
 * at all — pages 8–9 are sworn/notarized by hand and stay blank by
 * construction, and the backstop in population.ts blocks ownership
 * "signature"/"notary" rows even if named here.
 */
function dacoUc01Values(data: FormData): DirectOverlayValue[] {
  const values: DirectOverlayValue[] = [];

  const licenseRequest = textValue(data, "license_request");
  if (licenseRequest === "provisional") pushOverlay(values, "license_provisional_mark", "X");
  if (licenseRequest === "renovacion") pushOverlay(values, "license_renovacion_mark", "X");
  if (licenseRequest === "ambos") pushOverlay(values, "license_ambos_mark", "X");

  const licenseClass = textValue(data, "license_class");
  if (licenseClass === "regular") pushOverlay(values, "license_regular_mark", "X");
  if (licenseClass === "provisional") pushOverlay(values, "license_class_provisional_mark", "X");

  const activityType = textValue(data, "activity_type");
  if (activityType === "constructor") pushOverlay(values, "activity_constructor_mark", "X");
  if (activityType === "urbanizador") pushOverlay(values, "activity_urbanizador_mark", "X");
  if (activityType === "ambos") pushOverlay(values, "activity_ambos_mark", "X");
  if (activityType === "otro") {
    pushOverlay(values, "activity_otros_mark", "X");
    pushOverlay(values, "activity_otros_text", textValue(data, "activity_otros_text"));
  }

  const orgType = textValue(data, "org_type");
  if (orgType === "individuo") pushOverlay(values, "org_individuo_mark", "X");
  if (orgType === "sociedad") pushOverlay(values, "org_sociedad_mark", "X");
  if (orgType === "corporacion") pushOverlay(values, "org_corporacion_mark", "X");
  if (orgType === "sociedad_especial") pushOverlay(values, "org_sociedad_especial_mark", "X");

  return values;
}

export function directOverlayValues(formCode: string, data: FormData | undefined): DirectOverlayValue[] {
  if (!data) return [];
  if (formCode === "NC001") return nc001Values(data);
  if (formCode === "LUMAINT01") return lumaInt01Values(data);
  if (formCode === "DACOUC01") return dacoUc01Values(data);
  if (formCode === "AGRICORP01") return agriBonafideCorpValues(data);
  return [];
}

/**
 * AGRIIND01 (Solicitud Agricultor Bona Fide — Para Individuos, DA-OCAB-05,
 * Rev. ABRIL 2021) fields answered on the form itself: the filing-kind and
 * year marks, the farmer's personal details (sex, marital status, birth
 * date, residential address, phones, occupation, experience), the spouse
 * block, the new/existing business employment breakdown and investment, the
 * finca(s) location and cuerdas tables, fishing activities, and the
 * processing plant. The farmer's name, postal address, phone, email and the
 * finca/plant municipios resolve from the canonical profile via their
 * mapping rows' canonicalField (generic pass in population.ts) — they are
 * not repeated here.
 *
 * The three SSN boxes, the farmer's signature line, and the entire agency
 * side (section 23: 14a/14b, recommendations, Cumple/No Cumple, agronomist
 * signature; section 24: regional director) are never named here — see
 * form-mappings/AGRIIND01.json ownership and the backstop in population.ts.
 *
 * `pdfField` ids here are a contract with form-mappings/AGRIIND01.json: each
 * one must match a mapping row's `pdfField` so population.ts applies the
 * backstop correctly. Renaming an id on either side silently stops it
 * reaching the PDF — see agriind01.e2e.test.ts, which reads values back out
 * of the generated PDF rather than trusting either side alone.
 */
function agriBonafideIndividuoValues(data: FormData): DirectAcroValue[] {
  const values: DirectAcroValue[] = [];

  const AGRI_FINCA_TABLE =
    "Negocio Agrícola Cantidad de cuerdas Producción Anual Estimada " +
    "Arrobas libras mazos millares becerros cuartillos Nivel de desarrollo " +
    "en la Finca Describa las condiciones de los negocios en la finca";
  const AGRI_PESCA_TABLE =
    "Negocio Agrícola Clase de Pescado o Marisco Producción Anual Estimada " +
    "Libras de Pescado Marisco Anual Información sobre las Salidas Alta Mar " +
    "Lugar de Desembarco Acompañantes Embarcación entre otras";
  const AGRI_PLANTA_TABLE =
    "Nombre de los Subproductos que Elabora Nombre y Dirección de los " +
    "Agricultores compra materia prima Indique el Producto Agrícola de PR " +
    "y la Cantidad que le compra al agricultor Nivel de desarrollo de la " +
    "Planta Elaboradora";

  // Solicitud: caso nuevo vs. renovación (mark boxes) and the requested year.
  const filingKind = textValue(data, "filing_kind");
  values.push({ pdfField: "RENOVACIÓN", type: "text", value: filingKind === "renovacion" ? "X" : "" });
  values.push({ pdfField: "CASO NUEVO", type: "text", value: filingKind === "caso_nuevo" ? "X" : "" });
  pushText(values, "AÑO SOLICITADO", textValue(data, "filing_year"));

  // Datos del agricultor.
  pushText(values, "3 Sexo", textValue(data, "sexo"));
  pushText(values, "Estado Civil", textValue(data, "estado_civil"));
  const birthDate = textValue(data, "fecha_nacimiento");
  if (birthDate) pushText(values, "4 Fecha de nacimiento", nc001SpanishDate(birthDate));
  const [resStreet, resLocality] = addressLines(addressValue(data, "direccion_residencial"));
  pushText(values, "6 Dirección Residencial 1", resStreet);
  pushText(values, "6 Dirección Residencial 2", resLocality);
  pushText(values, "Celular", textValue(data, "celular"));
  pushText(values, "Fax", textValue(data, "fax"));
  pushText(values, "8 Ocupación", textValue(data, "ocupacion"));
  pushText(values, "9 Experiencia Agrícola años", textValue(data, "experiencia_anos"));

  // Cónyuge (collected only when estado civil = Casado).
  pushText(values, "Nombre del Cónyuge", textValue(data, "conyuge_nombre"));
  pushText(values, "Ocupación", textValue(data, "conyuge_ocupacion"));
  pushText(values, "Sexo", textValue(data, "conyuge_sexo"));
  const spouseBirth = textValue(data, "conyuge_fecha_nacimiento");
  if (spouseBirth) pushText(values, "Fecha de Nacimiento", nc001SpanishDate(spouseBirth));
  pushText(values, "Patrono", textValue(data, "conyuge_patrono"));
  pushText(values, "Ingreso Anual cónyuge", textValue(data, "conyuge_ingreso_anual"));

  // Tipo de empresa y empleo.
  const businessKind = textValue(data, "business_kind");
  values.push({ pdfField: "16Negocio Nuevo", type: "text", value: businessKind === "nuevo" ? "X" : "" });
  values.push({ pdfField: "17Negocio Existente", type: "text", value: businessKind === "existente" ? "X" : "" });
  if (businessKind === "nuevo") {
    pushText(values, "1 Nuevos a crearse", textValue(data, "nuevo_empleos_nuevos"));
    pushText(values, "2 Actuales", textValue(data, "nuevo_empleos_actuales"));
    pushText(values, "Fijos", textValue(data, "nuevo_empleos_fijos"));
    pushText(values, "Temporeros", textValue(data, "nuevo_empleos_temporeros"));
  }
  if (businessKind === "existente") {
    pushText(values, "1 Nuevos a crearse_2", textValue(data, "existente_empleos_nuevos"));
    pushText(values, "2 Actuales_2", textValue(data, "existente_empleos_actuales"));
    pushText(values, "Fijos_2", textValue(data, "existente_empleos_fijos"));
    pushText(values, "Temporeros_2", textValue(data, "existente_empleos_temporeros"));
  }
  pushText(values, "18Inversión en Negocio Presente Año", textValue(data, "inversion_actual"));

  // Finca 19(a).
  pushText(values, "19aLocalización de la Finca Núm de Carr", textValue(data, "finca1_carretera"));
  pushText(values, "Hm", textValue(data, "finca1_hm"));
  pushText(values, "Bo", textValue(data, "finca1_barrio"));
  pushText(values, "Sector", textValue(data, "finca1_sector"));
  pushText(values, "Núm Catastro de estar disponible", textValue(data, "finca1_catastro"));
  pushText(values, "Cantidad de Cuerdas", textValue(data, "finca1_cuerdas_total"));
  pushText(values, "Propias", textValue(data, "finca1_cuerdas_propias"));
  const acquired = textValue(data, "finca1_fecha_adquisicion");
  if (acquired) pushText(values, "Fecha en que se adquirió", nc001SpanishDate(acquired));
  pushText(values, "Usufructos", textValue(data, "finca1_cuerdas_usufructo"));
  const granted = textValue(data, "finca1_fecha_otorgacion");
  if (granted) pushText(values, "Fecha de otorgación", nc001SpanishDate(granted));
  pushText(values, "Arrendadas", textValue(data, "finca1_cuerdas_arrendadas"));
  const expires = textValue(data, "finca1_fecha_vencimiento");
  if (expires) pushText(values, "Fecha de vencimiento", nc001SpanishDate(expires));
  pushText(values, `${AGRI_FINCA_TABLE}Row1`, textValue(data, "finca1_negocios_row1"));
  pushText(values, `${AGRI_FINCA_TABLE}Row2`, textValue(data, "finca1_negocios_row2"));
  pushText(values, `${AGRI_FINCA_TABLE}Row3`, textValue(data, "finca1_negocios_row3_negocio"));
  pushText(values, `${AGRI_FINCA_TABLE}Row3_2`, textValue(data, "finca1_negocios_row3_cuerdas"));
  pushText(values, `${AGRI_FINCA_TABLE}Row3_3`, textValue(data, "finca1_negocios_row3_produccion"));
  pushText(values, `${AGRI_FINCA_TABLE}Row3_4`, textValue(data, "finca1_negocios_row3_nivel"));

  // Finca 19(b) — only when the applicant reports a second farm.
  if (data.tiene_segunda_finca === true) {
    pushText(values, "Hm_2", textValue(data, "finca2_hm"));
    pushText(values, "Bo_2", textValue(data, "finca2_barrio"));
    pushText(values, "Sector_2", textValue(data, "finca2_sector"));
    pushText(values, "Núm Catastro de estar disponible_2", textValue(data, "finca2_catastro"));
    pushText(values, "Cantidad de Cuerdas_2", textValue(data, "finca2_cuerdas_total"));
    pushText(values, "Propias_2", textValue(data, "finca2_cuerdas_propias"));
    const acquired2 = textValue(data, "finca2_fecha_adquisicion");
    if (acquired2) pushText(values, "Fecha en que se adquirió_2", nc001SpanishDate(acquired2));
    pushText(values, "Usufructos_2", textValue(data, "finca2_cuerdas_usufructo"));
    const granted2 = textValue(data, "finca2_fecha_otorgacion");
    if (granted2) pushText(values, "Fecha de otorgación_2", nc001SpanishDate(granted2));
    pushText(values, "Arrendadas_2", textValue(data, "finca2_cuerdas_arrendadas"));
    const expires2 = textValue(data, "finca2_fecha_vencimiento");
    if (expires2) pushText(values, "Fecha de vencimiento_2", nc001SpanishDate(expires2));
    pushText(values, `${AGRI_FINCA_TABLE}Row1_2`, textValue(data, "finca2_negocios_row1"));
    pushText(values, `${AGRI_FINCA_TABLE}Row2_2`, textValue(data, "finca2_negocios_row2"));
    pushText(values, `${AGRI_FINCA_TABLE}Row3_5`, textValue(data, "finca2_negocios_row3_negocio"));
    pushText(values, `${AGRI_FINCA_TABLE}Row3_6`, textValue(data, "finca2_negocios_row3_cuerdas"));
    pushText(values, `${AGRI_FINCA_TABLE}Row3_7`, textValue(data, "finca2_negocios_row3_produccion"));
    pushText(values, `${AGRI_FINCA_TABLE}Row3_8`, textValue(data, "finca2_negocios_row3_nivel"));
  }

  // Actividades pesqueras (20).
  if (data.realiza_pesca === true) {
    pushText(values, "Licencia de Pescador Comercial del DRNA", textValue(data, "pesca_licencia_drna"));
    pushText(values, "Registro de Embarcación del DRNA", textValue(data, "pesca_registro_embarcacion"));
    pushText(values, "Laboratorio de Investigaciones Pesqueras", textValue(data, "pesca_libras_estadisticas"));
    pushText(values, `${AGRI_PESCA_TABLE}Row1`, textValue(data, "pesca_row1"));
    pushText(values, `${AGRI_PESCA_TABLE}Row2`, textValue(data, "pesca_negocio"));
    pushText(values, `${AGRI_PESCA_TABLE}Row2_2`, textValue(data, "pesca_clase"));
    pushText(values, `${AGRI_PESCA_TABLE}Row2_3`, textValue(data, "pesca_produccion"));
    pushText(values, `${AGRI_PESCA_TABLE}Row2_4`, textValue(data, "pesca_info_salidas"));
  }

  // Planta elaboradora (21).
  if (data.tiene_planta === true) {
    pushText(values, "Localización de la Planta de Elaboración", textValue(data, "planta_localizacion"));
    pushText(values, "Cantidad de Cuerdas_3", textValue(data, "planta_cuerdas"));
    pushText(values, "Tenencia Legal", textValue(data, "planta_tenencia"));
    pushText(values, `${AGRI_PLANTA_TABLE}Row1`, textValue(data, "planta_subproductos_row1"));
    pushText(values, `${AGRI_PLANTA_TABLE}Row2`, textValue(data, "planta_subproductos_row2"));
    pushText(values, `${AGRI_PLANTA_TABLE}Row3`, textValue(data, "planta_subproductos_row3_nombre"));
    pushText(values, `${AGRI_PLANTA_TABLE}Row3_2`, textValue(data, "planta_subproductos_row3_agricultores"));
    pushText(values, `${AGRI_PLANTA_TABLE}Row3_3`, textValue(data, "planta_subproductos_row3_producto"));
    pushText(values, `${AGRI_PLANTA_TABLE}Row3_4`, textValue(data, "planta_subproductos_row3_nivel"));
  }

  return values;
}

const CBP301_P = "topmostSubform[0].Page1[0].";
const cbp = (name: string) => `${CBP301_P}${name}`;

/**
 * CBP Form 301 (Customs Bond) — activity checkbox ⇄ limit-of-liability pairing,
 * verified by widget-rect proximity against the PDF's own text layer:
 * activity "1" pairs with code1[0]/LimitofLiability1[0], "1a" with
 * code1a[0]/LimitofLiability2[0], and 15/16/17 pair with
 * LimitofLiability16/17/18[0] (there is no LimitofLiability15). See
 * form-mappings/CBP301.json for the full per-field record.
 */
const CBP301_ACTIVITY_FIELDS: Record<string, { checkbox: string; liability: string }> = {
  "1": { checkbox: "code1[0]", liability: "LimitofLiability1[0]" },
  "1a": { checkbox: "code1a[0]", liability: "LimitofLiability2[0]" },
  "2": { checkbox: "code2[0]", liability: "LimitofLiability3[0]" },
  "3": { checkbox: "code3[0]", liability: "LimitofLiability4[0]" },
  "3a": { checkbox: "code3a[0]", liability: "LimitofLiability5[0]" },
  "4": { checkbox: "code4[0]", liability: "LimitofLiability6[0]" },
  "5": { checkbox: "code5[0]", liability: "LimitofLiability7[0]" },
  "6": { checkbox: "code6[0]", liability: "LimitofLiability8[0]" },
  "7": { checkbox: "code7[0]", liability: "LimitofLiability9[0]" },
  "8": { checkbox: "code8[0]", liability: "LimitofLiability10[0]" },
  "9": { checkbox: "code9[0]", liability: "LimitofLiability11[0]" },
  "10": { checkbox: "code10[0]", liability: "LimitofLiability12[0]" },
  "11": { checkbox: "code11[0]", liability: "LimitofLiability13[0]" },
  "12": { checkbox: "code12[0]", liability: "LimitofLiability14[0]" },
  "15": { checkbox: "code15[0]", liability: "LimitofLiability16[0]" },
  "16": { checkbox: "code16[0]", liability: "LimitofLiability17[0]" },
  "17": { checkbox: "code17[0]", liability: "LimitofLiability18[0]" },
};

/**
 * CBP Form 301 (Customs Bond) fields answered on the form itself rather than
 * derived from the shared canonical profile: the Section I bond-type boxes and
 * their date/id blanks, the Section II activity choice (exactly one box — the
 * form says "Check one box only", so every other box is explicitly unchecked
 * and stale liability amounts on unselected activities are cleared), the
 * principal identity block (name + physical address composed into the PDF's
 * single "Name and Physical Address" field from the prefilled form answers —
 * this overwrites the mapping's canonical legal-name pass by design), the
 * importer's CBP identification number, and the surety identity basics.
 *
 * Never written here: both signature lines (ownership: "signature"), the CBP-
 * assigned bond number (ownership: "government_only"), the seal-declaration
 * checkboxes, the surety-requested mailing address, and the page-2
 * co-principal / co-surety / Section III trade-name blocks — those are the
 * filer, broker or surety's own acts.
 */
function cbp301Values(data: FormData): DirectAcroValue[] {
  const values: DirectAcroValue[] = [];

  pushText(values, cbp("executiondate[0]"), textValue(data, "execution_date"));

  // Section I — single transaction OR continuous bond, never both.
  const bondType = textValue(data, "bond_type");
  setChoice(values, cbp("single[0]"), bondType === "single");
  setChoice(values, cbp("continuous[0]"), bondType === "continuous");
  if (bondType === "single") {
    pushText(values, cbp("id100[0]"), textValue(data, "transaction_id"));
    pushText(values, cbp("transactiondate[0]"), textValue(data, "transaction_date"));
    pushText(values, cbp("PortCode[0]"), textValue(data, "port_code"));
  }
  if (bondType === "continuous") {
    pushText(values, cbp("Dateeffective[0]"), textValue(data, "effective_date"));
  }

  // Section II — one activity box only.
  const activity = CBP301_ACTIVITY_FIELDS[textValue(data, "activity_code")];
  for (const fields of Object.values(CBP301_ACTIVITY_FIELDS)) {
    setChoice(values, cbp(fields.checkbox), fields === activity);
  }
  for (const fields of Object.values(CBP301_ACTIVITY_FIELDS)) {
    if (fields === activity) pushText(values, cbp(fields.liability), textValue(data, "limit_of_liability"));
    else clearText(values, cbp(fields.liability));
  }

  // Principal (importer) identity — composed into the single "Name and
  // Physical Address" field from the prefilled form answers.
  const [principalStreet, principalLocality] = addressLines(addressValue(data, "principal_address"));
  pushText(
    values,
    cbp("nameaddress[0]"),
    [textValue(data, "principal_name"), principalStreet, principalLocality].filter(Boolean).join("\n")
  );
  pushText(values, cbp("CBPIdentificationNumber[0]"), textValue(data, "importer_cbp_id"));
  pushText(values, cbp("Broker[0]"), textValue(data, "broker_filer_code"));
  pushText(values, cbp("SuretyReferenceNumber[0]"), textValue(data, "surety_reference_number"));

  // Surety identity basics — the surety (or the broker arranging the bond)
  // completes its own section; SmartPR prints only what the applicant supplied.
  const [suretyStreet, suretyLocality] = addressLines(addressValue(data, "surety_address"));
  pushText(
    values,
    cbp("namephysical[0]"),
    [textValue(data, "surety_name"), suretyStreet, suretyLocality].filter(Boolean).join("\n")
  );
  pushText(values, cbp("SuretyNumber[0]"), textValue(data, "surety_number"));

  return values;
}

/**
 * EPA Form 3510-1 (NPDES General Information, EPAFORM1) — applicant-owned
 * answers written into the official PDF's native AcroForm fields.
 *
 * The facility header, contact block, operator block, and nature-of-business
 * text resolve from the canonical profile via their mapping rows'
 * canonicalField (generic pass in population.ts) — they are not repeated
 * here. What cannot be written at all is documented in
 * form-mappings/EPAFORM1.json and the definition notices:
 *   * Every Yes/No and multi-option radio (Section 1 screening, 4.2, 4.3
 *     operator status, 5.1 Indian land, 7.1 map, 9.1 cooling water). The
 *     Yes/No pairs share one field name per pair in a checkbox construct
 *     the PDF library cannot address separately — the filer marks them by
 *     hand on the printed form.
 *   * Section 10 variance requests and the Section 11.1 checklist.
 *   * The Section 11.2 certification block — name, title, date, signature
 *     (EPA accepts no electronic signatures on this form).
 *
 * `pdfField` ids here are a contract with form-mappings/EPAFORM1.json: each
 * one must match a mapping row's `pdfField` so population.ts applies the
 * backstop correctly. Renaming an id on either side silently stops it
 * reaching the PDF — see epaform1.e2e.test.ts, which reads values back out
 * of the generated PDF rather than trusting either side alone.
 */
function epaForm1Values(data: FormData): DirectAcroValue[] {
  const values: DirectAcroValue[] = [];

  // Section 2.2 / 2.4 header identifiers — blank is legitimate for a
  // first-time applicant, so empty values simply leave the boxes blank.
  pushText(values, "EPA Identification Number", textValue(data, "epa_id_number"));
  pushText(values, "NPDES Permit Number", textValue(data, "npdes_permit_number"));

  // Sections 3.1–3.2: SIC / NAICS.
  pushText(values, "SIC Codes31", textValue(data, "sic_code_1"));
  pushText(values, "Description optional31", textValue(data, "sic_desc_1"));
  pushText(values, "SIC Codes31_2", textValue(data, "sic_code_2"));
  pushText(values, "Description optional31_2", textValue(data, "sic_desc_2"));
  pushText(values, "NAICS Codes32", textValue(data, "naics_code_1"));
  pushText(values, "Description optional32", textValue(data, "naics_desc_1"));
  pushText(values, "NAICS Codes32_2", textValue(data, "naics_code_2"));
  pushText(values, "Description optional32_2", textValue(data, "naics_desc_2"));

  // Split address components — the PDF has separate street / city / state /
  // ZIP boxes; a multiline string would overflow them.
  const splitAddress = (fieldId: string, streetPdf: string, cityPdf: string, statePdf: string, zipPdf: string) => {
    const a = addressValue(data, fieldId);
    if (!a) return;
    pushText(values, streetPdf, [a.line1, a.line2].filter(Boolean).join(", "));
    pushText(values, cityPdf, a.cityOrMunicipality ?? "");
    pushText(values, statePdf, a.stateOrTerritory ?? "");
    pushText(values, zipPdf, a.postalCode ?? "");
  };
  splitAddress("mailing_address", "Street or PO box", "City or town", "State", "ZIP code");
  splitAddress("location_address", "Street route number or other specific identifier", "City or town_2", "State_2", "ZIP code_2");
  splitAddress("operator_address", "Street or PO Box", "City or town_3", "State_3", "ZIP code_3");

  // Section 6: entering a permit number checks the matching box; all eight
  // boxes are native PDFCheckBox widgets and addressable by pdf-lib.
  const existingPermits: Array<[string, string, string]> = [
    ["existing_npdes_number", "NPDES discharges to surface", "water"],
    ["existing_rcra_number", "RCRA", "RCRA hazardous wastes"],
    ["existing_uic_number", "UIC underground", "fluids"],
    ["existing_psd_number", "PSD", "PSD air emissions"],
    ["existing_nonattainment_number", "Nonattainment", "Nonattainment program CAA"],
    ["existing_neshaps_number", "NESHAPs", "NESHAPs CAA"],
    ["existing_ocean_dumping_number", "Ocean dumping", "Ocean dumping MPRSA"],
    ["existing_dredge_number", "Dredge", "Dredge or fill CWA Sect"],
  ];
  for (const [schemaId, boxPdf, numberPdf] of existingPermits) {
    const num = textValue(data, schemaId);
    if (num.length > 0) {
      setChoice(values, boxPdf, true);
      pushText(values, numberPdf, num);
    } else {
      setChoice(values, boxPdf, false);
    }
  }

  // Section 9.2: only a free-text source — the 9.1 yes/no is hand-marked.
  pushText(values, "Identify the source of cooling water", textValue(data, "cooling_water_source"));

  return values;
}

/**
 * EPA Form 3510-2C (NPDES existing discharger application, EPAFORM2C) —
 * applicant-owned answers written into the official PDF's native AcroForm
 * fields.
 *
 * Scope is deliberately narrow: the running header, EPA/permit numbers, and
 * the Section 1.1 outfall basics for the first two outfalls. Everything from
 * Section 7 on (effluent characteristics) is quantitative lab data the
 * applicant's engineer completes by hand; the latitude/longitude boxes share
 * one field name per row and cannot be written separately; the screening
 * checkboxes on pages 16–19 are anonymous widgets the PDF library cannot
 * address; and the Section 12.2 certification block is hand-signed (EPA
 * accepts no electronic signatures). See form-mappings/EPAFORM2C.json.
 */
function epaForm2cValues(data: FormData): DirectAcroValue[] {
  const values: DirectAcroValue[] = [];

  pushText(values, "EPA Identification Number", textValue(data, "epa_id_number"));
  pushText(values, "NPDES Permit Number", textValue(data, "npdes_permit_number"));
  pushText(values, "Outfall Number11", textValue(data, "outfall_1_number"));
  pushText(values, "Receiving Water Name11", textValue(data, "outfall_1_receiving_water"));
  pushText(values, "Outfall Number11_2", textValue(data, "outfall_2_number"));
  pushText(values, "Receiving Water Name11_2", textValue(data, "outfall_2_receiving_water"));

  return values;
}

/**
 * Values collected by the schema-driven builder that do not belong in the
 * shared canonical business profile. Only known form codes are accepted; a
 * client cannot name arbitrary PDF fields.
 */
export function directAcroValues(formCode: string, data: FormData | undefined): DirectAcroValue[] {
  if (!data) return [];
  if (formCode === "PA02") return pa02Values(data);
  if (formCode === "PA01") return pa01Values(data);
  if (formCode === "AGRIIND01") return agriBonafideIndividuoValues(data);
  if (formCode === "CBP301") return cbp301Values(data);
  if (formCode === "EPAFORM1") return epaForm1Values(data);
  if (formCode === "EPAFORM2C") return epaForm2cValues(data);
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
