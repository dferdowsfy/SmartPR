// Content only: resolve existing deterministic requirements. Never match obligations.
import { ACTIVE_JURISDICTION } from "./jurisdictions/index.ts";
import { runRulesEngine, type EngineInput, type KnowledgeBase } from "./rulesEngine.ts";
import { isHomeBasedLocation, isOnlineOnlyLocation } from "./locationTypes.ts";
import { duplicateGuidanceIds, validateGuidanceConcept, type GuidanceConcept, type GuidanceFactKey, type GuidanceSource } from "./guidance/model.ts";
import type { LangCode } from "./jurisdictions/types";

export interface TriggerFact {
  key: GuidanceFactKey;
  value: string | boolean;
  label: string;
  ruleIds: string[];
  conditionPath: string;
}
export interface RequirementGuidance {
  requirementId: string;
  status: "VALIDATED" | "GUIDANCE_NEEDS_REVIEW";
  reviewReasons: string[];
  triggerFacts: TriggerFact[];
  regulatoryReason: string;
  purpose: string;
  nextAction: string;
  consequenceOrNextStep: string;
  dependencies: string[];
  sources: GuidanceSource[];
  sourceVersion: string | null;
  // Existing renderer contract — unchanged UI.
  summary: string;
  whyThisApplies: string;
  whatThisIs: string;
  whatYouNeedToDo: string;
  whatHappensNext: string;
  triggeredBy: string[];
  satisfiesOrUnlocks: string[];
  sourceReferences: GuidanceSource[];
  lastVerified: string | null;
}
export interface GuidanceContext {
  language: LangCode;
  municipality?: string | null;
  businessTypeName?: string | null;
  discoveryAnswers: Record<string, unknown>;
  profile?: Record<string, unknown>;
  entityType?: string;
  /** User-edited core application fact; never inferred from location type. */
  occupancyType?: "owned" | "leased" | "other";
  kb?: KnowledgeBase;
  /** Exact normalized input used by the deterministic matcher. */
  engineInput?: EngineInput;
}
export interface GuidanceRequirement {
  document_id?: string;
  code: string;
  name: string;
  agency: string;
  reason: string;
  applicability?: string;
  triggerFacts?: string[];
}
const yes = (v: unknown) => v === true || v === "true" || v === "yes" || v === "Yes";
const no = (v: unknown) => v === false || v === "false" || v === "no" || v === "No";

/** Engine defaults (physical location => assumed lease) are not confirmed facts. */
function factValue(key: GuidanceFactKey, ctx: GuidanceContext): string | boolean | undefined {
  const p = ctx.profile ?? {}, a = ctx.discoveryAnswers;
  if (key === "entityType") return ctx.entityType;
  if (key === "municipality") return ctx.municipality || undefined;
  if (key === "businessType") return ctx.businessTypeName || undefined;
  const aliases: Partial<Record<GuidanceFactKey, string[]>> = {
    Q_ALCOHOL_SOLD: ["alcohol_sold"], Q_EMPLOYEES_HIRED: ["employees_hired", "employees_work_on_site"],
    Q_EXISTING_LEASE: ["existing_lease"], Q_PHYSICAL_LOCATION: ["physical_location"],
    Q_FOOD_PREPARED: ["food_prepared_or_sold", "food_prepared_on_site", "food_prepared"],
    Q_FOOD_SOLD: ["food_prepared_or_sold", "food_sold"],
    Q_CUSTOMERS_VISIT: ["customers_visit", "customers_on_site"],
  };
  const values = [a[key], p[key], ...(aliases[key] ?? []).flatMap(k => [a[k], p[k]])].filter(v => v !== undefined && v !== null);
  if (values.some(no)) return false;
  if (key === "Q_EXISTING_LEASE") {
    if (ctx.occupancyType === "owned" || ctx.occupancyType === "other" || yes(a.owns_property) || yes(p.owns_property) || yes(a.Q_OWNS_PROPERTY)) return false;
    if (ctx.occupancyType === "leased") return true;
  }
  if (key === "Q_PHYSICAL_LOCATION") {
    const location = typeof p.location_type === "string" ? p.location_type.trim() : "";
    if (!location || isOnlineOnlyLocation(location) || isHomeBasedLocation(location) || /mobile|mixed use/i.test(location)) return undefined;
    return true;
  }
  if (values.some(yes)) return true;
  if (key === "Q_EMPLOYEES_HIRED" && Number(p.number_of_employees) > 0) return true;
  return undefined;
}

