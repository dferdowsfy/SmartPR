// SmartPR ChatGPT (MCP Apps) assessment adapter.
//
// Runs the SAME deterministic rules engine + applicability classifier the
// portal intake uses (runRulesEngine + classifyEngineRequirements over the
// bundled Puerto Rico knowledge graph) and reshapes the result for ChatGPT.
//
// Stateless: nothing is persisted. Unknown facts stay "unresolved" — a
// missing answer is never silently treated as "no".

import { createHash } from "node:crypto";
import { puertoRicoPack } from "../../app/jurisdictions/pr/index";
import { runRulesEngine, type KnowledgeBase, type BusinessStatus } from "../../app/rulesEngine";
import { classifyEngineRequirements, type ClassifiedRequirement } from "../../app/requirementApplicability";
import { BOUNDARY_SOURCE, locateInPuertoRico, municipioFocus } from "../../app/locations/boundaries";

export const CHATGPT_SERVER_VERSION = "0.1.0";
export const FREE_PREVIEW_LIMIT = 8;
const MAX_CLARIFYING_QUESTIONS = 4;
const MAX_UNRESOLVED_FROM_QUESTIONS = 6;

export type Applicability = "supported" | "conditional" | "unresolved";
export type RenovationScope = "none" | "interior" | "structural" | "unknown";
export type AnswerValue = boolean | string;

export interface ScenarioInput {
  business_type?: unknown;
  activity_description?: unknown;
  municipality?: unknown;
  business_status?: unknown; // "new" | "existing" | "unknown"
  square_feet?: unknown;
  employees?: unknown;
  renovation?: unknown; // RenovationScope or boolean
  answers?: unknown; // { [question_id]: answer }
  site?: unknown; // { latitude, longitude } map pin; null clears
}

/**
 * Map pin, resolved server-side from the coordinates alone (Census TIGER
 * municipio/barrio point-in-polygon — the same lookup the portal's intake
 * pin uses). Client-supplied names are never trusted.
 */
export interface ScenarioSite {
  latitude: number;
  longitude: number;
  municipality: string;
  fips: string;
  barrio: string | null;
  barrio_geoid: string | null;
  near_boundary: boolean;
  boundary_distance_m: number;
  designations: string[];
  source: string;
}

export interface ApproximateSite {
  latitude: number;
  longitude: number;
  municipality: string;
  approximate: true;
  basis: string;
}

export interface NormalizedScenario {
  jurisdiction: "Puerto Rico";
  business_type: string | null;
  business_type_input: string | null;
  business_type_candidates: string[];
  activity_description: string | null;
  municipality: string | null;
  municipality_input: string | null;
  business_status: "new" | "existing" | "unknown";
  square_feet: number | null;
  employees: number | null;
  renovation: RenovationScope;
  answers: Record<string, AnswerValue>;
  site: ScenarioSite | null;
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  options: Array<{ value: string; label: string }>;
  kind: "scenario" | "kb";
  why: string;
}

export interface Citation { label: string; url: string | null }

export interface AssessedRequirement {
  id: string;
  name: string;
  agency: string;
  group: "Business registrations" | "Construction & site authorization" | "Operating permits";
  applicability: Applicability;
  why: string;
  evidence: string[];
  dependencies: string[];
  next_steps: string[];
  citations: Citation[];
  official_source_url: string | null;
}

export interface AssessmentResult {
  status: "complete" | "partial" | "unsupported";
  tier: "free_preview";
  scenario: NormalizedScenario;
  assumptions: string[];
  unresolved_facts: string[];
  clarifying_questions: ClarifyingQuestion[];
  requirements: AssessedRequirement[];
  gated: { hidden_requirement_count: number; locked_features: string[] };
  counts: { supported: number; conditional: number; unresolved: number; total: number };
  coverage_limits: string[];
  dropped_answers: string[];
  /** Where the widget map opens (display only). */
  map_focus: { latitude: number; longitude: number; zoom: number };
  /**
   * Municipality known but no pin yet: downtown (barrio-pueblo) of that
   * municipio, so the widget can show a draggable starting pin. Display only —
   * never a site, never sent to the portal as a pin.
   */
  approximate_site: ApproximateSite | null;
  /** Street + official-map answers for scenario.site (filled by the MCP layer; null when not looked up). */
  site_details?: import("./siteLookup").SiteDetails | null;
  versions: { generated_at: string; server: string; engine: string; kb: string; rules: number };
  message: string;
}

