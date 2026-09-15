import type { AgencyFilingType } from "./types";

/**
 * Filing-type registry — the agency assistant is no longer SURI-only.
 * Each entry fully describes one assisted portal filing: the agent brief,
 * mock timeline, preflight copy, and pause overlays are all generated from
 * this config. Adding a new portal = adding one entry here (no code branches).
 *
 * Portal start URLs below were verified against official PR government pages
 * on 2026-09-15 (statedepartment.pr.gov → rceweb.estado.pr.gov; DDEC/OGPe
 * Single Business Portal user guide → sbp.ogpe.pr.gov). Briefs stay
 * goal-oriented on purpose — never a brittle click map.
 */
export interface AgencyFilingConfig {
  id: AgencyFilingType;
  /** Filing picker label. */
  labelEn: string;
  labelEs: string;
  agencyEn: string;
  agencyEs: string;
  portalEn: string;
  portalEs: string;
  /** Domain allowlist enforced in the agent brief + shown on preflight. */
  domains: string[];
  startUrl: string;
  goalEn: string;
  goalEs: string;
  /** Goal-oriented outline for the agent brief — never a click map. */
  procedureEn: string[];
  procedureEs: string[];
  uploadsEn: string;
  uploadsEs: string;
  /** Recon hints shown on the preflight screen. */
  hintsEn: string[];
  hintsEs: string[];
  /** Evidence-locker tags suggested for pause uploads. */
  evidenceTags: string[];
  needsLogin: boolean;
  /** Shown in the filing-type picker. */
  enabled: boolean;
  /** Shown disabled with an "existing account required" note. */
  requiresExistingAccount: boolean;
}

