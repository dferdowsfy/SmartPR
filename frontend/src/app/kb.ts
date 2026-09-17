// ============================================================================
// Knowledge-base adapter: wires the pure rulesEngine to the app.
//
// - Reads the KB tables + jurisdiction-specific mappings from the ACTIVE
//   Regulatory Knowledge Pack (see ./jurisdictions). This file contains NO
//   jurisdiction-specific data — swap the active pack to change jurisdictions.
// - Translates the existing UI profile/answers into KB question answers
//   (so the UI is unchanged — no new questionnaire).
// - Returns requirements in the shape the existing UI already consumes.
// ============================================================================

import { ACTIVE_JURISDICTION } from "./jurisdictions/index.ts";
import { isHomeBasedLocation, isOnlineOnlyLocation } from "./locationTypes";
import {
  runRulesEngine,
  type KnowledgeBase,
  type EngineInput,
  type EngineResult,
  type KBDocument,
} from "./rulesEngine";
import type { PotentialDecision } from "./potentialRequirements";
import { classifyEngineRequirements, kindForDocument, stageForDocument, type Applicability, type RequirementKind, type RequirementStage } from "./requirementApplicability";
import { filterEffective } from "./temporal";
import type { EntityType } from "./forms/engine/types";
import { entityTypeFromLegacyStructure } from "./forms/engine/intake.ts";
import businessTypeQuestionsJson from "../kb/business_type_questions.json" with { type: "json" };
import industriesJson from "../kb/industries.json" with { type: "json" };
import { QUESTION_KEY_MAP } from "./ai/intake/questionKeyMap";
import type { ProjectIntent } from "./ai/intake/projectIntent";
import {
  businessStatusForIntent,
  entityNotFormedForIntent,
} from "./ai/intake/projectIntent";
import type { ProjectContext } from "./ai/intake/projectContext";
import { projectFactsForEngine } from "./ai/intake/projectContext";
import { INTAKE_RELATIONSHIPS } from "./ai/intake/relationshipRegistry";
import type { FactMeta } from "./rulesEngine";

/**
 * Reverse map: KB question id -> the profile/discovery answer keys that
 * legitimately establish it (from the relationship registry). Used to
 * inherit confirmation: a resolver-derived answer counts as confirmed only
 * when the fact it was derived from was confirmed.
 */
let questionSourceKeysCache: Map<string, Set<string>> | null = null;
function questionSourceKeys(): Map<string, Set<string>> {
  if (!questionSourceKeysCache) {
    const m = new Map<string, Set<string>>();
    for (const rel of INTAKE_RELATIONSHIPS) {
      for (const effect of rel.effects) {
        const target = effect.target;
        if (target.type === "question") {
          let s = m.get(target.key);
          if (!s) {
            s = new Set();
            m.set(target.key, s);
          }
          // The source key is the profile/discovery key (or business type id
          // for business_type sources) the derivation was computed from.
          s.add(rel.source.key);
        }
      }
    }
    questionSourceKeysCache = m;
  }
  return questionSourceKeysCache;
}

/**
 * Derivation sources buildEngineInput hardcodes (not registry relationships):
 * the location dropdown establishes the three location questions; the
 * industry dropdown establishes the tourism/agriculture questions.
 */
const DERIVED_SOURCE_KEYS: Record<string, string[]> = {
  Q_PHYSICAL_LOCATION: ["location_type"],
  Q_HOME_BASED: ["location_type"],
  Q_ONLINE_ONLY: ["location_type"],
  Q_TOURISM_ACTIVITY: ["industry"],
  Q_AGRICULTURE_PRODUCTION: ["industry"],
};

export const KB: KnowledgeBase = ACTIVE_JURISDICTION.kb;

// The intake's industry dropdown list (single source of truth — used by the
// intake UI and by server-side fact resolution so both derive identical facts).
export const INTAKE_INDUSTRIES = [
  "Accommodation & Tourism",
  "Agriculture & Farming",
  "Arts, Entertainment & Recreation",
  "Automotive",
  "Beauty & Personal Care",
  "Construction",
  "Education & Training",
  "Energy & Utilities",
  "Finance & Insurance",
  "Food & Beverage",
  "Healthcare",
  "Information Technology",
  "Manufacturing",
  "Professional Services",
  "Real Estate",
  "Retail",
  "Transportation & Logistics",
  "Wholesale Distribution",
  "Government Contractor",
  "Nonprofit / Religious Organization",
  "Other",
];

// UI requirement shape (kept identical to the existing app interface, with a
// few optional fields appended for the debug panel / engine output).
export interface UIRequirement {
  code: string;
  name: string;
  mandatory: boolean;
  status: "pending" | "uploaded" | "passed" | "warning";
  agency: string;
  reason: string;
  document_id?: string;
  category?: string;
  source_rule?: string;
  applicability?: Applicability;
  kind?: RequirementKind;
  stage?: RequirementStage;
  triggerFacts?: string[];
  /** Fact keys that must be known before this requirement can be decided. */
  missingFacts?: string[];
  /** 0–1 confidence band for this classification (see requirementApplicability). */
  confidence?: number;
  /** Human-readable regulatory basis from the rule, when present. */
  triggerSummary?: string;
  acceptsOfficialUpload?: boolean;
  /**
   * Set when this requirement exists only because a question-trigger rule's
   * answer is still unknown: the requirement is conditional and the UI
   * renders an inline Yes/No for this KB question id instead of asking for
   * an upload. Never set alongside a real "Answer:" — the answer genuinely
   * has not been given yet.
   */
  unansweredTriggerQuestionId?: string;
  // Document enrichment (agency/download links) — populated by the shared
  // pipeline from the snapshot's own documents.
  agencyUrl?: string | null;
  agencyNote?: string | null;
  downloadUrl?: string | null;
  downloadKind?: string | null;
  downloadNote?: string | null;
}