/** A reviewed concept exists and its content is trustworthy, but this filing's
 *  applicability or trigger is not confirmed. What the document *is* and what it
 *  does are still accurate, so they are shown under conditional framing rather
 *  than replaced by the unexplained-requirement text, which teaches nothing. */
function provisional(concept: GuidanceConcept, ctx: GuidanceContext, reasons: string[]): RequirementGuidance {
  const lang = ctx.language, es = lang === "es";
  const render = (value: string) => value.replace(/\{municipality\}/g, String(ctx.municipality ?? "")).trim();
  const regulatoryReason = render(concept.regulatoryReason[lang]), purpose = render(concept.purpose[lang]);
  const nextAction = render(concept.nextAction[lang]), consequenceOrNextStep = render(concept.consequenceOrNextStep[lang]);
  const desc = caseDescriptor(ctx);
  const caveat = es
    ? `Aún no se ha confirmado que este requisito aplique a tu caso específico${desc ? ` (${desc})` : ""}; verifícalo antes de actuar.`
    : `Whether this requirement applies to your specific case${desc ? ` (${desc})` : ""} is not confirmed yet; verify it before acting.`;
  const why = `${caveat} ${regulatoryReason}`;
  return {
    requirementId: concept.requirementId, status: "GUIDANCE_NEEDS_REVIEW", reviewReasons: reasons,
    triggerFacts: [], regulatoryReason, purpose, nextAction, consequenceOrNextStep,
    dependencies: concept.dependencies, sources: concept.sources, sourceVersion: concept.version,
    summary: why, whyThisApplies: why, whatThisIs: purpose, whatYouNeedToDo: nextAction, whatHappensNext: consequenceOrNextStep,
    triggeredBy: [], satisfiesOrUnlocks: [consequenceOrNextStep], sourceReferences: concept.sources,
    lastVerified: concept.sources.map(s => s.lastVerified).sort()[0],
  };
}

/** Short, factual case descriptor from confirmed profile facts — never inferred.
 *  Used to make honest fallbacks contextual instead of generic. */
function caseDescriptor(ctx: GuidanceContext): string {
  const es = ctx.language === "es";
  const bt = (ctx.businessTypeName ?? "").trim();
  const muni = (ctx.municipality ?? "").trim();
  if (bt && muni) return es ? `${bt} en ${muni}` : `${bt} in ${muni}`;
  if (bt) return bt;
  if (muni) return es ? `tu negocio en ${muni}` : `your business in ${muni}`;
  return "";
}

