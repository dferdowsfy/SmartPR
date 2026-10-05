// ============================================================================
// Property & Site Report — ONE model for the intake preview, the expanded
// report drawer, exports, and the versioned copy saved to the Business
// Passport. Pure: built from the confirmed IntakeSite (+ its point layers)
// and the whole-parcel findings. Adds no queries and draws no approval
// conclusions: every statement is a sourced finding, an explicit gap, or a
// deterministic, source-backed preparation step.
//
// Finding states (never collapsed — missing data is never "no restriction"):
//   sourced        a source answered and something is mapped
//   none_mapped    a source answered: nothing mapped here (NOT "no constraint")
//   unavailable    a source did not answer (down / timeout / refused)
//   stale          the answer is for another point or too old — hidden from
//                  findings, listed as a gap
//   not_performed  SmartPR did not run this check (no verified source / no
//                  parcel) — never presented as an official finding
//   not_evaluated  needs the proposed activity, which is not described yet
//   not_applicable reserved for a source-backed determination that the item
//                  does not apply
//   review         needs professional interpretation
//   loading        requested for this exact location, not back yet
//
// Every finding also carries its basis — official map finding, rule result,
// check not performed, source unavailable, or professional interpretation —
// and its scope: pin, parcel or municipality. Pin and parcel answers are
// kept apart, and discrepancies are only reported between answers for the
// same place.
// ============================================================================

import { floodMapSummary, layerAnswered, type SiteLayerId, type SiteLayerResult } from "./layers.ts";
import PLAN_CURRENCY from "../../kb/plan_currency.json";

/** V_PUT on every feature of the PUT layer (PUT_v10). */
const PUT_LAYER_VERSION_DATE = "2015-11-30";
type PlanCurrencyEntry = { plan: { resolution: string; effective: string; documents: Array<{ title: string; url: string; note?: string; checked_on?: string }> }; put?: { plan_modifies_put?: boolean; status?: string; layer_check?: { layer: string; finding: string; checked_on: string } } };
import { siteLayersCurrent, type IntakeSite } from "./intakeLocation.ts";
import { parsePlanTerritorialExtra, ptDateText, PT_FIELDS, toPrStatePlane, type ExtraFinding, type ParcelFindings } from "./parcel.ts";
import { COVERAGE_METHOD, formatArea, formatShare, SMALL_SHARE, UNMAPPED_WARN_SHARE, type Coverage } from "./coverage.ts";
import { COMPATIBILITY_TEXT, DECISION_TEXT, REQUIREMENT_TEXT, type LandUseAnalysis } from "./landUse.ts";
import { siteAddressParts } from "./siteAddress.ts";
import { reviewerAssessment, type ReviewerAssessment } from "./reviewerAssessment.ts";
import type { exportableReview } from "./propertyReview.ts";

export type Bi = { en: string; es: string };
export type ReportFindingState = "sourced" | "none_mapped" | "unavailable" | "stale" | "not_performed" | "not_evaluated" | "loading" | "review" | "not_applicable";

/**
 * Standardized status shown to people (one vocabulary everywhere):
 *   VERIFIED · NONE MAPPED · UNABLE TO VERIFY · NOT CHECKED · NOT EVALUATED ·
 *   REQUIRES PROFESSIONAL REVIEW · NOT APPLICABLE.  Missing data is never "No";
 *   "none mapped" is never "no constraint".
 */
export type FindingStatus = "verified" | "no_mapped_constraint" | "unable_to_verify" | "not_checked" | "not_evaluated" | "requires_professional_review" | "not_applicable" | "checking";
export function findingStatus(state: ReportFindingState): FindingStatus {
  return state === "sourced" ? "verified"
    : state === "none_mapped" ? "no_mapped_constraint"
    : state === "review" ? "requires_professional_review"
    : state === "not_performed" ? "not_checked"
    : state === "not_evaluated" ? "not_evaluated"
    : state === "not_applicable" ? "not_applicable"
    : state === "loading" ? "checking"
    : "unable_to_verify";
}
export const STATUS_TEXT: Record<FindingStatus, Bi> = {
  verified: { en: "Verified", es: "Verificado" },
  no_mapped_constraint: { en: "None mapped", es: "Nada mapeado" },
  unable_to_verify: { en: "Unable to verify", es: "No se pudo verificar" },
  not_checked: { en: "Not checked", es: "No verificado" },
  not_evaluated: { en: "Pending proposed activity", es: "Pendiente de la actividad propuesta" },
  requires_professional_review: { en: "Requires professional review", es: "Requiere revisión profesional" },
  not_applicable: { en: "Not applicable", es: "No aplica" },
  checking: { en: "Checking…", es: "Verificando…" },
};
export type ReportTone = "ok" | "info" | "attention" | "hazard" | "unknown";
/**
 * Evaluation scope actually used by a finding (evidence-based):
 *   parcel         the check used the verified CRIM parcel geometry
 *   point          the check used the selected point only (incl. fallbacks)
 *   municipality   a municipality-wide record
 *   not_evaluated  no answer was obtained (not run, failed, pending)
 */
export type ReportScope = "parcel" | "point" | "municipality" | "not_evaluated";
/** Retrieval status of a finding's source (separate from scope). */
export type RetrievalStatus = "answered" | "no_response" | "not_performed" | "pending";
export const RETRIEVAL_TEXT: Record<RetrievalStatus, Bi> = {
  answered: { en: "Source answered", es: "La fuente respondió" },
  no_response: { en: "Source did not respond", es: "La fuente no respondió" },
  not_performed: { en: "Check not performed", es: "Verificación no realizada" },
  pending: { en: "Pending", es: "Pendiente" },
};
export type ReportGroup = "land" | "flood" | "environment";
/**
 * What kind of constraint a finding is:
 *   protection     a conservation / protection designation (protected area,
 *                  conservation district, specially-protected rustic land,
 *                  regulatory floodway). It restricts what can happen on the
 *                  land; extra paperwork does not remove it.
 *   documentation  a review or study that is typically satisfied with
 *                  additional documentation (floodplain review, coastal
 *                  consistency, historic review, geotechnical study).
 *   information    context; no constraint determined.
 */
export type ConstraintClass = "protection" | "documentation" | "information";
/** Where a statement comes from — always shown, never mixed. */
export type StatementBasis = "official" | "rule" | "ai" | "professional";
/**
 * Basis of a finding, derived from its state (see findingBasis):
 *   official            an official source answered (something or nothing mapped)
 *   rule                a deterministic rule result from SmartPR's knowledge graph
 *   not_performed       SmartPR did not run this check (never "official")
 *   source_unavailable  the official source did not answer
 *   professional        needs professional interpretation
 */
export type FindingBasis = "official" | "rule" | "not_performed" | "source_unavailable" | "professional";
export const BASIS_TEXT: Record<FindingBasis, Bi> = {
  official: { en: "Official map finding", es: "Hallazgo de mapa oficial" },
  rule: { en: "Rule result", es: "Resultado de regla" },
  not_performed: { en: "Check not performed", es: "Verificación no realizada" },
  source_unavailable: { en: "Source unavailable", es: "Fuente no disponible" },
  professional: { en: "Professional interpretation needed", es: "Requiere interpretación profesional" },
};
export function findingBasis(state: ReportFindingState, ruleBased = false): FindingBasis {
  if (state === "sourced" || state === "none_mapped") return ruleBased ? "rule" : "official";
  if (state === "review") return "professional";
  if (state === "unavailable" || state === "stale") return "source_unavailable";
  return "not_performed";
}

export interface ReportSource {
  name: string;
  url: string | null;
  /** Date of the data behind the answer (FIRM effective date, JP vigencia, CRIM edition). */
  dataset_date: string | null;
  version: string | null;
}

export interface ReportFinding {
  id: string;
  group: ReportGroup;
  title: Bi;
  /** Short value ("Zone X", "R-G · A-B"); null when nothing determined. */
  value: Bi | null;
  /** One plain-language line. */
  detail: Bi | null;
  /** What it means in everyday words ("Low flood risk area"). Null when not determined. */
  plain?: Bi | null;
  /** Short chip text for the compact preview ("Low flood risk"). */
  pill?: Bi | null;
  state: ReportFindingState;
  tone: ReportTone;
  scope: ReportScope;
  sources: ReportSource[];
  /** When SmartPR looked this up (ISO). */
  looked_up_at: string | null;
  /** The point the answer is for — always the confirmed site (see belongsToSite). */
  point: { latitude: number; longitude: number } | null;
  /** Shown in the compact preview. */
  key: boolean;
  /** Where the statement comes from (never AI); derived from the state. */
  basis: FindingBasis;
  constraint: ConstraintClass;
  /** For parcel-wide findings: the answer at the pin, kept separate. */
  pin?: { value: Bi; source: string | null } | null;
  /** Parcel coverage by category (precise numbers; display strings alongside). */
  coverage?: ReportCoverage | null;
  /** Notes on scope / method (edge tolerance, point-only limitation, overlays). */
  notes?: Bi[];
  /** Official-source ambiguities found while reading the record. */
  ambiguities?: Bi[];
  /** Raw source fields behind the value, by official field name. */
  raw?: Record<string, string | null> | null;
  /** Structured facts for the reviewer assessment (e.g. conservation district codes). */
  meta?: Record<string, string[]>;
  /** Source retrieval status (v3), separate from scope and from the finding's evaluation state. */
  retrieval?: RetrievalStatus;
  /** Scope the check would have used, when it was not evaluated. */
  attempted_scope?: Exclude<ReportScope, "not_evaluated"> | null;
  /** Whether the source layer reflects later plans (e.g. a PT that modified the PUT). */
  currency?: { status: "current" | "unresolved"; reason: Bi; evidence: Array<{ title: string; url: string; note?: string; checked_on?: string }> } | null;
}

/** Parcel coverage as reported (from coverage.ts; numbers unrounded). */
export interface ReportCoverage {
  method: string;
  exclusive: boolean;
  parcel_area_m2: number;
  parts: Array<{ key: string; label: Bi; area_m2: number; share: number; share_text: string; area_text: string; small: boolean; contains_pin: boolean; info?: Bi | null; members?: string[] }>;
  /** Source components before identical classifications were combined (audit). */
  raw_parts?: ReportCoverage["parts"];
  unmapped_m2: number;
  unmapped_share: number;
  overlap_m2: number;
  overlap_share: number;
  /** Categories that only touch the parcel's edge. */
  contacts: string[];
  complete: boolean;
  warnings: Bi[];
}

export interface ReportStep {
  id: string;
  text: Bi;
  /** Why this step appears (the finding it follows from). */
  because: Bi;
  sources: ReportSource[];
  /** Deterministic rule result (fixed logic over official findings). */
  basis: "rule";
  constraint: ConstraintClass;
  /**
   * mapped_constraint  what the maps show; prescribes nothing
   * preparation        what to provide / confirm next
   * Project-specific requirements come only from land_use (activity + verified rule).
   */
  kind?: "mapped_constraint" | "preparation";
}

export interface PropertyReportContext {
  /** What the user already described in intake (never asked again). */
  activity: string | null;
  businessType: string | null;
  projectTypes: string[];
  /** Location-dependent requirements the rules engine already produced. */
  locationRequirements: Array<{ title: string; reason: string | null }>;
}

export const REPORT_SCHEMA = "smartpr.property-report/v3" as const;
export const REPORT_SCHEMAS_READABLE = ["smartpr.property-report/v1", "smartpr.property-report/v2", REPORT_SCHEMA] as const;

export interface PropertyReport {
  schema: (typeof REPORT_SCHEMAS_READABLE)[number];
  /** Content fingerprint: same location + same answers → same id. */
  fingerprint: string;
  location_revision: number;
  generated_at: string;
  property: {
    title: string;
    address: { primary: string; secondary: string; formatted: string | null };
    municipality: string;
    barrio: string | null;
    latitude: number;
    longitude: number;
    coordinate_source: IntakeSite["coordinate_source"];
    precision: "parcel" | "point" | "address";
    near_boundary: boolean;
    catastro: { value: string | null; state: ReportFindingState; source: ReportSource | null; /** What to show when there is no value — never an environmental disclaimer. */ text?: Bi };
    /**
     * Location validation (v3). parcel = "verified" only when a CRIM parcel
     * boundary geometry was identified at the pin (an id alone is not enough).
     * point_confirmed is the user's confirmation of the pin — never a parcel verification.
     */
    location?: { parcel: "verified" | "not_identified" | "unavailable" | "loading" | "not_looked_up"; roadway: boolean; point_confirmed: boolean; preliminary: boolean; notices: Bi[] };
    boundary: { state: ReportFindingState; geometry: unknown | null; area_m2: number | null; source: ReportSource | null };
    /** Map context: neighbouring parcels and shapes of findings that cover only part of the parcel (display only). */
    map?: { neighbors: Array<{ catastro: string | null; geometry: unknown }>; partials: Array<{ id: string; layer: string; label: Bi; share_text: string; tone: ReportTone; geometry: unknown }> };
    /** Approximate area: a number with units, or "Not available" with the reason — never a status label as the value. */
    area?: { m2: number | null; cuerdas: number | null; text: Bi; note: Bi };
    technical: {
      nad83_state_plane: { x: number; y: number; epsg: 32161; note: Bi; crs?: string; units?: string; projection?: string; datum_note?: Bi };
      municipality_fips: string | null;
      barrio_geoid: string | null;
      location_id: string | null;
    };
  };
  findings: ReportFinding[];
  next_steps: {
    activity: Bi;
    missing: Bi[];
    unresolved: Bi[];
    steps: ReportStep[];
    location_requirements: Array<{ title: string; reason: string | null }>;
  };
  sources: ReportSource[];
  /** AI explanations of verified findings (none are generated yet; kept separate when they are). */
  ai_explanations: Array<{ finding_id: string; text: Bi; model: string }>;
  /** Proposed activity + land-use determination (when the user described one). */
  land_use?: LandUseAnalysis | null;
  /** Compact Regulatory Flags summary for the top of the report. */
  flags?: Array<{ id: string; label: Bi; value: Bi; tone: ReportTone; status: FindingStatus }>;
  /** Overall regulatory complexity, derived from listed factors (never arbitrary). Only with a described activity. */
  complexity?: LandUseAnalysis["complexity"] | null;
  /**
   * Lead summary (v2):
   *   mapped      what is mapped on this property (official findings, with scope)
   *   may_affect  what may affect the proposed project (activity + verified rules only)
   *   unverified  what remains unverified (sources down, checks not run, ambiguities)
   *   next        what the user should provide or investigate next
   */
  summary?: { mapped: Bi[]; may_affect: Bi[]; unverified: Bi[]; next: Bi[] };
  /** Versions behind this report (schema, coverage method, rule set). */
  versions?: { schema: string; coverage_method: string; rules: string };
  /** The regulation the use rules come from: publication date ≠ confirmed applicability (v3). */
  regulation?: { name: string; version: string | null; publication_date: string | null; url: string | null; applicability: "not_verified" | "verified"; note: Bi };
  /** Discrepancies between sources, each compared at the same spatial scope. */
  discrepancies?: Bi[];
  /** Reviewer reading of the findings (reviewerAssessment.ts): conclusion, status groups, ranked actions, still needed. */
  assessment?: ReviewerAssessment;
  disclaimer: Bi;
}

// ---------------------------------------------------------------------------

const bi = (en: string, es: string = en): Bi => ({ en, es });
const fmtArea = (m2: number) => Math.round(m2 * 10) / 10;

const RC_2023: ReportSource = {
  name: "Reglamento Conjunto para la Evaluación y Expedición de Permisos (2023)",
  url: "https://docs.pr.gov/files/DDEC/OGPe/Reglamentos/RC-2023-E.pdf",
  dataset_date: "2023-06-16",
  version: "2023",
};
const RP_13: ReportSource = {
  name: "Reglamento de Planificación Núm. 13 — Áreas Especiales de Riesgo a Inundación",
  url: "https://jp.pr.gov/reglamentos/",
  dataset_date: null,
  version: null,
};
const PMZC: ReportSource = {
  name: "Programa de Manejo de la Zona Costanera de Puerto Rico (JP / DRNA)",
  url: "https://www.drna.pr.gov/",
  dataset_date: null,
  version: null,
};