const kb = puertoRicoPack.kb as KnowledgeBase;
let kbHash: string | null = null;
function kbVersion(): string {
  if (!kbHash) {
    kbHash = createHash("sha256").update(JSON.stringify(kb.rules)).update(JSON.stringify(kb.documents)).digest("hex").slice(0, 12);
  }
  return `pr-kg@${kbHash}`;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function matchName<T extends { name: string }>(items: T[], raw: string):
  | { kind: "exact" | "fuzzy"; value: T }
  | { kind: "candidates"; candidates: string[] } {
  const n = norm(raw);
  if (!n) return { kind: "candidates", candidates: [] };
  const exact = items.find((i) => norm(i.name) === n);
  if (exact) return { kind: "exact", value: exact };
  const partial = items.filter((i) => norm(i.name).includes(n) || n.includes(norm(i.name)));
  if (partial.length === 1) return { kind: "fuzzy", value: partial[0] };
  if (partial.length > 1) return { kind: "candidates", candidates: partial.map((i) => i.name).slice(0, 12) };
  // token overlap fallback (e.g. "coffee shop" → "Coffee Shop / Café")
  const tokens = n.split(" ").filter((t) => t.length > 3);
  const overlap = items.filter((i) => tokens.some((t) => norm(i.name).split(" ").includes(t)));
  if (overlap.length === 1) return { kind: "fuzzy", value: overlap[0] };
  if (overlap.length > 1) return { kind: "candidates", candidates: overlap.map((i) => i.name).slice(0, 12) };
  // Typo tolerance ("resturant" → "Restaurant"): closest name within a
  // conservative edit budget. Short names get a tighter budget so "bar"
  // never becomes "car" — and this runs last, only when every cheaper
  // signal found nothing.
  const scored = items
    .map((i) => ({ item: i, d: editDistance(n, norm(i.name)) }))
    .filter((s) => s.d > 0 && s.d <= Math.min(2, Math.max(1, Math.floor(norm(s.item.name).length / 4))));
  scored.sort((a, b) => a.d - b.d || a.item.name.localeCompare(b.item.name));
  if (scored.length) return { kind: "fuzzy", value: scored[0].item };
  return { kind: "candidates", candidates: [] };
}

/** Levenshtein edit distance over a normalized string. */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[, ]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n) : null;
};
function coerce(v: unknown): AnswerValue | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["yes", "y", "true", "si", "sí"].includes(s)) return true;
    if (["no", "n", "false"].includes(s)) return false;
    if (!s || s === "unknown" || s === "not sure") return undefined;
    return v.trim().slice(0, 120);
  }
  return undefined;
}

const coord = (v: unknown, lim: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= lim ? Math.round(n * 1e6) / 1e6 : null;
};

/** Resolve a pin to a Puerto Rico site, or null when it is not in Puerto Rico. */
export function resolveSite(raw: unknown): ScenarioSite | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const latitude = coord(r.latitude ?? r.lat, 90);
  const longitude = coord(r.longitude ?? r.lng ?? r.lon, 180);
  if (latitude == null || longitude == null) return null;
  const p = locateInPuertoRico(latitude, longitude);
  if (!p) return null;
  const kbMuni = kb.municipalities.find((m) => norm(m.name) === norm(p.municipio.name));
  return {
    latitude, longitude,
    municipality: kbMuni?.name ?? p.municipio.name,
    fips: p.municipio.fips,
    barrio: p.barrio?.name ?? null,
    barrio_geoid: p.barrio?.geoid ?? null,
    near_boundary: p.nearBoundary,
    boundary_distance_m: p.boundaryDistanceM,
    designations: (kbMuni as { flags?: string[] } | undefined)?.flags?.filter((f) => typeof f === "string").slice(0, 12) ?? [],
    source: `${BOUNDARY_SOURCE.name ?? BOUNDARY_SOURCE.id}${BOUNDARY_SOURCE.version ? ` ${BOUNDARY_SOURCE.version}` : ""}`,
  };
}

