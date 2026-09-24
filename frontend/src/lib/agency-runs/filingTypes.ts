import type { AgencyFilingType, AgencyPendingFieldType } from "./types";
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
  /**
   * Engine document_ids (obligations.requirement_id) this filing satisfies.
   * Keyed ONLY on engine document_ids — never on requirement names
   * (obligations.requirement_id falls back to the requirement name when
   * document_id is null, and name-matching rots). Used to join a business's
   * SmartPR-generated obligations to the browser filing that fulfills them.
   */
  requirementIds?: string[];
  /**
   * Deterministic filing playbook (Phase 1: data model only — not yet consumed
   * by taskPrompt.ts). When present, this is the authoritative ordered step
   * list for the filing; procedureEn/Es remain as the fallback brief until the
   * prompt builder is wired to playbooks. Portal identity (domains, startUrl,
   * needsLogin) is NOT duplicated here — it stays on this config.
   */
  playbook?: FilingPlaybook;
}

/**
 * Where a playbook step's data entry happens (inline-first model, 2026-09-24).
 * - INLINE: user answers inline form fields in chat; the agent types them in.
 * - VAULT: secret pulled from Secure Vault; never shown in chat.
 * - IN_BROWSER: the human acts directly in the embedded browser (legal acts,
 *   payment, phone calls). Never a fill step.
 * - AGENT: the agent drives with no user input (navigation, capture).
 */
export type PlaybookChannel = "INLINE" | "VAULT" | "IN_BROWSER" | "AGENT";

/** Human gate kinds that pause the run at a step. */
export type PlaybookGateKind =
  | "login"
  | "captcha"
  | "signature"
  | "payment"
  | "upload"
  | "phone_call";

/** Field input kinds. Extends the assistant-panel field types with portal
 *  controls the inline renderer will support (select, checkbox). */
export type PlaybookFieldType = AgencyPendingFieldType | "select" | "checkbox";

export interface PlaybookField {
  /** Stable id used in REQUIRED_FIELDS / FIELDS FILL. */
  id: string;
  label_en: string;
  label_es: string;
  /** Canonical passport dotted path used to pre-seed the value. Must exist
   *  in CANONICAL_LABELS — never invent a path. Omit when the passport has
   *  no such concept (user-supplied rows like officers). */
  passportPath?: string;
  type: PlaybookFieldType;
  required: boolean;
  /** Encrypted at rest; masked in chat with an eye icon to reveal. */
  sensitive?: boolean;
  /** Repeatable row group (e.g. incorporators, officers). */
  repeatable?: boolean;
  /** Visible option labels for select fields. */
  options?: string[];
  hint_en?: string;
  hint_es?: string;
}

export interface PlaybookStep {
  id: string;
  label_en: string;
  label_es: string;
  channel: PlaybookChannel;
  /** Portal page identity: URL hash fragment or recognizable heading. */
  pageId?: string;
  fields: PlaybookField[];
  /** What must be true before advancing to the next step. */
  expectedState_en?: string;
  expectedState_es?: string;
  /** Human gate at this step, if any. signature/payment/captcha gates imply
   *  channel IN_BROWSER. */
  gate?: PlaybookGateKind;
  notes_en?: string;
  notes_es?: string;
}

export interface PlaybookConfirmation {
  /** What reference/receipt to capture. */
  reference_en: string;
  reference_es: string;
  /** Where it appears in the portal. */
  where_en: string;
  where_es: string;
}

