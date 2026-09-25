/**
 * What Clara may reuse before asking: Business Passport + this project's facts.
 *
 * Filing-specific fields (EIN, entity type, authorized representative, …) are
 * asked only when a filing needs them — and only after checking the Passport
 * and the project the user already described. Project facts fill Passport
 * GAPS only: the Passport stays the record for business identity, and a
 * project's location never overwrites the business address.
 *
 * Only confirmed facts cross over (stated, answered, or on file) — an
 * inference from the description is never typed into a government form.
 */
import type { ProjectContext } from "../../app/ai/intake/projectContext";
import { restoreScenario, type ScenarioContext } from "../../app/ai/intake/scenario/types";

/** Confirmed project facts a filing form can use, by field-like key. */
export type ProjectFilingFacts = Partial<
  Record<
    | "municipality"
    | "property_address"
    | "parcel_number"
    | "square_footage"
    | "existing_use"
    | "proposed_use"
    | "property_tenure"
    | "employee_count",
    string
  >
>;

/** Engine threshold for a stated fact (see scenario/adapter.ts). */
const STATED = 0.9;

export function projectFilingFacts(
  projectContext: ProjectContext | null | undefined,
  scenario: ScenarioContext | null | undefined
): ProjectFilingFacts {
  const out: ProjectFilingFacts = {};
  const pc = projectContext ?? {};
  const take = (key: keyof ProjectFilingFacts, from: keyof ProjectContext) => {
    const f = pc[from];
    if (f && f.confidence >= STATED && f.value !== "" && typeof f.value !== "boolean") out[key] = String(f.value);
  };
  take("municipality", "municipality");
  take("square_footage", "square_footage");
  take("existing_use", "existing_use");
  take("proposed_use", "proposed_use");
  take("property_tenure", "property_tenure");
  take("employee_count", "employee_count");
  const p = scenario?.property;
  const confirmed = (f: { source: string } | undefined) => !!f && f.source !== "inferred";
  if (p?.address && confirmed(p.address)) out.property_address = p.address.value;
  if (p?.parcel && confirmed(p.parcel)) out.parcel_number = p.parcel.value;
  if (!out.municipality && p?.municipality && confirmed(p.municipality)) out.municipality = p.municipality.value;
  return out;
}

/**
 * The Passport with this project's facts under `project_facts`. The Passport
 * prefill flattener registers the Passport's own values first, so a project
 * fact only answers a field the Passport cannot. Null passport stays null
 * (null means "no access" to callers).
 */
export function withProjectFacts(
  passport: Record<string, unknown> | null,
  facts: ProjectFilingFacts
): Record<string, unknown> | null {
  if (!passport) return passport;
  if (Object.keys(facts).length === 0) return passport;
  const { project_facts: _ignored, ...rest } = passport;
  void _ignored;
  return { ...rest, project_facts: { ...facts } };
}

/** Project facts from a saved intake snapshot state (untrusted). */
export function projectFilingFactsFromState(
  state: Record<string, unknown> | null | undefined,
  validate: (raw: unknown) => { context: ProjectContext }
): ProjectFilingFacts {
  if (!state) return {};
  const { context } = validate(state.projectContext);
  return projectFilingFacts(context, restoreScenario(state.scenario));
}
