/**
 * Scenario → knowledge graph.
 *
 * Given the factual model of the situation, ask the KB: which of your rules
 * does this scenario reach, and which unresolved facts stand between a rule
 * and a decision? Every path returned here is a KB rule's document — the
 * agency and name come from the KB, never from this file or the model.
 *
 *   likely     the rule's trigger is satisfied by stated / on-file facts
 *   potential  the rule is reachable but hinges on an unknown or an
 *              unconfirmed inference (the path names what it needs)
 *
 * Controlling facts are the unknowns that sit on those hinges. Questions are
 * generated from them in dependency order: the activity first (it selects
 * the business-type branch of the graph), and only once it is known the
 * facts that the chosen branch actually reads — authorized use and change of
 * use, the property location, construction scope, site circulation,
 * environmental equipment. Nothing is asked that no reachable rule reads.
 */
import type { KnowledgeBase, KBRule } from "../../../rulesEngine";
import type { PassportSnapshot } from "./passport";
import {
  businessStatus,
  changeOfUseStatus,
  cloneScenario,
  isConfirmed,
  type ScenarioContext,
  type ScenarioFact,
  type ScenarioPath,
} from "./types";
import { familiesOf, matchUse, matchUses, findUseByLabel, displayOfUse, usesDiffer, type UseFamily } from "./uses";

/** Occupancy families of an activity (a use label or the user's own words). */
export function activityFamilies(value: string): UseFamily[] {
  const known = familiesOf(value);
  if (known.length) return known;
  return matchUses(value.replace(/_/g, " ")).filter((u) => !u.generic).map((u) => u.family);
}

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface RegulatoryPath {
  documentId: string;
  name: string;
  agency: string;
  status: "likely" | "potential";
  /** Why the graph reaches this document from the scenario. */
  because: string;
  /** For potential paths: the unresolved fact(s) it hinges on. */
  needs?: string[];
  ruleIds: string[];
}

export type ControllingFactId =
  | "activity"
  | "business_status"
  | "authorized_use"
  | "change_of_use"
  | "location"
  | "structural_exterior"
  | "footprint"
  | "site_circulation"
  | "environmental";

export interface ControllingFact {
  id: ControllingFactId;
  label: string;
  /** Scenario paths this fact resolves. */
  paths: ScenarioPath[];
  /** The graph branch that reads it. */
  branch: string;
}

export interface ScenarioQuestionOption {
  value: string;
  label: string;
}

export interface ScenarioQuestion {
  id: `sq_${ControllingFactId}`;
  controls: ControllingFactId;
  text: string;
  whyWeAsk: string;
  kind: "choice" | "boolean" | "text" | "multi";
  options?: ScenarioQuestionOption[];
  placeholder?: string;
}