// Scenario-level clarification ids (not KB question ids).
export const SCENARIO_QUESTION_IDS = ["activity", "business_status", "structural", "municipality"] as const;

/** Normalize untrusted tool input into a scenario. */
export function normalizeScenario(input: ScenarioInput, prior?: Partial<NormalizedScenario> | null): { scenario: NormalizedScenario; dropped: string[] } {
  const p = prior || {};
  const btInput = str(input.business_type, 120) ?? p.business_type_input ?? p.business_type ?? null;
  let businessType: string | null = null;
  let candidates: string[] = [];
  if (btInput) {
    const m = matchName(kb.businessTypes, btInput);
    if (m.kind === "candidates") candidates = m.candidates;
    else businessType = m.value.name;
  }
  const muniInput = str(input.municipality, 80) ?? p.municipality_input ?? p.municipality ?? null;
  let municipality: string | null = null;
  if (muniInput) {
    const m = matchName(kb.municipalities, muniInput);
    if (m.kind !== "candidates") municipality = m.value.name;
  }
  const statusRaw = str(input.business_status, 20)?.toLowerCase() ?? p.business_status ?? "unknown";
  const business_status = statusRaw === "existing" || statusRaw === "registered" ? "existing" : statusRaw === "new" ? "new" : "unknown";
  let renovation: RenovationScope = (p.renovation as RenovationScope) ?? "unknown";
  if (typeof input.renovation === "boolean") renovation = input.renovation ? (renovation === "structural" ? "structural" : "interior") : "none";
  else if (typeof input.renovation === "string" && ["none", "interior", "structural", "unknown"].includes(input.renovation)) renovation = input.renovation as RenovationScope;

  const answers: Record<string, AnswerValue> = { ...(p.answers || {}) };
  const dropped: string[] = [];
  const raw = input.answers && typeof input.answers === "object" && !Array.isArray(input.answers) ? (input.answers as Record<string, unknown>) : {};
  const scenario: NormalizedScenario = {
    jurisdiction: "Puerto Rico",
    business_type: businessType,
    business_type_input: btInput,
    business_type_candidates: candidates,
    activity_description: str(input.activity_description, 300) ?? p.activity_description ?? null,
    municipality,
    municipality_input: muniInput,
    business_status,
    square_feet: num(input.square_feet) ?? p.square_feet ?? null,
    employees: num(input.employees) ?? p.employees ?? null,
    renovation,
    answers,
    site: null,
  };
  // Map pin: always re-resolved from coordinates (prior scenarios are
  // untrusted too). An explicit `site: null` clears it. A resolved pin is
  // authoritative for the municipality, as in the portal intake.
  if (input.site !== undefined && input.site !== null) {
    scenario.site = resolveSite(input.site);
    if (!scenario.site) dropped.push("site");
  } else if (input.site === undefined && p.site) {
    scenario.site = resolveSite(p.site);
  }
  if (scenario.site && input.site === undefined && str(input.municipality, 80)) {
    const m = matchName(kb.municipalities, str(input.municipality, 80)!);
    if (m.kind !== "candidates" && norm(m.value.name) !== norm(scenario.site.municipality)) scenario.site = null; // user changed municipality in chat
  }
  if (scenario.site) {
    scenario.municipality = scenario.site.municipality;
    scenario.municipality_input = scenario.site.municipality;
  }
  for (const [id, val] of Object.entries(raw).slice(0, 40)) {
    const v = coerce(val);
    if (id === "activity") {
      if (typeof v === "string") {
        const m = matchName(kb.businessTypes, v);
        if (m.kind !== "candidates") { scenario.business_type = m.value.name; scenario.business_type_input = v; scenario.business_type_candidates = []; }
        else dropped.push(id);
      }
    } else if (id === "business_status") {
      if (v === "existing" || v === true) scenario.business_status = "existing";
      else if (v === "new" || v === false) scenario.business_status = "new";
    } else if (id === "structural") {
      if (v === true || v === "structural") scenario.renovation = "structural";
      else if (v === false || v === "interior") scenario.renovation = "interior";
      else if (v === "none") scenario.renovation = "none";
    } else if (id === "municipality") {
      if (typeof v === "string") {
        const m = matchName(kb.municipalities, v);
        if (m.kind !== "candidates") {
          scenario.municipality = m.value.name; scenario.municipality_input = v;
          if (scenario.site && norm(scenario.site.municipality) !== norm(m.value.name)) scenario.site = null; // typed answer moved away from the pin
        } else dropped.push(id);
      }
    } else if (kb.questions.some((q) => q.id === id)) {
      if (v === undefined) delete answers[id];
      else answers[id] = v;
    } else {
      dropped.push(id);
    }
  }
  return { scenario, dropped };
}