/** "03/19/2008" → "2008-03-19" so one dataset date is never shown in two formats. */
export function normalizeDatasetDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d.trim());
  return m ? `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : d;
}
function sourceOf(r: SiteLayerResult): ReportSource {
  return { name: r.source.name, url: r.source.url ?? null, dataset_date: normalizeDatasetDate(r.source.dataset_date), version: r.source.version ?? null };
}

function layerState(r: SiteLayerResult | undefined, current: boolean, loading: boolean): ReportFindingState {
  if (!current) return loading ? "loading" : "stale";
  if (!r) return "not_performed";
  if (r.status === "resolved") return "sourced";
  if (r.status === "none") return "none_mapped";
  // The source answered but nothing usable is mapped (road / water polygon,
  // special-plan area): checked, not "unavailable".
  if (layerAnswered(r)) return "none_mapped";
  return "unavailable";
}

/** Short djb2 hash (fingerprints only, not security). */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const STATE_TEXT: Record<ReportFindingState, Bi> = {
  sourced: bi("Verified", "Verificado"),
  review: bi("Requires professional review", "Requiere revisión profesional"),
  not_applicable: bi("Not applicable", "No aplica"),
  none_mapped: bi("None mapped — not the same as no constraint on the ground", "Nada mapeado — no equivale a ausencia de restricciones en el terreno"),
  unavailable: bi("Unable to verify — source did not respond", "No se pudo verificar — la fuente no respondió"),
  stale: bi("Unable to verify — refreshing for this location", "No se pudo verificar — actualizando para esta ubicación"),
  not_performed: bi("Not checked — SmartPR did not run this check", "No verificado — SmartPR no realizó esta verificación"),
  not_evaluated: bi("Pending proposed activity", "Pendiente de la actividad propuesta"),
  loading: bi("Checking…", "Verificando…"),
};
export const findingStateText = (s: ReportFindingState) => STATE_TEXT[s] ?? STATE_TEXT.unavailable;

/** Why a source did not answer, in plain words. */
export function reasonText(reason: string | null | undefined): Bi {
  const r = reason ?? "";
  const t = /^timeout_(\d+)ms/.exec(r);
  if (t) return bi(`timed out after ${Math.round(Number(t[1]) / 1000)} s`, `no respondió en ${Math.round(Number(t[1]) / 1000)} s`);
  if (/^http_403/.test(r)) return bi("the source refused the request (HTTP 403)", "la fuente rechazó la solicitud (HTTP 403)");
  const h = /^http_(\d+)/.exec(r);
  if (h) return bi(`the source returned an error (HTTP ${h[1]})`, `la fuente devolvió un error (HTTP ${h[1]})`);
  if (/^network_error|circuit_open/.test(r)) return bi("the source could not be reached", "no se pudo contactar la fuente");
  if (/^outside_puerto_rico/.test(r)) return bi("the point is outside Puerto Rico", "el punto está fuera de Puerto Rico");
  return bi(r ? `the source did not answer (${r})` : "the source did not answer", r ? `la fuente no respondió (${r})` : "la fuente no respondió");
}

const SMALL_NOTE = bi(
  "Small intersection. The maps alone cannot tell whether this is a real strip of the area or a difference in how the two maps' edges were drawn; confirm with a survey if it matters.",
  "Intersección pequeña. Los mapas por sí solos no indican si es una franja real del área o una diferencia en cómo se trazaron los bordes de ambos mapas; confírmelo con una mensura si importa."
);
const NONE_MAPPED_NOTE = bi(
  "Nothing is mapped here in this layer. That is not the same as no constraint on the ground.",
  "Nada está mapeado aquí en esta capa. Eso no equivale a que no haya restricciones en el terreno."
);
const CUERDA_M2 = 3930.395;
const pctText = (share: number) => formatShare(share, true);

/** coverage.ts result → report coverage with display strings and plain-language warnings. */
type KeyText = (key: string, lang?: "en" | "es") => string;
function toReportCoverage(c: Coverage, label: (key: string) => Bi, keyText: KeyText = (k) => k, groupOf?: (key: string) => string, groupLabel?: (group: string, members: string[]) => Bi): ReportCoverage {
  const others = c.parts.length + (c.unmapped_share > UNMAPPED_WARN_SHARE ? 1 : 0) > 1;
  const warnings: Bi[] = [];
  for (const w of c.warnings) {
    if (w.code === "unmapped") warnings.push(bi(`No polygon in this layer covers ${formatShare(w.share, true)} of the parcel (${formatArea(w.area_m2)}). That part is unmapped, not "none".`, `Ningún polígono de esta capa cubre ${formatShare(w.share, true)} de la parcela (${formatArea(w.area_m2)}). Esa parte no está mapeada; no equivale a "ninguno".`));
    if (w.code === "overlap") warnings.push(bi(`Categories in this layer overlap on ${formatArea(w.area_m2)} (${formatShare(w.share, true)} of the parcel). They should not overlap; shares add up to more than 100%. Confirm with the source agency.`, `Las categorías de esta capa se solapan en ${formatArea(w.area_m2)} (${formatShare(w.share, true)} de la parcela). No deberían solaparse; los porcentajes suman más de 100%. Confírmelo con la agencia.`));
    if (w.code === "duplicates_dissolved") warnings.push(bi(`Duplicate or overlapping polygons of the same category (${w.keys.map((k) => keyText(k, "en")).join(", ")}) were merged so their area is counted once.`, `Polígonos duplicados o solapados de la misma categoría (${w.keys.map((k) => keyText(k, "es")).join(", ")}) se unieron para contar su área una sola vez.`));
    if (w.code === "snapped") warnings.push(bi(`To compute the area of ${w.keys.map((k) => keyText(k, "en")).join(", ")}, vertices were snapped to a ${w.grid_m * 100} cm grid (the exact geometry made the clipping library fail). Rounding effect: under ${w.grid_m * 100} cm along edges.`, `Para calcular el área de ${w.keys.map((k) => keyText(k, "es")).join(", ")}, los vértices se ajustaron a una cuadrícula de ${w.grid_m * 100} cm (la geometría exacta hizo fallar la biblioteca de recorte). Efecto de redondeo: menos de ${w.grid_m * 100} cm en los bordes.`));
    if (w.code === "intersection_failed") warnings.push(bi(`The area of ${w.keys.map((k) => keyText(k, "en")).join(", ")} could not be computed; shares are incomplete.`, `No se pudo calcular el área de ${w.keys.map((k) => keyText(k, "es")).join(", ")}; los porcentajes están incompletos.`));
  }
  return {
    method: c.method,
    exclusive: c.exclusive,
    parcel_area_m2: c.parcel_area_m2,
    ...(() => {
      const raw = c.parts.map((p) => ({ key: p.key, label: label(p.key), area_m2: p.area_m2, share: p.share, share_text: formatShare(p.share, others), area_text: formatArea(p.area_m2), small: p.small, contains_pin: c.pin_key === p.key }));
      if (!groupOf) return { parts: raw };
      // Identical classifications (same display class) are combined; the components stay in raw_parts.
      const groups = new Map<string, typeof raw>();
      for (const p of raw) groups.set(groupOf(p.key), [...(groups.get(groupOf(p.key)) ?? []), p]);
      if ([...groups.values()].every((g) => g.length === 1)) return { parts: raw };
      const gOthers = groups.size + (c.unmapped_share > UNMAPPED_WARN_SHARE ? 1 : 0) > 1;
      const parts = [...groups.entries()].map(([g, ms]) => {
        const area = ms.reduce((s, m) => s + m.area_m2, 0), share = ms.reduce((s, m) => s + m.share, 0);
        return { key: g, label: groupLabel ? groupLabel(g, ms.map((m) => m.key)) : label(g), area_m2: area, share, share_text: formatShare(share, gOthers), area_text: formatArea(area), small: share < SMALL_SHARE, contains_pin: ms.some((m) => m.contains_pin), members: ms.map((m) => m.key) };
      }).sort((a, b) => b.area_m2 - a.area_m2);
      return { parts, raw_parts: raw };
    })(),
    unmapped_m2: c.unmapped_m2,
    unmapped_share: c.unmapped_share,
    overlap_m2: c.overlap_m2,
    overlap_share: c.overlap_share,
    contacts: c.contacts ?? [],
    complete: c.complete,
    warnings,
  };
}

/** "R-G 86.1% · R-I 13.9%" (small parts marked). */
function coverageValue(rc: ReportCoverage, keyText: KeyText = (k) => k, smallWord: Bi = bi("small", "pequeña")): Bi {
  const t = (l: "en" | "es") => rc.parts.map((p) => `${keyText(p.key, l)} ${p.share_text}${p.small ? ` (${smallWord[l]})` : ""}`).join(" · ");
  return bi(t("en"), t("es"));
}
/** One line per part: "R-G (Rural General): 13,053 m² — 86.1% of the parcel · contains the pin". */
function coverageLines(rc: ReportCoverage, keyText: KeyText = (k) => k): Bi[] {
  const line = (p: ReportCoverage["parts"][number], l: "en" | "es") => {
    const k = keyText(p.key, l);
    const label = p.label[l] && !k.includes(p.label[l]) ? ` (${p.label[l]})` : "";
    return l === "en"
      ? `${k}${label}: ${p.area_text} — ${p.share_text} of the parcel${p.contains_pin ? " · contains the pin" : ""}.${p.small ? " Small intersection." : ""}`
      : `${k}${label}: ${p.area_text} — ${p.share_text} de la parcela${p.contains_pin ? " · contiene el pin" : ""}.${p.small ? " Intersección pequeña." : ""}`;
  };
  const lines = rc.parts.map((p) => bi(line(p, "en"), line(p, "es")));
  if (rc.contacts.length) lines.push(bi(`${rc.contacts.map((k) => keyText(k, "en")).join(", ")}: touches the parcel's edge only (no area inside).`, `${rc.contacts.map((k) => keyText(k, "es")).join(", ")}: solo toca el borde de la parcela (sin área dentro).`));
  return lines;
}
const joinBi = (xs: Bi[], sep = " "): Bi => bi(xs.map((x) => x.en).join(sep), xs.map((x) => x.es).join(sep));

/** Legacy parcel answers (before coverage.ts): shares normalized to the mapped total. */
function legacyCoverage(items: Array<{ key: string; area_m2?: number | null; share?: number | null }>, parcelArea: number | null): Coverage | null {
  if (!items.length || items.some((i) => i.share === null || i.share === undefined)) return null;
  return {
    method: "Earlier report version: shares normalized to the mapped total (unmapped area not computed).",
    exclusive: true,
    parcel_area_m2: parcelArea ?? 0,
    parts: items.map((i) => ({ key: i.key, area_m2: i.area_m2 ?? 0, share: i.share!, small: i.share! < SMALL_SHARE, features: 1 })).sort((a, b) => b.share - a.share),
    covered_m2: parcelArea ?? 0, covered_share: 1, unmapped_m2: 0, unmapped_share: 0, overlap_m2: 0, overlap_share: 0,
    pin_key: null, contacts: [], complete: true, warnings: [],
  };
}

/** Flood coverage key "AE|FLOODWAY" → "AE floodway"; "X|0.2 PCT…" → "X (0.2%)". */
const floodKeyText: KeyText = (k, l = "en") => {
  const [zone, sub] = k.split("|");
  return `${zone}${/FLOODWAY/i.test(sub ?? "") ? (l === "es" ? " cauce mayor" : " floodway") : /0\.2/.test(sub ?? "") ? " (0.2%)" : ""}`;
};
const floodZoneText: KeyText = (k, l = "en") => `${l === "es" ? "Zona" : "Zone"} ${floodKeyText(k, l)}`;

/**
 * Build the report. `parcel` is used only when it was looked up for the
 * site's exact coordinates; anything else is treated as stale.
 */
