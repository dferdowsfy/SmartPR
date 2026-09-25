/**
 * Dept. of State — corporation formation (Certificate of Incorporation).
 *
 * Evidence (see the DEPT_STATE_CORPORATE_FILING config for dates/sources):
 * - Screens name_availability … review were walked read-only on
 *   rcp.estado.pr.gov on 2026-09-24 (English UI) → observed: true.
 * - The registry's public app bundle (2026-09-25) lists the same wizard
 *   components in the same order (CreateAuthorizeNameAvailability …
 *   CreateAuthorizePayments, CreateAuthorizeThankYou) and the routes
 *   /en/creationfilings/wizard and /en/creationfilings/thank-you.
 * - login, signatures, payment and thank-you were NOT seen live → observed:
 *   false; their content comes from the bundle and the walkthrough notes.
 * - Spanish headings were not observed; the ES patterns are best-effort and
 *   an unmatched heading safely resolves to "unknown".
 */
import type { FilingFlow, FlowRecovery } from "./types";

const sessionExpired: FlowRecovery = {
  id: "session_expired",
  match: /session (has )?(expired|timed out)|sesi[oó]n (ha )?(expirado|caducado|expir[oó])/i,
  fix_en: "The portal signed you out. Pause at the login screen (PORTAL_STEP kind=login) — the human signs in again via Take over; then resume on the same wizard step.",
  fix_es: "El portal cerró la sesión. Pause en la pantalla de acceso (PORTAL_STEP kind=login) — la persona vuelve a iniciar sesión con Tomar el control; luego continúe en el mismo paso.",
};

const serverError: FlowRecovery = {
  id: "server_error",
  match: /unexpected error|something went wrong|error inesperado|commonerrorpage|document-error/i,
  fix_en: "The portal showed an error page. Do not retry blindly: report PORTAL_STEP kind=unknown so the human can take over.",
  fix_es: "El portal mostró una página de error. No reintente a ciegas: reporte PORTAL_STEP kind=unknown para que la persona tome el control.",
};

