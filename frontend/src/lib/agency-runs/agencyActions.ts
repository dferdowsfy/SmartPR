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
}

const COMPLETED_STATUSES = new Set(["review", "completed"]);

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
  return configs.map((config) =>
    actionForConfig(config, agency_id, flat, completed)
  );
}
