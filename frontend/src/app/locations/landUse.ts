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
  facts: { rooms?: number; units?: number; area_m2?: number; kw?: number; stories?: number };
}

const CONSTRUCTION_CUES: Array<[RegExp, Construction]> = [
  [/\b(demolish|demolition|tear down|demoler|demolici[oó]n)\b/i, "demolition"],
  [/\b(build|built|construct|construction|erect|develop(?:ing)? a new|new building|ground[- ]up|construir|construcci[oó]n|edificar|levantar)\b/i, "new"],
  [/\b(expand|expansion|addition|add (?:a|an|\d)|extend|ampliar|ampliaci[oó]n|a[nñ]adir)\b/i, "addition"],
  [/\b(renovat\w*|remodel\w*|rehabilit\w*|gut|remodelar|renovar)\b/i, "renovation"],
  [/\b(convert|conversion|turn (?:the|an|a) .* into|change (?:the )?use|convertir|cambio de uso|cambiar el uso)\b/i, "none"],
  [/\b(open|operate|run|start|abrir|operar|establecer|existing building|existing space|local existente|edificio existente)\b/i, "none"],
];

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
      area_m2: num(/(\d+(?:\.\d+)?)\s*(?:m2|m²|square met(?:er|re)s?|metros cuadrados)\b/i) ?? ((x) => (x ? Math.round(x * 0.092903) : undefined))(num(/(\d+(?:\.\d+)?)\s*(?:sq\.? ?ft|square feet|pies cuadrados)\b/i)),
      kw,
      stories: num(/(\d+)[- ]?(?:stor(?:y|ies|eys?)|floors?|levels?|pisos|niveles|plantas)\b/i),
    },
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
  flood: { zones: Array<{ zone: string; sfha: boolean; floodway: boolean; share: number | null }>; status: "verified" | "no_mapped" | "unable" };
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
}

export interface ApprovalFinding {
  id: string; name: string; status: Certainty; trigger: string; agency: string;
  documentId: string | null; ruleId: string; evidence: string[]; sources: SourceRef[]; citation: string; constraint: string;
  path: PathStep[];
}

export interface LandUseAnalysis {
  activity: ProposedActivity;
  compatibility: { outcome: Compatibility; baseOutcome: Compatibility | null; reasons: string[]; confidence: "high" | "medium" | "low"; path: PathStep[] };
  districts: DistrictDetermination[];
  standards: Array<{ id: string; name: string; value: string; citation: string; sources: SourceRef[] }>;
  approvals: ApprovalFinding[];
  evidence: string[];
  unresolved: Array<{ kind: "missing_fact" | "missing_rule" | "unable_to_verify" | "data_conflict"; text: string }>;
  questions: Array<{ id: "construction" | "use"; text: Bi; options: Array<{ value: string; label: Bi }> }>;
  coverageGaps: Array<{ kind: "zoning_district" | "use_permission" | "development_standard" | "source"; detail: string }>;
  rulesEvaluated: Array<{ id: string; name: string; triggered: boolean; why: string }>;
  flags: Array<{ id: string; label: Bi; value: Bi; tone: "ok" | "info" | "attention" | "hazard" | "unknown" }>;
  complexity: { level: "low" | "moderate" | "high"; score: number; factors: Array<{ factor: string; points: number }> };
}