export function buildPropertyReport(input: {
  site: IntakeSite;
  parcel: ParcelFindings | null;
  parcelLoading?: boolean;
  revision: number;
  context: PropertyReportContext;
  /** Land-use analysis for the proposed activity (see landUse.ts). */
  landUse?: LandUseAnalysis | null;
  /** The user confirmed the selected point as their property (never a parcel verification). */
  pointConfirmed?: boolean;
  now?: Date;
}): PropertyReport {
  const { site, context } = input;
  const now = (input.now ?? new Date()).toISOString();
  const current = siteLayersCurrent(site);
  const layersLoading = !current && !site.layers;
  const by = new Map((current ? site.layers!.results : []).map((r) => [r.layer, r]));
  const parcel = input.parcel && Math.abs(input.parcel.latitude - site.latitude) < 1e-7 && Math.abs(input.parcel.longitude - site.longitude) < 1e-7 ? input.parcel : null;
  const parcelState = (s: "sourced" | "none_mapped" | "unavailable" | undefined): ReportFindingState => (parcel && s ? s : input.parcelLoading ? "loading" : input.parcel ? "stale" : "not_performed");
  const pt = { latitude: site.latitude, longitude: site.longitude };
  const at = (r?: SiteLayerResult) => r?.retrieved_at ?? (current ? site.layers!.resolved_at : null);
  const findings: ReportFinding[] = [];
  const add = (f: Omit<ReportFinding, "point" | "basis" | "constraint"> & { constraint?: ConstraintClass; ruleBased?: boolean }) => {
    const { ruleBased, ...rest } = f;
    findings.push({ ...rest, constraint: f.constraint ?? "information", point: pt, basis: findingBasis(f.state, ruleBased) });
  };
  const layer = (id: SiteLayerId) => by.get(id);
  const discrepancies: Bi[] = [];
  const parcelArea = parcel?.boundary.value?.area_m2 ?? null;

  // ---- Land & zoning -------------------------------------------------------
  const zParcel = parcel?.zoning;
  const zPoint = layer("zoning");
  const zPin = zPoint?.status === "resolved" && current ? zPoint : null;
  // ---- Location validation (evidence-based) ---------------------------------
  const parcelVerified = !!parcel?.boundary.value;
  const parcelStatus: NonNullable<PropertyReport["property"]["location"]>["parcel"] = parcelVerified ? "verified"
    : input.parcelLoading ? "loading"
    : !parcel ? "not_looked_up"
    : parcel.boundary.status === "unavailable" ? "unavailable" : "not_identified";
  const roadwayAtPin = !!zPin && (/^VIAL$/i.test(zPin.code ?? "") || zPin.tags.includes("road") || /sistema vial/i.test(zPin.name ?? ""));
  const roadway = !parcelVerified && (roadwayAtPin || parcel?.boundary.reason === "only_right_of_way_polygon_at_point");
  const pointConfirmed = !!input.pointConfirmed;
  const zCovRaw = zParcel?.status === "sourced" ? (zParcel.coverage ?? (parcel?.areas_reliable?.zoning ? legacyCoverage(zParcel.districts.map((d) => ({ key: d.code, area_m2: d.area_m2, share: d.share })), parcelArea) : null)) : null;
  const districtName = (code: string) => zParcel?.districts.find((d) => d.code === code)?.name ?? null;
  const zCov = zCovRaw ? toReportCoverage(zCovRaw, (k) => bi(districtName(k) ?? k)) : null;
  if (zParcel && zParcel.status === "sourced") {
    const base = zParcel.districts;
    const multi = base.length > 1;
    const detail: Bi[] = zCov
      ? coverageLines(zCov)
      : multi
        ? [bi(`The parcel intersects ${base.length} districts: ${base.map((d) => `${d.code}${d.name ? ` (${d.name})` : ""}`).join(", ")}. Their areas could not be computed.`, `La parcela intersecta ${base.length} distritos: ${base.map((d) => `${d.code}${d.name ? ` (${d.name})` : ""}`).join(", ")}. No se pudieron calcular sus áreas.`)]
        : [bi(`${base[0]!.code}${base[0]!.name ? ` — ${base[0]!.name}` : ""}`)];
    const notes: Bi[] = [...(zCov?.warnings ?? [])];
    if (zCov?.parts.some((p) => p.small)) notes.push(SMALL_NOTE);
    // Districts the source returned whose area could not be measured stay listed (unknown, never "none").
    const unmeasured = zCov ? base.filter((d) => !zCov.parts.some((p) => p.key === d.code)).map((d) => d.code) : [];
    if (unmeasured.length) detail.push(bi(`${unmeasured.join(", ")}: on the parcel per the source, but the area could not be measured.`, `${unmeasured.join(", ")}: en la parcela según la fuente, pero no se pudo medir el área.`));
    const zValue = zCov ? coverageValue(zCov) : bi(base.map((d) => d.code).join(" · "));
    add({
      id: "zoning",
      group: "land",
      title: bi("Calificación (zoning)", "Calificación"),
      value: unmeasured.length ? bi(`${zValue.en} · ${unmeasured.map((c) => `${c} (area not measured)`).join(" · ")}`, `${zValue.es} · ${unmeasured.map((c) => `${c} (área no medida)`).join(" · ")}`) : zValue,
      detail: joinBi(detail, " "),
      state: "sourced",
      tone: multi && (zCov ? zCov.parts.filter((p) => !p.small).length > 1 : true) ? "attention" : "info",
      scope: zParcel.scope,
      sources: [{ name: zParcel.source.name, url: zParcel.source.url, dataset_date: base[0]?.effective ?? zParcel.source.dataset_date, version: base[0]?.resolution ?? null }],
      looked_up_at: parcel!.retrieved_at,
      key: true,
      coverage: zCov,
      // A separate pin answer only when the main value covers the verified parcel.
      pin: zPin && zParcel.scope === "parcel" && parcelVerified ? { value: bi(`${zPin.code}${zPin.name ? ` — ${zPin.name}` : ""}`), source: zPin.source.name } : null,
      notes,
    });
    // Same scope only: the pin layer vs the parcel geometry at the pin.
    const covPin = zCov?.parts.find((p) => p.contains_pin)?.key ?? null;
    if (zPin?.code && covPin && covPin !== zPin.code) {
      discrepancies.push(bi(`Zoning at the pin differs between two JP answers: the point lookup says ${zPin.code}, the parcel geometry puts the pin in ${covPin}. Confirm with the Junta de Planificación.`,
                            `La calificación en el pin difiere entre dos respuestas de la JP: la consulta del punto indica ${zPin.code}; la geometría de la parcela ubica el pin en ${covPin}. Confírmelo con la Junta de Planificación.`));
    } else if (zPin?.code && !covPin && !base.some((d) => d.code === zPin.code)) {
      discrepancies.push(bi(`Zoning: the pin (inside this parcel) is ${zPin.code}, but the parcel query did not return ${zPin.code}. Confirm with the Junta de Planificación.`,
                            `Calificación: el pin (dentro de esta parcela) es ${zPin.code}, pero la consulta de la parcela no devolvió ${zPin.code}. Confírmelo con la Junta de Planificación.`));
    }
    const allOverlays = base.flatMap((d) => d.overlays ?? (d.overlay ? [{ code: d.overlay.code, name: d.overlay.name, resolution: null, effective: null }] : []));
    const overlays = allOverlays.filter((o, i) => allOverlays.findIndex((x) => x.code === o.code) === i);
    if (overlays.length) {
      const oc = zParcel.overlay_coverage ? toReportCoverage(zParcel.overlay_coverage, (k) => bi(overlays.find((o) => o.code === k)?.name ?? k)) : null;
      add({
        id: "zoning_overlay",
        group: "land",
        title: bi("Overlay districts", "Distritos sobrepuestos"),
        value: oc ? coverageValue(oc) : bi(overlays.map((o) => o.code).join(" · ")),
        detail: bi(overlays.map((o) => `${o.code}${o.name ? ` — ${o.name}` : ""}${o.resolution ? ` (${o.resolution}${o.effective ? `, ${o.effective}` : ""})` : ""}`).join("; ")),
        state: "sourced", tone: "attention", scope: zParcel.scope,
        sources: [{ name: zParcel.source.name, url: zParcel.source.url, dataset_date: null, version: null }],
        looked_up_at: parcel!.retrieved_at, key: false,
        coverage: oc,
        notes: [bi("Overlays apply on top of the base district, so their share legitimately overlaps the base districts' shares.", "Los distritos sobrepuestos aplican encima del distrito base; por eso su porcentaje se solapa legítimamente con el de los distritos base.")],
      });
    }
  } else {
    const st = zParcel ? (zParcel.status === "none_mapped" ? "none_mapped" : "unavailable") : layerState(zPoint, current, layersLoading);
    const why = zParcel?.status === "unavailable" ? reasonText(zParcel.reason) : !parcel?.boundary.value && parcel ? bi("no parcel boundary at the pin", "no hay límite de parcela en el pin") : null;
    add({
      id: "zoning",
      group: "land",
      title: bi("Calificación (zoning)", "Calificación"),
      value: zPin ? bi(zPin.code ?? "") : null,
      detail: zPin
        ? bi(`At the pin: ${zPin.code}${zPin.name ? ` — ${zPin.name}` : ""}. Whole-parcel districts not determined${why ? ` (${why.en})` : ""}; other districts may cover part of the lot.`,
             `En el pin: ${zPin.code}${zPin.name ? ` — ${zPin.name}` : ""}. No se determinaron los distritos de toda la parcela${why ? ` (${why.es})` : ""}; otros distritos pueden cubrir parte del solar.`)
        : st === "none_mapped"
          ? bi("No calificación polygon here (special-plan area or unmapped). Zoning is unknown, not absent.", "No hay polígono de calificación aquí (área de plan especial o sin mapear). La calificación es desconocida, no inexistente.")
          : why ? bi(`Unable to verify: ${why.en}.`, `No se pudo verificar: ${why.es}.`) : null,
      state: zPin ? "sourced" : st,
      tone: zPin ? "info" : "unknown",
      scope: "point",
      sources: zPoint ? [sourceOf(zPoint)] : [],
      looked_up_at: at(zPoint),
      key: true,
    });
  }

  const lc = layer("land_class");
  const lcVersion = lc?.source.version ?? "";
  const ptResolution = /\bPT\b|-PT-/.test(lcVersion);
  add({
    id: "land_class",
    group: "land",
    title: bi("Land classification (calificación map)", "Clasificación del suelo (mapa de calificación)"),
    value: lc?.status === "resolved" && current ? bi(`${lc.code}${lc.name ? ` — ${lc.name}` : ""}`) : null,
    detail: ptResolution
      ? bi(`At the pin, from the JP calificación map, recorded under ${lcVersion.split(" · ")[0]} — a municipal Plan Territorial resolution, so this is the PT's classification. The island-wide PUT classification is a separate plan, listed separately.`,
           `En el pin, del mapa de calificación de la JP, registrado bajo ${lcVersion.split(" · ")[0]} — una resolución de Plan Territorial municipal, por lo que es la clasificación del PT. La clasificación del PUT (todo Puerto Rico) es un plan distinto y se muestra aparte.`)
      : bi("At the pin, from the JP calificación map. The island-wide PUT classification is a separate plan, listed separately.", "En el pin, del mapa de calificación de la JP. La clasificación del PUT (todo Puerto Rico) es un plan distinto y se muestra aparte."),
    state: layerState(lc, current, layersLoading),
    tone: lc?.status === "resolved" ? "info" : "unknown",
    scope: "point",
    sources: lc ? [sourceOf(lc)] : [],
    looked_up_at: at(lc),
    key: false,
  });
  // PUT, municipal plan, permitted uses — from authoritative layers / the land-use engine.
  const ex = parcel?.extras ?? {};
  const presenceNote = bi(`Checked inside the parcel boundary, excluding a strip about 3 m wide along its edge (so features that only touch the boundary or a neighbour's edge are not counted). A feature lying only within that edge strip would not be detected. This layer returns no shapes, so its area on the parcel is not measured.`, `Verificado dentro del límite de la parcela, excluyendo una franja de unos 3 m a lo largo del borde (para no contar elementos que solo tocan el límite o el borde de un vecino). Un elemento que esté solo dentro de esa franja no se detectaría. Esta capa no devuelve formas, así que su área en la parcela no se mide.`);
  const extraFinding = (e: ExtraFinding | undefined, id: string, group: ReportGroup, title: Bi, fallback: Bi, valueOf?: (e: ExtraFinding) => Bi | null, tone: ReportTone = "info", key = false, extra: Partial<ReportFinding> = {}) => {
    if (!e) {
      add({ id, group, title, value: null, detail: input.parcelLoading ? null : fallback, state: input.parcelLoading ? "loading" : parcel ? "not_performed" : input.parcel ? "stale" : "not_performed", tone: "unknown", scope: "parcel", sources: [], looked_up_at: null, key });
      return;
    }
    const st: ReportFindingState = e.status === "verified" ? "sourced" : e.status === "no_mapped" ? "none_mapped" : "unavailable";
    const r = reasonText(e.reason);
    add({
      id, group, title,
      value: st === "sourced" ? (valueOf ? valueOf(e) : bi(e.value ?? e.items.join(", "))) : st === "none_mapped" ? bi("None mapped", "Nada mapeado") : null,
      detail: st === "sourced" && e.items.length > 1 && !valueOf ? bi(e.items.join("; ")) : st === "unavailable" ? bi(`Unable to verify: ${r.en}.`, `No se pudo verificar: ${r.es}.`) : st === "none_mapped" ? NONE_MAPPED_NOTE : null,
      state: st,
      tone: st === "sourced" ? tone : st === "none_mapped" ? "ok" : "unknown",
      scope: e.scope === "municipality" ? "municipality" : e.scope,
      sources: [{ name: e.source.name, url: e.source.url, dataset_date: e.source.dataset_date, version: e.source.layer }],
      looked_up_at: e.retrieved_at,
      key,
      raw: e.raw ?? null,
      ambiguities: (e.ambiguities ?? []).map((a) => bi(a)),
      ...extra,
    });
  };
  // PUT (island-wide) — with parcel coverage when the layer returned shapes.
  const putCov = ex.put?.coverage ? toReportCoverage(ex.put.coverage, (k) => bi(ex.put!.items.find((i) => i.startsWith(`${k} `))?.replace(/^\S+ — /, "") ?? k)) : null;
  extraFinding(ex.put, "put", "land", bi("PUT classification (island-wide Plan de Uso de Terrenos)", "Clasificación del PUT (Plan de Uso de Terrenos de Puerto Rico)"),
    bi("Not checked for this parcel.", "No se verificó para esta parcela."),
    (e) => putCov
      ? coverageValue(putCov)
      : bi(`${e.value}${e.attributes.resolution ? ` (${e.attributes.resolution}${e.attributes.effective ? `, effective ${e.attributes.effective}` : ""})` : ""}`, `${e.value}${e.attributes.resolution ? ` (${e.attributes.resolution}${e.attributes.effective ? `, vigente ${e.attributes.effective}` : ""})` : ""}`),
    "info", false,
    ex.put?.status === "verified" ? {
      coverage: putCov,
      detail: putCov ? joinBi([...coverageLines(putCov), ...(ex.put.attributes.resolution ? [bi(`Resolution ${ex.put.attributes.resolution}${ex.put.attributes.effective ? `, effective ${ex.put.attributes.effective}` : ""}.`, `Resolución ${ex.put.attributes.resolution}${ex.put.attributes.effective ? `, vigente ${ex.put.attributes.effective}` : ""}.`)] : [])]) : bi(`Classes found on the parcel: ${ex.put.items.join("; ")}. Their areas were not computed${ex.put.parcel_limitation ? ` (${ex.put.parcel_limitation})` : ""}.`, `Clases encontradas en la parcela: ${ex.put.items.join("; ")}. No se calcularon sus áreas${ex.put.parcel_limitation ? ` (${ex.put.parcel_limitation})` : ""}.`),
      pin: ex.put.pin?.key ? { value: bi(ex.put.pin.key), source: ex.put.source.name } : null,
      notes: [bi("The PUT is the island-wide land-use plan. It is separate from the municipal Plan Territorial and from the calificación map.", "El PUT es el plan de usos de terrenos de todo Puerto Rico. Es distinto del Plan Territorial municipal y del mapa de calificación."), ...(putCov?.warnings ?? []), ...(putCov?.parts.some((p) => p.small) ? [SMALL_NOTE] : [])],
    } : {});
  // Municipal Plan Territorial — approval, completed revisions and revision deadlines kept apart.
  // Records saved before the field meanings were mapped carry raw dates and
  // "revision_1" (which is the DUE date): re-read them with the official meanings.
  const ptSaved = ex.plan_territorial;
  const ptE = ptSaved && ptSaved.status === "verified" && !ptSaved.raw
    ? parsePlanTerritorialExtra({ features: [{ attributes: { MUNICIPIO: ptSaved.attributes.municipio, pt_aprobado: ptSaved.attributes.approved, pt_revision_1: ptSaved.attributes.revision_1, Estatus_ripot2: ptSaved.attributes.review_status, orden_ejecutiva: ptSaved.attributes.executive_order } }] } as never, ptSaved.source, ptSaved.retrieved_at)
    : ptSaved;
  const ptValue = (e: ExtraFinding): Bi => {
    const a = e.attributes;
    const raw = e.raw ?? {};
    const d = (iso: unknown, rawField: string, l: "en" | "es") => (typeof iso === "string" ? ptDateText(iso, l) : raw[rawField] ? `"${raw[rawField]}" (${l === "es" ? "según consta" : "as recorded"})` : null);
    const build = (l: "en" | "es") => {
      const out: string[] = [];
      const ap = d(a.approved, PT_FIELDS.approved.field, l);
      if (ap) out.push(l === "es" ? `Aprobado ${ap}` : `Approved ${ap}`);
      for (const n of [1, 2] as const) {
        const r = d(a[`revision_${n}_approved`], PT_FIELDS[`revision_${n}_approved`].field, l);
        if (r) out.push(l === "es" ? `${n === 1 ? "primera" : "segunda"} revisión aprobada ${r}` : `${n === 1 ? "first" : "second"} revision approved ${r}`);
      }
      if (a.pending_revision && typeof a.pending_revision_due === "string") {
        const due = ptDateText(a.pending_revision_due, l);
        const passed = a.pending_revision_due_passed === "yes";
        const nth = a.pending_revision === 1 ? (l === "es" ? "primera" : "first") : (l === "es" ? "segunda" : "second");
        out.push(l === "es" ? (passed ? `la ${nth} revisión vencía el ${due}; no consta su aprobación` : `la ${nth} revisión vence el ${due}`) : (passed ? `${nth} revision was due ${due}; no approval recorded` : `${nth} revision due ${due}`));
      }
      return out.join(" · ");
    };
    return bi(build("en"), build("es"));
  };
  extraFinding(ptE, "municipal_plan", "land", bi("Municipal Plan Territorial (PT)", "Plan Territorial municipal (PT)"),
    bi(`Not checked whether ${site.municipality.name} has an approved Plan Territorial.`, `No se verificó si ${site.municipality.name} tiene un Plan Territorial aprobado.`),
    ptValue, "info", false,
    ptE?.status === "verified" ? {
      detail: (() => {
        const raw = ptE.raw ?? {};
        const fields = (Object.keys(PT_FIELDS) as Array<keyof typeof PT_FIELDS>).filter((k) => raw[PT_FIELDS[k].field]);
        const src = fields.map((k) => `${PT_FIELDS[k].field} ("${PT_FIELDS[k].alias}") = ${raw[PT_FIELDS[k].field]}`).join("; ");
        const status = [raw.Estatus_ripot2, raw.Estatus_ripot].filter(Boolean).join(" / ");
        return bi(`From the JP record for ${ptE.attributes.municipio ?? site.municipality.name}: ${src}.${status ? ` Status recorded: ${status}.` : ""} A "Toca … Revision" field is a revision deadline, not a completed revision.`,
                  `Del registro de la JP para ${ptE.attributes.municipio ?? site.municipality.name}: ${src}.${status ? ` Estado registrado: ${status}.` : ""} Un campo "Toca … Revision" es una fecha límite de revisión, no una revisión completada.`);
      })(),
      notes: [bi("Municipal-wide record (not a parcel finding). The PT is separate from the island-wide PUT.", "Registro de todo el municipio (no es un hallazgo de la parcela). El PT es distinto del PUT de todo Puerto Rico.")],
    } : {});
  // PUT currency: a Plan Territorial approved after the PUT version on the layer
  // may have modified the PUT (PUT-PR Cap. 4, Sec. B(4)). Unless curated evidence
  // shows the layer incorporates it, the PUT reading is marked unresolved.
  const putF = findings.find((x) => x.id === "put");
  const ptApproved = ptE?.status === "verified" && typeof ptE.attributes.approved === "string" ? ptE.attributes.approved : null;
  if (putF && putF.state === "sourced" && ptApproved && ptApproved > PUT_LAYER_VERSION_DATE) {
    const cur = (PLAN_CURRENCY.municipalities as Record<string, PlanCurrencyEntry>)[site.municipality.name];
    const curated = cur?.put;
    const resolved = curated?.status === "current";
    putF.currency = {
      status: resolved ? "current" : "unresolved",
      reason: curated?.plan_modifies_put
        ? bi(`${site.municipality.name}'s Plan Territorial (${cur!.plan.resolution}, effective ${cur!.plan.effective}) includes a minor modification to the PUT-PR 2015 classification map. The PUT layer carries only the 2015 version (no ${cur!.plan.resolution} records), so whether this parcel's PUT classification changed is unresolved. Use the plan's own classification map and confirm with the JP.`,
             `El Plan Territorial de ${site.municipality.name} (${cur!.plan.resolution}, vigente ${cur!.plan.effective}) incluye una modificación menor al mapa de clasificación del PUT-PR 2015. La capa del PUT solo contiene la versión de 2015 (sin registros de ${cur!.plan.resolution}), por lo que no se ha resuelto si la clasificación PUT de esta parcela cambió. Use el mapa de clasificación del propio plan y confirme con la JP.`)
        : bi(`${site.municipality.name}'s Plan Territorial was approved (${ptApproved}) after the PUT version on this layer (2015-11-30). A PT may modify the PUT; SmartPR has not confirmed whether it did here.`,
             `El Plan Territorial de ${site.municipality.name} se aprobó (${ptApproved}) después de la versión del PUT de esta capa (2015-11-30). Un PT puede modificar el PUT; SmartPR no ha confirmado si lo hizo aquí.`),
      evidence: cur ? [...cur.plan.documents, { title: "PUT layer check", url: curated?.layer_check?.layer ?? "", note: curated?.layer_check?.finding, checked_on: curated?.layer_check?.checked_on }].filter((d) => d.url) : [],
    };
    if (!resolved) {
      putF.tone = "attention";
      putF.notes = [...(putF.notes ?? []), bi("PUT currency unresolved — compatibility conclusions that depend on the PUT class are held back.", "Vigencia del PUT sin resolver — se retienen las conclusiones de compatibilidad que dependen de la clase del PUT.")];
    }
  }
  // Use rules are never evaluated on a roadway point (VIAL is not a developable district).
  const lu = roadway ? null : input.landUse ?? null;
  const usesScope: ReportScope = parcelVerified && zParcel?.status === "sourced" ? "parcel" : "point";
  const rulesVersion = bi(
    `Rules: ${RC_2023.name}, version ${RC_2023.version} (dated ${RC_2023.dataset_date}), as recorded in SmartPR's knowledge graph. SmartPR has not confirmed whether later amendments apply.${ptE?.status === "verified" ? ` ${site.municipality.name} has an approved Plan Territorial; its own provisions may also apply.` : ""}`,
    `Reglas: ${RC_2023.name}, versión ${RC_2023.version} (fecha ${RC_2023.dataset_date}), según constan en el grafo de conocimiento de SmartPR. SmartPR no ha confirmado si aplican enmiendas posteriores.${ptE?.status === "verified" ? ` ${site.municipality.name} tiene un Plan Territorial aprobado; sus propias disposiciones también pueden aplicar.` : ""}`
  );
  if (lu && lu.activity.use) {
    const c = lu.compatibility;
    const reading = bi(`${lu.activity.useName}: ${COMPATIBILITY_TEXT[c.baseOutcome ?? c.outcome].en}`, `${lu.activity.useName}: ${COMPATIBILITY_TEXT[c.baseOutcome ?? c.outcome].es}`);
    // The decision (landUse.ts) is the one result: undetermined unless the governing
    // rules, overlays and project facts support a rule-based conclusion.
    const dec = lu.decision;
    const pointNote = usesScope === "point" ? bi(" Based on the selected point only.", " Basado solo en el punto seleccionado.") : bi("");
    add({
      id: "permitted_uses", group: "land",
      title: bi("Permitted-use analysis", "Análisis de usos permitidos"),
      value: dec ? (dec.compatibility.status === "undetermined" ? bi(`${DECISION_TEXT.undetermined.en} — see the evidence gaps`, `${DECISION_TEXT.undetermined.es} — vea las brechas de evidencia`) : dec.compatibility.label) : bi("Pending — governing regulation not verified", "Pendiente — reglamento aplicable no verificado"),
      detail: dec ? bi(`${dec.compatibility.reason.en}${pointNote.en}`, `${dec.compatibility.reason.es}${pointNote.es}`)
        : bi(`Preliminary reading under ${RC_2023.name} (not confirmed to govern this site${usesScope === "point" ? "; based on the selected point only" : ""}): ${reading.en}. ${[...lu.districts.filter((d) => !d.sliver && d.conditions.length).flatMap((d) => d.conditions), ...c.reasons].join(" ")}`.trim(),
                 `Lectura preliminar según el ${RC_2023.name} (no confirmado como aplicable a este lugar${usesScope === "point" ? "; basada solo en el punto seleccionado" : ""}): ${reading.es}. ${[...lu.districts.filter((d) => !d.sliver && d.conditions.length).flatMap((d) => d.conditions), ...c.reasons].join(" ")}`.trim()),
      state: "review",
      ruleBased: true,
      tone: "attention",
      scope: usesScope,
      sources: lu.districts.flatMap((d) => d.sources).map((x) => ({ name: x.name, url: x.url, dataset_date: null, version: x.citation || null })),
      looked_up_at: parcel?.retrieved_at ?? null, key: false,
      notes: [rulesVersion],
    });
  } else {
    add({
      id: "permitted_uses", group: "land",
      title: bi("Permitted-use analysis", "Análisis de usos permitidos"),
      value: roadway ? bi("Not evaluated — selected point is a roadway (VIAL)", "No evaluado — el punto seleccionado es una vía (VIAL)") : bi("Pending proposed activity", "Pendiente de la actividad propuesta"),
      detail: roadway
        ? bi("Not evaluated: the selected point is mapped as a roadway (VIAL / Sistema vial), which is not a developable zoning district. Confirm the exact property first.", "No evaluado: el punto seleccionado está mapeado como vía (VIAL / Sistema vial), que no es un distrito de calificación desarrollable. Confirme primero la propiedad exacta.")
        : bi("Unable to evaluate until the proposed activity is provided.", "No se puede evaluar hasta que se indique la actividad propuesta."),
      state: "not_evaluated", tone: "unknown", scope: "not_evaluated", sources: [RC_2023], looked_up_at: null, key: false,
      notes: [rulesVersion],
    });
  }

  // ---- Flood & water --------------------------------------------------------
  const fz = layer("flood_zone");
  const fm = current ? floodMapSummary(site.layers) : null;
  const fParcel = parcel?.flood;
  const parcelZones = fParcel?.status === "sourced" ? fParcel.zones : [];
  const fCovRaw = fParcel?.status === "sourced" ? (fParcel.coverage ?? (parcel?.areas_reliable?.flood ? legacyCoverage(parcelZones.map((z) => ({ key: `${z.zone}|${z.subtype ?? ""}`, area_m2: z.area_m2, share: z.share })), parcelArea) : null)) : null;
  // Same FEMA zone with different subtypes (e.g. AE and AE floodway) is one zone in the summary; shaded X (0.2%) stays distinct.
  const floodGroup = (k: string) => { const [z, sub] = k.split("|"); return /0\.2/.test(sub ?? "") ? `${z}|0.2` : `${z}|`; };
  const fCov = fCovRaw ? toReportCoverage(fCovRaw, (k) => bi(floodZoneText(k, "en"), floodZoneText(k, "es")), floodKeyText, floodGroup,
    (g, ms) => { const fw = ms.filter((m) => /FLOODWAY/i.test(m)); return bi(`${floodZoneText(g, "en")}${fw.length ? " (includes regulatory floodway portion)" : ""}`, `${floodZoneText(g, "es")}${fw.length ? " (incluye porción de cauce mayor)" : ""}`); }) : null;
  const fRaw = fCov ? (fCov.raw_parts ?? fCov.parts) : [];
  const sfhaParts = fCov ? fCov.parts.filter((p) => (p.members ?? [p.key]).some((k) => parcelZones.find((z) => `${z.zone}|${z.subtype ?? ""}` === k)?.sfha)) : [];
  const sfhaParcel = parcelZones.some((z) => z.sfha);
  const sfha = sfhaParcel || !!fm?.sfha;
  const fUnmeasured = fCov ? parcelZones.filter((z) => !fRaw.some((p) => p.key === `${z.zone}|${z.subtype ?? ""}`)).map((z) => z.zone) : [];
  const fMore = fUnmeasured.length ? bi(` · ${fUnmeasured.map((z) => `${z} (area not measured)`).join(" · ")}`, ` · ${fUnmeasured.map((z) => `${z} (área no medida)`).join(" · ")}`) : bi("", "");
  const floodValue: Bi | null = fCov ? bi(`Zone ${coverageValue(fCov, floodKeyText).en}${fMore.en}`, `Zona ${coverageValue(fCov, floodKeyText).es}${fMore.es}`) : parcelZones.length ? bi(`Zone ${parcelZones.map((z) => z.zone).join(" · ")}`, `Zona ${parcelZones.map((z) => z.zone).join(" · ")}`) : fm ? bi(`Zone ${fm.zone}`, `Zona ${fm.zone}`) : null;
  const floodNotes: Bi[] = [...(fCov?.warnings ?? []), ...(fCov?.parts.some((p) => p.small) ? [SMALL_NOTE] : [])];
  if (fm && parcelZones.length && !fm.sfha && sfhaParcel) {
    const where = sfhaParts.length ? sfhaParts.map((p) => `${floodKeyText(p.key)} on ${p.share_text}`).join(", ") : parcelZones.filter((z) => z.sfha).map((z) => z.zone).join(", ");
    const whereEs = sfhaParts.length ? sfhaParts.map((p) => `${floodKeyText(p.key)} en ${p.share_text}`).join(", ") : parcelZones.filter((z) => z.sfha).map((z) => z.zone).join(", ");
    floodNotes.unshift(bi(`The pin is in Zone ${fm.zone}, and the parcel also has ${where} of its area in a Special Flood Hazard Area. Both are true: the pin is one point; part of the lot is in the high-risk area.`,
                          `El pin está en la Zona ${fm.zone} y la parcela también tiene ${whereEs} de su área en un Área Especial de Riesgo a Inundación. Ambas cosas son ciertas: el pin es un punto; parte del solar está en el área de alto riesgo.`));
  }
  // Same scope only: the pin layer vs the parcel geometry at the pin.
  const fCovPin = fCov?.parts.find((p) => p.contains_pin)?.key.split("|")[0] ?? null;
  if (fm && fCovPin && fCovPin !== fm.zone) {
    discrepancies.push(bi(`Flood zone at the pin differs between two FEMA answers: the point lookup says Zone ${fm.zone}, the parcel geometry puts the pin in Zone ${fCovPin}.`,
                          `La zona inundable en el pin difiere entre dos respuestas de FEMA: la consulta del punto indica Zona ${fm.zone}; la geometría de la parcela ubica el pin en la Zona ${fCovPin}.`));
  }
  add({
    id: "flood_zone",
    group: "flood",
    title: bi("FEMA flood zone (effective FIRM)", "Zona inundable FEMA (FIRM vigente)"),
    value: floodValue,
    detail: floodValue
      ? joinBi([
          ...(fCov ? coverageLines(fCov, floodZoneText) : []),
          sfha
            ? sfhaParcel
              ? bi(sfhaParts.length ? `A Special Flood Hazard Area is mapped on ${sfhaParts.map((p) => p.share_text).join(" + ")} of this parcel.` : "A Special Flood Hazard Area is mapped on part of this parcel.", sfhaParts.length ? `Hay un Área Especial de Riesgo a Inundación mapeada en ${sfhaParts.map((p) => p.share_text).join(" + ")} de esta parcela.` : "Hay un Área Especial de Riesgo a Inundación mapeada en parte de esta parcela.")
              : bi("A Special Flood Hazard Area is mapped at the pin.", "Hay un Área Especial de Riesgo a Inundación mapeada en el pin.")
            : bi("Minimal or moderate mapped flood hazard. This does not mean zero flood risk.", "Riesgo de inundación mapeado mínimo o moderado. No significa riesgo cero."),
        ])
      : fParcel?.status === "unavailable" ? bi(`Unable to verify across the parcel: ${reasonText(fParcel.reason).en}.`, `No se pudo verificar en la parcela: ${reasonText(fParcel.reason).es}.`) : null,
    state: parcelZones.length || fm ? "sourced" : fParcel ? (fParcel.status === "none_mapped" ? "none_mapped" : layerState(fz, current, layersLoading)) : layerState(fz, current, layersLoading),
    tone: floodValue ? (sfha ? "hazard" : "ok") : "unknown",
    scope: parcelZones.length ? (fParcel!.scope === "parcel" && parcelVerified ? "parcel" : "point") : "point",
    sources: [
      ...(fz ? [{ ...sourceOf(fz), dataset_date: fm?.effectiveDate ?? fz.source.dataset_date ?? null, version: fm?.firmPanel ? `FIRM panel ${fm.firmPanel}` : fz.source.version ?? null }] : []),
    ],
    looked_up_at: parcelZones.length ? parcel!.retrieved_at : at(fz),
    key: true,
    coverage: fCov,
    pin: parcelZones.length && fm && fParcel!.scope === "parcel" && parcelVerified ? { value: bi(`Zone ${fm.zone}`, `Zona ${fm.zone}`), source: fz ? fz.source.name : null } : null,
    notes: floodNotes,
  });
  const floodwayKnown = parcelZones.length > 0 || fm;
  const floodway = parcelZones.some((z) => z.floodway) || !!fm?.floodway;
  add({
    id: "floodway",
    group: "flood",
    title: bi("Regulatory floodway", "Cauce mayor (floodway)"),
    value: floodwayKnown ? (floodway ? bi("Mapped", "Mapeado") : bi("None mapped", "Nada mapeado")) : null,
    detail: floodway ? bi("A regulatory floodway is mapped on this site.", "Hay un cauce mayor reglamentario mapeado en este lugar.") : floodwayKnown ? NONE_MAPPED_NOTE : null,
    state: floodwayKnown ? (floodway ? "sourced" : "none_mapped") : layerState(fz, current, layersLoading),
    tone: floodway ? "hazard" : floodwayKnown ? "ok" : "unknown",
    scope: parcelZones.length ? (fParcel!.scope === "parcel" && parcelVerified ? "parcel" : "point") : "point",
    sources: fz ? [sourceOf(fz)] : [],
    looked_up_at: parcelZones.length ? parcel!.retrieved_at : at(fz),
    key: false,
  });
  const adv = layer("flood_advisory");
  add({
    id: "flood_advisory",
    group: "flood",
    title: bi("JP advisory flood map (not the effective FEMA map)", "Mapa de inundación de asesoramiento de la JP (no es el mapa vigente de FEMA)"),
    value: adv?.status === "resolved" && current ? bi(adv.name ?? adv.code ?? "") : adv?.status === "none" && current ? bi("None mapped at the pin", "Nada mapeado en el pin") : null,
    detail: layerState(adv, current, layersLoading) === "unavailable" && adv ? bi(`Unable to verify: ${reasonText(adv.reason).en}.`, `No se pudo verificar: ${reasonText(adv.reason).es}.`) : null,
    notes: [bi("Advisory (ABFE) map published separately from FEMA's effective FIRM; checked at the pin only.", "Mapa de asesoramiento (ABFE) publicado aparte del FIRM vigente de FEMA; verificado solo en el pin.")],
    state: layerState(adv, current, layersLoading),
    tone: adv?.status === "resolved" ? "attention" : adv?.status === "none" ? "ok" : "unknown",
    scope: "point",
    sources: adv ? [sourceOf(adv)] : [],
    looked_up_at: at(adv),
    key: false,
  });
  // FEMA vs JP advisory: compared at the same place — the pin.
  if (adv?.status === "resolved" && current && fm && !fm.sfha) {
    discrepancies.push(bi(`At the pin, the JP advisory map shows ${adv.code ?? "a flood area"} while the effective FEMA map shows Zone ${fm.zone}. The advisory map is not the effective FIRM; ask the reviewing agency which one it will apply.`,
                          `En el pin, el mapa de asesoramiento de la JP muestra ${adv.code ?? "un área inundable"} mientras el mapa vigente de FEMA muestra la Zona ${fm.zone}. El mapa de asesoramiento no es el FIRM vigente; pregunte a la agencia evaluadora cuál aplicará.`));
  }

  // ---- Environment & terrain -----------------------------------------------
  const env = (id: SiteLayerId, title: Bi, resolvedTone: ReportTone, valueOf: (r: SiteLayerResult) => Bi, noneText: Bi, keyFinding = false) => {
    const r = layer(id);
    const st = layerState(r, current, layersLoading);
    add({
      id, group: "environment", title,
      value: st === "sourced" ? valueOf(r!) : st === "none_mapped" ? noneText : null,
      detail: r?.approximate && st === "sourced" ? bi("Approximate — derived from a proxy dataset.", "Aproximado — derivado de un conjunto de datos sustituto.") : st === "none_mapped" ? NONE_MAPPED_NOTE : st === "unavailable" && r ? bi(`Unable to verify: ${reasonText(r.reason).en}.`, `No se pudo verificar: ${reasonText(r.reason).es}.`) : null,
      state: st,
      tone: st === "sourced" ? resolvedTone : st === "none_mapped" ? "ok" : "unknown",
      scope: "point",
      sources: r ? [sourceOf(r)] : [],
      looked_up_at: at(r),
      key: keyFinding,
    });
  };
  const terrain = layer("terrain");
  env("terrain", bi("Landslide susceptibility", "Susceptibilidad a deslizamientos"),
    terrain?.tags.includes("LANDSLIDE_HIGH") ? "hazard" : terrain?.tags.includes("LANDSLIDE_MODERATE") ? "attention" : "ok",
    (r) => bi(r.code ?? "", ({ Low: "Baja", Moderate: "Moderada", High: "Alta", "Very High": "Muy alta", "Extremely High": "Extremadamente alta" } as Record<string, string>)[r.code ?? ""] ?? r.code ?? ""),
    bi("None mapped", "Nada mapeado"), true);
  env("coastal_zone", bi("Coastal zone", "Zona costanera"), "attention", (r) => bi(r.approximate ? "Inside (approximate)" : "Inside the coastal zone", r.approximate ? "Dentro (aproximado)" : "Dentro de la zona costanera"), bi("Outside the mapped boundary", "Fuera del límite mapeado"), true);
  // Historic / protected: the whole-parcel MIPR / JP layers answer even when
  // the older point layers hang; the point layer is the fallback.
  const pointUsable = (id: SiteLayerId) => { const r = layer(id); return r && r.status !== "unknown"; };
  const presenceExtra = (e: ExtraFinding | undefined, id: string, title: Bi, tone: ReportTone) =>
    extraFinding(e, id, "environment", title, bi("Not checked for this parcel.", "No se verificó para esta parcela."), undefined, tone, false, e && e.scope === "parcel" && e.status !== "unable" ? { notes: [presenceNote] } : {});
  // Parcel check when it ran; else the pin layer (which reports its own outage); else "not checked".
  // A failed parcel-wide check falls back to the pin layer when that answered — labelled point-only.
  const fallbackNote = (e: ExtraFinding | undefined) => bi(`Parcel-wide check failed (${reasonText(e?.reason).en}); this result is from the selected point only.`, `La verificación de toda la parcela falló (${reasonText(e?.reason).es}); este resultado es solo del punto seleccionado.`);
  const pinFallback = (e: ExtraFinding | undefined, id: SiteLayerId) => e?.status === "unable" && pointUsable(id);
  if (pinFallback(ex.historic_zone, "historic_zone")) {
    env("historic_zone", bi("Historic zone", "Zona histórica"), "attention", (r) => bi(r.name ?? "Inside a historic zone", r.name ?? "Dentro de una zona histórica"), bi("None mapped at the pin", "Nada mapeado en el pin"));
    findings[findings.length - 1]!.notes = [fallbackNote(ex.historic_zone)];
  } else if (ex.historic_zone || (!layer("historic_zone") && !pointUsable("historic_zone"))) presenceExtra(ex.historic_zone, "historic_zone", bi("Historic zone", "Zona histórica"), "attention");
  else env("historic_zone", bi("Historic zone", "Zona histórica"), "attention", (r) => bi(r.name ?? "Inside a historic zone", r.name ?? "Dentro de una zona histórica"), bi("None mapped at the pin", "Nada mapeado en el pin"));
  presenceExtra(ex.historic_site, "historic_site", bi("Historic sites (JP)", "Sitios históricos (JP)"), "attention");
  presenceExtra(ex.archaeology, "archaeology", bi("Archaeological sensitivity", "Sensibilidad arqueológica"), "attention");
  if (pinFallback(ex.protected_area, "protected_area")) {
    env("protected_area", bi("Protected natural area", "Área natural protegida"), "hazard", (r) => bi(r.name ?? "Inside a protected area", r.name ?? "Dentro de un área protegida"), bi("None mapped at the pin", "Nada mapeado en el pin"));
    findings[findings.length - 1]!.notes = [fallbackNote(ex.protected_area)];
  } else if (ex.protected_area || (!layer("protected_area") && !pointUsable("protected_area"))) presenceExtra(ex.protected_area, "protected_area", bi("Protected natural area", "Área natural protegida"), "hazard");
  else env("protected_area", bi("Protected natural area", "Área natural protegida"), "hazard", (r) => bi(r.name ?? "Inside a protected area", r.name ?? "Dentro de un área protegida"), bi("None mapped at the pin", "Nada mapeado en el pin"));
  presenceExtra(ex.natural_reserve, "natural_reserve", bi("Natural reserve (JP)", "Reserva natural (JP)"), "hazard");
  presenceExtra(ex.wetlands, "wetlands", bi("Wetlands & waters (mapped)", "Humedales y cuerpos de agua (mapeados)"), "attention");
  // Soils: parcel-wide map units with shares; the pin answer kept separately.
  const so = ex.soils;
  const soCov = so?.coverage ? toReportCoverage(so.coverage, (k) => bi(`${k} — ${so.part_info?.[k]?.label ?? k}`)) : null;
  const soilAttrText = (a: Record<string, string | number | null> | undefined, l: "en" | "es") => {
    if (!a) return "";
    const parts = [
      a.drainage_class ? (l === "es" ? `drenaje: ${a.drainage_class}` : `${a.drainage_class}`) : null,
      a.flooding_frequency ? (l === "es" ? `frecuencia de inundación: ${a.flooding_frequency}` : `flooding: ${a.flooding_frequency}`) : null,
      a.hydric_percent !== null && a.hydric_percent !== undefined ? (l === "es" ? `componentes hídricos: ${a.hydric_percent}%` : `hydric components: ${a.hydric_percent}%`) : a.hydric_rating ? (l === "es" ? `hídrico: ${a.hydric_rating}` : `hydric: ${a.hydric_rating}`) : null,
    ].filter(Boolean);
    return parts.length ? ` · ${parts.join(" · ")}` : "";
  };
  if (soCov) for (const p of soCov.parts) {
    const a = so?.part_info?.[p.key]?.attributes;
    const en = soilAttrText(a, "en").replace(/^ · /, ""), es = soilAttrText(a, "es").replace(/^ · /, "");
    p.info = en ? bi(en, es) : null;
  }
  extraFinding(so, "soils", "environment", bi("Soils (USDA NRCS soil survey)", "Suelos (catastro de suelos USDA NRCS)"), bi("Not checked for this parcel.", "No se verificó para esta parcela."),
    (e) => soCov ? coverageValue(soCov) : bi(`${e.value}${soilAttrText(e.attributes, "en")}`, `${e.value}${soilAttrText(e.attributes, "es")}`), "info", false,
    so && so.status === "verified" ? {
      coverage: soCov,
      detail: soCov
        ? joinBi(soCov.parts.map((p) => bi(`${p.key} — ${p.label.en}: ${p.area_text} (${p.share_text})${p.contains_pin ? " · contains the pin" : ""}${soilAttrText(so.part_info?.[p.key]?.attributes, "en")}.${p.small ? " Small intersection." : ""}`,
                                              `${p.key} — ${p.label.es}: ${p.area_text} (${p.share_text})${p.contains_pin ? " · contiene el pin" : ""}${soilAttrText(so.part_info?.[p.key]?.attributes, "es")}.${p.small ? " Intersección pequeña." : ""}`)), " ")
        : bi(`Point lookup only — parcel-wide soil coverage not available (${so.parcel_limitation ?? "no parcel query"}).`, `Solo consulta del punto — no hay cobertura de suelos de toda la parcela (${so.parcel_limitation ?? "sin consulta de parcela"}).`),
      pin: soCov && so.pin?.status === "verified" ? { value: bi(so.pin.value ?? ""), source: so.source.name } : null,
      sources: [{ name: so.source.name, url: so.source.url, dataset_date: so.source.dataset_date, version: (so.attributes.survey_area ?? so.pin?.attributes.survey_area) ? `survey area ${so.attributes.survey_area ?? so.pin?.attributes.survey_area}${so.source.dataset_date ? " (survey version date shown as data date)" : ""}` : so.source.layer }],
      notes: [...(soCov?.warnings ?? []), ...(soCov?.parts.some((p) => p.small) ? [SMALL_NOTE] : []), ...(!soCov ? [bi("Point lookup only: the soil at the pin may not represent the whole parcel.", "Solo consulta del punto: el suelo en el pin puede no representar toda la parcela.")] : [])],
    } : {});

  // ---- Property -----------------------------------------------------------
  const addr = siteAddressParts(site);
  const crim = layer("parcel");
  const boundary = parcel?.boundary;
  const catastroValue = boundary?.value?.catastro ?? (crim?.status === "resolved" && current ? crim.code : null);
  const catSource: ReportSource | null = boundary?.value ? { name: boundary.source.name, url: boundary.source.url, dataset_date: boundary.source.dataset_date, version: null } : crim ? sourceOf(crim) : null;
  const sp = toPrStatePlane(site.latitude, site.longitude);
  const areaM2 = boundary?.value ? fmtArea(boundary.value.area_m2) : null;
  const areaReason: Bi = input.parcelLoading ? bi("still checking the parcel boundary", "aún verificando el límite de la parcela")
    : !input.parcel ? bi("parcel boundary not looked up", "no se consultó el límite de la parcela")
    : !parcel ? bi("the parcel lookup is for another point", "la consulta de la parcela es de otro punto")
    : boundary?.status === "unavailable" ? reasonText(boundary.reason)
    : bi("no CRIM parcel boundary at the pin", "no hay límite de parcela del CRIM en el pin");
  const area: NonNullable<PropertyReport["property"]["area"]> = areaM2
    ? { m2: areaM2, cuerdas: Math.round((areaM2 / CUERDA_M2) * 100) / 100, text: bi(`${Math.round(areaM2).toLocaleString("en-US")} m² (${(areaM2 / CUERDA_M2).toFixed(2)} cuerdas)`, `${Math.round(areaM2).toLocaleString("en-US")} m² (${(areaM2 / CUERDA_M2).toFixed(2)} cuerdas)`), note: bi("From the mapped CRIM boundary (planar, EPSG:32161) — not a survey.", "Del límite mapeado del CRIM (planar, EPSG:32161) — no es una mensura.") }
    : { m2: null, cuerdas: null, text: bi("Not available", "No disponible"), note: areaReason };

  // ---- Next steps -----------------------------------------------------------
  const activityText = [lu?.activity.raw?.trim() || context.activity, context.businessType].filter(Boolean).join(" — ");
  const activity = activityText
    ? bi(`Findings below are read for the activity you described: ${activityText}.`, `Los hallazgos se leen para la actividad que describió: ${activityText}.`)
    : bi("Describe what you plan to do in \"What do you want to do with this property?\" and press Evaluate; SmartPR reads the findings against that activity.", "Describa lo que planifica en «¿Qué quieres hacer con esta propiedad?» y pulse Evaluar; SmartPR lee los hallazgos según esa actividad.");
  const missing: Bi[] = [];
  if (site.coordinate_source === "GEOCODED_ADDRESS") missing.push(bi("The pin comes from the address search — move it onto the exact property if needed.", "El pin viene de la búsqueda de dirección — muévalo a la propiedad exacta si hace falta."));
  if (site.near_boundary) missing.push(bi("The pin is near a municipal boundary — confirm it is inside the right municipio.", "El pin está cerca de un límite municipal — confirme que está en el municipio correcto."));
  if (!boundary?.value) missing.push(bi("Parcel boundary not determined — findings are for the pin, not the whole lot.", "No se determinó el límite de la parcela — los hallazgos son del pin, no de todo el solar."));
  if (!activityText) missing.push(bi("The proposed activity has not been described yet, so nothing has been evaluated against it.", "Aún no se ha descrito la actividad propuesta, así que nada se ha evaluado según ella."));
  const unresolved: Bi[] = findings
    .filter((f) => f.state !== "sourced" && f.state !== "none_mapped" && f.state !== "not_evaluated")
    .map((f) => {
      const why = f.state === "unavailable" && f.detail && /^Unable to verify/.test(f.detail.en) ? f.detail : null;
      return bi(`${f.title.en}: ${STATE_TEXT[f.state].en}${why ? ` (${why.en.replace(/^Unable to verify[^:]*:\s*/, "").replace(/\.$/, "")})` : ""}`, `${f.title.es}: ${STATE_TEXT[f.state].es}${why ? ` (${why.es.replace(/^No se pudo verificar[^:]*:\s*/, "").replace(/\.$/, "")})` : ""}`);
    });

  // ---- Plain language (deterministic wording for official values) --------
  const FAMILY_TEXT: Record<string, Bi> = {
    conservation: bi("conservation land", "terreno de conservación"),
    residential: bi("residential", "residencial"),
    commercial: bi("commercial", "comercial"),
    industrial: bi("industrial", "industrial"),
    agricultural: bi("agricultural", "agrícola"),
    rural: bi("rural", "rural"),
    tourism: bi("tourism", "turístico"),
    public: bi("public / institutional", "público / institucional"),
    road: bi("road right-of-way", "servidumbre vial"),
  };
  const zf = findings.find((f) => f.id === "zoning");
  if (zf && zf.state === "sourced") {
    // The plain line and pill describe the principal districts; small
    // intersections stay listed in the value and detail (never dropped).
    const smallCodes = new Set(zCov?.parts.filter((p) => p.small).map((p) => p.key) ?? []);
    const ds = zParcel?.status === "sourced" ? zParcel.districts.filter((d) => !smallCodes.has(d.code)) : zPoint ? [{ code: zPoint.code ?? "", name: zPoint.name, family: zPoint.tags[0] ?? null }] : [];
    const fams = [...new Set(ds.map((d) => d.family).filter((x): x is string => !!x && !!FAMILY_TEXT[x]))];
    const named = ds.map((d) => `${d.code}${d.name ? ` (${d.name})` : ""}`).join(", ");
    const famText = (l: "en" | "es") => fams.map((f) => FAMILY_TEXT[f]![l]).join(l === "es" ? " y " : " and ");
    const roadOnly = ds.length > 1 && ds.some((d) => d.family === "road");
    const smallTxt = smallCodes.size ? bi(` Small intersection${smallCodes.size > 1 ? "s" : ""} with ${[...smallCodes].join(", ")} also mapped.`, ` También se mapea${smallCodes.size > 1 ? "n" : ""} intersección${smallCodes.size > 1 ? "es" : ""} pequeña${smallCodes.size > 1 ? "s" : ""} con ${[...smallCodes].join(", ")}.`) : bi("", "");
    zf.plain = bi(
      `${fams.length ? `Zoned ${famText("en")}` : "Zoning district mapped"}: ${named}.${roadOnly ? " The road district usually covers only the edge of the lot along the street." : ""}${fams.includes("conservation") ? " Conservation districts restrict development." : ""}${smallTxt.en}`,
      `${fams.length ? `Calificación ${famText("es")}` : "Distrito de calificación mapeado"}: ${named}.${roadOnly ? " El distrito vial suele cubrir solo el borde del solar junto a la calle." : ""}${fams.includes("conservation") ? " Los distritos de conservación restringen el desarrollo." : ""}${smallTxt.es}`
    );
    const main = fams.filter((f) => f !== "road");
    zf.pill = main.length ? bi(main.map((f) => FAMILY_TEXT[f]!.en).join(" + ").replace(/^./, (c) => c.toUpperCase()), main.map((f) => FAMILY_TEXT[f]!.es).join(" + ").replace(/^./, (c) => c.toUpperCase())) : bi(`Zoning ${ds.map((d) => d.code).join(", ")}`, `Calificación ${ds.map((d) => d.code).join(", ")}`);
  }
  if (zf && zf.state === "sourced" && roadway) {
    zf.plain = bi(`Mapped as a roadway (${zPin?.code ?? "VIAL"}${zPin?.name ? ` — ${zPin.name}` : ""}) at the selected point. This is not a developable zoning district, and no permitted uses are inferred from it.`, `Mapeado como vía (${zPin?.code ?? "VIAL"}${zPin?.name ? ` — ${zPin.name}` : ""}) en el punto seleccionado. No es un distrito de calificación desarrollable y no se infieren usos permitidos de él.`);
    zf.pill = bi("Roadway at the pin (VIAL)", "Vía en el pin (VIAL)");
    zf.tone = "attention";
  }
  const ff = findings.find((f) => f.id === "flood_zone");
  if (ff && ff.state === "sourced") {
    const zones = parcelZones.length ? parcelZones.map((z) => ({ zone: z.zone, sub: z.subtype ?? "" })) : fm ? [{ zone: fm.zone, sub: "" }] : [];
    const worst = (z: { zone: string; sub: string }) => /^V/.test(z.zone) ? 3 : /^A/.test(z.zone) ? 2 : /0\.2/.test(z.sub) ? 1 : /^D/.test(z.zone) ? 1 : 0;
    const top = [...zones].sort((a, b) => worst(b) - worst(a))[0];
    if (top) {
      const lvl = worst(top);
      const partial = parcelZones.length > 1 && lvl >= 2;
      const onPart = partial ? bi(" on part of the parcel", " en parte de la parcela") : bi("", "");
      const [en, es, pe, ps] =
        /^V/.test(top.zone) ? [`High-risk coastal flood area with wave action (FEMA Zone ${top.zone})${onPart.en}.`, `Área costera de alto riesgo de inundación con oleaje (Zona ${top.zone} de FEMA)${onPart.es}.`, `High coastal flood risk${onPart.en}`, `Alto riesgo de inundación costera${onPart.es}`]
        : /^A/.test(top.zone) ? [`High flood risk: inside FEMA's 1%-annual-chance flood area (Zone ${top.zone})${onPart.en}.`, `Alto riesgo de inundación: dentro del área de 1% de probabilidad anual de FEMA (Zona ${top.zone})${onPart.es}.`, `High flood risk${onPart.en}`, `Alto riesgo de inundación${onPart.es}`]
        : /^D/.test(top.zone) ? [`Flood risk not determined by FEMA (Zone D).`, `Riesgo de inundación no determinado por FEMA (Zona D).`, "Flood risk undetermined", "Riesgo de inundación indeterminado"]
        : lvl === 1 ? [`Moderate flood risk: FEMA's 0.2%-annual-chance area (shaded Zone X).`, `Riesgo moderado de inundación: área de 0.2% de probabilidad anual de FEMA (Zona X sombreada).`, "Moderate flood risk", "Riesgo moderado de inundación"]
        : (() => {
            const sub = (parcelZones.find((z) => z.zone === top.zone)?.subtype ?? (typeof fz?.attributes.ZONE_SUBTY === "string" ? fz.attributes.ZONE_SUBTY : "")) || "";
            const small = new Set(["of", "to", "due", "with", "the", "and", "in", "or"]);
            const desc = sub ? sub.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ") : null;
            return [desc ? `FEMA Zone ${top.zone} — ${desc} (FEMA NFHL zone subtype). Outside FEMA's mapped 1%-annual-chance flood areas; this does not mean no flood risk.` : `FEMA Zone ${top.zone}. FEMA returned no zone description. Outside FEMA's mapped 1%-annual-chance flood areas; this does not mean no flood risk.`,
                    desc ? `Zona ${top.zone} de FEMA — ${desc} (subtipo de zona del NFHL de FEMA). Fuera de las áreas de 1% de probabilidad anual mapeadas por FEMA; no significa ausencia de riesgo.` : `Zona ${top.zone} de FEMA. FEMA no devolvió descripción de la zona. Fuera de las áreas de 1% de probabilidad anual mapeadas por FEMA; no significa ausencia de riesgo.`,
                    `FEMA Zone ${top.zone}`, `Zona ${top.zone} de FEMA`];
          })();
      ff.plain = bi(en, es);
      ff.pill = /^(A|V)/.test(top.zone) ? bi(`FEMA Zone ${top.zone} — ${pe}`, `Zona ${top.zone} de FEMA — ${ps}`) : bi(pe, ps);
    }
  }
  const tf = findings.find((f) => f.id === "terrain");
  if (tf && tf.state === "sourced" && tf.value) {
    tf.plain = bi(`${tf.value.en} landslide susceptibility at the pin (USGS).${tf.tone === "hazard" || tf.tone === "attention" ? " This can matter for earthwork, foundations and access." : ""}`, `Susceptibilidad ${tf.value.es.toLowerCase()} a deslizamientos en el pin (USGS).${tf.tone === "hazard" || tf.tone === "attention" ? " Puede importar para movimientos de tierra, cimientos y accesos." : ""}`);
    tf.pill = bi(`${tf.value.en} landslide risk`, `Riesgo ${tf.value.es.toLowerCase()} de deslizamiento`);
  }
  const cf = findings.find((f) => f.id === "coastal_zone");
  if (cf && cf.state === "sourced") { cf.plain = bi("Inside the mapped coastal zone.", "Dentro de la zona costanera mapeada."); cf.pill = bi("Coastal zone", "Zona costanera"); }
  else if (cf && cf.state === "none_mapped") { cf.plain = bi("Outside the mapped coastal-zone boundary.", "Fuera del límite mapeado de la zona costanera."); cf.pill = bi("Outside mapped coastal zone", "Fuera de la zona costanera mapeada"); }
  const lf = findings.find((f) => f.id === "land_class");
  if (lf && lf.state === "sourced" && lc) {
    const fam = lc.tags[0];
    lf.plain = fam === "SREP" ? bi("Specially protected rustic land — development is heavily restricted.", "Suelo rústico especialmente protegido — el desarrollo está muy restringido.")
      : fam === "SRC" ? bi("Common rustic (rural) land.", "Suelo rústico común.")
      : fam === "SU" ? bi("Urban land.", "Suelo urbano.")
      : null;
    lf.pill = fam === "SREP" ? bi("Protected rustic land", "Suelo rústico protegido") : null;
  }
  const af = findings.find((f) => f.id === "flood_advisory");
  if (af && af.state === "sourced") { af.plain = bi("JP's advisory map shows a flood area at the pin. It is separate from FEMA's effective map — ask the reviewing agency which applies.", "El mapa de asesoramiento de la JP muestra un área inundable en el pin. Es distinto del mapa vigente de FEMA — pregunte a la agencia cuál aplica."); af.pill = bi("Advisory flood area", "Área inundable (asesoría)"); }
  for (const id of ["historic_zone", "protected_area"]) {
    const f = findings.find((x) => x.id === id);
    if (f?.state === "sourced") f.pill = f.title;
  }

  // ---- Constraint classes (deterministic, from official findings) --------
  const fid = (id: string) => findings.find((f) => f.id === id);
  const zParcelDistricts = parcel?.zoning.status === "sourced" ? parcel.zoning.districts : [];
  const conservationDistricts = zParcelDistricts.filter((d) => d.family === "conservation");
  const pointConservation = zPoint?.status === "resolved" && current && zPoint.tags.includes("conservation");
  const protectedLand = lc?.status === "resolved" && current && lc.tags.includes("SREP");
  const classify = (id: string, c: ConstraintClass) => { const f = fid(id); if (f && f.state === "sourced") f.constraint = c; };
  if (conservationDistricts.length || pointConservation) classify("zoning", "protection");
  { const zf2 = fid("zoning"); if (zf2 && (conservationDistricts.length || pointConservation)) zf2.meta = { conservation: conservationDistricts.length ? conservationDistricts.map((d) => d.code) : [zPoint!.code ?? ""] }; }
  if (protectedLand) classify("land_class", "protection");
  // Protection designations read red everywhere (preview pills, drawer, PDF).
  for (const f of findings) if (f.constraint === "protection") f.tone = "hazard";
  if (floodway) classify("floodway", "protection");
  classify("protected_area", "protection");
  if (sfha) classify("flood_zone", "documentation");
  classify("coastal_zone", "documentation");
  classify("historic_zone", "documentation");
  if (layer("terrain")?.tags.includes("LANDSLIDE_HIGH")) classify("terrain", "documentation");

  // Steps: mapped constraints (what the maps show — prescribes nothing) and
  // preparation. Project-specific requirements (permits, studies, certificates)
  // come only from land_use: a described activity + a verified rule.
  const steps: ReportStep[] = [];
  const step = (s: Omit<ReportStep, "basis">) => steps.push({ ...s, basis: "rule" });
  const PROTECTION_NOTE = bi(
    "This is a protection designation. It restricts what may be done on the affected land, and additional documents do not remove it. Any change to a designation is decided by the responsible agency through its own process, and no outcome is assured.",
    "Esta es una designación de protección. Restringe lo que puede hacerse en el terreno afectado y documentos adicionales no la eliminan. Cualquier cambio a una designación lo decide la agencia responsable mediante su propio proceso, sin resultado asegurado."
  );
  const DEPENDS = lu?.activity.use
    ? bi("What it requires for the described activity is listed under approvals, only where a verified rule applies.", "Lo que exige para la actividad descrita se lista en aprobaciones, solo donde aplica una regla verificada.")
    : bi("Whether any review, study or permit applies depends on the proposed work; describe the activity to evaluate it against verified rules.", "Si aplica alguna revisión, estudio o permiso depende de la obra propuesta; describa la actividad para evaluarla según reglas verificadas.");
  const zoningF = fid("zoning")!;
  if (conservationDistricts.length || pointConservation) {
    const names = conservationDistricts.length ? conservationDistricts.map((d) => `${d.code}${d.name ? ` (${d.name})` : ""}${d.share != null ? ` — ${pctText(d.share)} of the parcel` : ""}`).join(", ") : `${zPoint!.code}`;
    step({
      id: "protection_zoning", kind: "mapped_constraint",
      text: bi(`Part of this parcel is in a conservation district (${names}). Treat the affected area as restricted; confirm with the Junta de Planificación which uses, if any, it allows before planning work there.`,
               `Parte de esta parcela está en un distrito de conservación (${names}). Trate el área afectada como restringida; confirme con la Junta de Planificación qué usos permite, si alguno, antes de planificar obras allí.`),
      because: PROTECTION_NOTE,
      sources: [RC_2023, ...zoningF.sources],
      constraint: "protection",
    });
  }
  if (protectedLand) {
    step({
      id: "protection_land_class", kind: "mapped_constraint",
      text: bi("The pin is on land classified as Specially Protected Rustic Land (SREP). Development there is restricted by the classification itself.", "El pin está en Suelo Rústico Especialmente Protegido (SREP). El desarrollo allí está restringido por la propia clasificación."),
      because: PROTECTION_NOTE, sources: fid("land_class")!.sources, constraint: "protection",
    });
  }
  if (fid("protected_area")?.state === "sourced") {
    step({
      id: "protection_area", kind: "mapped_constraint",
      text: bi("A protected natural area is mapped on this parcel. Activities there are governed by the designation and its managing agency (DRNA).", "Hay un área natural protegida mapeada en esta parcela. Las actividades allí se rigen por la designación y su agencia administradora (DRNA)."),
      because: PROTECTION_NOTE, sources: fid("protected_area")!.sources, constraint: "protection",
    });
  }
  if (floodway) {
    step({
      id: "protection_floodway", kind: "mapped_constraint",
      text: bi("A regulatory floodway is mapped on this site. Encroachments in a floodway are prohibited unless an engineering analysis shows no rise in flood levels.", "Hay un cauce mayor reglamentario mapeado en este lugar. Las intrusiones en un cauce mayor están prohibidas salvo que un análisis de ingeniería demuestre que no aumentan los niveles de inundación."),
      because: PROTECTION_NOTE, sources: [RP_13, ...(fid("floodway")?.sources ?? [])], constraint: "protection",
    });
  }
  if (sfha && !floodway) {
    const share = sfhaParts.length ? sfhaParts.map((p) => p.share_text).join(" + ") : null;
    step({
      id: "flood_mapped", kind: "mapped_constraint",
      text: bi(`A FEMA Special Flood Hazard Area is mapped ${share ? `on ${share} of this parcel` : sfhaParcel ? "on part of this parcel" : "at the pin"}. ${DEPENDS.en}`, `Hay un Área Especial de Riesgo a Inundación de FEMA mapeada ${share ? `en ${share} de esta parcela` : sfhaParcel ? "en parte de esta parcela" : "en el pin"}. ${DEPENDS.es}`),
      because: bi("Effective FEMA flood map.", "Mapa de inundación vigente de FEMA."),
      sources: fid("flood_zone")?.sources ?? [],
      constraint: "documentation",
    });
  }
  if (fid("coastal_zone")?.state === "sourced") {
    step({
      id: "coastal_mapped", kind: "mapped_constraint",
      text: bi(`The site is inside the mapped coastal zone. ${DEPENDS.en}`, `El lugar está dentro de la zona costanera mapeada. ${DEPENDS.es}`),
      because: bi("Mapped coastal-zone boundary.", "Límite mapeado de la zona costanera."),
      sources: [...(fid("coastal_zone")?.sources ?? []), PMZC],
      constraint: "documentation",
    });
  }
  if (fid("historic_zone")?.state === "sourced") {
    step({
      id: "historic_mapped", kind: "mapped_constraint",
      text: bi(`A historic zone is mapped on this site. ${DEPENDS.en}`, `Hay una zona histórica mapeada en este lugar. ${DEPENDS.es}`),
      because: bi("Mapped historic zone.", "Zona histórica mapeada."),
      sources: fid("historic_zone")!.sources,
      constraint: "documentation",
    });
  }
  if (fid("terrain")?.constraint === "documentation") {
    step({
      id: "landslide_mapped", kind: "mapped_constraint",
      text: bi(`High landslide susceptibility is mapped at the pin. ${DEPENDS.en}`, `Hay alta susceptibilidad a deslizamientos mapeada en el pin. ${DEPENDS.es}`),
      because: bi("USGS landslide susceptibility at the pin.", "Susceptibilidad a deslizamientos del USGS en el pin."),
      sources: fid("terrain")!.sources,
      constraint: "documentation",
    });
  }
  if (zoningF.state === "sourced") {
    if (!lu?.activity.use) {
      step({
        id: "describe_activity", kind: "preparation",
        text: bi("Describe the proposed activity to check it against the use rules of the mapped district(s).", "Describa la actividad propuesta para verificarla con las reglas de uso del distrito o distritos mapeados."),
        because: bi("Permitted uses depend on the district and on what you plan to do.", "Los usos permitidos dependen del distrito y de lo que planifica hacer."),
        sources: [RC_2023],
        constraint: "information",
      });
    }
  } else {
    step({
      id: "resolve_zoning", kind: "preparation",
      text: bi("Obtain the site's calificación from the Junta de Planificación before relying on any use determination.", "Obtenga la calificación del lugar de la Junta de Planificación antes de depender de cualquier determinación de uso."),
      because: bi("Zoning could not be determined from the official map.", "No se pudo determinar la calificación del mapa oficial."),
      sources: [RC_2023],
      constraint: "information",
    });
  }
  missing.push(...discrepancies);

  // ---- Evidence-based scope + retrieval status (never "parcel" without parcel geometry) ----
  for (const f of findings) {
    const answeredF = f.state === "sourced" || f.state === "none_mapped" || (f.state === "review" && f.id === "permitted_uses");
    f.retrieval = f.state === "sourced" || f.state === "none_mapped" || f.state === "review" ? "answered" : f.state === "unavailable" || f.state === "stale" ? "no_response" : f.state === "loading" ? "pending" : "not_performed";
    if (f.scope === "parcel" && !parcelVerified) f.scope = "point";
    if (!answeredF && f.scope !== "not_evaluated") { f.attempted_scope = f.scope; f.scope = "not_evaluated"; }
  }

  // ---- Lead summary ------------------------------------------------------------
  const scopeWord = (f: ReportFinding): Bi => f.scope === "parcel" ? bi("across the verified parcel", "en toda la parcela verificada") : f.scope === "point" ? bi("at the selected point only", "solo en el punto seleccionado") : f.scope === "municipality" ? bi("municipality-wide", "en todo el municipio") : bi("not evaluated", "no evaluado");
  const mapped: Bi[] = [];
  if (area.m2) mapped.push(bi(`Parcel ${catastroValue ?? ""}: ${area.text.en}, from the mapped CRIM boundary (not a survey).`.replace("Parcel :", "Parcel:"), `Parcela ${catastroValue ?? ""}: ${area.text.es}, del límite mapeado del CRIM (no es una mensura).`.replace("Parcela :", "Parcela:")));
  for (const f of findings) {
    if (f.state !== "sourced" || f.basis !== "official" || !f.value) continue;
    mapped.push(bi(`${f.title.en}: ${f.value.en} (${scopeWord(f).en}${f.pin ? `; at the pin: ${f.pin.value.en}` : ""}).`, `${f.title.es}: ${f.value.es} (${scopeWord(f).es}${f.pin ? `; en el pin: ${f.pin.value.es}` : ""}).`));
  }
  const noneMapped = findings.filter((f) => f.state === "none_mapped");
  if (noneMapped.length) mapped.push(bi(`None mapped in: ${noneMapped.map((f) => f.title.en).join(", ")}. That is not the same as no constraint on the ground.`, `Nada mapeado en: ${noneMapped.map((f) => f.title.es).join(", ")}. Eso no equivale a que no haya restricciones en el terreno.`));
  const mayAffect: Bi[] = [];
  if (lu?.activity.use) {
    const dec = lu.decision;
    if (dec) mayAffect.push(bi(`${dec.use.en} (${dec.scope.en}): ${dec.compatibility.label.en}. ${dec.compatibility.reason.en}`, `${dec.use.es} (${dec.scope.es}): ${dec.compatibility.label.es}. ${dec.compatibility.reason.es}`));
    else mayAffect.push(bi(`${lu.activity.useName}: ${COMPATIBILITY_TEXT[lu.compatibility.outcome].en} (confidence ${lu.compatibility.confidence}).`, `${lu.activity.useName}: ${COMPATIBILITY_TEXT[lu.compatibility.outcome].es} (confianza ${lu.compatibility.confidence}).`));
    for (const a of lu.approvals) { const rq = a.requirement ?? (a.status === "confirmed" ? "required" : a.status === "likely" ? "potentially_required" : "unresolved"); mayAffect.push(bi(`${a.name} — ${REQUIREMENT_TEXT[rq].en}: ${a.needs ? `depends on ${a.needs.en}` : a.trigger}${a.citation ? ` (${a.citation})` : ""}.`, `${a.name} — ${REQUIREMENT_TEXT[rq].es}: ${a.needs ? `depende de ${a.needs.es}` : a.trigger}${a.citation ? ` (${a.citation})` : ""}.`)); }
    if (dec) mayAffect.push(dec.pathway.completeness);
    for (const s of steps.filter((x) => x.constraint === "protection")) mayAffect.push(s.text);
  } else {
    mayAffect.push(bi("Not evaluated — describe the proposed activity. Mapped constraints are listed above; whether they affect your project depends on what you plan to do.", "No evaluado — describe la actividad propuesta. Las restricciones mapeadas se listan arriba; si afectan tu proyecto depende de lo que planificas hacer."));
  }
  const unverified: Bi[] = [...unresolved];
  for (const f of findings) {
    for (const a of f.ambiguities ?? []) unverified.push(bi(`${f.title.en}: ${a.en}`, `${f.title.es}: ${a.es}`));
    for (const w of f.coverage?.warnings ?? []) unverified.push(bi(`${f.title.en}: ${w.en}`, `${f.title.es}: ${w.es}`));
    const small = f.coverage?.parts.filter((p) => p.small) ?? [];
    if (small.length) unverified.push(bi(`${f.title.en}: small intersection${small.length > 1 ? "s" : ""} with ${small.map((p) => `${p.key.split("|")[0]} (${p.area_text}, ${p.share_text})`).join(", ")} — real strip or edge-alignment difference is not determinable from the maps.`, `${f.title.es}: intersección${small.length > 1 ? "es" : ""} pequeña${small.length > 1 ? "s" : ""} con ${small.map((p) => `${p.key.split("|")[0]} (${p.area_text}, ${p.share_text})`).join(", ")} — no se puede determinar con los mapas si es una franja real o una diferencia de bordes.`));
  }
  unverified.push(...discrepancies);
  if (lu?.activity.use) for (const u of lu.unresolved) unverified.push(bi(u.text));
  if (lu?.activity.use && lu.decision) for (const gp of lu.decision.unresolved) unverified.push(bi(`${gp.label.en}: ${gp.missing.en} Blocks: ${gp.blocks.en}`, `${gp.label.es}: ${gp.missing.es} Bloquea: ${gp.blocks.es}`));
  const next: Bi[] = [];
  if (lu?.activity.use && lu.decision) next.push(bi(`Next action: ${lu.decision.pathway.nextAction.en}`, `Próxima acción: ${lu.decision.pathway.nextAction.es}`));
  if (!activityText) next.push(bi("Describe the proposed activity (what you will build or operate, size, and whether there is construction).", "Describa la actividad propuesta (qué construirá u operará, tamaño y si hay construcción)."));
  next.push(...missing.filter((m) => !discrepancies.includes(m) && !/proposed activity has not been described/.test(m.en)));
  if (findings.some((f) => f.state === "unavailable" || f.state === "stale")) next.push(bi("Run the lookup again later for the sources that did not answer; until then those items are unknown, not clear.", "Vuelva a consultar más tarde las fuentes que no respondieron; hasta entonces esos puntos son desconocidos, no despejados."));
  if (findings.some((f) => f.coverage?.parts.some((p) => p.small))) next.push(bi("If a small intersection matters for your plans, confirm it with a licensed surveyor.", "Si una intersección pequeña importa para sus planes, confírmela con un agrimensor licenciado."));
  if (discrepancies.length) next.push(bi("Ask the responsible agency about the discrepancies listed above.", "Consulte a la agencia responsable sobre las discrepancias listadas arriba."));
  if (findings.some((f) => f.ambiguities?.length)) next.push(bi("Confirm the ambiguous official records listed above with the Junta de Planificación.", "Confirme con la Junta de Planificación los registros oficiales ambiguos listados arriba."));

  // ---- Location notices -------------------------------------------------------
  const locationNotices: Bi[] = [];
  if (parcelStatus === "not_identified") locationNotices.push(bi("No cadastral parcel was identified. Findings describe the selected point only; parcel-wide checks have not been performed.", "No se identificó una parcela catastral. Los hallazgos describen solo el punto seleccionado; no se han realizado verificaciones de toda la parcela."));
  if (parcelStatus === "unavailable") locationNotices.push(bi(`The CRIM parcel source did not respond (${reasonText(boundary?.reason).en}). Findings describe the selected point only; parcel-wide checks have not been performed.`, `La fuente de parcelas del CRIM no respondió (${reasonText(boundary?.reason).es}). Los hallazgos describen solo el punto seleccionado; no se han realizado verificaciones de toda la parcela.`));
  if (roadway) locationNotices.push(bi("This point may be on a roadway rather than your intended property. Move or confirm the pin before evaluating site-specific requirements.", "Este punto puede estar sobre una vía y no en su propiedad. Mueva o confirme el pin antes de evaluar requisitos específicos del lugar."));
  if (pointConfirmed && !parcelVerified) locationNotices.push(bi("You confirmed this point as your property. That confirms the location you intend, not a parcel boundary: parcel-wide checks remain not performed.", "Usted confirmó este punto como su propiedad. Eso confirma la ubicación que indica, no un límite de parcela: las verificaciones de toda la parcela siguen sin realizarse."));

  const all = [...findings.flatMap((f) => f.sources), ...steps.flatMap((s) => s.sources), ...(catSource ? [catSource] : [])];
  const normed = all.map((s) => ({ ...s, dataset_date: normalizeDatasetDate(s.dataset_date) }));
  const sources = normed.filter((s, i) => normed.findIndex((o) => o.name === s.name && o.dataset_date === s.dataset_date) === i && !(s.dataset_date === null && normed.some((o) => o.name === s.name && o.dataset_date)));

  const fingerprint = hash(JSON.stringify([
    REPORT_SCHEMA, site.latitude.toFixed(7), site.longitude.toFixed(7), current ? site.layers!.resolved_at : null, parcel?.retrieved_at ?? null,
    context, findings.map((f) => [f.id, f.state, f.value?.en]),
  ]));

  const report: PropertyReport = {
    schema: REPORT_SCHEMA,
    fingerprint,
    location_revision: input.revision,
    generated_at: now,
    property: {
      title: [addr.primary.split(",")[0], site.municipality.name].filter((v, i, a) => v && a.indexOf(v) === i).reverse().join(" · "),
      address: { primary: addr.primary, secondary: addr.secondary, formatted: site.formatted_address },
      municipality: site.municipality.name,
      barrio: site.barrio?.name ?? null,
      latitude: site.latitude,
      longitude: site.longitude,
      coordinate_source: site.coordinate_source,
      precision: boundary?.value ? "parcel" : site.coordinate_source === "GEOCODED_ADDRESS" ? "address" : "point",
      near_boundary: site.near_boundary,
      catastro: {
        value: catastroValue, state: catastroValue ? "sourced" : parcelState(boundary?.status), source: catSource,
        text: catastroValue
          ? bi(parcelVerified ? catastroValue : `${catastroValue} (parcel id at the point; no parcel boundary identified)`, parcelVerified ? catastroValue : `${catastroValue} (id de parcela en el punto; sin límite de parcela identificado)`)
          : parcelStatus === "not_identified" ? bi("No cadastral parcel identified at the selected point", "No se identificó parcela catastral en el punto seleccionado")
          : parcelStatus === "unavailable" ? bi(`Not available — the CRIM parcel source did not respond (${reasonText(boundary?.reason).en})`, `No disponible — la fuente de parcelas del CRIM no respondió (${reasonText(boundary?.reason).es})`)
          : parcelStatus === "loading" ? bi("Checking…", "Verificando…")
          : bi("Not looked up", "No consultado"),
      },
      location: { parcel: parcelStatus, roadway, point_confirmed: pointConfirmed, preliminary: !parcelVerified, notices: locationNotices },
      boundary: {
        state: parcelState(boundary?.status),
        geometry: boundary?.value?.geometry ?? null,
        area_m2: areaM2,
        source: boundary ? { name: boundary.source.name, url: boundary.source.url, dataset_date: boundary.source.dataset_date, version: null } : null,
      },
      area,
      map: parcelVerified ? {
        neighbors: (parcel?.neighbors ?? []).map((n) => ({ catastro: n.catastro, geometry: n.geometry })),
        partials: (parcel?.partials ?? []).map((pp, i) => {
          const isFlood = pp.layer === "flood";
          const sfhaPart = isFlood && /^(A|V)/.test(pp.key);
          const label = pp.layer === "zoning" ? bi(`Zoning ${pp.key}${districtName(pp.key) ? ` — ${districtName(pp.key)}` : ""}`, `Calificación ${pp.key}${districtName(pp.key) ? ` — ${districtName(pp.key)}` : ""}`)
            : isFlood ? bi(`FEMA ${floodZoneText(pp.key, "en")}`, `FEMA ${floodZoneText(pp.key, "es")}`)
            : bi(`PUT ${pp.key}`);
          return { id: `${pp.layer}-${i}`, layer: pp.layer, label, share_text: formatShare(pp.share, true), tone: (sfhaPart ? "hazard" : (zParcel?.districts.find((d) => d.code === pp.key)?.family === "conservation" ? "hazard" : "attention")) as ReportTone, geometry: pp.geometry };
        }),
      } : undefined,
      technical: {
        nad83_state_plane: {
          x: Math.round(sp.x * 100) / 100,
          y: Math.round(sp.y * 100) / 100,
          epsg: 32161,
          crs: "NAD83 / Puerto Rico & Virgin Is. (EPSG:32161)",
          units: "metres",
          projection: "Lambert Conformal Conic (2SP), GRS80 ellipsoid",
          note: bi("Projected from the WGS84 pin with the NAD83 / Puerto Rico & Virgin Is. projection formulas. Not a survey coordinate.", "Proyectado desde el pin WGS84 con las fórmulas de la proyección NAD83 / Puerto Rico e Islas Vírgenes. No es una coordenada de mensura."),
          datum_note: bi("No WGS84→NAD83 datum transformation was applied; the resulting positional difference has not been quantified.", "No se aplicó transformación de datum WGS84→NAD83; la diferencia de posición resultante no se ha cuantificado."),
        },
        municipality_fips: site.municipality.fips,
        barrio_geoid: site.barrio?.geoid ?? null,
        location_id: site.location_id,
      },
    },
    findings,
    ai_explanations: [],
    land_use: lu,
    flags: regulatoryFlags(findings, lu),
    complexity: lu?.activity.use ? lu.complexity : null,
    next_steps: { activity, missing, unresolved, steps, location_requirements: context.locationRequirements },
    summary: { mapped, may_affect: mayAffect, unverified, next },
    versions: {
      schema: REPORT_SCHEMA,
      coverage_method: findings.some((f) => f.coverage && f.coverage.parts.length && f.scope === "parcel") ? COVERAGE_METHOD : "Parcel calculations not performed: no verified parcel geometry was used, so no polygons were clipped, dissolved or measured.",
      rules: `${RC_2023.name} ${RC_2023.version} (SmartPR knowledge graph; applicability to this site not verified)`,
    },
    regulation: lu?.decision?.governing.rules === "identified" ? { name: RC_2023.name, version: RC_2023.version, publication_date: RC_2023.dataset_date, url: RC_2023.url, applicability: "verified",
      note: bi(`Identified for ${site.municipality.name}: ${lu.decision.governing.rulesText ?? RC_2023.name}${lu.decision.governing.plan ? ` (${lu.decision.governing.plan})` : ""}. Amendments after the 2023 text have not been checked.`, `Identificado para ${site.municipality.name}: ${lu.decision.governing.rulesText ?? RC_2023.name}${lu.decision.governing.plan ? ` (${lu.decision.governing.plan})` : ""}. No se han verificado enmiendas posteriores al texto de 2023.`) }
      : { name: RC_2023.name, version: RC_2023.version, publication_date: RC_2023.dataset_date, url: RC_2023.url, applicability: "not_verified",
      note: bi("The publication date is not a confirmation that this regulation governs the site. SmartPR has not verified the governing regulation (e.g. a municipal Plan Territorial regulation or later amendments), so permitted-use analysis stays pending.", "La fecha de publicación no confirma que este reglamento rija el lugar. SmartPR no ha verificado el reglamento aplicable (p. ej., un reglamento de Plan Territorial municipal o enmiendas posteriores), así que el análisis de usos sigue pendiente.") },
    discrepancies,
    sources,
    disclaimer: bi("Reference information from official map sources. This is not a survey, permit decision, or approval.", "Información de referencia de fuentes cartográficas oficiales. No es una mensura, decisión de permiso ni aprobación."),
  };
  report.assessment = reviewerAssessment(report);
  return report;
}

