/**
 * Ask once, reuse forever, and only ask when needed.
 *
 * Every intake fact belongs to one tier:
 *
 *   required_now     decides the regulatory path — asked before requirements.
 *   useful_later     reusable Business Passport facts, captured progressively.
 *   filing_specific  what Clara needs to prepare or submit a specific filing;
 *                    asked by Clara only after checking Passport + project facts.
 *
 * A fact already known from the Business Passport, the description (scenario)
 * or an earlier answer is never asked again, in any form.
 */
import type { ProjectIntent } from "./projectIntent";
import { activityFamilies, applyScenarioAnswer, resolveBusinessTypes } from "./scenario/graph";
import { cloneScenario, isConfirmed, type ScenarioContext, type ScenarioFact } from "./scenario/types";
import type { KnowledgeBase } from "../../rulesEngine";

export type InfoTier = "required_now" | "useful_later" | "filing_specific";

export type IntakeFieldKey =
  | "municipality"
  | "business_type"
  | "location_type"
  | "industry"
  | "name"
  | "business_structure"
  | "number_of_employees";

export type KnownFrom = "passport" | "description" | "user";

export interface IntakeProfileLike {
  name?: string | null;
  municipality?: string | null;
  industry?: string | null;
  business_type?: string | null;
  location_type?: string | null;
  business_structure?: string | null;
  number_of_employees?: number | null;
}

export interface IntakeFieldPlan {
  key: IntakeFieldKey;
  tier: InfoTier;
  known: boolean;
  knownFrom: KnownFrom | null;
  /** Render the field at all (false = known elsewhere, or not this branch's business). */
  show: boolean;
}

export interface IntakePlan {
  fields: IntakeFieldPlan[];
  /** Required-now facts still unknown — the only ones that block requirements. */
  missingRequired: IntakeFieldKey[];
  ready: boolean;
}

const has = (v: unknown) => (typeof v === "number" ? Number.isFinite(v) : typeof v === "string" ? v.trim() !== "" : v != null);

/** The tier a field belongs to on a given branch; null = not part of this branch. */
export function tierOf(key: IntakeFieldKey, intent: ProjectIntent | null): InfoTier | null {
  const projectOnly = intent === "project_only";
  switch (key) {
    case "municipality":
      return "required_now";
    case "business_type":
    case "location_type":
      // A property/project needs no business to discover requirements.
      return projectOnly ? null : "required_now";
    case "industry":
      // Derived from the business type; only a filter for the type list.
      return projectOnly ? null : "useful_later";
    case "name":
    case "number_of_employees":
      return projectOnly && key === "number_of_employees" ? null : "useful_later";
    case "business_structure":
      // Needed by the formation filing (Dept. of State), not to find the path.
      return projectOnly ? null : "filing_specific";
  }
}

const ORDER: IntakeFieldKey[] = [
  "municipality",
  "industry",
  "business_type",
  "location_type",
  "name",
  "business_structure",
  "number_of_employees",
];

/**
 * Which fields to show, and whether requirements can be generated.
 *
 * `passportKnown` — fields the linked Business Passport answers (existing
 * business only). `descriptionKnown` — fields the description established.
 * A known field is hidden when it came from the Passport; a description fact
 * stays visible (prefilled) so it can be corrected, but is never re-asked.
 */
export function planIntake(input: {
  intent: ProjectIntent | null;
  profile: IntakeProfileLike;
  passportKnown?: ReadonlySet<string>;
  descriptionKnown?: ReadonlySet<string>;
}): IntakePlan {
  const { intent, profile } = input;
  const passportKnown = input.passportKnown ?? new Set<string>();
  const descriptionKnown = input.descriptionKnown ?? new Set<string>();
  const fields: IntakeFieldPlan[] = [];
  for (const key of ORDER) {
    const tier = tierOf(key, intent);
    if (!tier) continue;
    const value = (profile as Record<string, unknown>)[key];
    const fromPassport = passportKnown.has(key);
    const known = fromPassport || has(value);
    const knownFrom: KnownFrom | null = fromPassport ? "passport" : !has(value) ? null : descriptionKnown.has(key) ? "description" : "user";
    fields.push({ key, tier, known, knownFrom, show: !fromPassport });
  }
  const missingRequired = fields.filter((f) => f.tier === "required_now" && !f.known).map((f) => f.key);
  return { fields, missingRequired, ready: missingRequired.length === 0 };
}

// ---------------------------------------------------------------------------
// Facts the description already established — so the form never re-asks them
// ---------------------------------------------------------------------------