function employeeBucket(n: number): string {
  if (n === 0) return "0";
  if (n <= 5) return "1-5";
  if (n <= 20) return "6-20";
  if (n <= 50) return "21-50";
  return "50+";
}

/** Facts derived from scenario fields. User answers always win. */
function engineInputs(s: NormalizedScenario) {
  const derived: Record<string, AnswerValue> = {};
  const assumptions: string[] = [];
  const projectFacts: Record<string, unknown> = {};
  if (s.square_feet != null) {
    derived.Q_PHYSICAL_LOCATION = true;
    assumptions.push(`Operates from a physical location (${s.square_feet.toLocaleString("en-US")} sq ft stated).`);
  }
  if (s.employees != null) {
    derived.Q_EMPLOYEES_HIRED = s.employees > 0;
    derived.Q_EMPLOYEE_COUNT = employeeBucket(s.employees);
    assumptions.push(`${s.employees} employees stated → employer obligations evaluated.`);
  }
  if (s.renovation === "none") derived.Q_RENOVATIONS = false;
  if (s.renovation === "interior" || s.renovation === "structural") {
    derived.Q_RENOVATIONS = true;
    projectFacts.project_type = "renovation";
    if (s.renovation === "structural") projectFacts.structural_work = true;
    assumptions.push(s.renovation === "structural" ? "Renovation includes structural elements." : "Renovation stated; structural scope not confirmed.");
  }
  if (s.business_type && /manufactur/i.test(s.business_type)) derived.Q_PRODUCTS_MANUFACTURED = true;
  if (s.business_status === "unknown") assumptions.push("Registration status not confirmed — evaluated as a new business; existing registrations may change items to 'verify existing'.");
  return { answers: { ...derived, ...s.answers }, projectFacts, assumptions };
}

const GROUP_BY_STAGE: Record<string, AssessedRequirement["group"]> = {
  entity_formation: "Business registrations",
  tax_registration: "Business registrations",
  employment: "Business registrations",
  municipal: "Operating permits",
  property_zoning: "Construction & site authorization",
  conditional_reviews: "Construction & site authorization",
  operating_permits: "Operating permits",
  health_safety: "Operating permits",
};

const CONSTRUCTION_RE = /construc|zonif|zoning|uso\b|land use|demoli|structural|plans?\b/i;
function groupFor(stage: string | undefined, name: string): AssessedRequirement["group"] {
  if (CONSTRUCTION_RE.test(name)) return "Construction & site authorization";
  return (stage && GROUP_BY_STAGE[stage]) || "Operating permits";
}

function mapApplicability(r: ClassifiedRequirement): Applicability | null {
  switch (r.applicability) {
    case "required": return "supported";
    case "not_applicable": case "completed": return null;
    case "conditional": case "needs_more_information": case "blocked":
      return r.missingFacts && r.missingFacts.length ? "unresolved" : "conditional";
    default: return "conditional";
  }
}

