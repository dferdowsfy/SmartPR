import { PLACEHOLDER_SHOTS } from "./placeholders";
import type { AgencyFilingType, AgencyPauseReason } from "./types";

export type MockBeat =
  | {
      kind: "step";
      delayMs: number;
      message: string;
      message_es: string;
      shot: keyof typeof PLACEHOLDER_SHOTS;
    }
  | {
      kind: "pause";
      delayMs: number;
      message: string;
      message_es: string;
      shot: keyof typeof PLACEHOLDER_SHOTS;
      pause_reason: Exclude<AgencyPauseReason, null>;
    }
  | {
      kind: "review";
      delayMs: number;
      message: string;
      message_es: string;
      shot: keyof typeof PLACEHOLDER_SHOTS;
    };

/** Scripted beats for the skeleton mock worker (no Playwright). */
export function timelineFor(filingType: AgencyFilingType): MockBeat[] {
  const base: MockBeat[] = [
    {
      kind: "step",
      delayMs: 800,
      message: "Opening SURI (suri.hacienda.pr.gov)…",
      message_es: "Abriendo SURI (suri.hacienda.pr.gov)…",
      shot: "home",
    },
    {
      kind: "step",
      delayMs: 1200,
      message: "Selecting Registration → Create SURI Logon",
      message_es: "Seleccionando Registro → Crear acceso SURI",
      shot: "register",
    },
  ];

  if (filingType === "SURI_REGISTER_TAXPAYER") {
    return [
      ...base,
      {
        kind: "step",
        delayMs: 1400,
        message: "Register as Individual Taxpayer — Step 1: Taxpayer ID (sensitive; not stored in passport)",
        message_es: "Registrar como contribuyente individual — Paso 1: ID (sensible; no se guarda en el pasaporte)",
        shot: "taxpayerId",
      },
      {
        kind: "step",
        delayMs: 1400,
        message: "Prefilling Step 2: Taxpayer information from Business Passport",
        message_es: "Rellenando Paso 2: información del contribuyente desde el Pasaporte de Negocio",
        shot: "info",
      },
      {
        kind: "step",
        delayMs: 1600,
        message: "Prefilling name & address — agent will click Verify Address (required)",
        message_es: "Rellenando nombre y dirección — el agente hará clic en Verificar dirección (obligatorio)",
        shot: "address",
      },
      {
        kind: "pause",
        delayMs: 1000,
        message: "Paused for uploads: photo ID, utility bill, SSN card. Max 5 MB each. WhatsApp help: +1-301-221-5129",
        message_es: "Pausa para adjuntos: ID con foto, factura de utilidad, tarjeta SSN. Máx. 5 MB c/u. WhatsApp: +1-301-221-5129",
        shot: "upload",
        pause_reason: "USER_UPLOAD",
      },
      {
        kind: "step",
        delayMs: 1200,
        message: "Attachments noted — continuing toward login gate",
        message_es: "Adjuntos anotados — continuando hacia el inicio de sesión",
        shot: "upload",
      },
      {
        kind: "pause",
        delayMs: 1000,
        message: "Paused for SURI login / MFA. Credentials stay with you. Resume when done.",
        message_es: "Pausa para inicio de sesión / MFA de SURI. Las credenciales son suyas. Reanude al terminar.",
        shot: "login",
        pause_reason: "USER_LOGIN",
      },
      {
        kind: "step",
        delayMs: 1400,
        message: "Navigating to pre-submit review (no final submit)",
        message_es: "Navegando a revisión previa al envío (sin enviar)",
        shot: "review",
      },
      {
        kind: "review",
        delayMs: 800,
        message: "Review ready — you submit on the portal. Agent never clicks final submit.",
        message_es: "Revisión lista — usted envía en el portal. El agente nunca hace clic en enviar.",
        shot: "review",
      },
    ];
  }

  // Merchant registration — same skeleton shape; may be disabled in UI until account exists.
  return [
    ...base,
    {
      kind: "step",
      delayMs: 1400,
      message: "Post-login path: Registro de Comerciante (merchant registration)",
      message_es: "Ruta post-login: Registro de Comerciante",
      shot: "info",
    },
    {
      kind: "step",
      delayMs: 1400,
      message: "Prefilling merchant fields from Business Passport",
      message_es: "Rellenando campos del comerciante desde el Pasaporte de Negocio",
      shot: "address",
    },
    {
      kind: "pause",
      delayMs: 1000,
      message: "Paused for supporting uploads (max 5 MB). WhatsApp interventions: +1-301-221-5129",
      message_es: "Pausa para adjuntos de apoyo (máx. 5 MB). Intervenciones WhatsApp: +1-301-221-5129",
      shot: "upload",
      pause_reason: "USER_UPLOAD",
    },
    {
      kind: "pause",
      delayMs: 1000,
      message: "Paused for captcha / portal challenge",
      message_es: "Pausa por captcha / desafío del portal",
      shot: "captcha",
      pause_reason: "CAPTCHA",
    },
    {
      kind: "review",
      delayMs: 800,
      message: "Review ready — you submit on the portal. Agent never clicks final submit.",
      message_es: "Revisión lista — usted envía en el portal. El agente nunca hace clic en enviar.",
      shot: "review",
    },
  ];
}
