// ============================================================================
// Snapshot compiler — PURE projection of active graph nodes into the
// KnowledgeBase-shaped JSON the live rules engine consumes (plus extensions
// the engine ignores). No pg imports; callable from server code and tests.
//
// Round-trip guarantee: node `data` is the canonical record (seeded verbatim
// from the bundled kb JSON), so compiling the seed reproduces the bundled KB
// exactly on every engine-relevant key. goldenCompare() verifies that.
// ============================================================================

import type { CompiledKb, NodeType } from "./types";
import { duplicateGuidanceIds, validateGuidanceConcept, type GuidanceConcept } from "../guidance/model";
import { KNOWN_FLAGS, NODE_TYPE_CONFIGS, RULE_TYPES } from "./registry";

export interface CompileNode {
  entityId: string;
  nodeType: NodeType;
  data: Record<string, unknown>;
}

const byId = (a: CompileNode, b: CompileNode) => a.entityId.localeCompare(b.entityId);

export function compileKb(
  nodes: CompileNode[],
  meta: { version: number; batchId: string | null }
): CompiledKb {
  const pick = (t: NodeType) => nodes.filter((n) => n.nodeType === t).sort(byId);
  const datas = (t: NodeType) => pick(t).map((n) => ({ ...n.data }));

  const businessTypes = pick("business_type");
  const businessTypeQuestions: { business_type_id: string; question_id: string }[] = [];
  for (const bt of businessTypes) {
    const qids = Array.isArray(bt.data.question_ids) ? (bt.data.question_ids as string[]) : [];
    for (const q of qids) {
      if (typeof q === "string" && q) {
        businessTypeQuestions.push({ business_type_id: bt.entityId, question_id: q });
      }
    }
  }

  const documents = pick("document");
  const sourceNodes = new Map(pick("regulatory_source").map(n => [n.entityId, n.data]));
  for (const document of documents) {
    const guidance = document.data.requirement_guidance as GuidanceConcept | undefined;
    if (!guidance || guidance.validationStatus !== "validated") continue;
    const issues = validateGuidanceConcept(guidance, document.entityId);
    if (issues.length) throw new Error(`GUIDANCE_NEEDS_REVIEW: ${document.entityId}: ${issues.join(", ")}`);
    for (const reference of guidance.sources) {
      const source = sourceNodes.get(reference.id);
      if (!source || !["effective", "amended"].includes(String(source.legal_status)) || source.url !== reference.url || source.source_version !== reference.sourceVersion
        || !Array.isArray(source.supports_document_ids) || !source.supports_document_ids.includes(document.entityId)) {
        throw new Error(`GUIDANCE_NEEDS_REVIEW: ${document.entityId} requires an active, version-matched supporting source ${reference.id}`);
      }
    }
  }
  const duplicateGuidance = duplicateGuidanceIds(documents.map(d => d.data.requirement_guidance)
    .filter((g): g is GuidanceConcept => validateGuidanceConcept(g).length === 0));
  if (duplicateGuidance.size) throw new Error(`GUIDANCE_NEEDS_REVIEW: duplicated regulatory explanations on ${[...duplicateGuidance].join(", ")}`);
  const recommended: string[] = [];
  const weights: Record<string, number> = {};
  const legacyCode: Record<string, string> = {};
  const ordered: { id: string; hint: number }[] = [];
  for (const d of documents) {
    if (d.data.recommended === true) recommended.push(d.entityId);
    const w = d.data.score_weight;
    if (typeof w === "number" && isFinite(w) && w > 0) weights[d.entityId] = w;
    const lc = d.data.legacy_code;
    if (typeof lc === "string" && lc) legacyCode[d.entityId] = lc;
    const hint = d.data.order_hint;
    if (typeof hint === "number" && isFinite(hint)) ordered.push({ id: d.entityId, hint });
  }
  ordered.sort((a, b) => a.hint - b.hint);

  return {
    municipalities: datas("municipality"),
    businessTypes: businessTypes.map((n) => ({ ...n.data })),
    questions: datas("intake_question"),
    documents: documents.map((n) => ({ ...n.data })),
    rules: datas("rule"),
    industries: datas("industry"),
    businessTypeQuestions,
    docMeta: {
      recommended,
      order: ordered.map((o) => o.id),
      weights,
      legacyCode,
    },
    extensions: {
      agencies: datas("agency"),
      businessActivities: datas("business_activity"),
      exemptions: datas("exemption"),
      renewals: datas("renewal"),
      inspections: datas("inspection"),
      evidenceTypes: datas("evidence_type"),
      incentives: datas("incentive"),
      taxIncentives: datas("tax_incentive"),
      taxCredits: datas("tax_credit"),
      taxExemptions: datas("tax_exemption"),
      grants: datas("grant"),
      reimbursementPrograms: datas("reimbursement_program"),
      fundingPrograms: datas("funding_program"),
      eligibilityCriteria: datas("eligibility_criterion"),
      benefits: datas("benefit"),
      applicationWindows: datas("application_window"),
      projectFacts: datas("project_fact"),
      regulatorySources: datas("regulatory_source"),
    },
    meta: { version: meta.version, compiledAt: new Date().toISOString(), batchId: meta.batchId },
  };
}