function citationsFor(ruleId: string | undefined, docId: string): Citation[] {
  const out: Citation[] = [];
  const rule = ruleId ? kb.rules.find((r) => r.id === ruleId) : undefined;
  const rr = rule as unknown as { citation?: string | null; citation_url?: string | null } | undefined;
  if (rr?.citation && rr.citation.trim()) out.push({ label: rr.citation.trim(), url: rr.citation_url || null });
  const doc = kb.documents.find((d) => d.id === docId);
  if (doc?.citation && doc.citation.trim() && !out.some((c) => c.label === doc.citation!.trim())) out.push({ label: doc.citation.trim(), url: null });
  return out;
}

// Curated priority of KB questions per industry keyword; generic premises first.
const QUESTION_PRIORITY: Array<[RegExp, string[]]> = [
  [/beverage|brew|distill|winer/i, ["Q_ALCOHOL_MANUFACTURED"]],
  [/food|restaurant|bakery|cafe|caf|bar\b|catering/i, ["Q_FOOD_PREPARED", "Q_ALCOHOL_SOLD"]],
  [/manufactur|industrial|recycl|distribut|wholesale/i, ["Q_IMPORT_EXPORT"]],
  [/retail|store|shop/i, ["Q_TOBACCO_SOLD", "Q_ALCOHOL_SOLD"]],
  [/./, ["Q_COMMERCIAL_SIGNAGE", "Q_IMPORT_EXPORT"]],
];

const yesNo = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

export function mapFocus(s: NormalizedScenario): AssessmentResult["map_focus"] {
  if (s.site) return { latitude: s.site.latitude, longitude: s.site.longitude, zoom: 16 };
  const f = s.municipality ? municipioFocus(s.municipality) : null;
  return f ? { ...f, zoom: 13 } : { latitude: 18.22, longitude: -66.45, zoom: 8 };
}

export function approximateSite(s: NormalizedScenario): ApproximateSite | null {
  if (s.site || !s.municipality) return null;
  const f = municipioFocus(s.municipality);
  return f ? { ...f, municipality: s.municipality, approximate: true, basis: `Downtown ${s.municipality} (barrio-pueblo) — approximate; drag the pin to the exact site.` } : null;
}

