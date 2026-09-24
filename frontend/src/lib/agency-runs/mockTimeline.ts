import { PLACEHOLDER_SHOTS } from "./placeholders";
import type { AgencyFilingConfig } from "./filingTypes";
import type { AgencyPauseReason } from "./types";

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

/** Scripted beats for the skeleton mock worker (no Playwright), generated from the filing config. */
export function timelineFor(config: AgencyFilingConfig): MockBeat[] {
  const beats: MockBeat[] = [
    {
      kind: "step",
      delayMs: 800,
      message: `Opening ${config.portalEn} (${config.domains[0]})…`,
      message_es: `Abriendo ${config.portalEs} (${config.domains[0]})…`,
      shot: "home",
    },
    {
      kind: "step",
      delayMs: 1200,
      message: `${config.goalEn} — locating the online filing section`,
      message_es: `${config.goalEs} — localizando la sección de radicación en línea`,
      shot: "info",
    },
    {
      kind: "step",
      delayMs: 1400,
      message: "Prefilling from Business Passport (non-sensitive fields)",
      message_es: "Rellenando desde el Pasaporte de Negocio (campos no sensibles)",
      shot: "info",
    },
    {
      kind: "pause",
      delayMs: 1000,
      message: `Paused for uploads: ${config.uploadsEn}`,
      message_es: `Pausa para adjuntos: ${config.uploadsEs}`,
      shot: "upload",
      pause_reason: "USER_UPLOAD",
    },
  ];

  if (config.needsLogin) {
    beats.push({
      kind: "pause",
      delayMs: 1000,
      message: `Paused for ${config.portalEn} login / MFA. Credentials stay with you. Resume when done.`,
      message_es: `Pausa para inicio de sesión / MFA de ${config.portalEs}. Las credenciales son suyas. Reanude al terminar.`,
      shot: "login",
      pause_reason: "USER_LOGIN",
    });
  }

  beats.push(
    {
      kind: "step",
      delayMs: 1400,
      message: "Navigating to pre-submit review",
      message_es: "Navegando a revisión previa al envío",
      shot: "review",
    },
    {
      kind: "review",
      delayMs: 800,
      message: "Review ready — authorize SmartPR to file it for you, or take over the browser.",
      message_es: "Revisión lista — autoriza a SmartPR a enviarlo por ti, o toma el control del navegador.",
      shot: "review",
    }
  );

  return beats;
}
