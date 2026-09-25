/**
 * Validate the model's scenario reading and combine it with the
 * deterministic reading.
 *
 * The model is good at nuance; it is also capable of turning a noun into a
 * conclusion ("new commercial operation" → new business). So its output is
 * data to be checked, not trusted:
 *
 * - every fact needs an evidence quote that actually appears in the
 *   description (whitespace/case-insensitive); an "explicit" fact with an
 *   invented quote is dropped, an inference without a real quote is dropped;
 * - facts below 0.60 confidence are dropped (unknown stays unknown);
 * - guarded conclusions need the right language in the text itself:
 *     business.status = new       → entity-formation / start-a-business wording
 *     business.status = existing  → the speaker's own operating business
 *     change of use (explicit)    → a stated conversion / change of use
 *   otherwise they are downgraded to inferences or dropped;
 * - "existing_passport" can't come from the model (only from the Passport).
 *
 * combineScenario then keeps, per fact, the better-grounded reading: explicit
 * beats inferred; the deterministic reading wins ties and always wins on the
 * guarded facts.
 */
import {
  EXISTING_BUSINESS_RE,
  NEW_ENTITY_RE,
  OPEN_INTENT_RE,
  renovationStated,
} from "./interpret";
import {
  SCENARIO_PATHS,
  cloneScenario,
  emptyScenario,
  getFact,
  setFact,
  type FactSource,
  type ScenarioContext,
  type ScenarioFact,
  type ScenarioPath,
} from "./types";
import { matchUse, findUseByLabel } from "./uses";

type Kind = "string" | "number" | "boolean" | "string[]";

const KIND: Record<ScenarioPath, Kind> = {
  "business.status": "string",
  "business.entityId": "string",
  "business.name": "string",
  "business.entityType": "string",
  "business.industry": "string",
  "business.proposedActivity": "string",
  "property.municipality": "string",
  "property.address": "string",
  "property.parcel": "string",
  "property.existingBuilding": "boolean",
  "property.existingUse": "string",
  "property.authorizedUse": "string",
  "property.proposedUse": "string",
  "property.proposedUseSpecificity": "string",
  "property.squareFeet": "number",
  "property.ownershipStatus": "string",
  "project.type": "string[]",
  "project.renovation": "boolean",
  "project.demolition": "string",
  "project.electricalWork": "boolean",
  "project.plumbingWork": "boolean",
  "project.mechanicalWork": "boolean",
  "project.structuralWork": "boolean",
  "project.exteriorWork": "boolean",
  "project.footprintChange": "boolean",
  "project.layoutChanges": "boolean",
  "project.possibleChangeOfUse": "boolean",
  "project.siteCirculationChanges": "boolean",
  "operations.activity": "string",
  "operations.employees": "number",
  "operations.publicAccess": "boolean",
  "operations.foodService": "boolean",
  "operations.hazardousMaterials": "boolean",
  "operations.emissionsEquipment": "boolean",
  "operations.generator": "boolean",
  "operations.fuelStorage": "boolean",
  "operations.wastewaterDischarge": "boolean",
  "operations.childrenPresent": "boolean",
};

const ENUMS: Partial<Record<ScenarioPath, string[]>> = {
  "business.status": ["existing", "new"],
  "property.ownershipStatus": ["owned", "leased"],
  "property.proposedUseSpecificity": ["specific", "insufficient"],
  "project.demolition": ["none", "interior", "partial", "full"],
};

/** Identity facts only ever come from the Passport or the user's own words about them. */
const MODEL_FORBIDDEN: ScenarioPath[] = ["business.entityId"];

const squash = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[“”"]/g, '"').replace(/[‘’]/g, "'").trim();

export function evidenceInText(evidence: string, description: string): boolean {
  const e = squash(evidence);
  if (e.length < 3) return false;
  return squash(description).includes(e);
}

function coerce(kind: Kind, value: unknown): unknown {
  switch (kind) {
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "yes") return true;
      if (value === "false" || value === "no") return false;
      return undefined;
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(n) && String(value ?? "").trim() !== "" ? n : undefined;
    }
    case "string[]":
      if (Array.isArray(value)) {
        const arr = value.filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim());
        return arr.length ? arr : undefined;
      }
      return typeof value === "string" && value.trim() ? [value.trim()] : undefined;
    default:
      return typeof value === "string" && value.trim() && value.trim().toLowerCase() !== "unknown" ? value.trim() : undefined;
  }
}

export interface NormalizeReport {
  path: string;
  action: "dropped" | "downgraded";
  reason: string;
}

