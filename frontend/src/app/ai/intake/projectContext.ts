/**
 * Project Context: structured project facts extracted from the user's
 * natural-language description.
 *
 * Visible intake fields (business name, municipality, industry, …) only cover
 * the business. Project facts — what is being built or renovated, where, how
 * much work, what happened — are preserved here so requirements reasoning,
 * Agency Assist goal briefs, and passport building can use them without the
 * model ever determining permits or requirements itself. The deterministic
 * rules engine remains the sole authority on requirements.
 *
 * Facts carry a value, a confidence, and an evidence quote. Confidence bands
 * mirror the visible-field rules: >= 0.85 auto-applies silently, 0.60–0.85
 * applies but is flagged as needing confirmation, below 0.60 is omitted.
 */

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const PROJECT_CONTEXT_KEYS = [
  "project_type",
  "existing_building",
  "new_construction",
  "renovation",
  "expansion",
  "change_of_use",
  "municipality",
  "property_type",
  "existing_use",
  "proposed_use",
  "square_footage",
  "scope_of_work",
  "structural_work",
  "electrical_work",
  "plumbing_work",
  "mechanical_work",
  "interior_demolition",
  "new_walls",
  "layout_changes",
  "exterior_work",
  "site_work",
  "occupancy_change",
  "business_activity",
  "business_is_owner_operator",
  "employee_count",
  "estimated_project_value",
  "known_permitting_issue",
  "historical_project_status",
  "construction_approvals_required",
  "land_disturbance_acres",
  "grading",
  "excavation",
  "part_of_larger_common_plan",
  "parking_changes",
  "loading_changes",
  "property_tenure",
] as const;

export type ProjectContextKey = (typeof PROJECT_CONTEXT_KEYS)[number];

export interface ProjectContextFact {
  value: string | number | boolean;
  confidence: number;
  evidence?: string;
}

export type ProjectContext = Partial<Record<ProjectContextKey, ProjectContextFact>>;

const KEY_SET: ReadonlySet<string> = new Set<string>(PROJECT_CONTEXT_KEYS);
const NUMERIC_KEYS: ReadonlySet<string> = new Set([
  "square_footage",
  "employee_count",
  "estimated_project_value",
  "land_disturbance_acres",
]);

// ---------------------------------------------------------------------------
// Validation (defensive: one malformed entry never destroys the rest)
// ---------------------------------------------------------------------------

export interface DiscardedProjectFact {
  field: string;
  reason: string;
}

/**
 * Validate a raw `projectContext` object from the model. Unknown keys and
 * malformed entries are discarded individually and reported; valid entries
 * pass through with normalized confidence (0–1) and trimmed evidence.
 */
export function validateProjectContext(raw: unknown): {
  context: ProjectContext;
  discarded: DiscardedProjectFact[];
} {
  const context: ProjectContext = {};
  const discarded: DiscardedProjectFact[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { context, discarded };
  }
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    const field = `projectContext.${key}`;
    if (!KEY_SET.has(key)) {
      discarded.push({ field, reason: "unknown key" });
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      discarded.push({ field, reason: "malformed entry" });
      continue;
    }
    const e = entry as Record<string, unknown>;
    let value: unknown = e.value;
    const rawConfidence = e.confidence;
    if (typeof rawConfidence !== "number" || !Number.isFinite(rawConfidence)) {
      discarded.push({ field, reason: "missing confidence" });
      continue;
    }
    const confidence = Math.min(1, Math.max(0, rawConfidence));
    if (NUMERIC_KEYS.has(key)) {
      const n =
        typeof value === "number"
          ? value
          : Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
      if (!Number.isFinite(n)) {
        discarded.push({ field, reason: "not a number" });
        continue;
      }
      value = n;
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        discarded.push({ field, reason: "empty value" });
        continue;
      }
      const lower = trimmed.toLowerCase();
      value = lower === "true" ? true : lower === "false" ? false : trimmed;
    } else if (typeof value !== "boolean" && typeof value !== "number") {
      discarded.push({ field, reason: "unsupported value type" });
      continue;
    }
    const rawEvidence = e.evidence;
    const evidence =
      typeof rawEvidence === "string" && rawEvidence.trim()
        ? rawEvidence.trim().slice(0, 300)
        : undefined;
    const fact: ProjectContextFact = { value: value as string | number | boolean, confidence };
    if (evidence) fact.evidence = evidence;
    (context as Record<string, ProjectContextFact>)[key] = fact;
  }
  return { context, discarded };
}

/** True when a fact exists and carries a non-empty value. */
export function projectFactKnown(
  context: ProjectContext | undefined | null,
  key: ProjectContextKey
): boolean {
  const fact = context?.[key];
  return (
    !!fact &&
    fact.value !== undefined &&
    fact.value !== null &&
    fact.value !== ""
  );
}