export function assessScenario(scenario: NormalizedScenario, dropped: string[] = [], now = new Date()): AssessmentResult {
  const versions = { generated_at: now.toISOString(), server: `smartpr-chatgpt@${CHATGPT_SERVER_VERSION}`, engine: "smartpr-rules-engine (portal intake)", kb: kbVersion(), rules: kb.rules.length };
  const coverage_limits = [
    "Puerto Rico state and municipal requirements in SmartPR's knowledge graph only; federal coverage is partial.",
    "Preliminary triage, not legal advice. Confirm every item with the issuing agency.",
    scenario.site
      ? "The map pin sets the municipality (Census boundaries). Site chips (zoning, flood, landslide, coastal) come from official map services when they answer in time; the full site report is in SmartPR."
      : "No parcel, zoning-map, flood-zone or site analysis in this preview.",
  ];
  const unresolved_facts: string[] = [];
  const questions: ClarifyingQuestion[] = [];

  if (!scenario.business_type && scenario.business_type_candidates.length === 0) {
    return {
      status: "unsupported", tier: "free_preview", scenario, assumptions: [], unresolved_facts: ["business activity"],
      clarifying_questions: [], requirements: [], gated: { hidden_requirement_count: 0, locked_features: [] },
      counts: { supported: 0, conditional: 0, unresolved: 0, total: 0 }, coverage_limits, dropped_answers: dropped, map_focus: mapFocus(scenario), approximate_site: approximateSite(scenario), versions,
      message: scenario.business_type_input
        ? `SmartPR doesn't cover "${scenario.business_type_input}" yet. Describe the activity differently (e.g. "furniture manufacturing", "restaurant").`
        : "Describe the business activity to start a Puerto Rico requirements preview.",
    };
  }

  if (!scenario.business_type) {
    unresolved_facts.push("specific business activity");
    questions.push({ id: "activity", kind: "scenario", question: "What will you do, specifically?", why: "Operating permits depend on the exact activity.", options: scenario.business_type_candidates.map((c) => ({ value: c, label: c })) });
  }
  if (!scenario.municipality) {
    unresolved_facts.push("municipality");
    questions.push({ id: "municipality", kind: "scenario", question: "Pin the site on the map (or type a municipality)", why: "Municipal licenses (patente) and permit offices depend on it.", options: [] });
  }
  if (scenario.business_status === "unknown") {
    unresolved_facts.push("existing registrations");
    questions.push({ id: "business_status", kind: "scenario", question: "Is the business already registered?", why: "Existing registrations change items to verify/amend.", options: [{ value: "new", label: "Not yet registered" }, { value: "existing", label: "Already registered" }] });
  }
  if (scenario.renovation === "interior" || scenario.renovation === "unknown") {
    unresolved_facts.push(scenario.renovation === "unknown" ? "renovation scope" : "structural work");
    questions.push({ id: "structural", kind: "scenario", question: scenario.renovation === "unknown" ? "Will you renovate the space?" : "Will you modify structural elements?", why: "Construction authorization depends on the renovation scope.", options: [{ value: "none", label: "No renovation" }, { value: "interior", label: "Interior / non-structural" }, { value: "structural", label: "Structural changes" }] });
  }

  const { answers, projectFacts, assumptions } = engineInputs(scenario);
  if (scenario.site) {
    const st = scenario.site;
    assumptions.unshift(`Municipality from map pin: ${st.barrio ? `${st.barrio}, ` : ""}${st.municipality} (${st.source}).`);
    if (st.near_boundary) assumptions.unshift(`Pin is ~${st.boundary_distance_m} m from a municipal boundary — confirm the municipality.`);
  }
  const businessStatus: BusinessStatus = scenario.business_status === "existing" ? "existing" : "new";
  const { requirements: generated } = runRulesEngine(kb, {
    municipalityName: scenario.municipality,
    businessTypeName: scenario.business_type,
    answers,
    businessStatus,
    projectFacts,
  });
  const classified = classifyEngineRequirements(generated, { kb, businessStatus });

  const reqs: AssessedRequirement[] = [];
  const seenDocs = new Set<string>();
  for (const r of classified) {
    const a = mapApplicability(r);
    if (!a || seenDocs.has(r.document_id)) continue;
    seenDocs.add(r.document_id);
    const ext = r as ClassifiedRequirement & { agency_url?: string | null; download_url?: string | null };
    const missing = (r.missingFacts || []).map(String);
    const next: string[] = [];
    if (missing.length) next.push(`Confirm: ${missing.join(", ")}`);
    if (r.applicability === "verify_existing") next.push("Verify you already hold this; amend if details changed.");
    else if (ext.download_url) next.push("Review the official form linked by the agency.");
    next.push(`Confirm requirements with ${r.agency}.`);
    reqs.push({
      id: r.document_id, name: r.document_name, agency: r.agency,
      group: groupFor(r.stage, r.document_name),
      applicability: a,
      why: r.reason || "Triggered by the scenario facts.",
      evidence: (r.triggerFacts || []).filter((t) => t.startsWith("fact:") || t.startsWith("rule:")).slice(0, 4),
      dependencies: missing,
      next_steps: next,
      citations: citationsFor(r.source_rule_id, r.document_id),
      official_source_url: ext.agency_url || null,
    });
  }

  // Unanswered KB questions → unresolved items (never a silent "no").
  const industry = `${scenario.business_type || ""} ${scenario.business_type_input || ""}`;
  // Only questions with real question_trigger rules in the KB produce items.
  const prio = [...new Set(QUESTION_PRIORITY.filter(([re]) => re.test(industry)).flatMap(([, ids]) => ids))];
  let unresolvedAdded = 0;
  for (const qid of prio) {
    if (qid in answers) continue;
    const q = kb.questions.find((qq) => qq.id === qid);
    const rules = kb.rules.filter((r) => r.rule_type === "question_trigger" && r.question_id === qid && (!r.business_type_id || kb.businessTypes.find((b) => b.id === r.business_type_id)?.name === scenario.business_type));
    if (!q || !rules.length) continue;
    const affected: string[] = [];
    for (const rule of rules) {
      const doc = kb.documents.find((d) => d.id === rule.requires_document_id);
      if (!doc || seenDocs.has(doc.id) || unresolvedAdded >= MAX_UNRESOLVED_FROM_QUESTIONS) continue;
      seenDocs.add(doc.id); unresolvedAdded++; affected.push(doc.name);
      reqs.push({
        id: doc.id, name: doc.name, agency: doc.agency,
        group: groupFor(undefined, doc.name),
        applicability: "unresolved",
        why: `Depends on an unanswered fact: ${q.question}`,
        evidence: [`rule:${rule.id}`], dependencies: [q.id], next_steps: [`Answer: ${q.question}`],
        citations: citationsFor(rule.id, doc.id), official_source_url: doc.agency_url || null,
      });
    }
    if (affected.length && questions.length < MAX_CLARIFYING_QUESTIONS) {
      unresolved_facts.push(q.question.replace(/\?$/, "").toLowerCase());
      questions.push({ id: q.id, kind: "kb", question: q.question, why: `Determines: ${affected.slice(0, 2).join(", ")}`, options: q.type === "boolean" ? yesNo : (q.options || []).map((o) => ({ value: o, label: o })) });
    }
  }

  const rank: Record<Applicability, number> = { supported: 0, unresolved: 1, conditional: 2 };
  reqs.sort((a, b) => rank[a.applicability] - rank[b.applicability]);
  // Free preview: always surface unresolved items (they drive clarification),
  // fill the rest by posture. Everything beyond the limit stays server-side.
  const unresolvedFirst = reqs.filter((r) => r.applicability === "unresolved").slice(0, 3);
  // …and at least one item per group so the preview shows the full shape.
  const groupLeads = (["Business registrations", "Construction & site authorization", "Operating permits"] as const)
    .map((g) => reqs.find((r) => r.group === g && !unresolvedFirst.includes(r)))
    .filter((r): r is AssessedRequirement => !!r);
  const picked = [...unresolvedFirst, ...groupLeads];
  const visible = [...picked, ...reqs.filter((r) => !picked.includes(r))]
    .slice(0, FREE_PREVIEW_LIMIT)
    .sort((a, b) => rank[a.applicability] - rank[b.applicability]);
  const counts = {
    supported: reqs.filter((r) => r.applicability === "supported").length,
    conditional: reqs.filter((r) => r.applicability === "conditional").length,
    unresolved: reqs.filter((r) => r.applicability === "unresolved").length,
    total: reqs.length,
  };
  const status = unresolved_facts.length || counts.unresolved ? "partial" : "complete";
  return {
    status, tier: "free_preview", scenario, assumptions, unresolved_facts,
    clarifying_questions: questions.slice(0, MAX_CLARIFYING_QUESTIONS + 1),
    requirements: visible,
    gated: { hidden_requirement_count: reqs.length - visible.length, locked_features: ["full requirement list", "sequencing & dependencies across agencies", "site analysis (flood zone, zoning, parcel)", "downloadable report", "evidence tracking in SmartPR"] },
    counts, coverage_limits, dropped_answers: dropped, map_focus: mapFocus(scenario), approximate_site: approximateSite(scenario), versions,
    message: status === "partial"
      ? `Preliminary: ${counts.total} requirements identified (${counts.unresolved} unresolved). Answer the clarifying questions to refine.`
      : `Preliminary: ${counts.total} requirements identified for this scenario.`,
  };
}

/** Human-readable clarifying answers (question → answer) for the handoff
 *  review page. Server-side only (keeps the KB out of client bundles). */
export function describeAnswers(s: NormalizedScenario): Array<{ id: string; question: string; answer: string }> {
  return Object.entries(s.answers || {}).map(([id, v]) => {
    const q = kb.questions.find((qq) => qq.id === id);
    const answer = v === true ? "Yes" : v === false ? "No" : Array.isArray(v) ? v.join(", ") : String(v);
    return { id, question: q?.question ?? id, answer };
  });
}