export interface FilingPlaybook {
  /** Filing variant this playbook was recorded for (e.g. new-entity creation
   *  vs annual report). */
  scope_en: string;
  scope_es: string;
  steps: PlaybookStep[];
  confirmation: PlaybookConfirmation;
  quirks_en: string[];
  quirks_es: string[];
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
      "For SSN / taxpayer ID blanks: PAUSE_USER_LOGIN with REQUIRED_FIELDS using type=text; sensitive=true; hint describing the portal format (e.g. 9 digits — dashes or no dashes as shown). On re-pause after a failed fill, prefer error=<exact on-screen validation> (keep hint= for format)",
      "Pause for document uploads (photo ID, utility bill, SSN card) or remaining sensitive blanks; stop at pre-submit review",
    ],
    procedureEs: [
      "Abra suri.hacienda.pr.gov y navegue hacia Registro → Crear acceso SURI / Registrar como contribuyente individual (adapte a las etiquetas en pantalla)",
      "Si aparece un muro de inicio de sesión: rellene el email desde el pasaporte si está disponible, luego PAUSE_USER_LOGIN una vez con REQUIRED_FIELDS (email si sigue vacío, contraseña, MFA si se muestra). Prefiera el llenado en Asistente — no ciclar en login ni esperar que el humano escriba en el navegador en vivo",
      "Tras pasar el login/inicio de registro: rellene nombre, dirección, teléfono y contacto desde el Pasaporte de Negocio; prefiera Verificar dirección cuando el portal lo exija antes de Siguiente",
      "Para SSN / ID del contribuyente: PAUSE_USER_LOGIN con REQUIRED_FIELDS usando type=text; sensitive=true; hint con el formato del portal (p. ej. 9 dígitos — con o sin guiones según se muestre). En re-pausa tras un llenado fallido, prefiera error=<validación exacta en pantalla> (mantenga hint= para formato)",
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
    // DOC_SURI_REGISTRATION exists in the document catalog but no engine
    // rule currently emits it (verified 2026-09-18 in data/rules.json) — this
    // join only fires when an obligation actually carries the id.
    requirementIds: ["DOC_SURI_REGISTRATION"],
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
      "Prefill merchant / business identity, addresses, and contact from the Business Passport; pause only for uploads, captcha, payment, or sensitive blanks the passport cannot fill. For SSN/ID use type=text; sensitive=true with hint= format (and error= for on-screen validation on re-pause)",
      "Stop at pre-submit review — never click final Enviar",
    ],
    procedureEs: [
      "Abra suri.hacienda.pr.gov; en la página de login haga PAUSE_USER_LOGIN una vez con REQUIRED_FIELDS (email si el pasaporte no lo tiene, contraseña, MFA si se muestra). Prefiera Asistente sobre escribir en vivo — no ciclar en login",
      "Tras aterrizar en el inicio autenticado de SURI, abra la ruta de Registro de Comerciante desde los menús post-login",
      "Rellene identidad del comerciante/negocio, direcciones y contacto desde el Pasaporte de Negocio; pause solo para adjuntos, captcha, pago o campos sensibles que el pasaporte no pueda llenar. Para SSN/ID use type=text; sensitive=true con hint= de formato (y error= para validación en pantalla en re-pausa)",
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
    requirementIds: ["DOC_MERCHANT_REGISTRATION"],
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
    // DOC_CERT_INCORPORATION is emitted by engine rules; DOC_ARTICLES_ORGANIZATION
    // exists in the document catalog (no rule emits it yet — future-proof).
    // DOC_ANNUAL_REPORT has no document entry and no rule: the annual-report
    // variant cannot be obligation-driven until the engine models it.
    requirementIds: ["DOC_CERT_INCORPORATION", "DOC_ARTICLES_ORGANIZATION"],
    // Playbook recorded 2026-09-24 from a live read-only walkthrough of the
    // creation wizard (stopped at Signatures; one fictional name lookup).
    // Covers new-entity creation only — the annual-report flow is not recorded.
    playbook: {
      scope_en: "New-entity creation (corporation / LLC) via the online wizard",
      scope_es:
        "Creación de nueva entidad (corporación / LLC) vía el asistente en línea",
      steps: [
        {
          id: "navigate",
          label_en: "Open the Corporate Registry filing wizard",
          label_es: "Abrir el asistente de radicación del Registro de Corporaciones",
          channel: "AGENT",
          pageId: "rcp.estado.pr.gov/en → Create / Authorize",
          fields: [],
          expectedState_en: "The Name Availability screen is showing",
          expectedState_es: "Se muestra la pantalla de disponibilidad de nombre",
        },
        {
          id: "name_availability",
          label_en: "Name Availability",
          label_es: "Disponibilidad de nombre",
          channel: "INLINE",
          pageId: "Name Availability screen",
          fields: [
            {
              id: "entity_class",
              label_en: "Entity class",
              label_es: "Clase de entidad",
              passportPath: "business.entityType",
              type: "select",
              required: true,
              options: [
                "Corporation",
                "LLC",
                "Close Corporation",
                "Professional Corporation",
                "Other",
              ],
            },
            {
              id: "entity_name",
              label_en: "Entity name",
              label_es: "Nombre de la entidad",
              passportPath: "business.legalName",
              type: "text",
              required: true,
            },
            {
              id: "name_designation",
              label_en: "Name designation",
              label_es: "Designación del nombre",
              type: "select",
              required: true,
              options: [
                "Corp.",
                "Corporation",
                "Incorporated",
                "Inc.",
                "LLC",
                "Limited Liability Company",
              ],
            },
          ],
          expectedState_en:
            "Inline result “The name … is available.”; acknowledgment checked; Next enabled",
          expectedState_es:
            "Resultado en línea “The name … is available.”; acuse marcado; Siguiente habilitado",
          notes_en:
            "Starting creation reserves the name. Optional paid reservation (RN-##########, valid 120 days) is a separate path.",
          notes_es:
            "Iniciar la creación reserva el nombre. La reserva pagada opcional (RN-##########, válida 120 días) es una ruta separada.",
        },
        {
          id: "general_information",
          label_en: "General Information",
          label_es: "Información general",
          channel: "INLINE",
          pageId: "#generalinformation",
          fields: [
            {
              id: "entity_type",
              label_en: "Entity type",
              label_es: "Tipo de entidad",
              passportPath: "business.entityType",
              type: "select",
              required: true,
              options: ["For Profit", "Non-Profit"],
            },
            {
              id: "jurisdiction",
              label_en: "Jurisdiction",
              label_es: "Jurisdicción",
              type: "select",
              required: true,
              options: ["Domestic", "Foreign", "Foreign – NON US"],
            },
            {
              id: "purposes",
              label_en: "Purposes",
              label_es: "Propósitos",
              type: "text",
              required: true,
            },
            {
              id: "veteran_officer",
              label_en: "Veteran officer",
              label_es: "Oficial veterano",
              type: "select",
              required: false,
              options: ["Yes", "No"],
            },
            {
              id: "effective_from",
              label_en: "Effective from",
              label_es: "Efectivo desde",
              type: "text",
              required: false,
              hint_en: "Date, portal format",
              hint_es: "Fecha, formato del portal",
            },
            {
              id: "effective_until",
              label_en: "Effective until",
              label_es: "Efectivo hasta",
              type: "text",
              required: false,
            },
          ],
          expectedState_en: "Wizard advances to the Filer screen",
          expectedState_es: "El asistente avanza a la pantalla del Radicante",
        },
        {
          id: "filer",
          label_en: "Filer",
          label_es: "Radicante",
          channel: "INLINE",
          pageId: "#filer",
          fields: [
            {
              id: "filer_type",
              label_en: "Filer type",
              label_es: "Tipo de radicante",
              type: "select",
              required: true,
              options: ["Employee/Owner/Partner", "CPA or Attorney/Paralegal"],
            },
            {
              id: "filer_name",
              label_en: "Filer name",
              label_es: "Nombre del radicante",
              passportPath: "contact.fullName",
              type: "text",
              required: true,
            },
            {
              id: "filer_street",
              label_en: "Street address",
              label_es: "Dirección física",
              passportPath: "addresses.principalPhysical.line1",
              type: "text",
              required: true,
            },
            {
              id: "filer_phone",
              label_en: "Phone",
              label_es: "Teléfono",
              passportPath: "contact.phone",
              type: "tel",
              required: true,
              hint_en: "Portal splits into 3 segments",
              hint_es: "El portal lo divide en 3 segmentos",
            },
            {
              id: "filer_email",
              label_en: "Email",
              label_es: "Correo electrónico",
              passportPath: "contact.email",
              type: "email",
              required: true,
            },
            {
              id: "filer_email_confirm",
              label_en: "Confirm email",
              label_es: "Confirmar correo electrónico",
              type: "email",
              required: true,
              hint_en: "Retype + blur — confirm validation is flaky",
              hint_es: "Reescriba y salga del campo — la validación falla a veces",
            },
          ],
          expectedState_en: "Wizard advances to the Designated Office screen",
          expectedState_es: "El asistente avanza a la pantalla de Oficina Designada",
          notes_en:
            "Server-side address validation rejects PO boxes and fake addresses — use a real street address.",
          notes_es:
            "La validación de dirección del servidor rechaza apartados postales y direcciones falsas — use una dirección física real.",
        },
        {
          id: "designated_office",
          label_en: "Designated Office",
          label_es: "Oficina designada",
          channel: "INLINE",
          pageId: "Designated Office screen",
          fields: [
            {
              id: "office_same_as_filer",
              label_en: "Same as filer",
              label_es: "Igual que el radicante",
              type: "checkbox",
              required: false,
            },
            {
              id: "office_street",
              label_en: "Office street address",
              label_es: "Dirección física de la oficina",
              passportPath: "addresses.principalPhysical.line1",
              type: "text",
              required: true,
            },
            {
              id: "office_mailing",
              label_en: "Mailing address",
              label_es: "Dirección postal",
              type: "text",
              required: false,
            },
            {
              id: "office_phone",
              label_en: "Office phone",
              label_es: "Teléfono de la oficina",
              passportPath: "contact.phone",
              type: "tel",
              required: true,
              hint_en: "Re-enter even if pre-filled — portal flags it required",
              hint_es: "Reingrese aunque aparezca lleno — el portal lo marca requerido",
            },
          ],
          expectedState_en: "Wizard advances to the Resident Agent screen",
          expectedState_es: "El asistente avanza a la pantalla del Agente Residente",
        },
        {
          id: "resident_agent",
          label_en: "Resident Agent",
          label_es: "Agente residente",
          channel: "INLINE",
          pageId: "Resident Agent screen",
          fields: [
            {
              id: "agent_same_as_filer",
              label_en: "Resident agent is same as filer",
              label_es: "El agente residente es el mismo radicante",
              type: "checkbox",
              required: false,
              hint_en: "Locks the remaining tabs when checked",
              hint_es: "Bloquea las demás pestañas al marcarse",
            },
            {
              id: "agent_type",
              label_en: "Agent type",
              label_es: "Tipo de agente",
              type: "select",
              required: false,
              options: ["Individual", "Entity"],
            },
            {
              id: "agent_name",
              label_en: "Agent name",
              label_es: "Nombre del agente",
              type: "text",
              required: false,
            },
            {
              id: "agent_street",
              label_en: "Agent street address",
              label_es: "Dirección física del agente",
              type: "text",
              required: false,
            },
            {
              id: "agent_mailing",
              label_en: "Agent mailing address",
              label_es: "Dirección postal del agente",
              type: "text",
              required: false,
            },
            {
              id: "agent_contact",
              label_en: "Agent contact",
              label_es: "Contacto del agente",
              type: "text",
              required: false,
            },
          ],
          expectedState_en: "Wizard advances to the Incorporators screen",
          expectedState_es: "El asistente avanza a la pantalla de Incorporadores",
        },
        {
          id: "incorporators",
          label_en: "Incorporators",
          label_es: "Incorporadores",
          channel: "INLINE",
          pageId: "Incorporators screen",
          fields: [
            {
              id: "incorporator_name",
              label_en: "Incorporator name",
              label_es: "Nombre del incorporador",
              type: "text",
              required: true,
              repeatable: true,
            },
            {
              id: "incorporator_address",
              label_en: "Incorporator address",
              label_es: "Dirección del incorporador",
              type: "text",
              required: true,
              repeatable: true,
            },
            {
              id: "incorporator_email",
              label_en: "Incorporator email",
              label_es: "Correo del incorporador",
              type: "email",
              required: false,
              repeatable: true,
            },
          ],
          expectedState_en: "Incorporator table shows all rows; wizard advances",
          expectedState_es:
            "La tabla muestra todas las filas; el asistente avanza",
          notes_en: "Use “Copy from Existing Contact” or “Add New” per row.",
          notes_es: "Use “Copiar de contacto existente” o “Añadir nuevo” por fila.",
        },
        {
          id: "officers",
          label_en: "Officers",
          label_es: "Oficiales",
          channel: "INLINE",
          pageId: "Officers screen",
          fields: [
            {
              id: "officer_name",
              label_en: "Officer name",
              label_es: "Nombre del oficial",
              type: "text",
              required: true,
              repeatable: true,
            },
            {
              id: "officer_title",
              label_en: "Officer title",
              label_es: "Título del oficial",
              type: "select",
              required: true,
              repeatable: true,
              options: ["President", "Secretary", "Vice President", "Treasurer"],
            },
          ],
          expectedState_en: "Officer table shows all rows; wizard advances",
          expectedState_es: "La tabla muestra todas las filas; el asistente avanza",
          notes_en:
            "Portal help says ≥2 officers required, but the wizard advanced with 1 — follow the wizard and flag the discrepancy.",
          notes_es:
            "La ayuda del portal exige ≥2 oficiales, pero el asistente avanzó con 1 — siga el asistente y reporte la discrepancia.",
        },
        {
          id: "capital_stock",
          label_en: "Capital Stock",
          label_es: "Capital en acciones",
          channel: "INLINE",
          pageId: "Capital Stock screen",
          fields: [
            {
              id: "stock_class",
              label_en: "Stock class",
              label_es: "Clase de acciones",
              type: "select",
              required: true,
              options: ["Common", "Preferred"],
            },
            {
              id: "shares_number",
              label_en: "Number of shares",
              label_es: "Número de acciones",
              type: "number",
              required: true,
            },
            {
              id: "par_value",
              label_en: "Par value",
              label_es: "Valor nominal",
              type: "text",
              required: false,
              hint_en: "Amount, or check No Par Value",
              hint_es: "Cantidad, o marque Sin valor nominal",
            },
            {
              id: "no_par_value",
              label_en: "No par value",
              label_es: "Sin valor nominal",
              type: "checkbox",
              required: false,
            },
            {
              id: "stock_limitations",
              label_en: "Limitations",
              label_es: "Limitaciones",
              type: "text",
              required: false,
            },
          ],
          expectedState_en:
            "Fee panel computes minimum $140 + $10 certificate = $150.00 total",
          expectedState_es:
            "El panel de cargos calcula mínimo $140 + $10 certificado = $150.00 total",
        },
        {
          id: "supporting_docs",
          label_en: "Supporting Documentation",
          label_es: "Documentación de apoyo",
          channel: "INLINE",
          pageId: "Supporting Documentation screen",
          gate: "upload",
          fields: [],
          expectedState_en:
            "Attached files are listed; wizard advances (step is optional)",
          expectedState_es:
            "Los archivos adjuntos aparecen listados; el asistente avanza (paso opcional)",
          notes_en:
            "User attaches files in chat; the agent uploads them. PDF/TIF only, under 7 MB, no SSN or tax ID data in files.",
          notes_es:
            "El usuario adjunta archivos en el chat; el agente los sube. Solo PDF/TIF, menos de 7 MB, sin SSN ni IDs contributivos en los archivos.",
        },
        {
          id: "review",
          label_en: "Review Filing",
          label_es: "Revisar radicación",
          channel: "INLINE",
          pageId: "Review Filing screen",
          fields: [],
          expectedState_en:
            "Read-only summary matches the passport; fees sidebar shows the computed total",
          expectedState_es:
            "El resumen de solo lectura coincide con el pasaporte; la barra de cargos muestra el total calculado",
          notes_en:
            "Verify only — do NOT check the perjury declaration. The human completes all legal checkboxes at Signatures.",
          notes_es:
            "Solo verificar — NO marque la declaración de perjurio. El humano completa las casillas legales en Firmas.",
        },
        {
          id: "signatures",
          label_en: "Signatures",
          label_es: "Firmas",
          channel: "IN_BROWSER",
          pageId: "Signatures screen",
          gate: "signature",
          fields: [],
          expectedState_en: "Signer checkboxes checked with the perjury statement",
          expectedState_es:
            "Casillas del firmante marcadas con la declaración de perjurio",
          notes_en:
            "This IS the legal filing act — human only. The agent stops here and hands control to the human.",
          notes_es:
            "Este ES el acto legal de radicación — solo el humano. El agente se detiene aquí y cede el control.",
        },
        {
          id: "payment",
          label_en: "Payment",
          label_es: "Pago",
          channel: "IN_BROWSER",
          pageId: "Payment screen",
          gate: "payment",
          fields: [],
          expectedState_en: "Payment completed; receipts issued",
          expectedState_es: "Pago completado; recibos emitidos",
          notes_en:
            "Credit card only — MasterCard, Visa, AmEx. About $150 minimum. SmartPR never touches card details.",
          notes_es:
            "Solo tarjeta de crédito — MasterCard, Visa, AmEx. Mínimo aproximado $150. SmartPR nunca toca los datos de la tarjeta.",
        },
      ],
      confirmation: {
        reference_en:
          "Certificate of Registry, Articles of Incorporation, and Payment Receipt",
        reference_es:
          "Certificado de Registro, Artículos de Incorporación y Recibo de Pago",
        where_en:
          "Emailed to the filer address after payment — no confirmation-number format was found on the portal",
        where_es:
          "Enviados por email a la dirección del radicante tras el pago — no se encontró formato de número de confirmación en el portal",
      },
      quirks_en: [
        "No login required for the creation wizard itself (login only for authenticated transactions).",
        "Single-page app with hash fragments (#generalinformation, #filer, …) — selectors must be hash-aware.",
        "Server-side address validation rejects PO boxes and fake addresses.",
        "Email-confirm validation is flaky — retype + blur.",
        "Portal help says ≥2 officers required, but the wizard advanced with 1.",
        "Name-availability search reserves the name once creation starts.",
      ],
      quirks_es: [
        "No se requiere inicio de sesión para el asistente de creación (solo para transacciones autenticadas).",
        "Aplicación de una sola página con fragmentos hash (#generalinformation, #filer, …) — los selectores deben considerarlos.",
        "La validación de dirección del servidor rechaza apartados postales y direcciones falsas.",
        "La validación de confirmación de email falla a veces — reescriba y salga del campo.",
        "La ayuda del portal exige ≥2 oficiales, pero el asistente avanzó con 1.",
        "La búsqueda de disponibilidad reserva el nombre al iniciar la creación.",
      ],
    },
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
    requirementIds: ["DOC_PERMISO_UNICO"],
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
      "Follow the PORTAL ACCOUNT line in the goal brief: if the human HAS an account, use the Log in path; if NOT, click Create account on the landing — NEVER click Log in and NEVER pause for login credentials on the create-account path. Fill name and email from the passport, then PAUSE at password creation. Never invent a password and never type credentials unprompted.",
      "If a login form appears: prefill the email from the passport when available, then PAUSE_USER_LOGIN once with REQUIRED_FIELDS (email if still empty, password, MFA if shown). Prefer Assistant-fill — do not loop on login and do not expect the human to type in the live browser.",
      "After demo registration completes, the portal shows a fictional registry number and a Continue button — go DIRECTLY to the filing form. Never visit the entity search page on the registration path.",
      "On the entity search page (login path only): enter any 6+ digits yourself (e.g. 482916) — demo numbers are fictional, any number works — then select the DEMO ENTITY LLC result and Continue. NEVER ask the human for a registry number on the demo portal.",
      "On the filing form: prefill EVERY non-sensitive field from the Business Passport first — contact name, email, phone, street, city, postal code, entity type, fiscal year end, business activity — matching the dropdown, checkboxes, and radio buttons. Leave SSN, passwords, payment, and attestations blank.",
      "If the portal shows an inline validation error after submitting: surface the exact portal message to the chat via the humanized-error path (never invent an explanation), correct the flagged field from passport data when possible, otherwise pause for the human.",
      "On the identity-verification step: PAUSE for the human — never fill in or invent a Social Security Number.",
      "On the certification page: PAUSE for human review — never check legal certifications or sign on the human's behalf.",
      "On the payment page: PAUSE for human review — never enter card details or pay.",
      "On the final review page: stop at pre-submit review and summarize for the human — never click the final Submit button yourself.",
    ],
    procedureEs: [
      "Siga la línea de CUENTA DEL PORTAL en el resumen: si la persona TIENE cuenta, use Iniciar sesión; si NO, pulse Crear cuenta en la portada — NUNCA pulse Iniciar sesión ni pause por credenciales en la ruta de crear cuenta. Llene nombre y correo desde el pasaporte, luego PAUSE en la creación de contraseña. Nunca invente una contraseña ni escriba credenciales sin que se lo pidan.",
      "Si aparece un formulario de inicio de sesión: rellene el correo desde el pasaporte si está disponible, luego PAUSE_USER_LOGIN una vez con REQUIRED_FIELDS (correo si sigue vacío, contraseña, MFA si se muestra). Prefiera Asistente — no cicle en el login ni espere que el humano escriba en el navegador en vivo.",
      "Tras completar el registro demo, el portal muestra un número de registro ficticio y un botón Continuar — vaya DIRECTO al formulario de radicación. Nunca visite la página de búsqueda de entidad en la ruta de registro.",
      "En la página de búsqueda de entidad (solo ruta de inicio de sesión): escriba usted mismo cualquier número de 6+ dígitos (p. ej. 482916) — los números demo son ficticios, cualquiera funciona — luego seleccione el resultado DEMO ENTITY LLC y pulse Continuar. NUNCA le pida a la persona un número de registro en el portal demo.",
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
      "Demo registry numbers are fictional — entering any 6+ digits on the demo search page is expected. Never ask the human for a registry number.",
      "The first form submit always fails on phone format — expect the inline error and handle it through the humanized-error path.",
    ],
    hintsEs: [
      "El portal demo es ficticio — ensaye con libertad; nada aquí toca un sistema del gobierno.",
      "El demo acepta cualquier credencial, pero igual debe pausar para la persona en cada puerta: login, creación de contraseña, Seguro Social, certificación, pago y revisión final.",
      "Los números de registro demo son ficticios — escribir cualquier número de 6+ dígitos en la búsqueda demo es lo esperado. Nunca le pida a la persona un número de registro.",
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
    // Synthetic requirement id — the demo portal has no real obligation, so
    // the server synthesizes a demo obligation carrying this id and routes it
    // through the identical structured-objective code path as real agencies.
    requirementIds: ["demo:rehearsal-filing"],
  },
];

export function getFilingConfig(id: AgencyFilingType): AgencyFilingConfig {
  const found = AGENCY_FILING_CONFIGS.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown filing type: ${id}`);
  return found;
}
