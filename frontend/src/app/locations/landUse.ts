// ============================================================================
// Land-use intelligence (pure): "Can this activity happen on this parcel,
// under what conditions, what approvals does it trigger, and why?"
//
//   ProposedActivity ─┐
//   Parcel facts ─────┼─→ ZoningDistrict ─→ UsePermission ─→ RegulatorySource
//   Knowledge graph ──┘        │
//                              └─→ SiteRule (flood, coastal, karst…) ─→ Approval (document) ─→ Evidence
//
// Every determination comes from a knowledge-graph node with a source
// (use_permission, site_rule, scenario mapping). Nothing here invents a
// permission: no verified rule → INSUFFICIENT INFORMATION + a coverage gap
// that shows up as QA work. An LLM never decides compatibility.
// ============================================================================

import { formatShare, SMALL_SHARE } from "./coverage.ts";

type Node = Record<string, unknown> & { id: string };
type Bi = { en: string; es: string };
const bi = (en: string, es: string = en): Bi => ({ en, es });
const s = (v: unknown) => (v == null ? "" : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------------------------------------------------------------------------
// Proposed activity
// ---------------------------------------------------------------------------

export type Construction = "new" | "addition" | "substantial_improvement" | "renovation" | "none" | "demolition";

export interface ProposedActivity {
  raw: string;
  /** land_use node id (LU_…) or null when not recognised. */
  use: string | null;
  useName: string | null;
  matched: string | null;
  /** null = not stated (a follow-up question may ask). */
  construction: Construction | null;
  changeOfUse: boolean;
  facts: { rooms?: number; units?: number; area_m2?: number; area_sqft?: number; kw?: number; stories?: number };
  /**
   * Project components evaluated separately (true = stated, false = stated not part of
   * the project, null = not stated). Never inferred from the use alone.
   */
  components: ProjectComponents;
}

export interface ProjectComponents {
  pool: boolean | null;
  /** Pool open to the public / shared (Regla 4.3.11 covers public pools only). */
  pool_public: boolean | null;
  demolition: boolean | null;
  subdivision: boolean | null;
  /** Clearing, grading and excavation disturbing ≥ 1 acre (NPDES threshold). */
  disturbance_1acre: boolean | null;
}
export type ComponentQuestion = "demolition" | "subdivision" | "disturbance_1acre" | "pool_public";

// "New 3,200-square-foot single-family residence", "nueva casa": new construction.
const NEW_BUILDING = /\b(?:new|nuev[oa]s?)\b(?:[\s,.-]+[\w.,-]+){0,5}?[\s-]+(?:home|house|residence|dwelling|building|structure|construction|hotel|warehouse|apartments?|duplex|casa|residencia|vivienda|edificio|estructura|construcci[oó]n)\b/i;
const CONSTRUCTION_CUES: Array<[RegExp, Construction]> = [
  [/\b(demolish|demolition|tear down|demoler|demolici[oó]n)\b/i, "demolition"],
  [NEW_BUILDING, "new"],
  [/\b(build|built|construct|construction|erect|develop(?:ing)? a new|new building|ground[- ]up|construir|construcci[oó]n|edificar|levantar)\b/i, "new"],
  [/\b(expand|expansion|addition|add (?:a|an|\d)|extend|ampliar|ampliaci[oó]n|a[nñ]adir)\b/i, "addition"],
  [/\b(renovat\w*|remodel\w*|rehabilit\w*|gut|remodelar|renovar)\b/i, "renovation"],
  [/\b(convert|conversion|turn (?:the|an|a) .* into|change (?:the )?use|convertir|cambio de uso|cambiar el uso)\b/i, "none"],
  [/\b(open|operate|run|start|abrir|operar|establecer|existing building|existing space|local existente|edificio existente)\b/i, "none"],
];

const SQFT = /(\d+(?:\.\d+)?)[\s-]*(?:sq\.? ?ft\.?|square[\s-]+f(?:ee|oo)t|sf|pies cuadrados|p2)\b/i;

/** Parse a natural-language description into a structured activity (deterministic). */
export function parseProposedActivity(text: string, landUses: Node[]): ProposedActivity {
  const raw = (text ?? "").trim();
  const hay = ` ${fold(raw)} `;
  let best: { node: Node; alias: string; at: number } | null = null;
  for (const lu of landUses) {
    for (const alias of arr(lu.aliases)) {
      const a = fold(alias);
      const re = new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`);
      const m = re.exec(hay);
      // Longer aliases win ("utility-scale solar" over "solar"); then the last-mentioned target
      // ("convert residential use to daycare" → daycare).
      if (m && (!best || a.length > fold(best.alias).length || (a.length === fold(best.alias).length && m.index > best.at))) best = { node: lu, alias, at: m.index };
    }
  }
  // "convert X into Y" / "change X to Y": the target use follows into/to/a/en.
  const target = /\b(?:into|to|a|en|para)\s+(?:an?\s+|un[a]?\s+)?([a-zÀ-ſ -]{3,40})$/i.exec(raw.replace(/[.!?]+$/, ""));
  if (target) {
    for (const lu of landUses) for (const alias of arr(lu.aliases)) if (fold(target[1]!).includes(fold(alias)) && (!best || fold(alias).length >= 4)) best = { node: lu, alias, at: 1e9 };
  }
  let construction: Construction | null = null;
  for (const [re, c] of CONSTRUCTION_CUES) if (re.test(raw)) { construction = c; break; }
  if (!construction && best && s(best.node.construction_default)) construction = s(best.node.construction_default) as Construction;
  const changeOfUse = /\b(convert|conversion|change (?:the )?(?:\w+ )?use|convertir|cambio de uso)\b/i.test(raw);
  // Demolition stated as part of a larger project ("demolish the old house and build…").
  if (construction === "demolition" && NEW_BUILDING.test(raw)) construction = "new";
  const components: ProjectComponents = {
    pool: /\b(pool|swimming pool|piscina)\b/i.test(raw) ? true : null,
    pool_public: /\b(public pool|community pool|piscina p[uú]blica)\b/i.test(raw) ? true : /\b(private pool|piscina privada)\b/i.test(raw) ? false : null,
    demolition: /\b(demolish|demolition|tear down|demoler|demolici[oó]n)\b/i.test(raw) ? true : /\b(vacant|empty|undeveloped|bare) (lot|land|parcel)\b|\b(solar|terreno) (vac[ií]o|bald[ií]o)\b/i.test(raw) ? false : null,
    subdivision: /\b(subdivid\w*|segregat\w*|segregar|lotificaci[oó]n|lotificar)\b/i.test(raw) ? true : null,
    disturbance_1acre: null,
  };
  const num = (re: RegExp) => { const m = re.exec(raw.replace(/,/g, "")); return m ? Number(m[1]) : undefined; };
  const kw = num(/(\d+(?:\.\d+)?)\s*kw\b/i) ?? ((x) => (x ? x * 1000 : undefined))(num(/(\d+(?:\.\d+)?)\s*mw\b/i));
  return {
    raw,
    use: best ? best.node.id : null,
    useName: best ? s(best.node.name) : null,
    matched: best ? best.alias : null,
    construction,
    changeOfUse,
    facts: {
      rooms: num(/(\d+)[- ]?(?:rooms?|keys|habitaciones|cuartos)\b/i),
      units: num(/(\d+)[- ]?(?:units?|apartments?|unidades|apartamentos)\b/i),
      area_m2: num(/(\d+(?:\.\d+)?)\s*(?:m2|m²|square met(?:er|re)s?|metros cuadrados)\b/i) ?? ((x) => (x ? Math.round(x * 0.092903) : undefined))(num(SQFT)),
      area_sqft: num(SQFT),
      kw,
      stories: num(/(\d+)[- ]?(?:stor(?:y|ies|eys?)|floors?|levels?|pisos|niveles|plantas)\b/i),
    },
    components,
  };
}

// ---------------------------------------------------------------------------
// Parcel facts the rules read
// ---------------------------------------------------------------------------

export interface ParcelDistrict { code: string; name: string | null; share: number | null; area_m2: number | null; overlays: string[] }
export interface ParcelFacts {
  catastro: string | null;
  municipality: string;
  districts: ParcelDistrict[];
  zoningStatus: "verified" | "no_mapped" | "unable";
  flood: { zones: Array<{ zone: string; sfha: boolean; floodway: boolean; share: number | null; subtype?: string | null }>; status: "verified" | "no_mapped" | "unable" };
  coastal: "inside" | "outside" | "unable";
  wetlands: "yes" | "no" | "unable";
  protectedArea: "yes" | "no" | "unable";
  reserve: "yes" | "no" | "unable";
  archaeology: "yes" | "no" | "unable";
  historic: "yes" | "no" | "unable";
  landslideHigh: boolean;
  landClass: string | null;
  /** Upper slope % of the mapped soil unit at the pin (USDA), when known. */
  soilSlopeMaxPct?: number | null;
  /** Overlay zones on the parcel with their parcel share (cali_sobre), when known. */
  overlays?: Array<{ code: string; name: string | null; share: number | null }>;
  /** JP advisory flood map at the pin (separate from the effective FEMA map). */
  floodAdvisory?: "yes" | "no" | "unable" | null;
  /** Which plan / rules / permit office govern (plan_currency.json); unknown when not researched. */
  governance?: Governance | null;
}

export interface Governance {
  municipality: string;
  plan: string | null;
  rules: "identified" | "unresolved" | "unknown";
  rulesText: string | null;
  rulesUnresolved: string | null;
  permitAuthority: "identified" | "unresolved" | "unknown";
  permitNote: string | null;
  permitObtainFrom: string | null;
  documents: Array<{ title: string; url: string; checked_on?: string; note?: string }>;
}

// ---------------------------------------------------------------------------
// Output model
// ---------------------------------------------------------------------------

export type Compatibility = "permitted" | "conditional" | "discretionary" | "potentially_prohibited" | "insufficient" | "professional_review";
export const COMPATIBILITY_TEXT: Record<Compatibility, Bi> = {
  permitted: bi("Permitted / as-of-right", "Permitido / ministerial"),
  conditional: bi("Conditional", "Condicionado"),
  discretionary: bi("Discretionary approval required", "Requiere aprobación discrecional"),
  potentially_prohibited: bi("Potentially prohibited", "Potencialmente prohibido"),
  insufficient: bi("Insufficient information", "Información insuficiente"),
  professional_review: bi("Professional review required", "Requiere revisión profesional"),
};
const RANK: Record<Compatibility, number> = { permitted: 0, conditional: 1, discretionary: 2, professional_review: 3, insufficient: 3, potentially_prohibited: 4 };

export type Certainty = "confirmed" | "likely" | "review";
export interface PathStep { kind: "activity" | "parcel" | "district" | "rule" | "source" | "approval" | "evidence" | "fact"; label: string; ref?: string }
export interface SourceRef { id: string; name: string; citation: string; url: string | null }

export interface DistrictDetermination {
  code: string; share: number | null; districtId: string | null; districtName: string | null;
  outcome: Compatibility; permissionId: string | null; conditions: string[]; citation: string | null; sources: SourceRef[];
  equivalence: string | null; sliver: boolean; gap: string | null;
  /** Raw rule result: the permission outcome, "consulta" (unlisted use, consulta de ubicación) or "not_listed". */
  rawOutcome?: string | null;
  /** Mapped municipal code resolved through a municipal equivalence table (e.g. Guaynabo R-5-T → R-C). */
  via?: { table: string; page: string | null; rcCode: string; sourceIds: string[] } | null;
  /** Road / right-of-way district (VIAL): not a development district, never decisive. */
  road?: boolean;
}

export type RequirementStatus = "required" | "potentially_required" | "unresolved";
export const REQUIREMENT_TEXT: Record<RequirementStatus, Bi> = {
  required: bi("Required", "Requerido"),
  potentially_required: bi("Potentially required", "Potencialmente requerido"),
  unresolved: bi("Unresolved — fact needed", "Sin resolver — falta un dato"),
};
export interface ApprovalFinding {
  id: string; name: string; status: Certainty; trigger: string; agency: string;
  documentId: string | null; ruleId: string; evidence: string[]; sources: SourceRef[]; citation: string; constraint: string;
  path: PathStep[];
  /** Required / potentially required / unresolved (a needed project fact is unknown). */
  requirement?: RequirementStatus;
  /** Project component that triggers it (construction, pool, demolition, earthwork…). */
  component?: string | null;
  /** Page of the provision, when the source is paginated. */
  page?: string | null;
  prerequisites?: string[];
  sequence?: string | null;
  /** The project fact that would settle an unresolved approval. */
  needs?: Bi | null;
  /** The citation itself is not verified to a section ("Regla to confirm" in the graph). */
  citationGap?: Bi | null;
}

/** Decision vocabulary for the lead summary (separate from the raw rule outcome). */
export type DecisionCompatibility = "supported_permitted" | "conditional_or_discretionary" | "supported_prohibited" | "undetermined";
export const DECISION_TEXT: Record<DecisionCompatibility, Bi> = {
  supported_permitted: bi("Supported as permitted", "Sustentado como permitido"),
  conditional_or_discretionary: bi("Conditional / discretionary approval indicated", "Se indica aprobación condicionada o discrecional"),
  supported_prohibited: bi("Supported as not permitted", "Sustentado como no permitido"),
  undetermined: bi("Undetermined", "Indeterminado"),
};
/** An evidence gap with its research task: what is missing, why it matters, how to close it, what stays blocked. */
export interface EvidenceGap {
  id: string;
  label: Bi;
  missing: Bi;
  why: Bi;
  obtain: Bi;
  from: string | null;
  blocks: Bi;
  kind: "authority" | "overlay" | "project_fact" | "placement" | "source" | "rule_coverage" | "citation";
}
export interface GoverningDistrict {
  code: string; share: number | null; name: string | null; small: boolean; road: boolean;
  rcCode: string | null; rcName: string | null; via: string | null; meaning: Bi; effect: Bi; citation: string | null; sources: SourceRef[];
}
export interface GoverningOverlay {
  code: string; share: number | null; name: string | null; known: boolean;
  meaning: Bi; effect: "adds" | "modifies" | "restricts" | "may_modify_or_restrict" | "unknown"; effectText: Bi; basis: string | null;
  provisions: "encoded" | "not_obtained" | "unknown"; obtainFrom: string | null; sources: SourceRef[];
}
export interface ProjectDecision {
  use: Bi;
  scope: Bi;
  components: Array<{ id: string; label: Bi; value: Bi; status: "stated" | "not_part" | "unknown" }>;
  compatibility: { status: DecisionCompatibility; label: Bi; reason: Bi; basis: "rule" | "none";
    /** The rule reading kept apart from the conclusion (shown even when the conclusion is held back). */
    ruleReading: Bi | null; blockedBy: string[] };
  governing: { plan: string | null; rules: Governance["rules"]; rulesText: string | null; permitAuthority: Governance["permitAuthority"]; permitNote: string | null; districts: GoverningDistrict[]; overlays: GoverningOverlay[]; standards: Bi | null };
  constraints: Array<{ id: string; label: Bi; detail: Bi; placement: boolean }>;
  unresolved: EvidenceGap[];
  pathway: { summary: Bi; steps: Bi[]; complete: false; completeness: Bi; nextAction: Bi };
}

export interface LandUseAnalysis {
  activity: ProposedActivity;
  compatibility: { outcome: Compatibility; baseOutcome: Compatibility | null; reasons: string[]; confidence: "high" | "medium" | "low"; path: PathStep[] };
  districts: DistrictDetermination[];
  standards: Array<{ id: string; name: string; value: string; citation: string; sources: SourceRef[] }>;
  approvals: ApprovalFinding[];
  evidence: string[];
  unresolved: Array<{ kind: "missing_fact" | "missing_rule" | "unable_to_verify" | "data_conflict"; text: string }>;
  questions: Array<{ id: "construction" | "use" | ComponentQuestion; text: Bi; options: Array<{ value: string; label: Bi }> }>;
  coverageGaps: Array<{ kind: "zoning_district" | "use_permission" | "development_standard" | "source"; detail: string }>;
  rulesEvaluated: Array<{ id: string; name: string; triggered: boolean; why: string }>;
  flags: Array<{ id: string; label: Bi; value: Bi; tone: "ok" | "info" | "attention" | "hazard" | "unknown" }>;
  complexity: { level: "low" | "moderate" | "high"; score: number; factors: Array<{ factor: string; points: number }> };
  /** Project decision summary — the single reasoning result the report, copy and exports read. */
  decision?: ProjectDecision;
}

export interface LandUseGraph {
  zoningDistricts: Node[]; landUses: Node[]; usePermissions: Node[]; developmentStandards: Node[]; siteRules: Node[];
  documents: Node[]; sources: Node[];
  /** Municipal POT code → RC district (RC 2023 Sección 6.1.1.4 tables). */
  districtEquivalences?: Node[];
  /** Overlay zones and how they relate to the base district. */
  overlayDistricts?: Node[];
}

// ---------------------------------------------------------------------------

/** Districts covering less than this share are small intersections: listed, not used for the principal determination. */
const SLIVER = SMALL_SHARE;
const CONSTRUCTIVE: Construction[] = ["new", "addition", "substantial_improvement"];

function srcRefs(g: LandUseGraph, ids: string[]): SourceRef[] {
  return ids.map((id) => { const n = g.sources.find((x) => x.id === id); return { id, name: n ? s(n.name || n.title) : id, citation: n ? s(n.citation) : "", url: n ? s(n.url) || null : null }; });
}

/** Map a calificación code to a graph district via its aliases (RC equivalence tables). */
export function resolveDistrict(g: LandUseGraph, code: string): Node | null {
  const c = fold(code).replace(/\s+/g, "");
  return g.zoningDistricts.find((d) => fold(s(d.code)).replace(/\s+/g, "") === c || arr(d.aliases).some((a) => fold(a).replace(/\s+/g, "") === c)) ?? null;
}

/**
 * Resolve a mapped code for a municipality: the municipal equivalence table
 * (RC 2023 Sección 6.1.1.4) first — a municipal "R-5-T" is not the RC "R-5" —
 * then the RC district codes themselves.
 */
export function resolveDistrictFor(g: LandUseGraph, code: string, municipality: string): { node: Node | null; equivalence: Node | null } {
  const c = fold(code).replace(/\s+/g, "");
  const eq = (g.districtEquivalences ?? []).find((e) => fold(s(e.municipality)) === fold(municipality) && fold(s(e.map_code)).replace(/\s+/g, "") === c) ?? null;
  if (eq) return { node: resolveDistrict(g, s(eq.rc_code)), equivalence: eq };
  return { node: resolveDistrict(g, code), equivalence: null };
}

/** Road / right-of-way codes: not a development district. */
export const isRoadCode = (code: string) => /^(vial|v|sistema vial)$/i.test(code.trim());

function factValue(fact: string, ctx: Record<string, unknown>): unknown { return ctx[fact]; }
function clause(c: { fact: string; op: string; value?: unknown }, ctx: Record<string, unknown>): boolean | null {
  const v = factValue(c.fact, ctx);
  if (v === undefined || v === null) return null;
  switch (c.op) {
    case "truthy": return Boolean(v);
    case "falsy": return !v;
    case "equals": return v === c.value;
    case "in": return Array.isArray(c.value) && c.value.includes(v);
    case "includes": return Array.isArray(v) && v.includes(c.value);
    default: return null;
  }
}
function evalWhen(when: unknown, ctx: Record<string, unknown>): boolean | null {
  const w = (when ?? {}) as { all?: Array<{ fact: string; op: string; value?: unknown }>; any?: Array<{ fact: string; op: string; value?: unknown }> };
  if (w.all) { const r = w.all.map((c) => clause(c, ctx)); return r.some((x) => x === false) ? false : r.some((x) => x === null) ? null : true; }
  if (w.any) { const r = w.any.map((c) => clause(c, ctx)); return r.some((x) => x === true) ? true : r.some((x) => x === null) ? null : false; }
  return null;
}

export function analyzeLandUse(parcel: ParcelFacts, activity: ProposedActivity, g: LandUseGraph, scenarioPaths: Array<{ id: string; name: string; permitId: string | null; permitName: string | null; sources: SourceRef[]; citation: string }> = []): LandUseAnalysis {
  const unresolved: LandUseAnalysis["unresolved"] = [];
  const gaps: LandUseAnalysis["coverageGaps"] = [];
  const questions: LandUseAnalysis["questions"] = [];
  const rulesEvaluated: LandUseAnalysis["rulesEvaluated"] = [];
  const parcelStep: PathStep = { kind: "parcel", label: parcel.catastro ? `Parcel ${parcel.catastro}` : `Site in ${parcel.municipality}`, ref: parcel.catastro ?? undefined };
  const actStep: PathStep = { kind: "activity", label: activity.useName ? `Proposed: ${activity.useName}` : `Proposed: "${activity.raw}"`, ref: activity.use ?? undefined };

  if (!activity.use) {
    questions.push({ id: "use", text: bi("Which of these best describes the planned use?", "¿Cuál describe mejor el uso planificado?"), options: g.landUses.map((u) => ({ value: u.id, label: bi(s(u.name)) })) });
  }

  // ---- Zoning → use permission ---------------------------------------------
  const districts: DistrictDetermination[] = parcel.districts.map((d) => {
    const { node: zd, equivalence: eqNode } = resolveDistrictFor(g, d.code, parcel.municipality);
    const sliver = d.share !== null && d.share < SLIVER;
    const via = eqNode ? { table: s(eqNode.citation_section), page: s(eqNode.page) || null, rcCode: s(eqNode.rc_code), sourceIds: arr(eqNode.source_ids) } : null;
    if (isRoadCode(d.code)) {
      return { code: d.code, share: d.share, districtId: null, districtName: d.name ?? "Sistema vial", outcome: "insufficient", permissionId: null, conditions: [], citation: null, sources: [], equivalence: null, sliver, gap: null, road: true, via: null };
    }
    if (!zd) {
      if (!sliver) gaps.push({ kind: "zoning_district", detail: `No graph district for calificación "${d.code}"${d.name ? ` (${d.name})` : ""} in ${parcel.municipality}: add it with its RC 2023 equivalence.` });
      return { code: d.code, share: d.share, districtId: null, districtName: d.name, outcome: "insufficient", permissionId: null, conditions: [], citation: null, sources: [], equivalence: null, sliver, gap: `No verified district rules for ${d.code}`, via };
    }
    const perm = activity.use ? g.usePermissions.find((p) => s(p.zoning_district_id) === zd.id && s(p.land_use_id) === activity.use && s(p.verification) === "verified_text") : undefined;
    const consulta = !!activity.use && !perm && s(zd.unlisted_uses) === "consulta";
    if (activity.use && !perm && !consulta && !sliver) gaps.push({ kind: "use_permission", detail: `No verified use permission for ${activity.useName} in ${s(zd.code)} (${s(zd.name)}).` });
    const outcome: Compatibility = consulta ? "discretionary"
      : !perm ? "insufficient"
      : s(perm.outcome) === "permitted" ? "permitted"
      : s(perm.outcome) === "conditional" ? "conditional"
      : s(perm.outcome) === "exception" ? "discretionary"
      : "potentially_prohibited";
    const rawOutcome = perm ? s(perm.outcome) : !activity.use ? null : consulta ? "consulta" : s(zd.unlisted_uses) === "not_listed" ? "not_listed" : null;
    return {
      code: d.code, share: d.share, districtId: zd.id, districtName: s(zd.name), outcome, permissionId: perm?.id ?? null,
      conditions: perm ? arr(perm.conditions) : consulta ? ["This use is not listed for the district; it may be considered through a consulta de ubicación — approval is not assured."] : [],
      citation: perm ? `RC 2023 ${s(perm.citation_section)}` : consulta ? `RC 2023 ${s(zd.unlisted_citation)}` : null,
      sources: perm || consulta ? srcRefs(g, arr((perm ?? zd).source_ids)) : [], equivalence: via ? `${d.code} → ${via.rcCode} per RC 2023 ${via.table}${via.page ? ` (p. ${via.page})` : ""}` : s(zd.equivalence_note) || null, sliver,
      gap: perm || consulta || !activity.use ? null : `No verified rule for this use in ${s(zd.code)}`, rawOutcome, via,
    };
  });
  if (parcel.zoningStatus !== "verified") unresolved.push({ kind: "unable_to_verify", text: "Zoning (calificación) could not be verified for this parcel." });
  const principal = districts.filter((d) => !d.sliver && !d.road);
  const decisive = principal.length ? principal : districts.filter((d) => !d.road);
  const base = decisive.length ? decisive.reduce<Compatibility>((acc, d) => (RANK[d.outcome] > RANK[acc] ? d.outcome : acc), "permitted") : "insufficient";
  const baseOutcome: Compatibility | null = activity.use ? base : null;

  // ---- Site rules ------------------------------------------------------------
  const sfhaShare = parcel.flood.zones.filter((z) => z.sfha).reduce((a, z) => a + (z.share ?? 0), 0);
  const overlayCodes = [...new Set(parcel.districts.flatMap((d) => d.overlays))];
  const ctx: Record<string, unknown> = {
    "flood.sfha_on_parcel": parcel.flood.status === "unable" ? null : parcel.flood.zones.some((z) => z.sfha),
    "flood.floodway_on_parcel": parcel.flood.status === "unable" ? null : parcel.flood.zones.some((z) => z.floodway),
    "coastal.inside": parcel.coastal === "unable" ? null : parcel.coastal === "inside",
    "overlay.codes": overlayCodes,
    "wetlands.on_parcel": parcel.wetlands === "unable" ? null : parcel.wetlands === "yes",
    "protected.on_parcel": parcel.protectedArea === "unable" ? null : parcel.protectedArea === "yes",
    "reserve.on_parcel": parcel.reserve === "unable" ? null : parcel.reserve === "yes",
    "archaeology.on_parcel": parcel.archaeology === "unable" ? null : parcel.archaeology === "yes",
    "historic.on_parcel": parcel.historic === "unable" ? null : parcel.historic === "yes",
    "use.outcome": principal.find((d) => d.rawOutcome)?.rawOutcome ?? null,
    "activity.use": activity.use,
    "activity.construction": activity.construction,
    "project.pool": activity.components.pool,
    "project.pool_public": activity.components.pool === false ? false : activity.components.pool_public,
    "project.demolition": activity.construction === "demolition" ? true : activity.components.demolition,
    "project.subdivision": activity.use === "LU_SUBDIVISION" ? true : activity.components.subdivision,
    "project.disturbance_1acre": activity.components.disturbance_1acre,
  };
  const approvals: ApprovalFinding[] = [];
  let needsConstruction = false;
  let protectionHit = false;
  const unresolvedComponentRules: Node[] = [];
  for (const r of g.siteRules) {
    const res = evalWhen(r.when, ctx);
    const usesConstruction = JSON.stringify(r.when ?? {}).includes("activity.construction");
    if (res === null && usesConstruction && activity.construction === null) needsConstruction = true;
    rulesEvaluated.push({ id: r.id, name: s(r.name), triggered: res === true, why: res === true ? "all conditions met" : res === false ? "a condition is not met" : "a needed fact is unknown" });
    // Component rules whose project fact is unknown are listed as unresolved, never dropped silently.
    if (res === null && s(r.requirement) && activity.use && (activity.construction === null || !usesConstruction)) unresolvedComponentRules.push(r);
    if (res !== true) continue;
    const partial = r.id === "SR_FLOOD_SFHA_CONSTRUCTION" ? sfhaShare > 0 && sfhaShare < 0.999 : false;
    const status = (s(partial ? r.certainty_partial : r.certainty_full) || "likely") as Certainty;
    if (s(r.constraint) === "protection") protectionHit = true;
    const doc = r.approval_document_id ? g.documents.find((d) => d.id === s(r.approval_document_id)) : undefined;
    const sources = srcRefs(g, arr(r.source_ids));
    if (doc && !sources.length && s(doc.citation)) sources.push({ id: doc.id, name: s(doc.name), citation: s(doc.citation), url: s(doc.citation_url) || null });
    const trigger = r.id === "SR_FLOOD_SFHA_CONSTRUCTION"
      ? `Proposed construction on a parcel that intersects FEMA ${parcel.flood.zones.filter((z) => z.sfha).map((z) => `Zone ${z.zone}${z.share !== null ? ` (${formatShare(z.share, true)} of the parcel)` : ""}`).join(", ")}.${partial ? " Required if the work falls in the mapped flood area." : ""}`
      : componentTrigger(r, activity) ?? s(r.name);
    const requirement: RequirementStatus = s(r.requirement) ? (partial ? "potentially_required" : s(r.requirement) as RequirementStatus) : status === "confirmed" ? "required" : status === "likely" ? "potentially_required" : "unresolved";
    approvals.push({
      requirement, component: s(r.component) || null, page: s(r.page) || null, prerequisites: arr(r.prerequisites), sequence: s(r.sequence) || null, needs: null,
      id: r.id, name: doc && !s(r.component) ? s(doc.name) : s(r.name), status, trigger, agency: s(r.agency) || s(doc?.agency),
      documentId: doc?.id ?? null, ruleId: r.id, evidence: arr(r.evidence), sources, citation: s(r.citation_section), constraint: s(r.constraint) || "documentation",
      path: [actStep, parcelStep, { kind: "fact", label: trigger }, { kind: "rule", label: s(r.name), ref: r.id }, ...sources.map((x) => ({ kind: "source" as const, label: `${x.name}${x.citation ? ` — ${x.citation}` : ""}`, ref: x.id })), ...(doc ? [{ kind: "approval" as const, label: s(doc.name), ref: doc.id }] : []), ...arr(r.evidence).map((e) => ({ kind: "evidence" as const, label: e }))],
    });
  }
  for (const r of unresolvedComponentRules) {
    const doc = r.approval_document_id ? g.documents.find((d) => d.id === s(r.approval_document_id)) : undefined;
    const sources = srcRefs(g, arr(r.source_ids));
    const needs = COMPONENT_NEEDS[s(r.id)] ?? null;
    approvals.push({
      id: r.id, name: s(r.name), status: "review", trigger: needs ? `Depends on: ${needs.en}` : s(r.name), agency: s(r.agency) || s(doc?.agency),
      documentId: doc?.id ?? null, ruleId: r.id, evidence: arr(r.evidence), sources, citation: s(r.citation_section), constraint: s(r.constraint) || "documentation",
      requirement: "unresolved", component: s(r.component) || null, page: s(r.page) || null, prerequisites: arr(r.prerequisites), sequence: s(r.sequence) || null, needs,
      path: [actStep, parcelStep, { kind: "fact", label: needs ? `Unknown: ${needs.en}` : "A needed project fact is unknown" }, { kind: "rule", label: s(r.name), ref: r.id }, ...sources.map((x) => ({ kind: "source" as const, label: `${x.name}${x.citation ? ` — ${x.citation}` : ""}`, ref: x.id }))],
    });
  }
  // Permit paths from the existing scenario graph (Permiso Único / PCOC …). A remodel path never
  // applies to new construction, and a path already covered by a verified rule is not repeated.
  for (const p of scenarioPaths) {
    if (approvals.some((a) => a.documentId && a.documentId === p.permitId)) continue;
    if (activity.construction === "new" && /remodel/i.test(p.id + p.name)) continue;
    const gap = /to confirm/i.test(p.citation);
    approvals.push({
      requirement: "potentially_required", component: null, page: null, prerequisites: [], sequence: null, needs: null,
      citationGap: gap ? bi("Exact Reglamento Conjunto provision not yet verified — research task: locate the Regla/Sección that requires this permit before citing it.", "Disposición exacta del Reglamento Conjunto aún no verificada — tarea: ubicar la Regla/Sección que exige este permiso antes de citarla.") : null,
      id: p.id, name: p.permitName ?? p.name, status: "likely", trigger: p.name, agency: "OGPe", documentId: p.permitId, ruleId: p.id, evidence: [], sources: p.sources, citation: gap ? p.citation.replace(/\s*\(Regla to confirm\)/i, "") : p.citation, constraint: "documentation",
      path: [actStep, parcelStep, { kind: "rule", label: p.name, ref: p.id }, ...p.sources.map((x) => ({ kind: "source" as const, label: x.name, ref: x.id })), ...(p.permitId ? [{ kind: "approval" as const, label: p.permitName ?? p.permitId, ref: p.permitId }] : [])],
    });
  }
  if (needsConstruction) {
    questions.push({ id: "construction", text: bi("Does the project involve new construction or an expansion, or will it use an existing building as is?", "¿El proyecto incluye construcción nueva o ampliación, o usará un edificio existente tal como está?"),
      options: [{ value: "new", label: bi("New construction", "Construcción nueva") }, { value: "addition", label: bi("Expansion / addition", "Ampliación") }, { value: "renovation", label: bi("Interior renovation only", "Solo remodelación interior") }, { value: "none", label: bi("Existing building, no work", "Edificio existente, sin obras") }] });
    unresolved.push({ kind: "missing_fact", text: "Whether the project includes construction — flood, coastal and wetland reviews depend on it." });
  }
  const constructive = activity.construction !== null && ["new", "addition", "substantial_improvement", "demolition"].includes(activity.construction);
  const YN = (yes: Bi, no: Bi) => [{ value: "yes", label: yes }, { value: "no", label: no }];
  if (activity.use && constructive && activity.components.demolition === null && activity.construction !== "demolition")
    questions.push({ id: "demolition", text: bi("Are there existing structures on the parcel that will be demolished?", "¿Hay estructuras existentes en la parcela que se demolerán?"), options: YN(bi("Yes, demolition", "Sí, demolición"), bi("No (vacant or kept as is)", "No (vacío o se conserva)")) });
  if (activity.use && constructive && activity.components.disturbance_1acre === null)
    questions.push({ id: "disturbance_1acre", text: bi("Will clearing, grading and excavation disturb one acre (about 4,047 m²) or more, counting the whole planned development?", "¿El desmonte, nivelación y excavación afectarán un acre (unos 4,047 m²) o más, contando todo el desarrollo planificado?"), options: YN(bi("1 acre or more", "1 acre o más"), bi("Less than 1 acre", "Menos de 1 acre")) });
  if (activity.use && activity.components.pool && activity.components.pool_public === null)
    questions.push({ id: "pool_public", text: bi("Will the pool be private to the residence, or open to the public or shared?", "¿La piscina será privada de la residencia, o abierta al público o compartida?"), options: [{ value: "no", label: bi("Private", "Privada") }, { value: "yes", label: bi("Public / shared", "Pública / compartida") }] });
  if (activity.use && constructive && activity.components.subdivision === null && activity.use !== "LU_SUBDIVISION")
    questions.push({ id: "subdivision", text: bi("Will the parcel be segregated or subdivided as part of the project?", "¿Se segregará o lotificará la parcela como parte del proyecto?"), options: YN(bi("Yes", "Sí"), bi("No", "No")) });
  if ((parcel.soilSlopeMaxPct ?? 0) >= 30 && (activity.construction === "new" || activity.construction === "addition")) {
    unresolved.push({ kind: "missing_fact", text: `The mapped soil is on steep slopes (up to ${parcel.soilSlopeMaxPct}%)${parcel.landslideHigh ? " in a high landslide-susceptibility area" : ""}: grading, foundations and access need a site-specific geotechnical / engineering review. This is a site-suitability note, not a zoning rule.` });
  }
  if (activity.construction === "renovation" && parcel.flood.zones.some((z) => z.sfha)) {
    unresolved.push({ kind: "missing_fact", text: "Whether the renovation is a substantial improvement (≥ 50% of the structure's market value) — that would trigger floodplain review in the mapped flood area (44 CFR 59.1)." });
  }
  for (const [k, label] of [["wetlands", "wetlands"], ["protectedArea", "protected natural areas"], ["historic", "historic zones"], ["archaeology", "archaeological sensitivity"]] as const) {
    if (parcel[k] === "unable") unresolved.push({ kind: "unable_to_verify", text: `The ${label} source did not answer — not verified.` });
  }

  // ---- Overall determination -------------------------------------------------
  const reasons: string[] = [];
  let outcome: Compatibility = activity.use ? base : "insufficient";
  const decisiveWithRule = decisive.filter((d) => d.permissionId);
  for (const d of decisive) {
    if (d.permissionId) reasons.push(`${d.districtName ?? d.code}${d.share !== null ? ` (${formatShare(d.share, parcel.districts.length > 1)} of the parcel)` : ""}: ${COMPATIBILITY_TEXT[d.outcome].en} — ${d.citation}.`);
    else if (activity.use) reasons.push(`${d.code}${d.share !== null ? ` (${formatShare(d.share, parcel.districts.length > 1)} of the parcel)` : ""}: no verified rule for ${activity.useName} — SmartPR cannot determine this from its knowledge base.`);
  }
  if (!activity.use) reasons.push("The proposed use was not recognised — describe it or pick one of the options.");
  if (decisive.length > 1 && decisive.some((d) => d.outcome !== decisive[0]!.outcome)) {
    unresolved.push({ kind: "data_conflict", text: "Different zoning districts on the parcel give different answers for this use; the most restrictive is shown." });
  }
  if (protectionHit && activity.use && outcome !== "potentially_prohibited") {
    reasons.push("A protection designation or special-plan overlay applies (see Required approvals); its rules prevail over the base district (RC 2023 §6.1.1.1(b),(e)).");
    outcome = "professional_review";
  }
  const equivalenceMedium = decisive.some((d) => d.districtId && s(g.zoningDistricts.find((z) => z.id === d.districtId)?.equivalence_confidence) === "medium");
  const confidence: "high" | "medium" | "low" = !decisiveWithRule.length ? "low" : equivalenceMedium || outcome === "professional_review" ? "medium" : "high";
  if (equivalenceMedium) reasons.push("The parcel's map code was matched to the RC 2023 district through the municipal equivalence table — confirm the conversion.");
  const primary = decisiveWithRule[0];
  const compatPath: PathStep[] = [actStep, parcelStep];
  if (primary) {
    compatPath.push({ kind: "district", label: `${primary.code} → ${primary.districtName}${primary.share !== null ? ` (${formatShare(primary.share, parcel.districts.length > 1)})` : ""}`, ref: primary.districtId ?? undefined });
    compatPath.push({ kind: "rule", label: `${COMPATIBILITY_TEXT[primary.outcome].en}: ${primary.citation}`, ref: primary.permissionId ?? undefined });
    for (const x of primary.sources) compatPath.push({ kind: "source", label: x.name, ref: x.id });
  } else {
    compatPath.push({ kind: "rule", label: "No verified rule — determination not possible" });
  }

  // ---- Standards ------------------------------------------------------------------
  const standards = decisive.flatMap((d) => (d.districtId ? g.developmentStandards.filter((x) => s(x.zoning_district_id) === d.districtId) : []))
    .filter((x) => s(x.applies_to) !== "residential" || ["LU_MULTIFAMILY", "LU_SINGLE_FAMILY", "LU_HOTEL"].includes(activity.use ?? ""))
    .filter((x) => s(x.applies_to) !== "new_construction" || activity.construction === null || CONSTRUCTIVE.includes(activity.construction))
    .map((x) => ({ id: x.id, name: s(x.name), value: s(x.value), citation: `RC 2023 ${s(x.citation_section)}`, sources: srcRefs(g, arr(x.source_ids)) }));
  if (decisive.some((d) => d.districtId === "ZD_CT") && standards.some((x) => x.id.startsWith("DS_CT"))) {
    unresolved.push({ kind: "missing_fact", text: "Which C-T intensity (Liviano or Intermedio) applies to this parcel — the dimensional standards differ." });
  }
  if (decisive.some((d) => d.districtId === "ZD_CT")) gaps.push({ kind: "development_standard", detail: "Parking, height and Sección 6.1.1.6 density rules for C-T are not yet encoded." });
  for (const d of decisive.filter((y) => y.districtId && y.districtId !== "ZD_CT")) {
    const zd = g.zoningDistricts.find((z) => z.id === d.districtId);
    if (zd && !g.developmentStandards.some((x) => s(x.zoning_district_id) === zd.id)) gaps.push({ kind: "development_standard", detail: `Development standards for ${s(zd.code)} are not yet encoded.` });
    else if (zd) gaps.push({ kind: "development_standard", detail: `Parking and height rules for ${s(zd.code)} are not yet encoded.` });
  }

  // ---- Evidence --------------------------------------------------------------------
  const evidence = [...new Set(approvals.flatMap((a) => a.evidence))];

  // ---- Flags + complexity -------------------------------------------------------------
  const agencies = new Set(approvals.map((a) => a.agency).filter(Boolean));
  const factors: Array<{ factor: string; points: number }> = [];
  const add = (factor: string, points: number) => { if (points) factors.push({ factor, points }); };
  add(`${overlayCodes.length} overlay district(s)`, overlayCodes.length * 2);
  add(`${approvals.filter((a) => a.constraint === "protection").length} protection constraint(s)`, approvals.filter((a) => a.constraint === "protection").length * 3);
  add(`${approvals.filter((a) => a.status !== "confirmed" && a.constraint !== "protection").length} review(s) to confirm`, approvals.filter((a) => a.status !== "confirmed").length);
  add(`${agencies.size} agencies involved`, Math.max(0, agencies.size - 1));
  add(`compatibility: ${COMPATIBILITY_TEXT[outcome].en}`, { permitted: 0, conditional: 1, discretionary: 3, professional_review: 3, insufficient: 2, potentially_prohibited: 4 }[outcome]);
  add(`${principal.length} zoning districts on the parcel`, principal.length > 1 ? 2 : 0);
  add(`${unresolved.filter((u) => u.kind === "unable_to_verify").length} source(s) not verified`, unresolved.filter((u) => u.kind === "unable_to_verify").length);
  const score = factors.reduce((a, f) => a + f.points, 0);
  const level = score >= 10 ? "high" : score >= 5 ? "moderate" : "low";

  return {
    activity,
    compatibility: { outcome, baseOutcome, reasons, confidence, path: compatPath },
    districts,
    standards,
    approvals,
    evidence,
    unresolved,
    questions,
    coverageGaps: gaps,
    rulesEvaluated,
    flags: [],
    complexity: { level, score, factors },
    decision: projectDecision({ parcel, activity, g, districts, approvals, standards, unresolved, outcome, base: baseOutcome, protectionHit }),
  };
}

// ---------------------------------------------------------------------------
// Project decision summary
//
// One result for the lead summary, approvals, copy and exports. It keeps
// three things apart: mapped findings (parcel facts with scope), rule-based
// conclusions (a cited provision applied to stated facts) and what needs
// professional judgment. Missing evidence → "undetermined" with the reason.
// ---------------------------------------------------------------------------

const CONSTRUCTION_TEXT: Record<Construction, Bi> = {
  new: bi("New construction", "Construcción nueva"),
  addition: bi("Expansion / addition", "Ampliación"),
  substantial_improvement: bi("Substantial improvement", "Mejora sustancial"),
  renovation: bi("Remodelling of an existing structure", "Remodelación de una estructura existente"),
  none: bi("Use of an existing building, no construction stated", "Uso de un edificio existente, sin obras indicadas"),
  demolition: bi("Demolition", "Demolición"),
};

const COMPONENT_FACT: Record<string, Bi> = {
  SR_DEMOLITION: bi("demolition", "demolición"),
  SR_PUBLIC_POOL_HEALTH: bi("pool use (private or public)", "uso de la piscina (privada o pública)"),
  SR_STORMWATER_CGP: bi("land-disturbance area", "área de terreno afectada"),
};
const COMPONENT_NEEDS: Record<string, Bi> = {
  SR_DEMOLITION: bi("whether existing structures on the parcel will be demolished", "si se demolerán estructuras existentes en la parcela"),
  SR_PUBLIC_POOL_HEALTH: bi("whether the pool will be open to the public or shared", "si la piscina estará abierta al público o será compartida"),
  SR_STORMWATER_CGP: bi("whether clearing, grading and excavation will disturb one acre or more", "si el desmonte, nivelación y excavación afectarán un acre o más"),
};

const sizeText = (a: ProposedActivity): Bi | null => {
  const sq = a.facts.area_sqft, m2 = a.facts.area_m2;
  if (sq) return bi(`about ${sq.toLocaleString("en-US")} sq ft (${Math.round(sq * 0.092903).toLocaleString("en-US")} m²)`, `unos ${sq.toLocaleString("en-US")} pies² (${Math.round(sq * 0.092903).toLocaleString("en-US")} m²)`);
  if (m2) return bi(`about ${m2.toLocaleString("en-US")} m²`, `unos ${m2.toLocaleString("en-US")} m²`);
  return null;
};

function componentTrigger(r: Node, a: ProposedActivity): string | null {
  const use = a.useName ? a.useName.toLowerCase() : "the proposed use";
  const size = sizeText(a);
  switch (r.id) {
    case "SR_CONSTRUCTION_PERMIT":
      return a.construction === "renovation" ? "Remodelling / alteration of an existing structure (stated)."
        : a.construction === "demolition" ? "Demolition (stated)."
        : `${CONSTRUCTION_TEXT[a.construction ?? "new"].en} of a ${use}${size ? `, ${size.en}` : ""}${a.components.pool ? ", including the pool" : ""} (stated).`;
    case "SR_FLOOD_CERTIFICATION": return `Construction works: ${CONSTRUCTION_TEXT[a.construction ?? "new"].en.toLowerCase()} (stated).`;
    case "SR_ICP_ARCHAEOLOGY_EARTHWORK": return "The project involves construction with excavation / earth movement (foundations" + (a.components.pool ? ", pool excavation" : "") + ").";
    case "SR_DEMOLITION": return "Existing structures will be demolished (stated).";
    case "SR_PUBLIC_POOL_HEALTH": return "The pool will be open to the public or shared (stated).";
    case "SR_STORMWATER_CGP": return "Land disturbance of one acre or more (stated).";
    default: return null;
  }
}

const lc1 = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const pctText = (x: number | null) => (x === null ? null : formatShare(x, true));

function projectDecision(x: {
  parcel: ParcelFacts; activity: ProposedActivity; g: LandUseGraph; districts: DistrictDetermination[]; approvals: ApprovalFinding[];
  standards: LandUseAnalysis["standards"]; unresolved: LandUseAnalysis["unresolved"]; outcome: Compatibility; base: Compatibility | null; protectionHit: boolean;
}): ProjectDecision {
  const { parcel, activity: a, g, districts, approvals } = x;
  const gov = parcel.governance ?? null;
  const gaps: EvidenceGap[] = [];
  const useName = a.useName ?? (a.raw ? `"${a.raw}"` : "the proposed activity");
  const constructive = a.construction !== null && ["new", "addition", "substantial_improvement", "demolition"].includes(a.construction);

  // ---- Use and construction scope ------------------------------------------------
  const size = sizeText(a);
  const scopeParts: Bi[] = [a.construction ? CONSTRUCTION_TEXT[a.construction] : bi("Construction scope not stated", "Alcance de obra no indicado")];
  if (a.useName) scopeParts.push(bi(a.useName.toLowerCase(), a.useName.toLowerCase()));
  if (size) scopeParts.push(size);
  if (a.facts.rooms) scopeParts.push(bi(`${a.facts.rooms} rooms`, `${a.facts.rooms} habitaciones`));
  if (a.facts.units) scopeParts.push(bi(`${a.facts.units} units`, `${a.facts.units} unidades`));
  if (a.facts.stories) scopeParts.push(bi(`${a.facts.stories} stories`, `${a.facts.stories} pisos`));
  if (a.components.pool) scopeParts.push(bi("with a pool", "con piscina"));
  if (a.components.demolition) scopeParts.push(bi("with demolition of existing structures", "con demolición de estructuras existentes"));
  if (a.changeOfUse) scopeParts.push(bi("change of use", "cambio de uso"));
  const yn = (v: boolean | null, yes: Bi, no: Bi): { value: Bi; status: "stated" | "not_part" | "unknown" } => (v === true ? { value: yes, status: "stated" } : v === false ? { value: no, status: "not_part" } : { value: bi("Not stated", "No indicado"), status: "unknown" });
  const components: ProjectDecision["components"] = [
    { id: "construction", label: bi("Construction", "Obra"), ...(a.construction ? { value: CONSTRUCTION_TEXT[a.construction], status: "stated" as const } : { value: bi("Not stated", "No indicado"), status: "unknown" as const }) },
    { id: "pool", label: bi("Pool", "Piscina"), ...yn(a.components.pool, a.components.pool_public ? bi("Yes — public / shared", "Sí — pública / compartida") : a.components.pool_public === false ? bi("Yes — private", "Sí — privada") : bi("Yes", "Sí"), bi("No", "No")) },
    { id: "demolition", label: bi("Demolition", "Demolición"), ...yn(a.construction === "demolition" ? true : a.components.demolition, bi("Yes", "Sí"), bi("No", "No")) },
    { id: "earthwork", label: bi("Earthwork ≥ 1 acre", "Movimiento de tierra ≥ 1 acre"), ...yn(a.components.disturbance_1acre, bi("Yes", "Sí"), bi("No", "No")) },
    { id: "subdivision", label: bi("Subdivision / segregation", "Segregación / lotificación"), ...yn(a.use === "LU_SUBDIVISION" ? true : a.components.subdivision, bi("Yes", "Sí"), bi("No", "No")) },
    { id: "change_of_use", label: bi("Change of use", "Cambio de uso"), ...(a.changeOfUse ? { value: bi("Yes", "Sí"), status: "stated" as const } : { value: bi("Not stated", "No indicado"), status: "unknown" as const }) },
  ];

  // ---- Governing districts and overlays ------------------------------------------------
  const multi = parcel.districts.length > 1;
  const gDistricts: GoverningDistrict[] = districts.map((d) => {
    const zd = d.districtId ? g.zoningDistricts.find((z) => z.id === d.districtId) : undefined;
    const share = pctText(d.share);
    const where = share && multi ? bi(` (${share} of the parcel)`, ` (${share} de la parcela)`) : bi("");
    let meaning: Bi, effect: Bi;
    if (d.road) {
      meaning = bi("Road / right-of-way district (Sistema vial), not a development district.", "Distrito vial (Sistema vial), no es un distrito de desarrollo.");
      effect = bi(`${share ?? "Part"} of the parcel is mapped as VIAL. It may reflect a road right-of-way or alignment along the boundary, or a mapping-edge difference; it is neither treated as a fatal obstacle nor dismissed. Parcel-wide percentages cannot show whether the building, yards or access fall in it — a boundary survey and site plan can.`,
                  `${share ?? "Parte"} de la parcela está mapeada como VIAL. Puede reflejar una servidumbre o alineación de vía en el límite, o una diferencia de bordes del mapa; no se trata como obstáculo insalvable ni se descarta. Los porcentajes de la parcela no muestran si el edificio, los patios o el acceso caen en ella — una mensura y un plano de sitio sí.`);
    } else if (d.sliver) {
      meaning = zd ? bi(`${d.code}${d.via ? ` → ${d.via.rcCode}` : ""}: ${s(zd.name)}.`) : bi(`${d.code}${d.districtName ? `: ${d.districtName}` : ""}.`);
      effect = bi(`Small intersection${where.en}: could be a real strip or an edge-alignment difference between maps. Not used for the use determination; it matters only if the building footprint, yards or other site work fall there.`,
                  `Intersección pequeña${where.es}: puede ser una franja real o una diferencia de bordes entre mapas. No se usa para la determinación de uso; importa solo si la huella del edificio, los patios u otras obras caen allí.`);
    } else if (!zd) {
      meaning = bi(`${d.code}${d.districtName ? ` — ${d.districtName}` : ""}: no verified district rules in SmartPR.`, `${d.code}${d.districtName ? ` — ${d.districtName}` : ""}: SmartPR no tiene reglas verificadas del distrito.`);
      effect = bi("Effect on the project cannot be determined from SmartPR's rules.", "No se puede determinar el efecto en el proyecto con las reglas de SmartPR.");
    } else {
      const purpose = s(zd.purpose);
      meaning = bi(`${d.code}${d.via ? ` is converted to ${d.via.rcCode} (${s(zd.name)}) by RC 2023 ${d.via.table}${d.via.page ? `, p. ${d.via.page}` : ""}` : ` — ${s(zd.name)}`}.${purpose ? ` ${purpose}` : ""}`,
                   `${d.code}${d.via ? ` se convierte en ${d.via.rcCode} (${s(zd.name)}) según el RC 2023 ${d.via.table}${d.via.page ? `, p. ${d.via.page}` : ""}` : ` — ${s(zd.name)}`}.${purpose ? ` ${purpose}` : ""}`);
      effect = d.permissionId
        ? bi(`${useName}: ${COMPATIBILITY_TEXT[d.outcome].en} under ${d.citation}${where.en}.`, `${useName}: ${COMPATIBILITY_TEXT[d.outcome].es} según ${d.citation}${where.es}.`)
        : d.rawOutcome === "consulta" ? bi(`${useName} is not listed; it may be considered through a consulta de ubicación (${d.citation})${where.en}.`, `${useName} no está listado; puede evaluarse mediante consulta de ubicación (${d.citation})${where.es}.`)
        : bi(`No verified rule for ${useName} in ${s(zd.code)}${where.en}.`, `No hay regla verificada para ${useName} en ${s(zd.code)}${where.es}.`);
    }
    return { code: d.code, share: d.share, name: d.districtName, small: d.sliver, road: !!d.road, rcCode: d.via?.rcCode ?? (zd ? s(zd.code) : null), rcName: zd ? s(zd.name) : null,
      via: d.via ? `${d.via.table}${d.via.page ? `, p. ${d.via.page}` : ""}` : null, meaning, effect, citation: d.citation, sources: d.sources };
  });

  const overlayInputs = parcel.overlays?.length ? parcel.overlays : [...new Set(parcel.districts.flatMap((d) => d.overlays))].map((code) => ({ code, name: null, share: null }));
  const gOverlays: GoverningOverlay[] = overlayInputs.map((o) => {
    const node = (g.overlayDistricts ?? []).find((n) => fold(s(n.code)) === fold(o.code) && (!s(n.municipality) || fold(s(n.municipality)) === fold(parcel.municipality)));
    const siteRule = g.siteRules.find((r) => JSON.stringify(r.when ?? {}).includes(`"${o.code}"`));
    const share = pctText(o.share);
    if (node) {
      const eff = s(node.effect) as GoverningOverlay["effect"];
      return { code: o.code, share: o.share, name: s(node.name) || o.name, known: true, meaning: bi(s(node.meaning)),
        effect: eff, effectText: bi(eff === "may_modify_or_restrict" ? `May add to, modify or restrict the base zoning rules${share ? ` on ${share} of the parcel` : ""}; where its provisions apply they prevail over the equivalent district.` : `Effect: ${eff}.`,
          eff === "may_modify_or_restrict" ? `Puede añadir, modificar o restringir las reglas de la calificación base${share ? ` en ${share} de la parcela` : ""}; donde sus disposiciones apliquen, prevalecen sobre el distrito equivalente.` : `Efecto: ${eff}.`),
        basis: s(node.effect_basis) || null, provisions: s(node.provisions_status) === "encoded" ? "encoded" : "not_obtained", obtainFrom: s(node.obtain_from) || null, sources: srcRefs(g, arr(node.source_ids)) };
    }
    return { code: o.code, share: o.share, name: o.name, known: !!siteRule,
      meaning: siteRule ? bi(`${o.code}: ${s(siteRule.name)} (see approvals).`) : bi(`${o.code}${o.name ? ` — ${o.name}` : ""}: overlay zone recorded on the JP calificación map; SmartPR has no verified description of it.`, `${o.code}${o.name ? ` — ${o.name}` : ""}: zona sobrepuesta registrada en el mapa de calificación de la JP; SmartPR no tiene una descripción verificada.`),
      effect: siteRule ? "adds" : "unknown",
      effectText: siteRule ? bi("Adds review requirements (see approvals); its plan's rules prevail over the base district.", "Añade requisitos de evaluación (ver aprobaciones); las reglas de su plan prevalecen sobre el distrito base.")
        : bi(`Unknown whether it adds, modifies or restricts the base zoning${share ? ` (${share} of the parcel)` : ""}. Under RC 2023 Sección 6.1.1.3(m) (p. 314), overlay zones of special or territorial plans prevail over the equivalent district.`, `Se desconoce si añade, modifica o restringe la calificación base${share ? ` (${share} de la parcela)` : ""}. Según el RC 2023 Sección 6.1.1.3(m) (p. 314), las zonas sobrepuestas de planes especiales o territoriales prevalecen sobre el distrito equivalente.`),
      basis: "RC 2023 Sección 6.1.1.3(m), p. 314", provisions: siteRule ? "encoded" : "unknown", obtainFrom: "Junta de Planificación and the municipal planning office", sources: [] };
  });

  // ---- Compatibility -----------------------------------------------------------------
  const principal = districts.filter((d) => !d.sliver && !d.road);
  const blockers: Array<{ id: string; reason: Bi }> = [];
  if (!a.use) blockers.push({ id: "use", reason: bi("the proposed use was not recognised", "no se reconoció el uso propuesto") });
  if (parcel.zoningStatus !== "verified") blockers.push({ id: "zoning", reason: bi("zoning could not be verified for this site", "no se pudo verificar la calificación de este lugar") });
  for (const d of principal) if (a.use && !d.permissionId && d.rawOutcome !== "consulta")
    blockers.push({ id: `rule_${d.code}`, reason: bi(`no verified rule for ${useName} in ${d.code}${d.via ? ` (→ ${d.via.rcCode})` : ""}`, `no hay regla verificada para ${useName} en ${d.code}${d.via ? ` (→ ${d.via.rcCode})` : ""}`) });
  for (const o of gOverlays) if ((o.share === null || o.share >= SLIVER) && o.provisions !== "encoded")
    blockers.push({ id: `overlay_${o.code}`, reason: bi(`the ${o.code} overlay${o.share !== null ? ` (${pctText(o.share)} of the parcel)` : ""} may modify or restrict the base zoning and its provisions have not been obtained`, `la zona sobrepuesta ${o.code}${o.share !== null ? ` (${pctText(o.share)} de la parcela)` : ""} puede modificar o restringir la calificación base y no se han obtenido sus disposiciones`) });
  if (x.protectionHit) blockers.push({ id: "protection", reason: bi("a protection designation or special-plan overlay applies whose rules prevail over the base district (RC 2023 Sección 6.1.1.1(b),(e), p. 308)", "aplica una designación de protección o zona de plan especial cuyas reglas prevalecen sobre el distrito base (RC 2023 Sección 6.1.1.1(b),(e), p. 308)") });
  if (!gov || gov.rules !== "identified") blockers.push({ id: "governing_rules", reason: bi(`the regulation governing uses in ${parcel.municipality} has not been confirmed${gov?.rulesText ? ` (${gov.rulesText})` : ""}`, `no se ha confirmado el reglamento que rige los usos en ${parcel.municipality}${gov?.rulesText ? ` (${gov.rulesText})` : ""}`) });
  const outcomes = new Set(principal.filter((d) => d.permissionId || d.rawOutcome === "consulta").map((d) => d.outcome));
  if (outcomes.size > 1) blockers.push({ id: "mixed", reason: bi(`the zoning districts on the parcel give different answers (${principal.map((d) => `${d.code}: ${COMPATIBILITY_TEXT[d.outcome].en}`).join("; ")}), so the result depends on where the building sits`, `los distritos de la parcela dan respuestas distintas (${principal.map((d) => `${d.code}: ${COMPATIBILITY_TEXT[d.outcome].es}`).join("; ")}), por lo que el resultado depende de dónde se ubique el edificio`) });
  const ruled = principal.filter((d) => d.permissionId || d.rawOutcome === "consulta");
  const ruleReading: Bi | null = a.use && ruled.length
    ? bi(ruled.map((d) => `${d.code}${d.via ? ` → ${d.via.rcCode} (RC 2023 ${d.via.table}${d.via.page ? `, p. ${d.via.page}` : ""})` : ""}: ${COMPATIBILITY_TEXT[d.outcome].en} — ${d.citation}`).join("; "),
         ruled.map((d) => `${d.code}${d.via ? ` → ${d.via.rcCode} (RC 2023 ${d.via.table}${d.via.page ? `, p. ${d.via.page}` : ""})` : ""}: ${COMPATIBILITY_TEXT[d.outcome].es} — ${d.citation}`).join("; "))
    : null;
  const mapped: DecisionCompatibility = x.base === "permitted" ? "supported_permitted" : x.base === "conditional" || x.base === "discretionary" ? "conditional_or_discretionary" : x.base === "potentially_prohibited" ? "supported_prohibited" : "undetermined";
  const status: DecisionCompatibility = blockers.length ? "undetermined" : mapped;
  const reason = blockers.length
    ? bi(`No conclusion yet because ${blockers.map((b) => b.reason.en).join("; ")}.${ruleReading ? ` Rule reading kept separate (not a conclusion): ${ruleReading.en}.` : ""}`,
         `Aún sin conclusión porque ${blockers.map((b) => b.reason.es).join("; ")}.${ruleReading ? ` Lectura de la regla, aparte (no es una conclusión): ${ruleReading.es}.` : ""}`)
    : bi(`Rule-based conclusion: ${ruleReading?.en ?? ""}. Based on the stated project facts and the cited provision; not an agency determination.`, `Conclusión basada en reglas: ${ruleReading?.es ?? ""}. Basada en los datos del proyecto indicados y la disposición citada; no es una determinación de la agencia.`);

  // ---- Constraints / exposure (mapped) ------------------------------------------------------
  const constraints: ProjectDecision["constraints"] = [];
  const fz = parcel.flood.zones;
  const sfha = fz.filter((z) => z.sfha), shaded = fz.filter((z) => !z.sfha && /0\.2/.test(z.subtype ?? ""));
  const sum = (zs: typeof fz) => (zs.every((z) => z.share !== null) ? zs.reduce((t, z) => t + (z.share ?? 0), 0) : null);
  if (fz.some((z) => z.floodway)) constraints.push({ id: "floodway", label: bi("Regulatory floodway", "Cauce mayor reglamentario"), detail: bi("A regulatory floodway is mapped on the parcel (effective FEMA map).", "Hay un cauce mayor reglamentario mapeado en la parcela (mapa vigente de FEMA)."), placement: true });
  if (sfha.length) { const sh = sum(sfha); constraints.push({ id: "flood_sfha", label: bi("Flood — Special Flood Hazard Area", "Inundación — Área Especial de Riesgo"), detail: bi(`FEMA Zone ${sfha.map((z) => z.zone).join(", ")} on ${sh !== null ? pctText(sh) : "part"} of the parcel (effective FIRM).`, `Zona FEMA ${sfha.map((z) => z.zone).join(", ")} en ${sh !== null ? pctText(sh) : "parte"} de la parcela (FIRM vigente).`), placement: sh === null || sh < 0.999 }); }
  if (shaded.length) { const sh = sum(shaded); constraints.push({ id: "flood_shaded_x", label: bi("Flood exposure — 0.2% annual chance", "Exposición a inundación — 0.2% anual"), detail: bi(`Shaded Zone X (0.2% annual-chance flood hazard) on ${sh !== null ? pctText(sh) : "part"} of the parcel (effective FIRM). Outside the Special Flood Hazard Area and no regulatory floodway mapped, but it is mapped flood exposure.`, `Zona X sombreada (peligro de inundación de 0.2% anual) en ${sh !== null ? pctText(sh) : "parte"} de la parcela (FIRM vigente). Fuera del Área Especial de Riesgo y sin cauce mayor mapeado, pero es exposición a inundación mapeada.`), placement: sh === null || sh < 0.999 }); }
  if (parcel.floodAdvisory === "yes") constraints.push({ id: "flood_advisory", label: bi("JP advisory flood map", "Mapa de asesoramiento de la JP"), detail: bi("The JP advisory flood map shows a flood area at the selected point (advisory — not the effective FEMA map).", "El mapa de asesoramiento de la JP muestra un área inundable en el punto seleccionado (asesoramiento — no es el mapa vigente de FEMA)."), placement: false });
  for (const o of gOverlays) constraints.push({ id: `overlay_${o.code}`, label: bi(`Overlay ${o.code}`, `Zona sobrepuesta ${o.code}`), detail: bi(`${o.share !== null ? `${pctText(o.share)} of the parcel. ` : ""}${o.effectText.en}`, `${o.share !== null ? `${pctText(o.share)} de la parcela. ` : ""}${o.effectText.es}`), placement: o.share !== null && o.share < 0.999 });
  for (const d of gDistricts) if (d.road || d.small) constraints.push({ id: `district_${d.code}`, label: d.road ? bi(`Road district ${d.code}`, `Distrito vial ${d.code}`) : bi(`Minor zoning intersection ${d.code}`, `Intersección menor ${d.code}`), detail: d.effect, placement: true });
  if (parcel.wetlands === "yes") constraints.push({ id: "wetlands", label: bi("Mapped wetlands", "Humedales mapeados"), detail: bi("Wetlands are mapped on the parcel (not a field delineation).", "Hay humedales mapeados en la parcela (no es una delimitación de campo)."), placement: true });
  if (parcel.protectedArea === "yes" || parcel.reserve === "yes") constraints.push({ id: "protected", label: bi("Protected area / reserve", "Área protegida / reserva"), detail: bi("A protected natural area or reserve is mapped.", "Hay un área natural protegida o reserva mapeada."), placement: true });
  if (parcel.coastal === "inside") constraints.push({ id: "coastal", label: bi("Coastal zone", "Zona costanera"), detail: bi("Inside the mapped coastal zone.", "Dentro de la zona costanera mapeada."), placement: false });
  if (parcel.historic === "yes") constraints.push({ id: "historic", label: bi("Historic zone / site", "Zona / sitio histórico"), detail: bi("A historic zone or site is mapped.", "Hay una zona o sitio histórico mapeado."), placement: false });
  if (parcel.archaeology === "yes") constraints.push({ id: "archaeology", label: bi("Archaeological sensitivity", "Sensibilidad arqueológica"), detail: bi("Archaeological sensitivity is mapped.", "Hay sensibilidad arqueológica mapeada."), placement: false });
  if (parcel.landslideHigh) constraints.push({ id: "landslide", label: bi("Landslide susceptibility", "Susceptibilidad a deslizamientos"), detail: bi("High landslide susceptibility at the selected point.", "Alta susceptibilidad a deslizamientos en el punto seleccionado."), placement: false });

  // ---- Evidence gaps -----------------------------------------------------------------------------
  for (const o of gOverlays) if ((o.share === null || o.share >= SLIVER) && o.provisions !== "encoded") {
    const node = (g.overlayDistricts ?? []).find((n) => fold(s(n.code)) === fold(o.code));
    gaps.push({ id: `overlay_${o.code}`, kind: "overlay", label: bi(`Evidence gap — ${o.code} overlay provisions`, `Brecha de evidencia — disposiciones de ${o.code}`),
      missing: bi(node ? s(node.provisions_needed) : `What the ${o.code} overlay allows or requires (uses, density, height, yards, design) and its effective version.`, node ? s(node.provisions_needed) : `Qué permite o exige la zona ${o.code} (usos, densidad, altura, patios, diseño) y su versión vigente.`),
      why: bi(`Overlay provisions prevail over the base district (${o.basis ?? "RC 2023 Sección 6.1.1.3(m), p. 314"}); they can add, modify or restrict what the base zoning allows.`, `Las disposiciones de la zona sobrepuesta prevalecen sobre el distrito base (${o.basis ?? "RC 2023 Sección 6.1.1.3(m), p. 314"}); pueden añadir, modificar o restringir lo que permite la calificación base.`),
      obtain: bi(`Research task: obtain the adopted ${o.name ?? o.code} plan text and maps, and written confirmation that they are in force for this parcel.`, `Tarea: obtener el texto y los mapas adoptados de ${o.name ?? o.code}, y confirmación escrita de que están vigentes para esta parcela.`),
      from: o.obtainFrom, blocks: bi("Compatibility conclusion and the development-standards check.", "La conclusión de compatibilidad y la verificación de parámetros de desarrollo.") });
  }
  if (!gov || gov.rules !== "identified") gaps.push({ id: "governing_rules", kind: "authority", label: bi("Evidence gap — governing regulation", "Brecha de evidencia — reglamento aplicable"),
    missing: bi(gov?.rulesUnresolved ?? `Which regulation governs uses and design on this parcel in ${parcel.municipality} (Reglamento Conjunto 2023 directly, through a municipal equivalence table, a municipal territorial-plan regulation, or later amendments).`, gov?.rulesUnresolved ?? `Qué reglamento rige los usos y el diseño en esta parcela en ${parcel.municipality} (Reglamento Conjunto 2023 directamente, por una tabla de equivalencias municipal, un reglamento de plan territorial o enmiendas posteriores).`),
    why: bi("A use conclusion is only as good as the regulation it applies; publication of a regulation does not establish that it governs this parcel.", "Una conclusión de uso depende del reglamento aplicado; que un reglamento esté publicado no establece que rija esta parcela."),
    obtain: bi("Research task: confirm the governing plan and regulation (with effective date) with the municipal planning office or the Junta de Planificación, and check RC 2023 amendments.", "Tarea: confirmar el plan y reglamento aplicables (con fecha de vigencia) con la oficina de planificación municipal o la Junta de Planificación, y revisar las enmiendas al RC 2023."),
    from: `${parcel.municipality} municipal planning office / Junta de Planificación`, blocks: bi("Compatibility conclusion.", "La conclusión de compatibilidad.") });
  if (constructive && (!gov || gov.permitAuthority !== "identified")) gaps.push({ id: "permit_authority", kind: "authority", label: bi("Evidence gap — permit-issuing office", "Brecha de evidencia — oficina que expide el permiso"),
    missing: bi(gov?.permitNote ?? `Whether the construction permit is filed with OGPe or with ${parcel.municipality}'s own permits office.`, gov?.permitNote ? `Si el permiso de construcción se presenta ante la OGPe o ante la oficina de permisos municipal. ${gov.permitNote}` : `Si el permiso de construcción se presenta ante la OGPe o ante la oficina de permisos de ${parcel.municipality}.`),
    why: bi("Autonomous municipalities with transferred powers issue some permits themselves; the filing office sets the procedure and sequence.", "Los municipios autónomos con facultades transferidas expiden algunos permisos; la oficina determina el trámite y la secuencia."),
    obtain: bi("Research task: confirm the filing office for this permit type and parcel (transfer agreement / jerarquía).", "Tarea: confirmar la oficina para este tipo de permiso y parcela (convenio de transferencia / jerarquía)."),
    from: gov?.permitObtainFrom ?? "OGPe / municipal permits office", blocks: bi("Filing route and sequencing of the construction permit.", "La ruta de radicación y la secuencia del permiso de construcción.") });
  const variant = x.standards.length ? g.developmentStandards.find((d) => x.standards.some((st) => st.id === d.id) && s(d.variant_note)) : undefined;
  if (variant) gaps.push({ id: "standards_variant", kind: "rule_coverage", label: bi("Evidence gap — which design-parameter column applies", "Brecha de evidencia — qué columna de parámetros aplica"),
    missing: bi(s(variant.variant_note)), why: bi("Lot size, occupancy, density and yard requirements differ between the columns.", "El tamaño de solar, ocupación, densidad y patios difieren entre columnas."),
    obtain: bi("Research task: confirm with the planning office whether the parcel is treated as a high-density urban area or a traditional urban centre (and whether the overlay sets its own parameters).", "Tarea: confirmar con la oficina de planificación si la parcela se trata como área urbana de alta densidad o centro urbano tradicional (y si la zona sobrepuesta fija sus propios parámetros)."),
    from: `${parcel.municipality} municipal planning office`, blocks: bi(`Development-standards check for the proposed building${a.components.pool ? " and pool" : ""}.`, `La verificación de parámetros de desarrollo del edificio${a.components.pool ? " y la piscina" : ""}.`) });
  const placementItems = constraints.filter((c) => c.placement);
  if (placementItems.length && constructive) gaps.push({ id: "placement", kind: "placement", label: bi("Evidence gap — where the building sits", "Brecha de evidencia — ubicación del edificio"),
    missing: bi(`The location of the building footprint, pool, yards and access relative to: ${placementItems.map((c) => c.label.en).join("; ")}.`, `La ubicación de la huella del edificio, la piscina, los patios y el acceso respecto a: ${placementItems.map((c) => c.label.es).join("; ")}.`),
    why: bi("Parcel-wide percentages cannot establish whether the proposed footprint intersects a constraint that covers only part of the parcel.", "Los porcentajes de toda la parcela no pueden establecer si la huella propuesta intersecta una restricción que cubre solo parte de la parcela."),
    obtain: bi("Research task: site plan by the architect or engineer drawn over a boundary and topographic survey by a licensed surveyor, overlaid with the effective FIRM and the calificación map.", "Tarea: plano de sitio del arquitecto o ingeniero sobre una mensura y topografía de un agrimensor licenciado, superpuesto al FIRM vigente y al mapa de calificación."),
    from: "Project architect / engineer; licensed surveyor", blocks: bi("Whether the partial constraints affect the building, and any floodplain review that depends on placement.", "Si las restricciones parciales afectan el edificio, y cualquier evaluación de zona inundable que dependa de la ubicación.") });
  for (const ap of approvals.filter((y) => y.requirement === "unresolved" && y.needs)) gaps.push({ id: `fact_${ap.ruleId}`, kind: "project_fact", label: bi(`Missing project fact — ${(COMPONENT_FACT[ap.ruleId] ?? ap.needs!).en}`, `Dato del proyecto faltante — ${(COMPONENT_FACT[ap.ruleId] ?? ap.needs!).es}`),
    missing: bi(`Whether ${ap.needs!.en.replace(/^whether /, "")}.`, `Si ${ap.needs!.es.replace(/^si /, "")}.`), why: bi(`It decides whether "${ap.name}" is required (${ap.citation}).`, `Decide si se requiere «${ap.name}» (${ap.citation}).`),
    obtain: bi("Answer the question in the Proposed activity panel.", "Conteste la pregunta en el panel de actividad propuesta."), from: "Client / project team", blocks: bi(`Status of: ${ap.name}.`, `Estado de: ${ap.name}.`) });
  if (constructive && a.components.subdivision === null && a.use !== "LU_SUBDIVISION") gaps.push({ id: "fact_subdivision", kind: "project_fact", label: bi("Missing project fact — segregation / subdivision", "Dato del proyecto faltante — segregación / lotificación"),
    missing: bi("Whether the parcel will be segregated or subdivided.", "Si la parcela se segregará o lotificará."), why: bi("A segregation is a separate approval with its own requirements; SmartPR has no verified rule for it yet.", "Una segregación es una aprobación separada con sus propios requisitos; SmartPR aún no tiene regla verificada."),
    obtain: bi("Answer the question in the Proposed activity panel.", "Conteste la pregunta en el panel de actividad propuesta."), from: "Client / project team", blocks: bi("Whether a segregation approval belongs in the pathway.", "Si una aprobación de segregación pertenece a la ruta.") });
  for (const ap of approvals.filter((y) => y.citationGap)) gaps.push({ id: `citation_${ap.id}`, kind: "citation", label: bi(`Evidence gap — provision for ${ap.name}`, `Brecha de evidencia — disposición para ${ap.name}`),
    missing: bi(`The exact Reglamento Conjunto Regla/Sección that requires "${ap.name}".`, `La Regla/Sección exacta del Reglamento Conjunto que exige «${ap.name}».`), why: bi("An approval should not be presented as required without its provision.", "Una aprobación no debe presentarse como requerida sin su disposición."),
    obtain: ap.citationGap!, from: "Reglamento Conjunto 2023 text", blocks: bi(`Confirmed status of ${ap.name}.`, `El estado confirmado de ${ap.name}.`) });
  for (const d of principal.filter((y) => !y.districtId)) gaps.push({ id: `district_${d.code}`, kind: "rule_coverage", label: bi(`Evidence gap — rules for ${d.code}`, `Brecha de evidencia — reglas de ${d.code}`),
    missing: bi(`The district rules (uses and parameters) for mapped code ${d.code} in ${parcel.municipality}.`, `Las reglas del distrito (usos y parámetros) para el código ${d.code} en ${parcel.municipality}.`), why: bi("Without them SmartPR cannot read the use against the district.", "Sin ellas SmartPR no puede evaluar el uso frente al distrito."),
    obtain: bi("Research task: find the RC 2023 equivalence table or municipal regulation for this code and add it to the knowledge base.", "Tarea: ubicar la tabla de equivalencias del RC 2023 o el reglamento municipal para este código y añadirlo a la base de conocimiento."), from: "Junta de Planificación", blocks: bi("Compatibility conclusion.", "La conclusión de compatibilidad.") });
  const unable: Array<[keyof ParcelFacts, Bi]> = [["wetlands", bi("wetlands", "humedales")], ["protectedArea", bi("protected areas", "áreas protegidas")], ["historic", bi("historic zones/sites", "zonas/sitios históricos")], ["archaeology", bi("archaeological sensitivity", "sensibilidad arqueológica")], ["reserve", bi("natural reserves", "reservas naturales")], ["coastal", bi("coastal zone", "zona costanera")]];
  if (parcel.flood.status === "unable") unable.unshift(["flood", bi("FEMA flood zones", "zonas inundables FEMA")]);
  if (parcel.zoningStatus === "unable") unable.unshift(["zoningStatus", bi("zoning (calificación)", "calificación")]);
  const down = unable.filter(([k]) => k === "flood" ? true : k === "zoningStatus" ? true : parcel[k] === "unable");
  if (down.length) gaps.push({ id: "sources_unavailable", kind: "source", label: bi("Evidence gap — sources that did not answer", "Brecha de evidencia — fuentes que no respondieron"),
    missing: bi(`Results for: ${down.map(([, l]) => l.en).join(", ")}.`, `Resultados de: ${down.map(([, l]) => l.es).join(", ")}.`), why: bi("Unknown is not clear: a constraint in these layers would change the approvals.", "Desconocido no es despejado: una restricción en estas capas cambiaría las aprobaciones."),
    obtain: bi("Run the lookup again; if the service stays down, request the official record from the responsible agency.", "Repita la consulta; si el servicio sigue caído, solicite el registro oficial a la agencia responsable."), from: "JP / DRNA / ICP map services", blocks: bi("The constraint review for those layers and any approval they would trigger.", "La revisión de restricciones de esas capas y las aprobaciones que activarían.") });

  // ---- Pathway -------------------------------------------------------------------------------------
  const req = approvals.filter((y) => y.requirement === "required");
  const steps: Bi[] = [];
  const blocking = gaps.filter((y) => y.kind === "overlay" || y.kind === "authority");
  if (blocking.length) steps.push(bi(`Confirm governing provisions first: ${blocking.map((y) => y.label.en.replace(/^Evidence gap — /, "")).join("; ")}.`, `Confirmar primero las disposiciones aplicables: ${blocking.map((y) => y.label.es.replace(/^Brecha de evidencia — /, "")).join("; ")}.`));
  const facts = gaps.filter((y) => y.kind === "project_fact");
  if (facts.length) steps.push(bi(`Settle the open project facts: ${facts.map((y) => lc1(y.missing.en.replace(/\.$/, ""))).join("; ")}.`, `Resolver los datos abiertos del proyecto: ${facts.map((y) => lc1(y.missing.es.replace(/\.$/, ""))).join("; ")}.`));
  const pre = req.filter((y) => y.ruleId !== "SR_CONSTRUCTION_PERMIT");
  if (pre.length) steps.push(bi(`Obtain before or with the permit filing: ${pre.map((y) => `${y.name} (${y.agency.split(",")[0]})`).join("; ")}.`, `Obtener antes o junto con la radicación: ${pre.map((y) => `${y.name} (${y.agency.split(",")[0]})`).join("; ")}.`));
  const cp = req.find((y) => y.ruleId === "SR_CONSTRUCTION_PERMIT");
  if (cp) steps.push(bi(`File the construction permit (${cp.citation.split(":")[0]}) — ${gov?.permitAuthority === "identified" ? cp.agency : "filing office to be confirmed (OGPe or the municipal permits office)"}${a.components.pool ? "; the pool is part of the construction scope" : ""}.`, `Radicar el permiso de construcción (${cp.citation.split(":")[0]}) — ${gov?.permitAuthority === "identified" ? cp.agency : "oficina por confirmar (OGPe o la oficina de permisos municipal)"}${a.components.pool ? "; la piscina es parte del alcance de obra" : ""}.`));
  if (cp) steps.push(bi("After the works: Informe Final de Obras closes the construction permit (RC 2023 Sección 3.2.1.1(f), p. 125). Whether a separate use authorization is needed before connecting services is not encoded — confirm it.", "Después de las obras: el Informe Final de Obras cierra el permiso de construcción (RC 2023 Sección 3.2.1.1(f), p. 125). Si se necesita una autorización de uso separada antes de conectar servicios no está codificado — confírmelo."));
  const summary = cp
    ? bi(`A construction permit for ${CONSTRUCTION_TEXT[a.construction ?? "new"].en.toLowerCase()} (RC 2023 Regla 3.2.1), with ${pre.length ? pre.map((y) => y.name).join(", ") : "its filing requirements"}${status === "undetermined" ? ", after the zoning question is resolved" : ""}.`,
         `Permiso de construcción para ${CONSTRUCTION_TEXT[a.construction ?? "new"].es.toLowerCase()} (RC 2023 Regla 3.2.1), con ${pre.length ? pre.map((y) => y.name).join(", ") : "sus requisitos de radicación"}${status === "undetermined" ? ", después de resolver la cuestión de calificación" : ""}.`)
    : approvals.length ? bi(`Possible approvals: ${approvals.map((y) => y.name).join(", ")}.`, `Aprobaciones posibles: ${approvals.map((y) => y.name).join(", ")}.`)
    : bi("No approval pathway can be outlined until the project facts are stated.", "No se puede trazar una ruta de aprobaciones hasta indicar los datos del proyecto.");
  const nextGap = blocking[0] ?? facts[0] ?? gaps[0];
  const nextAction = nextGap
    ? bi(`${nextGap.obtain.en}${nextGap.from ? ` (${nextGap.from})` : ""}`, `${nextGap.obtain.es}${nextGap.from ? ` (${nextGap.from})` : ""}`)
    : cp ? bi("Have the licensed architect or engineer prepare the construction-permit filing and its listed prerequisites.", "Que el arquitecto o ingeniero licenciado prepare la radicación del permiso de construcción y sus requisitos.")
    : bi("Describe the construction scope so the approvals can be evaluated.", "Describa el alcance de obra para evaluar las aprobaciones.");

  const variantStd = variant ? bi(s(variant.variant_note)) : null;
  return {
    use: bi(a.useName ?? (a.raw || "Not stated"), a.useName ?? (a.raw || "No indicado")),
    scope: bi(scopeParts.map((p) => p.en).join(" · "), scopeParts.map((p) => p.es).join(" · ")),
    components,
    compatibility: { status, label: DECISION_TEXT[status], reason, basis: status === "undetermined" ? "none" : "rule", ruleReading, blockedBy: blockers.map((b) => b.id) },
    governing: { plan: gov?.plan ?? null, rules: gov?.rules ?? "unknown", rulesText: gov?.rulesText ?? null, permitAuthority: gov?.permitAuthority ?? "unknown", permitNote: gov?.permitNote ?? null, districts: gDistricts, overlays: gOverlays, standards: variantStd },
    constraints,
    unresolved: gaps,
    pathway: { summary, steps, complete: false,
      completeness: bi(`Not a complete approval pathway: it lists the ${approvals.length} approval${approvals.length === 1 ? "" : "s"} SmartPR has rules for. Utility endorsements, municipal requirements and agency-specific conditions are not encoded.`, `No es una ruta de aprobaciones completa: lista ${approvals.length === 1 ? "la aprobación" : `las ${approvals.length} aprobaciones`} para las que SmartPR tiene reglas. No están codificados endosos de utilidades, requisitos municipales ni condiciones específicas de agencias.`),
      nextAction },
  };
}