export interface ScenarioEvaluation {
  /** Active graph branches (stable ids, useful for tests / debugging). */
  branches: string[];
  likely: RegulatoryPath[];
  potential: RegulatoryPath[];
  /** Every controlling unknown on a reachable branch, in dependency order. */
  controlling: ControllingFact[];
  /** Only the questions whose preconditions are met — ask these now. */
  questions: ScenarioQuestion[];
  /** KB business types the activity resolved to. */
  businessTypes: { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Activity → KB business types
// ---------------------------------------------------------------------------

/** Use label → KB business-type names (checked against the live KB). */
const ACTIVITY_BUSINESS_TYPES: Record<string, string[]> = {
  daycare: ["Daycare"],
  warehouse: ["Warehouse Operator", "Warehouse Distributor"],
  restaurant: ["Restaurant"],
  clinic: ["Medical Office"],
  school: ["Private School"],
  lodging: ["Hotel"],
  automotive: ["Auto Repair Shop"],
};

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}

/**
 * Activity → KB business types. The most specific reading wins: an exact
 * business-type name ("furniture manufacturing"), then the use vocabulary's
 * mapping ("daycare" → Daycare), then business types whose names contain
 * every word. A broad activity ("manufacturing") can match many — the caller
 * treats more than MAX_SPECIFIC matches as "activity not specific enough".
 */
export const MAX_SPECIFIC = 2;
export function resolveBusinessTypes(activity: string | undefined, kb: KnowledgeBase): { id: string; name: string }[] {
  if (!activity) return [];
  const byName = new Map(kb.businessTypes.map((b) => [b.name.toLowerCase(), b]));
  const phrase = activity.replace(/_/g, " ").toLowerCase().trim();
  const exact = byName.get(phrase);
  if (exact) return [{ id: exact.id, name: exact.name }];
  const use = findUseByLabel(activity) ?? matchUse(phrase);
  if (use?.generic) return [];
  // Every word of the activity appears in the business-type name.
  const w = words(phrase);
  const hits = w.length
    ? kb.businessTypes.filter((b) => {
        const bw = words(b.name);
        return w.every((x) => bw.some((y) => y.startsWith(x.replace(/ing$/, "")) || x.startsWith(y)));
      })
    : [];
  if (hits.length && hits.length <= MAX_SPECIFIC) return hits.map((b) => ({ id: b.id, name: b.name }));
  const mapped = use ? ACTIVITY_BUSINESS_TYPES[use.label] : undefined;
  if (mapped) {
    const found = mapped.map((n) => byName.get(n.toLowerCase())).filter((b): b is NonNullable<typeof b> => !!b);
    if (found.length) return found.map((b) => ({ id: b.id, name: b.name }));
  }
  return hits.slice(0, 12).map((b) => ({ id: b.id, name: b.name }));
}

// ---------------------------------------------------------------------------
// Scenario → KB question answers (only what the scenario actually establishes)
// ---------------------------------------------------------------------------

type Grade = "stated" | "inferred";

interface QAnswer {
  value: true;
  grade: Grade;
  because: string;
}

const gradeOf = (f: ScenarioFact<unknown> | undefined): Grade => (isConfirmed(f) ? "stated" : "inferred");

function scenarioQuestionAnswers(ctx: ScenarioContext): Record<string, QAnswer> {
  const out: Record<string, QAnswer> = {};
  const activity = ctx.operations.activity;
  const fam = activity ? activityFamilies(activity.value) : [];
  const proposed = ctx.property.proposedUse;
  const residential = (proposed && activityFamilies(proposed.value).includes("residential")) || fam.includes("residential");
  const specific = ctx.property.proposedUseSpecificity?.value === "specific";

  // An operation occupying non-residential premises. A vague proposed use
  // ("a new commercial operation") reaches the same rule only as potential —
  // see evaluateScenario.
  if (proposed && specific && !residential) {
    out.Q_PHYSICAL_LOCATION = { value: true, grade: gradeOf(proposed), because: `An operation will occupy the ${ctx.property.existingUse ? displayOfUse(ctx.property.existingUse.value).toLowerCase() + " " : ""}property` };
  }
  if (fam.includes("childcare")) out.Q_CHILDREN_PRESENT = { value: true, grade: gradeOf(activity), because: "A daycare has children on site" };
  if (fam.includes("industrial")) out.Q_PRODUCTS_MANUFACTURED = { value: true, grade: gradeOf(activity), because: "Products will be manufactured on site" };
  if (ctx.operations.foodService?.value === true || fam.includes("food")) {
    out.Q_FOOD_PREPARED = { value: true, grade: gradeOf(ctx.operations.foodService ?? activity), because: "Food will be prepared on site" };
  }
  const staff = ctx.operations.employees?.value;
  if (typeof staff === "number" && staff > 0) out.Q_EMPLOYEES_HIRED = { value: true, grade: gradeOf(ctx.operations.employees), because: `${staff} employees` };
  return out;
}

/** Project facts in the engine's vocabulary (project_fact rules). */
function scenarioProjectFacts(ctx: ScenarioContext): Record<string, { value: unknown; grade: Grade }> {
  const out: Record<string, { value: unknown; grade: Grade }> = {};
  const p = ctx.project;
  const put = (key: string, f: ScenarioFact<unknown> | undefined, value = f?.value) => {
    if (f && value !== undefined) out[key] = { value, grade: gradeOf(f) };
  };
  if (p.type?.value.includes("new_construction")) put("project_type", p.type, "new_construction");
  else if (p.renovation?.value) put("project_type", p.renovation, "renovation");
  put("structural_work", p.structuralWork);
  put("property_tenure", ctx.property.ownershipStatus);
  return out;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const FORMATION_DOCS = new Set(["DOC_CERT_INCORPORATION", "DOC_CERT_ORGANIZATION", "DOC_EIN"]);
const ENV_KEYS: Record<string, keyof ScenarioContext["operations"]> = {
  air_emissions: "emissionsEquipment",
  wastewater_discharge_route: "wastewaterDischarge",
  hazardous_waste_generation: "hazardousMaterials",
  used_oil_generation: "hazardousMaterials",
};

function ruleMatches(expected: string | null | undefined, value: unknown): boolean {
  if (expected === null || expected === undefined || expected === "true") return value === true || value === "true";
  return String(value).toLowerCase() === String(expected).toLowerCase();
}

export function evaluateScenario(
  ctx: ScenarioContext,
  kb: KnowledgeBase,
  opts: { passport?: PassportSnapshot | null; skip?: Iterable<string> } = {}
): ScenarioEvaluation {
  const docs = new Map(kb.documents.map((d) => [d.id, d]));
  const paths = new Map<string, RegulatoryPath>();
  const branches = new Set<string>();
  const skip = new Set(opts.skip ?? []);

  const add = (rule: KBRule, status: "likely" | "potential", because: string, needs?: string[]) => {
    const doc = docs.get(rule.requires_document_id);
    if (!doc) return;
    const prev = paths.get(doc.id);
    if (prev) {
      if (!prev.ruleIds.includes(rule.id)) prev.ruleIds.push(rule.id);
      if (prev.status === "potential" && status === "likely") {
        prev.status = "likely";
        prev.because = because;
        delete prev.needs;
      } else if (prev.status === "potential" && needs) {
        prev.needs = [...new Set([...(prev.needs ?? []), ...needs])];
      }
      return;
    }
    paths.set(doc.id, {
      documentId: doc.id,
      name: doc.name,
      agency: (rule as KBRule & { agency?: string }).agency ?? doc.agency,
      status,
      because,
      ...(needs ? { needs } : {}),
      ruleIds: [rule.id],
    });
  };

  const status = businessStatus(ctx);
  const statusGrade = ctx.business.status ? gradeOf(ctx.business.status) : null;
  const municipality = ctx.property.municipality?.value;
  const muniFlags = new Set(kb.municipalities.find((m) => m.name.toLowerCase() === municipality?.toLowerCase())?.flags ?? []);
  const activity = ctx.operations.activity;
  const proposed = ctx.property.proposedUse;
  const activityKnown = !!activity && ctx.property.proposedUseSpecificity?.value !== "insufficient";
  const businessTypes = activityKnown ? resolveBusinessTypes(activity!.value, kb) : [];
  // A broad activity ("manufacturing") reaches several business types: the
  // graph can't pick a branch yet, so the exact activity is controlling.
  const activityAmbiguous = businessTypes.length > MAX_SPECIFIC;
  const change = changeOfUseStatus(ctx);
  const existingBuilding = ctx.property.existingBuilding?.value === true;

  // 1. Project-fact rules (construction permit, lease / deed).
  const pf = scenarioProjectFacts(ctx);
  for (const rule of kb.rules.filter((r) => r.rule_type === "project_fact")) {
    const fact = rule.fact_key ? pf[rule.fact_key] : undefined;
    if (!fact || !ruleMatches(rule.expected_answer, fact.value)) continue;
    const because =
      rule.fact_key === "property_tenure"
        ? `The property is ${String(fact.value)}`
        : rule.fact_key === "structural_work"
          ? "Structural work is planned"
          : `The project is a ${String(fact.value).replace(/_/g, " ")}`;
    if (fact.grade === "stated") add(rule, "likely", because);
    else add(rule, "potential", `${because} (not yet confirmed)`, ["Confirm the project scope"]);
    branches.add(rule.fact_key === "property_tenure" ? `tenure:${String(fact.value)}` : "construction");
  }

  // 2. Question-trigger rules the scenario establishes.
  const qa = scenarioQuestionAnswers(ctx);
  for (const rule of kb.rules.filter((r) => r.rule_type === "question_trigger")) {
    const a = rule.question_id ? qa[rule.question_id] : undefined;
    if (!a || !ruleMatches(rule.expected_answer, a.value)) continue;
    const missing = rule.missing_fact_keys ?? [];
    const needs = missing.length ? missing.map((k) => k.replace(/_/g, " ")) : undefined;
    if (a.grade === "stated" && !needs) add(rule, "likely", a.because);
    else add(rule, "potential", a.because, needs ?? ["Confirm the proposed activity"]);
  }
  if (qa.Q_PHYSICAL_LOCATION) {
    branches.add(
      change === "confirmed" ? "use_authorization:change_of_use" : change === "none" ? "use_authorization:same_use" : "use_authorization:use_unresolved"
    );
  }
  // A proposed use that is still too vague: the use authorization is reachable
  // but hinges on the activity.
  if (proposed && !activityKnown) {
    for (const rule of kb.rules.filter((r) => r.rule_type === "question_trigger" && r.question_id === "Q_PHYSICAL_LOCATION")) {
      add(rule, "potential", "A commercial operation will occupy the property", ["Type of commercial operation"]);
    }
  }

  // 3. Business-type rules for the resolved activity.
  if (businessTypes.length && !activityAmbiguous) {
    branches.add(`activity:${businessTypes.map((b) => b.id).join("+")}`);
    const ids = new Set(businessTypes.map((b) => b.id));
    const btRules = kb.rules.filter((r) => r.business_type_id && ids.has(r.business_type_id) && (r.rule_type === "business_type" || r.rule_type === "municipality_flag"));
    // Documents every candidate business type requires are likely; ones only
    // some candidates require hinge on the exact activity.
    const docCount = new Map<string, Set<string>>();
    for (const r of btRules) {
      if (!docCount.has(r.requires_document_id)) docCount.set(r.requires_document_id, new Set());
      docCount.get(r.requires_document_id)!.add(r.business_type_id!);
    }
    for (const rule of btRules) {
      if (status === "existing" && rule.requires_new_unformed_business) continue;
      if (rule.municipality_flag && !muniFlags.has(rule.municipality_flag)) {
        if (!rule.missing_fact_keys?.length) continue; // flag-gated and this municipality lacks it
      }
      const btName = businessTypes.find((b) => b.id === rule.business_type_id)?.name ?? "this activity";
      const envKeys = (rule.missing_fact_keys ?? []).filter((k) => ENV_KEYS[k]);
      if (envKeys.length) {
        const facts = envKeys.map((k) => ctx.operations[ENV_KEYS[k]]);
        if (facts.some((f) => f?.value === false && isConfirmed(f)) && !facts.some((f) => f?.value === true)) continue;
        if (facts.some((f) => f?.value === true && isConfirmed(f))) add(rule, "likely", `${btName} with ${envKeys.map((k) => k.replace(/_/g, " ")).join(", ")}`);
        else add(rule, "potential", `${btName} activity`, envKeys.map((k) => k.replace(/_/g, " ")));
        branches.add("environmental");
        continue;
      }
      if (rule.missing_fact_keys?.length) {
        add(rule, "potential", `${btName} activity`, rule.missing_fact_keys.map((k) => k.replace(/_/g, " ")));
        continue;
      }
      const common = (docCount.get(rule.requires_document_id)?.size ?? 0) === businessTypes.length;
      if (common && gradeOf(activity) === "stated") add(rule, "likely", `${btName} activity`);
      else add(rule, "potential", `${btName} activity`, ["The exact activity"]);
    }
  }

  // 4. Business-wide obligations (formation, registration, municipal license).
  //    unknown status  → none listed; "existing or new" is a controlling fact.
  //    existing        → the business already carries them; only a municipal
  //                      license for a location in another municipality is new.
  //    new             → formation / registration as the KB rules say.
  const general = kb.rules.filter((r) => r.rule_type === "municipality");
  const entityType = ctx.business.entityType?.value?.toLowerCase();
  if (status === "existing") {
    for (const rule of general.filter((r) => r.requires_document_id === "DOC_PATENTE_MUNICIPAL" && !r.municipality_flag)) {
      const home = opts.passport?.municipality;
      if (!municipality) continue;
      if (home && municipality.toLowerCase() === home.toLowerCase()) continue;
      add(rule, "likely", `New operating location in ${municipality}`);
      branches.add("new_location");
    }
  } else if (status === "new") {
    branches.add("formation");
    for (const rule of general) {
      if (rule.municipality_flag && !muniFlags.has(rule.municipality_flag)) continue;
      const excluded = Array.isArray(rule.excluded_entity_types) ? rule.excluded_entity_types.map(String) : [];
      if (entityType && excluded.some((e) => entityType.includes(e) || e.includes(entityType))) continue;
      if ((rule.requires_new_unformed_business || FORMATION_DOCS.has(rule.requires_document_id)) && !entityType && excluded.length) {
        add(rule, "potential", "New business being formed", ["Entity type"]);
      } else if (statusGrade === "stated") {
        add(rule, "likely", "New business being formed");
      } else {
        add(rule, "potential", "New business being formed (not yet confirmed)", ["Existing or new business"]);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Controlling facts and questions
  // -------------------------------------------------------------------------
  const controlling: ControllingFact[] = [];
  const questions: ScenarioQuestion[] = [];
  const ask = (q: ScenarioQuestion) => {
    if (!skip.has(q.id)) questions.push(q);
  };
  const constructionActive = branches.has("construction") || ctx.project.renovation?.value === true;
  const useBranchActive = !!qa.Q_PHYSICAL_LOCATION || (!!proposed && !activityKnown);
  const envRelevant =
    branches.has("environmental") ||
    // The activity family has environmental rules in the KB, but the exact
    // business type isn't resolved yet.
    ((businessTypes.length === 0 || activityAmbiguous) && activity
      ? activityFamilies(activity.value).some((f: UseFamily) => f === "industrial" || f === "automotive")
      : false);

  // Tier 1 — the activity selects the business-type branch of the graph.
  const activityUnresolved = !activityKnown && (!!proposed || status !== "unknown" || existingBuilding || constructionActive);
  if (activityUnresolved) {
    controlling.push({ id: "activity", label: "Type of commercial operation", paths: ["property.proposedUse", "operations.activity"], branch: "activity" });
    ask({
      id: "sq_activity",
      controls: "activity",
      kind: "text",
      text: existingBuilding || ctx.property.existingUse
        ? "What type of commercial operation will occupy this facility?"
        : "What type of operation will this be?",
      whyWeAsk:
        "The activity decides which business-type rules, use authorizations and safety certifications apply. Everything else SmartPR asks depends on it.",
      placeholder: "e.g. furniture manufacturing, daycare, food distribution",
    });
  }
  if (activityKnown && activityAmbiguous) {
    controlling.push({ id: "activity", label: "Exact activity", paths: ["operations.activity"], branch: "activity" });
    ask({
      id: "sq_activity",
      controls: "activity",
      kind: "text",
      text: `What exactly will the ${displayOfUse(activity!.value).toLowerCase()} operation do?`,
      whyWeAsk: `"${displayOfUse(activity!.value)}" matches ${businessTypes.length} different business types in SmartPR's knowledge graph with different permits (for example ${businessTypes.slice(0, 3).map((b) => b.name).join(", ")}).`,
      placeholder: businessTypes.slice(0, 3).map((b) => b.name.toLowerCase()).join(", "),
    });
  }
  if (status === "unknown") {
    controlling.push({ id: "business_status", label: "Existing business or a new one being formed", paths: ["business.status"], branch: "formation" });
  }

  // Tier 2 — only once the activity is known.
  const tier2 = activityKnown && !activityAmbiguous;
  const authorizedUseMatters = existingBuilding && change !== "none" && !ctx.property.authorizedUse;
  if (authorizedUseMatters) {
    controlling.push({ id: "authorized_use", label: "Current authorized use of the property", paths: ["property.authorizedUse"], branch: "use_authorization" });
    if (tier2) {
      const ex = ctx.property.existingUse?.value;
      ask({
        id: "sq_authorized_use",
        controls: "authorized_use",
        kind: "choice",
        text: "What is the property's currently authorized use?",
        whyWeAsk: "The use the property is authorized for today, compared with the new activity, decides whether a change-of-use authorization is needed.",
        options: [
          ...(ex ? [{ value: ex, label: displayOfUse(ex) }] : []),
          { value: "other", label: "Something else" },
          { value: "unknown", label: "Not sure" },
        ],
      });
    }
  }
  if (change === "possible" || (change === "unknown" && existingBuilding)) {
    controlling.push({ id: "change_of_use", label: "Whether the use or occupancy changes", paths: ["project.possibleChangeOfUse"], branch: "use_authorization" });
    if (tier2 && !authorizedUseMatters) {
      ask({
        id: "sq_change_of_use",
        controls: "change_of_use",
        kind: "boolean",
        text: "Will the proposed activity change the property's authorized use or occupancy?",
        whyWeAsk: "A change of use or occupancy routes the project through a use authorization in addition to the construction work.",
      });
    }
  }
  if (useBranchActive && !ctx.property.address && !ctx.property.parcel) {
    controlling.push({ id: "location", label: "Physical property location", paths: ["property.address", "property.parcel"], branch: "use_authorization" });
    if (tier2 && !questions.some((q) => q.controls === "authorized_use" || q.controls === "change_of_use")) {
      ask({
        id: "sq_location",
        controls: "location",
        kind: "text",
        text: "What is the physical address or parcel (catastro) number?",
        whyWeAsk: "Use authorizations are issued for a specific property; zoning and flood designations come from its location.",
        placeholder: "e.g. 123 Calle Principal, Guaynabo or catastro 123-456-789-01",
      });
    }
  }
  if (constructionActive) {
    const s = ctx.project.structuralWork;
    const e = ctx.project.exteriorWork;
    if (!s || !e) {
      controlling.push({ id: "structural_exterior", label: "Structural or exterior work", paths: ["project.structuralWork", "project.exteriorWork"], branch: "construction" });
      if (tier2) {
        ask({
          id: "sq_structural_exterior",
          controls: "structural_exterior",
          kind: "choice",
          text: "Will there be structural or exterior work?",
          whyWeAsk: "Structural and exterior work change the construction permit's scope and who must certify the plans.",
          options: [
            { value: "neither", label: "Neither — interior only" },
            { value: "structural", label: "Structural work" },
            { value: "exterior", label: "Exterior work" },
            { value: "both", label: "Both" },
          ],
        });
      }
    }
    const interiorOnly = e?.value === false && s?.value === false;
    if (!ctx.project.footprintChange && !interiorOnly) {
      controlling.push({ id: "footprint", label: "Building footprint change", paths: ["project.footprintChange"], branch: "construction" });
      if (tier2 && e !== undefined && s !== undefined) {
        ask({
          id: "sq_footprint",
          controls: "footprint",
          kind: "boolean",
          text: "Will the building footprint change?",
          whyWeAsk: "Adding floor area or changing the footprint brings site and zoning review into the construction permit.",
        });
      }
    }
    const outward = e?.value === true || ctx.project.footprintChange?.value === true || change === "confirmed";
    if (outward && !ctx.project.siteCirculationChanges) {
      controlling.push({ id: "site_circulation", label: "Parking, loading, access or site circulation", paths: ["project.siteCirculationChanges"], branch: "construction" });
      if (tier2) {
        ask({
          id: "sq_site_circulation",
          controls: "site_circulation",
          kind: "boolean",
          text: "Will parking, loading, access, or site circulation change?",
          whyWeAsk: "Site changes and new occupancies can bring parking, access and traffic review into the approval.",
        });
      }
    }
  }
  if (tier2 && envRelevant) {
    const o = ctx.operations;
    const envFacts = [o.generator, o.fuelStorage, o.emissionsEquipment, o.hazardousMaterials, o.wastewaterDischarge];
    if (envFacts.some((f) => f === undefined)) {
      controlling.push({
        id: "environmental",
        label: "Generator, fuel, emissions, hazardous materials or wastewater",
        paths: ["operations.generator", "operations.fuelStorage", "operations.emissionsEquipment", "operations.hazardousMaterials", "operations.wastewaterDischarge"],
        branch: "environmental",
      });
      ask({
        id: "sq_environmental",
        controls: "environmental",
        kind: "multi",
        text: "Will the operation involve any of these?",
        whyWeAsk: "For this activity the knowledge graph has air, water and hazardous-waste rules that turn on exactly these facts.",
        options: [
          { value: "generator", label: "Generator" },
          { value: "fuelStorage", label: "Fuel storage" },
          { value: "emissionsEquipment", label: "Emissions-producing equipment" },
          { value: "hazardousMaterials", label: "Hazardous materials" },
          { value: "wastewaterDischarge", label: "Wastewater discharge" },
        ],
      });
    }
  }

  const all = [...paths.values()];
  return {
    branches: [...branches].sort(),
    likely: all.filter((p) => p.status === "likely"),
    potential: all.filter((p) => p.status === "potential"),
    controlling,
    questions,
    businessTypes,
  };
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const answered = <T>(value: T, what: string): ScenarioFact<T> => ({
  value,
  source: "explicit",
  confidence: 1,
  evidenceText: `Answered: ${what}`,
});

/** Apply an answer to a scenario question. Returns a new context. */
export function applyScenarioAnswer(
  ctx: ScenarioContext,
  questionId: string,
  answer: string | boolean | string[]
): ScenarioContext {
  const out = cloneScenario(ctx);
  switch (questionId) {
    case "sq_activity": {
      const text = String(answer).trim();
      if (!text) return out;
      const use = matchUse(text);
      if (use?.generic) return out;
      // The use label drives occupancy reasoning; the user's own words stay as
      // the activity so "furniture manufacturing" resolves more precisely
      // than "manufacturing".
      const label = use ? use.label : text.toLowerCase();
      const activityWords = text.toLowerCase().replace(/[^a-z0-9\s&/-]/g, "").trim();
      out.property.proposedUse = answered(label, text);
      out.property.proposedUseSpecificity = answered("specific" as const, text);
      out.operations.activity = answered(activityWords || label, text);
      out.business.proposedActivity = answered(activityWords || label, text);
      const ex = out.property.existingUse?.value;
      if (ex && !isConfirmed(out.project.possibleChangeOfUse)) {
        const differ = usesDiffer(ex, label);
        if (differ !== null) {
          out.project.possibleChangeOfUse = { value: differ, source: "inferred", confidence: differ ? 0.78 : 0.7, evidenceText: `Existing use ${displayOfUse(ex)} → ${text}` };
        }
      }
      return out;
    }
    case "sq_authorized_use": {
      const v = String(answer);
      if (v === "unknown" || v === "other" || !v) return out;
      out.property.authorizedUse = answered(v, displayOfUse(v));
      const activity = out.operations.activity?.value;
      if (activity && !isConfirmed(out.project.possibleChangeOfUse)) {
        const differ = usesDiffer(v, activity);
        if (differ !== null) {
          out.project.possibleChangeOfUse = { value: differ, source: "inferred", confidence: 0.8, evidenceText: `Authorized for ${displayOfUse(v)}; proposed ${displayOfUse(activity)}` };
        }
      }
      return out;
    }
    case "sq_change_of_use":
      if (typeof answer === "boolean") out.project.possibleChangeOfUse = answered(answer, answer ? "the use changes" : "the use stays the same");
      return out;
    case "sq_location": {
      const text = String(answer).trim();
      if (!text) return out;
      const parcel = /^\s*(?:catastro\s*)?(\d[\d-]{6,})\s*$/i.exec(text);
      if (parcel) out.property.parcel = answered(parcel[1], text);
      else out.property.address = answered(text, text);
      return out;
    }
    case "sq_structural_exterior": {
      const v = String(answer);
      out.project.structuralWork = answered(v === "structural" || v === "both", v);
      out.project.exteriorWork = answered(v === "exterior" || v === "both", v);
      return out;
    }
    case "sq_footprint":
      if (typeof answer === "boolean") out.project.footprintChange = answered(answer, answer ? "footprint changes" : "footprint unchanged");
      return out;
    case "sq_site_circulation":
      if (typeof answer === "boolean") out.project.siteCirculationChanges = answered(answer, answer ? "site circulation changes" : "no site changes");
      return out;
    case "sq_environmental": {
      const chosen = new Set(Array.isArray(answer) ? answer : []);
      for (const key of ["generator", "fuelStorage", "emissionsEquipment", "hazardousMaterials", "wastewaterDischarge"] as const) {
        out.operations[key] = answered(chosen.has(key), chosen.has(key) ? key : `no ${key}`);
      }
      return out;
    }
    default:
      return out;
  }
}