// ---------------------------------------------------------------------------
// Golden parity check: every bundled row must exist in the compiled output and
// match on ALL of the bundled row's own keys (compiled rows may carry extra
// keys — the engine ignores them). Row sets must match exactly (no missing /
// no extra entities).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function jsonEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEq(v, b[i]));
  }
  if (typeof a === "object") {
    const ao = a as Row;
    const bo = b as Row;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => jsonEq(ao[k], bo[k]));
  }
  return false;
}

function compareArray(name: string, bundled: Row[], compiled: Row[], problems: string[]) {
  const compiledById = new Map(compiled.map((r) => [String(r.id), r]));
  if (bundled.length !== compiled.length) {
    problems.push(`${name}: row count mismatch (bundled ${bundled.length}, compiled ${compiled.length})`);
  }
  for (const row of bundled) {
    const got = compiledById.get(String(row.id));
    if (!got) {
      problems.push(`${name}: missing id ${row.id}`);
      continue;
    }
    for (const key of Object.keys(row)) {
      if (!jsonEq(row[key], got[key])) {
        problems.push(
          `${name}[${row.id}].${key}: bundled ${JSON.stringify(row[key])} != compiled ${JSON.stringify(got[key])}`
        );
      }
    }
  }
}

export interface GoldenBundle {
  municipalities: Row[];
  businessTypes: Row[];
  questions: Row[];
  documents: Row[];
  rules: Row[];
  businessTypeQuestions: { business_type_id: string; question_id: string }[];
}

/** Returns a list of discrepancies; empty = perfect parity. */
export function goldenCompare(compiled: CompiledKb, bundled: GoldenBundle): string[] {
  const problems: string[] = [];
  compareArray("municipalities", bundled.municipalities, compiled.municipalities, problems);
  compareArray("businessTypes", bundled.businessTypes, compiled.businessTypes, problems);
  compareArray("questions", bundled.questions, compiled.questions, problems);
  compareArray("documents", bundled.documents, compiled.documents, problems);
  compareArray("rules", bundled.rules, compiled.rules, problems);

  const pair = (r: { business_type_id: string; question_id: string }) =>
    `${r.business_type_id}::${r.question_id}`;
  const bundledSet = new Set(bundled.businessTypeQuestions.map(pair));
  const compiledSet = new Set(compiled.businessTypeQuestions.map(pair));
  for (const p of bundledSet) if (!compiledSet.has(p)) problems.push(`businessTypeQuestions: missing ${p}`);
  for (const p of compiledSet) if (!bundledSet.has(p)) problems.push(`businessTypeQuestions: extra ${p}`);
  return problems;
}

/**
 * Publication integrity gate (F08). Pure: validates the ACTIVE graph nodes
 * BEFORE they are compiled into a snapshot. publishBatch() refuses to publish
 * when this returns any problems, so a bad node (dangling ref, wrong-type
 * target, unknown rule type, duplicated/self edge, temporal inversion) can
 * never reach the live engine. Returns human-readable problem strings;
 * empty = safe to publish.
 */