function review(req: GuidanceRequirement, ctx: GuidanceContext, reasons: string[]): RequirementGuidance {
  const es = ctx.language === "es";
  const desc = caseDescriptor(ctx);
  const agency = (req.agency ?? "").trim();
  // Contextual but honest: name the confirmed facts that surfaced this
  // requirement (business type, municipality, agency) — never invent the
  // regulatory rationale SmartPR has not validated.
  const why = desc
    ? es
      ? `«${req.name}» surgió por tu caso específico (${desc}). SmartPR aún no tiene validada la base regulatoria exacta — confírmala${agency ? ` con ${agency}` : ""} antes de actuar.`
      : `“${req.name}” came up because of your specific case (${desc}). SmartPR hasn't validated the exact regulatory basis yet — confirm it${agency ? ` with ${agency}` : ""} before acting.`
    : es
      ? "SmartPR ha identificado este requisito, pero su fundamento regulatorio aún no se ha validado por completo."
      : "SmartPR has identified this requirement, but the regulatory rationale has not yet been fully validated.";
  const triggeredBy: string[] = [];
  if ((ctx.businessTypeName ?? "").trim()) triggeredBy.push(es ? `Tipo de negocio: ${ctx.businessTypeName!.trim()}` : `Business type: ${ctx.businessTypeName!.trim()}`);
  if ((ctx.municipality ?? "").trim()) triggeredBy.push(es ? `Municipio: ${ctx.municipality!.trim()}` : `Municipality: ${ctx.municipality!.trim()}`);
  return {
    requirementId: req.document_id ?? req.code, status: "GUIDANCE_NEEDS_REVIEW", reviewReasons: reasons,
    triggerFacts: [], regulatoryReason: "", purpose: "", nextAction: "", consequenceOrNextStep: "", dependencies: [], sources: [], sourceVersion: null,
    summary: why, whyThisApplies: why,
    whatThisIs: es ? "La descripción validada de este documento aún está pendiente." : "A validated description of this document is still pending.",
    whatYouNeedToDo: es
      ? `Confirma${agency ? ` con ${agency}` : ""} qué se exige exactamente en tu caso antes de actuar.`
      : `Confirm${agency ? ` with ${agency}` : ""} exactly what is required in your case before acting.`,
    whatHappensNext: es ? "No se ha validado qué autoriza o acredita su cumplimiento." : "What completion authorizes or establishes has not been validated.",
    triggeredBy, satisfiesOrUnlocks: [], sourceReferences: [], lastVerified: null,
  };
}

export function buildRequirementGuidance(req: GuidanceRequirement, ctx: GuidanceContext): RequirementGuidance {
  const kb = ctx.kb ?? ACTIVE_JURISDICTION.kb;
  const raw = kb.documents.find(d => d.id === req.document_id)?.requirement_guidance;
  const problems = validateGuidanceConcept(raw, req.document_id);
  if (problems.length) return review(req, ctx, problems);
  const concept = raw as GuidanceConcept;
  const concepts = kb.documents.map(d => d.requirement_guidance).filter((c): c is GuidanceConcept => validateGuidanceConcept(c).length === 0);
  // A copied explanation is untrustworthy content, so it still fails all the way closed.
  if (duplicateGuidanceIds(concepts).has(concept.requirementId)) return review(req, ctx, ["DUPLICATE_EXPLANATION"]);
  if (["conditional", "not_applicable", "recommended"].includes(req.applicability ?? "")) return provisional(concept, ctx, ["APPLICABILITY_NOT_CONFIRMED"]);
  const matches = ctx.engineInput ? runRulesEngine(kb, ctx.engineInput).debug.rulesMatched.filter(r => r.document_id === req.document_id) : [];
  const entityTrace = req.triggerFacts?.includes(`entityType:${ctx.entityType}`) && concept.conditions.some(g => g.some(t => t.key === "entityType" && t.equals === ctx.entityType));
  if (!matches.length && !entityTrace) return provisional(concept, ctx, ["MATCH_TRACE_MISSING"]);
  const group = concept.conditions.find(g => g.every(t => {
    const value = factValue(t.key, ctx);
    return t.equals === undefined ? typeof value === "string" && value.length > 0 : value === t.equals;
  }));
  if (!group) return provisional(concept, ctx, ["TRIGGER_UNCONFIRMED_OR_CONTRADICTED"]);
  const lang = ctx.language;
  const triggerFacts: TriggerFact[] = group.map(t => {
    const value = factValue(t.key, ctx)!;
    const ruleIds = matches.map(m => m.rule_id);
    return { key: t.key, value, label: t.equals === undefined || t.key === "municipality" ? `${t.label[lang]}: ${value}` : t.label[lang], ruleIds: entityTrace ? [...ruleIds, "entity_formation_exclusivity"] : ruleIds, conditionPath: `${concept.requirementId}.requirement_guidance.conditions.${concept.conditions.indexOf(group)}.${group.indexOf(t)}` };
  });
  const render = (value: string) => value.replace(/\{municipality\}/g, String(triggerFacts.find(f => f.key === "municipality")?.value ?? ""));
  const regulatoryReason = render(concept.regulatoryReason[lang]), purpose = render(concept.purpose[lang]);
  const nextAction = render(concept.nextAction[lang]), consequenceOrNextStep = render(concept.consequenceOrNextStep[lang]);
  const why = regulatoryReason;
  return {
    requirementId: concept.requirementId, status: "VALIDATED", reviewReasons: [], triggerFacts,
    regulatoryReason, purpose, nextAction, consequenceOrNextStep,
    dependencies: [...new Set([...concept.dependencies, ...(concept.conditionalDependencies ?? []).filter(d => d.entityType === ctx.entityType).map(d => d.documentId)])],
    sources: concept.sources, sourceVersion: concept.version,
    summary: why, whyThisApplies: why, whatThisIs: purpose, whatYouNeedToDo: nextAction, whatHappensNext: consequenceOrNextStep,
    triggeredBy: triggerFacts.map(f => f.label), satisfiesOrUnlocks: [consequenceOrNextStep], sourceReferences: concept.sources,
    lastVerified: concept.sources.map(s => s.lastVerified).sort()[0],
  };
}

