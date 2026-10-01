// ============================================================================
// Regulatory ingestion pipeline (SERVER ONLY).
//
//   source raw text
//     → sectionize (ARTÍCULO / Sección / CAPÍTULO + English equivalents)
//     → classify per section: business_permitting | incentive_program |
//       construction_only | general
//     → extract proposed graph changes per relevant section
//         · xAI Responses API when XAI_API_KEY is set
//         · deterministic low-confidence flagging otherwise — the fallback
//           NEVER invents legal requirements, it only files sections for
//           human review
//     → rk_change_proposals rows (status ai_extracted, or draft when
//       confidence < 0.4) with confidence + citation per proposal
//
// Guardrails: nothing here touches active graph nodes; proposals from
// unenacted sources are blocked from publishable batches (batches.ts);
// construction-only provisions are skipped and counted.
// ============================================================================

import { randomUUID } from "crypto";
import { getPool } from "../graph/db";
import { createProposal, uniqueEntityId } from "./proposals";
import { newEntityId } from "./registry";
import { getSource } from "./sources";
import { ensureRkReady } from "./store";
import { writeAudit } from "./audit";
import { NODE_TYPE_CONFIGS } from "./registry";
import type { NodeType, ProposalClassification, SourceSection } from "./types";
import { generateText, isAiConfigured } from "../../lib/ai/router";

const MAX_SECTIONS = 150;
const MAX_SECTION_CHARS = 6000;
const MAX_AI_SECTIONS = 30; // LLM cost cap per run
const CONFIDENCE_FLOOR = 0.4; // below this a proposal stays a draft

// ---------------------------------------------------------------------------
// 1. Sectionizer
// ---------------------------------------------------------------------------

const HEADING_RE =
  /^[ \t]*((?:ART[IÍ]CULO|CAP[IÍ]TULO|SECCI[OÓ]N|ARTICLE|CHAPTER|SECTION|Art[ií]culo|Cap[ií]tulo|Secci[oó]n)\s+[\dIVXLCDM]+(?:\.\d+)*[.\-–—]?)\s*(.{0,120})$/gm;

export function sectionize(raw: string): SourceSection[] {
  const text = raw.replace(/\r\n?/g, "\n");
  const matches = [...text.matchAll(HEADING_RE)];
  if (matches.length === 0) {
    // No recognizable headings — treat the whole document as one section.
    return [
      {
        key: "document",
        heading: "Full document",
        text: text.slice(0, MAX_SECTION_CHARS),
        classification: classifySectionText(text),
      },
    ];
  }
  const sections: SourceSection[] = [];
  // Preamble before the first heading.
  const preamble = text.slice(0, matches[0].index).trim();
  if (preamble.length > 200) {
    sections.push({
      key: "preamble",
      heading: "Preamble / Exposición de Motivos",
      text: preamble.slice(0, MAX_SECTION_CHARS),
      classification: classifySectionText(preamble),
    });
  }
  for (let i = 0; i < matches.length && sections.length < MAX_SECTIONS; i++) {
    const m = matches[i];
    const start = m.index ?? 0;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(start, end).trim();
    const key = m[1].replace(/\s+/g, " ").replace(/[.\-–—]$/, "").trim();
    sections.push({
      key,
      heading: `${key}${m[2] ? " — " + m[2].trim() : ""}`.slice(0, 160),
      text: body.slice(0, MAX_SECTION_CHARS),
      classification: classifySectionText(body),
    });
  }
  return sections;
}

// ---------------------------------------------------------------------------
// 2. Classifier: business-permitting vs construction-only vs general
// ---------------------------------------------------------------------------

const BUSINESS_KEYWORDS = [
  "permiso único", "permiso unico", "patente", "licencia", "negocio", "comercio",
  "comerciante", "registro de comerciante", "licencia sanitaria", "salud ambiental",
  "bomberos", "prevención de incendios", "bebidas alcohólicas", "alcohol",
  "turismo", "alquiler a corto plazo", "hospedería", "restaurante", "farmacia",
  "salón de belleza", "barbería", "cuido de niños", "food truck", "vendedor ambulante",
  "hacienda", "ivu", "uso comercial", "certificado de uso", "single business portal",
  "business license", "merchant registration", "permit", "license", "operar un negocio",
  "microempresa", "pequeño comerciante", "renovación", "inspección sanitaria",
];

