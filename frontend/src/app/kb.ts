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
} from "./rulesEngine";
import type { PotentialDecision } from "./potentialRequirements";
import { classifyEngineRequirements, type Applicability, type RequirementKind, type RequirementStage } from "./requirementApplicability";
import type { EntityType } from "./forms/engine/types";
import businessTypeQuestionsJson from "../kb/business_type_questions.json" with { type: "json" };
import industriesJson from "../kb/industries.json" with { type: "json" };
import { QUESTION_KEY_MAP } from "./ai/intake/questionKeyMap";

export const KB: KnowledgeBase = ACTIVE_JURISDICTION.kb;

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
  acceptsOfficialUpload?: boolean;
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
  const resolved = resolveBusinessTypeName(businessTypeName);
  const bt = resolved ? KB.businessTypes.find((b) => b.name.toLowerCase() === resolved.toLowerCase()) : null;
  if (!bt) return null;
  const qById = new Map(KB.questions.map((q) => [q.id, q]));
  const out: DiscoveryQuestionDef[] = [];
  for (const link of kbMeta.btq) {
    if (link.business_type_id !== bt.id) continue;
    const q = qById.get(link.question_id) as (KnowledgeBase["questions"][number] & { stage?: string; ui_key?: string }) | undefined;
    if (!q || q.stage === "profile") continue;
    out.push({ id: q.ui_key ?? q.id, text: q.question });
  }
  return out.length > 0 ? out : null;
}

interface BundledBtqLink { business_type_id: string; question_id: string; }
const BUNDLED_BTQ = businessTypeQuestionsJson as unknown as BundledBtqLink[];

/**
 * Per-type discovery questions from the bundled knowledge graph. Profile-stage
 * facts (structure, location, employee count) are answered in the
 * business-basics step and never asked again here.
 */
function bundledDiscoveryQuestions(businessTypeName: string): DiscoveryQuestionDef[] | null {
  const resolved = resolveBusinessTypeName(businessTypeName);
  const bt = resolved ? KB.businessTypes.find((b) => b.name.toLowerCase() === resolved.toLowerCase()) : null;
  if (!bt) return null;
  const compat = (ACTIVE_JURISDICTION as unknown as {
    intakeCompat?: { uiKeyByQuestionId?: Record<string, string>; profileStageQuestionIds?: string[] };
  }).intakeCompat;
  const uiKeyById = compat?.uiKeyByQuestionId ?? {};
  // Facts already captured in business basics — never ask as discovery.
  const profileStage = new Set(compat?.profileStageQuestionIds ?? []);
  profileStage.add("Q_EMPLOYEE_COUNT"); // basics asks number_of_employees
  const qById = new Map(
    (KB.questions as (KnowledgeBase["questions"][number] & { options?: string[] })[]).map((q) => [q.id, q])
  );
  const out: DiscoveryQuestionDef[] = [];
  for (const link of BUNDLED_BTQ) {
    if (link.business_type_id !== bt.id) continue;
    if (profileStage.has(link.question_id)) continue;
    const q = qById.get(link.question_id);
    if (!q) continue;
    // Canonical answer key: QUESTION_KEY_MAP's writeKey first (it matches what
    // the AI interpreter writes and what buildEngineInput reads, so
    // pre-answered questions are recognized as answered), then intakeCompat's
    // uiKey, then the raw KB id for new questions (buildEngineInput passes
    // those straight to the engine).
    const def: DiscoveryQuestionDef = {
      id: QUESTION_KEY_MAP[link.question_id]?.writeKey ?? uiKeyById[link.question_id] ?? link.question_id,
      text: q.question,
    };
    // Single-select options are plain labels in the KB; rules compare answers
    // against those labels, so value and label stay identical.
    if (Array.isArray(q.options) && q.options.length > 0) {
      def.options = q.options.map((o) => ({ value: o, label: o }));
    }
    out.push(def);
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
  mandatoryReqs: { document_id?: string }[],
  weights: Readonly<Record<string, number>> = kbMeta.weights
): (req: { document_id?: string }) => number {
  const raw = (r: { document_id?: string }) => {
    const w = r.document_id ? weights[r.document_id] : undefined;
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
export function buildEngineInput(
  profile: ProfileLike,
  answers: Record<string, unknown> = {},
  resolved: Record<string, boolean | string> = {}
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

  const a: Record<string, boolean | string | undefined> = {
    Q_PHYSICAL_LOCATION: !online,
    Q_HOME_BASED: isHomeBasedLocation(loc),
    Q_ONLINE_ONLY: online,
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
    Q_EXISTING_LEASE:
      on("existing_lease") || (loc !== "" && !isHomeBasedLocation(loc) && !online),
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

  // Relationship-resolved facts, applied additively (see the doc comment).
  for (const q of KB.questions) {
    const value = resolved[q.id];
    if (value === undefined) continue;
    if (engineTruthy(a[q.id]) && !engineTruthy(value)) continue;
    a[q.id] = value;
  }

  return {
    municipalityName: (p.municipality as string) || null,
    businessTypeName: resolveBusinessTypeName(p.business_type as string),
    answers: a,
  };
}

export function runRulesEngineForProfile(
  profile: ProfileLike,
  answers: Record<string, unknown> = {},
  resolved: Record<string, boolean | string> = {}
): EngineResult {
  return runRulesEngine(KB, buildEngineInput(profile, answers, resolved));
}

// Drop-in replacement for the old hardcoded computeRequirements().
export function computeRequirementsFromKB(
  profile: ProfileLike,
  answers: Record<string, unknown> = {},
  resolved: Record<string, boolean | string> = {},
  options: {
    entityType?: EntityType | string | null;
    potentialDecisions?: Record<string, PotentialDecision>;
  } = {}
): UIRequirement[] {
  const { requirements } = runRulesEngineForProfile(profile, answers, resolved);
  const docById = new Map(
    (KB.documents as Array<{ id: string; agency_url?: string | null; agency_note?: string; download_url?: string | null; download_kind?: string; download_note?: string }>).map((d) => [d.id, d])
  );
  return classifyEngineRequirements(requirements, {
    kb: KB,
    entityType: options.entityType,
    potentialDecisions: options.potentialDecisions,
    legacyCode: kbMeta.legacyCode,
    recommendedIds: kbMeta.recommended,
  })
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
      acceptsOfficialUpload: r.acceptsOfficialUpload,
      agencyUrl: docById.get(r.document_id)?.agency_url ?? null,
      agencyNote: docById.get(r.document_id)?.agency_note ?? null,
      downloadUrl: docById.get(r.document_id)?.download_url ?? null,
      downloadKind: docById.get(r.document_id)?.download_kind ?? null,
      downloadNote: docById.get(r.document_id)?.download_note ?? null,
    }))
    .sort((a, b) => orderIndex(a.document_id!) - orderIndex(b.document_id!));
}