/** Provision-level legal basis for a requirement, resolved from the regulatory
 * knowledge graph (rule citation first, then the required document's citation).
 * Returns null when neither the triggering rule nor the document carries a
 * citation — the UI then shows no legal-basis line rather than inventing one. */
export interface LegalBasis {
  ruleId: string | null;
  citation: string;
  url: string | null;
  confidence: string | null;
  /** Document id the citation was inherited from, when the rule itself has no rule-specific citation. */
  inheritedFromDocument: string | null;
}

interface CitationCarrier {
  citation?: unknown;
  citation_url?: unknown;
  citation_confidence?: unknown;
  citation_inherited_from?: unknown;
}

const citationText = (c: CitationCarrier | undefined): string =>
  typeof c?.citation === "string" ? c.citation : "";

export function legalBasisFor(
  sourceRuleId: string | null | undefined,
  documentId: string | null | undefined,
  kb: KnowledgeBase,
): LegalBasis | null {
  const rules = kb.rules as (KnowledgeBase["rules"][number] & CitationCarrier & { requires_document_id?: unknown })[];
  const docs = kb.documents as (KnowledgeBase["documents"][number] & CitationCarrier)[];
  const rule = rules.find((r) => r.id === sourceRuleId);
  const ruleCitation = citationText(rule);
  if (rule && ruleCitation.length > 10) {
    return {
      ruleId: rule.id,
      citation: ruleCitation,
      url: typeof rule.citation_url === "string" ? rule.citation_url : null,
      confidence: typeof rule.citation_confidence === "string" ? rule.citation_confidence : null,
      inheritedFromDocument:
        typeof rule.citation_inherited_from === "string" ? rule.citation_inherited_from : null,
    };
  }
  const docId =
    (typeof rule?.requires_document_id === "string" && rule.requires_document_id) || documentId;
  const doc = docs.find((d) => d.id === docId);
  const docCitation = citationText(doc);
  if (doc && docCitation.length > 10) {
    return {
      ruleId: rule?.id ?? null,
      citation: docCitation,
      url: typeof doc.citation_url === "string" ? doc.citation_url : null,
      confidence: typeof doc.citation_confidence === "string" ? doc.citation_confidence : null,
      inheritedFromDocument: doc.id,
    };
  }
  return null;
}