/** Every finding belongs to the report's own (confirmed) location. */
export function belongsToSite(report: PropertyReport): boolean {
  return report.findings.every((f) => !f.point || (Math.abs(f.point.latitude - report.property.latitude) < 1e-7 && Math.abs(f.point.longitude - report.property.longitude) < 1e-7));
}

/** Approximate area for display — v2 reports carry it; v1 reports are derived. Never a status label as the value. */
export function reportArea(r: PropertyReport): NonNullable<PropertyReport["property"]["area"]> {
  if (r.property.area) return r.property.area;
  const m2 = r.property.boundary.area_m2;
  return m2
    ? { m2, cuerdas: Math.round((m2 / 3930.395) * 100) / 100, text: bi(`${Math.round(m2).toLocaleString("en-US")} m² (${(m2 / 3930.395).toFixed(2)} cuerdas)`), note: bi("From the mapped CRIM boundary — not a survey.", "Del límite mapeado del CRIM — no es una mensura.") }
    : { m2: null, cuerdas: null, text: bi("Not available", "No disponible"), note: findingStateText(r.property.boundary.state) };
}

/** Lead summary — v2 reports carry it; v1 reports get a derived one (no new claims). */
export function reportLeadSummary(r: PropertyReport): NonNullable<PropertyReport["summary"]> {
  if (r.summary) return r.summary;
  return {
    mapped: r.findings.filter((f) => f.state === "sourced" && f.value).map((f) => bi(`${f.title.en}: ${f.value!.en}`, `${f.title.es}: ${f.value!.es}`)),
    may_affect: r.land_use?.activity.use ? [bi(`${r.land_use.activity.useName}: ${COMPATIBILITY_TEXT[r.land_use.compatibility.outcome].en}`, `${r.land_use.activity.useName}: ${COMPATIBILITY_TEXT[r.land_use.compatibility.outcome].es}`)] : [STATUS_TEXT.not_evaluated],
    unverified: r.next_steps.unresolved,
    next: r.next_steps.missing,
  };
}

