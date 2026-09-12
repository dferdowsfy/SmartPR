import { puertoRicoPack } from "../../jurisdictions/pr";
import { runRulesEngine, type EngineInput } from "../../rulesEngine";
import { classifyEngineRequirements } from "../../requirementApplicability";
import { buildRequirementGuidance } from "../../requirementGuidance";
import { readinessWeightFor } from "../../kb";
import { emptyCanonicalData } from "../../forms/engine/types";
import type { LegalStatus } from "../../rk/types";

// A build-pinned copy: never initKbFromServer/applyKbSnapshot, never a live DB.
const DEMO_KB = structuredClone(puertoRicoPack.kb);
export const DEMO_VERSION = "enterprise-v1";
export const COMPANY = "Caribe Industrial Manufacturing LLC";
export const DEMO_DATE = "2026-09-12";
export const tenant = {
  name: COMPANY, logoUrl: null as string | null, accent: "#245c5c",
  customDomain: null as string | null,
  terminology: { project: "Project", portfolio: "Enterprise portfolio" },
  roles: ["internal", "client"] as const,
};

export const projectSeeds = [
  { id: "guaynabo", title: "Guaynabo Facility Expansion", municipality: "Guaynabo", type: "Furniture Manufacturing", activity: "New production area · modifications to an existing industrial facility", employees: 120, renovations: true, owner: "Elena Rivera", actionDate: "2026-09-18" },
  { id: "bayamon", title: "Bayamón Warehouse", municipality: "Bayamón", type: "Warehouse Operator", activity: "Existing warehouse · annual filing review", employees: 36, renovations: false, owner: "Daniel Vega", actionDate: "2026-09-22" },
  { id: "carolina", title: "Carolina Distribution Facility", municipality: "Carolina", type: "Warehouse Distributor", activity: "Existing distribution operation · evidence review", employees: 48, renovations: false, owner: "Sofía Torres", actionDate: "2026-09-25" },
  { id: "caguas", title: "Caguas Operations Site", municipality: "Caguas", type: "Furniture Manufacturing", activity: "Production support · existing facility modification", employees: 64, renovations: true, owner: "Luis Méndez", actionDate: "2026-09-28" },
  { id: "ponce", title: "Ponce Storage Facility", municipality: "Ponce", type: "Warehouse Operator", activity: "Existing storage facility · compliance evidence review", employees: 22, renovations: false, owner: "Ana Cruz", actionDate: "2026-10-02" },
] as const;
export type ProjectId = typeof projectSeeds[number]["id"];
export type EvidenceStatus = "missing" | "review" | "verified";
export type EvidenceState = Record<string, EvidenceStatus>;

export function canonicalFor(id: ProjectId) {
  const p = projectSeeds.find(p => p.id === id)!;
  const c = emptyCanonicalData();
  c.business = { ...c.business, legalName: COMPANY, entityType: "limited_liability_company", formationStatus: "formed_in_puerto_rico", jurisdictionOfFormation: "Puerto Rico", activityDescription: p.activity, employeeCount: p.employees };
  // Clearly fictional address; no real customer identifiers in fixtures.
  c.addresses = { municipality: p.municipality, operatingAddress: { line1: "100 Avenida Ejemplo (fictional)", cityOrMunicipality: p.municipality, country: "Puerto Rico", stateOrTerritory: "PR", postalCode: "" } };
  c.addresses.principalPhysical = c.addresses.operatingAddress;
  c.property = { occupancyType: "leased" };
  c.contact = { fullName: p.owner, role: "Facility lead" };
  c.operations = { employeeCount: p.employees };
  return c;
}

