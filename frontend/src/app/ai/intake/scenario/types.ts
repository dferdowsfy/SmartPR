/**
 * Scenario context — SmartPR's factual model of the user's situation.
 *
 * The intake reads a free-text description the way an experienced Puerto Rico
 * permitting intake specialist would: who is doing what, where, to which
 * property, and with what relationship between those facts. Each fact is a
 * `ScenarioFact` that records where it came from and how sure we are, so an
 * inference is never presented as something the user said.
 *
 *   explicit           the user stated it
 *   inferred           strongly implied by the scenario as a whole — shown
 *                      under "Needs confirmation", never as a confirmed chip
 *   existing_passport  already on file in the linked Business Passport
 *
 * An absent fact is UNKNOWN. Nothing is defaulted. Whether an unknown is
 * "controlling" (could change permits, agencies, prerequisites) is decided by
 * the knowledge graph in ./graph.ts, not here.
 *
 * This model never names a permit. Requirements come only from the KB rules.
 */

export type FactSource = "explicit" | "inferred" | "existing_passport";

export interface ScenarioFact<T> {
  value: T;
  source: FactSource;
  /** 0–1. Explicit statements ≥ 0.85; inferences 0.60–0.84. */
  confidence: number;
  /** Verbatim quote from the description (or the answer/passport it came from). */
  evidenceText: string;
}

export type F<T> = ScenarioFact<T> | undefined;

export type BusinessStatus = "existing" | "new" | "unknown";
export type OwnershipStatus = "owned" | "leased" | "unknown";
export type DemolitionScope = "none" | "interior" | "partial" | "full" | "unknown";
export type UseSpecificity = "specific" | "insufficient";

export interface ScenarioContext {
  business: {
    /** existing | new. Absent = unknown (never defaulted). */
    status?: F<Exclude<BusinessStatus, "unknown">>;
    entityId?: F<string>;
    name?: F<string>;
    entityType?: F<string>;
    industry?: F<string>;
    /** What the business will do at this project/location. */
    proposedActivity?: F<string>;
  };
  property: {
    municipality?: F<string>;
    address?: F<string>;
    parcel?: F<string>;
    existingBuilding?: F<boolean>;
    /** Normalized use label, e.g. "warehouse_and_office". */
    existingUse?: F<string>;
    /** Use the property is currently authorized for (permit / use certificate). */
    authorizedUse?: F<string>;
    proposedUse?: F<string>;
    /** "insufficient" when the proposed use is too vague to resolve a graph branch
     *  (e.g. "a new commercial operation"). */
    proposedUseSpecificity?: F<UseSpecificity>;
    squareFeet?: F<number>;
    ownershipStatus?: F<Exclude<OwnershipStatus, "unknown">>;
  };
  project: {
    /** renovation | new_construction | expansion | change_of_use | demolition */
    type?: F<string[]>;
    renovation?: F<boolean>;
    demolition?: F<Exclude<DemolitionScope, "unknown">>;
    electricalWork?: F<boolean>;
    plumbingWork?: F<boolean>;
    mechanicalWork?: F<boolean>;
    structuralWork?: F<boolean>;
    exteriorWork?: F<boolean>;
    footprintChange?: F<boolean>;
    layoutChanges?: F<boolean>;
    /**
     * Change of use / occupancy. explicit true = the user said the use changes
     * ("converting a warehouse into a daycare"); inferred true = possible but
     * NOT confirmed; explicit false = the use stays the same.
     */
    possibleChangeOfUse?: F<boolean>;
    siteCirculationChanges?: F<boolean>;
  };
  operations: {
    activity?: F<string>;
    employees?: F<number>;
    publicAccess?: F<boolean>;
    foodService?: F<boolean>;
    hazardousMaterials?: F<boolean>;
    emissionsEquipment?: F<boolean>;
    generator?: F<boolean>;
    fuelStorage?: F<boolean>;
    wastewaterDischarge?: F<boolean>;
    childrenPresent?: F<boolean>;
  };
}

export type ScenarioSection = keyof ScenarioContext;

export function emptyScenario(): ScenarioContext {
  return { business: {}, property: {}, project: {}, operations: {} };
}

/** Every fact path in the model ("property.squareFeet", …). */
export const SCENARIO_PATHS = [
  "business.status",
  "business.entityId",
  "business.name",
  "business.entityType",
  "business.industry",
  "business.proposedActivity",
  "property.municipality",
  "property.address",
  "property.parcel",
  "property.existingBuilding",
  "property.existingUse",
  "property.authorizedUse",
  "property.proposedUse",
  "property.proposedUseSpecificity",
  "property.squareFeet",
  "property.ownershipStatus",
  "project.type",
  "project.renovation",
  "project.demolition",
  "project.electricalWork",
  "project.plumbingWork",
  "project.mechanicalWork",
  "project.structuralWork",
  "project.exteriorWork",
  "project.footprintChange",
  "project.layoutChanges",
  "project.possibleChangeOfUse",
  "project.siteCirculationChanges",
  "operations.activity",
  "operations.employees",
  "operations.publicAccess",
  "operations.foodService",
  "operations.hazardousMaterials",
  "operations.emissionsEquipment",
  "operations.generator",
  "operations.fuelStorage",
  "operations.wastewaterDischarge",
  "operations.childrenPresent",
] as const;

