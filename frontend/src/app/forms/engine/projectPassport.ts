// ============================================================================
// Project Passport — the project-first counterpart to BusinessPassportJson.
//
// A BusinessPassport describes a BUSINESS (entity, EIN, merchant reg...). A
// ProjectPassport describes a PROJECT: the property, the work being done,
// its status, and which business (if any) it is tied to. It lives in its own
// module — deliberately separate from forms/engine/businessPassport.ts — so
// `passportJsonFromCanonical` and the canonical Business Passport
// normalization can never strip it.
//
// Branches:
// - existing_business -> linked to an existing business id; skip formation
//   questions already answered by the Business Passport.
// - new_business      -> paired with the normal new-business formation flow.
// - project_only       -> no business at all; asks zero formation questions
//   and generates zero business-formation requirements.
// ============================================================================

import type { ProjectIntent } from "../../ai/intake/projectIntent";
import type { ProjectContext, ProjectContextFact } from "../../ai/intake/projectContext";

/** Project Passport schema version. Bump when the shape changes. */
export const PROJECT_PASSPORT_VERSION = 1;

/** Confidence-banded fact value as persisted on the Project Passport. */
export interface ProjectPassportFact {
  value: unknown;
  confidence: number;
  evidence?: string;
  requiresConfirmation?: boolean;
}

export interface ProjectPassportJson {
  /** Schema version — currently 1. */
  version: typeof PROJECT_PASSPORT_VERSION;
  /** The intake branch this passport belongs to. */
  intent: ProjectIntent;
  /**
   * Linked business id for existing_business (reuse its Business Passport).
   * Null for new_business (not formed yet) and project_only (no business).
   */
  business_id: string | null;
  /** Project facts keyed by projectContext.ts fact key. */
  facts: Record<string, ProjectPassportFact>;
  /** ISO timestamp of the last update. */
  updated_at: string;
}

/** ISO timestamp helper. */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Build a Project Passport from a validated intent + validated project
 * context. Never invents: intent defaults to null and facts are copied from
 * the validated map only.
 */
export function projectPassportFromContext(args: {
  intent: ProjectIntent | null;
  business_id?: string | null;
  projectContext: ProjectContext | null;
}): ProjectPassportJson | null {
  if (!args.intent) return null;
  const facts: Record<string, ProjectPassportFact> = {};
  if (args.projectContext) {
    for (const [key, fact] of Object.entries(args.projectContext)) {
      const f = fact as ProjectContextFact;
      facts[key] = {
        value: f.value,
        confidence: f.confidence,
        ...(f.evidence ? { evidence: f.evidence } : {}),
      };
    }
  }
  return {
    version: PROJECT_PASSPORT_VERSION,
    intent: args.intent,
    business_id: args.intent === "existing_business" ? (args.business_id ?? null) : null,
    facts,
    updated_at: nowIso(),
  };
}

/** Defensive revalidation of a persisted Project Passport (snapshot restore). */
export function validateProjectPassport(raw: unknown): ProjectPassportJson | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== PROJECT_PASSPORT_VERSION) return null;
  const intent = r.intent;
  if (
    intent !== "existing_business" &&
    intent !== "new_business" &&
    intent !== "project_only"
  ) {
    return null;
  }
  const facts: Record<string, ProjectPassportFact> = {};
  if (r.facts && typeof r.facts === "object") {
    for (const [key, value] of Object.entries(r.facts as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) continue;
      facts[key] = {
        value: v.value,
        confidence: v.confidence,
        ...(typeof v.evidence === "string" && v.evidence ? { evidence: v.evidence } : {}),
        ...(v.requiresConfirmation === true ? { requiresConfirmation: true } : {}),
      };
    }
  }
  const business_id =
    typeof r.business_id === "string" && r.business_id ? r.business_id : null;
  return {
    version: PROJECT_PASSPORT_VERSION,
    intent: intent as ProjectIntent,
    // Business links are only meaningful for existing_business.
    business_id: intent === "existing_business" ? business_id : null,
    facts,
    updated_at: typeof r.updated_at === "string" && r.updated_at ? r.updated_at : nowIso(),
  };
}

/** Human-readable one-liner for the passport header / matter title. */
export function projectPassportTitle(passport: ProjectPassportJson): string | null {
  const work = passport.facts["project_type"];
  const muni = passport.facts["municipality_name"];
  const workText =
    typeof work?.value === "string" && work.value
      ? work.value.replace(/_/g, " ")
      : null;
  const muniText = typeof muni?.value === "string" && muni.value ? muni.value : null;
  if (workText && muniText) return `${workText} — ${muniText}`;
  if (workText) return workText;
  if (muniText) return `Project in ${muniText}`;
  return null;
}