export const SUMMARY_HEADINGS: Record<keyof NonNullable<PropertyReport["summary"]>, Bi> = {
  mapped: bi("What is mapped on this property", "Qué está mapeado en esta propiedad"),
  may_affect: bi("What may affect the proposed project", "Qué puede afectar el proyecto propuesto"),
  unverified: bi("What remains unverified", "Qué queda sin verificar"),
  next: bi("What to provide or investigate next", "Qué aportar o investigar a continuación"),
};

/** Text of a finding's basis (v1 reports stored "official" for everything: derive from state). */
export function basisOf(f: ReportFinding): FindingBasis {
  return f.basis === "official" || !f.basis ? findingBasis(f.state, f.id === "permitted_uses") : f.basis;
}

/** Reviewer assessment — stored on v2 reports, derived for older ones. */
export function assessmentOf(r: PropertyReport): ReviewerAssessment {
  // Assessments saved before the "mapped findings" group listed classifications as "no mapped intersection": re-derive.
  return r.assessment?.mapped ? r.assessment : reviewerAssessment(r);
}

export const SCOPE_TEXT = {
  parcel: bi("Checked across verified parcel", "Verificado en toda la parcela verificada"),
  point: bi("At selected point only", "Solo en el punto seleccionado"),
  municipality: bi("Municipality-wide record", "Registro de todo el municipio"),
  not_evaluated: bi("Not evaluated", "No evaluado"),
} as const;

