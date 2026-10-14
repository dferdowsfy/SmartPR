// ============================================================================
// KG scenario matrix — harness (pure, deterministic, no network).
//
// A scenario fixture (./scenarios/*.json) describes one realistic intake:
//   business description + the model's project-context reading (a fixture:
//   no live LLM) + discovery answers + profile + the confirmed site, whose
//   map-layer facts are injected as raw service attributes (./geoContexts.json)
//   and parsed by the SAME parsers the live layer service uses.
//
// It is run through the same pipeline the intake uses — nothing parallel:
//   description → interpretScenario → reconcileProjectContext(validateProjectContext(model))
//   site layers  → parse* (locations/layers) → siteEngineFacts (locations/intakeLocation)
//   computeRequirementsFromKB (+ resolveIntakeFacts, + formation normalization)
//   computeEnergyAssessment → supersededLegacyCards → processChecklist
//   groupRequirements / splitOtherChecks → the order the checklist renders in
//
// and the resulting visible checklist is checked against the scenario's
// expectations: mustInclude / mustNotInclude (stable keys: KB document ids,
// or `process:<id>` for energy-process items), ordering constraints, the
// question budget, and that no internal code leaks into user-facing text.
//
// Live geo services are NOT called here (see `npm run geo:health` for that).
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeRequirementsFromKB, KB, INTAKE_INDUSTRIES, type UIRequirement } from "../../kb";
import { validateProjectContext, type ProjectContext } from "../../ai/intake/projectContext";
import { combineScenario, interpretScenario, reconcileProjectContext } from "../../ai/intake/scenario";
import { resolveIntakeFacts } from "../../ai/intake/relationships";
import { entityTypeFromLegacyStructure } from "../../forms/engine/intake";
import { normalizeEntityFormationRequirements } from "../../forms/engine/requirementAugment";
import { translateTriggerReason } from "../../triggerReason";
import {
  LAYER_SOURCES,
  parseAdvisoryFlood,
  parseCrimParcel,
  parseFemaFlood,
  parseJpCalificacion,
  parseNoaaCoastalZone,
  parsePresence,
  unknownLayer,
  type ArcGisQueryResponse,
  type SiteLayerResult,
  type SiteLayers,
} from "../../locations/layers";
import { siteEngineFacts, siteFactDetails, type IntakeSite } from "../../locations/intakeLocation";
import { computeEnergyAssessment } from "../../processes/view";
import { loadEnergyProcessGraph } from "../../processes/kb";
import { processChecklist, type ProcessChecklist } from "../../processes/presentation";
import { supersededLegacyCards } from "../../processes/legacyCards";
import {
  groupRequirements,
  orderByPrerequisites,
  splitOtherChecks,
  REQUIREMENT_GROUP_ORDER,
  type RequirementGroupId,
} from "../../components/filing/requirementGroups";
import type { ProjectIntent } from "../../ai/intake/projectIntent";

export const KG_DIR = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = join(KG_DIR, "scenarios");
const AT = "2026-10-01T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

export type Confidence = "verified-in-code" | "needs-expert-review";

interface Expectation {
  /** Stable key: a KB document id (DOC_*) or `process:<energy process id>`. */
  key?: string;
  /** Satisfied when ANY of these keys is present (e.g. a legacy card or the process that absorbs it). */
  anyOf?: string[];
  confidence: Confidence;
  rationale: string;
  /**
   * mustInclude: the item's applicability must be one of these.
   * mustNotInclude: only a violation when present with one of these applicabilities
   * (e.g. "never REQUIRED", while needs-more-information is acceptable).
   */
  applicabilityIn?: string[];
  /** mustInclude (engine cards): the card's agency must match this regex (case-insensitive). */
  agencyMatches?: string;
  /**
   * mustNotInclude: only a standalone engine card counts; the document being
   * absorbed by an energy process item is the expected behavior (duplicate-card checks).
   */
  cardOnly?: boolean;
}

interface OrderingExpectation {
  before: string;
  after: string;
  confidence: Confidence;
  rationale: string;
}