const CANONICAL_ENTITY_TYPES = [
  "stock_corporation",
  "nonprofit_nonstock_corporation",
  "close_corporation",
  "professional_corporation",
  "foreign_corporation",
  "limited_liability_partnership",
  "limited_liability_company",
  "sole_proprietorship",
  "partnership",
  "other",
];

export function validatePublicationGraph(nodes: CompileNode[]): string[] {
  const problems: string[] = [];
  const byEntity = new Map<string, CompileNode>();
  for (const n of nodes) {
    if (byEntity.has(n.entityId)) {
      problems.push(`duplicate entity id: ${n.entityId}`);
    } else {
      byEntity.set(n.entityId, n);
    }
    if (String(n.data?.id ?? "") !== n.entityId) {
      problems.push(`${n.entityId || "(missing entity id)"}: data.id does not match the entity id`);
    }
  }

  const ref = (ownerId: string, field: string, id: unknown, type: NodeType) => {
    if (typeof id !== "string" || !id) return; // required-ness is validateNodeData's job
    const target = byEntity.get(id);
    if (!target) {
      problems.push(`${ownerId}: ${field} references missing node ${id}`);
    } else if (target.nodeType !== type) {
      problems.push(`${ownerId}: ${field} references ${id} (a ${target.nodeType}, expected ${type})`);
    }
  };

  for (const n of nodes) {
    const d: Record<string, unknown> = n.data ?? {};

    // Projected edges: no duplicates, no self edges, resolvable targets.
    const cfg = NODE_TYPE_CONFIGS[n.nodeType];
    if (cfg) {
      const seenEdges = new Set<string>();
      for (const e of cfg.edgesOf(d)) {
        const key = `${e.edgeType}→${e.toEntity}`;
        if (seenEdges.has(key)) problems.push(`${n.entityId}: duplicate projected edge ${key}`);
        seenEdges.add(key);
        if (e.toEntity === n.entityId) problems.push(`${n.entityId}: self edge ${key}`);
        if (!byEntity.has(e.toEntity)) problems.push(`${n.entityId}: edge ${key} targets a missing node`);
      }
    }

    if (n.nodeType === "rule") {
      const rt = String(d.rule_type ?? "");
      if (!RULE_TYPES.includes(rt)) problems.push(`${n.entityId}: unknown rule_type ${rt || "(missing)"}`);
      ref(n.entityId, "requires_document_id", d.requires_document_id, "document");
      ref(n.entityId, "business_type_id", d.business_type_id, "business_type");
      ref(n.entityId, "question_id", d.question_id, "intake_question");
      const flag = d.municipality_flag;
      if (typeof flag === "string" && flag && !KNOWN_FLAGS.includes(flag)) {
        problems.push(`${n.entityId}: unknown municipality_flag ${flag}`);
      }
      const excl = d.excluded_entity_types;
      const exclList = Array.isArray(excl) ? excl : typeof excl === "string" ? excl.split(",") : [];
      for (const et of exclList.map(String).map((s) => s.trim()).filter(Boolean)) {
        if (!CANONICAL_ENTITY_TYPES.includes(et)) {
          problems.push(`${n.entityId}: unknown excluded entity type ${et}`);
        }
      }
    }
    if (n.nodeType === "document") {
      ref(n.entityId, "agency_id", d.agency_id, "agency");
      const deps = Array.isArray(d.depends_on_document_ids) ? d.depends_on_document_ids : [];
      for (const dep of deps) ref(n.entityId, "depends_on_document_ids", dep, "document");
    }
    if (n.nodeType === "renewal") {
      ref(n.entityId, "document_id", d.document_id, "document");
    }
    if (n.nodeType === "regulatory_source") {
      const ids = Array.isArray(d.supports_document_ids) ? d.supports_document_ids : [];
      for (const sid of ids) ref(n.entityId, "supports_document_ids", sid, "document");
    }

    // Temporal sanity: an effective interval must not be inverted.
    const from = d.effective_from;
    const until = d.effective_until;
    if (from && until && String(from) > String(until)) {
      problems.push(`${n.entityId}: effective_from ${from} is after effective_until ${until}`);
    }
  }
  return problems;
}
