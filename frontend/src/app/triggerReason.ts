/**
 * Render a municipality-flag engine trigger label
 * ("Municipality Flag = metro + Business Type = X", rulesEngine.ts) in user
 * vocabulary. Returns null when the reason is not a flag trigger.
 *
 * REG-TRIGGER-LABEL-001 (2026-09-21 QA): live filings showed the raw internal
 * string on DRNA/EPA cards (en-US) and translated jargon
 * ("Bandera de Municipio = ...") in Spanish. The flag name itself
 * ("metro", "industrial_port", ...) is internal KB vocabulary, so the label
 * names the municipality and business type instead — the same vocabulary the
 * guidance layer already uses for its "identified because" tags.
 */
export function translateFlagTriggerReason(
  reason: string,
  municipality: string,
  language: "en" | "es",
): string | null {
  const flagMatch = reason.match(/^Municipality Flag = (.+?)(?: \+ Business Type = (.+))?$/);
  if (!flagMatch) return null;
  const businessType = flagMatch[2];
  const muniPart = language === "es" ? `Municipio: ${municipality}` : `Municipality: ${municipality}`;
  const btPart = businessType
    ? language === "es"
      ? ` · Tipo de negocio: ${businessType}`
      : ` · Business type: ${businessType}`
    : "";
  return `${muniPart}${btPart}`;
}
