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
      "Open suri.hacienda.pr.gov and navigate toward Registration → Create SURI Logon / Register as Individual Taxpayer (adapt to on-screen Spanish labels)",
      "If a login wall appears first: prefill email from passport when available, then PAUSE_USER_LOGIN once with REQUIRED_FIELDS (email if still empty, password, mfa if shown). Prefer Assistant-fill — do not loop on login and do not expect the human to type in the live browser",
      "After landing past login/registration start: prefill name, address, phone, and contact from the Business Passport; prefer Verify Address when the portal requires it before Next",
      "For SSN / taxpayer ID blanks: PAUSE_USER_LOGIN with REQUIRED_FIELDS using type=text; sensitive=true; hint describing the portal format (e.g. 9 digits — dashes or no dashes as shown). On re-pause after a failed fill, put the on-screen validation error in hint=",
      "Pause for document uploads (photo ID, utility bill, SSN card) or remaining sensitive blanks; stop at pre-submit review",
    ],
    procedureEs: [
      "Abra suri.hacienda.pr.gov y navegue hacia Registro → Crear acceso SURI / Registrar como contribuyente individual (adapte a las etiquetas en pantalla)",
      "Si aparece un muro de inicio de sesión: rellene el email desde el pasaporte si está disponible, luego PAUSE_USER_LOGIN una vez con REQUIRED_FIELDS (email si sigue vacío, contraseña, MFA si se muestra). Prefiera el llenado en Asistente — no ciclar en login ni esperar que el humano escriba en el navegador en vivo",
      "Tras pasar el login/inicio de registro: rellene nombre, dirección, teléfono y contacto desde el Pasaporte de Negocio; prefiera Verificar dirección cuando el portal lo exija antes de Siguiente",
      "Para SSN / ID del contribuyente: PAUSE_USER_LOGIN con REQUIRED_FIELDS usando type=text; sensitive=true; hint con el formato del portal (p. ej. 9 dígitos — con o sin guiones según se muestre). En re-pausa tras un llenado fallido, ponga el error de validación en pantalla en hint=",
      "Pause para adjuntos (ID con foto, utilidad, tarjeta SSN) o campos sensibles restantes; deténgase en la revisión previa al envío",
    ],
    uploadsEn: "Photo ID, utility bill, and SSN card copy (max 5 MB each)",
    uploadsEs: "ID con foto, factura de utilidad y copia de tarjeta SSN (máx. 5 MB c/u)",
    hintsEn: [
      "Attachments max 5.00 MB per file.",
      "Verify Address is required — incomplete address blocks Next.",
      "Register Taxpayer needs photo ID + utility bill + SSN card copy.",
      "Type login / MFA only in the SmartPR Assistant panel — the live browser stays view-only until Fill & continue.",
    ],
    hintsEs: [
      "Adjuntos máx. 5.00 MB por archivo.",
      "Verificar dirección es obligatorio — dirección incompleta bloquea Siguiente.",
      "Registrar contribuyente requiere ID con foto + utilidad + copia de tarjeta SSN.",
      "Escriba el inicio de sesión / MFA solo en el panel Asistente de SmartPR — el navegador en vivo permanece solo lectura hasta Llenar y continuar.",
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
      "Open suri.hacienda.pr.gov; on the login page PAUSE_USER_LOGIN once with REQUIRED_FIELDS (email if passport has none, password, mfa if shown). Prefer Assistant-fill over live typing — do not loop on login",
      "After landing in the authenticated SURI home, open the merchant registration path (Registro de Comerciante) from the post-login menus",
      "Prefill merchant / business identity, addresses, and contact from the Business Passport; pause only for uploads, captcha, payment, or sensitive blanks the passport cannot fill. For SSN/ID use type=text; sensitive=true with hint= format (and on-screen validation errors on re-pause)",
      "Stop at pre-submit review — never click final Enviar",
    ],
    procedureEs: [
      "Abra suri.hacienda.pr.gov; en la página de login haga PAUSE_USER_LOGIN una vez con REQUIRED_FIELDS (email si el pasaporte no lo tiene, contraseña, MFA si se muestra). Prefiera Asistente sobre escribir en vivo — no ciclar en login",
      "Tras aterrizar en el inicio autenticado de SURI, abra la ruta de Registro de Comerciante desde los menús post-login",
      "Rellene identidad del comerciante/negocio, direcciones y contacto desde el Pasaporte de Negocio; pause solo para adjuntos, captcha, pago o campos sensibles que el pasaporte no pueda llenar. Para SSN/ID use type=text; sensitive=true con hint= de formato (y errores de validación en pantalla en re-pausa)",
      "Deténgase en la revisión previa al envío — nunca haga clic en Enviar final",
    ],
    uploadsEn: "Supporting documents (max 5 MB each)",
    uploadsEs: "Documentos de apoyo (máx. 5 MB c/u)",
    hintsEn: [
      "Attachments max 5.00 MB per file.",
      "Requires an existing SURI account — enter credentials in the Assistant panel (not by typing in the live browser).",
    ],
    hintsEs: [
      "Adjuntos máx. 5.00 MB por archivo.",
      "Requiere una cuenta SURI existente — ingrese las credenciales en el panel Asistente (no escribiendo en el navegador en vivo).",
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
      "If login is required: PAUSE_USER_LOGIN once with REQUIRED_FIELDS and prefer Assistant-fill — do not expect the human to type in the live browser",
      "Prefill entity name, entity type, organizers/members, registered agent, and addresses from the Business Passport",
      "Pause for document uploads, captcha, or payment as the portal requires; stop at pre-submit review",
    ],
    procedureEs: [
      "Desde la página del registro, abra los servicios en línea para crear una nueva entidad jurídica (o informes anuales)",
      "Si se requiere inicio de sesión: PAUSE_USER_LOGIN una vez con REQUIRED_FIELDS y prefiera Asistente — no espere que el humano escriba en el navegador en vivo",
      "Rellene nombre de la entidad, tipo de entidad, organizadores/miembros, agente residente y direcciones desde el Pasaporte de Negocio",
      "Pause para adjuntos, captcha o pago según lo pida el portal; deténgase en la revisión previa al envío",
    ],
    uploadsEn: "Formation documents and organizer photo ID (max 5 MB each)",
    uploadsEs: "Documentos de formación e ID con foto del organizador (máx. 5 MB c/u)",
    hintsEn: [
      "Attachments max 5.00 MB per file.",
      "Have entity name options and organizer details ready in the Business Passport.",
      "If the portal requires an account, enter login in the Assistant panel (Fill & continue) — Take over is only for captcha or odd UI.",
    ],
    hintsEs: [
      "Adjuntos máx. 5.00 MB por archivo.",
      "Tenga las opciones de nombre de la entidad y los datos del organizador listos en el Pasaporte de Negocio.",
      "Si el portal requiere una cuenta, ingrese el inicio de sesión en el panel Asistente (Llenar y continuar) — Tomar control solo para captcha o UI rara.",
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
      "Open sbp.ogpe.pr.gov (Single Business Portal). If a login / profile gate appears: PAUSE_USER_LOGIN once with REQUIRED_FIELDS (email if passport has none, password, mfa if shown). Prefer Assistant-fill — do not loop on login or expect live-browser typing",
      "After landing authenticated, start a new Permiso Único application from the portal home / services path the UI actually shows",
      "Prefill business identity, physical location, municipality, phone, and contact from the Business Passport before pausing for anything the passport cannot fill",
      "Pause for document uploads, captcha, or payment as needed; stop at pre-submit review — never click final submit",
    ],
    procedureEs: [
      "Abra sbp.ogpe.pr.gov (Single Business Portal). Si aparece un muro de login / perfil: PAUSE_USER_LOGIN una vez con REQUIRED_FIELDS (email si el pasaporte no lo tiene, contraseña, MFA si se muestra). Prefiera Asistente — no ciclar en login ni esperar escritura en el navegador en vivo",
      "Tras aterrizar autenticado, inicie una nueva solicitud de Permiso Único desde el inicio / servicios que la UI muestre",
      "Rellene identidad del negocio, ubicación física, municipio, teléfono y contacto desde el Pasaporte de Negocio antes de pausar por lo que el pasaporte no pueda llenar",
      "Pause para adjuntos, captcha o pago según sea necesario; deténgase en la revisión previa al envío — nunca haga clic en enviar final",
    ],
    uploadsEn: "Supporting documents such as site plans, photo ID, and entity certificates (max 5 MB each)",
    uploadsEs: "Documentos de apoyo como planos del local, ID con foto y certificados de la entidad (máx. 5 MB c/u)",
    hintsEn: [
      "Attachments max 5.00 MB per file.",
      "The portal requires a Single Business Portal profile — enter login in the Assistant panel (Fill & continue), not by typing in the live browser.",
      "Have the physical location address verified before starting.",
    ],
    hintsEs: [
      "Adjuntos máx. 5.00 MB por archivo.",
      "El portal requiere un perfil del Single Business Portal — ingrese el inicio de sesión en el panel Asistente (Llenar y continuar), no escribiendo en el navegador en vivo.",
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