const PHYSICAL_BY_FAMILY: [string, string][] = [
  ["food", "Restaurant / Food Service Location"],
  ["industrial", "Industrial Facility"],
  ["storage", "Warehouse"],
  ["retail", "Retail Storefront"],
  ["office", "Commercial Office"],
];

const NON_PREMISES = /online|remote|home|mobile|food truck/i;

/**
 * The location type the scenario implies, when it places the operation in a
 * physical, non-residential property (an existing building, a lease, a deed,
 * a renovation, an address). Picks the option matching the use, else the
 * first physical option the business type allows. Null when the description
 * does not establish premises — then the user is asked.
 */
export function locationTypeFromScenario(ctx: ScenarioContext | null, allowed: readonly string[]): string | null {
  if (!ctx) return null;
  const p = ctx.property;
  const pr = ctx.project;
  const premises =
    p.existingBuilding?.value === true ||
    p.ownershipStatus?.value === "owned" ||
    p.ownershipStatus?.value === "leased" ||
    !!p.address ||
    !!p.parcel ||
    pr.renovation?.value === true ||
    !!pr.type?.value?.includes("new_construction");
  if (!premises) return null;
  const uses = [ctx.operations.activity?.value, p.proposedUse?.value, p.existingUse?.value].filter((u): u is string => !!u);
  if (uses.some((u) => activityFamilies(u).includes("residential"))) return null;
  const physical = allowed.filter((o) => !NON_PREMISES.test(o));
  if (physical.length === 0) return null;
  for (const use of uses) {
    const fams = activityFamilies(use) as string[];
    for (const [fam, label] of PHYSICAL_BY_FAMILY) {
      if (fams.includes(fam) && physical.includes(label)) return label;
    }
  }
  return physical[0];
}

/** The single KB business type the scenario's activity resolves to, if exactly one. */
export function businessTypeFromScenario(ctx: ScenarioContext | null, kb: KnowledgeBase): string | null {
  const a = ctx?.operations.activity;
  if (!a || ctx?.property.proposedUseSpecificity?.value === "insufficient") return null;
  const hits = resolveBusinessTypes(a.value, kb);
  return hits.length === 1 ? hits[0].name : null;
}

/**
 * Guided-question answers the description STATES (never inferences), keyed by
 * the intake's answer keys. The guided flow treats these as answered from the
 * description, so "12 employees" is never followed by "Will employees be hired?".
 */
export function scenarioStatedAnswers(ctx: ScenarioContext | null): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!ctx) return out;
  const stated = (f: ScenarioFact<unknown> | undefined) => !!f && isConfirmed(f);
  const tenure = ctx.property.ownershipStatus;
  if (stated(tenure) && tenure!.value === "owned") {
    out.owns_property = true;
    out.existing_lease = false;
  }
  if (stated(tenure) && tenure!.value === "leased") {
    out.owns_property = false;
    out.existing_lease = true;
  }
  if (stated(ctx.project.renovation) && typeof ctx.project.renovation!.value === "boolean") out.renovations = ctx.project.renovation!.value;
  const staff = ctx.operations.employees;
  if (stated(staff) && typeof staff!.value === "number") out.employees_hired = staff!.value > 0;
  const activity = ctx.operations.activity;
  if (stated(activity)) {
    const fam = activityFamilies(activity!.value);
    if (fam.includes("childcare")) out.children_present = true;
    if (fam.includes("industrial")) out.products_manufactured = true;
  }
  if (stated(ctx.operations.foodService) && ctx.operations.foodService!.value === true) out.food_prepared_on_site = true;
  return out;
}

/**
 * Form facts the user entered go back into the scenario, so the scenario
 * questions never ask them again: a business type picked from the dropdown
 * answers "what operation will this be?", a municipality answers where.
 */
export function withFormFacts(
  ctx: ScenarioContext,
  form: { business_type?: string | null; municipality?: string | null },
  kb: KnowledgeBase
): ScenarioContext {
  let out = ctx;
  const bt = form.business_type?.trim();
  if (bt) {
    const current = businessTypeFromScenario(ctx, kb);
    if (current?.toLowerCase() !== bt.toLowerCase()) out = applyScenarioAnswer(out, "sq_activity", bt);
  }
  const muni = form.municipality?.trim();
  if (muni && !out.property.municipality) {
    out = cloneScenario(out);
    out.property.municipality = { value: muni, source: "explicit", confidence: 1, evidenceText: muni };
  }
  return out;
}