export interface KgScenario {
  id: string;
  title: string;
  matrix: { businessType: string; projectType: string; locationContext: string };
  description: string;
  profile: Record<string, unknown>;
  answers: Record<string, unknown>;
  projectIntent: ProjectIntent | null;
  modelProjectContext?: Record<string, unknown> | null;
  site: { municipality: string; geo: string } | null;
  expect: {
    mustInclude: Expectation[];
    mustNotInclude: Expectation[];
    ordering?: OrderingExpectation[];
    /** Default 3. */
    maxQuestions?: number;
    maxQuestionsConfidence?: Confidence;
  };
  notes?: string;
}

/** Raw service attributes for one site, parsed by the live parsers. */
export interface GeoContextFixture {
  label: string;
  description: string;
  /** FEMA NFHL zone attributes at the point; "unknown" = service down. */
  fema: Record<string, unknown> | "unknown";
  /** FEMA/JP advisory (ABFE) 1% zone at the point; null = outside; "unknown" = down. */
  advisory?: Record<string, unknown> | null | "unknown";
  /** JP calificación attributes; null = no polygon; "unknown" = down. */
  jp: Record<string, unknown> | null | "unknown";
  /** CRIM parcel attributes; null = no polygon; "unknown" = down. */
  crim: Record<string, unknown> | null | "unknown";
  /** Official CZMA boundary: inside / outside / unknown. */
  coastal: "inside" | "outside" | "unknown";
  /** JP historic-zone polygon at the point (name), null = outside, "unknown" = down. */
  historic?: string | null | "unknown";
  /** JP protected natural area at the point (name). */
  protected?: string | null | "unknown";
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function loadGeoContexts(): Record<string, GeoContextFixture> {
  return JSON.parse(readFileSync(join(KG_DIR, "geoContexts.json"), "utf8")).contexts;
}

/** Stable CI test name: id + matrix cell (titles may be edited by reviewers). */
export function kgTestName(s: KgScenario): string {
  return `${s.id} kg-scenario: ${s.matrix.businessType} / ${s.matrix.projectType} / ${s.matrix.locationContext}`;
}

export function loadKgScenarios(): KgScenario[] {
  return readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(SCENARIO_DIR, f), "utf8")) as KgScenario);
}

// ---------------------------------------------------------------------------
// Geo fixture → SiteLayers via the live parsers
// ---------------------------------------------------------------------------

const resp = (attrs: Record<string, unknown> | null): ArcGisQueryResponse =>
  ({ features: attrs ? [{ attributes: attrs }] : [] }) as ArcGisQueryResponse;

export function siteLayersFromFixture(g: GeoContextFixture, lat: number, lng: number): SiteLayers {
  const results: SiteLayerResult[] = [];
  results.push(
    g.fema === "unknown"
      ? unknownLayer("flood_zone", LAYER_SOURCES.fema_flood_zones, "fixture: service unavailable", AT)
      : parseFemaFlood(resp(g.fema), resp({ FIRM_PAN: "72000C0000J", EFF_DATE: 1258502400000, DFIRM_ID: "72000C" }), AT)
  );
  const adv = g.advisory ?? null;
  results.push(
    adv === "unknown"
      ? unknownLayer("flood_advisory", LAYER_SOURCES.jp_advisory_flood, "fixture: service unavailable", AT)
      : parseAdvisoryFlood(resp(adv), resp(null), AT)
  );
  const czm =
    g.coastal === "unknown"
      ? unknownLayer("coastal_zone", LAYER_SOURCES.noaa_czma, "fixture: service unavailable", AT)
      : parseNoaaCoastalZone(resp(g.coastal === "inside" ? { czmadomain: "inland" } : null), AT)!;
  results.push(czm);
  let catastro: string | null = null;
  if (g.jp === "unknown") {
    results.push(unknownLayer("zoning", LAYER_SOURCES.jp_calificacion, "fixture: service unavailable", AT));
    results.push(unknownLayer("land_class", LAYER_SOURCES.jp_calificacion, "fixture: service unavailable", AT));
  } else {
    const jp = parseJpCalificacion(resp(g.jp), AT);
    catastro = jp.catastro;
    results.push(jp.zoning, jp.land_class);
  }
  results.push(
    g.crim === "unknown"
      ? parseCrimParcel("fixture: service unavailable", AT, catastro)
      : parseCrimParcel(resp(g.crim), AT, catastro)
  );
  const presence = (layer: "historic_zone" | "protected_area", v: string | null | "unknown" | undefined) => {
    const src = layer === "historic_zone" ? LAYER_SOURCES.mipr_zona_historica : LAYER_SOURCES.jp_areas_protegidas;
    if (v === undefined || v === "unknown") return unknownLayer(layer, src, "fixture: not provided", AT);
    return parsePresence(layer, src, resp(v ? { NOMBRE: v } : null), AT, ["NOMBRE"]);
  };
  results.push(presence("historic_zone", g.historic), presence("protected_area", g.protected));
  return { latitude: lat, longitude: lng, resolved_at: AT, results };
}