export type ScenarioPath = (typeof SCENARIO_PATHS)[number];

export function getFact(ctx: ScenarioContext, path: ScenarioPath): ScenarioFact<unknown> | undefined {
  const [section, key] = path.split(".") as [ScenarioSection, string];
  return (ctx[section] as Record<string, ScenarioFact<unknown> | undefined>)[key];
}

export function setFact(ctx: ScenarioContext, path: ScenarioPath, fact: ScenarioFact<unknown> | undefined): void {
  const [section, key] = path.split(".") as [ScenarioSection, string];
  const bucket = ctx[section] as Record<string, ScenarioFact<unknown> | undefined>;
  if (fact === undefined) delete bucket[key];
  else bucket[key] = fact;
}

export function valueOf<T>(fact: F<T>): T | undefined {
  return fact?.value;
}

/** Stated or on file — not an inference. */
export function isConfirmed(fact: F<unknown>): boolean {
  return !!fact && fact.source !== "inferred";
}

export function businessStatus(ctx: ScenarioContext): BusinessStatus {
  return ctx.business.status?.value ?? "unknown";
}

export function ownershipStatus(ctx: ScenarioContext): OwnershipStatus {
  return ctx.property.ownershipStatus?.value ?? "unknown";
}

/** confirmed = stated change; possible = inferred; none = stated same use. */
export function changeOfUseStatus(ctx: ScenarioContext): "confirmed" | "possible" | "none" | "unknown" {
  const f = ctx.project.possibleChangeOfUse;
  if (!f) return "unknown";
  if (f.value === false) return f.source === "inferred" ? "unknown" : "none";
  return f.source === "inferred" ? "possible" : "confirmed";
}

export function cloneScenario(ctx: ScenarioContext): ScenarioContext {
  return {
    business: { ...ctx.business },
    property: { ...ctx.property },
    project: { ...ctx.project },
    operations: { ...ctx.operations },
  };
}

const NUMBER_PATHS = new Set<string>(["property.squareFeet", "operations.employees"]);
const LIST_PATHS = new Set<string>(["project.type"]);
const BOOLEAN_PATHS = new Set<string>([
  "property.existingBuilding",
  ...SCENARIO_PATHS.filter((p) => p.startsWith("project.") && p !== "project.type" && p !== "project.demolition"),
  ...SCENARIO_PATHS.filter((p) => p.startsWith("operations.") && p !== "operations.activity" && p !== "operations.employees"),
]);
const ENUM_PATHS: Record<string, readonly string[]> = {
  "business.status": ["existing", "new"],
  "property.ownershipStatus": ["owned", "leased"],
  "property.proposedUseSpecificity": ["specific", "insufficient"],
  "project.demolition": ["none", "interior", "partial", "full"],
};
const SOURCES: readonly string[] = ["explicit", "inferred", "existing_passport"];

/**
 * A scenario from a saved snapshot (untrusted). Keeps only well-formed facts
 * on known paths, so resuming never re-asks what the user already said and a
 * malformed snapshot can never corrupt the session. Null when nothing is left.
 */
export function restoreScenario(raw: unknown): ScenarioContext | null {
  if (!raw || typeof raw !== "object") return null;
  const out = emptyScenario();
  let kept = 0;
  for (const path of SCENARIO_PATHS) {
    const [section, key] = path.split(".");
    const bucket = (raw as Record<string, unknown>)[section];
    const f = bucket && typeof bucket === "object" ? (bucket as Record<string, unknown>)[key] : undefined;
    if (!f || typeof f !== "object") continue;
    const { value, source, confidence, evidenceText } = f as Record<string, unknown>;
    if (typeof source !== "string" || !SOURCES.includes(source)) continue;
    if (typeof confidence !== "number" || !(confidence >= 0 && confidence <= 1)) continue;
    if (typeof evidenceText !== "string") continue;
    const ok = NUMBER_PATHS.has(path)
      ? typeof value === "number" && Number.isFinite(value) && value >= 0
      : LIST_PATHS.has(path)
        ? Array.isArray(value) && value.length <= 8 && value.every((v) => typeof v === "string" && v.length <= 40)
        : BOOLEAN_PATHS.has(path)
          ? typeof value === "boolean"
          : ENUM_PATHS[path]
            ? typeof value === "string" && ENUM_PATHS[path].includes(value)
            : typeof value === "string" && value.trim() !== "" && value.length <= 200;
    if (!ok) continue;
    setFact(out, path, { value, source: source as FactSource, confidence, evidenceText: evidenceText.slice(0, 500) });
    kept++;
  }
  return kept > 0 ? out : null;
}
