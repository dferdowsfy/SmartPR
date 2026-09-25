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
/**
 * How much of a filing's live government workflow has actually been proven.
 * A requirement mapped to a filing is NOT evidence that the workflow works.
 * - "mapped": a rule-emitted requirement routes here; no flow content yet.
 * - "documented": step content from official guides/manuals; nothing observed live.
 * - "partially_observed": some live screens walked read-only; the rest is documented.
 * - "rehearsed": the observed screens are cloned into a rehearsal fixture and a
 *   browser test proves every Mita request matches the visible step. Still
 *   NOT a live filing.
 * - "verified": an authorized human completed an actual filing through Mita
 *   and the portal confirmation was recorded (see docs/agency-rollout-plan.md).
 */
export type FilingVerificationStatus =
  | "mapped"
  | "documented"
  | "partially_observed"
  | "rehearsed"
  | "verified";

export interface FilingVerification {
  status: FilingVerificationStatus;
  /** What was actually observed, and where the evidence lives. */
  evidence: string;
  /** ISO date of the last live observation (required for partially_observed, rehearsed, verified). */
  checkedAt?: string;
  /** Rehearsal fixture route + browser test proving it (required for "rehearsed"). */
  fixture?: { route: string; test: string };
  /** Recorded portal confirmation of a real filing (required for "verified"). */
  confirmation?: { reference: string; recordedAt: string; recordedBy: string };
}

/**
 * Can SmartPR take part in paying this filing's government fee? Researched
 * per agency; never assumed. A saved Stripe payment method and SmartPR
 * credit are SmartPR-side instruments — neither can be entered into a
 * third-party government checkout unless the agency offers an authorized
 * integration that accepts payment initiated through SmartPR.
 */
export type PaymentIntegration =
  /** No public/partner integration found: card entry happens only inside the agency portal. */
  | "none_known"
  /** An authorized agency integration exists and was verified (agreement on file). */
  | "authorized_integration"
  /** The filing charges no government fee. */
  | "not_applicable"
  /** Not researched yet. */
  | "unknown";

export interface PaymentFeasibility {
  /** Does the portal charge a government fee for this filing? */
  governmentFee: "yes" | "no" | "unknown";
  /** Amount / basis as observed or documented (display only). */
  feeNote: string;
  /** Who collects the fee and where the card is entered. */
  collector: string;
  /** Accepted methods as observed or documented. */
  methods: string;
  integration: PaymentIntegration;
  /** What was checked to reach that conclusion, with dates. */
  integrationEvidence: string;
  /**
   * What Mita does at the payment screen. Without an authorized integration
   * it is always "user_pays_in_portal": pause, show payee + amount, and let
   * the human pay directly in the portal. Mita never improvises a payment
   * route and never charges automatically.
   */
  smartprPath: "user_pays_in_portal" | "no_payment_step";
}

/**
 * Launch switch for a real government flow. Resolved server-side from the
 * environment: "on"/"1"/"true" enables, "off"/"0"/"false" disables, unset
 * falls back to defaultEnabled. A flow that is not launchable stays visible
 * in the picker as "Not yet available" and the run API refuses it.
 */
export interface LaunchSwitch {
  envFlag: string;
  defaultEnabled: boolean;
}

/** Official entry point evidence: where the start URL comes from. */
export interface EntryPointEvidence {
  /** Official agency page that points users to the online service. */
  officialSource: string;
  /** Route of the filing inside the portal, as found in the portal's own app. */
  portalRoute?: string;
  checkedAt: string;
  note: string;
}

