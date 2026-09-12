// ============================================================================
// Seed builder — PURE function from the bundled KB JSON to graph node seeds.
//
// Used by seed.ts (writes rows to Postgres) and by the golden parity check
// (compile(buildSeedNodes(...)) must round-trip the bundled KB exactly on the
// engine-relevant keys). No pg imports.
// ============================================================================

import { ACTIVE_JURISDICTION } from "../jurisdictions";
import { QUESTION_KEY_MAP } from "../ai/intake/questionKeyMap";
import { labelForNode } from "./registry";
import type { NodeType } from "./types";
import type { GuidanceConcept } from "../guidance/model";

import businessTypeQuestionsJson from "../../kb/business_type_questions.json";
import industriesJson from "../../kb/industries.json";

export interface SeedNode {
  entityId: string;
  nodeType: NodeType;
  label: string;
  data: Record<string, unknown>;
}

interface BtqRow {
  business_type_id: string;
  question_id: string;
}

const slugAgency = (name: string): string =>
  "AGY_" +
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

/**
 * Build the full seed node list from the ACTIVE jurisdiction pack:
 *  - one node per municipality / industry / business type / question /
 *    document / rule, with `data` = the KB row VERBATIM (plus compat extras
 *    that the engine ignores);
 *  - business_type_questions folded into business_type data.question_ids;
 *  - one agency node per distinct document agency string;
 *  - document nodes annotated with recommended/order/legacy_code from the
 *    pack's docMappings so those become admin-editable.
 */
export function buildSeedNodes(): SeedNode[] {
  const kb = ACTIVE_JURISDICTION.kb;
  const { legacyCode, recommended, order } = ACTIVE_JURISDICTION.docMappings;
  const compat = ACTIVE_JURISDICTION.intakeCompat;
  const btq = businessTypeQuestionsJson as BtqRow[];

  const nodes: SeedNode[] = [];
  const push = (nodeType: NodeType, data: Record<string, unknown>) => {
    const entityId = String(data.id ?? "");
    nodes.push({ entityId, nodeType, label: labelForNode(nodeType, data), data });
  };

  for (const m of kb.municipalities) push("municipality", { ...m });

  // industries.json is loaded by the admin graph layer, not the engine KB —
  // derive industry nodes from the ids referenced by business types, enriched
  // from the bundled industries file when available.
  for (const ind of loadIndustries()) push("industry", { ...ind });

  const questionIdsByBt = new Map<string, string[]>();
  for (const row of btq) {
    const arr = questionIdsByBt.get(row.business_type_id) ?? [];
    arr.push(row.question_id);
    questionIdsByBt.set(row.business_type_id, arr);
  }

  for (const bt of kb.businessTypes) {
    push("business_type", { ...bt, question_ids: questionIdsByBt.get(bt.id) ?? [] });
  }

  const profileSet = new Set([...(compat?.profileStageQuestionIds ?? []), "Q_EMPLOYEE_COUNT"]);
  for (const q of kb.questions) {
    const uiKey = QUESTION_KEY_MAP[q.id]?.writeKey ?? compat?.uiKeyByQuestionId[q.id];
    push("intake_question", {
      ...q,
      stage: profileSet.has(q.id) ? "profile" : "discovery",
      ...(uiKey ? { ui_key: uiKey } : {}),
    });
  }

  const recommendedSet = new Set(recommended);
  const seenAgencies = new Map<string, string>(); // display name -> entity id
  const guidanceSources = new Map<string, { source: GuidanceConcept["sources"][number]; documents: string[] }>();
  for (const d of kb.documents) {
    const guidance = d.requirement_guidance as GuidanceConcept | undefined;
    for (const source of guidance?.sources ?? []) {
      const entry = guidanceSources.get(source.id) ?? { source, documents: [] };
      entry.documents.push(d.id);
      guidanceSources.set(source.id, entry);
    }
    if (d.agency && !seenAgencies.has(d.agency)) {
      seenAgencies.set(d.agency, slugAgency(d.agency));
    }
    const orderIdx = order.indexOf(d.id);
    push("document", {
      ...d,
      agency_id: d.agency ? seenAgencies.get(d.agency) : undefined,
      recommended: recommendedSet.has(d.id) ? true : undefined,
      order_hint: orderIdx >= 0 ? orderIdx : undefined,
      legacy_code: legacyCode[d.id],
    });
  }

  for (const [name, id] of seenAgencies) {
    push("agency", { id, name, level: guessAgencyLevel(name) });
  }
  for (const [id, { source, documents }] of guidanceSources) {
    push("regulatory_source", { id, name: source.citation, source_type: "guidance", legal_status: "effective",
      jurisdiction: source.agency === "Internal Revenue Service" ? "Federal" : source.agency === "Municipio de Bayamón" ? "Municipal" : "Puerto Rico",
      citation: source.citation, url: source.url, last_verified_at: source.lastVerified, source_version: source.sourceVersion,
      supports_document_ids: documents, supported_proposition: source.supports });
  }

  for (const renewal of kb.extensions?.renewals ?? []) {
    push("renewal", {
      id: `RNW_${String(renewal.document_id).replace(/^DOC_/, "")}`,
      name: `${String(renewal.document_id)} recurring filing`,
      ...renewal,
    });
  }

  for (const r of kb.rules) push("rule", { ...r });

  return nodes;
}

function guessAgencyLevel(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("municipal") || n.includes("municipio")) return "Municipal";
  if (n.includes("irs") || n.includes("federal") || n.includes("u.s.") || n.includes("epa") || n.includes("osha"))
    return "Federal";
  return "Commonwealth";
}

function loadIndustries(): Record<string, unknown>[] {
  return industriesJson as Record<string, unknown>[];
}