// Minimal view of the app profile this adapter reads.
interface ProfileLike {
  municipality?: string;
  industry?: string;
  business_type?: string;
  location_type?: string;
  number_of_employees?: number;
  [key: string]: unknown;
}

// Jurisdiction-specific document mappings come from the active pack — but the
// published knowledge-base snapshot (admin-controlled) can override them, so
// they live in mutable module state. Static pack values are the fallback.
const LEGACY_CODE: Record<string, string> = ACTIVE_JURISDICTION.docMappings.legacyCode;
// Compatibility for snapshots published before structured guidance existed.
// Explicit null/draft/review content always overrides the bundled concept.
const BUNDLED_GUIDANCE = new Map(KB.documents.map(d => [d.id, d.requirement_guidance]));

export interface DocumentDownload {
  url: string;
  kind: string;
}

/** Direct official download/filing destination for a KB document (form PDF,
 * filing portal, form page, or guidance page). Null when the document is
 * private, preparer-created, notarial, or municipality-specific — those carry
 * a how-to-obtain note instead. */
export function getDocumentDownload(documentId: string | null | undefined): DocumentDownload | null {
  if (!documentId) return null;
  const doc = (KB.documents as Array<{ id: string; download_url?: string | null; download_kind?: string }>).find(
    (d) => d.id === documentId
  );
  if (!doc?.download_url) return null;
  return { url: doc.download_url, kind: doc.download_kind || "guidance_page" };
}

/** Kind-specific action label for a direct download/filing destination. */
export function downloadKindLabel(kind: string): string {
  return kind === "form_pdf" ? "Download form"
    : kind === "filing_portal" ? "File online"
    : kind === "form_page" ? "Get the form"
    : kind === "guidance_page" ? "How to file"
    : "Where to get this";
}

interface KbMeta {
  source: "static" | "snapshot";
  version: number;
  recommended: Set<string>;
  order: string[];
  weights: Record<string, number>;
  legacyCode: Record<string, string>;
  btq: { business_type_id: string; question_id: string }[];
}

export const kbMeta: KbMeta = {
  source: "static",
  version: 0,
  recommended: new Set(ACTIVE_JURISDICTION.docMappings.recommended),
  order: ACTIVE_JURISDICTION.docMappings.order,
  weights: {},
  legacyCode: { ...LEGACY_CODE },
  btq: [],
};

const orderIndex = (id: string) => {
  const i = kbMeta.order.indexOf(id);
  return i === -1 ? kbMeta.order.length + 1 : i;
};

// Shape of the compiled snapshot served by GET /api/kb (superset of the
// engine's KnowledgeBase — extra keys are ignored by the engine).
interface KbSnapshot {
  municipalities: unknown[];
  businessTypes: unknown[];
  questions: unknown[];
  documents: unknown[];
  rules: unknown[];
  businessTypeQuestions?: { business_type_id: string; question_id: string }[];
  docMeta?: {
    recommended?: string[];
    order?: string[];
    weights?: Record<string, number>;
    legacyCode?: Record<string, string>;
  };
  meta?: { version?: number };
}

/**
 * Swap the published snapshot into the live KB IN PLACE. `KB` is a const
 * binding with mutable properties, and every consumer dereferences its arrays
 * per call, so the swap propagates without changing any call sites.
 */
export function applyKbSnapshot(snap: KbSnapshot): boolean {
  if (
    !Array.isArray(snap?.municipalities) || snap.municipalities.length === 0 ||
    !Array.isArray(snap.businessTypes) || snap.businessTypes.length === 0 ||
    !Array.isArray(snap.documents) || snap.documents.length === 0 ||
    !Array.isArray(snap.rules) || snap.rules.length === 0 ||
    !Array.isArray(snap.questions)
  ) {
    return false;
  }
  KB.municipalities = snap.municipalities as KnowledgeBase["municipalities"];
  KB.businessTypes = snap.businessTypes as KnowledgeBase["businessTypes"];
  KB.questions = snap.questions as KnowledgeBase["questions"];
  KB.documents = (snap.documents as KnowledgeBase["documents"]).map(d => ({
    ...d,
    requirement_guidance: Object.prototype.hasOwnProperty.call(d, "requirement_guidance")
      ? d.requirement_guidance : BUNDLED_GUIDANCE.get(d.id),
  }));
  KB.rules = snap.rules as KnowledgeBase["rules"];
  kbMeta.source = "snapshot";
  kbMeta.version = snap.meta?.version ?? 0;
  if (snap.docMeta?.recommended) kbMeta.recommended = new Set(snap.docMeta.recommended);
  if (snap.docMeta?.order?.length) kbMeta.order = snap.docMeta.order;
  kbMeta.weights = snap.docMeta?.weights ?? {};
  kbMeta.legacyCode = { ...LEGACY_CODE, ...(snap.docMeta?.legacyCode ?? {}) };
  kbMeta.btq = snap.businessTypeQuestions ?? [];
  return true;
}

/**
 * Fetch the published snapshot (if any) and apply it. Errors are swallowed —
 * the bundled static KB is always a correct fallback.
 */
export async function initKbFromServer(): Promise<boolean> {
  try {
    const res = await fetch("/api/kb");
    if (!res.ok) return false;
    const data = await res.json();
    if (data?.source !== "snapshot" || !data.kb) return false;
    return applyKbSnapshot(data.kb as KbSnapshot);
  } catch {
    return false;
  }
}