export function buildProject(id: ProjectId, renovations?: boolean) {
  const p = projectSeeds.find(p => p.id === id)!;
  const input: EngineInput = { municipalityName: p.municipality, businessTypeName: p.type, answers: {
    Q_PHYSICAL_LOCATION: true, Q_EMPLOYEES_HIRED: true, Q_EXISTING_LEASE: true,
    Q_PRODUCTS_MANUFACTURED: p.type.includes("Manufacturing"), Q_RENOVATIONS: renovations ?? p.renovations,
  } };
  const result = runRulesEngine(DEMO_KB, input);
  const classified = classifyEngineRequirements(result.requirements, { kb: DEMO_KB, entityType: "limited_liability_company", recommendedIds: new Set(puertoRicoPack.docMappings.recommended) });
  const evaluated = classified.map(r => {
    const guidance = buildRequirementGuidance({ ...r, name: r.document_name }, {
      language: "en", municipality: p.municipality, businessTypeName: p.type,
      discoveryAnswers: input.answers, profile: { location_type: "Industrial Facility", number_of_employees: p.employees },
      entityType: "limited_liability_company", occupancyType: "leased", kb: DEMO_KB, engineInput: input,
    });
    // The current pack has some Bayamón-only sources under universal rules.
    // Do not silently treat those local sources as Guaynabo authority.
    const wrongMunicipality = p.municipality !== "Bayamón" && guidance.sources.some(s => /bayamon/i.test(s.url));
    const supported = r.mandatory && guidance.status === "VALIDATED" && !wrongMunicipality;
    return { ...r, name: r.document_name, guidance, supported, coverageReason: wrongMunicipality ? "The available municipal source covers Bayamón, not this facility. Local applicability needs review." : guidance.reviewReasons.includes("GUIDANCE_MISSING") ? "The rule matched, but this knowledge pack has no validated regulatory explanation. Review before creating an obligation." : "The rule matched, but the project-specific applicability is not confirmed. This is a review candidate, not an active obligation." };
  });
  return { ...p, input, trace: result.debug, requirements: evaluated.filter(r => r.supported), reviews: evaluated.filter(r => !r.supported), canonical: canonicalFor(id) };
}
export type DemoProject = ReturnType<typeof buildProject>;
export type DemoRequirement = DemoProject["requirements"][number];
export const projects = projectSeeds.map(p => buildProject(p.id));

export const evidenceKey = (project: ProjectId, document: string) => `${project}:${document}`;
export function seedEvidence(): EvidenceState {
  const state: EvidenceState = {};
  for (const [index, p] of projects.entries()) {
    for (const r of p.requirements) {
      const complete = ["DOC_EIN", "DOC_MERCHANT_REGISTRATION", "DOC_WORKERS_COMP"].includes(r.document_id);
      state[evidenceKey(p.id, r.document_id)] = complete ? "verified" : "missing";
      if (index === 2 && r.document_id === "DOC_ZONING") state[evidenceKey(p.id, r.document_id)] = "review";
      if (index === 4 && r.document_id === "DOC_ZONING") state[evidenceKey(p.id, r.document_id)] = "verified";
    }
  }
  return state;
}
export function readiness(p: DemoProject, evidence: EvidenceState) {
  // Same production weighting helper; pinned pack has no custom weights.
  // Only verified requirement evidence earns credit. Review earns zero.
  const weight = readinessWeightFor(p.requirements, {});
  const complete = p.requirements.filter(r => evidence[evidenceKey(p.id, r.document_id)] === "verified");
  const review = p.requirements.filter(r => evidence[evidenceKey(p.id, r.document_id)] === "review");
  const missing = p.requirements.filter(r => !["verified", "review"].includes(evidence[evidenceKey(p.id, r.document_id)]));
  const points = p.requirements.map(r => ({ id: r.document_id, weight: weight(r), earned: complete.includes(r) ? weight(r) : 0 }));
  return { score: Math.round(points.reduce((s, r) => s + r.earned, 0)), complete, review, missing, points, total: p.requirements.length };
}

export const regulatoryStates: { label: string; legalStatus: LegalStatus; description: string }[] = [
  { label: "Proposed legislation", legalStatus: "proposed", description: "Monitor only. Does not change active project requirements." },
  { label: "Pending regulatory change", legalStatus: "under_review", description: "Human review and impact assessment are pending. No project action." },
  { label: "Enacted, not yet effective", legalStatus: "signed", description: "Schedule only after approval and verification of the effective date." },
  { label: "Effective requirement", legalStatus: "effective", description: "Eligible for a reviewed publication; affected projects must be evaluated." },
  { label: "Superseded requirement", legalStatus: "superseded", description: "Retain the historical version and its provenance for audit." },
];
// Read-only presentation of existing legal lifecycle vocabulary. This event
// never enters runRulesEngine or the production RK publication service.
export const regulatoryEvent = { id: "DEMO-EVENT-001", title: "Demo regulatory event", legalStatus: "proposed" as LegalStatus, reviewStatus: "draft", message: "Regulatory development being monitored — no action currently required.", beforeVersion: "Demo v1", candidateVersion: "Demo v2", effectiveDate: null, approvedBy: null };