export const DEPT_STATE_CORPORATION_FLOW: FilingFlow = {
  filingType: "DEPT_STATE_CORPORATE_FILING",
  entryRoute: "/en/creationfilings/wizard",
  payee_en: "Puerto Rico Department of State",
  payee_es: "Departamento de Estado de Puerto Rico",
  confirmation: {
    where_en: "Thank-you page after the human submits (/en/creationfilings/thank-you)",
    reference_en: "Certificate of Registry, Articles of Incorporation and Payment Receipt",
  },
  globalRecovery: [sessionExpired, serverError],
  steps: [
    {
      id: "login",
      kind: "login",
      title_en: "Log in",
      title_es: "Iniciar sesión",
      detection: {
        headings: [/^\s*(log ?in|sign ?in|login)\b/i, /iniciar sesi[oó]n|acceder/i],
        urlIncludes: ["/login", "/signin"],
        control: "Password",
      },
      fields: [],
      recovery: [],
      observed: false,
      source: "Registry bundle exposes /api/security login + forgot-password; screen not recorded.",
    },
    {
      id: "name_availability",
      kind: "form",
      title_en: "Name Availability",
      title_es: "Disponibilidad de nombre",
      detection: {
        headings: [/name availability/i, /disponibilidad (del? )?nombre/i],
        control: "Entity class",
      },
      fields: [
        { id: "entity_class", label_en: "Entity class", label_es: "Clase de entidad", type: "select", required: true, passportPath: "business.entityType", normalize: "entity_class" },
        { id: "entity_name", label_en: "Entity name", label_es: "Nombre de la entidad", type: "text", required: true, passportPath: "business.legalName", normalize: "text" },
        { id: "name_designation", label_en: "Name designation", label_es: "Designación del nombre", type: "select", required: true, passportPath: "business.legalName", normalize: "name_designation" },
      ],
      recovery: [
        {
          id: "name_unavailable",
          match: /(is )?not available|no est[aá] disponible|already (exists|in use)|ya existe/i,
          fix_en: "The name is taken. Never invent an alternative — pause (PORTAL_STEP kind=form) and ask the human for a new entity name.",
          fix_es: "El nombre está tomado. Nunca invente otro — pause (PORTAL_STEP kind=form) y pida a la persona un nuevo nombre.",
          askField: "entity_name",
        },
      ],
      observed: true,
      source: "Walkthrough 2026-09-24",
    },
    {
      id: "general_information",
      kind: "form",
      title_en: "General Information",
      title_es: "Información general",
      detection: {
        headings: [/general information/i, /informaci[oó]n general/i],
        urlIncludes: ["#generalinformation"],
        control: "Jurisdiction",
      },
      fields: [
        { id: "entity_type", label_en: "Entity type", label_es: "Tipo de entidad", type: "select", required: true, passportPath: "business.entityType", normalize: "profit_type" },
        // Forming a corporation in Puerto Rico through this flow is domestic
        // by definition; foreign authorization is a different filing.
        { id: "jurisdiction", label_en: "Jurisdiction", label_es: "Jurisdicción", type: "select", required: true, constant: "Domestic" },
        { id: "purposes", label_en: "Purposes", label_es: "Propósitos", type: "text", required: true },
      ],
      recovery: [],
      observed: true,
      source: "Walkthrough 2026-09-24",
    },
    {
      id: "filer",
      kind: "form",
      title_en: "Filer",
      title_es: "Radicador",
      detection: {
        headings: [/^\s*filer\b/i, /radicador|persona que radica/i],
        urlIncludes: ["#filer"],
        control: "Filer type",
      },
      fields: [
        { id: "filer_type", label_en: "Filer type", label_es: "Tipo de radicador", type: "select", required: true },
        { id: "filer_name", label_en: "Filer name", label_es: "Nombre del radicador", type: "text", required: true, passportPath: "contact.fullName", normalize: "text" },
        { id: "filer_street", label_en: "Street address", label_es: "Dirección física", type: "text", required: true, passportPath: "addresses.principalPhysical.line1", normalize: "text" },
        { id: "filer_phone", label_en: "Phone", label_es: "Teléfono", type: "tel", required: true, passportPath: "contact.phone", normalize: "phone_digits" },
        { id: "filer_email", label_en: "Email", label_es: "Correo electrónico", type: "email", required: true, passportPath: "contact.email", normalize: "email" },
        { id: "filer_email_confirm", label_en: "Confirm email", label_es: "Confirmar correo", type: "email", required: true, passportPath: "contact.email", normalize: "email" },
      ],
      recovery: [
        {
          id: "address_rejected",
          match: /p\.?\s*o\.?\s*box|apartado|(address|direcci[oó]n).{0,40}(invalid|not valid|could not be (verified|validated)|inv[aá]lida|no v[aá]lida)/i,
          fix_en: "The registry rejects PO boxes and unverifiable addresses. Use the passport's physical street address; if it has none, pause (PORTAL_STEP kind=form) and ask the human for the physical street address.",
          fix_es: "El registro rechaza apartados postales y direcciones no verificables. Use la dirección física del pasaporte; si no hay, pause (PORTAL_STEP kind=form) y pida a la persona la dirección física.",
          askField: "filer_street",
        },
        {
          id: "email_mismatch",
          match: /(e-?mails?|correos?).{0,30}(do not|don't|no) (match|coinciden)/i,
          fix_en: "Retype the confirm-email field in one pass, then leave the field so it validates on blur.",
          fix_es: "Vuelva a escribir el correo de confirmación de una vez y salga del campo para que valide.",
        },
      ],
      observed: true,
      source: "Walkthrough 2026-09-24",
    },
    {
      id: "designated_office",
      kind: "form",
      title_en: "Designated Office",
      title_es: "Oficina designada",
      detection: { headings: [/designated office/i, /oficina designada/i], control: "Same as filer" },
      fields: [
        { id: "office_street", label_en: "Office street address", label_es: "Dirección de la oficina", type: "text", required: true, passportPath: "addresses.principalPhysical.line1", normalize: "text" },
        { id: "office_phone", label_en: "Office phone", label_es: "Teléfono de la oficina", type: "tel", required: true, passportPath: "contact.phone", normalize: "phone_digits" },
      ],
      recovery: [
        {
          id: "office_phone_required",
          match: /phone.{0,30}required|tel[eé]fono.{0,30}(requerido|obligatorio)/i,
          fix_en: "The portal flags the office phone even when pre-filled — clear it and re-enter the passport phone.",
          fix_es: "El portal marca el teléfono aunque esté lleno — bórrelo y escriba de nuevo el teléfono del pasaporte.",
        },
      ],
      observed: true,
      source: "Walkthrough 2026-09-24",
    },
    {
      id: "resident_agent",
      kind: "form",
      title_en: "Resident Agent",
      title_es: "Agente residente",
      detection: { headings: [/resident agent/i, /agente residente/i], control: "Resident agent is same as filer" },
      fields: [
        { id: "agent_name", label_en: "Agent name", label_es: "Nombre del agente", type: "text", required: true },
        { id: "agent_street", label_en: "Agent street address", label_es: "Dirección del agente", type: "text", required: true },
      ],
      recovery: [],
      observed: true,
      source: "Walkthrough 2026-09-24",
    },
    {
      id: "incorporators",
      kind: "form",
      title_en: "Incorporators",
      title_es: "Incorporadores",
      detection: { headings: [/incorporators?/i, /incorporadores?/i], control: "Add New" },
      // Incorporators are not necessarily the passport contact — never infer.
      fields: [
        { id: "incorporator_name", label_en: "Incorporator name", label_es: "Nombre del incorporador", type: "text", required: true },
        { id: "incorporator_address", label_en: "Incorporator address", label_es: "Dirección del incorporador", type: "text", required: true },
      ],
      recovery: [],
      observed: true,
      source: "Walkthrough 2026-09-24",
    },
    {
      id: "officers",
      kind: "form",
      title_en: "Officers",
      title_es: "Oficiales",
      detection: { headings: [/^\s*officers\b/i, /^\s*oficiales\b/i, /directors|directores/i], control: "Officer title" },
      fields: [
        { id: "officer_name", label_en: "Officer name", label_es: "Nombre del oficial", type: "text", required: true },
        { id: "officer_title", label_en: "Officer title", label_es: "Cargo del oficial", type: "select", required: true },
      ],
      recovery: [
        {
          id: "officers_minimum",
          match: /(at least|m[ií]nimo de?) (two|2|dos)/i,
          fix_en: "The portal asks for at least two officers — pause (PORTAL_STEP kind=form) and ask the human for another officer's name and title. Never invent people.",
          fix_es: "El portal pide al menos dos oficiales — pause (PORTAL_STEP kind=form) y pida a la persona otro nombre y cargo. Nunca invente personas.",
          askField: "officer_name",
        },
      ],
      observed: true,
      source: "Walkthrough 2026-09-24 (help text says ≥2 officers; the wizard advanced with 1)",
    },
    {
      id: "capital_stock",
      kind: "form",
      title_en: "Capital Stock",
      title_es: "Capital autorizado",
      detection: { headings: [/capital stock/i, /capital (autorizado|social)|acciones/i], control: "Number of shares" },
      fields: [
        { id: "stock_class", label_en: "Stock class", label_es: "Clase de acciones", type: "select", required: true },
        { id: "shares_number", label_en: "Number of shares", label_es: "Número de acciones", type: "number", required: true },
        { id: "par_value", label_en: "Par value", label_es: "Valor par", type: "text", required: false },
      ],
      recovery: [],
      observed: true,
      source: "Walkthrough 2026-09-24 (fee panel: minimum $140 + $10 certificate)",
    },
    {
      id: "supporting_docs",
      kind: "upload",
      title_en: "Supporting Documentation",
      title_es: "Documentación de apoyo",
      detection: { headings: [/supporting documentation/i, /documentaci[oó]n de apoyo/i], control: "Upload" },
      fields: [],
      recovery: [
        {
          id: "file_rejected",
          match: /(pdf|tif).{0,40}only|(7 ?mb|file size)|solo (pdf|tif)|tama[ñn]o/i,
          fix_en: "Files must be PDF/TIF under 7 MB with no SSN or tax IDs. Pause for the human to choose a different file.",
          fix_es: "Los archivos deben ser PDF/TIF de menos de 7 MB y sin SSN ni IDs contributivos. Pause para que la persona elija otro archivo.",
        },
      ],
      observed: true,
      source: "Walkthrough 2026-09-24 (optional step)",
    },
    {
      id: "review",
      kind: "review",
      title_en: "Review Filing",
      title_es: "Revisar radicación",
      detection: { headings: [/review filing/i, /revis(ar|i[oó]n de) (la )?radicaci[oó]n/i], control: "Fees" },
      fields: [],
      recovery: [],
      observed: true,
      source: "Walkthrough 2026-09-24 — verify only; never check the perjury declaration",
    },
    {
      id: "signatures",
      kind: "signature",
      title_en: "Signatures",
      title_es: "Firmas",
      detection: { headings: [/^\s*signatures?\b/i, /^\s*firmas?\b/i], control: "Perjury declaration" },
      fields: [],
      recovery: [],
      observed: false,
      source: "Walkthrough stopped here; component CreateAuthorizeSignatures in the registry bundle.",
    },
    {
      id: "payment",
      kind: "payment",
      title_en: "Payment",
      title_es: "Pago",
      detection: { headings: [/^\s*payments?\b/i, /^\s*pagos?\b/i], control: "Card number" },
      fields: [],
      recovery: [],
      observed: false,
      source: "Component CreateAuthorizePayments; card number / expiry / CVV posted to rceapi (bundle 2026-09-25).",
    },
    {
      id: "thank_you",
      kind: "submission",
      title_en: "Thank You",
      title_es: "Gracias",
      detection: {
        headings: [/thank you|filing complete/i, /gracias|radicaci[oó]n completada/i],
        urlIncludes: ["/creationfilings/thank-you", "/filingcomplete"],
        control: "Confirmation",
      },
      fields: [],
      recovery: [],
      observed: false,
      source: "Routes /en/creationfilings/thank-you and /en/filingcomplete in the registry bundle.",
    },
  ],
};