/**
 * Discovery questions for a business type.
 *
 * Source priority:
 *   1. Published snapshot (admin-controlled) — wins when it has links.
 *   2. Bundled knowledge-graph links (business_type_questions.json) — the
 *      curated per-type question set, mapped through intakeCompat so answers
 *      keep writing the same wizard keys the engine already reads.
 *   3. null — callers fall back to the hardcoded lists.
 *
 * `ui_key` keeps legacy answer keys working for snapshot questions; bundled
 * questions use QUESTION_KEY_MAP's writeKey (falling back to
 * intakeCompat.uiKeyByQuestionId), and new questions without a mapping use
 * their KB id, which buildEngineInput passes straight to the engine.
 */
export interface DiscoveryQuestionDef {
  id: string;
  text: string;
  options?: { value: string; label: string }[];
}

/**
 * Business-type names for an industry, data-driven from the knowledge graph
 * (industries.json -> business_types.json), so newly added types (e.g.
 * BT_TIRE_RECYCLING) appear in the intake dropdown without a code change.
 * Returns null when the industry isn't found — callers fall back to the
 * hardcoded lists.
 */
export function businessTypeNamesForIndustry(industryName?: string): string[] | null {
  if (!industryName) return null;
  const norm = industryName.trim().toLowerCase();
  const industries = industriesJson as Array<{ id: string; name: string }>;
  const industry = industries.find((i) => i.name.trim().toLowerCase() === norm);
  if (!industry) return null;
  const types = (KB.businessTypes as Array<{ industry_id?: string; name: string }>).filter(
    (b) => b.industry_id === industry.id
  );
  return types.length > 0 ? types.map((b) => b.name) : null;
}

export function discoveryQuestionsForBusinessType(businessTypeName?: string): DiscoveryQuestionDef[] | null {
  if (!businessTypeName) return null;
  // 1. Published snapshot (admin-controlled).
  if (kbMeta.source === "snapshot" && kbMeta.btq.length > 0) {
    const fromSnapshot = snapshotDiscoveryQuestions(businessTypeName);
    if (fromSnapshot) return fromSnapshot;
  }
  // 2. Bundled knowledge-graph links.
  return bundledDiscoveryQuestions(businessTypeName);
}

function snapshotDiscoveryQuestions(businessTypeName: string): DiscoveryQuestionDef[] | null {
  return renderDiscoveryQuestions(businessTypeName, kbMeta.btq);
}

interface BundledBtqLink { business_type_id: string; question_id: string; }
const BUNDLED_BTQ = businessTypeQuestionsJson as unknown as BundledBtqLink[];

function bundledDiscoveryQuestions(businessTypeName: string): DiscoveryQuestionDef[] | null {
  return renderDiscoveryQuestions(businessTypeName, BUNDLED_BTQ);
}

/** One renderer preserves answer identity and options across both sources. */
function renderDiscoveryQuestions(businessTypeName: string, links: BundledBtqLink[]): DiscoveryQuestionDef[] | null {
  const resolved = resolveBusinessTypeName(businessTypeName);
  const bt = resolved ? KB.businessTypes.find(b => b.name.toLowerCase() === resolved.toLowerCase()) : null;
  if (!bt) return null;
  const compat = ACTIVE_JURISDICTION.intakeCompat;
  const profileStage = new Set([...(compat?.profileStageQuestionIds ?? []), "Q_EMPLOYEE_COUNT"]);
  const qById = new Map(KB.questions.map(q => [q.id, q]));
  const out: DiscoveryQuestionDef[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (link.business_type_id !== bt.id || profileStage.has(link.question_id)) continue;
    const q = qById.get(link.question_id) as (KnowledgeBase["questions"][number] & { stage?: string; ui_key?: string }) | undefined;
    if (!q || q.stage === "profile") continue;
    const id = QUESTION_KEY_MAP[q.id]?.writeKey ?? q.ui_key ?? compat?.uiKeyByQuestionId[q.id] ?? q.id;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id, text: q.question,
      ...(q.options?.length ? { options: q.options.map(value => ({ value, label: value })) } : {}),
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * Per-document readiness weights (admin-controlled via the snapshot).
 * Returns a weight function normalized so all mandatory docs sum to 100.
 * Without snapshot weights every doc has weight 1 → identical to the legacy
 * equal-weight formula (100 / totalMandatory).
 */
export function readinessWeightFor(
  mandatoryReqs: { document_id?: string }[]
): (req: { document_id?: string }) => number {
  const raw = (r: { document_id?: string }) => {
    const w = r.document_id ? kbMeta.weights[r.document_id] : undefined;
    return typeof w === "number" && isFinite(w) && w > 0 ? w : 1;
  };
  const sum = mandatoryReqs.reduce((s, r) => s + raw(r), 0) || 1;
  return (r) => (100 * raw(r)) / sum;
}

// Resolve the app's free-text business type to a KB business type (exact match
// first, then a forgiving contains-match for aliases like "Airbnb").
function resolveBusinessTypeName(name?: string): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  const exact = KB.businessTypes.find((b) => b.name.toLowerCase() === n);
  if (exact) return exact.name;
  const partial = KB.businessTypes.find(
    (b) => b.name.toLowerCase().includes(n) || n.includes(b.name.toLowerCase())
  );
  return partial ? partial.name : name;
}

/** Values the rules engine reads as "yes". */
const engineTruthy = (v: unknown): boolean =>
  v === true || v === "true" || v === "yes" || v === "Yes";

/** Loose answer equality for provenance: did the resolver merely restate
 * what the user already provided? */
const sameAnswerValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a === "boolean" || typeof b === "boolean") {
    const toBool = (v: unknown) =>
      v === true || v === "true" || v === "yes" || v === "Yes" ? true
      : v === false || v === "false" || v === "no" || v === "No" ? false
      : undefined;
    const x = toBool(a), y = toBool(b);
    return x !== undefined && x === y;
  }
  return String(a).toLowerCase() === String(b).toLowerCase();
};

