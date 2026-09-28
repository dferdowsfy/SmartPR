/**
 * SURI — Merchant registration (Registro de Comerciante).
 *
 * Evidence status (honest): the SURI host was UNREACHABLE from our network
 * during every walkthrough attempt (redirect loop 2026-09-25, upstream 500
 * 2026-09-28). NO screen in this flow was observed live. Every step below
 * is derived from the SURI_MERCHANT_REGISTRATION procedure text in
 * filingTypes.ts (login pause → post-login menus → passport prefill → stop
 * at pre-submit review) plus the Hacienda portal conventions documented in
 * the SURI_REGISTER_TAXPAYER playbook. All steps are marked observed:false.
 *
 * Purpose: drive the fictional SURI simulator
 * (frontend/src/app/rehearsal-portal/suri/) and the regression test
 * (frontend/tests/clara-suri-merchant.e2e.mts). The test proves Clara's
 * *behavior* — pause at login, prefill from passport, ask for the rest in
 * chat, stop before submit, pause on unknown screens — not SURI's layout.
 * A supervised live walk is still required before any step here can be
 * marked observed:true.
 */
import type { FilingFlow, FlowRecovery } from "./types";

const sessionExpired: FlowRecovery = {
  id: "session_expired",
  match: /session (has )?(expired|timed out)|sesi[oó]n (ha )?(expirado|caducado|expir[oó])/i,
  fix_en:
    "SURI signed you out. Pause at the login screen (PORTAL_STEP kind=login) — the human signs in again via Take over; then resume on the same step.",
  fix_es:
    "SURI cerró la sesión. Pause en la pantalla de acceso (PORTAL_STEP kind=login) — la persona vuelve a iniciar sesión con Tomar el control; luego continúe en el mismo paso.",
};

const serverError: FlowRecovery = {
  id: "server_error",
  match: /unexpected error|something went wrong|error inesperado|commonerrorpage/i,
  fix_en:
    "SURI showed an error page. Do not retry blindly: report PORTAL_STEP kind=unknown so the human can take over.",
  fix_es:
    "SURI mostró una página de error. No reintente a ciegas: reporte PORTAL_STEP kind=unknown para que la persona tome el control.",
};

export const SURI_MERCHANT_FLOW: FilingFlow = {
  filingType: "SURI_MERCHANT_REGISTRATION",
  entryRoute: "/",
  payee_en: "No payment — merchant registration is free",
  payee_es: "Sin pago — el registro de comerciante es gratis",
  confirmation: {
    where_en: "Confirmation screen after the human clicks Someter (submit)",
    reference_en: "Merchant registration confirmation number",
    pattern: /SURI-MR-\d{6}/i,
  },
  globalRecovery: [sessionExpired, serverError],
  steps: [
    {
      id: "login",
      kind: "login",
      title_en: "Log in to SURI",
      title_es: "Acceda a SURI",
      detection: {
        headings: [/^\s*(log ?in|sign ?in)\b/i, /iniciar sesi[oó]n|acceder|acceda/i],
        urlIncludes: ["/login", "/signin"],
        control: "Password",
      },
      fields: [],
      recovery: [],
      observed: false,
      source: "Procedure text; SURI host unreachable 2026-09-25/28. Human signs in via Take over — Clara never types credentials.",
    },
    {
      id: "dashboard",
      kind: "form",
      title_en: "SURI home",
      title_es: "Inicio de SURI",
      detection: {
        headings: [/welcome|bienvenido/i, /suri home|inicio/i],
        urlIncludes: ["/home", "/dashboard"],
        control: "Registro de Comerciante",
      },
      fields: [],
      recovery: [],
      observed: false,
      source: "Procedure text: 'open the merchant registration path (Registro de Comerciante) from the post-login menus'.",
    },
    {
      id: "merchant_info",
      kind: "form",
      title_en: "Merchant registration",
      title_es: "Registro de comerciante",
      detection: {
        headings: [/merchant registration|registro de comerciante/i],
        urlIncludes: ["/merchant"],
        control: "Merchant legal name",
      },
      fields: [
        { id: "merchant_role", label_en: "Merchant role", label_es: "Rol del comerciante", type: "select", required: true, normalize: "text" },
        { id: "merchant_legal_name", label_en: "Merchant legal name", label_es: "Nombre legal del comerciante", type: "text", required: true, passportPath: "business.legalName", normalize: "text" },
        { id: "merchant_trade_name", label_en: "Trade name (DBA)", label_es: "Nombre comercial (DBA)", type: "text", required: false, passportPath: "business.tradeName", normalize: "text" },
        { id: "merchant_street", label_en: "Street address", label_es: "Dirección física", type: "text", required: true, passportPath: "addresses.principalPhysical.line1", normalize: "text" },
        { id: "merchant_municipality", label_en: "Municipality", label_es: "Municipio", type: "text", required: true, passportPath: "addresses.municipality", normalize: "text" },
        { id: "merchant_postal", label_en: "Postal code", label_es: "Código postal", type: "text", required: true, passportPath: "addresses.principalPhysical.postalCode", normalize: "text" },
        { id: "merchant_contact_name", label_en: "Contact full name", label_es: "Nombre del contacto", type: "text", required: true, passportPath: "contact.fullName", normalize: "text" },
        { id: "merchant_contact_email", label_en: "Contact email", label_es: "Correo electrónico del contacto", type: "email", required: true, passportPath: "contact.email", normalize: "email" },
        { id: "merchant_contact_phone", label_en: "Contact phone", label_es: "Teléfono del contacto", type: "tel", required: true, passportPath: "contact.phone", normalize: "phone_digits" },
      ],
      recovery: [
        {
          id: "ein_mismatch",
          match: /ein.*(not found|mismatch|does not match)|patrono.*no (coincide|encontrado)/i,
          fix_en:
            "SURI could not match the EIN. Pause (PORTAL_STEP kind=form) and ask the human to verify the EIN — never invent one.",
          fix_es:
            "SURI no pudo validar el EIN. Pause (PORTAL_STEP kind=form) y pida a la persona que verifique el EIN — nunca invente uno.",
          askField: "merchant_legal_name",
        },
      ],
      observed: false,
      source: "Field list from the SURI_MERCHANT_REGISTRATION filing config (filingTypes.ts). Layout is an approximation.",
    },
    {
      id: "review",
      kind: "review",
      title_en: "Review and submit",
      title_es: "Revisión y envío",
      detection: {
        headings: [/review|revisi[oó]n/i],
        urlIncludes: ["/merchant"],
        control: "Someter",
      },
      fields: [],
      recovery: [],
      observed: false,
      source: "Procedure text: 'Stop at pre-submit review — never click final Enviar'. Someter is the legal submission act — human only.",
    },
    {
      id: "confirmation",
      kind: "submission",
      title_en: "Registration confirmed",
      title_es: "Registro confirmado",
      detection: {
        headings: [/confirmed|confirmado|confirmation|confirmaci[oó]n/i],
        urlIncludes: ["/merchant"],
        control: "Confirmation number",
      },
      fields: [],
      recovery: [],
      observed: false,
      source: "Approximation. The human clicks Someter; Clara only captures the confirmation reference.",
    },
  ],
};