export const AGENCY_FILING_CONFIGS: AgencyFilingConfig[] = [
  {
    id: "SURI_REGISTER_TAXPAYER",
    labelEn: "SURI — Register Taxpayer (account signup)",
    labelEs: "SURI — Registrar contribuyente (crear cuenta)",
    agencyEn: "Puerto Rico Treasury (Hacienda)",
    agencyEs: "Hacienda de Puerto Rico",
    portalEn: "SURI",
    portalEs: "SURI",
    domains: ["suri.hacienda.pr.gov"],
    startUrl: "https://suri.hacienda.pr.gov",
    goalEn: "Register as Individual Taxpayer / create a SURI logon",
    goalEs: "Registrar como contribuyente individual / crear acceso SURI",
    procedureEn: [
      "Open Registration → Create SURI Logon / Register as Individual Taxpayer",
      "Prefill name, address, and contact from the Business Passport; prefer Verify Address when the portal requires it before Next",
      "Pause for document uploads and login as the portal requires",
    ],
    procedureEs: [
      "Abra Registro → Crear acceso SURI / Registrar como contribuyente individual",
      "Rellene nombre, dirección y contacto desde el Pasaporte de Negocio; prefiera Verificar dirección cuando el portal lo exija antes de Siguiente",
      "Pause para adjuntos e inicio de sesión según lo pida el portal",
    ],
    uploadsEn: "Photo ID, utility bill, and SSN card copy (max 5 MB each)",
    uploadsEs: "ID con foto, factura de utilidad y copia de tarjeta SSN (máx. 5 MB c/u)",
    hintsEn: [
      "Attachments max 5.00 MB per file.",
      "Verify Address is required — incomplete address blocks Next.",
      "Register Taxpayer needs photo ID + utility bill + SSN card copy.",
    ],
    hintsEs: [
      "Adjuntos máx. 5.00 MB por archivo.",
      "Verificar dirección es obligatorio — dirección incompleta bloquea Siguiente.",
      "Registrar contribuyente requiere ID con foto + utilidad + copia de tarjeta SSN.",
    ],
    evidenceTags: ["DOC_PHOTO_ID", "DOC_UTILITY_BILL", "DOC_SSN_CARD"],
    needsLogin: true,
    enabled: true,
    requiresExistingAccount: false,
  },
  {
    id: "SURI_MERCHANT_REGISTRATION",
    labelEn: "SURI — Merchant registration (Registro de Comerciante)",
    labelEs: "SURI — Registro de Comerciante",
    agencyEn: "Puerto Rico Treasury (Hacienda)",
    agencyEs: "Hacienda de Puerto Rico",
    portalEn: "SURI",
    portalEs: "SURI",
    domains: ["suri.hacienda.pr.gov"],
    startUrl: "https://suri.hacienda.pr.gov",
    goalEn: "Merchant registration (Registro de Comerciante) — post-login path",
    goalEs: "Registro de Comerciante — ruta post-login",
    procedureEn: [
      "Use the post-login merchant registration path",
      "Prefill merchant fields from the Business Passport; pause at uploads or captcha as needed",
    ],
    procedureEs: [
      "Use la ruta de registro de comerciante post-login",
      "Rellene los campos del comerciante desde el Pasaporte de Negocio; pause para adjuntos o captcha según sea necesario",
    ],
    uploadsEn: "Supporting documents (max 5 MB each)",
    uploadsEs: "Documentos de apoyo (máx. 5 MB c/u)",
    hintsEn: [
      "Attachments max 5.00 MB per file.",
      "Requires an existing SURI account — the agent cannot create one for you.",
    ],
    hintsEs: [
      "Adjuntos máx. 5.00 MB por archivo.",
      "Requiere una cuenta SURI existente — el agente no puede crear una por usted.",
    ],
    evidenceTags: [],
    needsLogin: true,
    enabled: false,
    requiresExistingAccount: true,
  },
  {
    id: "DEPT_STATE_CORPORATE_FILING",
    labelEn: "Dept. of State — Corporate / entity filing",
    labelEs: "Departamento de Estado — Trámite corporativo / entidad",
    agencyEn: "Puerto Rico Department of State",
    agencyEs: "Departamento de Estado de Puerto Rico",
    portalEn: "Corporate & Entities Registry",
    portalEs: "Registro de Corporaciones y Entidades",
    domains: ["rcp.estado.pr.gov"],
    startUrl: "https://rcp.estado.pr.gov/en",
    goalEn: "Create/file a juridical entity (corporation or LLC), or file an annual report",
    goalEs: "Crear/radicar una entidad jurídica (corporación o LLC), o radicar un informe anual",
    procedureEn: [
      "From the registry homepage, open the online services for creating a new juridical entity (or annual reports)",
      "Prefill entity name, entity type, organizers/members, registered agent, and addresses from the Business Passport",
      "Pause for document uploads, login, or payment as the portal requires",
    ],
    procedureEs: [
      "Desde la página del registro, abra los servicios en línea para crear una nueva entidad jurídica (o informes anuales)",
      "Rellene nombre de la entidad, tipo de entidad, organizadores/miembros, agente residente y direcciones desde el Pasaporte de Negocio",
      "Pause para adjuntos, inicio de sesión o pago según lo pida el portal",
    ],
    uploadsEn: "Formation documents and organizer photo ID (max 5 MB each)",
    uploadsEs: "Documentos de formación e ID con foto del organizador (máx. 5 MB c/u)",
    hintsEn: [
      "Attachments max 5.00 MB per file.",
      "Have entity name options and organizer details ready in the Business Passport.",
      "The portal may require an account before filing — you take over to log in.",
    ],
    hintsEs: [
      "Adjuntos máx. 5.00 MB por archivo.",
      "Tenga las opciones de nombre de la entidad y los datos del organizador listos en el Pasaporte de Negocio.",
      "El portal puede requerir una cuenta antes de radicar — usted toma el control para iniciar sesión.",
    ],
    evidenceTags: [],
    needsLogin: true,
    enabled: true,
    requiresExistingAccount: false,
  },
  {
    id: "OGPE_PERMISO_UNICO",
    labelEn: "OGPe — Permiso Único (single business permit)",
    labelEs: "OGPe — Permiso Único",
    agencyEn: "Permit Management Office (OGPe)",
    agencyEs: "Oficina de Gerencia de Permisos (OGPe)",
    portalEn: "Single Business Portal",
    portalEs: "Single Business Portal",
    domains: ["sbp.ogpe.pr.gov"],
    startUrl: "https://sbp.ogpe.pr.gov/",
    goalEn: "File a Permiso Único (single business permit) application",
    goalEs: "Radicar una solicitud de Permiso Único",
    procedureEn: [
      "From the Single Business Portal homepage, start a new Permiso Único application",
      "Prefill business identity, physical location, and contact from the Business Passport",
      "Pause for document uploads, login, or payment as the portal requires",
    ],
    procedureEs: [
      "Desde la página del Single Business Portal, inicie una nueva solicitud de Permiso Único",
      "Rellene identidad del negocio, ubicación física y contacto desde el Pasaporte de Negocio",
      "Pause para adjuntos, inicio de sesión o pago según lo pida el portal",
    ],
    uploadsEn: "Supporting documents such as site plans, photo ID, and entity certificates (max 5 MB each)",
    uploadsEs: "Documentos de apoyo como planos del local, ID con foto y certificados de la entidad (máx. 5 MB c/u)",
    hintsEn: [
      "Attachments max 5.00 MB per file.",
      "The portal requires a Single Business Portal profile — you take over to log in.",
      "Have the physical location address verified before starting.",
    ],
    hintsEs: [
      "Adjuntos máx. 5.00 MB por archivo.",
      "El portal requiere un perfil del Single Business Portal — usted toma el control para iniciar sesión.",
      "Tenga la dirección física verificada antes de empezar.",
    ],
    evidenceTags: [],
    needsLogin: true,
    enabled: true,
    requiresExistingAccount: false,
  },
];

export function getFilingConfig(id: AgencyFilingType): AgencyFilingConfig {
  const found = AGENCY_FILING_CONFIGS.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown filing type: ${id}`);
  return found;
}