const INCENTIVE_KEYWORDS = [
  "incentivo", "crédito contributivo", "credito contributivo", "exención contributiva",
  "exencion contributiva", "decreto contributivo", "subvención", "subvencion", "beca",
  "reembolso", "financiamiento", "fondo rotatorio", "beneficio contributivo",
  "elegibilidad", "solicitud de incentivo", "empleos creados", "inversión elegible",
  "inversion elegible", "tax incentive", "tax credit", "tax exemption", "grant program",
  "reimbursement program", "funding program", "eligible business", "application window",
];

const CONSTRUCTION_KEYWORDS = [
  "construcción", "construccion", "obra", "edificación", "edificacion",
  "estructural", "demolición", "demolicion", "excavación", "excavacion",
  "código de construcción", "codigo de construccion", "building code",
  "permiso de construcción", "permiso de construccion", "plano de construcción",
  "zapatas", "hormigón", "hormigon", "instalación eléctrica soterrada",
  "movimiento de tierra", "urbanización", "lotificación", "lotificacion",
  "construction permit", "structural",
];

export function classifySectionText(text: string): string {
  const t = text.toLowerCase();
  const hits = (keys: string[]) => keys.reduce((n, k) => (t.includes(k) ? n + 1 : n), 0);
  const incentive = hits(INCENTIVE_KEYWORDS);
  const biz = hits(BUSINESS_KEYWORDS);
  const con = hits(CONSTRUCTION_KEYWORDS);
  if (incentive > 0) return "incentive_program";
  // Construction-only provisions are excluded UNLESS they also touch business
  // licensing directly (spec) — a section with both counts as business.
  if (biz > 0) return "business_permitting";
  if (con > 0) return "construction_only";
  return "general";
}

// ---------------------------------------------------------------------------
// 3. AI extraction (xAI) with deterministic fallback
// ---------------------------------------------------------------------------

interface ExtractedChange {
  action: "create" | "update";
  node_type: NodeType;
  /** existing entity id when the change modifies a known entity */
  entity_id?: string | null;
  data: Record<string, unknown>;
  classification: ProposalClassification;
  confidence: number;
  explanation: string;
}

const EXTRACTABLE_TYPES: NodeType[] = [
  "document", "rule", "agency", "renewal", "inspection", "exemption", "intake_question",
  "incentive", "tax_incentive", "tax_credit", "tax_exemption", "grant",
  "reimbursement_program", "funding_program", "eligibility_criterion", "benefit",
  "application_window", "project_fact", "regulatory_source",
];

const VALID_CLASSIFICATIONS: ProposalClassification[] = [
  "new_requirement", "modified_requirement", "removed_requirement", "new_exemption",
  "changed_agency_responsibility", "changed_form", "changed_eligibility_rule",
  "changed_deadline", "new_incentive", "modified_incentive", "expired_incentive",
  "changed_benefit", "no_action_required", "needs_legal_review",
];