/**
 * Translate the app profile + discovery answers into KB question answers.
 *
 * `resolved` carries the facts the intake relationship resolver derived (see
 * ai/intake/relationships.ts) keyed by KB question id. It is applied LAST, but
 * ADDITIVELY: a resolved value may fill in or strengthen an answer, and may
 * never turn an answer this translation already asserted back into a negative.
 * That keeps requirement generation monotonic with respect to the resolver —
 * relationships can only teach the engine something new, never retract a
 * requirement the same profile + answers already produced.
 */
/**
 * Permit-model correction (REG-HOME-PHYSICAL-001): the intake model
 * deliberately counts a home as a physical place (Q_PHYSICAL_LOCATION=true
 * for home-based), but the permit rules and guidance concepts read
 * Q_PHYSICAL_LOCATION as "nonresidential commercial premises"
 * (RULE_0007/0008 trigger text: "Nonresidential business location").
 * Re-assert the permit meaning here so a home-based business never
 * satisfies the nonresidential premise. Idempotent — safe to apply after
 * any later pass that re-asserts raw caller answers (see
 * computeRequirementsFromSnapshot).
 */
export function applyPermitModelCorrections(a: Record<string, boolean | string | undefined>): void {
  if (a["Q_HOME_BASED"] === true) {
    a["Q_PHYSICAL_LOCATION"] = false;
  }
}

