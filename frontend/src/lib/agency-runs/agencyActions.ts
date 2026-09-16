/**
 * Agency → actions resolution.
 *
 * Resolves the list of actionable agency filings for one agency from the
 * filing registry + the business's passport + prior run statuses. Labels only
 * flow through here — never field values, never secrets.
 */
import type { AgencyFilingType } from "./types";
import { AGENCY_FILING_CONFIGS, type AgencyFilingConfig } from "./filingTypes";
import { flattenPassportValues } from "./prefillFromPassport";
import { CANONICAL_LABELS } from "./canonicalFields";

export type AgencyId = "HACIENDA_SURI" | "DEPT_STATE" | "OGPE";

export const AGENCY_IDS: AgencyId[] = ["HACIENDA_SURI", "DEPT_STATE", "OGPE"];

export function isAgencyId(value: string): value is AgencyId {
  return (AGENCY_IDS as string[]).includes(value);
}

export interface AgencyAction {
  id: string;
  filing_type: AgencyFilingType;
  agency_id: string;
  title_en: string;
  title_es: string;
  agency_en: string;
  agency_es: string;
  status: "ready" | "blocked" | "not_required" | "completed";
  known: number;
  total: number;
  missing_items: {
    id: string;
    label_en: string;
    label_es: string;
    sensitive: boolean;
  }[];
  blocked_by: string[];
  evidence_available: string[];
  /**
   * Resolved concrete objective for this action (labels only). Used when one
   * filing type covers distinct workflows — e.g. Dept. of State "create a new
   * entity" vs "file the annual report" — so the browser agent is never sent
   * in with an ambiguous goal and has to guess which workflow to run.
   */
  objective_en?: string;
  objective_es?: string;
}

const COMPLETED_STATUSES = new Set(["review", "completed"]);

/* ------------------------------------------------------------------ */
/* Dept. of State objective resolution                                  */
/*                                                                     */
/* DEPT_STATE_CORPORATE_FILING covers two distinct portal workflows:   */
/* creating a new juridical entity vs filing the annual report of an    */
/* existing one. Sending the agent in with "do either" makes it guess. */
/* Resolve the concrete objective from passport formation signals; when */
/* the signals are inconclusive, surface both variants as separate     */
/* action cards so the human picks — never let the agent guess.        */
/* ------------------------------------------------------------------ */

type DeptStateObjective = "annual_report" | "new_entity" | "ambiguous";

const FORMED_STATUSES = new Set([
  "formed_in_puerto_rico",
  "formed_outside_puerto_rico",
]);

const OBJECTIVES: Record<
  Exclude<DeptStateObjective, "ambiguous">,
  { title_en: string; title_es: string; objective_en: string; objective_es: string }
> = {
  new_entity: {
    title_en: "Dept. of State — Create a new entity",
    title_es: "Departamento de Estado — Crear una nueva entidad",
    objective_en:
      "Create and file a NEW juridical entity (corporation or LLC) in the Corporate & Entities Registry. Do NOT file an annual report.",
    objective_es:
      "Crear y radicar una NUEVA entidad jurídica (corporación o LLC) en el Registro de Corporaciones y Entidades. NO radique un informe anual.",
  },
  annual_report: {
    title_en: "Dept. of State — File the annual report",
    title_es: "Departamento de Estado — Radicar el informe anual",
    objective_en:
      "File the ANNUAL REPORT (informe anual) for the EXISTING entity in the Corporate & Entities Registry. Do NOT create a new entity.",
    objective_es:
      "Radicar el INFORME ANUAL de la entidad EXISTENTE en el Registro de Corporaciones y Entidades. NO cree una nueva entidad.",
  },
};

