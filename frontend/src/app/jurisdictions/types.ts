// ============================================================================
// Regulatory Knowledge Pack — jurisdiction abstraction.
//
// A JurisdictionPack is a self-contained description of ONE jurisdiction's
// regulatory model: its knowledge-base tables, document mappings, conditional
// flag advisories, and document-intelligence prompt configuration.
//
// The application code is jurisdiction-agnostic: it reads everything from the
// ACTIVE pack (see ./index.ts). Onboarding a new state or country means adding
// a new pack — no changes to the engine, UI, or API routes.
// ============================================================================

import type { KnowledgeBase } from "../rulesEngine";

export type LangCode = "en" | "es";

// A conditional (non-deterministic) requirement suggested by a geo flag.
// The user confirms applicability; only "Applies" promotes it to mandatory.
export interface FlagAdvisory {
  flag: string; // geo flag key, e.g. "coastal"
  flagLabel: string; // human label, e.g. "Coastal Municipality"
  document: string; // potential document / review name
  agency: string; // issuing / reviewing agency
  why: string; // "Why this may be required"
  followUp: string; // confirming follow-up question
  /** Authoritative legal basis shown on the card's SOURCE row (optional;
   * cards without one render "—" rather than an invented citation). */
  citation?: string;
  /** Official URL for the cited basis (optional). */
  citation_url?: string;
  /** The flag itself settles applicability — no follow-up question. Used
   * for a jurisdiction-specific review whose only condition is operating in
   * that municipality (e.g. San Juan's: the flag exists only for San Juan,
   * so "Will this business operate in San Juan?" is already answered by the
   * location). */
  autoApplies?: boolean;
  /** Generic advisories this one replaces when both flags are present (e.g.
   * an Autonomous Municipality's own review replaces the generic metro
   * "Additional Municipal Review"), so the user never sees both. */
  supersedes?: string[];
}

// A document-intelligence extraction hint. When the requirement code matches
// any of `match`, the `instructions` block is appended to the LLM system prompt.
export interface ExtractionHint {
  match: string[]; // lowercased substrings of the requirement code
  instructions: string;
}

export interface JurisdictionPack {
  meta: {
    id: string; // stable slug, e.g. "pr", "fl", "tx"
    name: string; // display name, e.g. "Puerto Rico"
    productName: string; // brand shown in UI, e.g. "SmartPR"
    tagline: string; // header subtitle
    defaultLanguage: LangCode;
    languages: LangCode[];
  };

  // Terminology for the jurisdiction's primary geographic subdivision.
  geo: {
    subdivisionLabel: string; // singular, e.g. "Municipality" / "County"
    subdivisionLabelPlural: string; // plural
  };

  // The regulatory knowledge base (entities + deterministic rules).
  kb: KnowledgeBase;

  // Document presentation/scoring mappings (jurisdiction-specific doc ids).
  docMappings: {
    legacyCode: Record<string, string>; // KB doc id -> app legacy code
    recommended: string[]; // doc ids treated as recommended (not mandatory)
    order: string[]; // display/submission ordering of doc ids
  };

  // Conditional advisories keyed by geo flag.
  flagAdvisories: {
    order: string[]; // display order of flags
    byFlag: Record<string, FlagAdvisory>;
  };

  // Configuration for the LLM document-analysis route.
  documentIntelligence: {
    analystSubject: string; // e.g. "Puerto Rico business licensing"
    documentClasses: string[]; // allowed document_type classification values
    extractionHints: ExtractionHint[];
  };

  // Compatibility metadata between KB questions and the legacy intake wizard
  // (used by the regulatory-knowledge-graph seed so admin-driven questions can
  // replace the hardcoded discovery lists without breaking stored answers).
  intakeCompat?: {
    // KB question id -> the answer key the intake wizard stores (e.g.
    // Q_ALCOHOL_SOLD -> "alcohol_sold"). Questions without an entry are new
    // and use their KB id directly.
    uiKeyByQuestionId: Record<string, string>;
    // KB question ids derived from the business-basics profile (never asked
    // as discovery questions).
    profileStageQuestionIds: string[];
  };

}