async function extractWithLLM(
  sectionText: string,
  sectionKey: string,
  sourceTitle: string,
  catalog: string,
  sourceGraphEntityId: string
): Promise<ExtractedChange[] | null> {
  if (!isAiConfigured("regulatory_ingest")) return null;

  const system = `You are a Puerto Rico business-permitting and government-benefits regulatory analyst for SmartPR.
You read one section of a regulatory source and extract PROPOSED changes to a knowledge graph
of business permits/licenses and incentives. Scope includes permits, licenses, tax incentives,
tax credits, tax exemptions, grants, reimbursement programs, and funding programs for businesses.
EXCLUDE construction-only provisions unless they directly affect business licensing.

The graph source entity for this reviewed source is ${sourceGraphEntityId}. Every incentive candidate
must include it in authorized_by_ids. Extract only criteria, benefits, amounts, dates, agencies,
geographies, and industry applicability stated in this section. Never infer a threshold or benefit.

Existing graph entities you may reference by id (documents/permits and agencies):
${catalog}

Return STRICT JSON: {"changes": [{
  "action": "create" | "update",
  "node_type": ${EXTRACTABLE_TYPES.map((type) => `"${type}"`).join(" | ")},
  "entity_id": "<existing id when action=update, else null>",
  "data": { ...canonical fields for the node type... },
  "classification": one of ${JSON.stringify(VALID_CLASSIFICATIONS)},
  "confidence": 0.0-1.0,
  "explanation": "plain-language why, citing the provision"
}]}
Do not mark extracted requirement guidance as validated. Its regulatoryReason,
purpose, nextAction and consequenceOrNextStep must be requirement-specific and
traceable to the source; otherwise retain a needs_review candidate. Never invent
trigger facts or infer that a prepared application is issued evidence.
Field shapes: document {name, agency, category, doc_kind, guidance, citation};
rule {requirement_name, rule_type: "business_type"|"question_trigger"|"municipality"|"municipality_flag",
requires_document_id, business_type_id?, question_id?, expected_answer?, municipality_flag?,
mandatoriness, conditions, citation, guidance}; agency {name, acronym, level};
renewal {name, document_id, frequency_months, description, citation};
inspection {name, document_id, description, citation}; exemption {name, description, conditions, citation};
intake_question {question, type: "boolean", guidance};
incentive/tax_incentive/tax_credit/tax_exemption/grant/reimbursement_program/funding_program
{name, description, administering_agency_id, application_agency_id?, authorized_by_ids:["${sourceGraphEntityId}"],
industry_ids?, municipality_ids?, geography_level, geography_notes?, criterion_ids, evidence_type_ids?, benefit_ids,
application_window_id?, application_process?, program_status, effective_from?, effective_to?, last_verified_at,
source_version, compatible_incentive_ids?, conflicting_incentive_ids?, prerequisite_for_incentive_ids?,
supersedes?, superseded_by?, automatic_eligibility:false}; eligibility_criterion {name, description, project_fact_id, fact_key,
operator, expected_value?, expected_values?, required, material, question?, answer_type?, answer_options?, voluntary?,
legally_relevant?, evidence_type_ids?, citation}; benefit {name, description, benefit_type, amount_description?, citation};
application_window {name, opens_at?, closes_at?, rolling, description, last_verified_at, citation};
project_fact {name, fact_key, value_type, description?, sensitive?, voluntary?}.
RULES: never invent requirements not stated in the text; when the section changes nothing for
business permitting or incentive eligibility return {"changes": []}; low certainty -> low confidence;
leave unknown fields empty and classify needs_legal_review; do not mark automatic_eligibility true unless the
source explicitly establishes automatic eligibility; quote the provision
in "explanation". Answer with JSON only.`;

  try {
    const content = await generateText("regulatory_ingest", {
      input: [
        { role: "system", content: system },
        { role: "user", content: `Source: ${sourceTitle}\nSection ${sectionKey}:\n\n${sectionText.slice(0, 5000)}` },
      ],
      maxOutputTokens: 2500,
      temperature: 0.1,
      signal: AbortSignal.timeout(60_000),
    });
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    const raw = Array.isArray(parsed?.changes) ? parsed.changes : [];
    const out: ExtractedChange[] = [];
    for (const c of raw) {
      if (!c || typeof c !== "object") continue;
      const nodeType = c.node_type as NodeType;
      if (!EXTRACTABLE_TYPES.includes(nodeType)) continue;
      if (!c.data || typeof c.data !== "object") continue;
      if (nodeType === "document" && c.data.requirement_guidance && typeof c.data.requirement_guidance === "object") {
        // Enforcement, not just a prompt: AI cannot self-certify legal guidance.
        c.data.requirement_guidance.validationStatus = "needs_review";
      }
      const classification = VALID_CLASSIFICATIONS.includes(c.classification)
        ? (c.classification as ProposalClassification)
        : "needs_legal_review";
      if (classification === "no_action_required") continue;
      const confidence = Math.max(0, Math.min(1, Number(c.confidence) || 0.3));
      out.push({
        action: c.action === "update" ? "update" : "create",
        node_type: nodeType,
        entity_id: typeof c.entity_id === "string" && c.entity_id ? c.entity_id : null,
        data: c.data as Record<string, unknown>,
        classification,
        confidence,
        explanation: String(c.explanation ?? "").slice(0, 2000),
      });
    }
    return out;
  } catch (err) {
    console.error("[rk/ingest] LLM extraction failed:", (err as Error).message);
    return null;
  }
}

