/**
 * Intake answers → reasoning facts. Pure: re-run whenever answers change.
 * Unknown stays unknown (undefined) — never defaulted.
 */
import type { ScenarioContext } from "../ai/intake/scenario/types";
import type { Facts } from "./scenarioReasoning";

export interface IntakeFactInput {
  projectIntent?: string | null;
  profile?: { business_stage?: string; municipality?: string; business_type?: string; location_type?: string } | null;
  answers?: Record<string, unknown> | null;
  scenario?: ScenarioContext | null;
}

export function factsFromIntake({ projectIntent, profile, answers, scenario }: IntakeFactInput): Facts {
  const f: Facts = {};
  const set = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== "") f[k] = v; };
  const a = answers ?? {};
  const s = scenario;

  const intent = projectIntent ?? (profile?.business_stage === "existing" ? "existing_business" : profile?.business_stage === "new" ? "new_business" : undefined);
  set("project_intent", intent);
  const status = s?.business.status?.value;
  if (status) set("existing_business", status === "existing");
  else if (intent === "existing_business" || intent === "new_business") set("existing_business", intent === "existing_business");

  set("existing_premises", s?.property.existingBuilding?.value);
  const types = s?.project.type?.value ?? [];
  if (types.length) set("project_types", types);
  if (types.length || s?.project.renovation || s?.project.structuralWork || typeof a.renovations === "boolean") {
    set("construction_required", Boolean(s?.project.renovation?.value || s?.project.structuralWork?.value || types.some((t) => ["renovation", "new_construction", "expansion", "demolition"].includes(t)) || a.renovations === true));
  }
  if (types.length) set("new_construction", types.includes("new_construction"));
  // Change of use only counts when stated explicitly (inferred = still unknown).
  const cou = s?.project.possibleChangeOfUse;
  if (cou && cou.source === "explicit") { set("new_use_requested", cou.value); set("same_use", !cou.value); }
  else if (types.includes("change_of_use")) { set("new_use_requested", true); set("same_use", false); }
  for (const k of ["ownership_changed", "renewal_due", "utilities_connection", "subdivision"]) if (typeof a[k] === "boolean") set(k, a[k]);

  const loc = profile?.location_type ?? "";
  if (loc) set("home_based", /home/i.test(loc));
  if (intent === "new_business" || intent === "existing_business") set("residential", false);
  set("business_type", profile?.business_type || undefined);
  set("municipality", profile?.municipality || s?.property.municipality?.value);
  return f;
}
