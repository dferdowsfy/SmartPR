// ============================================================================
// Project intent — the project-first intake layer.
//
// SmartPR is a regulatory PROJECT platform, not just a business-setup
// product. A project can belong to an existing business, require forming a
// new one, or stand alone with no business at all (property owner
// pre-tenant, etc.). "New business" is never a prerequisite.
//
// The intent is determined once per intake — inferred by the interpreter
// (with confidence/evidence/requires_confirmation like any other field) or
// asked explicitly early in the flow — and then drives:
//   - which questions the intake asks (project_only skips ALL formation),
//   - which requirements the rules engine may generate (formation gated on
//     new + unformed; construction permits from project facts alone).
// ============================================================================

/** The three intake branches. */
export type ProjectIntent = "existing_business" | "new_business" | "project_only";

export const PROJECT_INTENT_VALUES: readonly ProjectIntent[] = [
  "existing_business",
  "new_business",
  "project_only",
] as const;

export function isValidProjectIntent(v: unknown): v is ProjectIntent {
  return (
    typeof v === "string" &&
    (PROJECT_INTENT_VALUES as readonly string[]).includes(v.trim().toLowerCase())
  );
}

export function normalizeProjectIntent(v: unknown): ProjectIntent | null {
  if (!isValidProjectIntent(v)) return null;
  return v.trim().toLowerCase() as ProjectIntent;
}

/**
 * Business status for the rules engine, derived from intent. Formation
 * requirements ("form the entity" steps) fire only for "new" + unformed —
 * never for project_only or an existing business. Null when the intent is
 * unknown, in which case the engine behaves exactly as before this gate.
 */
export function businessStatusForIntent(
  intent: ProjectIntent | null | undefined
): "new" | "existing" | "project_only" | null {
  if (intent === "new_business") return "new";
  if (intent === "existing_business") return "existing";
  if (intent === "project_only") return "project_only";
  return null;
}

/**
 * Whether the entity is not yet formed. A new business is forming (true);
 * an existing business has its entity (false). project_only/unknown stays
 * null — unknown preserves current engine behavior; project_only never
 * reaches formation rules because requires_business already excludes it.
 */
export function entityNotFormedForIntent(
  intent: ProjectIntent | null | undefined
): boolean | null {
  if (intent === "new_business") return true;
  if (intent === "existing_business") return false;
  return null;
}

/** Bilingual label for an intent option. */
export function projectIntentLabel(intent: ProjectIntent, lang: "en" | "es"): string {
  switch (intent) {
    case "existing_business":
      return lang === "es" ? "Negocio existente" : "Existing business";
    case "new_business":
      return lang === "es" ? "Negocio nuevo" : "New business";
    case "project_only":
      return lang === "es" ? "Solo propiedad / proyecto" : "Property / project only";
  }
}

/** The early intent question, exactly as the spec phrases it. */
export function projectIntentQuestionText(lang: "en" | "es"): string {
  return lang === "es"
    ? "¿Es esto para un negocio existente, un negocio nuevo, o una propiedad/proyecto que aún no está atado a un negocio?"
    : "Is this for an existing business, a new business, or a property/project that is not tied to a business yet?";
}

/** Why SmartPR asks — shown under the intent question. */
export function projectIntentWhyAsk(lang: "en" | "es"): string {
  return lang === "es"
    ? "Un proyecto de un negocio existente sigue una ruta distinta a la de un negocio nuevo, y una propiedad sin negocio no necesita trámites de formación."
    : "A project for an existing business follows a different path than a new one, and a property with no business tied to it needs no formation filings.";
}
