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
import agenciesJson from "../../kb/agencies.json";

interface AgencyEntry {
  id: string; name: string; role: string; level: string; jurisdiction: string;
  url?: string; aliases?: string[]; succeeds?: string[]; succession_note?: string;
}
const AGENCY_BY_NAME = new Map<string, AgencyEntry>();
for (const a of agenciesJson as AgencyEntry[]) {
  AGENCY_BY_NAME.set(a.name, a);
  for (const alias of a.aliases ?? []) AGENCY_BY_NAME.set(alias, a);
}

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
  const agencyIds = (d: { agency?: string; agency_canonical?: string; agency_ids?: unknown }): string[] => {
    if (Array.isArray(d.agency_ids) && d.agency_ids.length > 0) return d.agency_ids.map(String);
    const entry = AGENCY_BY_NAME.get(d.agency_canonical ?? "") ?? AGENCY_BY_NAME.get(d.agency ?? "");
    return entry ? [entry.id] : [];
  };
  const guidanceSources = new Map<string, { source: GuidanceConcept["sources"][number]; documents: string[] }>();
  for (const d of kb.documents) {
    const guidance = d.requirement_guidance as GuidanceConcept | undefined;
    for (const source of guidance?.sources ?? []) {
      const entry = guidanceSources.get(source.id) ?? { source, documents: [] };
      entry.documents.push(d.id);
      guidanceSources.set(source.id, entry);
    }
    const ids = agencyIds(d);
    const orderIdx = order.indexOf(d.id);
    push("document", {
      ...d,
      agency_id: ids[0],
      agency_ids: ids,
      recommended: recommendedSet.has(d.id) ? true : undefined,
      order_hint: orderIdx >= 0 ? orderIdx : undefined,
      legacy_code: legacyCode[d.id],
    });
  }

  // Agency nodes come from the canonical registry (kb/agencies.json): one node
  // per agency with its role (government / private_preparer / insurer /
  // property_owner / utility). Composite free-text agency strings are gone;
  // documents that genuinely involve two agencies carry agency_ids.
  for (const a of agenciesJson as AgencyEntry[]) {
    push("agency", {
      id: a.id, name: a.name, role: a.role, level: a.level,
      jurisdiction: a.jurisdiction, url: a.url,
      succeeds: a.succeeds, succession_note: a.succession_note,
    });
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

function loadIndustries(): Record<string, unknown>[] {
  return industriesJson as Record<string, unknown>[];
}