export interface AgencyFilingConfig {
  id: AgencyFilingType;
  /** Live-workflow evidence — never inferred from requirement mappings. */
  verification: FilingVerification;
  /** Government-fee payment feasibility — researched, never assumed. */
  payment: PaymentFeasibility;
  /** Disabled-by-default switch for real flows (absent = launchable when enabled). */
  launch?: LaunchSwitch;
  /** Evidence for startUrl / domains. */
  entry?: EntryPointEvidence;
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
      "If a login / MFA wall appears: PAUSE_USER_LOGIN with PORTAL_STEP kind=login (or mfa) and NO REQUIRED_FIELDS — the human signs in directly in the browser via Take over. Never collect or type credentials; do not loop on login",
      "After landing past login/registration start: prefill name, address, phone, and contact from the Business Passport; prefer Verify Address when the portal requires it before Next",
      "For SSN / taxpayer ID blanks: PAUSE_FOR_USER with PORTAL_STEP kind=identity and REQUIRED_FIELDS using type=text; sensitive=true; hint describing the portal format (e.g. 9 digits — dashes or no dashes as shown). On re-pause after a failed fill, prefer error=<exact on-screen validation> (keep hint= for format)",
      "Pause for document uploads (photo ID, utility bill, SSN card) or remaining sensitive blanks; stop at pre-submit review",
    ],
    procedureEs: [
      "Abra suri.hacienda.pr.gov y navegue hacia Registro → Crear acceso SURI / Registrar como contribuyente individual (adapte a las etiquetas en pantalla)",
      "Si aparece un muro de inicio de sesión / MFA: PAUSE_USER_LOGIN con PORTAL_STEP kind=login (o mfa) y SIN REQUIRED_FIELDS — la persona inicia sesión directamente en el navegador con Tomar el control. Nunca recoja ni escriba credenciales; no cicle en el login",
      "Tras pasar el login/inicio de registro: rellene nombre, dirección, teléfono y contacto desde el Pasaporte de Negocio; prefiera Verificar dirección cuando el portal lo exija antes de Siguiente",
      "Para SSN / ID del contribuyente: PAUSE_FOR_USER con PORTAL_STEP kind=identity y REQUIRED_FIELDS usando type=text; sensitive=true; hint con el formato del portal (p. ej. 9 dígitos — con o sin guiones según se muestre). En re-pausa tras un llenado fallido, prefiera error=<validación exacta en pantalla> (mantenga hint= para formato)",
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
    payment: {
      governmentFee: "no",
      feeNote: "Creating a SURI account carries no government fee (Hacienda registration guide).",
      collector: "None",
      methods: "None",
      integration: "not_applicable",
      integrationEvidence: "No payment step in the documented registration flow; live host unreachable from SmartPR's network 2026-09-25 (redirect loop).",
      smartprPath: "no_payment_step",
    },
    // Preserves today's behavior (no emitting rule, so unreachable anyway).
    launch: { envFlag: "MITA_FLOW_SURI_REGISTER_TAXPAYER", defaultEnabled: true },
    verification: {
      status: "documented",
      evidence:
        "Playbook from Hacienda's official registration guide. Live host timed out during the walkthrough; no screen, selector, CAPTCHA or bot-wall behavior observed. DOC_SURI_REGISTRATION is emitted by no engine rule, so no user reaches this filing today.",
    },
    requirementIds: ["DOC_SURI_REGISTRATION"],
    /**
     * Evidence basis: Hacienda's official registration guide. The live host
     * timed out during the walkthrough — screens, selectors, CAPTCHA, and
     * bot-wall behavior are UNVERIFIED and must be re-walked from a
     * SURI-accepted network before being called live-verified.
     */
    playbook: {
      scope_en:
        "Register as Individual Taxpayer / create a SURI logon (based on Hacienda's official guide — not live-verified)",
      scope_es:
        "Registro como contribuyente individual / crear acceso SURI (según la guía oficial de Hacienda — no verificado en vivo)",
      steps: [
        {
          id: "navigate",
          label_en: "Portal navigation",
          label_es: "Navegación del portal",
          channel: "AGENT",
          pageId: "SURI home",
          fields: [],
          expectedState_en: "Portal loaded on an allowlisted domain",
          expectedState_es: "Portal cargado en un dominio permitido",
        },
        {
          id: "id_type_ssn",
          label_en: "ID type and SSN",
          label_es: "Tipo de ID y SSN",
          channel: "INLINE",
          pageId: "Registration — taxpayer identification",
          fields: [
            {
              id: "id_type",
              label_en: "ID type",
              label_es: "Tipo de identificación",
              type: "select",
              required: true,
              options: ["SSN", "EIN"],
            },
            {
              id: "ssn",
              label_en: "SSN",
              label_es: "Número de Seguro Social",
              type: "text",
              required: true,
              sensitive: true,
              hint_en: "9 digits — dashes or no dashes as shown on the portal",
              hint_es: "9 dígitos — con o sin guiones según se muestre en el portal",
            },
            {
              id: "ssn_confirm",
              label_en: "Confirm SSN",
              label_es: "Confirmar Seguro Social",
              type: "text",
              required: true,
              sensitive: true,
              hint_en: "Re-enter the same 9-digit SSN",
              hint_es: "Vuelva a escribir el mismo SSN de 9 dígitos",
            },
          ],
          expectedState_en: "ID type and SSN (entered twice) accepted",
          expectedState_es: "Tipo de ID y SSN (ingresado dos veces) aceptados",
          notes_en:
            "Sensitive values stay encrypted at rest and masked in chat with an eye icon to reveal.",
          notes_es:
            "Los valores sensibles permanecen cifrados en reposo y enmascarados en el chat con un ícono de ojo para mostrarlos.",
        },
        {
          id: "taxpayer_verification",
          label_en: "Taxpayer verification",
          label_es: "Verificación del contribuyente",
          channel: "INLINE",
          pageId: "Registration — taxpayer verification",
          fields: [
            {
              id: "verification_amount",
              label_en: "Verification amount",
              label_es: "Cantidad de verificación",
              type: "text",
              required: true,
              sensitive: true,
              hint_en:
                "Exact amount or value from a prior filing or notice, as the portal asks",
              hint_es:
                "Cantidad o valor exacto de una radicación o aviso previo, según lo pida el portal",
            },
          ],
          expectedState_en: "Taxpayer identity verified",
          expectedState_es: "Identidad del contribuyente verificada",
          notes_en:
            "Taxpayer identity and proof of account ownership are required to complete registration.",
          notes_es:
            "La identidad del contribuyente y la prueba de titularidad de la cuenta son requeridas para completar el registro.",
        },
        {
          id: "correspondence",
          label_en: "Correspondence ID",
          label_es: "ID de correspondencia",
          channel: "IN_BROWSER",
          pageId: "Registration — correspondence",
          gate: "phone_call",
          fields: [],
          expectedState_en: "Correspondence step resolved by the human",
          expectedState_es: "Paso de correspondencia resuelto por el humano",
          notes_en:
            "Correspondence ID may require a phone call — human only. The agent stops and hands control to the human.",
          notes_es:
            "El ID de correspondencia puede requerir una llamada telefónica — solo el humano. El agente se detiene y cede el control.",
        },
        {
          id: "merchant_info",
          label_en: "Merchant information and authentication type",
          label_es: "Información del comerciante y tipo de autenticación",
          channel: "INLINE",
          pageId: "Registration — merchant information",
          fields: [
            {
              id: "merchant_role",
              label_en: "Merchant role",
              label_es: "Rol del comerciante",
              type: "select",
              required: true,
              options: ["Dueño"],
            },
            {
              id: "merchant_legal_name",
              label_en: "Legal name",
              label_es: "Nombre legal",
              passportPath: "business.legalName",
              type: "text",
              required: true,
            },
            {
              id: "merchant_trade_name",
              label_en: "Trade name (DBA)",
              label_es: "Nombre comercial (DBA)",
              passportPath: "business.tradeName",
              type: "text",
              required: false,
            },
            {
              id: "merchant_street",
              label_en: "Street address",
              label_es: "Dirección física",
              passportPath: "addresses.principalPhysical.line1",
              type: "text",
              required: true,
            },
            {
              id: "merchant_municipality",
              label_en: "Municipality",
              label_es: "Municipio",
              passportPath: "addresses.municipality",
              type: "text",
              required: true,
            },
            {
              id: "merchant_postal",
              label_en: "Postal code",
              label_es: "Código postal",
              passportPath: "addresses.principalPhysical.postalCode",
              type: "text",
              required: true,
            },
            {
              id: "merchant_contact_name",
              label_en: "Contact name",
              label_es: "Nombre de contacto",
              passportPath: "contact.fullName",
              type: "text",
              required: true,
            },
            {
              id: "merchant_contact_email",
              label_en: "Contact email",
              label_es: "Email de contacto",
              passportPath: "contact.email",
              type: "email",
              required: true,
            },
            {
              id: "merchant_contact_phone",
              label_en: "Contact phone",
              label_es: "Teléfono de contacto",
              passportPath: "contact.phone",
              type: "tel",
              required: true,
            },
          ],
          expectedState_en: "Merchant information accepted",
          expectedState_es: "Información del comerciante aceptada",
          notes_en:
            'Selecting "Dueño" determines the Administrador Principal for the account.',
          notes_es:
            'Seleccionar "Dueño" determina el Administrador Principal de la cuenta.',
        },
        {
          id: "web_user",
          label_en: "Web user information",
          label_es: "Información del usuario web",
          // Credentials are created by the human in the browser (Take
          // over) — SmartPR never collects portal passwords in chat.
          channel: "IN_BROWSER",
          pageId: "Registration — web user",
          fields: [],
          expectedState_en: "Web user credentials and secret Q&A accepted",
          expectedState_es:
            "Credenciales del usuario web y pregunta secreta aceptadas",
          notes_en:
            "The human chooses the username, password and secret question/answer directly on the portal — pause with PORTAL_STEP kind=login and offer Take over. Never type or collect them.",
          notes_es:
            "La persona elige el usuario, la contraseña y la pregunta/respuesta secreta directamente en el portal — pause con PORTAL_STEP kind=login y ofrezca Tomar el control. Nunca los escriba ni los recoja.",
        },
        {
          id: "review_submit",
          label_en: 'Review and "Someter"',
          label_es: 'Revisión y "Someter"',
          channel: "IN_BROWSER",
          pageId: "Registration — review",
          gate: "signature",
          fields: [],
          expectedState_en: '"Someter" clicked by the human; account created',
          expectedState_es: '"Someter" presionado por el humano; cuenta creada',
          notes_en:
            '"Someter" IS the legal account-creation act — human only. The agent stops here and hands control to the human.',
          notes_es:
            '"Someter" ES el acto legal de creación de cuenta — solo el humano. El agente se detiene aquí y cede el control.',
        },
        {
          id: "confirmation",
          label_en: "Confirmation capture",
          label_es: "Captura de confirmación",
          channel: "AGENT",
          pageId: "Confirmation screen",
          fields: [],
          expectedState_en: "Confirmation code captured and reported",
          expectedState_es: "Código de confirmación capturado y reportado",
        },
        {
          id: "first_login",
          label_en: "First login",
          label_es: "Primer inicio de sesión",
          // Login is a human-only step: the human signs in in the browser.
          channel: "IN_BROWSER",
          pageId: "SURI login",
          gate: "login",
          fields: [],
          expectedState_en: "Authenticated into SURI",
          expectedState_es: "Autenticado en SURI",
          notes_en:
            "Pause with PORTAL_STEP kind=login — the human signs in directly in the browser via Take over. Never type or collect credentials.",
          notes_es:
            "Pause con PORTAL_STEP kind=login — la persona inicia sesión directamente en el navegador con Tomar el control. Nunca escriba ni recoja credenciales.",
        },
        {
          id: "otp",
          label_en: "One-time code (unrecognized device)",
          label_es: "Código de un solo uso (dispositivo no reconocido)",
          // MFA is human-only: the code is typed in the browser, never chat.
          channel: "IN_BROWSER",
          pageId: "SURI device verification",
          gate: "login",
          fields: [],
          expectedState_en: "Device verified; login completes",
          expectedState_es: "Dispositivo verificado; inicio de sesión completo",
          notes_en:
            "Pause with PORTAL_STEP kind=mfa — the human enters the one-time code in the browser via Take over.",
          notes_es:
            "Pause con PORTAL_STEP kind=mfa — la persona escribe el código de un solo uso en el navegador con Tomar el control.",
        },
        {
          id: "dashboard",
          label_en: "Dashboard verification",
          label_es: "Verificación del panel",
          channel: "AGENT",
          pageId: "SURI dashboard",
          fields: [],
          expectedState_en: "Authenticated SURI dashboard visible",
          expectedState_es: "Panel de SURI autenticado visible",
        },
      ],
      confirmation: {
        reference_en: "Confirmation code",
        reference_es: "Código de confirmación",
        where_en: 'Confirmation screen shown after clicking "Someter"',
        where_es: 'Pantalla de confirmación mostrada tras presionar "Someter"',
      },
      quirks_en: [
        "The live host timed out during the walkthrough — screens, selectors, CAPTCHA, and bot-wall behavior are UNVERIFIED. Re-walk from a SURI-accepted network before treating any of this as live-verified.",
        "Registration is free — there is no payment step.",
        "Taxpayer identity and proof of account ownership are required to complete registration.",
      ],
      quirks_es: [
        "El servidor no respondió durante el recorrido — las pantallas, selectores, CAPTCHA y comportamiento anti-bots NO están verificados. Repita el recorrido desde una red aceptada por SURI antes de tratar esto como verificado en vivo.",
        "El registro es gratis — no hay paso de pago.",
        "La identidad del contribuyente y la prueba de titularidad de la cuenta son requeridas para completar el registro.",
      ],
    },
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
      "Open suri.hacienda.pr.gov; on the login page PAUSE_USER_LOGIN with PORTAL_STEP kind=login and NO REQUIRED_FIELDS — the human signs in (and completes MFA) in the browser via Take over. Never collect or type credentials; do not loop on login",
      "After landing in the authenticated SURI home, open the merchant registration path (Registro de Comerciante) from the post-login menus",
      "Prefill merchant / business identity, addresses, and contact from the Business Passport; pause only for uploads, captcha, payment, or sensitive blanks the passport cannot fill. For SSN/ID use type=text; sensitive=true with hint= format (and error= for on-screen validation on re-pause)",
      "Stop at pre-submit review — never click final Enviar",
    ],
    procedureEs: [
      "Abra suri.hacienda.pr.gov; en la página de login haga PAUSE_USER_LOGIN con PORTAL_STEP kind=login y SIN REQUIRED_FIELDS — la persona inicia sesión (y completa MFA) en el navegador con Tomar el control. Nunca recoja ni escriba credenciales; no cicle en el login",
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
    payment: {
      governmentFee: "unknown",
      feeNote: "Not researched — confirm whether Registro de Comerciante charges a fee before building this flow.",
      collector: "Unknown",
      methods: "Unknown",
      integration: "unknown",
      integrationEvidence: "Not researched. SURI host unreachable from SmartPR's network 2026-09-25 (redirect loop).",
      smartprPath: "user_pays_in_portal",
    },
    verification: {
      status: "mapped",
      evidence:
        "No playbook and disabled. DOC_MERCHANT_REGISTRATION is emitted by engine rules, so users see it as 'not yet supported'.",
    },
    requirementIds: ["DOC_MERCHANT_REGISTRATION"],
  },
  {
    id: "DEPT_STATE_CORPORATE_FILING",
    // Corporation formation ONLY. LLC formation (DOC_CERT_ORGANIZATION) and
    // the annual report (DOC_ANNUAL_REPORT) are separate variants below —
    // the recorded walkthrough and its wizard screens (Incorporators,
    // Officers, Capital Stock, $150 corporation fee) are corporation screens.
    labelEn: "Dept. of State — Form a corporation (Certificate of Incorporation)",
    labelEs: "Departamento de Estado — Crear una corporación (Certificado de Incorporación)",
    agencyEn: "Puerto Rico Department of State",
    agencyEs: "Departamento de Estado de Puerto Rico",
    portalEn: "Corporate & Entities Registry",
    portalEs: "Registro de Corporaciones y Entidades",
    // rcp = the registry web app; rceapi = its API host (XHR only, never a
    // navigation target). Both are *.estado.pr.gov.
    domains: ["rcp.estado.pr.gov", "rceapi.estado.pr.gov"],
    startUrl: "https://rcp.estado.pr.gov/en",
    entry: {
      officialSource:
        "https://www.statedepartment.pr.gov/registration-of-legal-entities (names rceweb.estado.pr.gov/en/law-entity); https://estado.pr.gov/en/services/services-corporations (names rceweb.f1hst.com)",
      portalRoute: "/en/creationfilings/wizard (thank-you: /en/creationfilings/thank-you)",
      checkedAt: "2026-09-25",
      note:
        "The official pages name rceweb.estado.pr.gov and the vendor host rceweb.f1hst.com; rceweb returned HTTP 503 to SmartPR's network. rcp.estado.pr.gov serves the live registry app: its public bundle routes /en/creationfilings/wizard, calls rceapi.estado.pr.gov, and redirects maintenance to maint.f1hst.com (same vendor). The 2026-09-24 walkthrough ran on rcp. Reconfirm with the Dept. of State (registropersonasjuridicas@estado.pr.gov) before the live pilot.",
    },
    // Disabled by default: set MITA_FLOW_DEPT_STATE_CORPORATION=on only for
    // the supervised pilot.
    launch: { envFlag: "MITA_FLOW_DEPT_STATE_CORPORATION", defaultEnabled: false },
    goalEn:
      "Form a NEW corporation by filing its Certificate of Incorporation in the Corporate & Entities Registry creation wizard. Stop at Signatures — the human signs, pays and submits.",
    goalEs:
      "Crear una NUEVA corporación radicando su Certificado de Incorporación en el asistente de creación del Registro de Corporaciones y Entidades. Deténgase en Firmas — la persona firma, paga y envía.",
    procedureEn: [
      "Follow the OBJECTIVE named in the goal brief exactly: corporation formation only. Never file an annual report and never form an LLC in this run.",
      "From the registry home, open the creation wizard (route /en/creationfilings/wizard). If login is required: PAUSE_USER_LOGIN with PORTAL_STEP kind=login and NO REQUIRED_FIELDS — the human signs in in the browser via Take over.",
      "Walk the wizard screens in the STEP CATALOG order; identify every screen by its heading before acting, and report PORTAL_STEP with the catalog's step on every pause.",
      "Prefill every mapped field from the Business Passport (see FIELD MAP); ask the human only for catalog fields the passport cannot fill.",
      "On Review Filing verify only — never check the perjury declaration. Stop at Signatures and at Payment for the human; never sign, pay or submit.",
    ],
    procedureEs: [
      "Siga EXACTAMENTE el OBJETIVO del resumen: solo creación de corporación. Nunca radique un informe anual ni cree una LLC en esta ejecución.",
      "Desde la portada del registro, abra el asistente de creación (ruta /en/creationfilings/wizard). Si se requiere inicio de sesión: PAUSE_USER_LOGIN con PORTAL_STEP kind=login y SIN REQUIRED_FIELDS — la persona inicia sesión con Tomar el control.",
      "Recorra las pantallas en el orden del CATÁLOGO DE PASOS; identifique cada pantalla por su encabezado antes de actuar y reporte PORTAL_STEP con el paso del catálogo en cada pausa.",
      "Rellene cada campo mapeado desde el Pasaporte de Negocio (MAPA DE CAMPOS); pida a la persona solo campos del catálogo que el pasaporte no cubra.",
      "En Revisar radicación solo verifique — nunca marque la declaración de perjurio. Deténgase en Firmas y en Pago para la persona; nunca firme, pague ni envíe.",
    ],
    uploadsEn: "Optional supporting documents — PDF/TIF, under 7 MB, no SSN or tax ID data",
    uploadsEs: "Documentos de apoyo opcionales — PDF/TIF, menos de 7 MB, sin SSN ni IDs contributivos",
    hintsEn: [
      "Server-side address validation rejects PO boxes and fake addresses — use the passport's physical street address.",
      "The confirm-email field validates on blur; retype it and leave the field.",
      "The human signs in, signs, pays and submits in the browser via Take over — never in SmartPR chat.",
    ],
    hintsEs: [
      "La validación de dirección del servidor rechaza apartados postales y direcciones falsas — use la dirección física del pasaporte.",
      "El campo de confirmar correo valida al salir; vuelva a escribirlo y salga del campo.",
      "La persona inicia sesión, firma, paga y envía en el navegador con Tomar el control — nunca en el chat de SmartPR.",
    ],
    evidenceTags: [],
    needsLogin: true,
    enabled: true,
    requiresExistingAccount: false,
    agencyId: "DEPT_STATE",
    passportCoverageKeys: [
      "business.legalName",
      "business.entityType",
      "contact.fullName",
      "contact.email",
      "contact.phone",
      "addresses.principalPhysical.line1",
      "addresses.municipality",
      "addresses.principalPhysical.postalCode",
    ],
    blockedBy: [],
    sensitiveNeeds: [],
    payment: {
      governmentFee: "yes",
      feeNote:
        "Fee panel observed 2026-09-24: minimum $140 + $10 certificate = $150.00 for a corporation (varies with authorized capital stock).",
      collector:
        "PR Department of State registry — card is entered in the wizard's own Payments step (rcp.estado.pr.gov) and posted to rceapi.estado.pr.gov/api/transaction/submit/creationfiling",
      methods: "Credit card — Visa, MasterCard, AmEx (walkthrough notes); agency-issued vouchers exist for registry staff only",
      integration: "none_known",
      integrationEvidence:
        "2026-09-25: public registry bundle holds card number / expiry / CVV in the portal's own form and submits them to rceapi; no hosted third-party checkout, no public or partner payment API, no documented way to pay a SmartPR-initiated charge. Official service pages list no integrations.",
      smartprPath: "user_pays_in_portal",
    },
    // Engine routing: RULE_0001 emits DOC_CERT_INCORPORATION for new,
    // unformed businesses and EXCLUDES LLCs/sole props/partnerships — this is
    // the corporation requirement. LLCs arrive via DOC_CERT_ORGANIZATION.
    verification: {
      // Rehearsed = the observed screens are cloned and the browser test
      // proves every Mita request matches the visible step. NOT a live
      // filing: "verified" needs a real, human-submitted filing + confirmation.
      status: "rehearsed",
      fixture: {
        route: "/rehearsal-portal/dept-state",
        test: "frontend/tests/dept-state-corporation.e2e.mts",
      },
      evidence:
        "Read-only live walkthrough of the corporation creation wizard on rcp.estado.pr.gov, 2026-09-24, stopped at Signatures (one fictional name lookup). Encoded as the playbook below; no screenshots or DOM captures are in the repo. The registry's public bundle (2026-09-25) confirms the same wizard components in the same order. Never observed: login screen, validation-error screens, Signatures, Payment, submission, confirmation.",
      checkedAt: "2026-09-24",
    },
    requirementIds: ["DOC_CERT_INCORPORATION"],
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
          pageId: "Corporate Registry home → Create / Authorize",
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
      "Open sbp.ogpe.pr.gov (Single Business Portal). If a login / profile gate appears: PAUSE_USER_LOGIN with PORTAL_STEP kind=login and NO REQUIRED_FIELDS — the human signs in in the browser via Take over. Never collect or type credentials; do not loop on login",
      "After landing authenticated, start a new Permiso Único application from the portal home / services path the UI actually shows",
      "Prefill business identity, physical location, municipality, phone, and contact from the Business Passport before pausing for anything the passport cannot fill",
      "Pause for document uploads, captcha, or payment as needed; stop at pre-submit review — never click final submit",
    ],
    procedureEs: [
      "Abra sbp.ogpe.pr.gov (Single Business Portal). Si aparece un muro de login / perfil: PAUSE_USER_LOGIN con PORTAL_STEP kind=login y SIN REQUIRED_FIELDS — la persona inicia sesión en el navegador con Tomar el control. Nunca recoja ni escriba credenciales; no cicle en el login",
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
    payment: {
      governmentFee: "yes",
      feeNote: "Non-refundable. Regular evaluation: 10% initially, 90% after analyst validation; ministerial: 100% initially (OGPe Permiso Único manual).",
      collector: "OGPe Single Business Portal (in-portal checkout)",
      methods: "Card or ACH, per the OGPe manual — not observed live",
      integration: "none_known",
      integrationEvidence: "Manual describes in-portal payment only; no public or partner payment API found. Portal returned HTTP 503 to SmartPR's network 2026-09-25.",
      smartprPath: "user_pays_in_portal",
    },
    // Preserves today's behavior; recommended to default off until its own
    // fixture + browser test exist (see docs/agency-rollout-plan.md).
    launch: { envFlag: "MITA_FLOW_OGPE_PERMISO_UNICO", defaultEnabled: true },
    verification: {
      status: "partially_observed",
      evidence:
        "Only pre-login Single Business Portal screens were live-verified; every post-login step comes from OGPe's official Permiso Único manual. Uploads, payment and submission never observed.",
      checkedAt: "2026-09-15",
    },
    requirementIds: ["DOC_PERMISO_UNICO"],
    /**
     * Evidence basis: only pre-login screens were live-verified. Post-login
     * steps come from OGPe's official 36-page Permiso Único manual — do not
     * describe post-login behavior as live-verified.
     */
    playbook: {
      scope_en:
        "Permiso Único (single business permit) application via the Single Business Portal",
      scope_es:
        "Solicitud de Permiso Único por el Single Business Portal",
      steps: [
        {
          id: "navigate",
          label_en: "Portal navigation",
          label_es: "Navegación del portal",
          channel: "AGENT",
          pageId: "Single Business Portal home",
          fields: [],
          expectedState_en: "Portal loaded on an allowlisted domain",
          expectedState_es: "Portal cargado en un dominio permitido",
        },
        {
          id: "login",
          label_en: "Single Business Portal login",
          label_es: "Inicio de sesión en el Single Business Portal",
          // Login is a human-only step: the human signs in in the browser.
          channel: "IN_BROWSER",
          pageId: "SBP login screen",
          gate: "login",
          fields: [],
          expectedState_en: "Authenticated into the Single Business Portal",
          expectedState_es: "Autenticado en el Single Business Portal",
          notes_en:
            "Hard login gate before any application step. Pause with PORTAL_STEP kind=login — the human signs in directly in the browser via Take over. Never type or collect credentials.",
          notes_es:
            "Muro de inicio de sesión antes de cualquier paso de solicitud. Pause con PORTAL_STEP kind=login — la persona inicia sesión directamente en el navegador con Tomar el control. Nunca escriba ni recoja credenciales.",
        },
        {
          id: "crear_solicitud",
          label_en: "Crear Solicitud and project selection",
          label_es: "Crear Solicitud y selección de proyecto",
          channel: "INLINE",
          pageId: "Crear Solicitud",
          fields: [
            {
              id: "solicitud_type",
              label_en: "Application type",
              label_es: "Tipo de solicitud",
              type: "select",
              required: true,
              options: ["Permiso Único"],
            },
          ],
          expectedState_en:
            "Draft solicitud created; project attached or created as the human chooses",
          expectedState_es:
            "Borrador de solicitud creado; proyecto adjuntado o creado según elija el humano",
          notes_en:
            "If the wizard asks whether to attach an existing project or create a new one, collect that choice inline as a follow-up field.",
          notes_es:
            "Si el asistente pregunta si adjuntar un proyecto existente o crear uno nuevo, recoja esa elección en línea como campo adicional.",
        },
        {
          id: "crear_proyecto",
          label_en: "Crear Proyecto wizard",
          label_es: "Asistente Crear Proyecto",
          channel: "INLINE",
          pageId: "Crear Proyecto",
          fields: [
            {
              id: "project_name",
              label_en: "Project name",
              label_es: "Nombre del proyecto",
              type: "text",
              required: true,
            },
            {
              id: "project_legal_name",
              label_en: "Legal name",
              label_es: "Nombre legal",
              passportPath: "business.legalName",
              type: "text",
              required: true,
            },
            {
              id: "project_trade_name",
              label_en: "Trade name (DBA)",
              label_es: "Nombre comercial (DBA)",
              passportPath: "business.tradeName",
              type: "text",
              required: false,
            },
            {
              id: "project_entity_type",
              label_en: "Entity type",
              label_es: "Tipo de entidad",
              passportPath: "business.entityType",
              type: "text",
              required: true,
            },
            {
              id: "project_street",
              label_en: "Street address",
              label_es: "Dirección física",
              passportPath: "addresses.principalPhysical.line1",
              type: "text",
              required: true,
            },
            {
              id: "project_street2",
              label_en: "Street address line 2",
              label_es: "Dirección física línea 2",
              passportPath: "addresses.principalPhysical.line2",
              type: "text",
              required: false,
            },
            {
              id: "project_municipality",
              label_en: "Municipality",
              label_es: "Municipio",
              passportPath: "addresses.municipality",
              type: "text",
              required: true,
            },
            {
              id: "project_postal",
              label_en: "Postal code",
              label_es: "Código postal",
              passportPath: "addresses.principalPhysical.postalCode",
              type: "text",
              required: true,
            },
            {
              id: "project_contact_name",
              label_en: "Contact name",
              label_es: "Nombre de contacto",
              passportPath: "contact.fullName",
              type: "text",
              required: true,
            },
            {
              id: "project_contact_email",
              label_en: "Contact email",
              label_es: "Email de contacto",
              passportPath: "contact.email",
              type: "email",
              required: true,
            },
            {
              id: "project_contact_phone",
              label_en: "Contact phone",
              label_es: "Teléfono de contacto",
              passportPath: "contact.phone",
              type: "tel",
              required: true,
            },
          ],
          expectedState_en: "Project saved and linked to the solicitud",
          expectedState_es: "Proyecto guardado y vinculado a la solicitud",
        },
        {
          id: "permiso_unico",
          label_en: "Permiso Único wizard",
          label_es: "Asistente Permiso Único",
          channel: "INLINE",
          pageId: "Permiso Único application",
          fields: [
            {
              id: "permiso_legal_name",
              label_en: "Legal name",
              label_es: "Nombre legal",
              passportPath: "business.legalName",
              type: "text",
              required: true,
            },
            {
              id: "permiso_street",
              label_en: "Physical location address",
              label_es: "Dirección del local",
              passportPath: "addresses.principalPhysical.line1",
              type: "text",
              required: true,
            },
            {
              id: "permiso_municipality",
              label_en: "Municipality",
              label_es: "Municipio",
              passportPath: "addresses.municipality",
              type: "text",
              required: true,
            },
            {
              id: "permiso_postal",
              label_en: "Postal code",
              label_es: "Código postal",
              passportPath: "addresses.principalPhysical.postalCode",
              type: "text",
              required: true,
            },
            {
              id: "permiso_contact_email",
              label_en: "Contact email",
              label_es: "Email de contacto",
              passportPath: "contact.email",
              type: "email",
              required: true,
            },
            {
              id: "permiso_contact_phone",
              label_en: "Contact phone",
              label_es: "Teléfono de contacto",
              passportPath: "contact.phone",
              type: "tel",
              required: true,
            },
          ],
          expectedState_en:
            "All wizard sections complete; ready for required uploads",
          expectedState_es:
            "Todas las secciones del asistente completas; listo para los adjuntos requeridos",
        },
        {
          id: "anejos",
          label_en: "Anejos (required uploads)",
          label_es: "Anejos (adjuntos requeridos)",
          channel: "INLINE",
          pageId: "Anejos",
          gate: "upload",
          fields: [],
          expectedState_en:
            "All required documents uploaded into the Evidence Locker and attached",
          expectedState_es:
            "Todos los documentos requeridos subidos al Casillero de evidencia y adjuntados",
          notes_en:
            "Required uploads block progress before payment. The human uploads files in the chat; the agent attaches them in the portal.",
          notes_es:
            "Los adjuntos requeridos bloquean el avance antes del pago. El humano sube los archivos en el chat; el agente los adjunta en el portal.",
        },
        {
          id: "juramento",
          label_en: '"Bajo juramento" certification',
          label_es: 'Certificación "Bajo juramento"',
          channel: "IN_BROWSER",
          pageId: "Certification screen",
          gate: "signature",
          fields: [],
          expectedState_en:
            '"Bajo juramento" certification checked by the human',
          expectedState_es:
            'Certificación "Bajo juramento" marcada por el humano',
          notes_en:
            "This IS the legal certification act — human only. The agent stops here and hands control to the human.",
          notes_es:
            "Este ES el acto legal de certificación — solo el humano. El agente se detiene aquí y cede el control.",
        },
        {
          id: "payment",
          label_en: "Payment",
          label_es: "Pago",
          channel: "IN_BROWSER",
          pageId: "Payment screen",
          gate: "payment",
          fields: [],
          expectedState_en: "Payment completed; receipt issued",
          expectedState_es: "Pago completado; recibo emitido",
          notes_en:
            "Card or ACH. Regular evaluation: 10% initially, remaining 90% after analyst validation. Ministerial: 100% initially. Payment is non-refundable. SmartPR never touches payment details.",
          notes_es:
            "Tarjeta o ACH. Evaluación regular: 10% inicial, 90% restante tras la validación del analista. Ministerial: 100% inicial. El pago no es reembolsable. SmartPR nunca toca los datos de pago.",
        },
        {
          id: "confirmation",
          label_en: "Confirmation capture",
          label_es: "Captura de confirmación",
          channel: "AGENT",
          pageId: "Confirmation screen",
          fields: [],
          expectedState_en:
            "Número de Trámite / Número de Permiso captured and reported",
          expectedState_es:
            "Número de Trámite / Número de Permiso capturado y reportado",
        },
      ],
      confirmation: {
        reference_en: "Número de Trámite / Número de Permiso",
        reference_es: "Número de Trámite / Número de Permiso",
        where_en: "Confirmation screen shown after payment",
        where_es: "Pantalla de confirmación mostrada tras el pago",
      },
      quirks_en: [
        "Only pre-login screens were live-verified; post-login steps come from OGPe's official Permiso Único manual — do not describe post-login behavior as live-verified.",
        "Hard Single Business Portal login gate before any application step.",
        "Required anejos (uploads) block progress before payment.",
        "Payment is non-refundable: regular evaluation 10% initially and 90% after analyst validation; ministerial 100% initially; card or ACH.",
      ],
      quirks_es: [
        "Solo las pantallas previas al inicio de sesión se verificaron en vivo; los pasos posteriores provienen del manual oficial de Permiso Único de OGPe — no describa el comportamiento posterior como verificado en vivo.",
        "Muro de inicio de sesión del Single Business Portal antes de cualquier paso de solicitud.",
        "Los anejos requeridos (adjuntos) bloquean el avance antes del pago.",
        "El pago no es reembolsable: evaluación regular 10% inicial y 90% tras la validación del analista; ministerial 100% inicial; tarjeta o ACH.",
      ],
    },
  },
  {
    id: "DEPT_STATE_LLC_FORMATION",
    // Visible, never launchable until its own screens are observed. The
    // registry serves the wizard's step list per entity class
    // (/api/nav/wizard/...), and no LLC wizard screen has been walked —
    // the corporation playbook must not be reused for LLCs.
    labelEn: "Dept. of State — Form an LLC (Certificate of Organization)",
    labelEs: "Departamento de Estado — Crear una LLC (Certificado de Organización)",
    agencyEn: "Puerto Rico Department of State",
    agencyEs: "Departamento de Estado de Puerto Rico",
    portalEn: "Corporate & Entities Registry",
    portalEs: "Registro de Corporaciones y Entidades",
    domains: ["rcp.estado.pr.gov", "rceapi.estado.pr.gov"],
    startUrl: "https://rcp.estado.pr.gov/en",
    entry: {
      officialSource: "https://www.statedepartment.pr.gov/registration-of-legal-entities",
      portalRoute: "/en/creationfilings/wizard (shared creation wizard; LLC step list not observed)",
      checkedAt: "2026-09-25",
      note: "Same host evidence as corporation formation. LLC-specific screens unobserved.",
    },
    launch: { envFlag: "MITA_FLOW_DEPT_STATE_LLC", defaultEnabled: false },
    goalEn: "Form a NEW LLC by filing its Certificate of Organization in the Corporate & Entities Registry.",
    goalEs: "Crear una NUEVA LLC radicando su Certificado de Organización en el Registro de Corporaciones y Entidades.",
    procedureEn: ["Not implemented — LLC wizard screens have not been observed."],
    procedureEs: ["No implementado — no se han observado las pantallas del asistente para LLC."],
    uploadsEn: "Not yet documented",
    uploadsEs: "Aún no documentado",
    hintsEn: [],
    hintsEs: [],
    evidenceTags: [],
    needsLogin: true,
    enabled: false,
    requiresExistingAccount: false,
    agencyId: "DEPT_STATE",
    passportCoverageKeys: ["business.legalName", "contact.fullName", "contact.email", "contact.phone"],
    blockedBy: [],
    sensitiveNeeds: [],
    payment: {
      governmentFee: "yes",
      feeNote: "Not observed for LLCs. Public sources cite a formation fee; confirm on the fee panel during the read-only walk.",
      collector:
        "PR Department of State registry — card entered inside the registry's own wizard (rcp.estado.pr.gov → rceapi.estado.pr.gov)",
      methods: "Credit card per the corporation walkthrough; not observed for this variant",
      integration: "none_known",
      integrationEvidence:
        "Same registry payment module as corporation formation (2026-09-25 bundle review): in-portal card entry, no public or partner payment API.",
      smartprPath: "user_pays_in_portal",
    },
    verification: {
      status: "mapped",
      evidence:
        "RULE_0651 emits DOC_CERT_ORGANIZATION for new, unformed LLCs (excludes every corporation type). The registry app has one creation wizard whose step list is served per entity class; no LLC screen has been walked, so there is no playbook.",
    },
    // RULE_0651 → DOC_CERT_ORGANIZATION is the rule-emitted LLC requirement.
    // DOC_ARTICLES_ORGANIZATION (catalog only, no emitting rule) is the same
    // filing under another name and routes here too — never to corporations.
    requirementIds: ["DOC_CERT_ORGANIZATION", "DOC_ARTICLES_ORGANIZATION"],
  },
  {
    id: "DEPT_STATE_ANNUAL_REPORT",
    // Visible, never launchable. Two sub-variants exist in law: corporations
    // file the Informe Anual; LLCs pay the annual fee. Neither is observed.
    labelEn: "Dept. of State — Annual report / annual fee",
    labelEs: "Departamento de Estado — Informe anual / derecho anual",
    agencyEn: "Puerto Rico Department of State",
    agencyEs: "Departamento de Estado de Puerto Rico",
    portalEn: "Corporate & Entities Registry",
    portalEs: "Registro de Corporaciones y Entidades",
    domains: ["rcp.estado.pr.gov", "rceapi.estado.pr.gov"],
    startUrl: "https://rcp.estado.pr.gov/en",
    entry: {
      officialSource: "https://estado.pr.gov/en/services/services-corporations",
      portalRoute: "/en/annualfiling/wizard (thank-you: /en/annualfiling/thank-you)",
      checkedAt: "2026-09-25",
      note: "Route found in the registry's public bundle; no screen observed.",
    },
    launch: { envFlag: "MITA_FLOW_DEPT_STATE_ANNUAL_REPORT", defaultEnabled: false },
    goalEn: "File the ANNUAL REPORT (or pay the LLC annual fee) for an EXISTING entity.",
    goalEs: "Radicar el INFORME ANUAL (o pagar el derecho anual de la LLC) de una entidad EXISTENTE.",
    procedureEn: ["Not implemented — annual-report screens have not been observed."],
    procedureEs: ["No implementado — no se han observado las pantallas del informe anual."],
    uploadsEn: "Financial statements when required (not yet documented)",
    uploadsEs: "Estados financieros cuando se requieran (aún no documentado)",
    hintsEn: [],
    hintsEs: [],
    evidenceTags: [],
    needsLogin: true,
    enabled: false,
    requiresExistingAccount: true,
    agencyId: "DEPT_STATE",
    passportCoverageKeys: ["business.legalName", "business.registryNumber"],
    blockedBy: [],
    sensitiveNeeds: [],
    payment: {
      governmentFee: "yes",
      feeNote: "Estado services page: LLC annual fee $150, due April 15. Corporation annual-report fees not observed.",
      collector:
        "PR Department of State registry — card entered inside the registry's own wizard (rcp.estado.pr.gov → rceapi.estado.pr.gov)",
      methods: "Credit card per the corporation walkthrough; not observed for this variant",
      integration: "none_known",
      integrationEvidence:
        "Same registry payment module as corporation formation (2026-09-25 bundle review): in-portal card entry, no public or partner payment API.",
      smartprPath: "user_pays_in_portal",
    },
    verification: {
      status: "mapped",
      evidence:
        "RULE_0636 emits DOC_ANNUAL_REPORT for existing entities. The registry bundle exposes an annual-filing wizard and fee/prepay APIs; nothing walked, no playbook.",
    },
    requirementIds: ["DOC_ANNUAL_REPORT"],
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
      "Follow the PORTAL ACCOUNT line in the goal brief: if the human HAS an account, use the Log in path; if NOT, click Create account on the landing — NEVER click Log in on the create-account path. Fill name and email from the passport, then stop at password creation: PAUSE_USER_LOGIN with PORTAL_STEP kind=login — the human creates the password in the browser via Take over. Never type a password yourself, even on the demo portal.",
      "If a login form appears: PAUSE_USER_LOGIN with PORTAL_STEP kind=login (no REQUIRED_FIELDS) — the human signs in in the browser via Take over, exactly as on a real portal. Never type credentials yourself and do not loop on login.",
      "After demo registration completes, the portal shows a fictional registry number and a Continue button — go DIRECTLY to the filing form. Never visit the entity search page on the registration path.",
      "On the entity search page (login path only): enter any 6+ digits yourself (e.g. 482916) — demo numbers are fictional, any number works — then select the DEMO ENTITY LLC result and Continue. NEVER ask the human for a registry number on the demo portal.",
      "On the filing form: prefill EVERY non-sensitive field from the Business Passport first — contact name, email, phone, street, city, postal code, entity type, business activity — matching the dropdown, checkboxes, and radio buttons. Leave SSN, passwords, payment, and attestations blank.",
      "Fiscal year end (filing form): the passport has no fiscal-year field and this entity is fictional, so type 12/31 of the previous calendar year (a calendar fiscal year) in MM/DD/YYYY form, then read it back. Never loop on this field and never pause for it on the demo portal.",
      "If the portal shows an inline validation error after submitting: surface the exact portal message to the chat via the humanized-error path (never invent an explanation), correct the flagged field from passport data when possible, otherwise pause for the human.",
      "On the identity-verification step: PAUSE for the human — never fill in or invent a Social Security Number.",
      "On the identity-verification step use PAUSE_FOR_USER with PORTAL_STEP kind=identity and REQUIRED_FIELDS for the SSN only.",
      "On the certification page: PAUSE_FOR_USER with PORTAL_STEP kind=certification, naming any still-empty items in missing= (e.g. Signature (printed name)) — never check legal certifications or sign on the human's behalf.",
      "On the payment page: PAUSE_PAYMENT with PORTAL_STEP kind=payment — never enter card details or pay.",
      "When the human submits after a takeover, the portal shows a confirmation page: report SUBMITTED:<confirmation number>.",
      "On the final review page: stop at pre-submit review and summarize for the human — never click the final Submit button yourself.",
    ],
    procedureEs: [
      "Siga la línea de CUENTA DEL PORTAL en el resumen: si la persona TIENE cuenta, use Iniciar sesión; si NO, pulse Crear cuenta en la portada. Llene nombre y correo desde el pasaporte y deténgase en la creación de contraseña: PAUSE_USER_LOGIN con PORTAL_STEP kind=login — la persona crea la contraseña en el navegador con Tomar el control. Nunca escriba una contraseña usted mismo, ni siquiera en el portal demo.",
      "Si aparece un formulario de inicio de sesión: PAUSE_USER_LOGIN con PORTAL_STEP kind=login (sin REQUIRED_FIELDS) — la persona inicia sesión en el navegador con Tomar el control, igual que en un portal real. Nunca escriba credenciales usted mismo ni cicle en el login.",
      "Tras completar el registro demo, el portal muestra un número de registro ficticio y un botón Continuar — vaya DIRECTO al formulario de radicación. Nunca visite la página de búsqueda de entidad en la ruta de registro.",
      "En la página de búsqueda de entidad (solo ruta de inicio de sesión): escriba usted mismo cualquier número de 6+ dígitos (p. ej. 482916) — los números demo son ficticios, cualquiera funciona — luego seleccione el resultado DEMO ENTITY LLC y pulse Continuar. NUNCA le pida a la persona un número de registro en el portal demo.",
      "En el formulario de radicación: rellene PRIMERO todos los campos no sensibles desde el Pasaporte de Negocio — nombre del contacto, correo, teléfono, dirección, ciudad, código postal, tipo de entidad, actividad del negocio — incluyendo el dropdown, los checkboxes y los botones de radio. Deje el Seguro Social, contraseñas, pago y certificaciones en blanco.",
      "Cierre del año fiscal (formulario): el pasaporte no tiene ese campo y la entidad es ficticia, así que escriba el 12/31 del año calendario anterior (año fiscal natural) en formato MM/DD/AAAA y verifíquelo. Nunca cicle en este campo ni pause por él en el portal demo.",
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
      "The demo behaves like a real portal for human steps: the human signs in, certifies, signs, pays and submits in the browser via Take over. Every page declares its step in a data-smartpr-step attribute.",
      "Demo registry numbers are fictional — entering any 6+ digits on the demo search page is expected. Never ask the human for a registry number.",
      "The first form submit always fails on phone format — expect the inline error and handle it through the humanized-error path.",
    ],
    hintsEs: [
      "El portal demo es ficticio — ensaye con libertad; nada aquí toca un sistema del gobierno.",
      "El demo se comporta como un portal real en los pasos humanos: la persona inicia sesión, certifica, firma, paga y envía en el navegador con Tomar el control. Cada página declara su paso en un atributo data-smartpr-step.",
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
    payment: {
      governmentFee: "no",
      feeNote: "Fictional payment page — nothing is charged.",
      collector: "None (fictional rehearsal portal)",
      methods: "None",
      integration: "not_applicable",
      integrationEvidence: "SmartPR-owned fictional portal.",
      smartprPath: "user_pays_in_portal",
    },
    verification: {
      status: "rehearsed",
      fixture: { route: "/rehearsal-portal", test: "frontend/tests/mita-rehearsal.e2e.mjs" },
      evidence:
        "Fictional SmartPR portal; each page declares data-smartpr-step. Walked end to end (login takeover → form → SSN → certification takeover → unknown-state pause → human submission → confirmation) by the Mita rehearsal browser test.",
    },
    requirementIds: ["demo:rehearsal-filing"],
  },
];

/**
 * Can a new run start for this filing right now? Server-side only (reads
 * the environment). Disabled configs never launch; configs with a launch
 * switch follow its env flag, falling back to defaultEnabled.
 */
export function isFilingLaunchable(
  config: AgencyFilingConfig,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}
): boolean {
  if (!config.enabled) return false;
  if (!config.launch) return true;
  const raw = (env[config.launch.envFlag] ?? "").trim().toLowerCase();
  if (["on", "1", "true", "yes"].includes(raw)) return true;
  if (["off", "0", "false", "no"].includes(raw)) return false;
  return config.launch.defaultEnabled;
}

export function getFilingConfig(id: AgencyFilingType): AgencyFilingConfig {
  const found = AGENCY_FILING_CONFIGS.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown filing type: ${id}`);
  return found;
}
