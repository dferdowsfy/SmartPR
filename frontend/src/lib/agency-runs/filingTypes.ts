import type { AgencyFilingType } from "./types";
import { getSiteUrl } from "../siteUrl";

/**
 * Host allowlist + start URL for the fictional rehearsal portal.
 * Resolved from the app's own site URL (NEXT_PUBLIC_SITE_URL override, else
 * the established prod default) — never a hardcoded portal domain, so the
 * same entry works on production and local dev.
 */
function demoPortalHost(): string {
  try {
    return new URL(getSiteUrl()).hostname;
  } catch {
    return "localhost";
  }
}

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
  /** Agency group this filing belongs to (used by agency-action resolution). */
  agencyId?: string;
  /**
   * Canonical passport dotted paths (e.g. "business.legalName") that drive
   * readiness scoring for this filing.
   */
  passportCoverageKeys?: string[];
  /** Filing types that must be completed before this one can start. */
  blockedBy?: AgencyFilingType[];
  /**
   * Sensitive values the human must supply (labels only — never values).
   * Surfaced as missing items with sensitive=true.
   */
  sensitiveNeeds?: { id: string; label_en: string; label_es: string }[];
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
    agencyId: "HACIENDA_SURI",
    passportCoverageKeys: [
      "business.legalName",
      "business.tradeName",
      "business.ein",
      "contact.fullName",
      "contact.email",
      "contact.phone",
      "addresses.principalPhysical.line1",
      "addresses.municipality",
      "addresses.principalPhysical.postalCode",
      "addresses.state",
    ],
    blockedBy: [],
    sensitiveNeeds: [
      {
        id: "ssn",
        label_en: "SSN (Social Security Number)",
        label_es: "Número de Seguro Social",
      },
    ],
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
    agencyId: "HACIENDA_SURI",
    passportCoverageKeys: [
      "business.legalName",
      "business.tradeName",
      "business.ein",
      "business.registryNumber",
      "contact.fullName",
      "contact.email",
      "contact.phone",
      "addresses.principalPhysical.line1",
      "addresses.municipality",
      "addresses.principalPhysical.postalCode",
    ],
    blockedBy: ["SURI_REGISTER_TAXPAYER"],
    sensitiveNeeds: [],
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
      "Follow the OBJECTIVE named in the goal brief above exactly — it names ONE transaction (new-entity creation OR annual report filing). Do that one only; never do both, never pick the other one.",
      "From the registry homepage, open the online services for the transaction named in the objective",
      "If login is required: PAUSE_USER_LOGIN once with REQUIRED_FIELDS and prefer Assistant-fill — do not expect the human to type in the live browser",
      "Prefill entity name, entity type, organizers/members, registered agent, and addresses from the Business Passport",
      "Pause for document uploads, captcha, or payment as the portal requires; stop at pre-submit review",
    ],
    procedureEs: [
      "Siga EXACTAMENTE el OBJETIVO indicado en el resumen de objetivo anterior — nombra UNA transacción (creación de nueva entidad O radicación de informe anual). Haga solo esa; nunca ambas, nunca la otra.",
      "Desde la página del registro, abra los servicios en línea para la transacción nombrada en el objetivo",
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
    agencyId: "DEPT_STATE",
    passportCoverageKeys: [
      "business.legalName",
      "business.tradeName",
      "business.entityType",
      "business.ein",
      "business.registryNumber",
      "contact.fullName",
      "contact.email",
      "contact.phone",
      "addresses.principalPhysical.line1",
      "addresses.municipality",
      "addresses.principalPhysical.postalCode",
      "addresses.state",
    ],
    blockedBy: [],
    sensitiveNeeds: [],
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
    agencyId: "OGPE",
    passportCoverageKeys: [
      "business.legalName",
      "business.tradeName",
      "business.entityType",
      "contact.fullName",
      "contact.email",
      "contact.phone",
      "addresses.principalPhysical.line1",
      "addresses.municipality",
      "addresses.principalPhysical.postalCode",
      "addresses.state",
    ],
    blockedBy: [],
    sensitiveNeeds: [],
  },
  {
    id: "DEMO_REHEARSAL_PORTAL",
    labelEn: "Demo rehearsal portal — practice filing",
    labelEs: "Portal de ensayo (demo) — radicación de práctica",
    agencyEn: "SmartPR Demo Portal (fictional)",
    agencyEs: "Portal de demostración SmartPR (ficticio)",
    portalEn: "Demo Filing Portal",
    portalEs: "Portal de Radicación Demo",
    domains: [demoPortalHost()],
    startUrl: `${getSiteUrl()}/rehearsal-portal`,
    goalEn:
      "Complete a REHEARSAL annual-report filing on the SmartPR demo portal — a fictional portal. Nothing real is filed, no real credentials or data are used.",
    goalEs:
      "Completar una radicación de informe anual de ENSAYO en el portal demo de SmartPR — un portal ficticio. No se radica nada real, no se usan credenciales ni datos reales.",
    procedureEn: [
      "Follow the PORTAL ACCOUNT line in the goal brief: if the human HAS an account, use the Log in path; if NOT, use Create account — fill name and email from the passport, then PAUSE at password creation. Never invent a password and never type credentials unprompted.",
      "If a login form appears: prefill the email from the passport when available, then PAUSE_USER_LOGIN once with REQUIRED_FIELDS (email if still empty, password, MFA if shown). Prefer Assistant-fill — do not loop on login and do not expect the human to type in the live browser.",
      "On the entity search page: use the registry number from the passport (or the human-supplied value) and select the DEMO ENTITY LLC result.",
      "On the filing form: prefill EVERY non-sensitive field from the Business Passport first — contact name, email, phone, street, city, postal code, entity type, fiscal year end, business activity — matching the dropdown, checkboxes, and radio buttons. Leave SSN, passwords, payment, and attestations blank.",
      "If the portal shows an inline validation error after submitting: surface the exact portal message to the chat via the humanized-error path (never invent an explanation), correct the flagged field from passport data when possible, otherwise pause for the human.",
      "On the identity-verification step: PAUSE for the human — never fill in or invent a Social Security Number.",
      "On the certification page: PAUSE for human review — never check legal certifications or sign on the human's behalf.",
      "On the payment page: PAUSE for human review — never enter card details or pay.",
      "On the final review page: stop at pre-submit review and summarize for the human — never click the final Submit button yourself.",
    ],
    procedureEs: [
      "Siga la línea de CUENTA DEL PORTAL en el resumen: si la persona TIENE cuenta, use Iniciar sesión; si NO, use Crear cuenta — llene nombre y correo desde el pasaporte, luego PAUSE en la creación de contraseña. Nunca invente una contraseña ni escriba credenciales sin que se lo pidan.",
      "Si aparece un formulario de inicio de sesión: rellene el correo desde el pasaporte si está disponible, luego PAUSE_USER_LOGIN una vez con REQUIRED_FIELDS (correo si sigue vacío, contraseña, MFA si se muestra). Prefiera Asistente — no cicle en el login ni espere que el humano escriba en el navegador en vivo.",
      "En la página de búsqueda de entidad: use el número de registro del pasaporte (o el valor provisto por la persona) y seleccione el resultado DEMO ENTITY LLC.",
      "En el formulario de radicación: rellene PRIMERO todos los campos no sensibles desde el Pasaporte de Negocio — nombre del contacto, correo, teléfono, dirección, ciudad, código postal, tipo de entidad, cierre fiscal, actividad del negocio — incluyendo el dropdown, los checkboxes y los botones de radio. Deje el Seguro Social, contraseñas, pago y certificaciones en blanco.",
      "Si el portal muestra un error de validación en línea tras enviar: lleve el mensaje exacto del portal al chat por la vía de error humanizado (nunca invente una explicación), corrija el campo señalado con datos del pasaporte si es posible, o pause para la persona.",
      "En el paso de verificación de identidad: PAUSE para la persona — nunca llene ni invente un número de Seguro Social.",
      "En la página de certificación: PAUSE para revisión humana — nunca marque certificaciones legales ni firme en nombre de la persona.",
      "En la página de pago: PAUSE para revisión humana — nunca ingrese datos de tarjeta ni pague.",
      "En la página de revisión final: deténgase en la revisión previa al envío y resuma para la persona — nunca haga clic usted mismo en Enviar.",
    ],
    uploadsEn: "No uploads required for the rehearsal",
    uploadsEs: "El ensayo no requiere adjuntos",
    hintsEn: [
      "The demo portal is fictional — rehearse freely; nothing here touches a government system.",
      "The demo accepts any credentials, but you must still pause for the human at every gate: login, password creation, SSN, attestation, payment, final review.",
      "The first form submit always fails on phone format — expect the inline error and handle it through the humanized-error path.",
    ],
    hintsEs: [
      "El portal demo es ficticio — ensaye con libertad; nada aquí toca un sistema del gobierno.",
      "El demo acepta cualquier credencial, pero igual debe pausar para la persona en cada puerta: login, creación de contraseña, Seguro Social, certificación, pago y revisión final.",
      "El primer envío del formulario siempre falla en el formato del teléfono — espere el error en línea y manéjelo por la vía de error humanizado.",
    ],
    evidenceTags: [],
    needsLogin: true,
    enabled: true,
    requiresExistingAccount: false,
    agencyId: "DEMO_REHEARSAL",
    passportCoverageKeys: [
      "business.legalName",
      "business.tradeName",
      "business.entityType",
      "business.ein",
      "business.registryNumber",
      "contact.fullName",
      "contact.email",
      "contact.phone",
      "addresses.principalPhysical.line1",
      "addresses.municipality",
      "addresses.principalPhysical.postalCode",
      "addresses.state",
    ],
    blockedBy: [],
    sensitiveNeeds: [
      {
        id: "demo_ssn",
        label_en: "Social Security Number",
        label_es: "Número de Seguro Social",
      },
    ],
  },
];

export function getFilingConfig(id: AgencyFilingType): AgencyFilingConfig {
  const found = AGENCY_FILING_CONFIGS.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown filing type: ${id}`);
  return found;
}
