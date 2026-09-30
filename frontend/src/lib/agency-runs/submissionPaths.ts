/**
 * Submission-path resolution for Clara (2026-09-28).
 *
 * Problem this solves: Clara used to receive a hand-written `procedureEn`
 * outline for every filing and was told to "adapt to what the portal actually
 * shows" — which meant improvising navigation on agency portals nobody had
 * ever walked. That is the brittleness: an outline is not a path.
 *
 * This module makes the path to submission EXPLICIT and DATA-DRIVEN for every
 * requirement in the KB, with four statuses:
 *
 * - "verified"      — a playbook was recorded from a real walk of this exact
 *                     filing flow. Clara executes it (adapting only when the
 *                     portal's actual screens differ, per the playbook's own
 *                     expectedState/onFail rules).
 * - "partial"       — portal identity is verified (allowlisted domains, entry
 *                     URL, login model) but no playbook was recorded. Clara
 *                     may open the portal and follow the outline ONLY as a
 *                     hypothesis: at the first screen that does not match, she
 *                     STOPS and reports instead of improvising (enforced by the
 *                     prompt guard in taskPrompt.ts). Her accurate report is
 *                     what lets the next run record a real playbook.
 * - "unknown"       — no filing config exists for this requirement. Clara must
 *                     NOT attempt a browser filing at all. She tells the user
 *                     what is known (agency, published entry point when the KB
 *                     has one) and the requirement is queued for portal recon.
 * - "not-applicable"— no browser path can exist: in-person, municipal-office,
 *                     mail, or third-party (landlord, insurer, architect).
 *                     Clara says so plainly instead of pretending a portal
 *                     route exists.
 *
 * Every status is derived from the filing registry, the KB documents, and the
 * form-artifact catalog — never invented. "Unknown" is a first-class answer,
 * not a gap: it is always better than a hallucinated path.
 */
import documentsJson from "../../kb/documents.json";
import {
  AGENCY_FILING_CONFIGS,
  type AgencyFilingConfig,
} from "./filingTypes";
import type { AgencyFilingType } from "./types";

export type SubmissionPathStatus =
  | "verified"
  | "partial"
  | "unknown"
  | "not-applicable";

interface KbDocument {
  id: string;
  name: string;
  agency: string;
  agency_url?: string;
  download_kind?: string;
}

const KB_DOCUMENTS = documentsJson as KbDocument[];

/** Agencies that are people/companies, not filing destinations. */
const THIRD_PARTY_AGENCIES = new Set([
  "Property Owner",
  "Property Registry",
  "Licensed Architect / Engineer",
  "Licensed Architect/Engineer",
  "Insurance Carrier",
]);

/** Municipal filings go to a physical office; no browser playbook applies
 *  unless a specific municipality publishes an online route (none verified). */
function isMunicipalAgency(agency: string): boolean {
  return /municipal/i.test(agency);
}

export interface SubmissionPath {
  requirementId: string;
  requirementName: string;
  status: SubmissionPathStatus;
  /** Filing config when one exists; null for unknown / not-applicable. */
  filingType: AgencyFilingType | null;
  agencyEn: string;
  /** Verified portal identity (partial+) or the KB's published entry point
   *  (unknown). Null when nothing is known. */
  portalEn: string | null;
  startUrl: string | null;
  /** Allowlisted domains when a filing config exists; empty otherwise. */
  domains: string[];
  needsLogin: boolean | null;
  /** Why this status — derived, never invented. */
  reasonEn: string;
  reasonEs: string;
  /** True when a portal recon walk is still needed to reach "verified". */
  reconNeeded: boolean;
}

function configForRequirement(
  requirementId: string
): AgencyFilingConfig | undefined {
  return AGENCY_FILING_CONFIGS.find(
    (c) =>
      c.id !== "DEMO_REHEARSAL_PORTAL" &&
      c.requirementIds?.includes(requirementId)
  );
}

function kbDocument(requirementId: string): KbDocument | undefined {
  return KB_DOCUMENTS.find((d) => d.id === requirementId);
}