/**
 * Deterministic fallback when no LLM key is configured: file each
 * relevant section as a LOW-confidence draft source flag for human
 * review. It asserts nothing — the requirement_name is the section heading and
 * mandatoriness is informational.
 */
function fallbackExtract(section: SourceSection, sourceTitle: string): ExtractedChange[] {
  if (section.classification === "incentive_program") {
    // The source itself is already mirrored into a reviewable graph proposal.
    // Without extraction support, do not create even a placeholder program.
    return [];
  }
  return [
    {
      action: "create",
      node_type: "rule",
      entity_id: null,
      data: {
        requirement_name: `[REVIEW] ${section.heading}`.slice(0, 140),
        rule_type: "municipality",
        requires_document_id: "",
        mandatoriness: "informational",
        conditions: section.text.slice(0, 800),
        citation: `${sourceTitle} — ${section.key}`,
        guidance: "Flagged by deterministic ingestion (no AI key configured). A human must decide whether this provision changes any requirement.",
      },
      classification: "needs_legal_review",
      confidence: 0.2,
      explanation: `Section "${section.heading}" mentions business-permitting terms; no AI extraction was available, so it is flagged for manual review.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// 4. Run the pipeline
// ---------------------------------------------------------------------------

export interface IngestionResult {
  ok: boolean;
  message?: string;
  runId?: string;
  sections?: number;
  businessSections?: number;
  incentiveSections?: number;
  skippedConstruction?: number;
  proposalsCreated?: number;
  usedAI?: boolean;
}

export async function runIngestion(sourceId: string, actor?: string | null): Promise<IngestionResult> {
  const pool = getPool();
  if (!pool) return { ok: false, message: "no_database" };
  await ensureRkReady();

  const source = await getSource(sourceId);
  if (!source) return { ok: false, message: "source not found" };
  if (!source.raw_text || source.raw_text.trim().length < 50) {
    return { ok: false, message: "source has no text — paste the document text or upload a PDF first" };
  }

  const runId = randomUUID();
  const sections = sectionize(source.raw_text);
  await pool.query(`UPDATE rk_regulatory_sources SET sections_json = $2, updated_at = now() WHERE id = $1`, [
    sourceId,
    JSON.stringify(sections),
  ]);

  const businessSections = sections.filter((s) => s.classification === "business_permitting");
  const incentiveSections = sections.filter((s) => s.classification === "incentive_program");
  const relevantSections = [...businessSections, ...incentiveSections];
  const skippedConstruction = sections.filter((s) => s.classification === "construction_only").length;

  // Compact catalog of existing documents + agencies for the LLM to match against.
  const catalogRows = (
    await pool.query(
      `SELECT entity_id, node_type, label FROM rk_nodes
        WHERE status = 'active' AND node_type IN ('document','agency','industry','municipality','evidence_type',
          'incentive','tax_incentive','tax_credit','tax_exemption','grant','reimbursement_program',
          'funding_program','eligibility_criterion','benefit','application_window','project_fact','regulatory_source')
        ORDER BY node_type, entity_id`
    )
  ).rows as { entity_id: string; node_type: string; label: string }[];
  const catalog = catalogRows.map((r) => `${r.entity_id} (${r.node_type}): ${r.label}`).join("\n");

  const usedAI = isAiConfigured("regulatory_ingest");
  let proposalsCreated = 0;
  let sourceGraphEntityId = newEntityId("regulatory_source", source.title);

  // Incentive nodes must be traceable to a graph source entity. Mirror the
  // uploaded source as a reviewable proposal; do not auto-publish it.
  if (incentiveSections.length > 0) {
    const linked = (
      await pool.query(
        `SELECT entity_id FROM rk_nodes
          WHERE node_type = 'regulatory_source' AND status = 'active'
            AND data->>'ingestion_source_id' = $1
         UNION ALL
         SELECT entity_id FROM rk_change_proposals
          WHERE node_type = 'regulatory_source'
            AND status NOT IN ('rejected','merged','published')
            AND proposed_json->>'ingestion_source_id' = $1
         LIMIT 1`,
        [source.id]
      )
    ).rows[0] as { entity_id: string } | undefined;
    if (linked) {
      sourceGraphEntityId = linked.entity_id;
    } else {
      sourceGraphEntityId = await uniqueEntityId(
        "regulatory_source",
        sourceGraphEntityId
      );
      const sourceProposal = await createProposal({
        origin: "ai_extraction",
        changeKind: "create_node",
        nodeType: "regulatory_source",
        entityId: sourceGraphEntityId,
        data: {
          name: source.title,
          source_type: source.source_type,
          legal_status: source.legal_status,
          jurisdiction: source.jurisdiction === "PR" ? "Puerto Rico" : source.jurisdiction || "Puerto Rico",
          citation: source.citation || source.title,
          url: source.url || "",
          effective_date: source.effective_date,
          last_verified_at: source.updated_at,
          source_version: source.checksum || source.updated_at,
          ingestion_source_id: source.id,
        },
        classification: "needs_legal_review",
        confidence: source.url ? 0.95 : 0.7,
        aiExplanation: "Direct provenance mirror of the uploaded regulatory source. Review the official URL, citation, version, and effective date before publication.",
        citationSection: source.citation || source.title,
        sourceId: source.id,
        extractionRunId: runId,
        status: "under_review",
        actor: actor ?? "ingestion-agent",
      });
      if (sourceProposal.ok) proposalsCreated += 1;
    }
  }

  for (const section of relevantSections.slice(0, MAX_AI_SECTIONS)) {
    let changes = usedAI ? await extractWithLLM(section.text, section.key, source.title, catalog, sourceGraphEntityId) : null;
    if (changes === null) changes = fallbackExtract(section, source.title);

    for (const c of changes) {
      // Update proposals must reference a real active entity; otherwise create.
      let changeKind: "create_node" | "update_node" = "create_node";
      let entityId: string | undefined;
      let data = c.data;
      if (c.action === "update" && c.entity_id) {
        const existing = (
          await pool.query(`SELECT data FROM rk_nodes WHERE entity_id = $1 AND status = 'active' LIMIT 1`, [c.entity_id])
        ).rows[0] as { data: Record<string, unknown> } | undefined;
        if (existing) {
          changeKind = "update_node";
          entityId = c.entity_id;
          data = { ...existing.data, ...c.data }; // merge on top of current
        }
      }
      if (changeKind === "create_node" && !entityId) {
        const cfg = NODE_TYPE_CONFIGS[c.node_type];
        const base = cfg.labelOf(data) || section.key;
        entityId = await uniqueEntityId(c.node_type, newEntityId(c.node_type, base));
      }

      const result = await createProposal({
        origin: "ai_extraction",
        changeKind,
        nodeType: c.node_type,
        entityId,
        data,
        classification: c.classification,
        confidence: c.confidence,
        aiExplanation: c.explanation,
        citationSection: `${source.citation || source.title} — ${section.key}`,
        sourceId: source.id,
        extractionRunId: runId,
        status: c.confidence < CONFIDENCE_FLOOR ? "draft" : "ai_extracted",
        actor: actor ?? "ingestion-agent",
      });
      if (result.ok) proposalsCreated++;
    }
  }

  await writeAudit({
    actor: actor ?? "ingestion-agent",
    action: "ingestion_run",
    entityKind: "regulatory_source",
    entityId: sourceId,
    after: {
      runId,
      sections: sections.length,
      businessSections: businessSections.length,
      incentiveSections: incentiveSections.length,
      skippedConstruction,
      proposalsCreated,
      usedAI,
    },
  });

  return {
    ok: true,
    runId,
    sections: sections.length,
    businessSections: businessSections.length,
    incentiveSections: incentiveSections.length,
    skippedConstruction,
    proposalsCreated,
    usedAI,
  };
}