export function buildEngineInput(
  profile: ProfileLike,
  answers: Record<string, unknown> = {},
  resolved: Record<string, boolean | string> = {},
  extra?: {
    /** Project-first intake branch; drives formation gating + project facts. */
    projectIntent?: ProjectIntent | null;
    /** Validated project-context facts; values feed project_fact rules. */
    projectContext?: ProjectContext | null;
    /**
     * Intake session identity. When set, the engine enforces strict fact
     * provenance: only facts explicitly confirmed during this session (or
     * passport facts for the same business, on business rules) may trigger.
     * Absent = legacy callers without session identity (historical behavior).
     */
    sessionId?: string | null;
    /** Business this evaluation belongs to (existing-business link). */
    businessId?: string | null;
    /**
     * Fact keys explicitly established or confirmed during the current
     * intake: manual answers, high-confidence (≥0.85) reads, user-confirmed
     * suggestions. For KB questions, either the Q_ id or an answer key that
     * establishes it (QUESTION_KEY_MAP writeKey/aliases, or a relationship
     * source key such as "number_of_employees").
     */
    confirmedKeys?: Iterable<string>;
    /**
     * KB-question ids the intake interpreter answered from the user's
     * description without explicit confirmation (aiPrefilledKeys). These
     * values participate in rules normally, but trigger labels must never
     * present them as the user's own answer ("Answer:" is reserved for
     * values the user actually provided). They are marked "derived" in
     * answerProvenance so cards render the honest "Derived answer:" label.
     * Presentation-only: never feeds gateFact, so firing, gating, and
     * classification are untouched.
     */
    aiPrefilledKeys?: Iterable<string>;
    /**
     * Fact keys that arrived via the business passport (linked existing
     * business), not via the current intake. Admissible for business rules
     * when the business matches; never for project rules.
     */
    passportKeys?: Iterable<string>;
  }
): EngineInput {
  const p = profile || {};
  const da = answers || {};
  const on = (...keys: string[]) => keys.some((k) => p[k] === true || da[k] === true);
  // String-valued answers (select-type questions): pass the raw value through
  // so rules comparing against option labels keep working.
  const strVal = (key: string): string | undefined => {
    const v = (p[key] ?? da[key]) as unknown;
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const loc = (p.location_type as string) || "";
  const empCount = Number(p.number_of_employees || 0);
  // The intake spells online-only two ways depending on which dropdown the
  // location came from; both must mean "no physical premises" here.
  const online = isOnlineOnlyLocation(loc);
  // A location the user never chose tells the engine nothing: the
  // location-derived answers stay unknown instead of inventing "yes, a
  // physical location" (which used to cascade into an invented lease).
  const locKnown = loc !== "";
  // Tri-state read of a single answer key: an explicit No is recorded as
  // false (so "more information needed" stops asking), an unanswered
  // question stays undefined (so the engine cannot invent an answer).
  const boolOf = (key: string): boolean | undefined => {
    const v = (p[key] ?? da[key]) as unknown;
    if (v === true || v === "true" || v === "yes" || v === "Yes") return true;
    if (v === false || v === "false" || v === "no" || v === "No") return false;
    return undefined;
  };

  const a: Record<string, boolean | string | undefined> = {
    Q_PHYSICAL_LOCATION: locKnown ? (!online && !isHomeBasedLocation(loc)) : undefined,
    Q_HOME_BASED: locKnown ? isHomeBasedLocation(loc) : undefined,
    Q_ONLINE_ONLY: locKnown ? online : undefined,
    Q_FOOD_PREPARED: on("food_prepared_or_sold", "food_prepared_on_site", "food_prepared"),
    Q_FOOD_SOLD: on("food_prepared_or_sold", "food_sold"),
    Q_FOOD_SERVED: on("food_served", "food_prepared_or_sold"),
    Q_ALCOHOL_SOLD: on("alcohol_sold"),
    Q_ALCOHOL_SERVED: on("alcohol_served", "alcohol_sold"),
    Q_HEALTHCARE_SERVICES: on("healthcare_services", "healthcare_professionals", "patients_visit"),
    Q_CONTROLLED_SUBSTANCES: on("controlled_substances"),
    Q_MEDICAL_WASTE: on("medical_waste"),
    Q_BIOHAZARD_WASTE: on("biohazard_waste"),
    Q_EMPLOYEES_HIRED: on("employees_hired", "employees_work_on_site") || empCount > 0,
    Q_COMMERCIAL_VEHICLES: on("vehicles_used", "commercial_vehicles"),
    Q_HAZARDOUS_MATERIALS: on("hazardous_materials"),
    Q_HAZARDOUS_FLUIDS: on("hazardous_fluids", "hazardous_fluids_stored"),
    Q_CHEMICALS_USED: on("chemicals_used", "chemicals_stored"),
    Q_PRODUCTS_MANUFACTURED: on("products_manufactured", "products_manufactured_on_site"),
    Q_IMPORT_EXPORT: on("import_export"),
    Q_PROFESSIONAL_LICENSES: on("professional_licenses_required", "professional_licenses", "licensed_professionals"),
    Q_COMMERCIAL_SIGNAGE: on("commercial_signage"),
    Q_OUTDOOR_SEATING: on("outdoor_seating"),
    Q_LIVE_ENTERTAINMENT: on("live_entertainment"),
    Q_SHORT_TERM_RENTAL: on("short_term_rental", "guests_stay_overnight"),
    Q_HOA_CONDO: on("hoa_condo"),
    Q_TOURISM_ACTIVITY:
      on("tourism_activity", "water_activities", "excursions") || p.industry === "Accommodation & Tourism",
    Q_OWNS_PROPERTY: on("owns_property"),
    // The lease is NEVER inferred: a physical location may be owned, and an
    // unanswered lease question stays unknown so the UI can ask it honestly.
    Q_EXISTING_LEASE: boolOf("existing_lease"),
    Q_CHILDREN_PRESENT: on("children_present"),
    Q_PESTICIDES: on("pesticides"),
    Q_AGRICULTURE_PRODUCTION: on("agriculture_production", "food_products_sold") || p.industry === "Agriculture & Farming",
    Q_FIREARMS_SOLD: on("firearms_sold"),
    Q_NONPROFIT_STATUS: on("nonprofit_status"),
    Q_RENOVATIONS: on("renovations"),
    Q_VEHICLE_REPAIR: on("vehicles_repaired", "vehicle_repair"),
    Q_RENEWABLE_INSTALL: on("renewable_install"),
    Q_SOLAR_MOUNTING: strVal("solar_mounting"),
    Q_SOLAR_SIZE: strVal("solar_size"),
    Q_SOLAR_STRUCTURE: on("solar_existing_structure"),
    Q_SOLAR_OWNERSHIP: strVal("solar_property_ownership"),
    Q_SOLAR_BATTERY: on("solar_battery"),
  };

  // Pass through direct KB-question answers (admin-created questions are
  // stored by the wizard under their KB id) without overriding the legacy
  // profile-derived translations above.
  for (const q of KB.questions) {
    const direct = da[q.id];
    if (direct !== undefined && a[q.id] === undefined) {
      a[q.id] = direct as boolean | string;
    }
  }

  // Provenance for the "Answer:" invariant: every value above traces to
  // something the user provided (a profile field, a discovery answer, or a
  // direct translation of one). The resolver loop below may only ever
  // strengthen the engine's picture — when it determines a value the user
  // did not provide, that question is marked "derived" so requirement cards
  // never present it as the user's answer.
  //
  // Location-model derivations (2026-09-17 QA): Q_PHYSICAL_LOCATION,
  // Q_HOME_BASED, and Q_ONLINE_ONLY are translations of the location-type
  // dropdown choice, not answers to the cited questions. A user who picked
  // "Mobile Business" never answered "Will the business operate from a
  // physical location?" — and for a mobile vendor the translation is
  // actively misleading (REG-HOME-PHYSICAL-001's permit meaning). Marking
  // them "derived" renders the honest "Derived answer:" label. This is
  // presentation-only: answerProvenance never feeds gateFact, so firing,
  // gating, and classification are untouched.
  const answerProvenance: Record<string, "user" | "derived"> = {};
  const LOCATION_DERIVED_KEYS = new Set([
    "Q_PHYSICAL_LOCATION",
    "Q_HOME_BASED",
    "Q_ONLINE_ONLY",
  ]);
  // 2026-09-17 QA: interpreter pre-answers (aiPrefilledKeys) are answers the
  // user never gave — the "answered from your description" panel exists
  // precisely so they can correct them. Labeling them "user" let cards
  // present e.g. "Question: Will commercial vehicles be used? | Answer: Yes"
  // for a question that was never asked. Marking them "derived" renders the
  // honest "Derived answer:" label instead.
  const aiPrefilled = new Set(extra?.aiPrefilledKeys ?? []);
  for (const k of Object.keys(a)) {
    if (a[k] === undefined) continue;
    answerProvenance[k] = LOCATION_DERIVED_KEYS.has(k) || aiPrefilled.has(k) ? "derived" : "user";
  }

  // Relationship-resolved facts, applied additively (see the doc comment).
  for (const q of KB.questions) {
    const value = resolved[q.id];
    if (value === undefined) continue;
    if (engineTruthy(a[q.id]) && !engineTruthy(value)) continue;
    const prev = a[q.id];
    a[q.id] = value;
    if (prev === undefined || !sameAnswerValue(prev, value)) {
      answerProvenance[q.id] = "derived";
    }
  }

/**
 * Permit-model correction (REG-HOME-PHYSICAL-001): the intake model
 * deliberately counts a home as a physical place (Q_PHYSICAL_LOCATION=true
 * for home-based), but the permit rules and guidance concepts read
 * Q_PHYSICAL_LOCATION as "nonresidential commercial premises"
 * (RULE_0007/0008 trigger text: "Nonresidential business location").
 * Re-assert the permit meaning here so a home-based business never
 * satisfies the nonresidential premise. Idempotent — safe to apply after
 * any later pass that re-asserts raw caller answers (see
 * computeRequirementsFromSnapshot).
 */
  applyPermitModelCorrections(a);

  // Project-first wiring: the intent branch drives the engine's formation
  // gating (businessStatus / entityNotFormed) and the validated project
  // facts feed project_fact rules, so construction permits trigger from
  // project facts alone — no business formation data required.
  const projectIntent = extra?.projectIntent ?? null;
  const businessStatus = businessStatusForIntent(projectIntent);
  // Quarantine: a property/project with no business must never feed
  // business facts to the engine as if a business existed. If the user
  // switches to project_only mid-flow, already-collected business answers
  // are dropped here — the Project Passport (not the profile) carries the
  // project forward.
  const projectOnly = businessStatus === "project_only";

  // Fact metadata for audit traceability: every fact the engine reads
  // carries its source, its scope namespace, and — in strict mode — the
  // session it was established in and whether it was explicitly confirmed
  // during the current intake. The engine's provenance gate (isFactAdmissible
  // in rulesEngine.ts) enforces the hard rule: a requirement can only use a
  // fact that belongs to the current project, is a persistent business-level
  // fact legitimately applicable to it, or was explicitly confirmed during
  // the current intake. Suggested-but-unconfirmed interpretations are present
  // in the input but inert — they can never trigger.
  const projectFacts = projectFactsForEngine(extra?.projectContext ?? null);
  const strict = !!extra?.sessionId;
  const confirmedKeys = new Set(extra?.confirmedKeys ?? []);
  const passportKeys = new Set(extra?.passportKeys ?? []);
  const relSourceKeys = questionSourceKeys();

  /**
   * Confirmation for a KB question: its Q_ id is confirmed, or any answer
   * key that establishes it is confirmed (the QUESTION_KEY_MAP writeKey and
   * aliases the intake writes, or a relationship source key the value was
   * derived from — confirmation inherits from the basis, never invented).
   */
  const isQuestionConfirmed = (qid: string): boolean => {
    if (confirmedKeys.has(qid)) return true;
    const binding = QUESTION_KEY_MAP[qid];
    if (binding) {
      if (confirmedKeys.has(binding.writeKey)) return true;
      if ((binding.aliases ?? []).some((al) => confirmedKeys.has(al))) return true;
    }
    const sources = relSourceKeys.get(qid);
    if (sources) {
      for (const k of sources) if (confirmedKeys.has(k)) return true;
    }
    const derived = DERIVED_SOURCE_KEYS[qid];
    if (derived?.some((k) => confirmedKeys.has(k))) return true;
    return false;
  };
  const isPassportKey = (qid: string): boolean => {
    if (passportKeys.has(qid)) return true;
    const binding = QUESTION_KEY_MAP[qid];
    if (binding) {
      if (passportKeys.has(binding.writeKey)) return true;
      if ((binding.aliases ?? []).some((al) => passportKeys.has(al))) return true;
    }
    return false;
  };

  const factMeta: Record<string, FactMeta> = {};
  const stampBusinessFact = (key: string, confirmed: boolean, passport: boolean) => {
    factMeta[key] = {
      source: passport ? "passport" : "user_intake",
      scope: "business",
      sessionId: extra?.sessionId ?? null,
      businessId: extra?.businessId ?? null,
      // Legacy callers (no session identity) keep the historical behavior:
      // every defined answer reads as established. Strict mode fails closed.
      confirmedInCurrentIntake: strict ? confirmed : true,
    };
  };
  if (!projectOnly) {
    for (const k of Object.keys(a)) {
      if (a[k] === undefined) continue;
      stampBusinessFact(k, isQuestionConfirmed(k), isPassportKey(k));
    }
    // Municipality and business type are consumed directly by the engine
    // (not via the answers map) — they pass the same gate.
    if (p.municipality) {
      stampBusinessFact("municipality", confirmedKeys.has("municipality"), passportKeys.has("municipality"));
    }
    if (p.business_type) {
      stampBusinessFact("business_type", confirmedKeys.has("business_type"), passportKeys.has("business_type"));
    }
  }
  if (projectFacts) {
    for (const k of Object.keys(projectFacts)) {
      const fact = extra?.projectContext?.[k as keyof ProjectContext];
      const confidence =
        fact && typeof fact === "object" && "confidence" in fact && typeof fact.confidence === "number"
          ? fact.confidence
          : 0;
      factMeta[k] = {
        source: "user_intake",
        scope: "project",
        sessionId: extra?.sessionId ?? null,
        businessId: extra?.businessId ?? null,
        // Project facts: high-confidence (≥0.85) reads are established;
        // suggested (0.60–0.85) facts stay inert until the user confirms or
        // restates them. Legacy callers keep the historical behavior.
        confirmedInCurrentIntake: strict ? confidence >= 0.85 || confirmedKeys.has(k) : true,
        confidence,
      };
    }
  }

  return {
    municipalityName: (p.municipality as string) || null,
    businessTypeName: projectOnly ? null : resolveBusinessTypeName(p.business_type as string),
    answers: projectOnly ? {} : a,
    answerProvenance,
    factMeta,
    sessionId: extra?.sessionId ?? null,
    businessId: extra?.businessId ?? null,
    // Canonical entity type so entity-scoped rules (excluded_entity_types)
    // stay silent for legal forms they can never apply to. "other" means the
    // user hasn't picked a known form — rules treat that as unknown, and the
    // classifier marks the resulting items conditional rather than required.
    entityType: projectOnly
      ? null
      : entityTypeFromLegacyStructure(p.business_structure as string | undefined),
    businessStatus,
    entityNotFormed: entityNotFormedForIntent(projectIntent),
    projectFacts,
  };
}

export function runRulesEngineForProfile(
  profile: ProfileLike,
  answers: Record<string, unknown> = {},
  resolved: Record<string, boolean | string> = {},
  extra?: {
    projectIntent?: ProjectIntent | null;
    projectContext?: ProjectContext | null;
    sessionId?: string | null;
    businessId?: string | null;
    confirmedKeys?: Iterable<string>;
    passportKeys?: Iterable<string>;
  }
): EngineResult {
  return runRulesEngine(KB, buildEngineInput(profile, answers, resolved, extra));
}

// The full deterministic applicability pipeline, parameterized by the KB
// snapshot it matches against. This is the single implementation both the
// intake UI and the server obligation pipeline (compliance/server.ts) run:
// the same engine input, the same classifier, the same formation rules.
// Question-trigger rules whose unknown answer should surface a conditional
// "more information needed" requirement with an inline answer control,
// instead of silently dropping the requirement until the question is asked.
// Curated deliberately: synthesizing for every question-trigger rule would
// flood the checklist with conditionals for questions the intake never asks
// (e.g. alcohol for a law firm). Each entry names the KB question and the
// wizard/discovery key an inline answer must be written to.
export const UNANSWERED_TRIGGER_QUESTIONS: Array<{ questionId: string; writeKey: string }> = [
  { questionId: "Q_EXISTING_LEASE", writeKey: "existing_lease" },
];

/**
 * For curated question-trigger rules whose answer is genuinely unknown
 * (undefined — not an explicit No), append a conditional requirement so the
 * checklist can ask the question inline instead of either inventing an
 * answer or hiding the requirement. Never fires when the document is
 * already required, when the answer is known, or when the trigger is
 * impossible (e.g. no physical location for a lease).
 */
function appendUnansweredTriggerConditionals(
  reqs: UIRequirement[],
  snapshot: KnowledgeBase,
  input: EngineInput,
  legacyCode: Record<string, string>,
): UIRequirement[] {
  const present = new Set(reqs.map((r) => r.document_id));
  const docById = new Map(snapshot.documents.map((d) => [d.id, d]));
  const out = [...reqs];
  for (const rule of filterEffective(snapshot.rules, input.asOf)) {
    if (rule.rule_type !== "question_trigger" || !rule.question_id || !rule.requires_document_id) continue;
    const trigger = UNANSWERED_TRIGGER_QUESTIONS.find((t) => t.questionId === rule.question_id);
    if (!trigger) continue;
    if (present.has(rule.requires_document_id)) continue;
    // Unknown means undefined: an explicit No (false) is a real answer and
    // correctly yields no requirement at all.
    if (input.answers[rule.question_id] !== undefined) continue;
    // A lease is impossible without a physical location — don't ask.
    if (rule.question_id === "Q_EXISTING_LEASE" && input.answers["Q_PHYSICAL_LOCATION"] === false) continue;
    // Validated review 2026-09-16: when tenure is entirely unknown (no
    // ownership answer, not mobile/home/online), the lease question is not
    // merely conditional — the intake must ask ownership/tenure first, so
    // the requirement is needs_more_information. When tenure is known
    // (owns answered) or the business is mobile, it stays conditional.
    let applicability: "conditional" | "needs_more_information" = "conditional";
    if (rule.question_id === "Q_EXISTING_LEASE") {
      // Tenure is "known" only if the user explicitly said they own; a
      // defaulted or negative ownership answer leaves tenure unknown.
      const ownsAnswered = input.answers["Q_OWNS_PROPERTY"] === true;
      const isMobile = input.answers["Q_FOOD_TRUCK_MOBILE"] === true;
      const isHome = input.answers["Q_HOME_BASED"] === true;
      const isOnline = input.answers["Q_ONLINE_ONLY"] === true;
      if (!ownsAnswered && !isMobile && !isHome && !isOnline) {
        applicability = "needs_more_information";
      }
    }
    const d = docById.get(rule.requires_document_id) as
      | (KBDocument & {
          agency_url?: string | null;
          agency_note?: string;
          download_url?: string | null;
          download_kind?: string;
          download_note?: string;
        })
      | undefined;
    if (!d) continue;
    const name = d.name || rule.requires_document_id;
    const agency = d.agency || "";
    const category = d.category || "";
    out.push({
      code: legacyCode[rule.requires_document_id] || rule.requires_document_id.toLowerCase(),
      name,
      mandatory: false,
      status: "pending",
      agency,
      // Machine-readable marker — the UI renders localized copy plus the
      // inline Yes/No. Deliberately NOT the "Question: … | Answer: …" shape:
      // there is no answer yet, and the invariant forbids claiming one.
      reason: `UNANSWERED_QUESTION:${rule.question_id}`,
      document_id: rule.requires_document_id,
      category,
      source_rule: rule.id,
      applicability,
      kind: kindForDocument(rule.requires_document_id, name, category),
      stage: stageForDocument(rule.requires_document_id, name, category),
      triggerFacts: [`rule:${rule.id}`, `unanswered:${rule.question_id}`],
      acceptsOfficialUpload: false,
      unansweredTriggerQuestionId: rule.question_id,
      // Same "where to get this" metadata as a real requirement — the card
      // may become required the moment the user answers Yes.
      agencyUrl: d.agency_url ?? null,
      agencyNote: d.agency_note ?? null,
      downloadUrl: d.download_url ?? null,
      downloadKind: d.download_kind ?? null,
      downloadNote: d.download_note ?? null,
    });
    present.add(rule.requires_document_id);
  }
  return out;
}

// Direct answers are carried for admin-published questions that may not exist
// in the bundled adapter — the rules engine, not AI, still decides.
export function computeRequirementsFromSnapshot(
  snapshot: KnowledgeBase,
  profile: ProfileLike,
  answers: Record<string, unknown> = {},
  resolved: Record<string, boolean | string> = {},
  options: {
    entityType?: EntityType | string | null;
    potentialDecisions?: Record<string, PotentialDecision>;
    recommendedIds?: Set<string>;
    legacyCode?: Record<string, string>;
    projectIntent?: ProjectIntent | null;
    projectContext?: ProjectContext | null;
    /** Fact provenance for the engine's hard rule (see buildEngineInput). */
    sessionId?: string | null;
    businessId?: string | null;
    confirmedKeys?: Iterable<string>;
    passportKeys?: Iterable<string>;
    /**
     * KB-question ids the intake interpreter answered from the user's
     * description without explicit confirmation. Forwarded to
     * buildEngineInput for honest trigger labeling (presentation-only).
     */
    aiPrefilledKeys?: Iterable<string>;
  } = {}
): UIRequirement[] {
  const input = buildEngineInput(profile, answers, resolved, {
    projectIntent: options.projectIntent ?? null,
    projectContext: options.projectContext ?? null,
    sessionId: options.sessionId ?? null,
    businessId: options.businessId ?? null,
    confirmedKeys: options.confirmedKeys,
    passportKeys: options.passportKeys,
    aiPrefilledKeys: options.aiPrefilledKeys,
  });
  for (const question of snapshot.questions as Array<{ id: string }>) {
    const direct = answers[question.id];
    if (direct !== undefined) input.answers[question.id] = direct as boolean | string;
  }
  // REG-HOME-PHYSICAL-001 order-dependence (2026-09-16 QA): the loop above
  // re-asserts the caller's raw answers over buildEngineInput's permit-model
  // correction, so a home-based business whose intake record carries
  // Q_PHYSICAL_LOCATION=true would wrongly satisfy the nonresidential
  // premise and fire RULE_0007/RULE_0008. The correction is idempotent, so
  // re-apply it last — the permit meaning always wins.
  applyPermitModelCorrections(input.answers);
  // Entity type from explicit caller options must reach the engine so
  // entity-scoped rules (excluded_entity_types) filter correctly; the
  // profile-derived value is only a fallback.
  if (options.entityType) input.entityType = options.entityType as never;
  const { requirements } = runRulesEngine(snapshot, input);
  const classified = classifyEngineRequirements(requirements, {
    kb: snapshot,
    // Explicit caller choice wins; otherwise use what the profile declared.
    entityType: options.entityType ?? input.entityType ?? null,
    // The classifier needs the same answers the engine saw for entity- and
    // employment-sensitive calls (e.g. EIN for an unknown entity type that
    // will hire employees is required; without that fact it is conditional).
    answers: input.answers,
    potentialDecisions: options.potentialDecisions,
    legacyCode: options.legacyCode ?? kbMeta.legacyCode,
    recommendedIds: options.recommendedIds ?? kbMeta.recommended,
    // Verify-existing compliance mapping needs the project-first intent.
    businessStatus: input.businessStatus ?? null,
  });
  // Enrich with the snapshot's own document metadata (agency/download links)
  // and apply the canonical display order — identical for UI and server.
  const docById = new Map(
    (snapshot.documents as Array<{
      id: string;
      agency_url?: string | null;
      agency_note?: string;
      download_url?: string | null;
      download_kind?: string;
      download_note?: string;
    }>).map((d) => [d.id, d])
  );
  const legacyCodeMap: Record<string, string> = options.legacyCode ?? kbMeta.legacyCode;
  const enriched: UIRequirement[] = classified
    .map((r) => ({
      code: r.code,
      name: r.document_name,
      mandatory: r.mandatory,
      status: "pending" as const,
      agency: r.agency,
      reason: r.reason,
      document_id: r.document_id,
      category: r.category,
      source_rule: r.source_rule_id,
      applicability: r.applicability,
      kind: r.kind,
      stage: r.stage,
      triggerFacts: r.triggerFacts,
      missingFacts: r.missingFacts,
      confidence: r.confidence,
      triggerSummary: r.triggerSummary,
      acceptsOfficialUpload: r.acceptsOfficialUpload,
      agencyUrl: docById.get(r.document_id)?.agency_url ?? null,
      agencyNote: docById.get(r.document_id)?.agency_note ?? null,
      downloadUrl: docById.get(r.document_id)?.download_url ?? null,
      downloadKind: docById.get(r.document_id)?.download_kind ?? null,
      downloadNote: docById.get(r.document_id)?.download_note ?? null,
    }));
  // Curated unanswered-trigger conditionals (e.g. the lease question):
  // honest "more information needed" cards with an inline Yes/No, never
  // an invented answer.
  return appendUnansweredTriggerConditionals(enriched, snapshot, input, legacyCodeMap)
    .sort((a, b) => orderIndex(a.document_id!) - orderIndex(b.document_id!));
  return enriched;
}

// Drop-in replacement for the old hardcoded computeRequirements().
export function computeRequirementsFromKB(
  profile: ProfileLike,
  answers: Record<string, unknown> = {},
  resolved: Record<string, boolean | string> = {},
  options: {
    entityType?: EntityType | string | null;
    potentialDecisions?: Record<string, PotentialDecision>;
    projectIntent?: ProjectIntent | null;
    projectContext?: ProjectContext | null;
    /** Fact provenance for the engine's hard rule (see buildEngineInput). */
    sessionId?: string | null;
    businessId?: string | null;
    confirmedKeys?: Iterable<string>;
    passportKeys?: Iterable<string>;
    /**
     * KB-question ids the intake interpreter answered from the user's
     * description without explicit confirmation. Forwarded to
     * computeRequirementsFromSnapshot for honest trigger labeling.
     */
    aiPrefilledKeys?: Iterable<string>;
  } = {}
): UIRequirement[] {
  return computeRequirementsFromSnapshot(KB, profile, answers, resolved, {
    entityType: options.entityType,
    potentialDecisions: options.potentialDecisions,
    projectIntent: options.projectIntent,
    projectContext: options.projectContext,
    sessionId: options.sessionId,
    businessId: options.businessId,
    confirmedKeys: options.confirmedKeys,
    passportKeys: options.passportKeys,
    aiPrefilledKeys: options.aiPrefilledKeys,
  });
}