function flatGet(flat: Map<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const v = flat.get(key);
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function resolveDeptStateObjective(flat: Map<string, string>): DeptStateObjective {
  // Keys are lowercased by flattenPassportValues; check dotted + snake + leaf.
  const registryNumber = flatGet(
    flat,
    "business.registrynumber",
    "business.registry_number",
    "registrynumber",
    "registry_number",
    "entity_number"
  );
  const incorporationDate = flatGet(
    flat,
    "business.incorporationdate",
    "business.incorporation_date",
    "incorporationdate",
    "incorporation_date"
  );
  const formationStatus = flatGet(
    flat,
    "business.formationstatus",
    "business.formation_status",
    "formationstatus",
    "formation_status"
  ).toLowerCase();
  const formed =
    Boolean(registryNumber || incorporationDate) ||
    FORMED_STATUSES.has(formationStatus);
  const notFormed = formationStatus === "not_formed";
  if (formed && !notFormed) return "annual_report";
  if (notFormed && !formed) return "new_entity";
  return "ambiguous";
}

/**
 * Split (or annotate) the Dept. of State corporate filing action with its
 * resolved concrete objective. Returns one action when the passport signals
 * are conclusive, or two clearly-labeled variants when they are not.
 */
function withDeptStateObjective(
  action: AgencyAction,
  flat: Map<string, string>
): AgencyAction[] {
  const resolved = resolveDeptStateObjective(flat);
  if (resolved === "ambiguous") {
    return (["new_entity", "annual_report"] as const).map((variant) => ({
      ...action,
      title_en: OBJECTIVES[variant].title_en,
      title_es: OBJECTIVES[variant].title_es,
      objective_en: OBJECTIVES[variant].objective_en,
      objective_es: OBJECTIVES[variant].objective_es,
    }));
  }
  const o = OBJECTIVES[resolved];
  return [
    {
      ...action,
      title_en: o.title_en,
      title_es: o.title_es,
      objective_en: o.objective_en,
      objective_es: o.objective_es,
    },
  ];
}

/**
 * True when the coverage key is present (non-empty) in the flattened passport.
 * flattenPassportValues lowercases keys; municipality/state live under
 * addresses.principalPhysical in the flattened map, so the canonical
 * "addresses.municipality" / "addresses.state" keys fall back to their leaf
 * (both are address-scoped concepts — no collision risk with other leaves).
 */
function coverageHit(flat: Map<string, string>, key: string): boolean {
  const k = key.toLowerCase();
  if (flat.has(k)) return true;
  const leaf = k.includes(".") ? k.slice(k.lastIndexOf(".") + 1) : k;
  if ((leaf === "municipality" || leaf === "state") && flat.has(leaf)) return true;
  return false;
}

function humanizeKey(key: string): string {
  const leaf = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function coverageLabel(key: string): { label_en: string; label_es: string } {
  const lbl = CANONICAL_LABELS[key];
  if (lbl) return { label_en: lbl.en, label_es: lbl.es };
  const human = humanizeKey(key);
  return { label_en: human, label_es: human };
}

function actionForConfig(
  config: AgencyFilingConfig,
  agencyId: string,
  flat: Map<string, string>,
  completed: Set<AgencyFilingType>
): AgencyAction {
  const coverage = config.passportCoverageKeys ?? [];

  const missingKeys = coverage.filter((key) => !coverageHit(flat, key));
  const known = coverage.length - missingKeys.length;

  const missing_items: AgencyAction["missing_items"] = [
    ...missingKeys.map((key) => ({
      id: key,
      ...coverageLabel(key),
      sensitive: false,
    })),
    ...(config.sensitiveNeeds ?? []).map((need) => ({
      id: need.id,
      label_en: need.label_en,
      label_es: need.label_es,
      sensitive: true,
    })),
  ];

  const blockedBy = (config.blockedBy ?? []).filter((ft) => !completed.has(ft));

  let status: AgencyAction["status"];
  if (completed.has(config.id)) {
    status = "completed";
  } else if (config.requiresExistingAccount || !config.enabled) {
    status = "not_required";
  } else if (blockedBy.length > 0) {
    status = "blocked";
  } else {
    status = "ready";
  }

  return {
    id: config.id,
    filing_type: config.id,
    agency_id: agencyId,
    title_en: config.labelEn,
    title_es: config.labelEs,
    agency_en: config.agencyEn,
    agency_es: config.agencyEs,
    status,
    known,
    total: coverage.length,
    missing_items,
    blocked_by: blockedBy as string[],
    evidence_available: config.evidenceTags ?? [],
  };
}

export async function resolveAgencyActions(input: {
  business_id: string;
  agency_id: string;
  passport: Record<string, unknown> | null;
  priorRuns: { filing_type: AgencyFilingType; status: string }[];
}): Promise<AgencyAction[]> {
  const { agency_id, passport, priorRuns } = input;
  void input.business_id; // reserved for future requirement-engine enrichment

  const configs = AGENCY_FILING_CONFIGS.filter((c) => c.agencyId === agency_id);
  const flat = flattenPassportValues(passport);

  const completed = new Set<AgencyFilingType>();
  for (const run of priorRuns ?? []) {
    if (COMPLETED_STATUSES.has(String(run.status))) completed.add(run.filing_type);
  }

  // Best-effort requirement enrichment intentionally resolves registry-only:
  // the requirements engine is a POST-only admin crawl endpoint, not a
  // per-business requirements lookup, so no requirements are invented here.
  const actions = configs.map((config) =>
    actionForConfig(config, agency_id, flat, completed)
  );
  // Dept. of State covers two distinct workflows — resolve the concrete
  // objective so the agent never has to guess between them.
  return actions.flatMap((action) =>
    action.filing_type === "DEPT_STATE_CORPORATE_FILING"
      ? withDeptStateObjective(action, flat)
      : [action]
  );
}
