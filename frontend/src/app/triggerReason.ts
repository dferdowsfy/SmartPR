/**
 * Render a raw engine-generated trigger reason in user vocabulary.
 * Covers every engine reason shape emitted by rulesEngine.ts:
 * - "Municipality Flag = <flag> [+ Business Type = <bt>]" (flag rules)
 * - "Business Type = <bt>" (business-type rules)
 * - "Project fact: <key> = <value>" (project-fact rules)
 * - "Municipality selected (<name>)" (municipality-baseline rules)
 * Returns null when no translation applies (question triggers fall through
 * to the caller's i18n layer).
 *
 * REG-TRIGGER-LABEL-001 (2026-09-21 QA): live filings showed the raw
 * internal "Municipality Flag = metro + Business Type = X" string on
 * DRNA/EPA cards (en-US) and translated jargon ("Bandera de Municipio")
 * in Spanish. The flag name itself ("metro", "industrial_port", ...) is
 * internal KB vocabulary, so the label names the municipality and business
 * type instead — the same vocabulary the guidance layer already uses for
 * its "identified because" tags.
 *
 * REG-TRIGGER-LABEL-002 (2026-09-21 15:00 QA): the same defect class on the
 * remaining raw shapes — "Business Type = Beverage Manufacturing" on the
 * health and FDA cards, and "Project fact: project_type = renovation" on
 * the OGPe construction-permit card — both live-reproduced on a Guaynabo
 * brewery filing. Project-fact labels reuse the user-facing project-context
 * chip vocabulary ("Project: ...", "Structural work", ...); unknown
 * fact keys fall through (null) rather than inventing labels.
 *
 * REG-TRIGGER-LABEL-003 (2026-09-21 18:00 QA): the municipality-baseline
 * shape "Municipality selected (<name>)" rendered raw in en-US — the
 * SmartPRIntake i18n layer only translated it in the Spanish branch, so
 * English cards (EIN, Merchant Registration, Patente, Certificate of
 * Organization, Annual Report) showed the raw internal phrasing. It now
 * translates in the shared helper in both languages, consistent with the
 * municipality-flag vocabulary ("Municipality: X" / "Municipio: X").
 */
export function translateTriggerReason(
  reason: string,
  municipality: string,
  language: "en" | "es",
): string | null {
  const flagMatch = reason.match(/^Municipality Flag = (.+?)(?: \+ Business Type = (.+))?$/);
  if (flagMatch) {
    const businessType = flagMatch[2];
    const muniPart = language === "es" ? `Municipio: ${municipality}` : `Municipality: ${municipality}`;
    const btPart = businessType
      ? language === "es"
        ? ` · Tipo de negocio: ${businessType}`
        : ` · Business type: ${businessType}`
      : "";
    return `${muniPart}${btPart}`;
  }
  const btMatch = reason.match(/^Business Type = (.+)$/);
  if (btMatch) {
    return language === "es" ? `Tipo de negocio: ${btMatch[1]}` : `Business type: ${btMatch[1]}`;
  }
  const projectFactMatch = reason.match(/^Project fact: (.+?) = (.+)$/);
  if (projectFactMatch) {
    const label = PROJECT_FACT_LABELS[projectFactMatch[1]]?.[projectFactMatch[2]];
    if (!label) return null;
    return language === "es" ? label.es : label.en;
  }
  const muniMatch = reason.match(/^Municipality selected \((.+)\)$/);
  if (muniMatch) {
    return language === "es" ? `Municipio: ${muniMatch[1]}` : `Municipality: ${muniMatch[1]}`;
  }
  return null;
}

/** User-vocabulary labels for project-fact trigger reasons (EN/ES). */
const PROJECT_FACT_LABELS: Record<string, Record<string, { en: string; es: string }>> = {
  project_type: {
    renovation: { en: "Project: Renovation", es: "Proyecto: Remodelación" },
    new_construction: { en: "Project: New construction", es: "Proyecto: Nueva construcción" },
  },
  structural_work: {
    true: { en: "Structural work", es: "Trabajo estructural" },
  },
  construction_approvals_required: {
    true: { en: "Construction approvals required", es: "Se requieren aprobaciones de construcción" },
  },
  property_tenure: {
    leased: { en: "Leased property", es: "Propiedad arrendada" },
    owned: { en: "Owned property", es: "Propiedad propia" },
  },
  change_of_use: {
    true: { en: "Change of use", es: "Cambio de uso" },
  },
};

/**
 * Backwards-compatible alias for the municipality-flag-only shape.
 * Prefer translateTriggerReason for new call sites.
 */
export function translateFlagTriggerReason(
  reason: string,
  municipality: string,
  language: "en" | "es",
): string | null {
  if (!/^Municipality Flag = /.test(reason)) return null;
  return translateTriggerReason(reason, municipality, language);
}