export function intakeSiteFor(scenario: KgScenario, geo: Record<string, GeoContextFixture>): IntakeSite | null {
  if (!scenario.site) return null;
  const g = geo[scenario.site.geo];
  if (!g) throw new Error(`${scenario.id}: unknown geo context "${scenario.site.geo}"`);
  const muni = (KB.municipalities as Array<{ name: string; flags?: string[] }>).find((m) => m.name === scenario.site!.municipality);
  if (!muni) throw new Error(`${scenario.id}: municipality "${scenario.site.municipality}" is not in the KB`);
  // A fixed synthetic point per scenario (coordinates only bind the layers to the site).
  const n = Number(scenario.id.replace(/\D/g, "")) || 1;
  const lat = 18.2 + n / 1000;
  const lng = -66.3 - n / 1000;
  return {
    latitude: lat,
    longitude: lng,
    coordinate_source: "MAP_PIN",
    formatted_address: null,
    municipality: { name: muni.name, fips: null },
    barrio: null,
    near_boundary: false,
    designations: [...(muni.flags ?? [])],
    boundary_source: { id: "census-tiger", name: "Census TIGER (fixture)", version: "2024", url: null },
    location_id: null,
    confirmed_at: AT,
    layers: siteLayersFromFixture(g, lat, lng),
  };
}

// ---------------------------------------------------------------------------
// Run one scenario through the intake pipeline
// ---------------------------------------------------------------------------

export interface VisibleItem {
  key: string;
  source: "engine" | "process";
  name: string;
  agency: string;
  applicability: string | null;
  group: RequirementGroupId | "energy" | "other_checks";
  /** Display position (0-based) in the rendered checklist order. */
  position: number;
  /** KB prerequisites among the present items (engine cards). */
  waitingOn: string[];
  /** Legacy KB documents an energy process item stands for. */
  legacyDocs: string[];
  /** Raw trigger reason (engine cards). */
  reason?: string;
  sourceRule?: string;
}

export interface ScenarioRun {
  scenario: KgScenario;
  projectContext: ProjectContext;
  discardedModelFacts: { field: string; reason: string }[];
  locationFacts: Record<string, unknown>;
  engineRows: UIRequirement[];
  items: VisibleItem[];
  /** Questions the user sees: energy checklist questions + inline requirement questions (main area). */
  questions: string[];
  /** Energy questions the process engine raised before the presentation cap. */
  energyQuestionsUncapped: number;
  otherCheckQuestions: string[];
  checklist: ProcessChecklist | null;
  userFacingText: { where: string; text: string }[];
}

/** Keys with a real value: the live intake's provenanceExtra() confirmation set. */
function valuedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== "");
}

