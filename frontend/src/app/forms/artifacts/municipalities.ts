// ============================================================================
// Municipality adapters.
//
//   canonical requirement → municipality → municipality implementation
//
// The regulatory graph decides WHETHER a requirement applies. This module only
// decides HOW it is satisfied in a given municipality: an official municipal
// form, a portal workflow, or — the honest default — requirements only.
//
// A municipality is never assumed to accept another municipality's artifact,
// and a genericized municipal layout can never be registered here as an
// official form (`validateMunicipalImplementations` enforces that).
// ============================================================================

import { getTemplate, isOfficialArtifact } from "./catalog.ts";

export type MunicipalImplementationKind = "official_form" | "portal" | "requirements_only";

export interface MunicipalImplementation {
  municipality: string;
  requirementCode: string;
  kind: MunicipalImplementationKind;
  /** Set only for `official_form`, and only for a municipality-verified artifact. */
  formCode?: string;
  portalUrl?: string;
  /** True only when a human verified this municipality accepts this implementation. */
  verified: boolean;
  verifiedAt?: string;
  notes?: string;
}

/**
 * Verified municipality implementations.
 *
 * Intentionally empty: SmartPR holds no MUNICIPALITY-SPECIFIC official artifact.
 * The PA03/PA04 layouts in the library are genericized working copies, which is
 * not the same thing as a municipality's official form — registering one here
 * would be a false claim of coverage.
 *
 * PA02 is not an omission from this table. It is an official STATEWIDE OCAM
 * form with an identical printed layout in every municipality, so it is served
 * directly as a statewide artifact (see applicability.ts) and never needs a
 * per-municipality entry here.
 */
export const MUNICIPAL_IMPLEMENTATIONS: MunicipalImplementation[] = [];

/** Normalize "Bayamón" / "bayamon" / " BAYAMON " to one comparable key. */
export function municipalityKey(name: string | undefined | null): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Resolve how a municipality satisfies a canonical requirement. Any
 * municipality without a verified entry falls back to requirements-only — the
 * data is still collected and reusable, the artifact claim is simply not made.
 */
export function resolveMunicipalImplementation(
  municipality: string | undefined | null,
  requirementCode: string
): MunicipalImplementation {
  const key = municipalityKey(municipality);
  const match = MUNICIPAL_IMPLEMENTATIONS.find(
    (impl) => municipalityKey(impl.municipality) === key && impl.requirementCode === requirementCode && impl.verified
  );
  if (match) return match;
  return {
    municipality: municipality || "",
    requirementCode,
    kind: "requirements_only",
    verified: false,
    notes: "No municipality-verified official artifact or portal workflow is registered for this requirement yet.",
  };
}

export interface MunicipalValidationIssue {
  municipality: string;
  requirementCode: string;
  problem: string;
}

/**
 * Guardrails for the adapter table. Called by tests and by the admin surface so
 * a bad registration is caught before it can be shown to a user:
 *   * an official_form entry must name a template,
 *   * that template must be a genuinely official artifact (never a genericized
 *     municipal layout),
 *   * and it must be marked verified.
 */
export function validateMunicipalImplementations(
  implementations: MunicipalImplementation[] = MUNICIPAL_IMPLEMENTATIONS
): MunicipalValidationIssue[] {
  const issues: MunicipalValidationIssue[] = [];
  for (const impl of implementations) {
    if (impl.kind !== "official_form") continue;
    const base = { municipality: impl.municipality, requirementCode: impl.requirementCode };
    if (!impl.formCode) {
      issues.push({ ...base, problem: "official_form implementation without a formCode" });
      continue;
    }
    const template = getTemplate(impl.formCode);
    if (!template) {
      issues.push({ ...base, problem: `unknown formCode ${impl.formCode}` });
      continue;
    }
    if (!isOfficialArtifact(template)) {
      issues.push({
        ...base,
        problem: `${impl.formCode} is ${template.artifactType}/${template.sourceStatus} — only a verified official artifact may back an official_form implementation`,
      });
    }
    if (!impl.verified) {
      issues.push({ ...base, problem: "official_form implementation is not marked verified" });
    }
  }
  return issues;
}