export function resolveSubmissionPath(
  requirementId: string
): SubmissionPath | null {
  const config = configForRequirement(requirementId);
  if (config) {
    const steps = config.playbook?.steps;
    const verified = Array.isArray(steps) && steps.length > 0;
    return {
      requirementId,
      requirementName: kbDocument(requirementId)?.name ?? config.labelEn,
      status: verified ? "verified" : "partial",
      filingType: config.id,
      agencyEn: config.agencyEn,
      portalEn: config.portalEn,
      startUrl: config.startUrl,
      domains: [...config.domains],
      needsLogin: config.needsLogin,
      reasonEn: verified
        ? `Recorded playbook (${steps!.length} steps) from a real walk of this filing flow.`
        : "Portal identity verified (domains, entry URL, login model); no recorded playbook yet — outline is a hypothesis, stop at first deviation.",
      reasonEs: verified
        ? `Guía registrada (${steps!.length} pasos) de un recorrido real de este trámite.`
        : "Identidad del portal verificada (dominios, URL de entrada, modelo de acceso); aún no hay guía registrada — el esquema es una hipótesis, detente ante la primera desviación.",
      reconNeeded: !verified,
    };
  }

  const doc = kbDocument(requirementId);
  if (!doc) return null;

  if (THIRD_PARTY_AGENCIES.has(doc.agency)) {
    return {
      requirementId,
      requirementName: doc.name,
      status: "not-applicable",
      filingType: null,
      agencyEn: doc.agency,
      portalEn: null,
      startUrl: null,
      domains: [],
      needsLogin: null,
      reasonEn: `Obtained from a third party (${doc.agency}), not an agency portal — no browser filing path exists.`,
      reasonEs: `Se obtiene de un tercero (${doc.agency}), no de un portal de agencia — no existe ruta de radicación en línea.`,
      reconNeeded: false,
    };
  }

  if (isMunicipalAgency(doc.agency)) {
    return {
      requirementId,
      requirementName: doc.name,
      status: "not-applicable",
      filingType: null,
      agencyEn: doc.agency,
      portalEn: null,
      startUrl: null,
      domains: [],
      needsLogin: null,
      reasonEn:
        "Filed in person at the municipal office — no verified online route for any municipality, so no browser playbook applies.",
      reasonEs:
        "Se radica en persona en la oficina municipal — ninguna municipalidad tiene una ruta en línea verificada, así que no aplica guía de navegador.",
      reconNeeded: false,
    };
  }

  return {
    requirementId,
    requirementName: doc.name,
    status: "unknown",
    filingType: null,
    agencyEn: doc.agency,
    portalEn: doc.agency,
    startUrl: doc.agency_url ?? null,
    domains: [],
    needsLogin: null,
    reasonEn: doc.agency_url
      ? `No filing config walked yet. The KB's published agency entry point is ${doc.agency_url} — portal recon still needed before Clara attempts this filing.`
      : "No filing config walked yet and the KB has no published entry point — portal recon needed before Clara attempts this filing.",
    reasonEs: doc.agency_url
      ? `Aún no hay configuración de radicación verificada. El punto de entrada publicado es ${doc.agency_url} — se necesita reconocimiento del portal antes de intentarlo.`
      : "Aún no hay configuración de radicación verificada y no hay punto de entrada publicado — se necesita reconocimiento del portal.",
    reconNeeded: true,
  };
}

/** Coverage snapshot for QA: how many requirements sit at each path status. */
export interface SubmissionPathCoverage {
  total: number;
  verified: number;
  partial: number;
  unknown: number;
  notApplicable: number;
  /** Requirement IDs at "unknown" — the portal-recon backlog, in KB order. */
  reconBacklog: string[];
}

export function submissionPathCoverage(): SubmissionPathCoverage {
  const coverage: SubmissionPathCoverage = {
    total: KB_DOCUMENTS.length,
    verified: 0,
    partial: 0,
    unknown: 0,
    notApplicable: 0,
    reconBacklog: [],
  };
  for (const doc of KB_DOCUMENTS) {
    const path = resolveSubmissionPath(doc.id);
    // resolveSubmissionPath only returns null for IDs outside the KB.
    const status = path?.status ?? "unknown";
    if (status === "verified") coverage.verified += 1;
    else if (status === "partial") coverage.partial += 1;
    else if (status === "not-applicable") coverage.notApplicable += 1;
    else {
      coverage.unknown += 1;
      coverage.reconBacklog.push(doc.id);
    }
  }
  return coverage;
}

export function pathStatusLabelEn(status: SubmissionPathStatus): string {
  switch (status) {
    case "verified":
      return "Verified path";
    case "partial":
      return "Partial path";
    case "unknown":
      return "Path unknown";
    case "not-applicable":
      return "No online path";
  }
}

export function pathStatusLabelEs(status: SubmissionPathStatus): string {
  switch (status) {
    case "verified":
      return "Ruta verificada";
    case "partial":
      return "Ruta parcial";
    case "unknown":
      return "Ruta desconocida";
    case "not-applicable":
      return "Sin ruta en línea";
  }
}

/**
 * Teach Clara extension (2026-09-30): a filing path backed by an approved,
 * replayable skill is "verified" — the replay engine walks the recorded
 * steps and stops at the first deviation, the same guard as above, now
 * enforced step by step instead of by prompt. A portal the public probes
 * flagged as changed keeps the path's status but says so.
 */
export interface TaughtSkillInfo {
  version: number;
  attribution: "smartpr" | "partner" | "you";
  health: "ok" | "portal_changed" | "unreachable";
}

export function withTaughtSkill(path: SubmissionPath, skill: TaughtSkillInfo | null): SubmissionPath & { skill: TaughtSkillInfo | null } {
  if (!skill || path.status === "not-applicable") return { ...path, skill: null };
  if (skill.health === "portal_changed") {
    return {
      ...path,
      skill,
      reasonEn: `${path.reasonEn} A taught skill (v${skill.version}) exists, but the portal changed since — Clara stops at the first difference.`,
      reasonEs: `${path.reasonEs} Existe una destreza enseñada (v${skill.version}), pero el portal cambió — Clara se detiene ante la primera diferencia.`,
    };
  }
  return {
    ...path,
    status: "verified",
    skill,
    reasonEn: `Taught skill v${skill.version}: Clara replays the recorded steps from the business's info and stops at the first deviation.`,
    reasonEs: `Destreza enseñada v${skill.version}: Clara repite los pasos grabados con la información del negocio y se detiene ante la primera desviación.`,
    reconNeeded: false,
  };
}
