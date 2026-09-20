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
  if (key === "project_type") {
    // Project facts ride on the engine input, not the Q&A answers — the
    // construction-permit concept explains project_fact rule firings
    // (RULE_0643–RULE_0646), which no discovery question covers. Without
    // this the card hedges "not confirmed yet" under a REQUIRED badge.
    // (2026-09-18 QA, live S30: REQUIRED OGPe construction permit with a
    // "whether this applies ... is not confirmed yet" disclosure.)
    const v = ctx.engineInput?.projectFacts?.["project_type"];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  }
  const aliases: Partial<Record<GuidanceFactKey, string[]>> = {
    Q_ALCOHOL_SOLD: ["alcohol_sold"], Q_EMPLOYEES_HIRED: ["employees_hired", "employees_work_on_site"],
    Q_EXISTING_LEASE: ["existing_lease"], Q_PHYSICAL_LOCATION: ["physical_location"],
    Q_FOOD_PREPARED: ["food_prepared_or_sold", "food_prepared_on_site", "food_prepared"],
    Q_FOOD_SOLD: ["food_prepared_or_sold", "food_sold"],
    Q_CUSTOMERS_VISIT: ["customers_visit", "customers_on_site"],
    Q_FEDERAL_CONTRACTS_GRANTS: ["federal_contracts_grants"],
    Q_OFFERS_CONSTRUCTION_SERVICES: ["offers_construction_services"],
    Q_COMMERCIAL_VEHICLES: ["commercial_vehicles"],
    Q_HAZMAT_TRANSPORT: ["hazmat_transport"],
    Q_AGRICULTURE_PRODUCTION: ["agriculture_production"],
    Q_SHORT_TERM_RENTAL: ["short_term_rental"],
    Q_GUESTS_OVERNIGHT: ["guests_stay_overnight"],
    // REG-GUIDE-SIGN-001 (2026-09-20 QA): the signage question fires
    // RULE_0030; the bundled flow answers it by writeKey.
    Q_COMMERCIAL_SIGNAGE: ["commercial_signage"],
  };
  const values = [a[key], p[key], ...(aliases[key] ?? []).flatMap(k => [a[k], p[k]])].filter(v => v !== undefined && v !== null);
  if (values.some(no)) return false;
  if (key === "Q_EXISTING_LEASE") {
    // All of these are USER-PROVIDED facts (passport occupancyType, explicit
    // owns_property answers) — never engine defaults. There is no
    // physical-location-implies-lease inference here or anywhere else: a
    // location may be owned, so a missing lease answer stays unknown and
    // the guidance falls through to provisional/verify framing.
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

/** Contextual lead: names the exact facts that triggered this requirement, so "why
 *  you need this" reads as *their* story — the detail a professional scans for —
 *  instead of a generic paragraph. Only regulatorily-relevant trigger facts are
 *  named: the case descriptor (business type, municipality) is deliberately
 *  excluded so an explanation never implies a jurisdictional or business-type
 *  connection the rule does not assert. The regulatory reason itself is
 *  untouched validated content. */
function contextualLead(triggerFacts: TriggerFact[], ctx: GuidanceContext): string {
  const es = ctx.language === "es";
  const facts = triggerFacts.map(f => (f.label ?? "").trim()).filter(Boolean).join("; ");
  if (!facts) return "";
  return es ? `Tu situación: ${facts}.` : `Your situation: ${facts}.`;
}

/** Puerto Rican Spanish renderings of the jurisdiction pack's municipality
 *  flag-advisory texts (flagAdvisories[].why), keyed by potential_* requirement
 *  code. The pack authors these advisories in English only; the L() dictionary
 *  has no entries for them, so without this map a Spanish filing would show
 *  English advisory sentences inside the disclosure — a standing
 *  PR-Spanish-only violation. Keep each entry paired with its pack `why`
 *  source; if the pack text changes, update the translation to match.
 *  (2026-09-18 QA: REG-GUIDE-ADVISORY-001's advisory() path rendered the
 *  English req.reason verbatim under language === "es".) */
export const POTENTIAL_ADVISORY_REASON_ES: Record<string, string> = {
  potential_island:
    "Vieques y Culebra dependen de la lancha de la Autoridad de Transporte Marítimo (ATM) para mover inventario, empleados y clientes, y tienen capacidad limitada en el vertedero. Los negocios de hospitalidad, comida, comercio y excursiones típicamente necesitan un manifiesto de logística de la ATM y un contrato de recogido de desperdicios comerciales.",
  potential_coastal:
    "Este municipio está en zona costera. Los negocios que operen cerca de la zona marítimo-terrestre pueden requerir una revisión ambiental o costera según la ubicación y las actividades.",
  potential_tourism:
    "Este municipio es una zona designada de turismo. Los negocios que atienden visitantes (hospedaje, excursiones, experiencias, transporte) pueden tener que registrarse en la Compañía de Turismo de Puerto Rico.",
  potential_historic:
    "Este municipio tiene una zona histórica designada. Los negocios de hospitalidad, comida y bebida, comercio y cuidado personal que operen en la zona histórica enfrentan revisión adicional: preservación de fachada, aprobación para alteraciones estructurales o interiores, y reglas más estrictas para los letreros, distintas al permiso de letrero regular.",
  potential_metro:
    "Este municipio es un área metropolitana grande con ordenanzas municipales adicionales. Según el tamaño y la ubicación del negocio, puede aplicar revisión suplementaria de zonificación, tránsito o revisión municipal.",
  potential_capital:
    "San Juan aplica ordenanzas propias además de los requisitos metro regulares (preservación de fachadas en el Viejo San Juan, ordenanza de ruido más estricta, zonas de carga designadas y el Permiso de Uso municipal de San Juan).",
  potential_industrial_port:
    "Ponce, Cataño, Guayanilla, Salinas y Yabucoa están en el corredor industrial y portuario de Puerto Rico. Los negocios de manufactura, logística y manejo de desperdicios aquí enfrentan descarga de punto fijo bajo EPA/JCA (NPDES industrial), registro como manejador de desperdicios peligrosos bajo RCRA, emisiones al aire bajo Título V y autorización de atraque de la Autoridad de los Puertos — obligaciones que no aplican a los pueblos costeros ordinarios.",
  potential_airport_host:
    "Carolina (LMM/SJU), Aguadilla (BQN) y Ponce (Mercedita) tienen aeropuertos con aduana activa. La logística de carga aérea, los consolidadores, los importadores y los alquileres de carros cerca del aeropuerto enfrentan fianzas de corretaje de aduana de CBP, certificación de TSA como Known Shipper / Indirect Air Carrier y acuerdos de concesión aeroportuaria que no aplican en otros lugares.",
};

/** A user-confirmed municipality advisory (potential_* requirement): not a KB
 *  document, so no validated concept exists — and none is pending. The
 *  jurisdiction pack's authored advisory text IS the honest explanation;
 *  rendering the unvalidated-document placeholder for it is wrong. */
function advisory(req: GuidanceRequirement, ctx: GuidanceContext): RequirementGuidance {
  const lang = ctx.language, es = lang === "es";
  const rawReason = (req.reason ?? "").trim();
  // The pack authors advisory text in English only: under "es" resolve the
  // PR-Spanish rendering by requirement code so no English sentence leaks
  // into a Spanish disclosure. Unknown codes fall back to the passed reason.
  const reason = es ? (POTENTIAL_ADVISORY_REASON_ES[req.code ?? ""] ?? rawReason) : rawReason;
  const agency = (req.agency ?? "").trim();
  const confirmed = es
    ? "Confirmaste durante la evaluación que esto aplica a tu caso."
    : "You confirmed during the assessment that this applies to your case.";
  const doNext = agency
    ? (es ? `Verifica con ${agency} qué revisión municipal aplica a tu operación antes de actuar.` : `Check with ${agency} which municipal review applies to your operation before acting.`)
    : (es ? "Verifica con el municipio qué revisión aplica a tu operación antes de actuar." : "Check with the municipality which review applies to your operation before acting.");
  const thenWhat = es
    ? "Esto queda en tu lista como una condición municipal por aclarar; no es un permiso que se solicita por separado."
    : "This stays on your checklist as a municipal condition to clear; it is not a separate permit application.";
  const why = `${confirmed} ${reason}`;
  return {
    requirementId: req.code, status: "VALIDATED", reviewReasons: [],
    triggerFacts: [], regulatoryReason: reason, purpose: reason, nextAction: doNext,
    consequenceOrNextStep: thenWhat,
    dependencies: [], sources: [], sourceVersion: null,
    summary: why, whyThisApplies: why, whatThisIs: reason,
    whatYouNeedToDo: doNext, whatHappensNext: thenWhat,
    triggeredBy: [], satisfiesOrUnlocks: [thenWhat], sourceReferences: [], lastVerified: null,
  };
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
  // User-confirmed municipality advisories (potential_* items) are not KB
  // documents: their authored flagAdvisory text is the explanation, so they
  // never take the unvalidated-document placeholder path below.
  // (2026-09-18 QA, live S37: the "Additional Municipal Review" card showed
  // "A validated description of this document is still pending.")
  if (!req.document_id && (req.code ?? "").startsWith("potential_") && (req.reason ?? "").trim()) {
    return advisory(req, ctx);
  }
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
  // REG-GUIDE-BTID-001 (2026-09-20 QA): per-BT `equals: "BT_*"` conditions
  // (22 across the pack) could never match — factValue("businessType")
  // returns the display name, never the BT id. A fired business-type rule
  // is the honest trigger, so match these conditions against the fired
  // rules' business_type_id. Presentation-only: firing/gating untouched.
  const firedBtIds = new Set(
    (kb.rules as { id?: string; business_type_id?: string | null }[])
      .filter(r => r && matches.some(m => m.rule_id === r.id))
      .map(r => r.business_type_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  const group = concept.conditions.find(g => g.every(t => {
    if (t.key === "businessType" && typeof t.equals === "string" && t.equals.startsWith("BT_")) {
      return firedBtIds.has(t.equals);
    }
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
  const lead = contextualLead(triggerFacts, ctx);
  const why = lead ? `${lead} ${regulatoryReason}` : regulatoryReason;
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

/**
 * Internal filenames must never render to users as a "Legal basis".
 * Validated-review citations carry the workbook filename for the audit
 * trail (e.g. "Validated review 2026-09-16
 * (SmartPR_25_Goldens_Validated_Review.xlsx)"); the KB keeps that text,
 * but the user-facing label strips the parenthesized internal filename so
 * the basis reads as a validated review, not a file on someone's disk.
 * (2026-09-17 QA: the filename rendered verbatim on live requirement
 * cards.)
 */
const INTERNAL_FILENAME = /\s*\([^)]*\.(xlsx|xls|csv|ts|tsx|js|json|md|pdf)\)/i;
const displayCitation = (raw: string): string =>
  raw.replace(INTERNAL_FILENAME, "").replace(/\s{2,}/g, " ").trim();

/**
 * A "Validated review …" citation is provenance (the rule was reviewed), not a
 * legal basis (a statute, regulation, or ordinance the user can verify). When
 * the guidance concept itself is unvalidated — the card body honestly says
 * "SmartPR hasn't validated the exact regulatory basis yet" — rendering that
 * provenance as "Legal basis: Validated review 2026-09-16" contradicts the
 * card's own disclosure. (2026-09-17 QA, live S12: the REQUIRED Domiciliary
 * Use card carried both.) Suppress review-type citations for unvalidated
 * concepts; genuine statutory citations still render.
 */
const REVIEW_CITATION = /^\s*validated review\b/i;
const isReviewCitation = (raw: string): boolean => REVIEW_CITATION.test(displayCitation(raw));

export function legalBasisFor(
  sourceRuleId: string | null | undefined,
  documentId: string | null | undefined,
  kb: KnowledgeBase,
  guidanceStatus?: "VALIDATED" | "GUIDANCE_NEEDS_REVIEW",
): LegalBasis | null {
  const rules = kb.rules as (KnowledgeBase["rules"][number] & CitationCarrier & { requires_document_id?: unknown })[];
  const docs = kb.documents as (KnowledgeBase["documents"][number] & CitationCarrier)[];
  const unvalidated = guidanceStatus === "GUIDANCE_NEEDS_REVIEW";
  const rule = rules.find((r) => r.id === sourceRuleId);
  const ruleCitation = citationText(rule);
  if (rule && ruleCitation.length > 10) {
    if (unvalidated && isReviewCitation(ruleCitation)) return null;
    return {
      ruleId: rule.id,
      citation: displayCitation(ruleCitation),
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
    if (unvalidated && isReviewCitation(docCitation)) return null;
    return {
      ruleId: rule?.id ?? null,
      citation: displayCitation(docCitation),
      url: typeof doc.citation_url === "string" ? doc.citation_url : null,
      confidence: typeof doc.citation_confidence === "string" ? doc.citation_confidence : null,
      inheritedFromDocument: doc.id,
    };
  }
  return null;
}