/** One line identifying the report snapshot; identical in the screen footer, both copies and the PDF. */
export function snapshotLine(r: PropertyReport, lang: "en" | "es"): string {
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  return `${L("Report", "Informe")} ${r.fingerprint} · ${r.schema} · ${L("location revision", "revisión de ubicación")} ${r.location_revision} · ${L("generated", "generado")} ${r.generated_at}`;
}

/** Decision summary lines (copy text, and anything else that prints the report as text). */
export function decisionText(r: PropertyReport, lang: "en" | "es"): string[] {
  const d = r.land_use?.activity.use ? r.land_use.decision : null;
  if (!d) return [];
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  const rq = (a: NonNullable<PropertyReport["land_use"]>["approvals"][number]) => a.requirement ?? (a.status === "confirmed" ? "required" : a.status === "likely" ? "potentially_required" : "unresolved");
  return [
    "",
    L("PROJECT DECISION SUMMARY", "RESUMEN DE DECISIÓN DEL PROYECTO"),
    `${L("Proposed use and scope", "Uso propuesto y alcance")}: ${d.scope[lang]}`,
    `${L("Compatibility", "Compatibilidad")}: ${d.compatibility.label[lang]} — ${d.compatibility.reason[lang]}`,
    `${L("Material constraints & exposure (mapped)", "Restricciones y exposición importantes (mapeadas)")}:`,
    ...(d.constraints.length ? d.constraints.map((c) => `• ${c.label[lang]}: ${c.detail[lang]}`) : [`• ${L("None mapped in the layers checked (not a clearance).", "Nada mapeado en las capas verificadas (no es una autorización).")}`]),
    `${L("Unresolved — evidence gaps and research tasks", "Sin resolver — brechas de evidencia y tareas")}:`,
    ...(d.unresolved.length ? d.unresolved.map((g) => `• ${g.label[lang]}: ${g.missing[lang]} ${L("Why", "Por qué")}: ${g.why[lang]} ${L("Task", "Tarea")}: ${g.obtain[lang]}${g.from ? ` (${g.from})` : ""} ${L("Blocks", "Bloquea")}: ${g.blocks[lang]}`) : [`• ${L("None.", "Ninguna.")}`]),
    `${L("Potential approvals", "Aprobaciones posibles")}:`,
    ...(r.land_use!.approvals.length ? r.land_use!.approvals.map((a) => `• ${a.name} — ${REQUIREMENT_TEXT[rq(a)][lang]}. ${L("Trigger", "Motivo")}: ${a.needs ? L(`unknown — depends on ${a.needs.en}.`, `desconocido — depende de ${a.needs.es}.`) : a.trigger} ${L("Authority", "Autoridad")}: ${a.agency || "—"}. ${L("Provision", "Disposición")}: ${a.citation || "—"}${a.citationGap ? ` [${a.citationGap[lang]}]` : ""}`) : [`• ${L("None triggered by SmartPR's rules.", "Ninguna activada por las reglas de SmartPR.")}`]),
    `${L("Likely pathway", "Ruta probable")}: ${d.pathway.summary[lang]} ${d.pathway.completeness[lang]}`,
    `${L("Immediate next action", "Próxima acción inmediata")}: ${d.pathway.nextAction[lang]}`,
  ];
}