/** Validate a raw model scenario object against the description. */
export function normalizeScenario(
  raw: unknown,
  description: string
): { scenario: ScenarioContext; report: NormalizeReport[] } {
  const scenario = emptyScenario();
  const report: NormalizeReport[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { scenario, report };
  const r = raw as Record<string, Record<string, unknown> | undefined>;

  for (const path of SCENARIO_PATHS) {
    const [section, key] = path.split(".");
    const entry = r[section]?.[key];
    if (entry === undefined || entry === null) continue;
    if (MODEL_FORBIDDEN.includes(path)) {
      report.push({ path, action: "dropped", reason: "only the Business Passport sets this" });
      continue;
    }
    if (typeof entry !== "object" || Array.isArray(entry)) {
      report.push({ path, action: "dropped", reason: "malformed" });
      continue;
    }
    const e = entry as Record<string, unknown>;
    const value = coerce(KIND[path], e.value);
    if (value === undefined) continue; // unknown stays unknown
    if (ENUMS[path] && !ENUMS[path]!.includes(String(value))) {
      report.push({ path, action: "dropped", reason: `value "${String(value)}" not allowed` });
      continue;
    }
    let confidence = typeof e.confidence === "number" && Number.isFinite(e.confidence) ? Math.max(0, Math.min(1, e.confidence)) : 0;
    let source: FactSource = e.source === "explicit" ? "explicit" : "inferred";
    const evidenceText = typeof e.evidenceText === "string" ? e.evidenceText.trim().slice(0, 300) : typeof e.evidence === "string" ? (e.evidence as string).trim().slice(0, 300) : "";
    if (confidence < 0.6) continue;
    if (!evidenceText || !evidenceInText(evidenceText, description)) {
      report.push({ path, action: "dropped", reason: "evidence is not a quote from the description" });
      continue;
    }

    // Guarded conclusions.
    if (path === "business.status") {
      if (value === "new" && !NEW_ENTITY_RE.test(description)) {
        if (OPEN_INTENT_RE.test(description)) {
          source = "inferred";
          confidence = Math.min(confidence, 0.72);
          report.push({ path, action: "downgraded", reason: "opening something is not proof of a new entity" });
        } else {
          report.push({ path, action: "dropped", reason: "no entity-formation language; a new operation or location is not a new business" });
          continue;
        }
      }
      if (value === "existing" && !EXISTING_BUSINESS_RE.test(description) && source === "explicit") {
        source = "inferred";
        confidence = Math.min(confidence, 0.72);
        report.push({ path, action: "downgraded", reason: "no statement that the speaker's business already operates" });
      }
    }
    if (path === "project.possibleChangeOfUse" && value === true && source === "explicit") {
      if (!/\b(?:convert\w*|turn\w*|transform\w*|repurpos\w*)\b[^.;!?]*\binto\b|\bchang\w*\s+(?:of|the|in)\s+(?:the\s+)?(?:property's\s+|building's\s+)?(?:use|occupancy)\b/i.test(description)) {
        source = "inferred";
        confidence = Math.min(confidence, 0.72);
        report.push({ path, action: "downgraded", reason: "a possible change of use is not a confirmed one" });
      }
    }
    // Guarded conclusion: the model turns cosmetic work ("painting and
    // signage") into a renovation conclusion. An "explicit" renovation needs
    // renovation language in the text itself; otherwise it is an inference
    // and stays in the needs-confirmation band.
    if (path === "project.renovation" && value === true && source === "explicit") {
      if (!renovationStated(description)) {
        source = "inferred";
        confidence = Math.min(confidence, 0.72);
        report.push({ path, action: "downgraded", reason: "cosmetic work is not a renovation" });
      }
    }
    if (path === "project.type" && Array.isArray(value) && source === "explicit") {
      const types = value as string[];
      if (types.some((t) => t.toLowerCase().includes("renovation")) && !renovationStated(description)) {
        source = "inferred";
        confidence = Math.min(confidence, 0.72);
        report.push({ path, action: "downgraded", reason: "cosmetic work is not a renovation" });
      }
    }
    if ((path === "property.proposedUse" || path === "operations.activity") && typeof value === "string") {
      // Normalize to the use vocabulary when it matches; a generic phrase is
      // never "specific".
      const use = findUseByLabel(value) ?? matchUse(value.replace(/_/g, " "));
      if (use?.generic && path === "operations.activity") {
        report.push({ path, action: "dropped", reason: "a generic operation is not an activity" });
        continue;
      }
    }
    if (source === "explicit" && confidence < 0.85) source = "inferred";

    setFact(scenario, path, { value, source, confidence, evidenceText } as ScenarioFact<unknown>);
  }

  // A generic proposed use can't be "specific", whatever the model said.
  const pu = scenario.property.proposedUse;
  if (pu) {
    const use = findUseByLabel(pu.value) ?? matchUse(pu.value.replace(/_/g, " "));
    if (use?.generic) {
      scenario.property.proposedUseSpecificity = { ...pu, value: "insufficient" };
    }
  }
  return { scenario, report };
}

const RANK: Record<FactSource, number> = { existing_passport: 3, explicit: 2, inferred: 1 };

/** Paths where the deterministic reading always wins over the model. */
const GUARDED: ScenarioPath[] = ["business.status", "project.possibleChangeOfUse"];

function better(a: ScenarioFact<unknown> | undefined, b: ScenarioFact<unknown> | undefined): ScenarioFact<unknown> | undefined {
  if (!a) return b;
  if (!b) return a;
  if (RANK[a.source] !== RANK[b.source]) return RANK[a.source] > RANK[b.source] ? a : b;
  return b.confidence > a.confidence + 0.05 ? b : a;
}

/**
 * Combine the deterministic reading (`base`) with the validated model
 * reading (`model`). Per fact, the better-grounded one wins; `base` wins ties
 * and guarded facts.
 */
export function combineScenario(base: ScenarioContext, model: ScenarioContext | null | undefined): ScenarioContext {
  const out = cloneScenario(base);
  if (!model) return out;
  for (const path of SCENARIO_PATHS) {
    const a = getFact(base, path);
    const b = getFact(model, path);
    if (!b) continue;
    if (GUARDED.includes(path) && a) continue;
    // The model may resolve a guarded fact the text left open, but only as
    // an inference unless its quote carries the guard's language.
    setFact(out, path, better(a, b));
  }
  // Specificity always follows the proposed use that won.
  if (out.property.proposedUse) {
    const use = findUseByLabel(out.property.proposedUse.value) ?? matchUse(out.property.proposedUse.value.replace(/_/g, " "));
    out.property.proposedUseSpecificity = { ...out.property.proposedUse, value: use?.generic ? "insufficient" : "specific" };
    if (!use?.generic && !out.operations.activity) out.operations.activity = { ...out.property.proposedUse };
  }
  return out;
}
