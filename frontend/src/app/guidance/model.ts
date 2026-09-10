// Published document-node content. No AI generation and no obligation matching.
export type LocalizedText = { en: string; es: string };
export type GuidanceFactKey = "Q_ALCOHOL_SOLD" | "Q_PHYSICAL_LOCATION" | "Q_EMPLOYEES_HIRED" | "Q_EXISTING_LEASE" | "Q_FOOD_PREPARED" | "Q_FOOD_SOLD" | "Q_CUSTOMERS_VISIT" | "Q_RENEWABLE_INSTALL" | "Q_SOLAR_MOUNTING" | "Q_SOLAR_SIZE" | "Q_SOLAR_OWNERSHIP" | "entityType" | "municipality" | "businessType";
export interface GuidanceCondition {
  key: GuidanceFactKey;
  equals?: string | boolean;
  /** A condition's display text is authored with the regulatory concept. */
  label: LocalizedText;
}
export interface GuidanceSource {
  id: string;
  agency: string;
  citation: string;
  url: string;
  lastVerified: string;
  sourceVersion: string;
  /** The specific source proposition supporting the guidance, not a homepage. */
  supports: string;
}
export interface GuidanceConcept {
  requirementId: string;
  version: string;
  validationStatus: "validated" | "needs_review";
  /** Reviewed subject vocabulary; guards against title-swapped/template copy. */
  subjectTerms: { en: string[]; es: string[] };
  /** OR of AND groups; these explain an existing match, never add requirements. */
  conditions: GuidanceCondition[][];
  regulatoryReason: LocalizedText;
  purpose: LocalizedText;
  nextAction: LocalizedText;
  consequenceOrNextStep: LocalizedText;
  dependencies: string[];
  conditionalDependencies?: { entityType: string; documentId: string }[];
  sources: GuidanceSource[];
}

const GENERIC = /applies based on what SmartPR knows|issued or required by|is required by|keeps? (your |the )?(business |compliance profile )?(compliant|current)|keeps? you compliant|guide you through the exact steps|comply with local regulations|keep it on file|mantiene tu perfil de cumplimiento|emitido o requerido por/i;
const KEYS = new Set<GuidanceFactKey>(["Q_ALCOHOL_SOLD", "Q_PHYSICAL_LOCATION", "Q_EMPLOYEES_HIRED", "Q_EXISTING_LEASE", "Q_FOOD_PREPARED", "Q_FOOD_SOLD", "Q_CUSTOMERS_VISIT", "Q_RENEWABLE_INSTALL", "Q_SOLAR_MOUNTING", "Q_SOLAR_SIZE", "Q_SOLAR_OWNERSHIP", "entityType", "municipality", "businessType"]);
const CONTENT_FIELDS = ["regulatoryReason", "purpose", "nextAction", "consequenceOrNextStep"] as const;

/** Untrusted published JSON must fail closed, not crash the Requirements page. */
export function validateGuidanceConcept(value: unknown, requirementId?: string): string[] {
  if (!value || typeof value !== "object") return ["GUIDANCE_MISSING"];
  const c = value as GuidanceConcept;
  const issues: string[] = [];
  if (!c.requirementId || (requirementId && c.requirementId !== requirementId)) issues.push("REQUIREMENT_MISMATCH");
  if (c.validationStatus !== "validated") issues.push("GUIDANCE_NOT_VALIDATED");
  if (!c.version) issues.push("VERSION_MISSING");
  for (const field of CONTENT_FIELDS) {
    for (const lang of ["en", "es"] as const) {
      const text = c[field]?.[lang];
      if (typeof text !== "string" || text.trim().length < 25) issues.push(`${field}_${lang}_MISSING`);
      else if (GENERIC.test(text)) issues.push(`${field}_${lang}_GENERIC`);
      const terms = c.subjectTerms?.[lang];
      if (!Array.isArray(terms) || !terms.length || !terms.some(t => typeof t === "string" && t.length > 2 && typeof text === "string" && text.toLowerCase().includes(t.toLowerCase()))) issues.push(`${field}_${lang}_SUBJECT_MISSING`);
      // Only condition values may be interpolated; no arbitrary profile leakage.
      for (const token of typeof text === "string" ? text.matchAll(/\{([^}]+)\}/g) : []) {
        if (token[1] !== "municipality" || !Array.isArray(c.conditions) || !c.conditions.every(g => Array.isArray(g) && g.some(t => t?.key === "municipality"))) issues.push("IRRELEVANT_CONTEXT");
      }
    }
  }
  if (!Array.isArray(c.conditions) || !c.conditions.length || c.conditions.some(g => !Array.isArray(g) || !g.length || g.some(t => !t || !KEYS.has(t.key) || !t.label?.en || !t.label?.es))) issues.push("TRIGGER_CONDITIONS_MISSING");
  if (!Array.isArray(c.dependencies) || c.dependencies.some(d => typeof d !== "string")) issues.push("INVALID_DEPENDENCIES");
  if (c.conditionalDependencies !== undefined && (!Array.isArray(c.conditionalDependencies) || c.conditionalDependencies.some(d => !d?.entityType || !d.documentId))) issues.push("INVALID_DEPENDENCIES");
  if (!Array.isArray(c.sources) || !c.sources.length || c.sources.some(s => {
    if (!s || !s.id || !s.citation || !s.agency || !s.supports || !s.sourceVersion || !/^\d{4}-\d{2}-\d{2}$/.test(s.lastVerified)) return true;
    try {
      const url = new URL(s.url);
      return url.protocol !== "https:" || !(url.hostname.endsWith(".gov") || url.hostname === "www.municipiodebayamon.com" || url.hostname.endsWith(".fondopr.com"));
    } catch { return true; }
  })) issues.push("SOURCE_RELATIONSHIP_MISSING");
  for (const lang of ["en", "es"] as const) {
    const texts = CONTENT_FIELDS.map(k => c[k]?.[lang]);
    if (texts.some((t, i) => t && texts.indexOf(t) !== i)) issues.push("REPEATED_SECTION");
  }
  return [...new Set(issues)];
}

/** Detect copied explanations across unrelated nodes at publication/runtime. */
export function substantiallySimilar(a: string, b: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  const x = words(a), y = words(b);
  const overlap = [...x].filter(w => y.has(w)).length;
  return overlap / Math.max(1, new Set([...x, ...y]).size) >= 0.78;
}

export function duplicateGuidanceIds(concepts: GuidanceConcept[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < concepts.length; i++) for (let j = i + 1; j < concepts.length; j++) {
    const a = concepts[i], b = concepts[j];
    if (a.requirementId === b.requirementId) continue;
    for (const lang of ["en", "es"] as const) {
      const duplicates = CONTENT_FIELDS.filter(k => typeof a[k]?.[lang] === "string" && typeof b[k]?.[lang] === "string" && substantiallySimilar(a[k][lang], b[k][lang]));
      if (duplicates.length >= 2) { ids.add(a.requirementId); ids.add(b.requirementId); }
    }
  }
  return ids;
}