/** Plain-text summary for "Copy summary": site summary → key findings → next steps → still needed → detailed findings. */
export function reportSummaryText(r: PropertyReport, lang: "en" | "es", review: ReturnType<typeof exportableReview> = null): string {
  const t = (b: Bi | null) => (b ? b[lang] : "—");
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  const area = reportArea(r);
  const a = assessmentOf(r);
  const nad = r.property.technical.nad83_state_plane;
  const meta = (x: (typeof a.review)[number]) => { const m = [x.scope ? t(SCOPE_TEXT[x.scope]).toLowerCase() : null, x.dataset ? `${x.dataset.name}${x.dataset.date ? `, ${x.dataset.date}` : ""}` : null].filter(Boolean); return m.length ? ` (${m.join("; ")})` : ""; };
  const group = (title: string, xs: typeof a.review = []) => (xs.length ? [title, ...xs.map((x) => `• ${t(x.label)}: ${t(x.value)}${meta(x)}`)] : []);
  const loc = r.property.location;
  const lines = [
    `${L("Property & Site Report", "Informe de propiedad y lugar")} — ${r.property.title}`,
    `${r.property.address.primary}, ${r.property.address.secondary}`,
    ...(loc?.preliminary && loc.parcel !== "loading" ? [L("PRELIMINARY — SELECTED POINT ONLY", "PRELIMINAR — SOLO EL PUNTO SELECCIONADO")] : []),
    ...(loc?.notices ?? []).map((n) => `! ${t(n)}`),
    `${L("Coordinates", "Coordenadas")}: ${r.property.latitude.toFixed(6)}, ${r.property.longitude.toFixed(6)} · ${L("Catastro", "Catastro")}: ${r.property.catastro.text ? t(r.property.catastro.text) : r.property.catastro.value ?? t(findingStateText(r.property.catastro.state))} · ${L("Approximate area", "Área aproximada")}: ${t(area.text)} (${t(area.note)})`,
    "",
    t(a.conclusion),
    ...decisionText(r, lang),
    "",
    L("KEY REGULATORY FINDINGS", "HALLAZGOS REGULATORIOS CLAVE"),
    ...group(L("Material constraints or exposure:", "Restricciones o exposición importantes:"), a.review),
    ...group(L("Mapped findings (no constraint indicated by the layer alone):", "Hallazgos mapeados (la capa por sí sola no indica restricción):"), a.mapped),
    ...group(L("No mapped intersection identified (checked; not a clearance):", "No se identificó intersección mapeada (verificado; no es una autorización):"), a.clear),
    ...group(L("Unresolved or insufficient evidence:", "Sin resolver o evidencia insuficiente:"), a.unable),
    "",
    L("RECOMMENDED NEXT STEPS", "PRÓXIMOS PASOS RECOMENDADOS"),
    ...(a.actions.length ? a.actions.map((x, i) => `${i + 1}. ${t(x.issue)} — ${t(x.action)}`) : [L("None.", "Ninguno.")]),
    ...(a.still_needed.length ? ["", L("STILL NEEDED FROM YOU", "AÚN NECESITAMOS DE USTED"), ...a.still_needed.map((x) => `• ${t(x.title)}: ${t(x.text)}`)] : []),
    "",
    L("DETAILED SOURCE FINDINGS", "HALLAZGOS DETALLADOS POR FUENTE"),
    ...r.findings.map((f) => {
      const val = f.value && (f.state === "sourced" || f.state === "none_mapped" || f.state === "not_evaluated") ? t(f.value) : t(findingStateText(f.state));
      const src = f.sources[0];
      const scopeLabel = r.schema !== REPORT_SCHEMA ? L(`${f.scope} (as saved; not re-verified)`, `${f.scope} (según se guardó; no reverificado)`) : t((SCOPE_TEXT as Record<string, Bi>)[f.scope] ?? SCOPE_TEXT.not_evaluated);
      const basisT = t(BASIS_TEXT[basisOf(f)]);
      const retr = f.retrieval ? t(RETRIEVAL_TEXT[f.retrieval]) : null;
      return `• ${t(f.title)}: ${val} — ${scopeLabel}; ${basisT}${retr && retr !== basisT ? `; ${retr}` : ""}${f.pin ? `; ${L("at the pin", "en el pin")}: ${t(f.pin.value)}` : ""}${src ? ` [${src.name}${src.dataset_date ? `, ${L("dataset date", "fecha de datos")} ${src.dataset_date}` : ""}${src.url ? ` ${src.url}` : ""}${f.looked_up_at ? `, ${L("looked up", "consultado")} ${f.looked_up_at}` : ""}]` : ""}`;
    }),
    ...(review ? [
      "",
      `${L("Professional review", "Revisión profesional")}: ${review.status_text[lang]}${review.reviewed_at ? ` (${review.reviewed_by?.name ?? ""} ${review.reviewed_at.slice(0, 10)})` : ""} — ${review.disclaimer[lang]}`,
      ...review.notes.map((n) => `- ${L("Note", "Nota")}${n.finding_id ? ` [${n.finding_id}]` : ""}: ${n.text}`),
      ...review.open_questions.map((q) => `- ${L("Open question", "Pregunta pendiente")}${q.finding_id ? ` [${q.finding_id}]` : ""}: ${q.text}`),
      ...review.resolved_questions.map((q) => `- ${L("Resolved", "Resuelta")}: ${q.text} → ${q.resolution}`),
    ] : []),
    "",
    L("TECHNICAL", "TÉCNICO"),
    `${nad.crs ?? "NAD83 / Puerto Rico & Virgin Is. (EPSG:32161)"}: X ${nad.x.toLocaleString("en-US")} m, Y ${nad.y.toLocaleString("en-US")} m (${L("units", "unidades")}: ${nad.units ?? "metres"}). ${t(nad.note)}`,
    ...(r.versions ? [`${L("Area method", "Método de áreas")}: ${r.versions.coverage_method}`, `${L("Rules", "Reglas")}: ${r.versions.rules}`] : []),
    ...(r.regulation ? [`${L("Regulation for use rules", "Reglamento para reglas de uso")}: ${r.regulation.name}${r.regulation.publication_date ? ` (${L("publication date", "fecha de publicación")} ${r.regulation.publication_date})` : ""} — ${L("applicability to this site", "aplicabilidad a este lugar")}: ${r.regulation.applicability === "verified" ? L("verified", "verificada") : L("not verified", "no verificada")}. ${t(r.regulation.note)}`] : []),
    ...(r.schema !== REPORT_SCHEMA ? [L(`Saved with an earlier report format (${r.schema}); shown as saved, not re-evaluated.`, `Guardado con un formato anterior (${r.schema}); se muestra tal como se guardó, sin reevaluar.`)] : []),
    `${L("Sources", "Fuentes")}: ${r.sources.map((s) => `${s.name}${s.dataset_date ? ` (${L("dataset date", "fecha de datos")} ${s.dataset_date})` : ""}`).join("; ")}`,
    snapshotLine(r, lang),
    t(r.disclaimer),
  ];
  return lines.join("\n");
}

