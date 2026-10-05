// ============================================================================
// Per-case readiness labels for the Property & Site Report sample parcels.
//
// Every case gets exactly one label, decided by explicit criteria, and every
// label lists the gaps that keep it from the next level in plain language:
//
//   ready_for_client_delivery  — no open gaps of any kind: the report's own
//       outputs agree, every official source answered, nothing is waiting on a
//       reviewer, and every determination the report makes is covered by a rule.
//   ready_for_internal_screening — nothing about this parcel needs a
//       professional, but a platform-wide gap (or a source that didn't answer
//       on the last check) means it can't go to a client yet.
//   needs_professional_review — at least one gap specific to this parcel
//       affects a determination (a source timed out, the pin isn't on a lot,
//       a map the rules don't read applies here, an official answer changed,
//       or the report's outputs disagree). A qualified land-use reviewer (or
//       engineering, for output mismatches) must clear it first.
//
// Internal/admin only: nothing here is shown in the customer report. Pure
// function, no network; geo:drift stores the result for the review queue.
// ============================================================================

import type { SiteLayerResult } from "../layers.ts";
import type { SiteCase } from "./cases.ts";
import type { Issue } from "./consistency.ts";
import type { DriftItem } from "./drift.ts";
import type { OfficialFacts } from "./officialFacts.ts";

export type ReadinessLabel = "ready_for_client_delivery" | "ready_for_internal_screening" | "needs_professional_review";
/** What a gap blocks: client delivery only, or any reliance without a professional. */
export type GapSeverity = "blocks_client_delivery" | "needs_professional_review";

export interface ReadinessGap {
  id: string;
  severity: GapSeverity;
  /** One plain-language sentence: what is missing and why it matters for this parcel. */
  explanation: string;
  /** Who closes it. */
  owner: "land_use_reviewer" | "engineering" | "product";
}

export interface CaseReadiness {
  case_id: string;
  case_label: string;
  label: ReadinessLabel;
  gaps: ReadinessGap[];
}

export const LABEL_TEXT: Record<ReadinessLabel, string> = {
  ready_for_client_delivery: "Ready for client delivery",
  ready_for_internal_screening: "Ready for internal screening",
  needs_professional_review: "Needs professional review",
};

/** The criteria, as shown to reviewers on the admin page. */
export const READINESS_CRITERIA: Record<ReadinessLabel, string> = {
  ready_for_client_delivery: "No open gaps at all: the report's outputs agree, every official source answered, nothing is waiting on a reviewer, and every determination is covered by a rule.",
  ready_for_internal_screening: "Nothing about this parcel needs a professional, but a platform-wide gap or a source that did not answer on the last check keeps it from going to a client.",
  needs_professional_review: "At least one gap specific to this parcel affects a determination. A qualified land-use reviewer (or engineering, for output mismatches) must clear it before anyone relies on the report.",
};

/** Gaps that apply to every parcel today, until the platform closes them. */
export const PLATFORM_GAPS: readonly ReadinessGap[] = [
  { id: "permitted_use_matrix", severity: "blocks_client_delivery", owner: "product", explanation: "The report names the zoning district but has no permitted-use matrix, so it cannot say whether the planned use is allowed there under the 2023 Joint Regulation." },
];

export interface ReadinessInput {
  case: SiteCase;
  facts: OfficialFacts;
  /** Layer results from the report pipeline (status "unknown" = no answer). */
  layers: SiteLayerResult[];
  /** Consistency issues from checkCase (must be empty). */
  issues: Issue[];
  /** Open review-queue items for this case. */
  drift: DriftItem[];
}

const LAYER_NAME: Partial<Record<SiteLayerResult["layer"], string>> = {
  historic_zone: "historic-zone lookup (ICP / JP historic districts)",
  protected_area: "protected natural area lookup (DRNA)",
};