/**
 * Merge incoming facts into the retained project context. A restated fact
 * always wins; otherwise the higher-confidence fact wins, so follow-up
 * extractions refine rather than clobber the original description.
 */
export function mergeProjectContext(
  prev: ProjectContext,
  incoming: ProjectContext
): ProjectContext {
  const next: ProjectContext = { ...prev };
  for (const [key, fact] of Object.entries(incoming) as Array<
    [ProjectContextKey, ProjectContextFact]
  >) {
    const existing = next[key];
    if (!existing || fact.confidence >= existing.confidence) {
      next[key] = fact;
    }
  }
  return next;
}

function isTrue(
  context: ProjectContext | undefined | null,
  key: ProjectContextKey
): boolean {
  return context?.[key]?.value === true;
}

/**
 * Flatten validated project-context facts into the raw value record the
 * rules engine reads for `project_fact` rules (fact key -> raw value). Only
 * known facts are included; nothing is invented. Returns null when there is
 * nothing to feed the engine.
 */
export function projectFactsForEngine(
  context: ProjectContext | undefined | null
): Record<string, unknown> | null {
  if (!context) return null;
  const out: Record<string, unknown> = {};
  for (const [key, fact] of Object.entries(context) as Array<
    [ProjectContextKey, ProjectContextFact]
  >) {
    if (projectFactKnown(context, key)) out[key] = fact.value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** True when the description involves a construction/project (not just a business). */
export function projectIsActive(context: ProjectContext | undefined | null): boolean {
  if (!context) return false;
  if (
    isTrue(context, "renovation") ||
    isTrue(context, "new_construction") ||
    isTrue(context, "expansion") ||
    isTrue(context, "change_of_use") ||
    isTrue(context, "construction_approvals_required")
  ) {
    return true;
  }
  const scopeKeys: ProjectContextKey[] = [
    "scope_of_work",
    "interior_demolition",
    "exterior_work",
    "site_work",
    "structural_work",
    "electrical_work",
    "plumbing_work",
    "mechanical_work",
    "new_walls",
    "layout_changes",
    "square_footage",
    "property_type",
    "proposed_use",
  ];
  return scopeKeys.some((key) => projectFactKnown(context, key));
}

// ---------------------------------------------------------------------------
// Deterministic follow-up questions
//
// Generated only for meaningful unknowns and never repeated for facts the
// user already supplied. Question text is English; Spanish is resolved through
// the i18n L() dictionary (add the English string as a key in i18n.ts).
// ---------------------------------------------------------------------------

export interface ProjectFollowUpOption {
  value: string;
  label: string;
}

export interface ProjectFollowUp {
  id: string;
  text: string;
  whyWeAsk: string;
  options?: ProjectFollowUpOption[];
}

export const PROJECT_CONTEXT_QUESTION_IDS = [
  "pc_owner_operator",
  "pc_facility_use",
  "pc_occupancy_change",
  "pc_structural_work",
  "pc_exterior_site",
] as const;

export type ProjectContextQuestionId = (typeof PROJECT_CONTEXT_QUESTION_IDS)[number];

/**
 * Build the deterministic follow-up question set for project unknowns.
 * Returns an empty list when there is no active project to ask about.
 */
export function projectContextFollowUps(
  context: ProjectContext | undefined | null,
  opts: { ownerKnown: boolean }
): ProjectFollowUp[] {
  const out: ProjectFollowUp[] = [];
  const c = context ?? {};
  if (!projectIsActive(c)) return out;
  const known = (key: ProjectContextKey) => projectFactKnown(c, key);

  // 1. Who owns/operates the project? Owner-built projects follow a different
  // permit path than work filed by a third party. (The open "which entity"
  // question is answered through the free-text/voice intake box, which
  // extracts owner_name.)
  if (!known("business_is_owner_operator") && !known("business_activity") && !opts.ownerKnown) {
    out.push({
      id: "pc_owner_operator",
      text: "Is your business the owner and operator of this project?",
      whyWeAsk:
        "Owner-built projects follow a different permit path than work filed by a third party, so SmartPR needs to know who is responsible for the project.",
    });
  }

  // 2. Primary facility use — the spec's seed question. Asked when a project
  // is underway but the proposed use was never stated.
  if (
    !known("proposed_use") &&
    (known("property_type") ||
      known("renovation") ||
      known("expansion") ||
      known("new_construction"))
  ) {
    out.push({
      id: "pc_facility_use",
      text: "What is the primary use of the facility?",
      whyWeAsk:
        "The facility's primary use determines which permits and agencies apply to the project.",
      options: [
        { value: "warehouse", label: "Warehouse" },
        { value: "industrial", label: "Industrial" },
        { value: "office", label: "Commercial office" },
        { value: "mixed_use", label: "Mixed use" },
      ],
    });
  }

  // 3. Occupancy / permitted-use change — asked when the project changes the
  // building but the occupancy impact was never stated.
  if (
    (isTrue(c, "renovation") || isTrue(c, "expansion") || isTrue(c, "change_of_use")) &&
    !known("occupancy_change")
  ) {
    out.push({
      id: "pc_occupancy_change",
      text: "Will the project change the property's occupancy or permitted use?",
      whyWeAsk:
        "A change of occupancy or permitted use triggers additional approvals beyond the construction work itself.",
    });
  }

  // 4. Structural scope — asked when unknown.
  if (!known("structural_work")) {
    out.push({
      id: "pc_structural_work",
      text: "Does the work affect structural components?",
      whyWeAsk:
        "Structural work changes which construction approvals are required and who must certify the plans.",
    });
  }

  // 5. Exterior / site scope — asked when neither is known.
  if (!known("exterior_work") && !known("site_work")) {
    out.push({
      id: "pc_exterior_site",
      text: "Will exterior or site work be included?",
      whyWeAsk:
        "Exterior and site work can involve additional permits beyond the building itself.",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Answer application
// ---------------------------------------------------------------------------

export interface AppliedProjectFact {
  key: ProjectContextKey;
  fact: ProjectContextFact;
}

/**
 * Map a guided pc_* answer back into project-context facts. Answers come
 * straight from the user, so they carry confidence 1. Returns an empty array
 * for unknown question ids or mismatched value types.
 */
export function projectContextAnswerToFacts(
  questionId: string,
  value: boolean | string,
  language: "en" | "es"
): AppliedProjectFact[] {
  const evidence =
    language === "es"
      ? "Confirmado por el usuario en la entrevista guiada."
      : "Confirmed by user in guided intake.";
  const bool = (key: ProjectContextKey): AppliedProjectFact[] =>
    typeof value === "boolean" ? [{ key, fact: { value, confidence: 1, evidence } }] : [];
  switch (questionId) {
    case "pc_owner_operator":
      return bool("business_is_owner_operator");
    case "pc_facility_use":
      return typeof value === "string" && value.trim()
        ? [{ key: "proposed_use", fact: { value: value.trim(), confidence: 1, evidence } }]
        : [];
    case "pc_occupancy_change":
      return bool("occupancy_change");
    case "pc_structural_work":
      return bool("structural_work");
    case "pc_exterior_site":
      // One question covers two facts; a "no" genuinely clears both.
      return typeof value === "boolean"
        ? [
            { key: "exterior_work", fact: { value, confidence: 1, evidence } },
            { key: "site_work", fact: { value, confidence: 1, evidence } },
          ]
        : [];
    case "renovations":
      // Q_RENOVATIONS ("Will construction or renovations be performed at the
      // location?", QA 2026-09-23 00:00 S150): a Yes arms the project path
      // directly at confidence 1 so the OGPe construction-permit rule fires
      // even when the interpreter missed the project in the narrative
      // (live misses S111, S150). A "no" leaves any interpreter-extracted
      // project facts untouched — the project follow-ups resolve conflicts.
      return typeof value === "boolean" && value
        ? [
            { key: "project_type", fact: { value: "renovation", confidence: 1, evidence } },
            { key: "renovation", fact: { value: true, confidence: 1, evidence } },
          ]
        : [];
    case "existing_lease":
      // QA 2026-09-24 06:00 (S174 live audit): the bakery owns its premises
      // ("Will the business lease its commercial space?" answered No) but no
      // Property Deed card appeared — RULE_0649 reads project_fact
      // property_tenure=owned, and nothing on the confirmed wizard path ever
      // establishes it (only the interpreter can, and its extraction is
      // provenance-inert unless confirmed). A "No" here is a direct user
      // statement that the business does not lease — i.e. it owns — so bridge
      // to property_tenure=owned at confidence 1. A "Yes" applies nothing:
      // RULE_0037 already renders the lease card from the question answer,
      // and bridging "leased" would duplicate it via RULE_0648.
      return typeof value === "boolean" && value === false
        ? [{ key: "property_tenure", fact: { value: "owned", confidence: 1, evidence } }]
        : [];
    default:
      return [];
  }
}

/**
 * One-line summary strings for the Agency Assist goal brief. Only known
 * facts are included; nothing is invented. Evidence quotes are included by
 * default but can be dropped for surfaces (like the agent prompt) where
 * verbatim user quotes don't belong.
 */
export function projectContextBriefLines(
  context: ProjectContext | undefined | null,
  opts?: { includeEvidence?: boolean }
): string[] {
  if (!context) return [];
  const includeEvidence = opts?.includeEvidence !== false;
  const lines: string[] = [];
  for (const [key, fact] of Object.entries(context) as Array<
    [ProjectContextKey, ProjectContextFact]
  >) {
    if (!projectFactKnown(context, key)) continue;
    const conf = `confidence ${fact.confidence.toFixed(2)}`;
    const ev = includeEvidence && fact.evidence ? `; evidence: "${fact.evidence}"` : "";
    lines.push(`- ${key}: ${String(fact.value)} (${conf}${ev})`);
  }
  return lines;
}

/**
 * "We understood:" chips for project-context facts.
 *
 * The natural-language strip used to show only business-level facts
 * (business type, municipality, profile values) — a rich project description
 * like "renovate an existing commercial building… 12,000 sq ft… interior
 * demolition, electrical and plumbing" surfaced as a single "Guaynabo" chip,
 * making context extraction invisible. These chips prove the semantic
 * extraction ran: project type, scale, trades, and tenure appear next to the
 * keyword-level facts.
 *
 * Facts are split by confidence band so the caller can mark 0.60–0.85 facts
 * as needing confirmation, mirroring the visible-field bands.
 */
export interface ProjectContextChip {
  label: string;
  /** True when the fact is 0.60–0.85: filled but flagged for confirmation. */
  needsConfirmation: boolean;
}

/** Short, user-recognizable label for one project fact. Null = no chip. */
function projectFactChipLabel(key: ProjectContextKey, value: string | number | boolean): string | null {
  switch (key) {
    case "project_type":
      return `Project: ${String(value)}`;
    case "property_type":
      return String(value);
    case "existing_building":
      return value === true ? "Existing building" : null;
    case "renovation":
      return value === true ? "Renovation" : null;
    case "expansion":
      return value === true ? "Expansion" : null;
    case "new_construction":
      return value === true ? "New construction" : null;
    case "change_of_use":
      return value === true ? "Change of use" : null;
    case "square_footage":
      return `${Number(value).toLocaleString("en-US")} sq ft`;
    case "interior_demolition":
      return value === true ? "Interior demolition" : null;
    case "new_walls":
      return value === true ? "New walls" : null;
    case "layout_changes":
      return value === true ? "Layout changes" : null;
    case "structural_work":
      return value === true ? "Structural work" : null;
    case "electrical_work":
      return value === true ? "Electrical work" : null;
    case "plumbing_work":
      return value === true ? "Plumbing work" : null;
    case "mechanical_work":
      return value === true ? "Mechanical work" : null;
    case "exterior_work":
      return value === true ? "Exterior work" : null;
    case "site_work":
      return value === true ? "Site work" : null;
    case "occupancy_change":
      return value === true ? "Occupancy change" : null;
    case "existing_use":
      return `Current use: ${value}`;
    case "proposed_use":
      return `Planned use: ${value}`;
    case "business_activity":
      return String(value);
    case "employee_count": {
      const n = Number(value);
      return `Project crew: ${n}`;
    }
    case "estimated_project_value":
      return `Est. $${Number(value).toLocaleString("en-US")}`;
    case "land_disturbance_acres":
      return `${value} ac disturbed`;
    case "grading":
      return value === true ? "Grading" : null;
    case "excavation":
      return value === true ? "Excavation" : null;
    case "parking_changes":
      return value === true ? "Parking changes" : null;
    case "loading_changes":
      return value === true ? "Loading changes" : null;
    case "property_tenure":
      return value === "owned" ? "Property owned" : value === "leased" ? "Property leased" : null;
    case "known_permitting_issue":
      return "Permitting issues noted";
    // No chip: already covered by the business-level municipality chip.
    case "municipality":
    // No chip: long-form notes live in the Project Passport, not the strip.
    case "scope_of_work":
    case "historical_project_status":
    // No chip: internal derivation detail, not user-recognizable.
    case "business_is_owner_operator":
    case "construction_approvals_required":
    case "part_of_larger_common_plan":
      return null;
    default:
      return null;
  }
}

export function projectContextChips(
  context: ProjectContext | undefined | null
): ProjectContextChip[] {
  if (!context) return [];
  const chips: ProjectContextChip[] = [];
  for (const [key, fact] of Object.entries(context) as Array<
    [ProjectContextKey, ProjectContextFact]
  >) {
    if (!projectFactKnown(context, key)) continue;
    const label = projectFactChipLabel(key, fact.value);
    if (!label) continue;
    chips.push({ label, needsConfirmation: fact.confidence < 0.85 });
  }
  return chips;
}