/** Defensive restore of a saved report (Passport / snapshot). */
export function restorePropertyReport(raw: unknown): PropertyReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as PropertyReport;
  if (!(REPORT_SCHEMAS_READABLE as readonly string[]).includes(r.schema) || !r.property || !Array.isArray(r.findings)) return null;
  return r;
}


// ---------------------------------------------------------------------------
// Regulatory Flags — compact summary cards for the top of the report
// ---------------------------------------------------------------------------

export function regulatoryFlags(findings: ReportFinding[], lu: LandUseAnalysis | null): NonNullable<PropertyReport["flags"]> {
  const f = (id: string) => findings.find((x) => x.id === id);
  const flag = (id: string, label: Bi, src: ReportFinding | undefined, valueOf?: (x: ReportFinding) => Bi | null) => {
    const st = src ? findingStatus(src.state) : "unable_to_verify";
    const v = src && valueOf ? valueOf(src) : src?.value ?? null;
    return { id, label, value: v ?? STATUS_TEXT[st], tone: src && (src.state === "sourced" || src.state === "none_mapped") ? src.tone : "unknown" as ReportTone, status: st };
  };
  const out: NonNullable<PropertyReport["flags"]> = [
    flag("zoning", bi("Zoning", "Calificación"), f("zoning")),
    flag("land_class", bi("Land classification", "Clasificación del suelo"), f("put")?.state === "sourced" && f("put")?.currency?.status !== "unresolved" ? f("put") : f("land_class") ?? f("put")),
  ];
  if (lu?.activity.use && lu.decision) {
    const d = lu.decision.compatibility;
    out.push({ id: "compatibility", label: bi("Land-use compatibility", "Compatibilidad de uso"), value: d.label, tone: d.status === "supported_permitted" ? "ok" : d.status === "supported_prohibited" ? "hazard" : "attention", status: d.status === "undetermined" ? "requires_professional_review" : "verified" });
  } else if (lu?.activity.use) {
    const o = lu.compatibility.outcome;
    // Governing regulation not verified → pending, with the preliminary reading named.
    out.push({ id: "compatibility", label: bi("Land-use compatibility", "Compatibilidad de uso"), value: bi(`Pending — regulation not verified (preliminary: ${COMPATIBILITY_TEXT[o].en})`, `Pendiente — reglamento no verificado (preliminar: ${COMPATIBILITY_TEXT[o].es})`), tone: "attention", status: "requires_professional_review" });
  } else {
    out.push({ id: "compatibility", label: bi("Land-use compatibility", "Compatibilidad de uso"), value: STATUS_TEXT.not_evaluated, tone: "unknown", status: "not_evaluated" });
  }
  // Flags state what is mapped; whether a review applies depends on the activity.
  const fl = f("flood_zone");
  const sfha = fl?.state === "sourced" && fl.tone === "hazard";
  const sfhaShare = fl?.coverage?.parts.filter((p) => /^(A|V)/.test(p.key)).map((p) => p.share_text).join(" + ");
  out.push({ id: "flood", label: bi("Flood risk (FEMA)", "Riesgo de inundación (FEMA)"),
    value: !fl || fl.state !== "sourced" ? STATUS_TEXT[findingStatus(fl?.state ?? "unavailable")] : sfha ? bi(sfhaShare ? `High-risk area on ${sfhaShare} of the parcel` : "High-risk area mapped", sfhaShare ? `Área de alto riesgo en ${sfhaShare} de la parcela` : "Área de alto riesgo mapeada") : fl.pill ?? bi("Low", "Bajo"),
    tone: !fl || fl.state !== "sourced" ? "unknown" : sfha ? "hazard" : "ok", status: fl ? findingStatus(fl.state) : "unable_to_verify" });
  const cz = f("coastal_zone");
  out.push(flag("coastal", bi("Coastal zone", "Zona costanera"), cz, (x) => (x.state === "sourced" ? bi("Inside the mapped coastal zone", "Dentro de la zona costanera mapeada") : x.state === "none_mapped" ? bi("Outside the mapped boundary", "Fuera del límite mapeado") : null)));
  const env = ["protected_area", "natural_reserve", "wetlands", "zoning_overlay", "floodway"].map(f).filter((x): x is ReportFinding => !!x);
  const envHit = env.filter((x) => x.state === "sourced" && x.id !== "floodway" || (x.id === "floodway" && x.state === "sourced" && x.tone === "hazard"));
  const envUnable = env.filter((x) => x.state === "unavailable" || x.state === "stale" || x.state === "not_performed");
  out.push({ id: "environmental", label: bi("Environmental designations", "Designaciones ambientales"),
    value: envHit.length ? bi(`Mapped: ${envHit.map((x) => x.title.en.split(" (")[0]).join(", ")}`, `Mapeado: ${envHit.map((x) => x.title.es.split(" (")[0]).join(", ")}`) : envUnable.length ? bi(`Unable to verify (${envUnable.map((x) => x.title.en.split(" (")[0]).join(", ")})`, `No se pudo verificar (${envUnable.map((x) => x.title.es.split(" (")[0]).join(", ")})`) : STATUS_TEXT.no_mapped_constraint,
    tone: envHit.length ? "attention" : envUnable.length ? "unknown" : "ok", status: envHit.length ? "verified" : envUnable.length ? "unable_to_verify" : "no_mapped_constraint" });
  const hz = [f("historic_zone"), f("historic_site"), f("archaeology")].filter((x): x is ReportFinding => !!x);
  const hHit = hz.filter((x) => x.state === "sourced");
  const hUnable = hz.filter((x) => x.state === "unavailable" || x.state === "stale" || x.state === "not_performed");
  out.push({ id: "historic", label: bi("Historic & archaeological", "Histórico y arqueológico"),
    value: hHit.length ? bi(`Mapped: ${hHit.map((x) => x.title.en.split(" (")[0]).join(", ")}`, `Mapeado: ${hHit.map((x) => x.title.es.split(" (")[0]).join(", ")}`) : hUnable.length ? bi(`Unable to verify (${hUnable.map((x) => x.title.en.split(" (")[0]).join(", ")})`, `No se pudo verificar (${hUnable.map((x) => x.title.es.split(" (")[0]).join(", ")})`) : STATUS_TEXT.no_mapped_constraint,
    tone: hHit.length ? "attention" : hUnable.length ? "unknown" : "ok", status: hHit.length ? "verified" : hUnable.length ? "unable_to_verify" : "no_mapped_constraint" });
  if (lu?.activity.use) {
    const c = lu.complexity;
    out.push({ id: "complexity", label: bi("Overall regulatory complexity", "Complejidad regulatoria general"), value: bi(c.level === "high" ? "High" : c.level === "moderate" ? "Moderate" : "Low", c.level === "high" ? "Alta" : c.level === "moderate" ? "Moderada" : "Baja"), tone: c.level === "high" ? "hazard" : c.level === "moderate" ? "attention" : "ok", status: "verified" });
  }
  return out;
}