export function assessCase(input: ReadinessInput, platformGaps: readonly ReadinessGap[] = PLATFORM_GAPS): CaseReadiness {
  const { case: c, facts, layers, issues, drift } = input;
  const gaps: ReadinessGap[] = [];
  const review = (id: string, owner: ReadinessGap["owner"], explanation: string) => gaps.push({ id, severity: "needs_professional_review", owner, explanation });

  if (issues.length) review("output_mismatch", "engineering", `The report's own outputs disagree in ${issues.length} place${issues.length === 1 ? "" : "s"} (for example ${issues[0].output}: ${issues[0].fact.slice(0, 120)}); engineering fixes this before anyone relies on it.`);
  if (c.offLot) review("off_lot_pin", "land_use_reviewer", c.offLot === "road" ? "The pin is on a street, not a lot, so lot facts cannot be attributed to the property until the correct parcel is confirmed." : c.offLot === "water" ? "The pin is in a water body, not a lot, so lot facts cannot be attributed to the property until the correct parcel is confirmed." : "No parcel or zoning polygon answers at the pin, so the property itself has not been identified.");
  for (const l of layers) {
    const name = LAYER_NAME[l.layer];
    if (name && l.status === "unknown") review(`${l.layer}_no_answer`, "land_use_reviewer", `The ${name} did not answer${l.reason ? ` (${l.reason})` : ""}, so the report cannot say whether that review applies here.`);
  }
  const firm = facts.fema.governing;
  const adv = facts.advisory.zone;
  if (adv) review("abfe_not_in_flood_rule", "land_use_reviewer", adv !== firm
    ? `The FEMA/JP advisory flood map (ABFE) puts the pin in zone ${adv} while the effective FEMA map says ${firm ?? "no zone"}; the flood rule reads only the effective map, so a reviewer decides which governs.`
    : `The FEMA/JP advisory flood map (ABFE) also shows zone ${adv} here, but advisory base flood elevations are not in the flood rule, so elevation requirements are not checked.`);
  if (facts.coastal.inside) review("zmt_not_checked", "land_use_reviewer", "The pin is inside the coastal zone, but the maritime-terrestrial zone (ZMT) boundary and shoreline setback are not checked by the report.");
  if (facts.wetlandsParcel.inside) review("wetlands_not_in_rules", "land_use_reviewer", "Mapped wetlands touch the parcel, but no report rule evaluates wetlands, so possible Corps/DRNA permits are not flagged.");
  else if (!facts.wetlandsParcel.answered && !c.offLot) review("wetlands_no_answer", "land_use_reviewer", "The wetlands lookup did not answer for this parcel, so wetland impacts are unknown.");
  for (const d of drift) {
    if (d.route === "auto_resolve") gaps.push({ id: "source_retrying", severity: "blocks_client_delivery", owner: "engineering", explanation: `On the last check a source did not answer (${d.evidence.source}); it retries automatically, and the report should not go to a client until it answers.` });
    else review(d.route === "engineering" ? "live_read_failed" : "official_answer_changed", d.route, d.what_changed);
  }
  gaps.push(...platformGaps);

  // One gap per id (e.g. several drift items of the same kind).
  const seen = new Set<string>();
  const unique = gaps.filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
  const label: ReadinessLabel = unique.some((g) => g.severity === "needs_professional_review") ? "needs_professional_review"
    : unique.length ? "ready_for_internal_screening" : "ready_for_client_delivery";
  return { case_id: c.id, case_label: c.label, label, gaps: unique };
}

const LABELS = Object.keys(LABEL_TEXT) as ReadinessLabel[];
const str = (v: unknown): v is string => typeof v === "string";

/** Validate stored readiness rows (from the drift file); malformed rows are dropped. */
export function parseReadiness(raw: unknown): CaseReadiness[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is CaseReadiness => {
    if (!r || typeof r !== "object") return false;
    const o = r as Record<string, unknown>;
    return str(o.case_id) && str(o.case_label) && (LABELS as string[]).includes(o.label as string) && Array.isArray(o.gaps)
      && (o.gaps as unknown[]).every((g) => !!g && typeof g === "object" && str((g as ReadinessGap).id) && str((g as ReadinessGap).explanation)
        && ["blocks_client_delivery", "needs_professional_review"].includes((g as ReadinessGap).severity));
  });
}
