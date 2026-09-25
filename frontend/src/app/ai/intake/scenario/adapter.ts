/**
 * Scenario → the engine's flat project facts (projectContext.ts).
 *
 * The rules engine reads flat `project_fact` keys. This adapter is the only
 * bridge: explicit / answered facts go across at ≥ 0.90 confidence;
 * inferences go across in the 0.60–0.84 "needs confirmation" band (the
 * engine's provenance gate keeps them inert until confirmed); a possible
 * change of use is NOT sent as a change of use.
 */
import type { ProjectContext, ProjectContextFact, ProjectContextKey } from "../projectContext";
import type { ProjectIntent } from "../projectIntent";
import { changeOfUseStatus, isConfirmed, type ScenarioContext, type ScenarioFact } from "./types";
import { displayOfUse } from "./uses";

function conv(f: ScenarioFact<unknown>, value: string | number | boolean): ProjectContextFact {
  const confidence = isConfirmed(f) ? Math.max(0.9, f.confidence) : Math.min(0.82, Math.max(0.6, f.confidence));
  return { value, confidence, evidence: f.evidenceText.slice(0, 300) };
}

export function scenarioToProjectContext(ctx: ScenarioContext): ProjectContext {
  const out: ProjectContext = {};
  const set = (key: ProjectContextKey, f: ScenarioFact<unknown> | undefined, value?: string | number | boolean) => {
    if (!f) return;
    const v = value ?? (f.value as string | number | boolean);
    if (v === undefined || v === null || v === "") return;
    out[key] = conv(f, v);
  };
  const p = ctx.property;
  const pr = ctx.project;
  const o = ctx.operations;
  set("municipality", p.municipality);
  set("existing_building", p.existingBuilding);
  if (p.existingUse) {
    set("existing_use", p.existingUse, displayOfUse(p.existingUse.value).toLowerCase());
    set("property_type", p.existingUse, displayOfUse(p.existingUse.value).toLowerCase());
  }
  if (p.proposedUse && p.proposedUseSpecificity?.value === "specific") set("proposed_use", p.proposedUse, displayOfUse(p.proposedUse.value).toLowerCase());
  set("square_footage", p.squareFeet);
  set("property_tenure", p.ownershipStatus);
  if (pr.type?.value.includes("new_construction")) set("project_type", pr.type, "new_construction");
  else if (pr.renovation?.value) set("project_type", pr.renovation, "renovation");
  set("renovation", pr.renovation);
  if (pr.type?.value.includes("new_construction")) set("new_construction", pr.type, true);
  if (pr.type?.value.includes("expansion")) set("expansion", pr.type, true);
  if (pr.demolition) set("interior_demolition", pr.demolition, pr.demolition.value === "interior" || pr.demolition.value === "partial" || pr.demolition.value === "full");
  set("electrical_work", pr.electricalWork);
  set("plumbing_work", pr.plumbingWork);
  set("mechanical_work", pr.mechanicalWork);
  set("structural_work", pr.structuralWork);
  set("exterior_work", pr.exteriorWork);
  set("layout_changes", pr.layoutChanges);
  set("parking_changes", pr.siteCirculationChanges);
  const change = changeOfUseStatus(ctx);
  if (change === "confirmed" || change === "none") {
    set("change_of_use", pr.possibleChangeOfUse);
    set("occupancy_change", pr.possibleChangeOfUse);
  }
  if (o.activity && isConfirmed(o.activity)) set("business_activity", o.activity, displayOfUse(o.activity.value).toLowerCase());
  set("employee_count", o.employees);
  return out;
}

/**
 * The flat context with the scenario's reading applied on top: keys the
 * scenario resolved replace the flat reading, and an unconfirmed change of
 * use / occupancy change never survives from a keyword-level extraction.
 */
export function reconcileProjectContext(flat: ProjectContext | undefined, ctx: ScenarioContext): ProjectContext {
  const out: ProjectContext = { ...(flat ?? {}) };
  const change = changeOfUseStatus(ctx);
  if (change !== "confirmed" && change !== "none") {
    delete out.change_of_use;
    delete out.occupancy_change;
  }
  // A vague proposed use is not a proposed use.
  if (ctx.property.proposedUseSpecificity?.value === "insufficient") delete out.proposed_use;
  return { ...out, ...scenarioToProjectContext(ctx) };
}

/** Project intent implied by the scenario, when it states one. */
export function scenarioProjectIntent(ctx: ScenarioContext): { value: ProjectIntent; confirmed: boolean } | null {
  const s = ctx.business.status;
  if (!s) return null;
  return { value: s.value === "existing" ? "existing_business" : "new_business", confirmed: isConfirmed(s) };
}