export interface LandUseGraph {
  zoningDistricts: Node[]; landUses: Node[]; usePermissions: Node[]; developmentStandards: Node[]; siteRules: Node[];
  documents: Node[]; sources: Node[];
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
    const zd = resolveDistrict(g, d.code);
    const sliver = d.share !== null && d.share < SLIVER;
    if (!zd) {
      if (!sliver) gaps.push({ kind: "zoning_district", detail: `No graph district for calificación "${d.code}"${d.name ? ` (${d.name})` : ""} in ${parcel.municipality}: add it with its RC 2023 equivalence.` });
      return { code: d.code, share: d.share, districtId: null, districtName: d.name, outcome: "insufficient", permissionId: null, conditions: [], citation: null, sources: [], equivalence: null, sliver, gap: `No verified district rules for ${d.code}` };
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
      sources: perm || consulta ? srcRefs(g, arr((perm ?? zd).source_ids)) : [], equivalence: s(zd.equivalence_note) || null, sliver,
      gap: perm || consulta || !activity.use ? null : `No verified rule for this use in ${s(zd.code)}`, rawOutcome,
    };
  });
  if (parcel.zoningStatus !== "verified") unresolved.push({ kind: "unable_to_verify", text: "Zoning (calificación) could not be verified for this parcel." });
  const principal = districts.filter((d) => !d.sliver);
  const decisive = principal.length ? principal : districts;
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
  };
  const approvals: ApprovalFinding[] = [];
  let needsConstruction = false;
  let protectionHit = false;
  for (const r of g.siteRules) {
    const res = evalWhen(r.when, ctx);
    const usesConstruction = JSON.stringify(r.when ?? {}).includes("activity.construction");
    if (res === null && usesConstruction && activity.construction === null) needsConstruction = true;
    rulesEvaluated.push({ id: r.id, name: s(r.name), triggered: res === true, why: res === true ? "all conditions met" : res === false ? "a condition is not met" : "a needed fact is unknown" });
    if (res !== true) continue;
    const partial = r.id === "SR_FLOOD_SFHA_CONSTRUCTION" ? sfhaShare > 0 && sfhaShare < 0.999 : false;
    const status = (s(partial ? r.certainty_partial : r.certainty_full) || "likely") as Certainty;
    if (s(r.constraint) === "protection") protectionHit = true;
    const doc = r.approval_document_id ? g.documents.find((d) => d.id === s(r.approval_document_id)) : undefined;
    const sources = srcRefs(g, arr(r.source_ids));
    if (doc && !sources.length && s(doc.citation)) sources.push({ id: doc.id, name: s(doc.name), citation: s(doc.citation), url: s(doc.citation_url) || null });
    const trigger = r.id === "SR_FLOOD_SFHA_CONSTRUCTION"
      ? `Proposed construction on a parcel that intersects FEMA ${parcel.flood.zones.filter((z) => z.sfha).map((z) => `Zone ${z.zone}${z.share !== null ? ` (${formatShare(z.share, true)} of the parcel)` : ""}`).join(", ")}.${partial ? " Required if the work falls in the mapped flood area." : ""}`
      : s(r.name);
    approvals.push({
      id: r.id, name: doc ? s(doc.name) : s(r.name), status, trigger, agency: s(r.agency) || s(doc?.agency),
      documentId: doc?.id ?? null, ruleId: r.id, evidence: arr(r.evidence), sources, citation: s(r.citation_section), constraint: s(r.constraint) || "documentation",
      path: [actStep, parcelStep, { kind: "fact", label: trigger }, { kind: "rule", label: s(r.name), ref: r.id }, ...sources.map((x) => ({ kind: "source" as const, label: `${x.name}${x.citation ? ` — ${x.citation}` : ""}`, ref: x.id })), ...(doc ? [{ kind: "approval" as const, label: s(doc.name), ref: doc.id }] : []), ...arr(r.evidence).map((e) => ({ kind: "evidence" as const, label: e }))],
    });
  }
  // Permit paths from the existing scenario graph (Permiso Único / PCOC …).
  for (const p of scenarioPaths) {
    if (approvals.some((a) => a.documentId && a.documentId === p.permitId)) continue;
    approvals.push({
      id: p.id, name: p.permitName ?? p.name, status: "likely", trigger: p.name, agency: "OGPe", documentId: p.permitId, ruleId: p.id, evidence: [], sources: p.sources, citation: p.citation, constraint: "documentation",
      path: [actStep, parcelStep, { kind: "rule", label: p.name, ref: p.id }, ...p.sources.map((x) => ({ kind: "source" as const, label: x.name, ref: x.id })), ...(p.permitId ? [{ kind: "approval" as const, label: p.permitName ?? p.permitId, ref: p.permitId }] : [])],
    });
  }
  if (needsConstruction) {
    questions.push({ id: "construction", text: bi("Does the project involve new construction or an expansion, or will it use an existing building as is?", "¿El proyecto incluye construcción nueva o ampliación, o usará un edificio existente tal como está?"),
      options: [{ value: "new", label: bi("New construction", "Construcción nueva") }, { value: "addition", label: bi("Expansion / addition", "Ampliación") }, { value: "renovation", label: bi("Interior renovation only", "Solo remodelación interior") }, { value: "none", label: bi("Existing building, no work", "Edificio existente, sin obras") }] });
    unresolved.push({ kind: "missing_fact", text: "Whether the project includes construction — flood, coastal and wetland reviews depend on it." });
  }
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
  if (decisive.some((d) => d.districtId) && standards.length) {
    unresolved.push({ kind: "missing_fact", text: "Which C-T intensity (Liviano or Intermedio) applies to this parcel — the dimensional standards differ." });
  }
  if (decisive.some((d) => d.districtId)) gaps.push({ kind: "development_standard", detail: "Parking, height and Sección 6.1.1.6 density rules for C-T are not yet encoded." });

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
  };
}