export function runKgScenario(scenario: KgScenario, geo: Record<string, GeoContextFixture> = loadGeoContexts()): ScenarioRun {
  const profile = { ...scenario.profile };
  const answers = { ...scenario.answers };
  if (scenario.site && !profile.municipality) profile.municipality = scenario.site.municipality;

  // 1. Description → scenario reading; model reading validated against the text.
  const reading = combineScenario(interpretScenario(scenario.description), null);
  const validated = validateProjectContext(scenario.modelProjectContext ?? {}, scenario.description);
  const projectContext = reconcileProjectContext(validated.context, reading);

  // 2. The confirmed site's facts (map layers parsed from the fixture).
  const site = intakeSiteFor(scenario, geo);
  const locationFacts = site ? siteEngineFacts(site) : null;
  const details = site ? siteFactDetails(site) : {};

  // 3. Rules engine — exactly the intake's computeRequirements().
  const entityType = entityTypeFromLegacyStructure(profile.business_structure as string | undefined);
  const resolved = resolveIntakeFacts({ profile, answers }, { kb: KB, allowedIndustries: INTAKE_INDUSTRIES }).questionValues;
  const fromKb = computeRequirementsFromKB(profile as never, answers, resolved, {
    entityType,
    projectIntent: scenario.projectIntent,
    projectContext,
    locationFacts,
    // Same fact provenance the live intake passes (SmartPRIntake
    // provenanceExtra): a session id plus every valued profile field and
    // discovery answer as confirmed in this intake. Without it the engine
    // runs its legacy no-session path, where negated_fact_keys suppression
    // stays inert (REG-ALCOHOL-NEGATED-001) and an explicit "No" the live
    // intake honors would still fire here.
    sessionId: `kg-harness-${scenario.id}`,
    confirmedKeys: valuedKeys(profile).concat(valuedKeys(answers)),
  });
  const intent = scenario.projectIntent;
  const engineRows =
    intent === "existing_business" || intent === "project_only"
      ? fromKb
      : normalizeEntityFormationRequirements<UIRequirement>(entityType, fromKb, (d) => ({
          document_id: d.document_id,
          code: d.code,
          name: d.name,
          reason: d.reason,
          agency: "Department of State",
          category: "formation",
          mandatory: true,
          status: "pending",
          applicability: "required",
          kind: "government_application",
          stage: "entity_formation",
        }) as UIRequirement);

  // 4. Energy process graph (same inputs as the intake).
  const { graph, assessment } = computeEnergyAssessment({
    projectContext,
    municipality: profile.municipality as string | undefined,
    answers,
    location: site ? { facts: locationFacts!.projectFacts, details } : null,
  });
  const superseded = supersededLegacyCards(
    graph,
    assessment,
    engineRows.map((r) => ({ document_id: r.document_id, source_rule: r.source_rule, triggerFacts: r.triggerFacts }))
  );
  const legacyNames = Object.fromEntries(engineRows.filter((r) => r.document_id).map((r) => [r.document_id!, r.name]));
  const checklist = assessment
    ? processChecklist(assessment, graph, "en", { suppressedLegacy: [...superseded.values()].filter((s) => s.suppressed), legacyNames })
    : null;

  // 5. The visible engine cards, grouped and ordered as the checklist renders them.
  const visible = engineRows.filter((r) => r.applicability !== "not_applicable" && !superseded.has(r.document_id ?? ""));
  const kbDocs = KB.documents as unknown as Array<{ id: string; depends_on_document_ids?: string[] | null }>;
  const grouping = groupRequirements(
    visible.map((r) => ({
      documentId: r.document_id,
      applicability: r.applicability,
      stage: r.stage,
      mandatory: r.mandatory,
      done: false,
      awaitingAnswer: !!r.unansweredTriggerQuestionId,
    })),
    kbDocs
  );
  const { main, otherChecks } = splitOtherChecks(
    visible.map((r, i) => ({ r, g: grouping[i], group: grouping[i].group, triggerQuestionId: r.unansweredTriggerQuestionId ?? null })),
    { projectIntent: intent }
  );
  const energyPrimary = assessment?.facts.energy_market_segment === "wholesale";
  const items: VisibleItem[] = [];
  const pushEngine = (list: typeof main, group: RequirementGroupId | "other_checks") => {
    for (const { r, g } of list) {
      items.push({
        key: r.document_id ?? r.code,
        source: "engine",
        name: r.name,
        agency: r.agency,
        applicability: r.applicability ?? null,
        group,
        position: items.length,
        waitingOn: g.waitingOn,
        legacyDocs: [],
        reason: r.reason,
        sourceRule: r.source_rule,
      });
    }
  };
  const pushEnergy = () => {
    for (const stage of checklist?.stages ?? []) {
      for (const it of stage.items) {
        items.push({
          key: `process:${it.process_id}`,
          source: "process",
          name: it.name,
          agency: it.agency,
          applicability: it.status,
          group: "energy",
          position: items.length,
          waitingOn: [],
          legacyDocs: graph.processes.get(it.process_id)?.legacy_document_ids ?? [],
        });
      }
    }
  };
  if (energyPrimary) pushEnergy();
  for (const gid of REQUIREMENT_GROUP_ORDER) {
    if (gid === "registrations" || gid === "completed") continue;
    pushEngine(orderByPrerequisites(main.filter((m) => m.group === gid), (m) => m.r.document_id, kbDocs), gid);
  }
  if (!energyPrimary) pushEnergy();
  pushEngine(orderByPrerequisites(main.filter((m) => m.group === "registrations"), (m) => m.r.document_id, kbDocs), "registrations");
  pushEngine(otherChecks.flatMap((q) => q.cards), "other_checks");

  // 6. Questions the user is asked on the checklist page.
  const qText = new Map((KB.questions as Array<{ id: string; question: string }>).map((q) => [q.id, q.question]));
  const inlineQ = [...new Set(main.map((m) => m.r.unansweredTriggerQuestionId).filter((q): q is string => !!q))];
  const questions = [
    ...(checklist?.questions ?? []).map((q) => `energy: ${q.text}`),
    ...inlineQ.map((q) => `inline: ${qText.get(q) ?? q}`),
  ];
  const otherCheckQuestions = otherChecks.map((o) => qText.get(o.questionId) ?? o.questionId);

  // 7. User-facing text (what the cards render), for the code-leak check.
  const muni = (profile.municipality as string) ?? "";
  const userFacingText: { where: string; text: string }[] = [];
  for (const r of visible) {
    const id = r.document_id ?? r.code;
    userFacingText.push({ where: `${id}.name`, text: r.name });
    if (r.reason && !r.reason.startsWith("UNANSWERED_QUESTION:")) {
      userFacingText.push({ where: `${id}.reason`, text: translateTriggerReason(r.reason, muni, "en", details) ?? r.reason });
    }
    if (r.unansweredTriggerQuestionId) userFacingText.push({ where: `${id}.question`, text: qText.get(r.unansweredTriggerQuestionId) ?? r.unansweredTriggerQuestionId });
    if (r.agencyNote) userFacingText.push({ where: `${id}.agencyNote`, text: r.agencyNote });
    if (r.downloadNote) userFacingText.push({ where: `${id}.downloadNote`, text: r.downloadNote });
  }
  if (checklist) {
    userFacingText.push({ where: "energy.summary", text: checklist.summary });
    for (const s of checklist.stages) {
      if (s.name) userFacingText.push({ where: `energy.stage.${s.id}`, text: s.name });
      for (const it of s.items) {
        userFacingText.push({ where: `process:${it.process_id}.name`, text: it.name });
        userFacingText.push({ where: `process:${it.process_id}.why`, text: it.why });
        for (const n of it.needs) userFacingText.push({ where: `process:${it.process_id}.needs`, text: n });
      }
    }
    for (const q of checklist.questions) userFacingText.push({ where: `energy.question.${q.fact}`, text: q.text });
    for (const na of checklist.not_applicable) userFacingText.push({ where: "energy.not_applicable", text: na.name });
  }

  return {
    scenario,
    projectContext,
    discardedModelFacts: validated.discarded,
    locationFacts: locationFacts?.projectFacts ?? {},
    engineRows,
    items,
    questions,
    energyQuestionsUncapped: assessment?.questions.length ?? 0,
    otherCheckQuestions,
    checklist,
    userFacingText,
  };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Internal identifiers that must never reach user-facing text. */
export const CODE_LEAK_RE = /\b(?:DOC_[A-Z0-9_]+|RULE_\d+|Q_[A-Z][A-Z0-9_]{2,}|PT_[A-Z][A-Z0-9_]+|PR_[A-Z][A-Z0-9_]+|LS_[A-Z][A-Z0-9_]+|BT_[A-Z][A-Z0-9_]+)\b/;

export interface Finding {
  kind: "missing" | "gap" | "agency" | "unexpected" | "ordering" | "questions" | "leak" | "duplicate" | "applicability" | "harness";
  key?: string;
  message: string;
  confidence?: Confidence;
  rationale?: string;
}

export interface ScenarioResult {
  id: string;
  title: string;
  matrix: KgScenario["matrix"];
  status: "pass" | "fail";
  findings: Finding[];
  /** Ordering constraints that could not be evaluated (one side absent). */
  orderingSkipped: string[];
  items: Array<Pick<VisibleItem, "key" | "group" | "applicability" | "position" | "agency">>;
  questions: string[];
  energyQuestionsUncapped: number;
  otherCheckQuestions: string[];
  discardedModelFacts: { field: string; reason: string }[];
}

function presentKeys(run: ScenarioRun): Map<string, VisibleItem> {
  const m = new Map<string, VisibleItem>();
  for (const it of run.items) if (!m.has(it.key)) m.set(it.key, it);
  return m;
}

export function evaluateKgScenario(run: ScenarioRun): ScenarioResult {
  const s = run.scenario;
  const findings: Finding[] = [];
  const present = presentKeys(run);
  // A legacy document an energy item stands for counts as present for
  // mustNotInclude (the user sees that permit), but not for mustInclude.
  const viaProcess = new Map<string, string>();
  for (const it of run.items) for (const d of it.legacyDocs) if (!viaProcess.has(d)) viaProcess.set(d, it.key);

  const reportedMissing = new Set<string>();
  for (const e of s.expect.mustInclude) {
    const keys = e.anyOf ?? (e.key ? [e.key] : []);
    const hit = keys.map((k) => present.get(k)).find(Boolean);
    if (!hit && reportedMissing.has(keys.join(" | "))) continue; // same key, second (agency) expectation
    if (!hit) {
      reportedMissing.add(keys.join(" | "));
      const gap = keys.every((k) => k.startsWith("gap:"));
      findings.push({
        kind: gap ? "gap" : "missing",
        key: keys.join(" | "),
        message: gap ? `KB gap: no requirement models ${keys.join(" | ")}` : `missing ${keys.join(" | ")}`,
        confidence: e.confidence,
        rationale: e.rationale,
      });
    } else if (e.agencyMatches && !new RegExp(e.agencyMatches, "i").test(hit.agency)) {
      findings.push({
        kind: "agency",
        key: hit.key,
        message: `${hit.key} agency is "${hit.agency}", expected /${e.agencyMatches}/i`,
        confidence: e.confidence,
        rationale: e.rationale,
      });
    } else if (e.applicabilityIn && !e.applicabilityIn.includes(hit.applicability ?? "")) {
      findings.push({
        kind: "applicability",
        key: hit.key,
        message: `${hit.key} is "${hit.applicability}", expected one of ${e.applicabilityIn.join(", ")}`,
        confidence: e.confidence,
        rationale: e.rationale,
      });
    }
  }
  for (const e of s.expect.mustNotInclude) {
    const keys = e.anyOf ?? (e.key ? [e.key] : []);
    for (const k of keys) {
      const hit = present.get(k);
      const procKey = e.cardOnly ? undefined : viaProcess.get(k);
      const proc = procKey ? present.get(procKey) : undefined;
      // Applicability limits apply to whichever item the user sees: the card, or the process standing for it.
      // Process statuses (required / may_apply / expert / ...) are compared as-is.
      const seen = hit ?? proc;
      if (seen && e.applicabilityIn && !e.applicabilityIn.includes(seen.applicability ?? "")) continue;
      if (seen) {
        const how = hit ? `${hit.group}${hit.applicability ? `, ${hit.applicability}` : ""}` : `via ${procKey}, ${proc!.applicability}`;
        findings.push({ kind: "unexpected", key: k, message: `unexpected ${k} (${how})`, confidence: e.confidence, rationale: e.rationale });
      }
    }
  }
  const orderingSkipped: string[] = [];
  for (const o of s.expect.ordering ?? []) {
    const a = present.get(o.before);
    const b = present.get(o.after);
    if (!a || !b) {
      orderingSkipped.push(`${o.before} before ${o.after} (${!a ? o.before : o.after} absent)`);
      continue;
    }
    if (!(a.position < b.position)) {
      findings.push({
        kind: "ordering",
        key: `${o.before}<${o.after}`,
        message: `${o.before} (#${a.position + 1}, ${a.group}) should come before ${o.after} (#${b.position + 1}, ${b.group})${b.waitingOn.includes(o.before) ? "" : "; no KB prerequisite edge"}`,
        confidence: o.confidence,
        rationale: o.rationale,
      });
    }
  }
  const maxQ = s.expect.maxQuestions ?? 3;
  if (run.questions.length > maxQ) {
    findings.push({
      kind: "questions",
      message: `${run.questions.length} questions on the checklist (max ${maxQ}): ${run.questions.join(" · ")}`,
      confidence: s.expect.maxQuestionsConfidence ?? "verified-in-code",
      rationale: "Checklist contract: at most 3 questions (processes/checklist.golden.test.ts).",
    });
  }
  for (const t of run.userFacingText) {
    const m = CODE_LEAK_RE.exec(t.text);
    if (m) findings.push({ kind: "leak", key: t.where, message: `internal code "${m[0]}" in ${t.where}: "${t.text.slice(0, 120)}"`, confidence: "verified-in-code", rationale: "Default views show no codes (checklist.golden.test.ts)." });
  }
  // Same permit twice: an engine card plus an energy item that stands for the same document.
  const engineKeys = new Set(run.items.filter((i) => i.source === "engine").map((i) => i.key));
  for (const it of run.items) {
    if (it.source !== "process") continue;
    for (const d of it.legacyDocs) {
      if (engineKeys.has(d)) {
        findings.push({ kind: "duplicate", key: d, message: `${d} renders as its own card AND as energy item ${it.key}`, confidence: "verified-in-code", rationale: "One source of truth for energy items (processes/legacyCards.ts)." });
      }
    }
  }
  const counts = new Map<string, number>();
  for (const it of run.items) counts.set(it.key, (counts.get(it.key) ?? 0) + 1);
  for (const [k, n] of counts) if (n > 1) findings.push({ kind: "duplicate", key: k, message: `${k} appears ${n} times`, confidence: "verified-in-code", rationale: "Each requirement renders once." });
  for (const d of run.discardedModelFacts) {
    // A fixture problem, not an engine finding: the simulated model output must survive validation.
    if (d.reason === "unknown key" || d.reason === "missing confidence" || d.reason === "malformed entry") {
      findings.push({ kind: "harness", key: d.field, message: `fixture: model fact ${d.field} discarded (${d.reason})` });
    }
  }

  return {
    id: s.id,
    title: s.title,
    matrix: s.matrix,
    status: findings.length ? "fail" : "pass",
    findings,
    orderingSkipped,
    items: run.items.map(({ key, group, applicability, position, agency }) => ({ key, group, applicability, position, agency })),
    questions: run.questions,
    energyQuestionsUncapped: run.energyQuestionsUncapped,
    otherCheckQuestions: run.otherCheckQuestions,
    discardedModelFacts: run.discardedModelFacts,
  };
}

export function runAndEvaluate(scenario: KgScenario, geo?: Record<string, GeoContextFixture>): ScenarioResult {
  return evaluateKgScenario(runKgScenario(scenario, geo));
}

/** Fixture lint: every scenario is well-formed and every expectation is signed. */
export function lintScenario(s: KgScenario, geo: Record<string, GeoContextFixture>): string[] {
  const out: string[] = [];
  if (!/^KG\d{2}$/.test(s.id)) out.push(`${s.id}: id must look like KG01`);
  if (s.site && !geo[s.site.geo]) out.push(`${s.id}: unknown geo context ${s.site.geo}`);
  const all = [...s.expect.mustInclude, ...s.expect.mustNotInclude, ...(s.expect.ordering ?? [])];
  for (const e of all) {
    if (e.confidence !== "verified-in-code" && e.confidence !== "needs-expert-review") out.push(`${s.id}: bad confidence ${String(e.confidence)}`);
    if (!e.rationale || !e.rationale.trim()) out.push(`${s.id}: expectation without rationale`);
  }
  const docIds = new Set((KB.documents as Array<{ id: string }>).map((d) => d.id));
  const processIds = new Set(loadEnergyProcessGraph().processes.keys());
  const keyOk = (k: string) =>
    docIds.has(k) || (k.startsWith("process:") && processIds.has(k.slice(8))) || /^gap:[a-z0-9_]+$/.test(k);
  for (const e of [...s.expect.mustInclude, ...s.expect.mustNotInclude]) {
    for (const k of e.anyOf ?? (e.key ? [e.key] : [])) if (!keyOk(k)) out.push(`${s.id}: unknown key ${k}`);
  }
  for (const o of s.expect.ordering ?? []) for (const k of [o.before, o.after]) if (!keyOk(k)) out.push(`${s.id}: unknown ordering key ${k}`);
  return out;
}
