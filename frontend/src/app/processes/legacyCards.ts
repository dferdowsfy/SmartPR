// One source of truth for energy items that the permit-centric rules engine
// also emits as legacy document cards (DOC_LUMA_INTERCONNECTION,
// DOC_NET_METERING_AGREEMENT, DOC_FIRE_CERT, …).
//
// Those legacy rules fire from a single yes/no ("Q_RENEWABLE_INSTALL") and
// carry compliance_mode=verify_existing, so a PROPOSED rooftop install at an
// operating business rendered them under "Already held — verify existing",
// and voluntary net metering read as a mandatory registration. When the
// process graph has evaluated the process that supersedes a legacy card, the
// card is rendered through the process (Energy section) instead.
import type { ProcessGraph } from "./graph.ts";
import { citationFor, type CitationView, type ProcessAssessment } from "./engine.ts";
import { evaluateCondition } from "./conditions.ts";
import type { ProcessState } from "./types.ts";

export interface LegacyCardRef {
  document_id?: string | null;
  source_rule?: string | null;
  triggerFacts?: string[] | null;
}

export interface LegacySupersession {
  document_id: string;
  process_id: string;
  process_name: string;
  state: ProcessState;
  /** Set when no process absorbs the card because it does not apply at all
   * (KB legacy_suppressions, e.g. DG registrations for a wholesale plant). */
  suppressed?: { id: string; reason: string; reason_es?: string; citation: CitationView };
}

/** Every rule that produced the card (source rule + all matched bases). */
export function ruleIdsOf(card: LegacyCardRef): string[] {
  const ids = new Set<string>();
  if (card.source_rule) ids.add(card.source_rule);
  for (const t of card.triggerFacts ?? []) {
    const m = /^rule:(RULE_[A-Z0-9_]+)$/.exec(t);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

/**
 * Legacy cards superseded by an evaluated process: the card's document is
 * aliased by the process AND every rule behind the card is one the process
 * supersedes (`legacy_rule_ids`). A card with any other basis (e.g. a
 * restaurant's fire certificate from its business type) is left alone.
 */
export function supersededLegacyCards(
  graph: ProcessGraph,
  assessment: ProcessAssessment | null,
  cards: readonly LegacyCardRef[]
): Map<string, LegacySupersession> {
  const out = new Map<string, LegacySupersession>();
  if (!assessment) return out;
  const evaluated = new Map(assessment.processes.map((p) => [p.process_id, p]));
  for (const card of cards) {
    const doc = card.document_id;
    if (!doc) continue;
    const rules = ruleIdsOf(card);
    if (rules.length === 0) continue;
    for (const pid of graph.legacyDocumentIndex.get(doc) ?? []) {
      const ev = evaluated.get(pid);
      const superseded = new Set(graph.processes.get(pid)?.legacy_rule_ids ?? []);
      if (ev && rules.every((r) => superseded.has(r))) {
        out.set(doc, { document_id: doc, process_id: pid, process_name: ev.name, state: ev.state });
        break;
      }
    }
    if (out.has(doc)) continue;
    for (const x of graph.kb.legacy_suppressions ?? []) {
      if (!rules.every((r) => x.rule_ids.includes(r))) continue;
      if (evaluateCondition(x.when, assessment.facts).value !== true) continue;
      out.set(doc, {
        document_id: doc, process_id: "", process_name: "", state: "NOT_REQUIRED",
        suppressed: { id: x.id, reason: x.reason, reason_es: x.reason_es, citation: citationFor(graph, x.source_id, { locator: x.locator }) },
      });
      break;
    }
  }
  return out;
}

/**
 * A proposed energy project (or a wholesale plant not stated as operating)
 * applies for its energy approvals — none of them is "already held".
 */
export function isProposedEnergyProject(assessment: ProcessAssessment | null | undefined): boolean {
  const f = assessment?.facts;
  if (!f) return false;
  return f.energy_project_status === "proposed" || (f.energy_market_segment === "wholesale" && f.energy_project_status !== "existing");
}

/**
 * Energy items never say "verify existing" for a proposed energy project: a
 * legacy energy card (a document some process aliases) that the graph did not
 * absorb is shown as "may apply" instead of "already held".
 */
export function withoutEnergyVerifyExisting<T extends { document_id?: string | null; applicability?: string | null }>(
  graph: ProcessGraph,
  proposed: boolean,
  requirements: readonly T[]
): T[] {
  if (!proposed) return [...requirements];
  return requirements.map((r) =>
    r.document_id && r.applicability === "verify_existing" && graph.legacyDocumentIndex.has(r.document_id)
      ? { ...r, applicability: "conditional" }
      : r
  );
}

/** Legacy DG cards that Act 114 / process exceptions already exclude for utility scale. */
const UTILITY_SCALE_DG_DOCS = new Set([
  "DOC_NET_METERING_AGREEMENT",
  "DOC_LUMA_INTERCONNECTION",
]);

/**
 * Align legacy RULE_0610 / RULE_0611 cards with the already-verified process
 * exceptions (Act 114): a utility-scale project must not get net metering /
 * LUMA DG interconnection as Required Now. When offtake is still unanswered,
 * show them as conditional pending that answer. Does not edit process-graph
 * citations or thresholds (Run 2 net-metering finding).
 */
export function gateUtilityScaleDgCards<
  T extends { document_id?: string | null; applicability?: string | null; mandatory?: boolean }
>(
  requirements: readonly T[],
  opts: {
    solarSize?: unknown;
    generationCapacityKw?: unknown;
    energyMarketSegment?: unknown;
    powerOfftaker?: unknown;
  }
): T[] {
  const sizeOver1Mw =
    typeof opts.solarSize === "string" && /over\s*1\s*mw/i.test(opts.solarSize);
  const kw = typeof opts.generationCapacityKw === "number"
    ? opts.generationCapacityKw
    : typeof opts.generationCapacityKw === "string"
      ? Number(opts.generationCapacityKw)
      : NaN;
  const capacityOver1Mw = Number.isFinite(kw) && kw > 1000;
  const wholesale =
    opts.energyMarketSegment === "wholesale"
    || opts.powerOfftaker === "luma_prepa"
    || opts.powerOfftaker === "luma"
    || opts.powerOfftaker === "prepa";
  const offtakeUnknown =
    opts.energyMarketSegment == null
    && opts.powerOfftaker == null
    && !wholesale;
  const utilityScale = sizeOver1Mw || capacityOver1Mw || wholesale;
  if (!utilityScale) return [...requirements];
  return requirements.map((r) => {
    if (!r.document_id || !UTILITY_SCALE_DG_DOCS.has(r.document_id)) return r;
    if (wholesale || (capacityOver1Mw && !offtakeUnknown) || (sizeOver1Mw && !offtakeUnknown)) {
      // Confirmed utility-scale / wholesale: not Required Now (process exceptions).
      return { ...r, applicability: "not_applicable", mandatory: false };
    }
    // Utility-scale signal but offtake unanswered: conditional pending that answer.
    return { ...r, applicability: "conditional", mandatory: false };
  });
}
